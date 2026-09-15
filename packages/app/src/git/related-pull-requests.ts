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
}

export function summarizeRelatedPullRequests(
  pullRequests: readonly RelatedPullRequest[],
): RelatedPullRequestsSummary {
  const open = pullRequests.filter((pr) => pr.state === "open");
  let health: RelatedPullRequestsHealth = "unknown";
  if (open.some((pr) => pr.checksStatus === "failure")) {
    health = "failing";
  } else if (open.some((pr) => pr.checksStatus === "pending")) {
    health = "running";
  } else if (open.some((pr) => pr.checksStatus === "success")) {
    health = "passing";
  }
  return { total: pullRequests.length, openCount: open.length, health };
}

/**
 * One entry is what the single-change-request row already showed, so it keeps showing that and
 * nothing expands. The set only earns its own presentation once it can disagree with itself.
 */
export function shouldPresentAsSet(pullRequests: readonly RelatedPullRequest[]): boolean {
  return pullRequests.length > 1;
}

export function selectRelatedPullRequests(
  githubRuntime: WorkspaceDescriptorPayload["githubRuntime"] | undefined,
): readonly RelatedPullRequest[] {
  return githubRuntime?.relatedPullRequests ?? EMPTY;
}

/** Stable identity so a workspace without a set does not re-render its row on every tick. */
const EMPTY: readonly RelatedPullRequest[] = [];
