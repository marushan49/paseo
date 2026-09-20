import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Logger } from "pino";
import {
  chromium,
  type BrowserContext,
  type Dialog,
  type Page,
  type Request,
  type Response,
} from "playwright-core";
import type {
  BrowserAutomationCommand,
  BrowserAutomationCommandName,
  BrowserAutomationConsoleLogEntry,
  BrowserAutomationDialogEvent,
  BrowserAutomationExecuteRequest,
  BrowserAutomationNetworkLogEntry,
} from "@getpaseo/protocol/browser-automation/rpc-schemas";
import type { BrowserHostClient } from "../browser-tools/broker.js";
import { browserToolsFailure, type BrowserToolsResponsePayload } from "../browser-tools/errors.js";
import { resolveBrowserExecutable } from "./browser-capability.js";
import { EvidenceStore, formatEvidenceRef } from "./evidence-store.js";
import {
  collectSnapshotNodes,
  formatSnapshotYaml,
  snapshotRefIndex,
  type SnapshotNodeWithRef,
} from "./page-snapshot.js";

export const DAEMON_PLAYWRIGHT_HOST_ID = "daemon-playwright";
export const DAEMON_PLAYWRIGHT_HOST_KIND = "daemon-playwright";
export const DEFAULT_VERIFY_PROFILE = "default";
export const MAX_VERIFY_LOG_ENTRIES = 200;
const MAX_EVALUATE_JSON_BYTES = 65_536;
const MAX_ERROR_MESSAGE_LENGTH = 500;
const DEFAULT_VERIFY_VIEWPORT = { width: 1280, height: 720 };

export const DAEMON_PLAYWRIGHT_COMMANDS: readonly BrowserAutomationCommandName[] = [
  "list_tabs",
  "new_tab",
  "navigate",
  "back",
  "forward",
  "reload",
  "snapshot",
  "click",
  "fill",
  "select",
  "type",
  "keypress",
  "wait",
  "scroll",
  "hover",
  "drag",
  "resize",
  "screenshot",
  "logs",
  "evaluate",
  "close_tab",
];

type CommandResult = Extract<BrowserToolsResponsePayload, { ok: true }>["result"];

interface VerifyConsoleEntry extends BrowserAutomationConsoleLogEntry {
  timestamp: number;
}

interface VerifyNetworkEntry extends BrowserAutomationNetworkLogEntry {
  failed: boolean;
}

interface DaemonBrowserTab {
  browserId: string;
  workspaceId: string;
  profile: string;
  context: BrowserContext;
  page: Page;
  snapshot: SnapshotNodeWithRef[];
  consoleEntries: VerifyConsoleEntry[];
  networkEntries: VerifyNetworkEntry[];
  pendingRequests: Map<Request, number>;
  dialogs: BrowserAutomationDialogEvent[];
}

export interface DaemonPlaywrightHostOptions {
  paseoHome: string;
  logger: Logger;
}

export interface ExecuteLocalInput {
  workspaceId: string;
  command: BrowserAutomationCommand;
  profile?: string;
  requestId?: string;
  agentId?: string;
}

export class DaemonPlaywrightHost {
  private readonly paseoHome: string;
  private readonly logger: Logger;
  private readonly contexts = new Map<string, BrowserContext>();
  private readonly tabs = new Map<string, DaemonBrowserTab>();
  private executablePath: string | null = null;
  private useNoSandboxFallback = false;
  private requestSequence = 0;
  private evidenceStore: EvidenceStore | null = null;

  private evidence(): EvidenceStore {
    if (!this.evidenceStore) {
      this.evidenceStore = new EvidenceStore({ paseoHome: this.paseoHome });
    }
    return this.evidenceStore;
  }

  public constructor(options: DaemonPlaywrightHostOptions) {
    this.paseoHome = options.paseoHome;
    this.logger = options.logger;
  }

  public asHostClient(
    deliver: (response: {
      type: "browser.automation.execute.response";
      payload: BrowserToolsResponsePayload;
    }) => void,
  ): BrowserHostClient {
    return {
      id: DAEMON_PLAYWRIGHT_HOST_ID,
      hostKind: DAEMON_PLAYWRIGHT_HOST_KIND,
      supportedCommands: DAEMON_PLAYWRIGHT_COMMANDS,
      sendBrowserAutomationRequest: (request) => {
        void this.handleBrokerRequest(request).then((payload) =>
          deliver({ type: "browser.automation.execute.response", payload }),
        );
      },
    };
  }

  public async executeLocal(input: ExecuteLocalInput): Promise<BrowserToolsResponsePayload> {
    const requestId = input.requestId ?? `verify_${(this.requestSequence += 1)}`;
    const startedAt = Date.now();
    try {
      const payload = await this.runCommand({
        workspaceId: input.workspaceId,
        command: input.command,
        profile: input.profile ?? DEFAULT_VERIFY_PROFILE,
        requestId,
        ...(input.agentId ? { agentId: input.agentId } : {}),
      });
      this.logger.info({
        verifyBrowser: {
          command: input.command.command,
          workspaceId: input.workspaceId,
          durationMs: Date.now() - startedAt,
          ok: payload.ok,
        },
      });
      return payload;
    } catch (error) {
      this.logger.warn({
        verifyBrowser: {
          command: input.command.command,
          workspaceId: input.workspaceId,
          durationMs: Date.now() - startedAt,
          ok: false,
        },
      });
      if (error instanceof StaleRefError) {
        return browserToolsFailure({
          requestId: error.requestId,
          code: "browser_stale_ref",
          message: error.message,
        });
      }
      if (isTimeoutError(error)) {
        return browserToolsFailure({
          requestId,
          code: "browser_timeout",
          message: `Browser automation timed out: ${truncateErrorMessage(error)}`,
          retryable: true,
        });
      }
      return browserToolsFailure({
        requestId,
        code: "browser_unknown_error",
        message: truncateErrorMessage(error),
      });
    }
  }

  public async close(): Promise<void> {
    this.tabs.clear();
    const contexts = [...this.contexts.values()];
    this.contexts.clear();
    for (const context of contexts) {
      await context.close().catch(() => undefined);
    }
  }

  private async handleBrokerRequest(
    request: BrowserAutomationExecuteRequest,
  ): Promise<BrowserToolsResponsePayload> {
    if (!request.workspaceId) {
      return browserToolsFailure({
        requestId: request.requestId,
        code: "browser_denied",
        message: "The daemon browser host needs a workspace id.",
      });
    }
    return this.executeLocal({
      workspaceId: request.workspaceId,
      command: request.command,
      requestId: request.requestId,
      ...(request.agentId ? { agentId: request.agentId } : {}),
    });
  }

  private async runCommand(input: {
    workspaceId: string;
    command: BrowserAutomationCommand;
    profile: string;
    requestId: string;
    agentId?: string;
  }): Promise<BrowserToolsResponsePayload> {
    const { command, requestId, workspaceId } = input;
    switch (command.command) {
      case "list_tabs":
        return this.listTabs({ workspaceId, requestId });
      case "new_tab": {
        const tab = await this.createTab({
          workspaceId,
          profile: input.profile,
          url: command.args.url,
        });
        return ok(requestId, {
          command: "new_tab",
          browserId: tab.browserId,
          workspaceId: tab.workspaceId,
          url: tab.page.url(),
        });
      }
      default: {
        const tab = this.requireTab({ workspaceId, browserId: command.args.browserId, requestId });
        if ("payload" in tab) {
          return tab.payload;
        }
        const result = await this.runTabCommand({
          tab,
          command,
          requestId,
          ...(input.agentId ? { agentId: input.agentId } : {}),
        });
        const dialogs = takeDialogs(tab);
        return { ...result, ...(dialogs.length > 0 ? { dialogs } : {}) };
      }
    }
  }

  private async runTabCommand(input: {
    tab: DaemonBrowserTab;
    command: BrowserAutomationCommand;
    requestId: string;
    agentId?: string;
  }): Promise<BrowserToolsResponsePayload> {
    const { tab, command, requestId } = input;
    switch (command.command) {
      case "navigate":
      case "back":
      case "forward":
      case "reload":
        return this.runNavigationCommand({ tab, command, requestId });
      case "snapshot":
        return this.runSnapshotCommand({ tab, requestId });
      case "click":
      case "fill":
      case "select":
      case "hover":
      case "drag":
        return this.runRefCommand({ tab, command, requestId });
      case "type":
      case "keypress":
      case "scroll":
        return this.runKeyCommand({ tab, command, requestId });
      default:
        return this.runOutputCommand({
          tab,
          command,
          requestId,
          ...(input.agentId ? { agentId: input.agentId } : {}),
        });
    }
  }

  private async runNavigationCommand(input: {
    tab: DaemonBrowserTab;
    command: Extract<
      BrowserAutomationCommand,
      { command: "navigate" | "back" | "forward" | "reload" }
    >;
    requestId: string;
  }): Promise<BrowserToolsResponsePayload> {
    const { tab, command, requestId } = input;
    switch (command.command) {
      case "navigate":
        await tab.page.goto(command.args.url, { waitUntil: "domcontentloaded" });
        invalidateSnapshot(tab);
        return ok(requestId, {
          command: "navigate",
          browserId: tab.browserId,
          url: tab.page.url(),
        });
      case "back":
        await tab.page.goBack({ waitUntil: "domcontentloaded" }).catch(() => null);
        invalidateSnapshot(tab);
        return ok(requestId, { command: "back", browserId: tab.browserId });
      case "forward":
        await tab.page.goForward({ waitUntil: "domcontentloaded" }).catch(() => null);
        invalidateSnapshot(tab);
        return ok(requestId, { command: "forward", browserId: tab.browserId });
      case "reload":
        await tab.page.reload({ waitUntil: "domcontentloaded" }).catch(() => null);
        invalidateSnapshot(tab);
        return ok(requestId, { command: "reload", browserId: tab.browserId });
    }
  }

  private async runSnapshotCommand(input: {
    tab: DaemonBrowserTab;
    requestId: string;
  }): Promise<BrowserToolsResponsePayload> {
    const { tab, requestId } = input;
    const snapshot = await this.refreshSnapshot(tab);
    return ok(requestId, {
      command: "snapshot",
      browserId: tab.browserId,
      workspaceId: tab.workspaceId,
      url: tab.page.url(),
      title: await tab.page.title().catch(() => ""),
      format: "aria-yaml",
      snapshot: snapshot.yaml,
      truncated: snapshot.truncated,
      stats: snapshot.stats,
    });
  }

  private async runRefCommand(input: {
    tab: DaemonBrowserTab;
    command: Extract<
      BrowserAutomationCommand,
      { command: "click" | "fill" | "select" | "hover" | "drag" }
    >;
    requestId: string;
  }): Promise<BrowserToolsResponsePayload> {
    const { tab, command, requestId } = input;
    switch (command.command) {
      case "click":
        if ("ref" in command.args) {
          await tab.page.locator(resolveRefSelector(tab, command.args.ref, requestId)).click();
          invalidateSnapshot(tab);
          return ok(requestId, {
            command: "click",
            browserId: tab.browserId,
            ref: command.args.ref,
          });
        }
        if (!("x" in command.args) || !("y" in command.args)) {
          return browserToolsFailure({
            requestId,
            code: "browser_unknown_error",
            message: "The browser click command has no target coordinates.",
          });
        }
        const { button, doubleClick, modifiers, x, y } = command.args;
        await withKeyboardModifiers(tab.page, modifiers, async () => {
          await tab.page.mouse.click(x, y, { button, clickCount: doubleClick ? 2 : 1 });
        });
        invalidateSnapshot(tab);
        return ok(requestId, {
          command: "click",
          browserId: tab.browserId,
          x,
          y,
        });
      case "fill":
        await tab.page
          .locator(resolveRefSelector(tab, command.args.ref, requestId))
          .fill(command.args.value);
        return ok(requestId, { command: "fill", browserId: tab.browserId, ref: command.args.ref });
      case "select":
        await tab.page
          .locator(resolveRefSelector(tab, command.args.ref, requestId))
          .selectOption(command.args.value);
        return ok(requestId, {
          command: "select",
          browserId: tab.browserId,
          ref: command.args.ref,
          value: command.args.value,
        });
      case "hover":
        if ("ref" in command.args) {
          await tab.page.locator(resolveRefSelector(tab, command.args.ref, requestId)).hover();
          return ok(requestId, {
            command: "hover",
            browserId: tab.browserId,
            ref: command.args.ref,
          });
        }
        await tab.page.mouse.move(command.args.x, command.args.y);
        return ok(requestId, {
          command: "hover",
          browserId: tab.browserId,
          x: command.args.x,
          y: command.args.y,
        });
      case "drag":
        if ("sourceRef" in command.args) {
          await tab.page
            .locator(resolveRefSelector(tab, command.args.sourceRef, requestId))
            .dragTo(tab.page.locator(resolveRefSelector(tab, command.args.targetRef, requestId)));
          invalidateSnapshot(tab);
          return ok(requestId, {
            command: "drag",
            browserId: tab.browserId,
            sourceRef: command.args.sourceRef,
            targetRef: command.args.targetRef,
          });
        }
        await tab.page.mouse.move(command.args.sourceX, command.args.sourceY);
        await tab.page.mouse.down();
        try {
          await tab.page.mouse.move(command.args.targetX, command.args.targetY, { steps: 8 });
        } finally {
          await tab.page.mouse.up();
        }
        invalidateSnapshot(tab);
        return ok(requestId, {
          command: "drag",
          browserId: tab.browserId,
          sourceX: command.args.sourceX,
          sourceY: command.args.sourceY,
          targetX: command.args.targetX,
          targetY: command.args.targetY,
        });
    }
  }

  private async runKeyCommand(input: {
    tab: DaemonBrowserTab;
    command: Extract<BrowserAutomationCommand, { command: "type" | "keypress" | "scroll" }>;
    requestId: string;
  }): Promise<BrowserToolsResponsePayload> {
    const { tab, command, requestId } = input;
    switch (command.command) {
      case "type":
        if (command.args.ref) {
          await tab.page
            .locator(resolveRefSelector(tab, command.args.ref, requestId))
            .pressSequentially(command.args.text);
        } else {
          await tab.page.keyboard.type(command.args.text);
        }
        invalidateSnapshot(tab);
        return ok(requestId, {
          command: "type",
          browserId: tab.browserId,
          ...(command.args.ref ? { ref: command.args.ref } : {}),
        });
      case "keypress":
        if (command.args.ref) {
          await tab.page
            .locator(resolveRefSelector(tab, command.args.ref, requestId))
            .press(command.args.key);
        } else {
          await tab.page.keyboard.press(command.args.key);
        }
        invalidateSnapshot(tab);
        return ok(requestId, {
          command: "keypress",
          browserId: tab.browserId,
          key: command.args.key,
          ...(command.args.ref ? { ref: command.args.ref } : {}),
        });
      case "scroll":
        if (command.args.x !== undefined && command.args.y !== undefined) {
          await tab.page.mouse.move(command.args.x, command.args.y);
        }
        if (command.args.ref) {
          await tab.page
            .locator(resolveRefSelector(tab, command.args.ref, requestId))
            .scrollIntoViewIfNeeded();
        }
        await tab.page.mouse.wheel(command.args.deltaX, command.args.deltaY);
        return ok(requestId, {
          command: "scroll",
          browserId: tab.browserId,
          ...(command.args.ref ? { ref: command.args.ref } : {}),
          deltaX: command.args.deltaX,
          deltaY: command.args.deltaY,
          ...(command.args.x !== undefined && command.args.y !== undefined
            ? { x: command.args.x, y: command.args.y }
            : {}),
        });
    }
  }

  private async runOutputCommand(input: {
    tab: DaemonBrowserTab;
    command: Extract<
      BrowserAutomationCommand,
      {
        command:
          | "wait"
          | "resize"
          | "screenshot"
          | "logs"
          | "evaluate"
          | "close_tab"
          | "list_tabs"
          | "new_tab"
          | "upload";
      }
    >;
    requestId: string;
    agentId?: string;
  }): Promise<BrowserToolsResponsePayload> {
    const { tab, command, requestId } = input;
    switch (command.command) {
      case "wait":
        return this.runWaitCommand({ tab, command, requestId });
      case "resize":
        return this.runResizeCommand({ tab, command, requestId });
      case "screenshot":
        return this.runScreenshotCommand({
          tab,
          command,
          requestId,
          ...(input.agentId ? { agentId: input.agentId } : {}),
        });
      case "logs":
        return this.runLogsCommand({ tab, command, requestId });
      case "evaluate":
        return this.runEvaluateCommand({ tab, command, requestId });
      case "close_tab":
        return this.runCloseTabCommand({ tab, requestId });
      case "list_tabs":
      case "new_tab":
      case "upload":
        return browserToolsFailure({
          requestId,
          code: "browser_unsupported",
          message: `The daemon browser host does not support "${command.command}".`,
        });
    }
  }
  private async runWaitCommand(input: {
    tab: DaemonBrowserTab;
    command: Extract<BrowserAutomationCommand, { command: "wait" }>;
    requestId: string;
  }): Promise<BrowserToolsResponsePayload> {
    const { tab, command, requestId } = input;
    const matched = await this.waitForCondition(tab, command.args);
    return ok(requestId, { command: "wait", browserId: tab.browserId, matched });
  }

  private async runResizeCommand(input: {
    tab: DaemonBrowserTab;
    command: Extract<BrowserAutomationCommand, { command: "resize" }>;
    requestId: string;
  }): Promise<BrowserToolsResponsePayload> {
    const { tab, command, requestId } = input;
    await tab.page.setViewportSize({ width: command.args.width, height: command.args.height });
    return ok(requestId, {
      command: "resize",
      browserId: tab.browserId,
      width: command.args.width,
      height: command.args.height,
    });
  }

  private async runScreenshotCommand(input: {
    tab: DaemonBrowserTab;
    command: Extract<BrowserAutomationCommand, { command: "screenshot" }>;
    requestId: string;
    agentId?: string;
  }): Promise<BrowserToolsResponsePayload> {
    const { tab, command, requestId } = input;
    const data = await this.captureScreenshot(tab, command.args.fullPage);
    if (command.args.ephemeral) {
      const viewport = tab.page.viewportSize() ?? DEFAULT_VERIFY_VIEWPORT;
      return ok(requestId, {
        command: "screenshot",
        browserId: tab.browserId,
        mimeType: "image/png",
        dataBase64: data.toString("base64"),
        bytes: data.byteLength,
        width: viewport.width,
        height: viewport.height,
      });
    }
    // Capture time, not write time: with a capture retry the two differ,
    // and the timeline anchor must point at the moment the pixels existed.
    const capturedAt = new Date().toISOString();
    const viewport = tab.page.viewportSize() ?? DEFAULT_VERIFY_VIEWPORT;
    const workspaceId = tab.workspaceId;
    let runId = command.args.runId;
    if (runId) {
      const manifest = await this.evidence().getManifest({ workspaceId, runId });
      if (!manifest) {
        return browserToolsFailure({
          requestId,
          code: "browser_unknown_error",
          message: `Evidence run not found: ${runId}`,
        });
      }
    } else {
      const manifest = await this.evidence().createRun({
        workspaceId,
        recipe: "browser-screenshot",
        ...(input.agentId ? { agentId: input.agentId } : {}),
      });
      runId = manifest.runId;
    }
    const name = command.args.artifactName ?? "screenshot";
    const entry = await this.evidence().writeArtifact({
      runId,
      name,
      kind: "screenshot",
      contentType: "image/png",
      data,
      capturedAt,
    });
    return ok(requestId, {
      command: "screenshot",
      browserId: tab.browserId,
      mimeType: "image/png",
      ...(command.args.reveal ? { dataBase64: data.toString("base64") } : {}),
      evidenceRef: formatEvidenceRef({ workspaceId, runId, name }),
      bytes: entry.bytes,
      sha256: entry.sha256,
      width: viewport.width,
      height: viewport.height,
    });
  }

  private async captureScreenshot(tab: DaemonBrowserTab, fullPage: boolean): Promise<Buffer> {
    try {
      return await tab.page.screenshot({ fullPage });
    } catch {
      // The headless compositor is occasionally not ready for the first
      // capture in a fresh context; a single immediate retry succeeds.
      return await tab.page.screenshot({ fullPage });
    }
  }

  private async runLogsCommand(input: {
    tab: DaemonBrowserTab;
    command: Extract<BrowserAutomationCommand, { command: "logs" }>;
    requestId: string;
  }): Promise<BrowserToolsResponsePayload> {
    const { tab, command, requestId } = input;
    const maxEntries = command.args.maxEntries;
    return ok(requestId, {
      command: "logs",
      browserId: tab.browserId,
      console: tab.consoleEntries.slice(-maxEntries),
      network: tab.networkEntries.slice(-maxEntries).map(stripNetworkFailed),
    });
  }

  private async runEvaluateCommand(input: {
    tab: DaemonBrowserTab;
    command: Extract<BrowserAutomationCommand, { command: "evaluate" }>;
    requestId: string;
  }): Promise<BrowserToolsResponsePayload> {
    const { tab, command, requestId } = input;
    const { resultJson, truncated } = await this.evaluateInPage(
      tab,
      command.args.function,
      command.args.ref,
    );
    return ok(requestId, { command: "evaluate", browserId: tab.browserId, resultJson, truncated });
  }

  private async runCloseTabCommand(input: {
    tab: DaemonBrowserTab;
    requestId: string;
  }): Promise<BrowserToolsResponsePayload> {
    const { tab, requestId } = input;
    const browserId = tab.browserId;
    await tab.page.close().catch(() => undefined);
    this.tabs.delete(browserId);
    return ok(requestId, { command: "close_tab", browserId });
  }

  private async listTabs(input: {
    workspaceId: string;
    requestId: string;
  }): Promise<BrowserToolsResponsePayload> {
    const tabs = [];
    for (const tab of this.tabs.values()) {
      if (tab.workspaceId !== input.workspaceId || tab.page.isClosed()) {
        continue;
      }
      tabs.push({
        browserId: tab.browserId,
        workspaceId: tab.workspaceId,
        url: tab.page.url(),
        title: await tab.page.title().catch(() => ""),
        isActive: true,
        isLoading: false,
      });
    }
    return ok(input.requestId, { command: "list_tabs", tabs });
  }

  private requireTab(input: {
    workspaceId: string;
    browserId: string;
    requestId: string;
  }): DaemonBrowserTab | { payload: BrowserToolsResponsePayload } {
    const tab = this.tabs.get(input.browserId);
    if (!tab || tab.page.isClosed()) {
      if (tab) {
        this.tabs.delete(input.browserId);
      }
      return {
        payload: browserToolsFailure({
          requestId: input.requestId,
          code: "browser_tab_not_found",
          message: `Browser tab ${input.browserId} is not known to the daemon browser host.`,
        }),
      };
    }
    if (tab.workspaceId !== input.workspaceId) {
      return {
        payload: browserToolsFailure({
          requestId: input.requestId,
          code: "browser_denied",
          message: "Browser tab belongs to a different workspace.",
          retryable: false,
        }),
      };
    }
    return tab;
  }

  private async createTab(input: {
    workspaceId: string;
    profile: string;
    url?: string;
  }): Promise<DaemonBrowserTab> {
    const context = await this.ensureContext({
      workspaceId: input.workspaceId,
      profile: input.profile,
    });
    const page = await context.newPage();
    const browserId = `${Date.now().toString()}-${randomBytes(8).toString("hex")}`;
    const tab: DaemonBrowserTab = {
      browserId,
      workspaceId: input.workspaceId,
      profile: input.profile,
      context,
      page,
      snapshot: [],
      consoleEntries: [],
      networkEntries: [],
      pendingRequests: new Map(),
      dialogs: [],
    };
    attachTabListeners(tab);
    this.tabs.set(browserId, tab);
    if (input.url) {
      await page.goto(input.url, { waitUntil: "domcontentloaded" });
    }
    return tab;
  }

  private async refreshSnapshot(tab: DaemonBrowserTab): Promise<{
    yaml: string;
    truncated: boolean;
    stats: { nodeCount: number; refCount: number; textLength: number };
  }> {
    const collected = await tab.page.evaluate(collectSnapshotNodes);
    const formatted = formatSnapshotYaml(collected);
    tab.snapshot = formatted.nodes;
    return { yaml: formatted.yaml, truncated: formatted.truncated, stats: formatted.stats };
  }

  private async waitForCondition(
    tab: DaemonBrowserTab,
    args: { text?: string; url?: string; timeoutMs?: number },
  ): Promise<"text" | "url"> {
    const timeout = args.timeoutMs ?? 15_000;
    if (args.text !== undefined) {
      const expected = JSON.stringify(args.text);
      await tab.page.waitForFunction(
        `document.body && document.body.innerText.includes(${expected})`,
        undefined,
        { timeout },
      );
      invalidateSnapshot(tab);
      return "text";
    }
    const expected = args.url ?? "";
    await tab.page.waitForURL((current) => current.toString().includes(expected), { timeout });
    invalidateSnapshot(tab);
    return "url";
  }

  private async evaluateInPage(
    tab: DaemonBrowserTab,
    functionSource: string,
    ref: string | undefined,
  ): Promise<{ resultJson: string; truncated: boolean }> {
    const selector = ref ? resolveRefSelector(tab, ref, "evaluate") : undefined;
    const raw = await tab.page.evaluate(
      `(() => { const element = ${selector ? `document.querySelector(${JSON.stringify(selector)})` : "document"}; const fn = new Function("element", ${JSON.stringify(functionSource)}); return fn(element); })()`,
    );
    const resultJson = JSON.stringify(raw ?? null) ?? "null";
    if (Buffer.byteLength(resultJson, "utf8") <= MAX_EVALUATE_JSON_BYTES) {
      return { resultJson, truncated: false };
    }
    return { resultJson: resultJson.slice(0, MAX_EVALUATE_JSON_BYTES), truncated: true };
  }

  private async ensureContext(input: {
    workspaceId: string;
    profile: string;
  }): Promise<BrowserContext> {
    const key = `${input.workspaceId}::${input.profile}`;
    const existing = this.contexts.get(key);
    if (existing) {
      return existing;
    }
    if (!this.executablePath) {
      this.executablePath = resolveBrowserExecutable().path;
    }
    const userDataDir = path.join(
      this.paseoHome,
      "browser-profiles",
      sanitizeProfileSegment(input.workspaceId),
      sanitizeProfileSegment(input.profile),
    );
    mkdirSync(userDataDir, { recursive: true });
    const context = await this.launchPersistentContext(userDataDir);
    this.contexts.set(key, context);
    context.on("close", () => {
      if (this.contexts.get(key) === context) {
        this.contexts.delete(key);
      }
    });
    return context;
  }

  private async launchPersistentContext(userDataDir: string): Promise<BrowserContext> {
    const baseOptions = {
      headless: true,
      executablePath: this.executablePath ?? undefined,
      viewport: DEFAULT_VERIFY_VIEWPORT,
      args: ["--disable-dev-shm-usage"],
    };
    try {
      return await chromium.launchPersistentContext(userDataDir, baseOptions);
    } catch (error) {
      if (!this.useNoSandboxFallback && isSandboxLaunchError(error) && process.getuid?.() === 0) {
        this.useNoSandboxFallback = true;
        this.logger.warn(
          "Daemon browser runs as root without a user namespace; retrying once with --no-sandbox.",
        );
        return chromium.launchPersistentContext(userDataDir, {
          ...baseOptions,
          args: [...baseOptions.args, "--no-sandbox"],
        });
      }
      throw error;
    }
  }
}

function ok(requestId: string, result: CommandResult): BrowserToolsResponsePayload {
  return { requestId, ok: true, result };
}

function invalidateSnapshot(tab: DaemonBrowserTab): void {
  tab.snapshot = [];
}

function resolveRefSelector(tab: DaemonBrowserTab, ref: string, requestId: string): string {
  const index = snapshotRefIndex(ref);
  const node = index === null ? undefined : tab.snapshot[index];
  if (!node || node.ref !== ref) {
    throw new StaleRefError(requestId, ref);
  }
  return node.selector;
}

export class StaleRefError extends Error {
  public readonly requestId: string;
  public readonly ref: string;

  public constructor(requestId: string, ref: string) {
    super(`Reference ${ref} expired; take a fresh browser_snapshot before acting.`);
    this.name = "StaleRefError";
    this.requestId = requestId;
    this.ref = ref;
  }
}

function takeDialogs(tab: DaemonBrowserTab): BrowserAutomationDialogEvent[] {
  if (tab.dialogs.length === 0) {
    return [];
  }
  const dialogs = [...tab.dialogs];
  tab.dialogs.length = 0;
  return dialogs;
}

function stripNetworkFailed(entry: VerifyNetworkEntry): BrowserAutomationNetworkLogEntry {
  const { failed: _failed, ...rest } = entry;
  return rest;
}

function toDialogType(value: string): BrowserAutomationDialogEvent["type"] {
  return value === "alert" || value === "confirm" || value === "prompt" || value === "beforeunload"
    ? value
    : "alert";
}

function attachTabListeners(tab: DaemonBrowserTab): void {
  const { page } = tab;
  page.on("console", (message) => {
    pushConsole(tab, {
      level: message.type(),
      message: truncateLogText(message.text()),
      source: message.location().url || undefined,
      line: message.location().lineNumber || undefined,
      timestamp: Date.now(),
    });
  });
  page.on("pageerror", (error) => {
    pushConsole(tab, {
      level: "error",
      message: truncateLogText(error instanceof Error ? error.message : String(error)),
      timestamp: Date.now(),
    });
  });
  page.on("request", (request) => {
    tab.pendingRequests.set(request, Date.now());
  });
  const finishRequest = (request: Request, response: Response | null, failed: boolean) => {
    const startTime = tab.pendingRequests.get(request) ?? Date.now();
    tab.pendingRequests.delete(request);
    pushNetwork(tab, {
      url: request.url(),
      method: request.method(),
      ...(response ? { status: response.status() } : {}),
      type: request.resourceType(),
      startTime,
      duration: Date.now() - startTime,
      failed,
    });
  };
  page.on("response", (response) => {
    if (response.status() >= 400) {
      finishRequest(response.request(), response, false);
    } else {
      tab.pendingRequests.delete(response.request());
    }
  });
  page.on("requestfailed", (request) => {
    finishRequest(request, null, true);
  });
  page.on("dialog", (dialog: Dialog) => {
    tab.dialogs.push({
      type: toDialogType(dialog.type()),
      message: truncateLogText(dialog.message()),
      ...(dialog.defaultValue().length > 0 ? { defaultValue: dialog.defaultValue() } : {}),
      action: "dismissed",
      timestamp: Date.now(),
    });
    void dialog.dismiss().catch(() => undefined);
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      invalidateSnapshot(tab);
    }
  });
}

function pushConsole(tab: DaemonBrowserTab, entry: VerifyConsoleEntry): void {
  tab.consoleEntries.push(entry);
  if (tab.consoleEntries.length > MAX_VERIFY_LOG_ENTRIES) {
    tab.consoleEntries.splice(0, tab.consoleEntries.length - MAX_VERIFY_LOG_ENTRIES);
  }
}

function pushNetwork(tab: DaemonBrowserTab, entry: VerifyNetworkEntry): void {
  tab.networkEntries.push(entry);
  if (tab.networkEntries.length > MAX_VERIFY_LOG_ENTRIES) {
    tab.networkEntries.splice(0, tab.networkEntries.length - MAX_VERIFY_LOG_ENTRIES);
  }
}

function truncateLogText(text: string): string {
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
}

async function withKeyboardModifiers(
  page: Page,
  modifiers: readonly string[],
  action: () => Promise<void>,
): Promise<void> {
  for (const modifier of modifiers) {
    await page.keyboard.down(modifier);
  }
  try {
    await action();
  } finally {
    for (const modifier of modifiers.toReversed()) {
      await page.keyboard.up(modifier);
    }
  }
}

function truncateErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
    : message;
}

function sanitizeProfileSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
  return sanitized.length > 0 ? sanitized : "profile";
}

function isSandboxLaunchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /sandbox|zygote|namespace|no-sandbox/i.test(message);
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === "TimeoutError" || /timeout|exceeded/i.test(error.message);
}

export function consoleErrors(entries: readonly VerifyConsoleEntry[]): VerifyConsoleEntry[] {
  return entries.filter((entry) => entry.level === "error");
}

export function failedNetworkRequests(
  entries: readonly VerifyNetworkEntry[],
): VerifyNetworkEntry[] {
  return entries.filter(
    (entry) => entry.failed || (entry.status !== undefined && entry.status >= 400),
  );
}
