import {
  PaseoBrowserConfigRawSchema,
  PaseoVerificationConfigRawSchema,
  type PaseoBrowserConfig,
  type PaseoVerificationConfig,
} from "@getpaseo/protocol/paseo-config-schema";
import type {
  SessionOutboundMessage,
  VerifyRecipeListRequest,
  VerifyRecipeRunRequest,
} from "@getpaseo/protocol/messages";
import type { VerifyRecipeSummary } from "@getpaseo/protocol/verify/rpc-schemas";

import { assertWorkspaceAutomationAllowedForWorkspace } from "../workspace-automation-gate.js";
import type { WorkspaceRegistry } from "../workspace-registry.js";
import type { WorkspaceScriptsService } from "../session/workspace-scripts/workspace-scripts-service.js";
import type { WorkspaceScriptPayload } from "@getpaseo/protocol/messages";
import { readPaseoConfigJson } from "../../utils/paseo-config-file.js";
import type { EvidenceStore } from "./evidence-store.js";
import type { DaemonPlaywrightHost } from "./playwright-host.js";
import { RecipeRunner } from "./recipe-runner.js";

export interface VerifySessionOptions {
  workspaceRegistry: Pick<WorkspaceRegistry, "get">;
  workspaceScripts: Pick<WorkspaceScriptsService, "list">;
  host: Pick<DaemonPlaywrightHost, "executeLocal">;
  evidence: EvidenceStore;
  isBrowserToolsEnabled: () => boolean;
  emit: (message: SessionOutboundMessage) => void;
}

interface RecipeConfig {
  browser: PaseoBrowserConfig;
  verification: PaseoVerificationConfig;
}

function toRecipeSummary(
  name: string,
  recipe: PaseoVerificationConfig["recipes"][string],
): VerifyRecipeSummary {
  const summary: VerifyRecipeSummary = {
    name,
    params: recipe.params ?? [],
    stepCount: recipe.steps.length,
  };
  if (recipe.profile) {
    summary.profile = recipe.profile;
  }
  return summary;
}

export class VerifySession {
  private readonly workspaceRegistry: Pick<WorkspaceRegistry, "get">;
  private readonly workspaceScripts: Pick<WorkspaceScriptsService, "list">;
  private readonly runner: RecipeRunner;
  private readonly isBrowserToolsEnabled: () => boolean;
  private readonly emit: (message: SessionOutboundMessage) => void;

  public constructor(options: VerifySessionOptions) {
    this.workspaceRegistry = options.workspaceRegistry;
    this.workspaceScripts = options.workspaceScripts;
    this.isBrowserToolsEnabled = options.isBrowserToolsEnabled;
    this.emit = options.emit;
    this.runner = new RecipeRunner({
      host: options.host,
      evidence: options.evidence,
      resolveServiceUrl: ({ workspaceId, service }) => this.resolveServiceUrl(workspaceId, service),
    });
  }

  public async handleListRequest(request: VerifyRecipeListRequest): Promise<void> {
    try {
      this.requireBrowserTools();
      await assertWorkspaceAutomationAllowedForWorkspace(
        this.workspaceRegistry,
        request.workspaceId,
      );
      const config = await this.loadRecipeConfig(request.workspaceId);
      const recipes: VerifyRecipeSummary[] = Object.entries(config.verification.recipes).map(
        ([name, recipe]) => toRecipeSummary(name, recipe),
      );
      this.emit({
        type: "verify.recipe.list.response",
        payload: {
          requestId: request.requestId,
          workspaceId: request.workspaceId,
          recipes,
          error: null,
        },
      });
    } catch (error) {
      this.emit({
        type: "verify.recipe.list.response",
        payload: {
          requestId: request.requestId,
          workspaceId: request.workspaceId,
          recipes: [],
          error: error instanceof Error ? error.message : "Failed to list verification recipes",
        },
      });
    }
  }

  public async handleRunRequest(request: VerifyRecipeRunRequest): Promise<void> {
    try {
      this.requireBrowserTools();
      await assertWorkspaceAutomationAllowedForWorkspace(
        this.workspaceRegistry,
        request.workspaceId,
      );
      const config = await this.loadRecipeConfig(request.workspaceId);
      const result = await this.runner.run({
        workspaceId: request.workspaceId,
        browser: config.browser,
        verification: config.verification,
        recipeName: request.recipeName,
        params: request.params,
      });
      this.emit({
        type: "verify.recipe.run.response",
        payload: {
          requestId: request.requestId,
          workspaceId: request.workspaceId,
          result: {
            status: result.status,
            recipe: result.recipe,
            workspaceId: result.workspaceId,
            runId: result.runId,
            profile: result.profile,
            authReused: result.authReused,
            route: result.route,
            checks: result.checks,
            consoleErrors: result.consoleErrors,
            failedRequests: result.failedRequests,
            evidenceRef: result.evidenceRef,
            rawBytes: result.rawBytes,
            agentBytes: result.agentBytes,
            ...(result.error ? { error: result.error } : {}),
          },
          error: null,
        },
      });
    } catch (error) {
      this.emit({
        type: "verify.recipe.run.response",
        payload: {
          requestId: request.requestId,
          workspaceId: request.workspaceId,
          result: null,
          error: error instanceof Error ? error.message : "Verification run failed",
        },
      });
    }
  }

  private requireBrowserTools(): void {
    if (!this.isBrowserToolsEnabled()) {
      throw new Error(
        "Verification recipes need browser tools: set daemon.browserTools.enabled to true and reload.",
      );
    }
  }

  private async loadRecipeConfig(workspaceId: string): Promise<RecipeConfig> {
    const workspace = await this.workspaceRegistry.get(workspaceId);
    if (!workspace) {
      throw new Error(`Unknown workspace "${workspaceId}"`);
    }
    const raw = readPaseoConfigJson(workspace.cwd) as {
      browser?: unknown;
      verification?: unknown;
    } | null;
    const browser = PaseoBrowserConfigRawSchema.safeParse(raw?.browser ?? {});
    if (!browser.success) {
      throw new Error(`Invalid browser config: ${browser.error.issues[0]?.message ?? "unknown"}`);
    }
    const verification = PaseoVerificationConfigRawSchema.safeParse(raw?.verification ?? {});
    if (!verification.success) {
      throw new Error(
        `Invalid verification config: ${verification.error.issues[0]?.message ?? "unknown"}`,
      );
    }
    return { browser: browser.data, verification: verification.data };
  }

  private async resolveServiceUrl(workspaceId: string, service: string): Promise<string | null> {
    const scripts = await this.workspaceScripts.list(workspaceId);
    const matches = scripts.filter((script) => script.scriptName === service);
    const running = matches.find((script) => isUsableService(script));
    const candidate = running ?? matches[0];
    return candidate?.proxyUrl ?? candidate?.localProxyUrl ?? null;
  }
}

function isUsableService(script: WorkspaceScriptPayload): boolean {
  return script.type === "service" && script.lifecycle === "running";
}
