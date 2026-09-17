import { describe, expect, it } from "vitest";

import { applyPullRequestCuration } from "@/git/pull-request-curation";
import type { RelatedPullRequest } from "@/git/related-pull-requests";

function pullRequest(number: number, origin: RelatedPullRequest["origin"]): RelatedPullRequest {
  return {
    number,
    url: `https://github.com/acme/app/pull/${number}`,
    title: `PR ${number}`,
    state: "open",
    origin,
  };
}

/**
 * The row renders what this returns. Attach and scan resolve their pull requests
 * and write them to the curation store, so a row that shows only the daemon's
 * own list swallows every one of them: the dialog closes, the store fills up,
 * and the panel still says "No pull requests yet".
 */
describe("the set a workspace row shows", () => {
  it("includes what was attached by hand, not only what the daemon derived", () => {
    const shown = applyPullRequestCuration(
      [pullRequest(900, "stack")],
      [pullRequest(1335, "manual"), pullRequest(1346, "manual")],
      { added: [1335, 1346], removed: [] },
    );
    expect(shown.map((entry) => entry.number)).toEqual([900, 1335, 1346]);
  });

  it("keeps a removal winning over both sources", () => {
    const shown = applyPullRequestCuration(
      [pullRequest(900, "stack")],
      [pullRequest(1335, "manual")],
      { added: [1335], removed: [900, 1335] },
    );
    expect(shown).toEqual([]);
  });

  it("does not show one pull request twice when both sources have it", () => {
    const shown = applyPullRequestCuration(
      [pullRequest(1335, "stack")],
      [pullRequest(1335, "manual")],
      { added: [1335], removed: [] },
    );
    expect(shown.map((entry) => entry.number)).toEqual([1335]);
  });
});
