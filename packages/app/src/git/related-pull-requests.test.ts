import { describe, expect, test } from "vitest";
import {
  selectRelatedPullRequests,
  shouldPresentAsSet,
  summarizeRelatedPullRequests,
  type RelatedPullRequest,
} from "./related-pull-requests";

function pr(number: number, overrides: Partial<RelatedPullRequest> = {}): RelatedPullRequest {
  return {
    number,
    url: `https://github.com/acme/repo/pull/${number}`,
    state: "open",
    origin: "branch",
    ...overrides,
  };
}

describe("summarizeRelatedPullRequests", () => {
  test("one failing sibling decides the row, whatever the others say", () => {
    const summary = summarizeRelatedPullRequests([
      pr(1, { checksStatus: "success" }),
      pr(2, { checksStatus: "failure" }),
      pr(3, { checksStatus: "success" }),
    ]);

    expect(summary).toEqual({ total: 3, openCount: 3, health: "failing" });
  });

  test("a merged layer's old failure stops holding the row back", () => {
    const summary = summarizeRelatedPullRequests([
      pr(1, { checksStatus: "failure", state: "merged" }),
      pr(2, { checksStatus: "success" }),
    ]);

    expect(summary.health).toBe("passing");
    expect(summary.openCount).toBe(1);
    expect(summary.total).toBe(2);
  });

  test("running outranks passing", () => {
    const summary = summarizeRelatedPullRequests([
      pr(1, { checksStatus: "success" }),
      pr(2, { checksStatus: "pending" }),
    ]);
    expect(summary.health).toBe("running");
  });

  test("failing outranks running", () => {
    const summary = summarizeRelatedPullRequests([
      pr(1, { checksStatus: "pending" }),
      pr(2, { checksStatus: "failure" }),
    ]);
    expect(summary.health).toBe("failing");
  });

  test("an empty set reports nothing rather than passing", () => {
    expect(summarizeRelatedPullRequests([])).toEqual({
      total: 0,
      openCount: 0,
      health: "unknown",
    });
  });

  test("change requests without checks do not read as green", () => {
    expect(summarizeRelatedPullRequests([pr(1, { checksStatus: "none" })]).health).toBe("unknown");
  });
});

describe("shouldPresentAsSet", () => {
  test("a single change request keeps the row it already had", () => {
    expect(shouldPresentAsSet([pr(1)])).toBe(false);
    expect(shouldPresentAsSet([])).toBe(false);
  });

  test("two or more earn the set presentation", () => {
    expect(shouldPresentAsSet([pr(1), pr(2)])).toBe(true);
  });
});

describe("selectRelatedPullRequests", () => {
  test("an older daemon that sends no set yields an empty list, not a crash", () => {
    expect(selectRelatedPullRequests(undefined)).toEqual([]);
    expect(selectRelatedPullRequests({ featuresEnabled: true })).toEqual([]);
  });

  test("returns the same empty reference so an unchanged row does not re-render", () => {
    expect(selectRelatedPullRequests(undefined)).toBe(selectRelatedPullRequests({}));
  });

  test("passes the set through", () => {
    const relatedPullRequests = [pr(1), pr(2)];
    expect(selectRelatedPullRequests({ relatedPullRequests })).toBe(relatedPullRequests);
  });
});
