import { collectAgentTranscript, type TranscriptPageFetcher } from "./collect";
import { formatTranscriptJson, formatTranscriptMarkdown, type TranscriptFormat } from "./serialize";

export interface CopyAgentTranscriptInput {
  agentId: string;
  agentName?: string | null;
  provider?: string | null;
  workspaceName?: string | null;
  format: TranscriptFormat;
  fetchPage: TranscriptPageFetcher;
  writeToClipboard: (text: string) => Promise<void>;
  now?: () => Date;
}

export interface CopyAgentTranscriptResult {
  status: "copied" | "empty";
  truncated: boolean;
  characters: number;
}

export async function copyAgentTranscript(
  input: CopyAgentTranscriptInput,
): Promise<CopyAgentTranscriptResult> {
  const collected = await collectAgentTranscript({ fetchPage: input.fetchPage });
  if (collected.entries.length === 0) {
    return { status: "empty", truncated: collected.truncated, characters: 0 };
  }

  const source = {
    metadata: {
      agentId: input.agentId,
      agentName: input.agentName ?? null,
      provider: input.provider ?? null,
      workspaceName: input.workspaceName ?? null,
      epoch: collected.epoch,
      exportedAt: input.now?.() ?? new Date(),
      truncated: collected.truncated,
    },
    entries: collected.entries,
  };

  const text =
    input.format === "json" ? formatTranscriptJson(source) : formatTranscriptMarkdown(source);
  await input.writeToClipboard(text);

  return { status: "copied", truncated: collected.truncated, characters: text.length };
}
