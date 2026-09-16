import { describe, expect, test } from "vitest";
import { discoverForgeAccounts } from "./forge-account-discovery.js";

const WORK = "✓ Logged in to github.com account marushan491 (/home/a/.config/gh-work/hosts.yml)";
const PRIVATE = "✓ Logged in to github.com account marushan49 (/home/a/.config/gh/hosts.yml)";

describe("discoverForgeAccounts", () => {
  test("names each config directory by the account that answers for it", async () => {
    const accounts = await discoverForgeAccounts({
      listConfigCandidates: async () => ["/home/a/.config/gh", "/home/a/.config/gh-work"],
      readAuthStatus: async (dir) => (dir.endsWith("gh-work") ? WORK : PRIVATE),
    });
    expect(accounts).toEqual([
      { configDir: "/home/a/.config/gh", username: "marushan49", host: "github.com" },
      { configDir: "/home/a/.config/gh-work", username: "marushan491", host: "github.com" },
    ]);
  });

  test("leaves out a directory with no working login", async () => {
    const accounts = await discoverForgeAccounts({
      listConfigCandidates: async () => ["/home/a/.config/gh", "/home/a/.config/gh-stale"],
      readAuthStatus: async (dir) =>
        dir.endsWith("gh-stale") ? "You are not logged in." : PRIVATE,
    });
    expect(accounts.map((account) => account.configDir)).toEqual(["/home/a/.config/gh"]);
  });

  test("survives a directory whose probe throws", async () => {
    const accounts = await discoverForgeAccounts({
      listConfigCandidates: async () => ["/home/a/.config/gh", "/home/a/.config/gh-broken"],
      readAuthStatus: async (dir) => {
        if (dir.endsWith("gh-broken")) throw new Error("gh exploded");
        return PRIVATE;
      },
    });
    expect(accounts).toHaveLength(1);
  });

  test("includes a directory the workspace already pinned, wherever it lives", async () => {
    const accounts = await discoverForgeAccounts({
      listConfigCandidates: async () => [],
      extraCandidates: ["~/elsewhere/gh-old", null],
      readAuthStatus: async () => WORK,
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.username).toBe("marushan491");
  });
});
