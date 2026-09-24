import os from "node:os";
import path from "node:path";
import { loadPersistedConfig } from "../persisted-config.js";

export const SYSTEM_ONE_EXCLUDED_MESSAGE =
  "System One is turned off for this project (daemon.systemOne.excludedPaths); nothing was sent to TypeSafe.";

/**
 * True when cwd lies under one of `daemon.systemOne.excludedPaths`, for code that
 * must not reach TypeSafe. Read per call so edits to config.json apply at once.
 */
export function isSystemOneExcluded(paseoHome: string, cwd: string | undefined): boolean {
  if (!cwd) return false;
  const excluded = loadPersistedConfig(paseoHome).daemon?.systemOne?.excludedPaths ?? [];
  const target = path.resolve(cwd);
  return excluded.some((entry) => {
    const root = path.resolve(entry.replace(/^~(?=$|\/)/, os.homedir()));
    const relative = path.relative(root, target);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}
