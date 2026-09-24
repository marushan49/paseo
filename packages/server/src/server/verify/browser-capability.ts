import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

export const BROWSER_EXECUTABLE_OVERRIDE_ENV = "PASEO_BROWSER_EXECUTABLE_PATH";

export type BrowserExecutableKind = "explicit" | "system" | "bundled";

export interface ResolvedBrowserExecutable {
  kind: BrowserExecutableKind;
  path: string;
}

export interface ResolveBrowserExecutableInput {
  executablePathOverride?: string;
  exists?: (path: string) => boolean;
  bundledExecutablePath?: string | null;
}

const WELL_KNOWN_SYSTEM_BROWSERS: readonly string[] = [
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

export class NoBrowserAvailableError extends Error {
  public constructor(probedPaths: readonly string[]) {
    super(
      [
        "No browser available for daemon browser automation.",
        `Probed: ${probedPaths.length > 0 ? probedPaths.join(", ") : "(nothing found)"}.`,
        "Install a browser with `npx playwright install chromium` or point",
        `${BROWSER_EXECUTABLE_OVERRIDE_ENV} at a Chrome/Chromium binary.`,
      ].join(" "),
    );
    this.name = "NoBrowserAvailableError";
  }
}

export function bundledChromiumExecutablePath(): string | null {
  try {
    const executablePath = chromium.executablePath();
    return executablePath.length > 0 && existsSync(executablePath) ? executablePath : null;
  } catch {
    return null;
  }
}

export function resolveBrowserExecutable(
  input: ResolveBrowserExecutableInput = {},
): ResolvedBrowserExecutable {
  const exists = input.exists ?? existsSync;
  const probed: string[] = [];

  const override = input.executablePathOverride ?? process.env[BROWSER_EXECUTABLE_OVERRIDE_ENV];
  if (override !== undefined && override.trim().length > 0) {
    const overridePath = override.trim();
    if (!exists(overridePath)) {
      throw new Error(
        `${BROWSER_EXECUTABLE_OVERRIDE_ENV} points at ${overridePath}, which does not exist`,
      );
    }
    return { kind: "explicit", path: overridePath };
  }

  for (const candidate of WELL_KNOWN_SYSTEM_BROWSERS) {
    probed.push(candidate);
    if (exists(candidate)) {
      return { kind: "system", path: candidate };
    }
  }

  const bundled =
    input.bundledExecutablePath !== undefined
      ? input.bundledExecutablePath
      : bundledChromiumExecutablePath();
  if (bundled) {
    probed.push(bundled);
    if (exists(bundled)) {
      return { kind: "bundled", path: bundled };
    }
  }

  throw new NoBrowserAvailableError(probed);
}
