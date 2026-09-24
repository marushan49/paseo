import os from "node:os";
import path from "node:path";
import type { DaemonConfigStore } from "../daemon-config-store.js";
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

const SHADOW_FLAG_TTL_MS = 5_000;
let shadowFlagCache: { home: string; value: boolean; readAt: number } | null = null;

/** Shadow mode fires on every stream event, so the config flag is cached briefly. */
export function isShadowModeEnabled(
  paseoHome: string,
  daemonConfigStore: Pick<DaemonConfigStore, "get">,
  cwd: string,
): boolean {
  if (!daemonConfigStore.get().systemOne?.enabled) return false;
  const now = Date.now();
  if (
    !shadowFlagCache ||
    shadowFlagCache.home !== paseoHome ||
    now - shadowFlagCache.readAt > SHADOW_FLAG_TTL_MS
  ) {
    const value = loadPersistedConfig(paseoHome).daemon?.systemOne?.shadow === true;
    shadowFlagCache = { home: paseoHome, value, readAt: now };
  }
  return shadowFlagCache.value && !isSystemOneExcluded(paseoHome, cwd);
}
