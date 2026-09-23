import type { Command } from "commander";
import type { ListResult } from "../../output/index.js";
import { scheduleSchema } from "./schema.js";
import {
  connectScheduleClient,
  toScheduleCommandError,
  toScheduleRow,
  type ScheduleCommandOptions,
  type ScheduleRow,
} from "./shared.js";

export async function runLsCommand(
  options: ScheduleCommandOptions,
  _command: Command,
): Promise<ListResult<ScheduleRow>> {
  const { client } = await connectScheduleClient(options.daemonTarget);
  try {
    const payload = await client.scheduleList();
    if (payload.error) {
      throw new Error(payload.error);
    }
    return {
      type: "list",
      // Agent-target schedules (heartbeats) are listed too: there is no other
      // surface that shows them, and hiding them made runs unfindable.
      data: payload.schedules.map(toScheduleRow),
      schema: scheduleSchema,
    };
  } catch (error) {
    throw toScheduleCommandError("SCHEDULE_LIST_FAILED", "list schedules", error);
  } finally {
    await client.close().catch(() => {});
  }
}
