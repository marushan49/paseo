import { describe, expect, it } from "vitest";

import { resolveScheduleAutomationBlock } from "./automation-gate.js";

const forbids = {
  canStartAutomatedLoop: () => ({
    allowed: false as const,
    policy: "economy" as const,
    reason: "Automated schedules is disabled by the economy resource policy.",
  }),
};
const allows = {
  canStartAutomatedLoop: () => ({ allowed: true as const, policy: "balanced" as const }),
};

describe("resolveScheduleAutomationBlock", () => {
  it("reports the policy's reason when nothing overrides it", () => {
    expect(
      resolveScheduleAutomationBlock({ runtime: forbids, allowScheduledAutomation: undefined }),
    ).toBe("Automated schedules is disabled by the economy resource policy.");
  });

  // The whole point: economy is about not burning tokens on polling loops, and a
  // schedule someone deliberately set is not that. Keeping it is a separate
  // decision from the policy.
  it("lets the schedules override win over a forbidding policy", () => {
    expect(
      resolveScheduleAutomationBlock({ runtime: forbids, allowScheduledAutomation: true }),
    ).toBeNull();
  });

  it("lets the override turn schedules off even under a permissive policy", () => {
    expect(
      resolveScheduleAutomationBlock({ runtime: allows, allowScheduledAutomation: false }),
    ).toBe("Schedules are turned off for this host.");
  });

  it("runs when the policy allows it and nothing overrides", () => {
    expect(
      resolveScheduleAutomationBlock({ runtime: allows, allowScheduledAutomation: undefined }),
    ).toBeNull();
  });

  it("runs when there is no policy runtime at all", () => {
    expect(
      resolveScheduleAutomationBlock({ runtime: undefined, allowScheduledAutomation: undefined }),
    ).toBeNull();
  });
});
