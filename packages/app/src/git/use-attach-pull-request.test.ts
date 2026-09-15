import { describe, expect, it, vi } from "vitest";
import type { ForgeSearchItem } from "@getpaseo/protocol/messages";
import type { ForgeSearchClient } from "./use-forge-search-query";
import {
  AttachPullRequestNotFoundError,
  parseAttachPullRequestNumber,
  resolvePullRequestForAttach,
  submitAttachPullRequest,
} from "./use-attach-pull-request";
import { pullRequestCurationStore } from "./pull-request-curation-store";

function searchItem(number: number, kind = "change_request", state = "open"): ForgeSearchItem {
  return {
    kind: kind as ForgeSearchItem["kind"],
    number,
    title: `PR ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    state,
    body: null,
    labels: [],
  };
}

function clientWith(items: ForgeSearchItem[]): ForgeSearchClient & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    searchForge: vi.fn(async (options: unknown) => {
      calls.push(options);
      return { items, authState: "authenticated", error: null, requestId: "test" };
    }),
  };
}

describe("parseAttachPullRequestNumber", () => {
  it("accepts plain numbers and #prefixed numbers", () => {
    expect(parseAttachPullRequestNumber("1346")).toBe(1346);
    expect(parseAttachPullRequestNumber("  #1371 ")).toBe(1371);
  });

  it("rejects urls, ranges, and garbage", () => {
    expect(parseAttachPullRequestNumber("https://github.com/o/r/pull/1346")).toBeNull();
    expect(parseAttachPullRequestNumber("1346-1350")).toBeNull();
    expect(parseAttachPullRequestNumber("")).toBeNull();
    expect(parseAttachPullRequestNumber("0")).toBeNull();
    expect(parseAttachPullRequestNumber("abc")).toBeNull();
  });
});

describe("resolvePullRequestForAttach", () => {
  it("resolves an exact number match with origin manual", async () => {
    const client = clientWith([searchItem(1346)]);
    const result = await resolvePullRequestForAttach({ client, cwd: "/repo", number: 1346 });
    expect(result).toMatchObject({ number: 1346, origin: "manual", state: "open" });
    expect(client.calls).toEqual([
      { cwd: "/repo", query: "1346", limit: 10, kinds: ["change_request"] },
    ]);
  });

  it("ignores fuzzy hits and matches the exact number", async () => {
    const client = clientWith([searchItem(13460), searchItem(1346)]);
    const result = await resolvePullRequestForAttach({ client, cwd: "/repo", number: 1346 });
    expect(result.number).toBe(1346);
  });

  it("throws not-found when nothing matches exactly", async () => {
    const client = clientWith([searchItem(13460)]);
    await expect(
      resolvePullRequestForAttach({ client, cwd: "/repo", number: 1346 }),
    ).rejects.toBeInstanceOf(AttachPullRequestNotFoundError);
  });

  it("throws not-found on empty results", async () => {
    const client = clientWith([]);
    await expect(
      resolvePullRequestForAttach({ client, cwd: "/repo", number: 1346 }),
    ).rejects.toBeInstanceOf(AttachPullRequestNotFoundError);
  });
});

describe("submitAttachPullRequest", () => {
  const formatInvalid = () => "invalid";
  const formatNotFound = (number: number) => `missing #${number}`;

  it("resolves and records the attachment in the workspace store", async () => {
    const client = clientWith([searchItem(1346)]);
    const facts = await submitAttachPullRequest({
      client,
      cwd: "/repo",
      workspaceKey: "srv:ws-submit",
      rawValue: "1346",
      formatInvalid,
      formatNotFound,
    });
    expect(facts.number).toBe(1346);
    expect(pullRequestCurationStore.getCuration("srv:ws-submit")).toEqual({
      added: [1346],
      removed: [],
    });
    pullRequestCurationStore.clear("srv:ws-submit");
  });

  it("rejects invalid input without touching the store", async () => {
    const client = clientWith([searchItem(1346)]);
    await expect(
      submitAttachPullRequest({
        client,
        cwd: "/repo",
        workspaceKey: "srv:ws-submit-invalid",
        rawValue: "abc",
        formatInvalid,
        formatNotFound,
      }),
    ).rejects.toThrow("invalid");
    expect(pullRequestCurationStore.getCuration("srv:ws-submit-invalid")).toEqual({
      added: [],
      removed: [],
    });
  });

  it("maps a missed lookup to the not-found message", async () => {
    const client = clientWith([]);
    await expect(
      submitAttachPullRequest({
        client,
        cwd: "/repo",
        workspaceKey: "srv:ws-submit-miss",
        rawValue: "9999",
        formatInvalid,
        formatNotFound,
      }),
    ).rejects.toThrow("missing #9999");
  });
});
