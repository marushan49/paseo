import type { ScheduleSummary } from "@getpaseo/protocol/schedule/types";
import { describe, expect, it } from "vitest";
import {
  formatScheduleLastRun,
  resolveSchedule,
  scheduleBucket,
  type ScheduleTargetAgent,
} from "./schedule-derivation";

const NOW = Date.parse("2026-07-02T00:00:00.000Z");
const AGENT_ID = "00000000-0000-4000-8000-000000000000";

function makeSchedule(overrides: Partial<ScheduleSummary>): ScheduleSummary {
  return {
    id: "schedule-1",
    name: "Nightly",
    prompt: "Run the task",
    cadence: { type: "every", everyMs: 60_000 },
    target: { type: "new-agent", config: { provider: "codex", cwd: "/tmp/project" } },
    status: "active",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    nextRunAt: "2026-07-02T01:00:00.000Z",
    lastRunAt: null,
    pausedAt: null,
    expiresAt: null,
    maxRuns: null,
    ...overrides,
  };
}

function resolve(
  schedule: ScheduleSummary,
  options?: {
    agents?: Array<[string, ScheduleTargetAgent]>;
    projects?: Array<[string, string]>;
    agentDataLoaded?: boolean;
  },
) {
  return resolveSchedule({
    schedule,
    serverId: "host-1",
    now: NOW,
    agentsByKey: new Map(options?.agents ?? []),
    projectNameByCwd: new Map(options?.projects ?? []),
    agentDataLoaded: options?.agentDataLoaded ?? true,
  });
}

describe("resolveSchedule state", () => {
  it("keeps active and paused schedules runnable", () => {
    expect(resolve(makeSchedule({ status: "active" })).state).toBe("active");
    expect(resolve(makeSchedule({ status: "paused" })).state).toBe("paused");
    expect(scheduleBucket("active")).toBe("runnable");
    expect(scheduleBucket("paused")).toBe("runnable");
  });

  it("treats a past expiresAt as expired regardless of status", () => {
    const result = resolve(
      makeSchedule({ status: "active", expiresAt: "2026-07-01T00:00:00.000Z" }),
    );
    expect(result.state).toBe("expired");
    expect(result.bucket).toBe("ended");
  });

  it("ignores an unparseable expiresAt", () => {
    expect(resolve(makeSchedule({ expiresAt: "not-a-date" })).state).toBe("active");
  });

  it("derives finished only from completed-and-not-expired", () => {
    expect(resolve(makeSchedule({ status: "completed" })).state).toBe("finished");
    expect(
      resolve(makeSchedule({ status: "completed", expiresAt: "2026-07-01T00:00:00.000Z" })).state,
    ).toBe("expired");
  });

  it("marks an agent target gone when the client has no such agent", () => {
    const schedule = makeSchedule({ target: { type: "agent", agentId: AGENT_ID } });
    expect(resolve(schedule).state).toBe("targetGone");
    expect(resolve(schedule).bucket).toBe("ended");
  });

  it("does not claim gone before the agent directory has loaded", () => {
    const schedule = makeSchedule({ target: { type: "agent", agentId: AGENT_ID } });
    expect(resolve(schedule, { agentDataLoaded: false }).state).toBe("active");
  });

  it("prefers target-gone over the raw paused/completed status for a live agent target", () => {
    const paused = makeSchedule({
      status: "paused",
      target: { type: "agent", agentId: AGENT_ID },
    });
    expect(resolve(paused).state).toBe("targetGone");
  });

  it("never claims a new-agent cwd is gone", () => {
    expect(resolve(makeSchedule({ status: "active" })).state).toBe("active");
  });
});

describe("resolveSchedule target line", () => {
  it("names an agent target by its client title and provider", () => {
    const schedule = makeSchedule({ target: { type: "agent", agentId: AGENT_ID } });
    const result = resolve(schedule, {
      agents: [[`host-1:${AGENT_ID}`, { title: "Fix build", provider: "claude" }]],
    });
    expect(result.target).toEqual({ label: "Fix build", provider: "claude" });
    expect(result.state).toBe("active");
  });

  it("falls back to Untitled agent when the agent has no title", () => {
    const schedule = makeSchedule({ target: { type: "agent", agentId: AGENT_ID } });
    const result = resolve(schedule, {
      agents: [[`host-1:${AGENT_ID}`, { title: "  ", provider: "codex" }]],
    });
    expect(result.target.label).toBe("Untitled agent");
  });

  it("labels a gone agent target as unavailable with no glyph", () => {
    const schedule = makeSchedule({ target: { type: "agent", agentId: AGENT_ID } });
    expect(resolve(schedule).target).toEqual({ label: "Agent unavailable", provider: null });
  });

  it("names a new-agent cwd by matched project, else the shortened path", () => {
    const matched = makeSchedule({
      target: { type: "new-agent", config: { provider: "codex", cwd: "/tmp/project" } },
    });
    expect(resolve(matched, { projects: [["host-1:/tmp/project", "My Project"]] }).target).toEqual({
      label: "My Project",
      provider: "codex",
    });

    const unmatched = makeSchedule({
      target: { type: "new-agent", config: { provider: "codex", cwd: "/Users/alex/work/api" } },
    });
    expect(resolve(unmatched).target).toEqual({ label: "~/work/api", provider: "codex" });
  });
});

describe("formatScheduleLastRun", () => {
  it("says a schedule has never run when nothing ran", () => {
    expect(formatScheduleLastRun(makeSchedule({ lastRunAt: null }))).toBe("Never run");
  });

  it("names the failure, so a schedule that fires and breaks cannot read as healthy", () => {
    const label = formatScheduleLastRun(
      makeSchedule({
        lastRunAt: "2026-07-01T23:00:00.000Z",
        lastRun: {
          id: "run-1",
          scheduledFor: "2026-07-01T23:00:00.000Z",
          startedAt: "2026-07-01T23:00:00.000Z",
          endedAt: "2026-07-01T23:01:00.000Z",
          status: "failed",
          agentId: null,
          workspaceId: "wks_1",
          error: "provider overloaded",
        },
      }),
    );
    expect(label).toContain("Last run failed");
  });

  it("reports a plain last run when it succeeded", () => {
    const label = formatScheduleLastRun(
      makeSchedule({
        lastRunAt: "2026-07-01T23:00:00.000Z",
        lastRun: {
          id: "run-1",
          scheduledFor: "2026-07-01T23:00:00.000Z",
          startedAt: "2026-07-01T23:00:00.000Z",
          endedAt: "2026-07-01T23:01:00.000Z",
          status: "succeeded",
          agentId: null,
          workspaceId: "wks_1",
          error: null,
        },
      }),
    );
    expect(label).toContain("Last run");
    expect(label).not.toContain("failed");
  });

  it("falls back to the bare timestamp when the daemon sends no run outcome", () => {
    const label = formatScheduleLastRun(makeSchedule({ lastRunAt: "2026-07-01T23:00:00.000Z" }));
    expect(label).toContain("Last run");
    expect(label).not.toContain("failed");
  });
});

// A resource policy that forbids automated loops stops the daemon's tick before
// it looks at any schedule. Nothing about the stored record changes, so without
// this the row keeps promising a next run that will never come.
describe("resolveSchedule with automation blocked", () => {
  const blocked = "Automated schedules is disabled by the economy resource policy.";

  it("reports blocked instead of active", () => {
    const resolved = resolve(makeSchedule({ automationBlockedReason: blocked }));
    expect(resolved.state).toBe("blocked");
    expect(resolved.bucket).toBe("runnable");
  });

  it("does not hide a paused, expired or finished schedule behind the block", () => {
    expect(
      resolve(makeSchedule({ status: "paused", automationBlockedReason: blocked })).state,
    ).toBe("paused");
    expect(
      resolve(makeSchedule({ status: "completed", automationBlockedReason: blocked })).state,
    ).toBe("finished");
    expect(
      resolve(
        makeSchedule({ expiresAt: "2026-07-01T00:00:00.000Z", automationBlockedReason: blocked }),
      ).state,
    ).toBe("expired");
  });

  it("stays active when nothing blocks it", () => {
    expect(resolve(makeSchedule({ automationBlockedReason: null })).state).toBe("active");
    expect(resolve(makeSchedule({})).state).toBe("active");
  });
});
