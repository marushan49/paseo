import { describe, expect, it } from "vitest";
import type { ForgeSearchItem } from "@getpaseo/protocol/messages";
import {
  applyPullRequestCuration,
  EMPTY_PULL_REQUEST_CURATION,
  normalizePullRequestCuration,
  searchItemToRelatedPullRequest,
  type PullRequestCuration,
} from "./pull-request-curation";
import type { RelatedPullRequest } from "./related-pull-requests";

function pr(number: number, origin: RelatedPullRequest["origin"] = "stack"): RelatedPullRequest {
  return {
    number,
    url: `https://github.com/o/r/pull/${number}`,
    title: `PR ${number}`,
    state: "open",
    origin,
  };
}

function searchItem(number: number, state = "open"): ForgeSearchItem {
  return {
    kind: "change_request",
    number,
    title: `PR ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    state,
    body: null,
    labels: [],
  };
}

describe("normalizePullRequestCuration", () => {
  it("returns empty curation for nullish input", () => {
    expect(normalizePullRequestCuration(null)).toEqual({ added: [], removed: [] });
    expect(normalizePullRequestCuration(undefined)).toEqual({ added: [], removed: [] });
    expect(normalizePullRequestCuration({})).toEqual({ added: [], removed: [] });
  });

  it("dedupes and sorts numbers", () => {
    expect(normalizePullRequestCuration({ added: [3, 1, 3], removed: [2, 2] })).toEqual({
      added: [1, 3],
      removed: [2],
    });
  });

  it("lets removal win over adding the same number", () => {
    expect(normalizePullRequestCuration({ added: [7], removed: [7] })).toEqual({
      added: [],
      removed: [7],
    });
  });

  it("drops non-positive and non-integer numbers", () => {
    expect(normalizePullRequestCuration({ added: [0, -2, 1.5, 4], removed: [Number.NaN] })).toEqual(
      { added: [4], removed: [] },
    );
  });
});

describe("applyPullRequestCuration", () => {
  const curation: PullRequestCuration = EMPTY_PULL_REQUEST_CURATION;

  it("keeps the daemon list untouched without curation", () => {
    expect(applyPullRequestCuration([pr(1), pr(2)], [], curation)).toEqual([pr(1), pr(2)]);
  });

  it("removes user-cut entries and keeps daemon order", () => {
    const result = applyPullRequestCuration([pr(1), pr(2), pr(3)], [], {
      added: [],
      removed: [2],
    });
    expect(result.map((entry) => entry.number)).toEqual([1, 3]);
  });

  it("appends manually attached entries after the daemon list", () => {
    const result = applyPullRequestCuration([pr(1)], [pr(9, "manual")], curation);
    expect(result.map((entry) => entry.number)).toEqual([1, 9]);
    expect(result[1]?.origin).toBe("manual");
  });

  it("never duplicates a number the daemon already reports", () => {
    const result = applyPullRequestCuration([pr(1)], [pr(1, "manual")], {
      added: [1],
      removed: [],
    });
    expect(result.map((entry) => entry.number)).toEqual([1]);
    expect(result[0]?.origin).toBe("stack");
  });

  it("shows an attached set even when the daemon resolved nothing", () => {
    const result = applyPullRequestCuration([], [pr(5, "manual"), pr(6, "manual")], {
      added: [5, 6],
      removed: [],
    });
    expect(result.map((entry) => entry.number)).toEqual([5, 6]);
  });
});

describe("searchItemToRelatedPullRequest", () => {
  it("converts a change request hit with origin manual", () => {
    expect(searchItemToRelatedPullRequest(searchItem(1346))).toEqual({
      number: 1346,
      url: "https://github.com/o/r/pull/1346",
      title: "PR 1346",
      state: "open",
      headRefName: undefined,
      baseRefName: undefined,
      origin: "manual",
    });
  });

  it("rejects issues", () => {
    expect(searchItemToRelatedPullRequest({ ...searchItem(1), kind: "issue" })).toBeNull();
  });

  it("rejects unknown states", () => {
    expect(searchItemToRelatedPullRequest({ ...searchItem(1), state: "draft" })).toBeNull();
  });
});
