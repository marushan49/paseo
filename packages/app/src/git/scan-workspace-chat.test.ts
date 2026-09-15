import { describe, expect, it, vi } from "vitest";
import { scanTranscriptForPullRequests } from "./scan-workspace-chat";
import type { RelatedPullRequest } from "./related-pull-requests";

function pr(number: number): RelatedPullRequest {
  return {
    number,
    url: `https://github.com/o/r/pull/${number}`,
    title: `PR ${number}`,
    state: "open",
    origin: "manual",
  };
}

describe("scanTranscriptForPullRequests", () => {
  it("extracts refs from message text and tool output alike", async () => {
    const resolveNumber = vi.fn(async (number: number) => pr(number));
    const result = await scanTranscriptForPullRequests({
      entries: [
        { kind: "assistant_message", text: "Opened #1371 for the acceptance run" },
        { kind: "tool", detail: { content: "https://github.com/o/r/pull/1346 merged" } },
      ],
      resolveNumber,
    });
    expect(result.mentioned).toEqual([1346, 1371]);
    expect(result.attached.map((entry) => entry.number)).toEqual([1346, 1371]);
  });

  it("keeps only forge-confirmed numbers", async () => {
    const resolveNumber = vi.fn(async (number: number) => (number === 1371 ? pr(number) : null));
    const result = await scanTranscriptForPullRequests({
      entries: [{ text: "see #1371 and #9999" }],
      resolveNumber,
    });
    expect(result.mentioned).toEqual([1371, 9999]);
    expect(result.attached.map((entry) => entry.number)).toEqual([1371]);
  });

  it("tolerates failing lookups", async () => {
    const resolveNumber = vi.fn(async () => {
      throw new Error("offline");
    });
    const result = await scanTranscriptForPullRequests({
      entries: [{ text: "#1371" }],
      resolveNumber,
    });
    expect(result.attached).toEqual([]);
  });

  it("finds nothing in an empty transcript", async () => {
    const resolveNumber = vi.fn();
    const result = await scanTranscriptForPullRequests({ entries: [], resolveNumber });
    expect(result).toEqual({ mentioned: [], attached: [] });
    expect(resolveNumber).not.toHaveBeenCalled();
  });
});
