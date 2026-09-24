import { describe, expect, test } from "vitest";
import {
  applyPullRequestCurationChange,
  normalizePullRequestCuration,
} from "./workspace-pull-request-curation.js";

describe("normalizePullRequestCuration", () => {
  test("sorts, dedupes, and lets a removal win over an add", () => {
    expect(
      normalizePullRequestCuration({ added: [1350, 1346, 1346, 1371], removed: [1371] }),
    ).toEqual({ added: [1346, 1350], removed: [1371] });
  });
});

describe("applyPullRequestCurationChange", () => {
  test("adds to what is already stored instead of replacing it", () => {
    expect(
      applyPullRequestCurationChange({
        stored: { added: [1346], removed: [] },
        attach: [1350, 1371],
      }),
    ).toEqual({ added: [1346, 1350, 1371], removed: [] });
  });

  test("attaching something previously dropped takes the dropping back", () => {
    expect(
      applyPullRequestCurationChange({
        stored: { added: [], removed: [1346] },
        attach: [1346],
      }),
    ).toEqual({ added: [1346], removed: [] });
  });

  test("removing moves a number out of added and into removed", () => {
    expect(
      applyPullRequestCurationChange({
        stored: { added: [1346, 1350], removed: [] },
        remove: [1346],
      }),
    ).toEqual({ added: [1350], removed: [1346] });
  });

  test("asking for both in one call drops it, like everywhere else", () => {
    expect(
      applyPullRequestCurationChange({ stored: null, attach: [1346], remove: [1346] }),
    ).toEqual({ added: [], removed: [1346] });
  });

  test("works from nothing stored", () => {
    expect(applyPullRequestCurationChange({ stored: undefined, attach: [1346] })).toEqual({
      added: [1346],
      removed: [],
    });
  });
});
