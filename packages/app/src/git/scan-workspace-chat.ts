import type { RelatedPullRequest } from "@/git/related-pull-requests";

/** Owner and name of the repository a workspace actually sits in. */
export interface ScanRepository {
  owner: string;
  name: string;
}

export interface PullRequestCandidate {
  number: number;
  /** How often the number came up, which is the only ranking signal a scan has. */
  mentions: number;
}

export interface WorkspaceChatScan {
  candidates: PullRequestCandidate[];
  found: RelatedPullRequest[];
  /** Mentioned but not confirmed by the forge, so the caller can say why. */
  unresolved: number[];
}

/** One page of chat is small; a transcript tail is not. Bounded on purpose. */
const MAX_CANDIDATES = 50;
const RESOLVE_CONCURRENCY = 8;

const PULL_URL_PATTERN = /https?:\/\/[^\s/]+\/([^\s/]+)\/([^\s/]+)\/pull\/(\d{1,7})/g;
const BARE_REF_PATTERN = /(?:^|[^\w/#])#(\d{2,7})(?![\w/])/g;

/**
 * Pull request numbers a conversation actually talked about.
 *
 * Only what was said counts. Serialising the whole timeline and scanning that
 * swept up every number a tool ever printed -- merge output, quoted diffs, `gh`
 * listings -- and a session that merely mentioned an old ticket came back with
 * dozens of unrelated pull requests. A number in someone's sentence is a claim
 * about this work; a number in a command's output is not.
 */
export function collectPullRequestCandidates(input: {
  entries: readonly unknown[];
  repo: ScanRepository | null;
}): PullRequestCandidate[] {
  const mentions = new Map<number, number>();
  const count = (number: number) => {
    if (mentions.size >= MAX_CANDIDATES && !mentions.has(number)) {
      return;
    }
    mentions.set(number, (mentions.get(number) ?? 0) + 1);
  };

  for (const entry of input.entries) {
    const text = messageText(entry);
    if (text === null) {
      continue;
    }
    const foreign = new Set<number>();
    PULL_URL_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PULL_URL_PATTERN.exec(text)) !== null) {
      const number = Number.parseInt(match[3] ?? "", 10);
      if (!Number.isSafeInteger(number) || number <= 0) {
        continue;
      }
      // A link naming another repository is evidence against the number, not
      // for it: attaching it would put someone else's pull request on this row.
      if (input.repo && !sameRepo(input.repo, match[1], match[2])) {
        foreign.add(number);
        continue;
      }
      count(number);
    }
    BARE_REF_PATTERN.lastIndex = 0;
    while ((match = BARE_REF_PATTERN.exec(text)) !== null) {
      const number = Number.parseInt(match[1] ?? "", 10);
      if (Number.isSafeInteger(number) && number > 0 && !foreign.has(number)) {
        count(number);
      }
    }
  }

  return [...mentions.entries()]
    .map(([number, seen]) => ({ number, mentions: seen }))
    .sort((left, right) => right.mentions - left.mentions || left.number - right.number);
}

/**
 * Candidates plus whatever the forge confirms about them. Lookups run in
 * parallel: they are independent round trips, and doing them one at a time made
 * a scan of two dozen numbers take longer than reading the chat by hand.
 */
export async function scanTranscriptForPullRequests(input: {
  entries: readonly unknown[];
  repo: ScanRepository | null;
  resolveNumber: (number: number) => Promise<RelatedPullRequest | null>;
}): Promise<WorkspaceChatScan> {
  const candidates = collectPullRequestCandidates({ entries: input.entries, repo: input.repo });
  const resolved = new Map<number, RelatedPullRequest>();
  const unresolved: number[] = [];

  for (let start = 0; start < candidates.length; start += RESOLVE_CONCURRENCY) {
    const batch = candidates.slice(start, start + RESOLVE_CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (candidate) => ({
        number: candidate.number,
        facts: await input.resolveNumber(candidate.number).catch(() => null),
      })),
    );
    for (const entry of settled) {
      if (entry.facts) {
        resolved.set(entry.number, entry.facts);
      } else {
        unresolved.push(entry.number);
      }
    }
  }

  return {
    candidates,
    found: candidates
      .map((candidate) => resolved.get(candidate.number))
      .filter((facts): facts is RelatedPullRequest => facts !== undefined),
    unresolved,
  };
}

/**
 * The timeline serves envelopes: provider, timestamps and sequence numbers
 * around an `item` that holds the message. Reading `type` off the envelope
 * matches nothing at all, and does so silently, so both shapes are accepted.
 */
function messageText(entry: unknown): string | null {
  const item = timelineItem(entry);
  if (item === null) {
    return null;
  }
  if (item.type !== "user_message" && item.type !== "assistant_message") {
    return null;
  }
  return typeof item.text === "string" ? item.text : null;
}

function timelineItem(entry: unknown): { type?: unknown; text?: unknown } | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }
  const envelope = entry as { item?: unknown; type?: unknown; text?: unknown };
  if (typeof envelope.item === "object" && envelope.item !== null) {
    return envelope.item as { type?: unknown; text?: unknown };
  }
  return envelope;
}

function sameRepo(repo: ScanRepository, owner?: string, name?: string): boolean {
  if (!owner || !name) {
    return false;
  }
  return (
    owner.toLowerCase() === repo.owner.toLowerCase() &&
    name.replace(/\.git$/, "").toLowerCase() === repo.name.toLowerCase()
  );
}
