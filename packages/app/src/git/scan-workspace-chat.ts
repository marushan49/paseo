import { extractPullRequestReferences } from "@/git/pull-request-curation";
import type { RelatedPullRequest } from "@/git/related-pull-requests";

export interface WorkspaceChatScan {
  mentioned: number[];
  attached: RelatedPullRequest[];
}

/**
 * Chat scan core: pull request numbers out of raw timeline entries, resolved
 * to set facts. Entries arrive as-is (JSON covers every timeline shape, so
 * message text and tool output are scanned alike); resolution stays exact —
 * only numbers the forge confirms become entries. Fully testable with fakes;
 * the hook in `use-scan-workspace-chat.ts` owns agent lookup and toasts.
 */
export async function scanTranscriptForPullRequests(input: {
  entries: readonly unknown[];
  resolveNumber: (number: number) => Promise<RelatedPullRequest | null>;
}): Promise<WorkspaceChatScan> {
  const mentioned = extractPullRequestReferences(
    input.entries.map((entry) => JSON.stringify(entry) ?? "").join("\n"),
  );
  const attached: RelatedPullRequest[] = [];
  for (const number of mentioned) {
    const facts = await input.resolveNumber(number).catch(() => null);
    if (facts) {
      attached.push(facts);
    }
  }
  return { mentioned, attached };
}
