import { describe, expect, it } from "vitest";

import { resolveForgeConfigDir, type ForgeAccountOwner } from "./forge-account-resolution.js";

const workspace = (forgeConfigDir: string | null): ForgeAccountOwner => ({ forgeConfigDir });
const project = (forgeConfigDir: string | null): ForgeAccountOwner => ({ forgeConfigDir });

describe("resolveForgeConfigDir", () => {
  it("uses the project's account when the workspace has none", () => {
    expect(
      resolveForgeConfigDir({
        workspace: workspace(null),
        project: project("/home/a/.config/gh-work"),
      }),
    ).toEqual({ configDir: "/home/a/.config/gh-work", source: "project" });
  });

  it("lets the workspace override its project", () => {
    expect(
      resolveForgeConfigDir({
        workspace: workspace("/home/a/.config/gh-private"),
        project: project("/home/a/.config/gh-work"),
      }),
    ).toEqual({ configDir: "/home/a/.config/gh-private", source: "workspace" });
  });

  it("falls back to the machine default when neither is set", () => {
    expect(resolveForgeConfigDir({ workspace: workspace(null), project: project(null) })).toEqual({
      configDir: null,
      source: null,
    });
  });

  it("treats a missing project as no project account", () => {
    expect(
      resolveForgeConfigDir({ workspace: workspace("/home/a/.config/gh"), project: null }),
    ).toEqual({ configDir: "/home/a/.config/gh", source: "workspace" });
    expect(resolveForgeConfigDir({ workspace: workspace(null), project: null })).toEqual({
      configDir: null,
      source: null,
    });
  });

  // A workspace that belongs to nothing still runs somewhere; it must not
  // inherit an account it was never given.
  it("resolves a workspace on its own", () => {
    expect(
      resolveForgeConfigDir({ workspace: null, project: project("/home/a/.config/gh") }),
    ).toEqual({ configDir: "/home/a/.config/gh", source: "project" });
    expect(resolveForgeConfigDir({ workspace: null, project: null })).toEqual({
      configDir: null,
      source: null,
    });
  });
});
