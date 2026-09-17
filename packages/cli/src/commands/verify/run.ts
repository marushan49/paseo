import type { Command } from "commander";
import type { SingleResult } from "../../output/index.js";
import { verifyRunSchema, type VerifyRunRow } from "./schema.js";
import {
  connectVerifyClient,
  parseVerifyParams,
  resolveVerifyWorkspaceId,
  toVerifyCommandError,
  type VerifyCommandOptions,
} from "./shared.js";

export async function runRunCommand(
  recipeName: string,
  options: VerifyCommandOptions,
  _command: Command,
): Promise<SingleResult<VerifyRunRow>> {
  const client = await connectVerifyClient(options.daemonTarget);
  try {
    const params = parseVerifyParams(options.param);
    const workspaceId = await resolveVerifyWorkspaceId(client, options);
    const payload = await client.runVerifyRecipe(workspaceId, recipeName, params);
    if (payload.error) {
      throw new Error(payload.error);
    }
    if (!payload.result) {
      throw new Error(`Recipe ${recipeName} returned no result`);
    }
    // A failing recipe is a failing command: scripts and CI read the exit code.
    if (payload.result.status === "fail") {
      throw {
        code: "VERIFY_RUN_FAILED",
        message: payload.result.error ?? `Recipe ${recipeName} failed`,
        details: payload.result.checks
          .filter((check) => !check.ok)
          .map((check) => `${check.name}: ${check.detail ?? "failed"}`)
          .join("\n"),
      };
    }
    return { type: "single", data: payload.result, schema: verifyRunSchema };
  } catch (error) {
    throw toVerifyCommandError("VERIFY_RUN_FAILED", `run verify recipe ${recipeName}`, error);
  } finally {
    await client.close().catch(() => {});
  }
}
