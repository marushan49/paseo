import { describe, expect, it } from "vitest";
import pino from "pino";
import { ScheduleSession } from "./schedule-session.js";
import { createStub } from "../../test-utils/class-mocks.js";
import { findByType } from "../../test-utils/session-stubs.js";
import type { SessionOutboundMessage } from "../../messages.js";
import type { ScheduleService } from "../../schedule/service.js";

function makeSession(schedule: { [K in keyof ScheduleService]?: unknown }) {
  const emitted: SessionOutboundMessage[] = [];
  const session = new ScheduleSession({
    host: { emit: (message) => emitted.push(message) },
    scheduleService: createStub<ScheduleService>({
      // Every summary the session emits asks the host whether automation is
      // blocked, so the stub answers it unless a test says otherwise.
      automationBlockedReason: () => null,
      ...schedule,
    }),
    logger: pino({ level: "silent" }),
  });
  return { session, emitted };
}

describe("ScheduleSession", () => {
  it("schedule/create returns a summary with the runs stripped", async () => {
    const stored = {
      id: "s1",
      name: null,
      prompt: "p",
      cadence: { type: "every" as const, everyMs: 1000 },
      target: { type: "agent" as const, agentId: "a" },
      status: "active" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      nextRunAt: null,
      lastRunAt: null,
      pausedAt: null,
      expiresAt: null,
      maxRuns: null,
      runs: [
        {
          id: "run-1",
          scheduledFor: "2026-01-01T00:00:00.000Z",
          startedAt: "2026-01-01T00:00:00.000Z",
          endedAt: null,
          status: "running" as const,
          agentId: null,
          output: null,
          error: null,
        },
      ],
    };
    const { session, emitted } = makeSession({ create: async () => stored });

    await session.handleScheduleCreateRequest({
      type: "schedule/create",
      requestId: "sc1",
      prompt: "p",
      cadence: { type: "every", everyMs: 1000 },
      target: { type: "agent", agentId: "a" },
    });

    const response = findByType(emitted, "schedule/create/response");
    expect(response?.payload.schedule).toBeDefined();
    expect(response?.payload.schedule).not.toHaveProperty("runs");
    expect(response?.payload.schedule.id).toBe("s1");
  });

  it("schedule/create remaps a self target to an agent target before creating", async () => {
    let received: Parameters<ScheduleService["create"]>[0] | undefined;
    const stored = {
      id: "s2",
      name: null,
      prompt: "p",
      cadence: { type: "every" as const, everyMs: 1000 },
      target: { type: "agent" as const, agentId: "agent-9" },
      status: "active" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      nextRunAt: null,
      lastRunAt: null,
      pausedAt: null,
      expiresAt: null,
      maxRuns: null,
      runs: [],
    };
    const { session, emitted } = makeSession({
      create: async (input: Parameters<ScheduleService["create"]>[0]) => {
        received = input;
        return stored;
      },
    });

    await session.handleScheduleCreateRequest({
      type: "schedule/create",
      requestId: "sc2",
      prompt: "p",
      cadence: { type: "every", everyMs: 1000 },
      target: { type: "self", agentId: "agent-9" },
    });

    expect(received?.target).toEqual({ type: "agent", agentId: "agent-9" });
    expect(findByType(emitted, "schedule/create/response")?.payload.error).toBeNull();
  });

  it("schedule/inspect carries the host blocked reason", async () => {
    const stored = {
      id: "s3",
      name: null,
      prompt: "p",
      cadence: { type: "every" as const, everyMs: 1000 },
      target: { type: "agent" as const, agentId: "agent-9" },
      status: "active" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      nextRunAt: "2026-01-01T00:01:00.000Z",
      lastRunAt: null,
      pausedAt: null,
      expiresAt: null,
      maxRuns: null,
      runs: [],
    };
    const blocked = "Automated schedules is disabled by the economy resource policy.";
    const { session, emitted } = makeSession({
      inspect: async () => stored,
      automationBlockedReason: () => blocked,
    });

    await session.handleScheduleInspectRequest({
      type: "schedule/inspect",
      requestId: "sc3",
      scheduleId: "s3",
    });

    const response = findByType(emitted, "schedule/inspect/response");
    expect(response?.payload.error).toBeNull();
    expect(response?.payload.schedule?.id).toBe("s3");
    expect(response?.payload.automationBlockedReason).toBe(blocked);
  });

  it("schedule/inspect reports a null blocked reason when nothing blocks it", async () => {
    const stored = {
      id: "s4",
      name: null,
      prompt: "p",
      cadence: { type: "every" as const, everyMs: 1000 },
      target: { type: "agent" as const, agentId: "agent-9" },
      status: "active" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      nextRunAt: null,
      lastRunAt: null,
      pausedAt: null,
      expiresAt: null,
      maxRuns: null,
      runs: [],
    };
    const { session, emitted } = makeSession({ inspect: async () => stored });

    await session.handleScheduleInspectRequest({
      type: "schedule/inspect",
      requestId: "sc4",
      scheduleId: "s4",
    });

    expect(
      findByType(emitted, "schedule/inspect/response")?.payload.automationBlockedReason,
    ).toBeNull();
  });
});
