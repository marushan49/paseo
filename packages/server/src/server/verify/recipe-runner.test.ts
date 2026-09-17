import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  PaseoBrowserConfig,
  PaseoVerificationConfig,
} from "@getpaseo/protocol/paseo-config-schema";

import { EvidenceStore } from "./evidence-store.js";
import { DaemonPlaywrightHost } from "./playwright-host.js";
import { RecipeRunner } from "./recipe-runner.js";
import { resolveBrowserExecutable } from "./browser-capability.js";
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
const WORKSPACE_ID = "wks_recipe_slice";

function testConfig(): { browser: PaseoBrowserConfig; verification: PaseoVerificationConfig } {
  return {
    browser: {
      defaultProfile: "recipe-test",
      credentials: {
        "fixture-admin": {
          usernameEnv: "VERIFY_SLICE_EMAIL",
          passwordEnv: "VERIFY_SLICE_PASSWORD",
          allowedOrigins: [],
        },
      },
    },
    verification: {
      recipes: {
        "verify-report": {
          profile: "recipe-test",
          params: ["caseId"],
          steps: [
            {
              action: "ensure-authenticated",
              credential: "fixture-admin",
              login: {
                service: "frontend",
                path: "/login",
                username: { role: "textbox", name: "Email" },
                password: { role: "textbox", name: "Password" },
                submit: { role: "button", name: "Sign in" },
              },
              check: {
                service: "frontend",
                path: "/report?case={{caseId}}",
                visible: { role: "heading", name: "Current Report" },
              },
            },
            { action: "assert-visible", role: "heading", name: "Current Report" },
            { action: "assert-console-errors", max: 0 },
            { action: "assert-failed-requests", max: 0 },
            { action: "screenshot", name: "report" },
          ],
        },
      },
    },
  };
}

describe.skipIf(!BROWSER_AVAILABLE)("RecipeRunner", () => {
  let paseoHome = "";
  let host!: DaemonPlaywrightHost;
  let evidence!: EvidenceStore;
  let runner!: RecipeRunner;
  let app!: VerifyFixtureApp;
  const tempDirs: string[] = [];
  const env = { VERIFY_SLICE_EMAIL: FIXTURE_USERNAME, VERIFY_SLICE_PASSWORD: FIXTURE_PASSWORD };

  beforeAll(async () => {
    paseoHome = mkdtempSync(join(tmpdir(), "paseo-recipe-test-"));
    tempDirs.push(paseoHome);
    host = new DaemonPlaywrightHost({ paseoHome, logger: pino({ enabled: false }) });
    evidence = new EvidenceStore({ paseoHome });
    app = await startVerifyFixtureApp();
    const appUrl = app.url;
    runner = new RecipeRunner({
      host,
      evidence,
      env,
      resolveServiceUrl: async ({ service }) => (service === "frontend" ? appUrl : null),
    });
  }, 60_000);

  afterAll(async () => {
    await host.close();
    await app.close();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs the full login-to-report recipe and returns a compact result", async () => {
    const config = testConfig();
    config.browser.credentials["fixture-admin"] = {
      ...config.browser.credentials["fixture-admin"],
      allowedOrigins: [app.url],
    };
    const result = await runner.run({
      workspaceId: WORKSPACE_ID,
      ...config,
      recipeName: "verify-report",
      params: { caseId: "case-1" },
    });

    expect(result.status).toBe("pass");
    expect(result.authReused).toBe(false);
    expect(result.route).toBe(`${app.url}/report?case=case-1`);
    expect(result.consoleErrors).toBe(0);
    expect(result.failedRequests).toBe(0);
    expect(result.evidenceRef).toMatch(/^evidence:\/\/wks_recipe_slice\/evr_/);
    expect(result.checks.every((check) => check.ok)).toBe(true);
    expect(result.rawBytes).toBeGreaterThan(0);
    expect(result.agentBytes).toBeGreaterThan(0);
    expect(result.agentBytes).toBeLessThan(result.rawBytes ?? Number.MAX_SAFE_INTEGER);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(FIXTURE_PASSWORD);
    expect(serialized).not.toContain(FIXTURE_USERNAME);
  });

  it("reuses the stored session on the second run", async () => {
    const config = testConfig();
    config.browser.credentials["fixture-admin"] = {
      ...config.browser.credentials["fixture-admin"],
      allowedOrigins: [app.url],
    };
    const result = await runner.run({
      workspaceId: WORKSPACE_ID,
      ...config,
      recipeName: "verify-report",
      params: { caseId: "case-1" },
    });

    expect(result.status).toBe("pass");
    expect(result.authReused).toBe(true);
  });

  it("persists redacted evidence outside the agent context", async () => {
    const config = testConfig();
    config.browser.credentials["fixture-admin"] = {
      ...config.browser.credentials["fixture-admin"],
      allowedOrigins: [app.url],
    };
    const result = await runner.run({
      workspaceId: WORKSPACE_ID,
      ...config,
      recipeName: "verify-report",
      params: { caseId: "case-2" },
    });
    expect(result.evidenceRef).not.toBeNull();

    const runId = result.runId ?? "";
    const manifest = await evidence?.getManifest({ workspaceId: WORKSPACE_ID, runId });
    const names = manifest?.artifacts.map((entry) => entry.name) ?? [];
    expect(names).toEqual(
      expect.arrayContaining(["report", "screenshot-report", "console", "network"]),
    );

    const report = await evidence?.readArtifact({
      workspaceId: WORKSPACE_ID,
      runId,
      name: "report",
    });
    const reportText = report?.data.toString("utf8") ?? "";
    expect(reportText).not.toContain(FIXTURE_PASSWORD);
    expect(reportText).not.toContain(FIXTURE_USERNAME);
  });

  it("fails closed on wrong credentials without exposing secrets", async () => {
    const config = testConfig();
    config.browser.credentials["fixture-admin"] = {
      ...config.browser.credentials["fixture-admin"],
      allowedOrigins: [app.url],
    };
    const badRunner = new RecipeRunner({
      host,
      evidence,
      env: { VERIFY_SLICE_EMAIL: FIXTURE_USERNAME, VERIFY_SLICE_PASSWORD: "wrong-password" },
      resolveServiceUrl: async () => app.url,
    });
    const result = await badRunner.run({
      workspaceId: "wks_recipe_bad_auth",
      ...config,
      recipeName: "verify-report",
      params: { caseId: "case-1" },
    });

    expect(result.status).toBe("fail");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("wrong-password");
    expect(serialized).toContain("login failed");
  });

  it("fails unknown recipes and missing services without running a browser", async () => {
    const config = testConfig();
    const unknown = await runner.run({
      workspaceId: WORKSPACE_ID,
      ...config,
      recipeName: "does-not-exist",
      params: {},
    });
    expect(unknown.status).toBe("fail");
    expect(unknown.evidenceRef).toBeNull();

    const noServiceRunner = new RecipeRunner({
      host,
      evidence,
      env,
      resolveServiceUrl: async () => null,
    });
    const missingService = await noServiceRunner.run({
      workspaceId: "wks_recipe_no_service",
      ...testConfig(),
      recipeName: "verify-report",
      params: { caseId: "case-1" },
    });
    expect(missingService.status).toBe("fail");
    expect(JSON.stringify(missingService)).toContain("frontend");
  });

  it("denies credential use outside the allowed origins", async () => {
    const config = testConfig();
    config.browser.credentials["fixture-admin"] = {
      ...config.browser.credentials["fixture-admin"],
      allowedOrigins: ["https://other.example.com"],
    };
    const result = await runner.run({
      workspaceId: "wks_recipe_origin",
      ...config,
      recipeName: "verify-report",
      params: { caseId: "case-1" },
    });

    expect(result.status).toBe("fail");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(FIXTURE_PASSWORD);
    expect(serialized).toContain("denied");
  });
});
