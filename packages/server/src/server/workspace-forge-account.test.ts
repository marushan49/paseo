import { homedir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { forgeAccountEnvOverlay, normalizeForgeConfigDir } from "./workspace-forge-account.js";

describe("normalizeForgeConfigDir", () => {
  it("keeps an absolute directory", () => {
    expect(normalizeForgeConfigDir("/home/admin/.config/gh-work")).toBe(
      "/home/admin/.config/gh-work",
    );
  });

  it("expands a leading tilde", () => {
    expect(normalizeForgeConfigDir("~/.config/gh-private")).toBe(
      path.join(homedir(), ".config", "gh-private"),
    );
    expect(normalizeForgeConfigDir("~")).toBe(homedir());
  });

  it("treats empty and blank input as no account", () => {
    expect(normalizeForgeConfigDir("")).toBeNull();
    expect(normalizeForgeConfigDir("   ")).toBeNull();
    expect(normalizeForgeConfigDir(null)).toBeNull();
    expect(normalizeForgeConfigDir(undefined)).toBeNull();
  });

  it("rejects a relative path", () => {
    // It would resolve against the daemon's working directory, so the same
    // setting would select different accounts on different daemons.
    expect(normalizeForgeConfigDir(".config/gh-work")).toBeNull();
    expect(normalizeForgeConfigDir("../gh-work")).toBeNull();
  });

  it("makes two spellings of one directory compare equal", () => {
    expect(normalizeForgeConfigDir("/home/admin/.config/gh-work/")).toBe(
      normalizeForgeConfigDir("/home/admin/.config/gh-work"),
    );
    expect(normalizeForgeConfigDir("/home/admin/../admin/.config/gh-work")).toBe(
      "/home/admin/.config/gh-work",
    );
  });

  it("keeps the root path intact", () => {
    expect(normalizeForgeConfigDir("/")).toBe("/");
  });
});

describe("forgeAccountEnvOverlay", () => {
  it("pins gh to the workspace's config directory", () => {
    expect(forgeAccountEnvOverlay("~/.config/gh-work")).toEqual({
      GH_CONFIG_DIR: path.join(homedir(), ".config", "gh-work"),
    });
  });

  it("contributes nothing when no account is pinned", () => {
    expect(forgeAccountEnvOverlay(null)).toEqual({});
    expect(forgeAccountEnvOverlay("")).toEqual({});
    // A rejected value must not leak a half-set variable either.
    expect(forgeAccountEnvOverlay("relative/gh")).toEqual({});
  });
});
