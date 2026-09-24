import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TypeSafeSystemOneClient } from "../browser-tools/jev-client.js";
import { EvidenceStore } from "./evidence-store.js";
import {
  FIXTURE_PASSWORD,
  FIXTURE_USERNAME,
  startVerifyFixtureApp,
  type VerifyFixtureApp,
} from "./fixtures/verify-fixture-app.js";
import { DaemonPlaywrightHost } from "./playwright-host.js";
import { RecipeRunner } from "./recipe-runner.js";

const RUN_REAL_E2E = process.env.RUN_TYPESAFE_E2E === "1";

describe.skipIf(!RUN_REAL_E2E)("Testing engine real E2E", () => {
  let app: VerifyFixtureApp;
  let host: DaemonPlaywrightHost;
  let paseoHome: string;

  beforeAll(async () => {
    paseoHome = mkdtempSync(join(tmpdir(), "paseo-engine-real-e2e-"));
    app = await startVerifyFixtureApp();
    host = new DaemonPlaywrightHost({ paseoHome, logger: pino({ enabled: false }) });
    process.env.PASEO_E2E_EMAIL = FIXTURE_USERNAME;
    process.env.PASEO_E2E_PASSWORD = FIXTURE_PASSWORD;
  }, 60_000);

  afterAll(async () => {
    delete process.env.PASEO_E2E_EMAIL;
    delete process.env.PASEO_E2E_PASSWORD;
    await host.close();
    await app.close();
    rmSync(paseoHome, { recursive: true, force: true });
  });

  it("mixes scripted steps with a live Jev goal and returns only the verdict", async () => {
    const runner = new RecipeRunner({
      host,
      evidence: new EvidenceStore({ paseoHome }),
      resolveServiceUrl: async ({ service }) => (service === "frontend" ? app.url : null),
      goal: { decisionSource: new TypeSafeSystemOneClient(), minConfidence: () => 0 },
    });
    const result = await runner.run({
      workspaceId: "wks_engine_real_e2e",
      browser: { defaultProfile: "engine-e2e", credentials: {} },
      verification: {
        recipes: {
          "login-report": {
            params: [],
            steps: [
              { action: "navigate", service: "frontend", path: "/login" },
              { action: "assert-visible", role: "heading", name: "Sign in" },
              {
                action: "goal",
                goal: "Sign in using the email and password value slots, then reach Current Report.",
                values: {
                  email: { env: "PASEO_E2E_EMAIL", description: "account email" },
                  password: { env: "PASEO_E2E_PASSWORD", description: "account password" },
                },
                verify: [{ text: "Current Report" }, { url: "/report" }],
                maxSteps: 10,
              },
              { action: "assert-visible", role: "heading", name: "Current Report" },
              { action: "screenshot", name: "report" },
            ],
          },
        },
      },
      recipeName: "login-report",
    });

    expect(result.status, JSON.stringify(result)).toBe("pass");
    expect(JSON.stringify(result)).not.toContain(FIXTURE_PASSWORD);
    expect(result.agentBytes).toBeLessThan(2_000);

    const outputPath = process.env.JEV_E2E_SCREENSHOT_PATH;
    if (outputPath) {
      const screenshot = findFile(paseoHome, ".png");
      if (screenshot) copyFileSync(screenshot, outputPath);
    }
  }, 120_000);
});

function findFile(directory: string, suffix: string): string | null {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, suffix);
      if (found) return found;
    } else if (entry.name.endsWith(suffix)) {
      return full;
    }
  }
  return null;
}
