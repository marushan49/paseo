import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";

import { EvidenceStore } from "./evidence-store.js";
import { DaemonPlaywrightHost } from "./playwright-host.js";
import { VerifySession } from "./verify-session.js";
import type { PersistedWorkspaceRecord } from "../workspace-registry.js";
import { resolveBrowserExecutable } from "./browser-capability.js";
import {
  FIXTURE_PASSWORD,
  FIXTURE_USERNAME,
  startVerifyFixtureApp,
} from "./fixtures/verify-fixture-app.js";

const tempDirs: string[] = [];

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function stubHost(): Pick<DaemonPlaywrightHost, "executeLocal"> {
  return {
    executeLocal: async () => {
      throw new Error("browser not available in this test");
    },
  };
}

function workspaceRecord(cwd: string): PersistedWorkspaceRecord {
  return { cwd } as PersistedWorkspaceRecord;
}

describe("VerifySession without a browser", () => {
  it("refuses to list recipes when browser tools are disabled", async () => {
    const messages: SessionOutboundMessage[] = [];
    const session = new VerifySession({
      workspaceRegistry: { get: async () => null },
      workspaceScripts: { list: async () => [] },
      host: stubHost(),
      evidence: new EvidenceStore({ paseoHome: makeDir("paseo-verify-session-test-") }),
      isBrowserToolsEnabled: () => false,
      emit: (message) => messages.push(message),
    });

    await session.handleListRequest({
      type: "verify.recipe.list.request",
      workspaceId: "wks_1",
      requestId: "req_1",
    });

    expect(messages).toHaveLength(1);
    const response = messages[0];
    expect(response.type).toBe("verify.recipe.list.response");
    if (response.type === "verify.recipe.list.response") {
      expect(response.payload.recipes).toEqual([]);
      expect(response.payload.error).toContain("browser tools");
    }
  });

  it("reports unknown workspaces instead of running", async () => {
    const messages: SessionOutboundMessage[] = [];
    const session = new VerifySession({
      workspaceRegistry: { get: async () => null },
      workspaceScripts: { list: async () => [] },
      host: stubHost(),
      evidence: new EvidenceStore({ paseoHome: makeDir("paseo-verify-session-test-") }),
      isBrowserToolsEnabled: () => true,
      emit: (message) => messages.push(message),
    });

    await session.handleRunRequest({
      type: "verify.recipe.run.request",
      workspaceId: "wks_missing",
      recipeName: "verify-case-report",
      requestId: "req_2",
    });

    const response = messages[0];
    expect(response.type).toBe("verify.recipe.run.response");
    if (response.type === "verify.recipe.run.response") {
      expect(response.payload.result).toBeNull();
      expect(response.payload.error).toContain("wks_missing");
    }
  });

  it("lists recipes declared in the workspace paseo.json", async () => {
    const workspaceDir = makeDir("paseo-verify-workspace-");
    writeFileSync(
      join(workspaceDir, "paseo.json"),
      JSON.stringify({
        verification: {
          recipes: {
            "verify-case-report": {
              params: ["caseId"],
              steps: [{ action: "assert-console-errors", max: 0 }],
            },
          },
        },
      }),
    );
    const messages: SessionOutboundMessage[] = [];
    const session = new VerifySession({
      workspaceRegistry: { get: async () => workspaceRecord(workspaceDir) },
      workspaceScripts: { list: async () => [] },
      host: stubHost(),
      evidence: new EvidenceStore({ paseoHome: makeDir("paseo-verify-session-test-") }),
      isBrowserToolsEnabled: () => true,
      emit: (message) => messages.push(message),
    });

    await session.handleListRequest({
      type: "verify.recipe.list.request",
      workspaceId: "wks_1",
      requestId: "req_3",
    });

    const response = messages[0];
    expect(response.type).toBe("verify.recipe.list.response");
    if (response.type === "verify.recipe.list.response") {
      expect(response.payload.error).toBeNull();
      expect(response.payload.recipes).toEqual([
        { name: "verify-case-report", params: ["caseId"], stepCount: 1 },
      ]);
    }
  });

  it("returns a compact failure for unknown recipes", async () => {
    const workspaceDir = makeDir("paseo-verify-workspace-");
    writeFileSync(
      join(workspaceDir, "paseo.json"),
      JSON.stringify({ verification: { recipes: {} } }),
    );
    const messages: SessionOutboundMessage[] = [];
    const session = new VerifySession({
      workspaceRegistry: { get: async () => workspaceRecord(workspaceDir) },
      workspaceScripts: { list: async () => [] },
      host: stubHost(),
      evidence: new EvidenceStore({ paseoHome: makeDir("paseo-verify-session-test-") }),
      isBrowserToolsEnabled: () => true,
      emit: (message) => messages.push(message),
    });

    await session.handleRunRequest({
      type: "verify.recipe.run.request",
      workspaceId: "wks_1",
      recipeName: "missing",
      requestId: "req_4",
    });

    const response = messages[0];
    expect(response.type).toBe("verify.recipe.run.response");
    if (response.type === "verify.recipe.run.response") {
      expect(response.payload.error).toBeNull();
      expect(response.payload.result?.status).toBe("fail");
      expect(response.payload.result?.evidenceRef).toBeNull();
    }
  });
});

function isDaemonBrowserAvailable(): boolean {
  try {
    resolveBrowserExecutable();
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!isDaemonBrowserAvailable())("VerifySession with a browser", () => {
  it("runs a workspace recipe end to end through the session", async () => {
    const paseoHome = makeDir("paseo-verify-session-e2e-");
    const workspaceDir = makeDir("paseo-verify-workspace-e2e-");
    const app = await startVerifyFixtureApp();
    try {
      writeFileSync(
        join(workspaceDir, "paseo.json"),
        JSON.stringify({
          browser: {
            credentials: {
              "fixture-admin": {
                usernameEnv: "VERIFY_SESSION_EMAIL",
                passwordEnv: "VERIFY_SESSION_PASSWORD",
                allowedOrigins: [app.url],
              },
            },
          },
          verification: {
            recipes: {
              "verify-report": {
                profile: "session-e2e",
                params: [],
                steps: [
                  {
                    action: "ensure-authenticated",
                    credential: "fixture-admin",
                    login: {
                      url: `${app.url}/login`,
                      username: { role: "textbox", name: "Email" },
                      password: { role: "textbox", name: "Password" },
                      submit: { role: "button", name: "Sign in" },
                    },
                    check: {
                      url: `${app.url}/report`,
                      visible: { role: "heading", name: "Current Report" },
                    },
                  },
                  { action: "assert-console-errors", max: 0 },
                  { action: "assert-failed-requests", max: 0 },
                ],
              },
            },
          },
        }),
      );
      process.env.VERIFY_SESSION_EMAIL = FIXTURE_USERNAME;
      process.env.VERIFY_SESSION_PASSWORD = FIXTURE_PASSWORD;
      const messages: SessionOutboundMessage[] = [];
      const host = new DaemonPlaywrightHost({ paseoHome, logger: pino({ enabled: false }) });
      try {
        const session = new VerifySession({
          workspaceRegistry: { get: async () => workspaceRecord(workspaceDir) },
          workspaceScripts: { list: async () => [] },
          host,
          evidence: new EvidenceStore({ paseoHome }),
          isBrowserToolsEnabled: () => true,
          emit: (message) => messages.push(message),
        });

        await session.handleRunRequest({
          type: "verify.recipe.run.request",
          workspaceId: "wks_1",
          recipeName: "verify-report",
          requestId: "req_5",
        });

        const response = messages[0];
        expect(response.type).toBe("verify.recipe.run.response");
        if (response.type === "verify.recipe.run.response") {
          expect(response.payload.error).toBeNull();
          expect(response.payload.result?.status).toBe("pass");
          expect(response.payload.result?.evidenceRef).toMatch(/^evidence:\/\//);
        }
      } finally {
        await host.close();
      }
    } finally {
      delete process.env.VERIFY_SESSION_EMAIL;
      delete process.env.VERIFY_SESSION_PASSWORD;
      await app.close();
    }
  }, 60_000);
});
