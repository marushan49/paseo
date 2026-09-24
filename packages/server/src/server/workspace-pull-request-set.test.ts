import { describe, expect, it } from "vitest";

import {
  buildCuratedOnlyGitHubRuntime,
  resolveWorkspacePullRequestSet,
  selectCuratedPullRequestFacts,
  type WorkspaceSetPullRequest,
} from "./workspace-pull-request-set.js";

function derived(number: number): WorkspaceSetPullRequest {
  return {
    number,
    url: `https://github.com/acme/app/pull/${number}`,
    title: `PR ${number}`,
    state: "open",
    origin: "stack",
  };
}

const facts = {
  number: 1401,
  url: "https://github.com/acme/app/pull/1401",
  title: "Ask for ownership when creating prompts",
  state: "open" as const,
};

describe("resolveWorkspacePullRequestSet", () => {
  // The defect this covers: the daemon stored added: [1401] and returned an
  // empty set, so the row said "No pull requests yet" about a decision it had
  // written down itself.
  it("draws an attached pull request from the facts stored with it", () => {
    const set = resolveWorkspacePullRequestSet([], {
      pullRequestCuration: { added: [1401], removed: [] },
      pullRequestFacts: [facts],
    });
    expect(set).toEqual([{ ...facts, origin: "manual" }]);
  });

  it("keeps the derived set and appends what was attached", () => {
    const set = resolveWorkspacePullRequestSet([derived(900)], {
      pullRequestCuration: { added: [1401], removed: [] },
      pullRequestFacts: [facts],
    });
    expect(set.map((entry) => entry.number)).toEqual([900, 1401]);
  });

  it("lets a removal win over both sources", () => {
    const set = resolveWorkspacePullRequestSet([derived(900)], {
      pullRequestCuration: { added: [1401], removed: [900, 1401] },
      pullRequestFacts: [facts],
    });
    expect(set).toEqual([]);
  });

  it("does not list one pull request twice", () => {
    const set = resolveWorkspacePullRequestSet([derived(1401)], {
      pullRequestCuration: { added: [1401], removed: [] },
      pullRequestFacts: [facts],
    });
    expect(set.map((entry) => entry.number)).toEqual([1401]);
    expect(set[0]?.origin).toBe("stack");
  });

  // Records written before the daemon kept facts. A row with no title and no
  // link is worse than one entry fewer.
  it("skips a number it has no facts for", () => {
    const set = resolveWorkspacePullRequestSet([], {
      pullRequestCuration: { added: [1401], removed: [] },
      pullRequestFacts: null,
    });
    expect(set).toEqual([]);
  });

  it("returns the derived set untouched when nothing was curated", () => {
    const set = resolveWorkspacePullRequestSet([derived(900)], {
      pullRequestCuration: null,
      pullRequestFacts: null,
    });
    expect(set.map((entry) => entry.number)).toEqual([900]);
  });
});

describe("selectCuratedPullRequestFacts", () => {
  it("stores only the facts for numbers that stayed added", () => {
    const stored = selectCuratedPullRequestFacts({ added: [1401], removed: [900] }, [
      { ...facts, origin: "manual" },
      { ...derived(900), origin: "manual" },
    ]);
    expect(stored).toEqual([facts]);
  });

  it("stores nothing rather than an empty list", () => {
    expect(selectCuratedPullRequestFacts({ added: [], removed: [] }, [])).toBeNull();
    expect(selectCuratedPullRequestFacts({ added: [1401], removed: [] }, undefined)).toBeNull();
  });
});

describe("buildCuratedOnlyGitHubRuntime", () => {
  // A workspace on a plain directory has no derived set, and the describe path
  // for it reported no github runtime at all. An attachment there was stored,
  // sent and then dropped on the last step before the row.
  it("gives a directory workspace a runtime for what was attached to it", () => {
    const { githubRuntime } = buildCuratedOnlyGitHubRuntime({
      pullRequestCuration: { added: [1401], removed: [] },
      pullRequestFacts: [facts],
    });
    expect(githubRuntime?.relatedPullRequests).toEqual([{ ...facts, origin: "manual" }]);
    expect(githubRuntime?.pullRequest).toBeNull();
  });

  it("stays silent when nothing was attached", () => {
    expect(
      buildCuratedOnlyGitHubRuntime({ pullRequestCuration: null, pullRequestFacts: null }),
    ).toEqual({});
  });
});
