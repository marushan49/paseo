import { expect } from "@playwright/test";
import { test } from "../support/fixtures";
import { expectComposerVisible } from "../support/helpers/composer";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import { gotoAppShell } from "../support/helpers/app";
import { openCommandCenter } from "../support/helpers/command-center";
import {
  createTerminalFromCommandCenter,
  expectDefaultWorkspaceActions,
  expectWorkspaceActionsAvailableThroughSearch,
  makeWorkspacePrimaryGitActionCommit,
  openWorkspaceFromCommandCenter,
} from "../support/helpers/command-center-workspace-actions";
import { seedWorkspace } from "../support/helpers/seed-client";

test("workspace actions use the Git policy and dispatch through the active workspace", async ({
  page,
}) => {
  const title = "Command Center Workspace Actions";
  const seeded = await seedWorkspace({
    repoPrefix: "command-center-workspace-actions-",
    title,
  });

  try {
    await makeWorkspacePrimaryGitActionCommit(seeded);
    await gotoAppShell(page);
    await openWorkspaceFromCommandCenter(page, seeded, title);

    const panel = await openCommandCenter(page);
    await expectDefaultWorkspaceActions(panel);
    await expectWorkspaceActionsAvailableThroughSearch(panel);
    await createTerminalFromCommandCenter(page, panel);
  } finally {
    await seeded.cleanup();
  }
});

test("moves the focused session to another workspace and follows it there", async ({ page }) => {
  test.setTimeout(120_000);
  const source = await seedMockAgentWorkspace({
    repoPrefix: "move-agent-source-",
    title: "Move source",
  });
  const target = await seedWorkspace({ repoPrefix: "move-agent-target-", title: "Move target" });
  try {
    await openAgentRoute(page, { workspaceId: source.workspaceId, agentId: source.agentId });
    const panel = await openCommandCenter(page);
    await panel.getByRole("textbox").fill("move");
    await panel.getByTestId(`command-center-move-agent-${target.workspaceId}`).click();

    await page.waitForURL((url) => url.pathname.includes(target.workspaceId), { timeout: 30_000 });
    await expect
      .poll(async () => {
        const fetched = await source.client.fetchAgent({ agentId: source.agentId });
        return fetched && { workspaceId: fetched.agent.workspaceId, cwd: fetched.agent.cwd };
      })
      .toEqual({ workspaceId: target.workspaceId, cwd: target.workspaceDirectory });
    await expectComposerVisible(page);
    await page.screenshot({ path: test.info().outputPath("moved-agent.png") });
  } finally {
    await source.cleanup();
    await target.cleanup();
  }
});
