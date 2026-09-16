import { ForgeSearchItemSchema } from "@getpaseo/protocol/messages";
import type { ForgeSearchClient } from "@/git/use-forge-search-query";
import { searchItemToRelatedPullRequest } from "@/git/pull-request-curation";
import { pullRequestCurationStore } from "@/git/pull-request-curation-store";
import type { RelatedPullRequest } from "@/git/related-pull-requests";

/**
 * Resolves a pull request number the user typed into set facts, through the
 * existing forge search RPC — no new daemon call needed. Only an exact
 * number match on a change request counts; fuzzy search hits never attach.
 * Looks in open pull requests first, then merged ones: `gh pr list` is
 * open-only, so without the second query every merged change request is
 * invisible to attach and scan.
 */
export async function resolvePullRequestForAttach(input: {
  client: ForgeSearchClient;
  cwd: string;
  number: number;
}): Promise<RelatedPullRequest> {
  const open = await searchExactPullRequest({
    client: input.client,
    cwd: input.cwd,
    query: String(input.number),
    number: input.number,
  });
  if (open) {
    return open;
  }
  const merged = await searchExactPullRequest({
    client: input.client,
    cwd: input.cwd,
    query: `${input.number} is:merged`,
    number: input.number,
  });
  if (merged) {
    return merged;
  }
  throw new AttachPullRequestNotFoundError(input.number);
}

async function searchExactPullRequest(input: {
  client: ForgeSearchClient;
  cwd: string;
  query: string;
  number: number;
}): Promise<RelatedPullRequest | null> {
  const payload = await input.client.searchForge({
    cwd: input.cwd,
    query: input.query,
    limit: 10,
    kinds: ["change_request"],
  });
  for (const item of payload.items) {
    const parsed = ForgeSearchItemSchema.safeParse(item);
    if (!parsed.success) {
      continue;
    }
    const candidate = parsed.data;
    if (candidate.kind !== "change_request" || candidate.number !== input.number) {
      continue;
    }
    const related = searchItemToRelatedPullRequest(candidate);
    if (related) {
      return related;
    }
  }
  return null;
}

export class AttachPullRequestNotFoundError extends Error {
  readonly number: number;

  constructor(number: number) {
    super(`No pull request #${number} found`);
    this.name = "AttachPullRequestNotFoundError";
    this.number = number;
  }
}

export function parseAttachPullRequestNumber(raw: string): number | null {
  const match = raw.trim().match(/^#?(\d{1,7})$/);
  if (!match) {
    return null;
  }
  const number = Number.parseInt(match[1] ?? "", 10);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/**
 * The dialog submit: validate, resolve through forge search, and record the
 * facts in the ephemeral curation store under the workspace key. Pure
 * apart from the store write, so the dialog shell stays thin and this is
 * fully testable with a fake search client.
 */
export async function submitAttachPullRequest(input: {
  client: ForgeSearchClient;
  cwd: string;
  workspaceKey: string;
  rawValue: string;
  formatInvalid: () => string;
  formatNotFound: (number: number) => string;
}): Promise<RelatedPullRequest> {
  const number = parseAttachPullRequestNumber(input.rawValue);
  if (number === null) {
    throw new Error(input.formatInvalid());
  }
  let facts: RelatedPullRequest;
  try {
    facts = await resolvePullRequestForAttach({ client: input.client, cwd: input.cwd, number });
  } catch (error) {
    if (error instanceof AttachPullRequestNotFoundError) {
      throw new Error(input.formatNotFound(number), { cause: error });
    }
    throw error;
  }
  pullRequestCurationStore.attach(input.workspaceKey, facts);
  return facts;
}
