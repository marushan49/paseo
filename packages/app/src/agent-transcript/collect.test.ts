import { describe, expect, test, vi } from "vitest";
import { collectAgentTranscript } from "./collect";
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

function page(input: {
  entries: TranscriptEntry[];
  hasOlder: boolean;
  epoch?: string;
  startSeq?: number;
}) {
  return {
    requestId: "req",
    agentId: "agent-1",
    agent: null,
    direction: "tail" as const,
    projection: "projected" as const,
    epoch: input.epoch ?? "epoch-1",
    reset: false,
    staleCursor: false,
    gap: false,
    window: { minSeq: 0, maxSeq: 0, nextSeq: 0 },
    startCursor: { epoch: input.epoch ?? "epoch-1", seq: input.startSeq ?? 0 },
    endCursor: null,
    hasOlder: input.hasOlder,
    hasNewer: false,
    entries: input.entries,
    error: null,
  };
}

describe("collectAgentTranscript", () => {
  test("walks backwards until history is exhausted and returns oldest first", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page({ entries: [entry(3)], hasOlder: true, startSeq: 3 }))
      .mockResolvedValueOnce(page({ entries: [entry(2)], hasOlder: true, startSeq: 2 }))
      .mockResolvedValueOnce(page({ entries: [entry(1)], hasOlder: false, startSeq: 1 }));

    const result = await collectAgentTranscript({ fetchPage });

    expect(result.entries.map((item) => item.seqStart)).toEqual([1, 2, 3]);
    expect(result.truncated).toBe(false);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage.mock.calls[0]?.[0]).toMatchObject({ direction: "tail" });
    expect(fetchPage.mock.calls[1]?.[0]).toMatchObject({ direction: "before" });
  });

  test("stops without spinning when a page claims older history but returns nothing", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page({ entries: [entry(2)], hasOlder: true, startSeq: 2 }))
      .mockResolvedValue(page({ entries: [], hasOlder: true, startSeq: 2 }));

    const result = await collectAgentTranscript({ fetchPage });

    expect(result.entries.map((item) => item.seqStart)).toEqual([2]);
    expect(result.truncated).toBe(true);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  test("marks the export truncated when the entry cap is reached", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValue(page({ entries: [entry(1), entry(2)], hasOlder: true, startSeq: 1 }));

    const result = await collectAgentTranscript({ fetchPage, maxEntries: 2 });

    expect(result.truncated).toBe(true);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  test("restarts once when the timeline is rewound mid-walk", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce(page({ entries: [entry(2)], hasOlder: true, startSeq: 2 }))
      .mockResolvedValueOnce(
        page({ entries: [entry(1)], hasOlder: true, epoch: "epoch-2", startSeq: 1 }),
      )
      .mockResolvedValueOnce(
        page({ entries: [entry(9)], hasOlder: false, epoch: "epoch-2", startSeq: 9 }),
      );

    const result = await collectAgentTranscript({ fetchPage });

    expect(result.epoch).toBe("epoch-2");
    expect(result.entries.map((item) => item.seqStart)).toEqual([9]);
    expect(result.truncated).toBe(false);
  });
});
