import { describe, expect, it } from "vitest";

import { resolveBrowserExecutable } from "./browser-capability.js";

describe("resolveBrowserExecutable", () => {
  it("prefers an explicit override when the binary exists", () => {
    const resolved = resolveBrowserExecutable({
      executablePathOverride: "/usr/bin/google-chrome",
      exists: (path) => path === "/usr/bin/google-chrome",
      bundledExecutablePath: "/nonexistent/chrome",
    });

    expect(resolved).toEqual({ kind: "explicit", path: "/usr/bin/google-chrome" });
  });

  it("rejects an explicit override that does not exist", () => {
    expect(() =>
      resolveBrowserExecutable({
        executablePathOverride: "/nonexistent/chrome",
        exists: () => false,
        bundledExecutablePath: "/nonexistent/bundled",
      }),
    ).toThrow("PASEO_BROWSER_EXECUTABLE_PATH");
  });

  it("falls back to well-known system browsers before the bundled chromium", () => {
    const resolved = resolveBrowserExecutable({
      exists: (path) => path === "/usr/bin/chromium",
      bundledExecutablePath: "/root/.cache/ms-playwright/chromium/chrome",
    });

    expect(resolved).toEqual({ kind: "system", path: "/usr/bin/chromium" });
  });

  it("uses the bundled chromium when no system browser exists", () => {
    const resolved = resolveBrowserExecutable({
      exists: (path) => path === "/root/.cache/ms-playwright/chromium/chrome",
      bundledExecutablePath: "/root/.cache/ms-playwright/chromium/chrome",
    });

    expect(resolved).toEqual({
      kind: "bundled",
      path: "/root/.cache/ms-playwright/chromium/chrome",
    });
  });

  it("reports every probed location when no browser is available", () => {
    try {
      resolveBrowserExecutable({ exists: () => false, bundledExecutablePath: null });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain("No browser available");
      expect((error as Error).message).toContain("npx playwright install chromium");
    }
  });
});
