import type { PersistedWorkspaceRecord } from "./workspace-registry.js";

/** What a workspace row draws, whether the daemon derived it or someone chose it. */
export interface WorkspaceSetPullRequest {
  number: number;
  url: string;
  title?: string;
  state: "open" | "merged" | "closed";
  isDraft?: boolean;
  headRefName?: string;
  baseRefName?: string;
  origin: "stack" | "branch" | "current" | "manual";
  stackIndex?: number;
}

/**
 * A workspace's change request set: what git and the forge derived, with the
 * decisions someone made about it applied.
 *
 * The daemon used to store those decisions and stop there, which made them
 * invisible: `added: [1401]` with nothing to render it from left the row saying
 * "No pull requests yet" while the number sat in the record. The facts travel
 * with the decision now, so the set survives a restart and reads the same on
 * every machine instead of only in the client that happened to resolve it.
 *
 * A removal always wins, including over a number that also appears as added.
 */
export function resolveWorkspacePullRequestSet(
  derived: readonly WorkspaceSetPullRequest[] | undefined,
  record: Pick<PersistedWorkspaceRecord, "pullRequestCuration" | "pullRequestFacts">,
): WorkspaceSetPullRequest[] {
  const curation = record.pullRequestCuration;
  const removed = new Set(curation?.removed ?? []);
  const kept = (derived ?? []).filter((pullRequest) => !removed.has(pullRequest.number));
  const present = new Set(kept.map((pullRequest) => pullRequest.number));

  const added = curation?.added ?? [];
  const factsByNumber = new Map(
    (record.pullRequestFacts ?? []).map((facts) => [facts.number, facts]),
  );
  const attached: WorkspaceSetPullRequest[] = [];
  for (const number of added) {
    if (removed.has(number) || present.has(number)) {
      continue;
    }
    const facts = factsByNumber.get(number);
    // A number with no facts is one an older client added before the daemon
    // kept them. Nothing can be drawn from it, so it stays out rather than
    // becoming a row with an empty title and no link.
    if (!facts) {
      continue;
    }
    present.add(number);
    attached.push({ ...facts, origin: "manual" });
  }

  return [...kept, ...attached];
}

/**
 * The facts a write leaves behind: what it brought, over what was already
 * there, for the numbers that are still added.
 *
 * Kept rather than replaced because a write does not have to carry everything.
 * A client that only removes one entry sends no facts at all, and a client too
 * old to send them must not be able to blank the set on its way past.
 */
export function mergeCuratedPullRequestFacts(
  existing: PersistedWorkspaceRecord["pullRequestFacts"],
  incoming: PersistedWorkspaceRecord["pullRequestFacts"],
  curation: { added: number[]; removed: number[] },
): PersistedWorkspaceRecord["pullRequestFacts"] {
  const wanted = new Set(curation.added);
  const byNumber = new Map<
    number,
    NonNullable<PersistedWorkspaceRecord["pullRequestFacts"]>[number]
  >();
  for (const facts of existing ?? []) {
    if (wanted.has(facts.number)) byNumber.set(facts.number, facts);
  }
  for (const facts of incoming ?? []) {
    if (wanted.has(facts.number)) byNumber.set(facts.number, facts);
  }
  const merged = [...byNumber.values()].sort((left, right) => left.number - right.number);
  return merged.length > 0 ? merged : null;
}

/**
 * The github runtime a workspace has purely because someone attached something
 * to it, for rows the forge never derived a set for. Returns nothing when there
 * is nothing to show, so a workspace without attachments keeps reporting no
 * runtime at all rather than an empty one.
 *
 * `featuresEnabled` is true because the set it carries is real and the row has
 * to be allowed to draw it; the absent `pullRequest` still says there is no
 * change request for a checked-out branch here.
 */
export function buildCuratedOnlyGitHubRuntime(
  record: Pick<PersistedWorkspaceRecord, "pullRequestCuration" | "pullRequestFacts">,
): { githubRuntime?: CuratedOnlyGitHubRuntime } {
  const relatedPullRequests = resolveWorkspacePullRequestSet(undefined, record);
  if (relatedPullRequests.length === 0) {
    return {};
  }
  return {
    githubRuntime: {
      featuresEnabled: true,
      pullRequest: null,
      relatedPullRequests,
      error: null,
    },
  };
}

interface CuratedOnlyGitHubRuntime {
  featuresEnabled: boolean;
  pullRequest: null;
  relatedPullRequests: WorkspaceSetPullRequest[];
  error: null;
}

/** A set entry stripped of how it got there, which is what the wire carries. */
export type CuratedPullRequestFacts = Omit<WorkspaceSetPullRequest, "origin" | "stackIndex">;

/** The facts worth storing: the ones that belong to a number someone added. */
export function selectCuratedPullRequestFacts(
  curation: { added: number[]; removed: number[] },
  facts: readonly CuratedPullRequestFacts[] | undefined,
): PersistedWorkspaceRecord["pullRequestFacts"] {
  const wanted = new Set(curation.added);
  const kept: NonNullable<PersistedWorkspaceRecord["pullRequestFacts"]> = [];
  for (const entry of facts ?? []) {
    if (!wanted.has(entry.number)) {
      continue;
    }
    // Written out field by field: the record is what a later daemon reads back,
    // so it carries the fields this schema names and nothing a client invented.
    const stored: NonNullable<PersistedWorkspaceRecord["pullRequestFacts"]>[number] = {
      number: entry.number,
      url: entry.url,
      state: entry.state,
    };
    if (entry.title !== undefined) stored.title = entry.title;
    if (entry.isDraft !== undefined) stored.isDraft = entry.isDraft;
    if (entry.headRefName !== undefined) stored.headRefName = entry.headRefName;
    if (entry.baseRefName !== undefined) stored.baseRefName = entry.baseRefName;
    kept.push(stored);
  }
  return kept.length > 0 ? kept : null;
}
