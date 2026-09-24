import { describe, expect, test } from "vitest";
import {
  mergeRelatedPullRequests,
  parseGhPullRequestList,
  parseGitHubStackResponse,
  summarizeCheckRollup,
  type RelatedPullRequestFacts,
} from "./related-pull-requests";

function facts(number: number, overrides: Partial<RelatedPullRequestFacts> = {}) {
  return {
    number,
    url: `https://github.com/acme/repo/pull/${number}`,
    state: "open" as const,
    ...overrides,
  };
}

describe("mergeRelatedPullRequests", () => {
  test("keeps the stack in its own order and appends unstacked entries by number", () => {
    const merged = mergeRelatedPullRequests({
      stack: [facts(30), facts(10), facts(20)],
      branch: [facts(5), facts(40)],
    });

    expect(merged.map((pr) => pr.number)).toEqual([30, 10, 20, 5, 40]);
    expect(merged.slice(0, 3).map((pr) => pr.stackIndex)).toEqual([0, 1, 2]);
  });

  test("marks the checked-out change request without moving it", () => {
    const merged = mergeRelatedPullRequests({
      currentNumber: 20,
      stack: [facts(10), facts(20), facts(30)],
    });

    expect(merged.map((pr) => pr.number)).toEqual([10, 20, 30]);
    expect(merged[1]?.origin).toBe("current");
    expect(merged[1]?.stackIndex).toBe(1);
  });

  test("a change request in both sources is listed once and keeps its stack position", () => {
    const merged = mergeRelatedPullRequests({
      stack: [facts(10), facts(20)],
      branch: [facts(20, { additions: 12, deletions: 3 })],
    });

    expect(merged).toHaveLength(2);
    const twenty = merged.find((pr) => pr.number === 20);
    expect(twenty?.origin).toBe("stack");
    expect(twenty?.stackIndex).toBe(1);
    // The branch call carries the diff numbers the stack response does not.
    expect(twenty?.additions).toBe(12);
    expect(twenty?.deletions).toBe(3);
  });

  test("drops what the user removed, from either source", () => {
    const merged = mergeRelatedPullRequests({
      stack: [facts(10), facts(20)],
      branch: [facts(30)],
      removed: [20, 30],
    });

    expect(merged.map((pr) => pr.number)).toEqual([10]);
  });

  test("an unstacked change request still yields its own entry", () => {
    const merged = mergeRelatedPullRequests({ currentNumber: 7, branch: [facts(7)] });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.origin).toBe("current");
    expect(merged[0]?.stackIndex).toBeUndefined();
  });
});

describe("parseGitHubStackResponse", () => {
  test("an unstacked change request yields nothing", () => {
    expect(parseGitHubStackResponse([])).toEqual([]);
  });

  test("reads numbers from a flat stack payload", () => {
    expect(parseGitHubStackResponse([{ number: 3 }, { number: 4 }])).toEqual([3, 4]);
  });

  test("reads numbers from a nested pull_requests payload", () => {
    const payload = [{ pull_requests: [{ number: 8 }, { number: 9 }] }];
    expect(parseGitHubStackResponse(payload)).toEqual([8, 9]);
  });

  test("survives a shape it does not recognize", () => {
    expect(parseGitHubStackResponse({ unexpected: true })).toEqual([]);
    expect(parseGitHubStackResponse([{ nothing: "useful" }])).toEqual([]);
  });
});

describe("summarizeCheckRollup", () => {
  test("no checks is not success", () => {
    expect(summarizeCheckRollup([])).toBe("none");
    expect(summarizeCheckRollup(null)).toBe("none");
  });

  test("any failure wins", () => {
    expect(summarizeCheckRollup([{ conclusion: "SUCCESS" }, { conclusion: "FAILURE" }])).toBe(
      "failure",
    );
  });

  test("an in-flight check keeps the rollup pending", () => {
    expect(
      summarizeCheckRollup([
        { conclusion: "SUCCESS", status: "COMPLETED" },
        { status: "IN_PROGRESS" },
      ]),
    ).toBe("pending");
  });

  test("all complete and none failing is success", () => {
    expect(
      summarizeCheckRollup([
        { conclusion: "SUCCESS", status: "COMPLETED" },
        { conclusion: "NEUTRAL", status: "COMPLETED" },
      ]),
    ).toBe("success");
  });
});

describe("parseGhPullRequestList", () => {
  test("maps the fields the row needs and derives the check state", () => {
    const parsed = parseGhPullRequestList([
      {
        number: 4887,
        url: "https://github.com/acme/repo/pull/4887",
        title: "Fix the thing",
        state: "OPEN",
        isDraft: false,
        headRefName: "fix/thing",
        baseRefName: "main",
        additions: 253,
        deletions: 4,
        statusCheckRollup: [{ conclusion: "SUCCESS", status: "COMPLETED" }],
      },
    ]);

    expect(parsed).toEqual([
      {
        number: 4887,
        url: "https://github.com/acme/repo/pull/4887",
        title: "Fix the thing",
        state: "open",
        isDraft: false,
        headRefName: "fix/thing",
        baseRefName: "main",
        additions: 253,
        deletions: 4,
        checksStatus: "success",
      },
    ]);
  });

  test("skips entries without an identity instead of inventing one", () => {
    expect(parseGhPullRequestList([{ title: "no number" }, { number: 1 }])).toEqual([]);
  });

  test("normalizes the merged state", () => {
    const parsed = parseGhPullRequestList([
      { number: 1, url: "https://x/pull/1", state: "MERGED" },
    ]);
    expect(parsed[0]?.state).toBe("merged");
  });
});
