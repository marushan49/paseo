/**
 * Which change requests belong to the work a workspace is doing.
 *
 * A workspace resolves exactly one change request — the one whose head is the checked-out
 * branch. That is the wrong unit for a session that shipped a stack, or that fixed three
 * unrelated bugs, because the row then reports one layer's state as if it were the whole.
 *
 * The set is derived, never stored: GitHub owns stack membership and check state, so a cached
 * list goes stale the moment someone restacks. See docs/refactors/session-pull-requests-plan.md.
 */

export type RelatedPullRequestState = "open" | "merged" | "closed";
export type RelatedPullRequestChecks = "none" | "pending" | "success" | "failure";
export type RelatedPullRequestOrigin = "stack" | "branch" | "current" | "manual";

export interface RelatedPullRequestFacts {
  number: number;
  url: string;
  title?: string;
  state: RelatedPullRequestState;
  isDraft?: boolean;
  headRefName?: string;
  baseRefName?: string;
  additions?: number;
  deletions?: number;
  checksStatus?: RelatedPullRequestChecks;
}

export interface RelatedPullRequest extends RelatedPullRequestFacts {
  origin: RelatedPullRequestOrigin;
  stackIndex?: number;
}

export interface MergeRelatedPullRequestsInput {
  /** The change request of the checked-out branch, if the workspace resolved one. */
  currentNumber?: number | null;
  /** GitHub's own stack order, bottom first. Empty when the change request is unstacked. */
  stack?: readonly RelatedPullRequestFacts[];
  /** Change requests found from this session's branches. May overlap the stack. */
  branch?: readonly RelatedPullRequestFacts[];
  /** Numbers the user took out of the set. */
  removed?: readonly number[];
}

/**
 * Later sources only fill gaps. A stack entry and a branch entry for the same change request
 * describe the same thing, and the stack call is the one that knows the ordering, so it wins
 * on every field it actually carries.
 */
function mergeFacts(
  base: RelatedPullRequestFacts,
  extra: RelatedPullRequestFacts,
): RelatedPullRequestFacts {
  return {
    ...extra,
    ...base,
    title: base.title ?? extra.title,
    isDraft: base.isDraft ?? extra.isDraft,
    headRefName: base.headRefName ?? extra.headRefName,
    baseRefName: base.baseRefName ?? extra.baseRefName,
    additions: base.additions ?? extra.additions,
    deletions: base.deletions ?? extra.deletions,
    checksStatus: base.checksStatus ?? extra.checksStatus,
  };
}

export function mergeRelatedPullRequests(
  input: MergeRelatedPullRequestsInput,
): RelatedPullRequest[] {
  const removed = new Set(input.removed ?? []);
  const byNumber = new Map<number, RelatedPullRequest>();

  (input.stack ?? []).forEach((facts, index) => {
    if (removed.has(facts.number)) return;
    byNumber.set(facts.number, { ...facts, origin: "stack", stackIndex: index });
  });

  for (const facts of input.branch ?? []) {
    if (removed.has(facts.number)) continue;
    const existing = byNumber.get(facts.number);
    if (existing) {
      byNumber.set(facts.number, { ...existing, ...mergeFacts(existing, facts) });
      continue;
    }
    byNumber.set(facts.number, { ...facts, origin: "branch" });
  }

  // The checked-out branch's change request is marked so the row can point at it, but it keeps
  // the stack position it already has: being current is about where you stand, not about order.
  if (input.currentNumber != null) {
    const current = byNumber.get(input.currentNumber);
    if (current) byNumber.set(input.currentNumber, { ...current, origin: "current" });
  }

  return [...byNumber.values()].sort(compareRelatedPullRequests);
}

/**
 * Stacked entries first in stack order, because that order is the dependency order and reading
 * them out of it invites merging the wrong layer. Everything else follows by number, oldest
 * first, which is the order the session opened them in.
 */
function compareRelatedPullRequests(a: RelatedPullRequest, b: RelatedPullRequest): number {
  const aStacked = a.stackIndex !== undefined;
  const bStacked = b.stackIndex !== undefined;
  if (aStacked && bStacked) return a.stackIndex! - b.stackIndex!;
  if (aStacked) return -1;
  if (bStacked) return 1;
  return a.number - b.number;
}

interface GitHubStackApiEntry {
  number?: number;
  pull_request?: { number?: number; html_url?: string; title?: string; state?: string };
  html_url?: string;
  title?: string;
  state?: string;
}

/**
 * `gh api repos/{owner}/{repo}/stacks?pull_request=N` answers with the stack, bottom first, and
 * with `[]` when the change request is not stacked. The shape is preview-stage, so read it
 * defensively and drop entries that carry no number rather than failing the whole resolve.
 */
export function parseGitHubStackResponse(payload: unknown): number[] {
  if (!Array.isArray(payload)) return [];
  const numbers: number[] = [];
  for (const raw of payload as GitHubStackApiEntry[]) {
    const entries = Array.isArray((raw as { pull_requests?: unknown })?.pull_requests)
      ? ((raw as { pull_requests: GitHubStackApiEntry[] }).pull_requests ?? [])
      : [raw];
    for (const entry of entries) {
      const number = entry?.number ?? entry?.pull_request?.number;
      if (typeof number === "number" && Number.isFinite(number) && !numbers.includes(number)) {
        numbers.push(number);
      }
    }
  }
  return numbers;
}

interface GhPullRequestListEntry {
  number: number;
  url?: string;
  title?: string;
  state?: string;
  isDraft?: boolean;
  headRefName?: string;
  baseRefName?: string;
  additions?: number;
  deletions?: number;
  statusCheckRollup?: Array<{ conclusion?: string | null; status?: string | null }> | null;
}

/** The `--json` fields this module needs, as one list for the caller to pass to `gh`. */
export const RELATED_PULL_REQUEST_JSON_FIELDS = [
  "number",
  "url",
  "title",
  "state",
  "isDraft",
  "headRefName",
  "baseRefName",
  "additions",
  "deletions",
  "statusCheckRollup",
] as const;

function normalizeState(state: string | undefined): RelatedPullRequestState {
  const value = (state ?? "").toLowerCase();
  if (value === "merged") return "merged";
  if (value === "closed") return "closed";
  return "open";
}

/**
 * A rollup with one failure fails the change request; anything still queued leaves it pending.
 * An empty rollup means no CI ran, which is not the same as passing.
 */
export function summarizeCheckRollup(
  rollup: GhPullRequestListEntry["statusCheckRollup"],
): RelatedPullRequestChecks {
  if (!rollup || rollup.length === 0) return "none";
  let pending = false;
  for (const check of rollup) {
    const conclusion = (check.conclusion ?? "").toUpperCase();
    const status = (check.status ?? "").toUpperCase();
    if (
      conclusion === "FAILURE" ||
      conclusion === "TIMED_OUT" ||
      conclusion === "STARTUP_FAILURE"
    ) {
      return "failure";
    }
    if (status && status !== "COMPLETED") pending = true;
    if (!conclusion && !status) pending = true;
  }
  return pending ? "pending" : "success";
}

export function parseGhPullRequestList(payload: unknown): RelatedPullRequestFacts[] {
  if (!Array.isArray(payload)) return [];
  const facts: RelatedPullRequestFacts[] = [];
  for (const entry of payload as GhPullRequestListEntry[]) {
    if (typeof entry?.number !== "number" || typeof entry.url !== "string") continue;
    facts.push({
      number: entry.number,
      url: entry.url,
      ...(entry.title ? { title: entry.title } : {}),
      state: normalizeState(entry.state),
      ...(typeof entry.isDraft === "boolean" ? { isDraft: entry.isDraft } : {}),
      ...(entry.headRefName ? { headRefName: entry.headRefName } : {}),
      ...(entry.baseRefName ? { baseRefName: entry.baseRefName } : {}),
      ...(typeof entry.additions === "number" ? { additions: entry.additions } : {}),
      ...(typeof entry.deletions === "number" ? { deletions: entry.deletions } : {}),
      checksStatus: summarizeCheckRollup(entry.statusCheckRollup),
    });
  }
  return facts;
}
