import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import { test } from "../support/fixtures";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { waitForWorkspaceTabsVisible } from "../support/helpers/workspace-tabs";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";

const RUN_ID = "evr_deadbeef01";

async function seedEvidenceRun(workspaceId: string): Promise<void> {
  const paseoHome = process.env.E2E_PASEO_HOME;
  if (!paseoHome) {
    throw new Error("E2E_PASEO_HOME is not set");
  }
  const png = await readFile(path.resolve("public/pwa-icon-512.png"));
  const runDir = path.join(paseoHome, "artifacts", workspaceId, RUN_ID);
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, "screenshot-report.png"), png);
  const startedAt = new Date(Date.now() - 60_000).toISOString();
  await writeFile(
    path.join(runDir, "manifest.json"),
    JSON.stringify(
      {
        version: 1,
        runId: RUN_ID,
        workspaceId,
        recipe: "verify-report",
        seq: 1,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: "pass",
        agentId: "agent_e2e_anchor",
        artifacts: [
          {
            name: "screenshot-report",
            kind: "screenshot",
            fileName: "screenshot-report.png",
            contentType: "image/png",
            bytes: png.byteLength,
            sha256: createHash("sha256").update(png).digest("hex"),
            capturedAt: startedAt,
            timelineCursor: { epoch: "e1", seq: 41 },
          },
        ],
      },
      null,
      2,
    ),
  );
}

test.describe("evidence gallery", () => {
  test("shows seeded runs and opens a screenshot in the lightbox", async ({ page }) => {
    const seeded = await seedWorkspace({ repoPrefix: "paseo-e2e-evidence-" });
    try {
      await seedEvidenceRun(seeded.workspaceId);
      await page.goto(
        `${buildHostWorkspaceRoute(getServerId(), seeded.workspaceId)}?open=evidence`,
      );
      await waitForWorkspaceTabsVisible(page);

      const runFolder = page.getByTestId(`evidence-run-${RUN_ID}`);
      await expect(runFolder).toBeVisible({ timeout: 30_000 });
      await runFolder.click();
      await expect(page.getByTestId(`evidence-open-${RUN_ID}-screenshot-report`)).toBeVisible();
      await expect(page.getByTestId(`evidence-anchor-${RUN_ID}-screenshot-report`)).toBeVisible();
      await page.screenshot({ path: test.info().outputPath("evidence-gallery.png") });

      await page.getByTestId(`evidence-open-${RUN_ID}-screenshot-report`).click();
      await expect(page.getByTestId("attachment-lightbox")).toBeVisible({ timeout: 15_000 });
      await page.screenshot({ path: test.info().outputPath("evidence-lightbox.png") });
    } finally {
      await seeded.cleanup();
    }
  });
});
