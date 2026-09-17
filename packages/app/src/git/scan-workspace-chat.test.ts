import { describe, expect, it, vi } from "vitest";

import {
  collectPullRequestCandidates,
  scanTranscriptForPullRequests,
} from "@/git/scan-workspace-chat";
import type { RelatedPullRequest } from "@/git/related-pull-requests";

// The timeline hands back envelopes, not the items themselves: the message sits
// in `item`, with provider and sequence numbers around it. A filter written
// against the bare item silently matches nothing.
const message = (type: "user_message" | "assistant_message", text: string) => ({
  provider: "claude",
  timestamp: "2026-09-17T10:00:00.000Z",
  seqStart: 1,
  seqEnd: 1,
  item: { type, text },
});

function facts(number: number): RelatedPullRequest {
  return {
    number,
    url: `https://github.com/acme/app/pull/${number}`,
    title: `PR ${number}`,
    state: "open",
    origin: "manual",
  };
}

describe("collectPullRequestCandidates", () => {
  it("reads what was said, not what tools printed", () => {
    const candidates = collectPullRequestCandidates({
      entries: [
        message("user_message", "look at #1335"),
        {
          provider: "claude",
          item: {
            type: "tool_call",
            // Anything that is not a message is skipped, which is where the
            // noise lived: gh output, diffs, quoted logs.
            result: { output: "merged #888 and #1288 earlier today" },
          },
        },
      ] as never,
      repo: null,
    });
    expect(candidates.map((candidate) => candidate.number)).toEqual([1335]);
  });

  it("drops pull requests that belong to another repository", () => {
    const candidates = collectPullRequestCandidates({
      entries: [
        message(
          "assistant_message",
          "ours https://github.com/acme/app/pull/12 and theirs https://github.com/other/tool/pull/99",
        ),
      ] as never,
      repo: { owner: "acme", name: "app" },
    });
    expect(candidates.map((candidate) => candidate.number)).toEqual([12]);
  });

  it("ranks by how often a number was mentioned, most-discussed first", () => {
    const candidates = collectPullRequestCandidates({
      entries: [
        message("user_message", "#40 #41 #41 #41"),
        message("assistant_message", "#41 again, and #40"),
      ] as never,
      repo: null,
    });
    expect(candidates.map((candidate) => [candidate.number, candidate.mentions])).toEqual([
      [41, 4],
      [40, 2],
    ]);
  });

  it("keeps a bare ref when no repository is known", () => {
    const candidates = collectPullRequestCandidates({
      entries: [message("user_message", "see #1371")] as never,
      repo: { owner: "acme", name: "app" },
    });
    expect(candidates.map((candidate) => candidate.number)).toEqual([1371]);
  });
});

describe("scanTranscriptForPullRequests", () => {
  it("resolves candidates in parallel rather than one after another", async () => {
    let inFlight = 0;
    let peak = 0;
    const resolveNumber = vi.fn(async (number: number) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return facts(number);
    });

    const scan = await scanTranscriptForPullRequests({
      entries: [message("user_message", "#11 #12 #13 #14")] as never,
      repo: null,
      resolveNumber,
    });

    expect(scan.found.map((entry) => entry.number)).toEqual([11, 12, 13, 14]);
    expect(peak).toBeGreaterThan(1);
  });

  it("reports the numbers it could not resolve instead of dropping them silently", async () => {
    const scan = await scanTranscriptForPullRequests({
      entries: [message("user_message", "#11 and #12")] as never,
      repo: null,
      resolveNumber: async (number) => (number === 11 ? facts(11) : null),
    });
    expect(scan.found.map((entry) => entry.number)).toEqual([11]);
    expect(scan.unresolved).toEqual([12]);
  });
});
