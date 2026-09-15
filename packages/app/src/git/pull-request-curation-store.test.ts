/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { pullRequestCurationStore, usePullRequestCuration } from "./pull-request-curation-store";
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

describe("pullRequestCurationStore", () => {
  it("starts empty per workspace key", () => {
    expect(pullRequestCurationStore.getCuration("srv:ws-a")).toEqual({ added: [], removed: [] });
    expect(pullRequestCurationStore.getFacts("srv:ws-a")).toEqual([]);
  });

  it("attaches facts and records the number", () => {
    pullRequestCurationStore.attach("srv:ws-b", pr(1346));
    expect(pullRequestCurationStore.getCuration("srv:ws-b")).toEqual({
      added: [1346],
      removed: [],
    });
    expect(pullRequestCurationStore.getFacts("srv:ws-b").map((entry) => entry.number)).toEqual([
      1346,
    ]);
    pullRequestCurationStore.clear("srv:ws-b");
  });

  it("removing drops facts and records the cut", () => {
    pullRequestCurationStore.attach("srv:ws-c", pr(1346));
    pullRequestCurationStore.remove("srv:ws-c", 1346);
    expect(pullRequestCurationStore.getCuration("srv:ws-c")).toEqual({
      added: [],
      removed: [1346],
    });
    expect(pullRequestCurationStore.getFacts("srv:ws-c")).toEqual([]);
    pullRequestCurationStore.clear("srv:ws-c");
  });

  it("keeps workspace keys isolated", () => {
    pullRequestCurationStore.attach("srv:ws-d", pr(1));
    expect(pullRequestCurationStore.getCuration("srv:ws-e")).toEqual({ added: [], removed: [] });
    pullRequestCurationStore.clear("srv:ws-d");
  });

  it("re-renders hooked rows when their workspace changes", () => {
    const { result } = renderHook(() => usePullRequestCuration("srv:ws-f"));
    expect(result.current.curation).toEqual({ added: [], removed: [] });
    act(() => {
      pullRequestCurationStore.attach("srv:ws-f", pr(1371));
    });
    expect(result.current.curation).toEqual({ added: [1371], removed: [] });
    expect(result.current.facts.map((entry) => entry.number)).toEqual([1371]);
    act(() => {
      pullRequestCurationStore.clear("srv:ws-f");
    });
  });

  it("does not leak curation across workspace keys", () => {
    const { result } = renderHook(() => usePullRequestCuration("srv:ws-g"));
    expect(result.current.curation).toEqual({ added: [], removed: [] });
    act(() => {
      pullRequestCurationStore.attach("srv:ws-h", pr(2));
    });
    // Same snapshot: no curation leaked across keys.
    expect(result.current.curation).toEqual({ added: [], removed: [] });
    pullRequestCurationStore.clear("srv:ws-h");
  });
});
