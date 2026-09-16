import type { WorkspaceDescriptorPayload } from "@getpaseo/protocol/messages";

export type RelatedPullRequest = NonNullable<
  NonNullable<WorkspaceDescriptorPayload["githubRuntime"]>["relatedPullRequests"]
>[number];

/**
 * What the collapsed row reports for a set of change requests.
 *
 * `health` is the worst state across the entries that are still open. It cannot live one level
 * down: a row that shows the checked-out layer's `passed` while a sibling is red is the failure
 * this whole set exists to end. A merged layer no longer holds the row back — its checks are
 * history.
 */
export type RelatedPullRequestsHealth = "failing" | "running" | "passing" | "unknown";

export interface RelatedPullRequestsSummary {
  total: number;
  openCount: number;
  health: RelatedPullRequestsHealth;
  /**
   * Open entries per check state. The collapsed row says how many are red, not that one is:
   * "1 failed" and "6 failed" are different mornings, and the row is what decides which one
   * gets opened first.
   */
  checkCounts: RelatedPullRequestCheckCounts;
}

export interface RelatedPullRequestCheckCounts {
  failing: number;
  running: number;
  passing: number;
}

export function summarizeRelatedPullRequests(
  pullRequests: readonly RelatedPullRequest[],
): RelatedPullRequestsSummary {
  const open = pullRequests.filter((pr) => pr.state === "open");
  const checkCounts: RelatedPullRequestCheckCounts = {
    failing: open.filter((pr) => pr.checksStatus === "failure").length,
    running: open.filter((pr) => pr.checksStatus === "pending").length,
    passing: open.filter((pr) => pr.checksStatus === "success").length,
  };
  let health: RelatedPullRequestsHealth = "unknown";
  if (checkCounts.failing > 0) {
    health = "failing";
  } else if (checkCounts.running > 0) {
    health = "running";
  } else if (checkCounts.passing > 0) {
    health = "passing";
  }
  return { total: pullRequests.length, openCount: open.length, health, checkCounts };
}

/** How many entries the collapsed row's health word stands for. */
export function relatedPullRequestsHealthCount(summary: RelatedPullRequestsSummary): number {
  if (summary.health === "unknown") return 0;
  return summary.checkCounts[summary.health];
}

/**
 * One change request is still a set of one: it is the row you expand to add the second. The
 * collapsed line keeps naming that single number rather than counting to one, so nothing is
 * lost by making it the same control.
 */
export function shouldPresentAsSet(pullRequests: readonly RelatedPullRequest[]): boolean {
  return pullRequests.length > 0;
}

export function selectRelatedPullRequests(
  githubRuntime: WorkspaceDescriptorPayload["githubRuntime"] | undefined,
): readonly RelatedPullRequest[] {
  return githubRuntime?.relatedPullRequests ?? EMPTY;
}

/** Stable identity so a workspace without a set does not re-render its row on every tick. */
const EMPTY: readonly RelatedPullRequest[] = [];
