# Session pull requests

A sidebar row shows one change request and one diff stat. Both are correct on their own and
misleading together, and neither survives a session that produced more than one pull request.

## What is wrong today

`sidebar-workspaces-view-model.ts:176` builds the row's `PrHint` from
`workspace.githubRuntime.pullRequest`. That is a single `CheckoutPrStatus` (`messages.ts:5240`)
with one `headRefName`: the change request of the branch the worktree currently has checked out.
Nothing in the protocol, daemon, or client holds a second one. A session that shipped eight
stacked pull requests renders the one its worktree happens to sit on.

The number beside it is `workspace.diffStat`, which the daemon computes as
`git diff --shortstat <merge-base(HEAD, base)>` plus untracked additions
(`checkout-git.ts:2780`). That is the branch's whole diff against the workspace base, including
uncommitted work. On a stacked branch it covers every layer below it, while the badge above names
one layer. The two lines answer different questions and sit close enough to read as one answer.

The failure this produces: a row reports `passed` and looks finished while sibling pull requests
from the same session are still red.

## Membership

"Which pull requests belong to this session" has no single mechanical answer, so take it from three
sources in this order and merge them.

**1. The GitHub stack.** `gh api repos/{owner}/{repo}/stacks?pull_request=<number>` returns the
ordered stack for a known pull request. Paseo already resolves one; one call expands it to the
whole chain. This is the forge's own answer, not a heuristic, and it covers the stacked case
completely. The endpoint returns `[]` for an unstacked pull request, which is the signal to fall
through rather than an error.

**2. Branches of the worktree.** `gh pr list --head <branch> --json ...` for branches this session
created. Needed because three unrelated small bugs in one session are three pull requests that
never form a stack, and because an agent that runs `gh pr create` itself never passes through any
daemon code path that could record the number.

**3. The user.** Removing a pull request from the set, and restoring it, persisted per agent.

Source 3 is load-bearing, not a convenience. A session that finds an unrelated bug and opens a
draft for it produces a pull request that sources 1 and 2 cannot distinguish from the session's
real topic — same worktree, same session, same author. Any rule sharp enough to exclude that draft
eventually excludes a real one. Collect generously and let the user cut.

Order matters when sources disagree. A stack edge from source 1 outranks a branch match, and a user
removal outranks both. Store the user's decisions as decisions, not as a materialized list, so a
pull request added to the stack later still appears.

## Data and protocol

The agent record gains the curation, not the resolved set: which pull requests the user removed and
which they added by hand. The set itself is derived and refetched, so persisting it would go stale
against the forge. Follow `docs/data-model.md` — optional fields, no migrations.

The wire addition is one optional field carrying the resolved set, and one RPC pair for curation
named per `docs/rpc-namespacing.md`:

```
agent.pull_requests.curate.request / .response
```

Gate the feature once on `server_info.features.sessionPullRequests` per
`docs/protocol-compatibility.md`. An older daemon keeps sending the single `prStatus` and the row
keeps rendering exactly as it does now, so no fallback path is needed in the client.

## The row

Collapsed, the row reports the count and the worst state across the set — `3 PRs · 1 failed`. The
worst state is what the current row gets wrong, so it is the part that cannot be one level down.

Expanded, one line per pull request: number, state, checks, and its own `additions`/`deletions`.
Those two fields come back from the same `gh pr list --json` call that resolves the set, so per-pull-request
diff numbers cost no additional request.

`workspace.diffStat` stays — it answers a real question about the worktree — but moves off the
change-request block so it stops reading as that block's figure.

Removing a pull request lives in the expanded line's context menu.

## Phases

1. Resolve and display the set read-only: stack API, branch fallback, protocol field, collapsed
   summary, expanded list. No curation yet.
2. Curation: persistence, the RPC, the menu entry.
3. Reconsider `diffStat` placement once the expanded list exists and the row's shape is settled.

### Phase 1 status

Shipped: the wire field `githubRuntime.relatedPullRequests` with its
`server_info.features.relatedPullRequests` gate, the merge and parse rules in
`packages/server/src/utils/related-pull-requests.ts`, the fetch in the forge
poll (`github-service.ts#getRelatedPullRequests`, cached per poll identity,
called from `workspace-git-service.ts#resolveRelatedPullRequests`), and the
row — collapsed `3 PRs · 1 failed`, expanded one line per change request with
its own additions and deletions.

Known gap: the fetch keys off the checked-out branch's current PR number, so
a workspace on a base branch (e.g. `development`) resolves nothing even when
its session produced PRs on other branches. Sources 2 and 3 below exist to
close exactly that gap.

Phase 1 is useful alone: it ends the "reports passed while siblings are red" failure.

### Phase 2 status (2026-09-15)

App slice shipped on `workspace-pr-curation`: curation model
(`PullRequestCuration`, same shape as the future wire field),
ephemeral per-workspace store, attach-by-number through the existing
`forge.search` RPC with exact-number matching, remove via long-press on the
expanded line, row-menu entries (kebab + context menu) for attach and for
"scan chat for PRs" — a bounded transcript walk that extracts `#123` refs
and pull URLs and attaches what the forge confirms. The store is
deliberately ephemeral; daemon persistence via `agent.pull_requests.curate`
replaces it (store is then a write-through cache). Full auto-attach on
restart belongs daemon-side with that persistence (rate limits), not as an
app-startup fan-out.

Not shipped: daemon persistence, the curate RPC, and source 2 (session
branches have no tracking to key off — needs recording at creation time).

## Open

- `gh stack` is in public preview (see the `github-stack` skill). Decide whether the daemon shells
  out to `gh stack view --json`, calls the REST endpoint directly, or requires the extension. The
  REST endpoint needs no extension and is the smaller dependency.
- Which branches count as "this session's" in source 2. The worktree has one branch checked out;
  branches the agent created and left need either reflog inspection or recording at creation time.
- Whether non-GitHub forges get source 1 at all. `docs/forge-providers.md` governs; stacks are a
  GitHub feature and the other forges need the branch fallback alone.
