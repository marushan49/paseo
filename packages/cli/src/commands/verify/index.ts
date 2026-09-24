import { Command } from "commander";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { runLsCommand } from "./ls.js";
import { runRunCommand } from "./run.js";

function addWorkspaceSelectionOptions(command: Command): Command {
  return command
    .option("--cwd <path>", "Workspace directory (default: current directory)")
    .option(
      "--workspace <workspace-id>",
      "Workspace ID (required when a directory has multiple workspaces)",
    );
}

export function createVerifyCommand(): Command {
  const verify = new Command("verify").description("Run workspace verify recipes in a browser");

  addJsonAndDaemonHostOptions(
    addWorkspaceSelectionOptions(
      verify.command("ls").description("List verify recipes configured for the workspace"),
    ),
  ).action(withOutput(runLsCommand));

  addJsonAndDaemonHostOptions(
    addWorkspaceSelectionOptions(
      verify
        .command("run")
        .description("Run a verify recipe and report its checks")
        .argument("<name>")
        .option(
          "--param <name=value>",
          "Recipe parameter, repeatable",
          (value: string, previous: string[] = []) => [...previous, value],
        ),
    ),
  ).action(withOutput(runRunCommand));

  return verify;
}
