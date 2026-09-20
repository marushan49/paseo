import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BrowserToolsBroker } from "../browser-tools/broker.js";
import type { BrowserToolsResponsePayload } from "../browser-tools/errors.js";
import { resolveBrowserExecutable } from "./browser-capability.js";
import { DaemonPlaywrightHost } from "./playwright-host.js";
import type { BrowserAutomationCommand } from "@getpaseo/protocol/browser-automation/rpc-schemas";
import {
  FIXTURE_PASSWORD,
  FIXTURE_USERNAME,
  startVerifyFixtureApp,
  type VerifyFixtureApp,
} from "./fixtures/verify-fixture-app.js";

function isDaemonBrowserAvailable(): boolean {
  try {
    resolveBrowserExecutable();
    return true;
  } catch {
    return false;
  }
}

const BROWSER_AVAILABLE = isDaemonBrowserAvailable();
const WORKSPACE_ID = "wks_verify_slice";
const OTHER_WORKSPACE_ID = "wks_other_workspace";

describe.skipIf(!BROWSER_AVAILABLE)("DaemonPlaywrightHost", () => {
  let paseoHome = "";
  let host: DaemonPlaywrightHost | null = null;
  let app: VerifyFixtureApp | null = null;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    paseoHome = mkdtempSync(join(tmpdir(), "paseo-verify-host-test-"));
    tempDirs.push(paseoHome);
    host = new DaemonPlaywrightHost({ paseoHome, logger: pino({ enabled: false }) });
    app = await startVerifyFixtureApp();
  }, 60_000);

  afterAll(async () => {
    await host?.close();
    await app?.close();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  async function openTab(url: string, profile: string): Promise<string> {
    const created = await host?.executeLocal({
      workspaceId: WORKSPACE_ID,
      profile,
      command: { command: "new_tab", args: { url } },
    });
    const browserId =
      created?.ok && created.result.command === "new_tab" ? created.result.browserId : "";
    expect(browserId.length).toBeGreaterThan(0);
    return browserId;
  }

  async function readSnapshotYaml(browserId: string, profile: string): Promise<string> {
    const snapshot = await host?.executeLocal({
      workspaceId: WORKSPACE_ID,
      profile,
      command: { command: "snapshot", args: { browserId } },
    });
    return snapshot?.ok && snapshot.result.command === "snapshot" ? snapshot.result.snapshot : "";
  }

  async function executeTabCommand(
    command: BrowserAutomationCommand,
    profile: string,
  ): Promise<BrowserToolsResponsePayload | undefined> {
    return host?.executeLocal({ workspaceId: WORKSPACE_ID, profile, command });
  }

  it("navigates, snapshots, and exposes refs for form controls", async () => {
    const created = await host?.executeLocal({
      workspaceId: WORKSPACE_ID,
      command: { command: "new_tab", args: { url: `${app?.url}/login` } },
    });
    expect(created?.ok).toBe(true);
    const browserId = created?.ok ? created.result.browserId : "";

    const snapshot = await host?.executeLocal({
      workspaceId: WORKSPACE_ID,
      command: { command: "snapshot", args: { browserId } },
    });
    expect(snapshot?.ok).toBe(true);
    if (snapshot?.ok && snapshot.result.command === "snapshot") {
      expect(snapshot.result.format).toBe("aria-yaml");
      expect(snapshot.result.snapshot).toContain('textbox "Email" @e');
      expect(snapshot.result.snapshot).toContain('button "Sign in" @e');
      expect(snapshot.result.stats.refCount).toBeGreaterThan(0);
    } else {
      expect.unreachable();
    }
  });

  it("fills the login form and reaches the report behind auth", async () => {
    const browserId = await openTab(`${app?.url}/login`, "login-flow");

    const yaml = await readSnapshotYaml(browserId, "login-flow");
    const emailRef = refFor(yaml, "textbox", "Email");
    const passwordRef = refFor(yaml, "textbox", "Password");
    const submitRef = refFor(yaml, "button", "Sign in");
    expect([emailRef, passwordRef, submitRef].every((ref) => ref !== null)).toBe(true);

    await executeTabCommand(
      { command: "fill", args: { browserId, ref: emailRef ?? "", value: FIXTURE_USERNAME } },
      "login-flow",
    );
    await executeTabCommand(
      { command: "fill", args: { browserId, ref: passwordRef ?? "", value: FIXTURE_PASSWORD } },
      "login-flow",
    );
    // Refs expire after page-modifying actions; re-snapshot before clicking submit.
    const freshYaml = await readSnapshotYaml(browserId, "login-flow");
    const freshSubmitRef = refFor(freshYaml, "button", "Sign in");
    expect(freshSubmitRef).not.toBeNull();

    await executeTabCommand(
      {
        command: "click",
        args: {
          browserId,
          ref: freshSubmitRef ?? "",
          button: "left",
          doubleClick: false,
          modifiers: [],
        },
      },
      "login-flow",
    );
    const waited = await executeTabCommand(
      { command: "wait", args: { browserId, text: "Current Report", timeoutMs: 10_000 } },
      "login-flow",
    );
    expect(waited?.ok).toBe(true);
  });

  it("dispatches trusted coordinate pointer actions", async () => {
    const browserId = await openTab(`${app?.url}/interaction`, "pointer-flow");

    const clicked = await executeTabCommand(
      {
        command: "click",
        args: {
          browserId,
          x: 40,
          y: 30,
          button: "left",
          doubleClick: false,
          modifiers: [],
        },
      },
      "pointer-flow",
    );
    expect(clicked).toMatchObject({ ok: true, result: { command: "click", x: 40, y: 30 } });

    const hovered = await executeTabCommand(
      { command: "hover", args: { browserId, x: 260, y: 30 } },
      "pointer-flow",
    );
    expect(hovered).toMatchObject({ ok: true, result: { command: "hover", x: 260, y: 30 } });

    const dragged = await executeTabCommand(
      {
        command: "drag",
        args: {
          browserId,
          sourceX: 50,
          sourceY: 140,
          targetX: 340,
          targetY: 140,
        },
      },
      "pointer-flow",
    );
    expect(dragged).toMatchObject({
      ok: true,
      result: { command: "drag", sourceX: 50, sourceY: 140, targetX: 340, targetY: 140 },
    });

    const scrolled = await executeTabCommand(
      {
        command: "scroll",
        args: { browserId, x: 600, y: 400, deltaX: 0, deltaY: 500 },
      },
      "pointer-flow",
    );
    expect(scrolled).toMatchObject({
      ok: true,
      result: { command: "scroll", x: 600, y: 400, deltaX: 0, deltaY: 500 },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const state = await executeTabCommand(
      {
        command: "evaluate",
        args: {
          browserId,
          function:
            "return { clicked: document.body.dataset.clicked, hovered: document.body.dataset.hovered, dragged: document.body.dataset.dragged, scrollY: Math.max(window.scrollY, document.documentElement.scrollTop, document.body.scrollTop) }",
        },
      },
      "pointer-flow",
    );
    expect(state).toMatchObject({ ok: true, result: { command: "evaluate" } });
    if (state?.ok && state.result.command === "evaluate") {
      expect(JSON.parse(state.result.resultJson)).toEqual({
        clicked: "yes",
        hovered: "yes",
        dragged: "yes",
        scrollY: expect.any(Number),
      });
      expect(JSON.parse(state.result.resultJson).scrollY).toBeGreaterThan(0);
    }
  });

  it("captures console errors and failed requests without recording successes", async () => {
    const created = await host?.executeLocal({
      workspaceId: WORKSPACE_ID,
      profile: "logs-flow",
      command: { command: "new_tab", args: { url: `${app?.url}/noisy` } },
    });
    const browserId =
      created?.ok && created.result.command === "new_tab" ? created.result.browserId : "";

    await host?.executeLocal({
      workspaceId: WORKSPACE_ID,
      profile: "logs-flow",
      command: { command: "wait", args: { browserId, text: "Noisy page", timeoutMs: 10_000 } },
    });
    // Give the page a moment to emit its console error and failed fetch.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const logs = await host?.executeLocal({
      workspaceId: WORKSPACE_ID,
      profile: "logs-flow",
      command: { command: "logs", args: { browserId, maxEntries: 50 } },
    });
    expect(logs?.ok).toBe(true);
    if (logs?.ok && logs.result.command === "logs") {
      expect(logs.result.console.some((entry) => entry.message.includes("boom"))).toBe(true);
      expect(logs.result.network.some((entry) => entry.url.endsWith("/api/missing"))).toBe(true);
      expect(logs.result.network.every((entry) => entry.url.endsWith("/api/missing"))).toBe(true);
    } else {
      expect.unreachable();
    }
  });

  it("returns screenshot evidence refs instead of inline payloads", async () => {
    const created = await host?.executeLocal({
      workspaceId: WORKSPACE_ID,
      command: { command: "new_tab", args: { url: `${app?.url}/login` } },
    });
    const browserId =
      created?.ok && created.result.command === "new_tab" ? created.result.browserId : "";
    await host?.executeLocal({
      workspaceId: WORKSPACE_ID,
      command: { command: "wait", args: { browserId, text: "Sign in", timeoutMs: 10_000 } },
    });

    const screenshot = await host?.executeLocal({
      workspaceId: WORKSPACE_ID,
      command: { command: "screenshot", args: { browserId, fullPage: false } },
    });
    expect(screenshot?.ok).toBe(true);
    if (screenshot?.ok && screenshot.result.command === "screenshot") {
      expect(screenshot.result.mimeType).toBe("image/png");
      expect("dataBase64" in screenshot.result).toBe(false);
      expect(screenshot.result.evidenceRef).toMatch(/^evidence:\/\/\S+\/\S+\/screenshot$/);
      expect(screenshot.result.bytes).toBeGreaterThan(0);
      expect(screenshot.result.width).toBeGreaterThan(0);
      // Size guard: without reveal no single field may carry image bytes.
      expect(Buffer.byteLength(JSON.stringify(screenshot), "utf8")).toBeLessThan(32 * 1024);
    } else {
      expect.unreachable();
    }
  });

  it("returns inline PNG payloads only with reveal", async () => {
    const created = await host?.executeLocal({
      workspaceId: WORKSPACE_ID,
      command: { command: "new_tab", args: { url: `${app?.url}/login` } },
    });
    const browserId =
      created?.ok && created.result.command === "new_tab" ? created.result.browserId : "";
    await host?.executeLocal({
      workspaceId: WORKSPACE_ID,
      command: { command: "wait", args: { browserId, text: "Sign in", timeoutMs: 10_000 } },
    });

    const screenshot = await host?.executeLocal({
      workspaceId: WORKSPACE_ID,
      command: { command: "screenshot", args: { browserId, fullPage: false, reveal: true } },
    });
    expect(screenshot?.ok).toBe(true);
    if (screenshot?.ok && screenshot.result.command === "screenshot") {
      expect(screenshot.result.mimeType).toBe("image/png");
      expect(screenshot.result.evidenceRef).toMatch(/^evidence:\/\//);
      const bytes = Buffer.from(screenshot.result.dataBase64 ?? "", "base64");
      expect(bytes.subarray(0, 4)).toEqual(Buffer.from([137, 80, 78, 71]));
    } else {
      expect.unreachable();
    }
  });

  it("denies cross-workspace tab access", async () => {
    const created = await host?.executeLocal({
      workspaceId: WORKSPACE_ID,
      command: { command: "new_tab", args: { url: `${app?.url}/login` } },
    });
    const browserId =
      created?.ok && created.result.command === "new_tab" ? created.result.browserId : "";

    const foreign = await host?.executeLocal({
      workspaceId: OTHER_WORKSPACE_ID,
      command: { command: "snapshot", args: { browserId } },
    });
    expect(foreign?.ok).toBe(false);
    if (!foreign?.ok) {
      expect(foreign.error.code).toBe("browser_denied");
    }
  });

  it("reports unknown tabs instead of acting on them", async () => {
    const missing = await host?.executeLocal({
      workspaceId: WORKSPACE_ID,
      command: { command: "snapshot", args: { browserId: `${Date.now().toString()}-deadbeef` } },
    });
    expect(missing?.ok).toBe(false);
    if (!missing?.ok) {
      expect(missing.error.code).toBe("browser_tab_not_found");
    }
  });

  it("serves broker-routed commands through the existing wire contract", async () => {
    const broker = new BrowserToolsBroker({});
    const testHost = host;
    expect(testHost).not.toBeNull();
    if (!testHost) {
      return;
    }
    const unregister = broker.registerClient(
      testHost.asHostClient((response) => {
        broker.receiveResponse(response);
      }),
    );
    try {
      const tabs = await broker.execute({
        workspaceId: WORKSPACE_ID,
        command: { command: "list_tabs", args: {} },
      });
      expect(tabs.ok).toBe(true);

      const created = await broker.execute({
        workspaceId: WORKSPACE_ID,
        command: { command: "new_tab", args: { url: `${app?.url}/login` } },
      });
      expect(created.ok).toBe(true);
      if (created.ok && created.result.command === "new_tab") {
        const snapshot = await broker.execute({
          workspaceId: WORKSPACE_ID,
          command: { command: "snapshot", args: { browserId: created.result.browserId } },
        });
        expect(snapshot.ok).toBe(true);
      } else {
        expect.unreachable();
      }
    } finally {
      unregister();
    }
  });
});

function refFor(yaml: string, role: string, name: string): string | null {
  for (const line of yaml.split("\n")) {
    const match = new RegExp(`^- ${role} "${escapeRegExp(name)}" (@e\\d+)$`).exec(line.trim());
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
