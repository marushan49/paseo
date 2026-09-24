import { describe, expect, test, vi } from "vitest";
import { copyAgentTranscript } from "./copy";
import type { TranscriptEntry } from "./serialize";

function entry(seq: number): TranscriptEntry {
  return {
    provider: "claude",
    item: { type: "user_message", text: `message ${seq}` },
    timestamp: "2026-09-15T09:59:00.000Z",
    seqStart: seq,
    seqEnd: seq,
    sourceSeqRanges: [],
    collapsed: [],
  } as TranscriptEntry;
}

function singlePage(entries: TranscriptEntry[]) {
  return vi.fn().mockResolvedValue({
    requestId: "req",
    agentId: "agent-1",
    agent: null,
    direction: "tail" as const,
    projection: "projected" as const,
    epoch: "epoch-1",
    reset: false,
    staleCursor: false,
    gap: false,
    window: { minSeq: 0, maxSeq: 0, nextSeq: 0 },
    startCursor: null,
    endCursor: null,
    hasOlder: false,
    hasNewer: false,
    entries,
    error: null,
  });
}

describe("copyAgentTranscript", () => {
  test("writes Markdown to the clipboard", async () => {
    const writeToClipboard = vi.fn().mockResolvedValue(undefined);

    const result = await copyAgentTranscript({
      agentId: "agent-1",
      agentName: "unusual-seahorse",
      format: "markdown",
      fetchPage: singlePage([entry(1)]),
      writeToClipboard,
      now: () => new Date("2026-09-15T10:00:00.000Z"),
    });

    expect(result.status).toBe("copied");
    const written = writeToClipboard.mock.calls[0]?.[0] as string;
    expect(written).toContain("# Agent transcript");
    expect(written).toContain("unusual-seahorse");
    expect(written).toContain("message 1");
  });

  test("writes JSON to the clipboard", async () => {
    const writeToClipboard = vi.fn().mockResolvedValue(undefined);

    await copyAgentTranscript({
      agentId: "agent-1",
      format: "json",
      fetchPage: singlePage([entry(1)]),
      writeToClipboard,
      now: () => new Date("2026-09-15T10:00:00.000Z"),
    });

    const parsed = JSON.parse(writeToClipboard.mock.calls[0]?.[0] as string);
    expect(parsed.paseoTranscriptVersion).toBe(1);
    expect(parsed.entries).toHaveLength(1);
  });

  test("reports an empty chat without touching the clipboard", async () => {
    const writeToClipboard = vi.fn().mockResolvedValue(undefined);

    const result = await copyAgentTranscript({
      agentId: "agent-1",
      format: "markdown",
      fetchPage: singlePage([]),
      writeToClipboard,
    });

    expect(result.status).toBe("empty");
    expect(writeToClipboard).not.toHaveBeenCalled();
  });
});
