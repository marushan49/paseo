import type { ResourcePolicyRuntime } from "../resource-policy.js";

export interface ScheduleAutomationGateInput {
  runtime: Pick<ResourcePolicyRuntime, "canStartAutomatedLoop"> | undefined;
  /**
   * The host's explicit answer for schedules, independent of the policy.
   * Undefined means "whatever the policy says".
   */
  allowScheduledAutomation: boolean | undefined;
}

/**
 * Why this host will not start any schedule, or null when it will.
 *
 * The resource policy exists to stop agents burning tokens on polling loops. A
 * schedule someone set deliberately is not that, so economy taking the daily
 * report down with it was the policy overreaching. This keeps the two decisions
 * apart: the policy sets the default, the switch has the final word in both
 * directions.
 */
export function resolveScheduleAutomationBlock(input: ScheduleAutomationGateInput): string | null {
  if (input.allowScheduledAutomation === false) {
    return "Schedules are turned off for this host.";
  }
  if (input.allowScheduledAutomation === true) {
    return null;
  }
  const decision = input.runtime?.canStartAutomatedLoop("schedules");
  if (!decision || decision.allowed) {
    return null;
  }
  return decision.reason ?? "Automated schedules are disabled by the resource policy.";
}
