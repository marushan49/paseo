import { describe, expect, it } from "vitest";
import {
  ScheduleCreateRequestSchema,
  ScheduleInspectResponseSchema,
  ScheduleUpdateRequestSchema,
} from "./rpc-schemas.js";

describe("schedule RPC schemas", () => {
  it("round-trips new-agent run options on create requests", () => {
    expect(
      ScheduleCreateRequestSchema.parse({
        type: "schedule/create",
        requestId: "request-1",
        prompt: "Run the task",
        cadence: { type: "every", everyMs: 60_000 },
        target: {
          type: "new-agent",
          config: {
            provider: "claude",
            cwd: "/tmp/project",
            thinkingOptionId: "think-hard",
            archiveOnFinish: false,
            isolation: "worktree",
          },
        },
      }),
    ).toEqual({
      type: "schedule/create",
      requestId: "request-1",
      prompt: "Run the task",
      cadence: { type: "every", everyMs: 60_000 },
      target: {
        type: "new-agent",
        config: {
          provider: "claude",
          cwd: "/tmp/project",
          thinkingOptionId: "think-hard",
          archiveOnFinish: false,
          isolation: "worktree",
        },
      },
    });
  });

  it("round-trips new-agent run options on update requests", () => {
    expect(
      ScheduleUpdateRequestSchema.parse({
        type: "schedule/update",
        requestId: "request-1",
        scheduleId: "schedule-1",
        newAgentConfig: {
          thinkingOptionId: "think-hard",
          archiveOnFinish: false,
          isolation: "worktree",
        },
      }),
    ).toEqual({
      type: "schedule/update",
      requestId: "request-1",
      scheduleId: "schedule-1",
      newAgentConfig: {
        thinkingOptionId: "think-hard",
        archiveOnFinish: false,
        isolation: "worktree",
      },
    });
  });

  it("accepts an inspect response with and without a blocked reason", () => {
    const base = {
      type: "schedule/inspect/response" as const,
      payload: {
        requestId: "request-1",
        schedule: null,
        error: null,
      },
    };
    expect(
      ScheduleInspectResponseSchema.parse(base).payload.automationBlockedReason,
    ).toBeUndefined();
    expect(
      ScheduleInspectResponseSchema.parse({
        ...base,
        payload: {
          ...base.payload,
          automationBlockedReason:
            "Automated schedules is disabled by the economy resource policy.",
        },
      }).payload.automationBlockedReason,
    ).toBe("Automated schedules is disabled by the economy resource policy.");
  });
});
