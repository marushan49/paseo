import {
  PaseoBrowserConfigRawSchema,
  PaseoVerificationConfigRawSchema,
  type PaseoBrowserConfig,
  type PaseoVerificationConfig,
} from "@getpaseo/protocol/paseo-config-schema";
import type {
  SessionOutboundMessage,
  VerifyEvidenceArtifactGetRequest,
  VerifyEvidenceRunListRequest,
  VerifyRecipeListRequest,
  VerifyRecipeRunRequest,
} from "@getpaseo/protocol/messages";
import type {
  EvidenceArtifactSummary,
  EvidenceRunSummary,
  VerifyRecipeSummary,
} from "@getpaseo/protocol/verify/rpc-schemas";

import { assertWorkspaceAutomationAllowedForWorkspace } from "../workspace-automation-gate.js";
import type { WorkspaceRegistry } from "../workspace-registry.js";
import type { WorkspaceScriptsService } from "../session/workspace-scripts/workspace-scripts-service.js";
import type { WorkspaceScriptPayload } from "@getpaseo/protocol/messages";
import { readPaseoConfigJson } from "../../utils/paseo-config-file.js";
import type { EvidenceRunManifest, EvidenceStore } from "./evidence-store.js";
import type { EvidenceArtifactEntry } from "./evidence-store.js";
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

function toEvidenceRunSummary(manifest: EvidenceRunManifest): EvidenceRunSummary {
  return {
    runId: manifest.runId,
    workspaceId: manifest.workspaceId,
    recipe: manifest.recipe,
    seq: manifest.seq,
    startedAt: manifest.startedAt,
    ...(manifest.finishedAt ? { finishedAt: manifest.finishedAt } : {}),
    ...(manifest.status ? { status: manifest.status } : {}),
    ...(manifest.agentId ? { agentId: manifest.agentId } : {}),
    artifactCount: manifest.artifacts.length,
  };
}

function toEvidenceArtifactSummary(entry: EvidenceArtifactEntry): EvidenceArtifactSummary {
  return {
    name: entry.name,
    kind: entry.kind,
    contentType: entry.contentType,
    bytes: entry.bytes,
    sha256: entry.sha256,
    ...(entry.capturedAt ? { capturedAt: entry.capturedAt } : {}),
    ...(entry.timelineCursor ? { timelineCursor: entry.timelineCursor } : {}),
  };
}

export class VerifySession {
  private readonly workspaceRegistry: Pick<WorkspaceRegistry, "get">;
  private readonly workspaceScripts: Pick<WorkspaceScriptsService, "list">;
  private readonly runner: RecipeRunner;
  private readonly evidence: EvidenceStore;
  private readonly isBrowserToolsEnabled: () => boolean;
  private readonly emit: (message: SessionOutboundMessage) => void;

  public constructor(options: VerifySessionOptions) {
    this.workspaceRegistry = options.workspaceRegistry;
    this.workspaceScripts = options.workspaceScripts;
    this.isBrowserToolsEnabled = options.isBrowserToolsEnabled;
    this.emit = options.emit;
    this.evidence = options.evidence;
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

  public async handleEvidenceRunListRequest(request: VerifyEvidenceRunListRequest): Promise<void> {
    try {
      const workspace = await this.workspaceRegistry.get(request.workspaceId);
      if (!workspace) {
        throw new Error(`Unknown workspace "${request.workspaceId}"`);
      }
      const manifests = await this.evidence.listRuns(request.workspaceId);
      this.emit({
        type: "verify.evidence.run.list.response",
        payload: {
          requestId: request.requestId,
          workspaceId: request.workspaceId,
          runs: manifests.map(toEvidenceRunSummary),
          error: null,
        },
      });
    } catch (error) {
      this.emit({
        type: "verify.evidence.run.list.response",
        payload: {
          requestId: request.requestId,
          workspaceId: request.workspaceId,
          runs: [],
          error: error instanceof Error ? error.message : "Failed to list evidence runs",
        },
      });
    }
  }

  public async handleEvidenceArtifactGetRequest(
    request: VerifyEvidenceArtifactGetRequest,
  ): Promise<void> {
    try {
      const workspace = await this.workspaceRegistry.get(request.workspaceId);
      if (!workspace) {
        throw new Error(`Unknown workspace "${request.workspaceId}"`);
      }
      const found = await this.evidence.readArtifact({
        workspaceId: request.workspaceId,
        runId: request.runId,
        name: request.name,
      });
      if (!found) {
        throw new Error(`Evidence artifact not found: ${request.name}`);
      }
      this.emit({
        type: "verify.evidence.artifact.get.response",
        payload: {
          requestId: request.requestId,
          workspaceId: request.workspaceId,
          artifact: toEvidenceArtifactSummary(found.entry),
          dataBase64: found.data.toString("base64"),
          error: null,
        },
      });
    } catch (error) {
      this.emit({
        type: "verify.evidence.artifact.get.response",
        payload: {
          requestId: request.requestId,
          workspaceId: request.workspaceId,
          artifact: null,
          dataBase64: null,
          error: error instanceof Error ? error.message : "Failed to read evidence artifact",
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
