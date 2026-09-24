import type { Command } from "commander";
import type { ListResult } from "../../output/index.js";
import { verifyRecipeSchema, type VerifyRecipeRow } from "./schema.js";
import {
  connectVerifyClient,
  resolveVerifyWorkspaceId,
  toVerifyCommandError,
  type VerifyCommandOptions,
} from "./shared.js";

export async function runLsCommand(
  options: VerifyCommandOptions,
  _command: Command,
): Promise<ListResult<VerifyRecipeRow>> {
  const client = await connectVerifyClient(options.daemonTarget);
  try {
    const workspaceId = await resolveVerifyWorkspaceId(client, options);
    const payload = await client.listVerifyRecipes(workspaceId);
    if (payload.error) {
      throw new Error(payload.error);
    }
    return { type: "list", data: payload.recipes, schema: verifyRecipeSchema };
  } catch (error) {
    throw toVerifyCommandError("VERIFY_LIST_FAILED", "list verify recipes", error);
  } finally {
    await client.close().catch(() => {});
  }
}
