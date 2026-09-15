import type { ForgeSearchItem } from "@getpaseo/protocol/messages";
import type { RelatedPullRequest } from "@/git/related-pull-requests";

/**
 * What the user decided about a workspace's set, on top of what the daemon
 * derived. A removal always wins — an unrelated draft that shares the
 * worktree is indistinguishable from a real one by rule, so only the user
 * can cut it. A number the user added by hand is always included once its
 * facts resolve; until the daemon persists curation itself, the facts live
 * in the ephemeral app store next to these decisions.
 *
 * Shape mirrors the future wire field (`agent.pull_requests.curate`, see
 * docs/refactors/session-pull-requests-plan.md) so the daemon can adopt it
 * without migration.
 */
export interface PullRequestCuration {
  added: number[];
  removed: number[];
}

export const EMPTY_PULL_REQUEST_CURATION: PullRequestCuration = {
  added: [],
  removed: [],
};

function normalizeNumbers(numbers: readonly number[]): number[] {
  return [...new Set(numbers.filter((number) => Number.isInteger(number) && number > 0))].sort(
    (left, right) => left - right,
  );
}

export function normalizePullRequestCuration(
  curation: Partial<PullRequestCuration> | null | undefined,
): PullRequestCuration {
  const added = normalizeNumbers(curation?.added ?? []);
  const removed = new Set(normalizeNumbers(curation?.removed ?? []));
  return {
    // A number both added and removed stays removed: cutting is the
    // deliberate act, adding may predate it.
    added: added.filter((number) => !removed.has(number)),
    removed: [...removed],
  };
}

/**
 * The row's set: the daemon's derived entries minus user removals, plus the
 * manually attached entries the store resolved. Daemon order (stack first)
 * is preserved; attached entries append in the order they were added.
 */
export function applyPullRequestCuration(
  daemonPullRequests: readonly RelatedPullRequest[],
  manuallyAdded: readonly RelatedPullRequest[],
  curation: PullRequestCuration,
): RelatedPullRequest[] {
  const removed = new Set(curation.removed);
  const kept = daemonPullRequests.filter((pullRequest) => !removed.has(pullRequest.number));
  const keptNumbers = new Set(kept.map((pullRequest) => pullRequest.number));
  const added = manuallyAdded.filter(
    (pullRequest) => !removed.has(pullRequest.number) && !keptNumbers.has(pullRequest.number),
  );
  return [...kept, ...added];
}

/**
 * A forge search hit becomes a set entry with origin "manual". Returns null
 * unless the hit is a change request in a known state — anything else cannot
 * join the row's health math.
 */
export function searchItemToRelatedPullRequest(item: ForgeSearchItem): RelatedPullRequest | null {
  if (item.kind !== "change_request") {
    return null;
  }
  // Forge search items carry the raw `gh` state ("OPEN"); the daemon's
  // derived sets arrive lowercased. Accept both so manual attach works
  // regardless of which path produced the facts.
  const state = item.state.toLowerCase();
  if (state !== "open" && state !== "merged" && state !== "closed") {
    return null;
  }
  return {
    number: item.number,
    url: item.url,
    title: item.title,
    state,
    headRefName: item.headRefName ?? undefined,
    baseRefName: item.baseRefName ?? undefined,
    origin: "manual",
  };
}
