import { homedir } from "node:os";
import { isAbsolute, normalize } from "node:path";

/**
 * A workspace pins the forge CLI to one account by naming that account's config
 * directory. `gh` reads its entire auth state from `GH_CONFIG_DIR`, so the
 * directory is the account: `~/.config/gh-work` and `~/.config/gh-private` are
 * two logins that never see each other. Without this, every workspace on the
 * machine shares whichever account happens to be active.
 *
 * Only GitHub is wired up. `glab` and `tea` have their own variables; add them
 * here when someone has verified the name against the installed binary rather
 * than guessing it from documentation.
 */

function expandHome(path: string): string {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return `${homedir()}/${path.slice(2)}`;
  }
  return path;
}

/**
 * Accepts what a user types and returns a directory the daemon can hand to a
 * subprocess, or null for "use the machine's default account".
 *
 * A relative path is rejected rather than resolved. It would resolve against
 * whatever working directory the daemon happens to have, so the same setting
 * would select different accounts depending on how the daemon was started —
 * and the failure is silent, because the wrong account still answers.
 */
export function normalizeForgeConfigDir(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const expanded = expandHome(trimmed);
  if (!isAbsolute(expanded)) {
    return null;
  }
  const normalized = normalize(expanded);
  // Keep a root path intact; strip the trailing separator everywhere else so
  // two spellings of the same directory compare equal.
  return normalized.length > 1 ? normalized.replace(/[/\\]+$/, "") : normalized;
}

/**
 * The environment a workspace's account contributes to a forge CLI call or an
 * agent process. Empty when the workspace has no account pinned, so callers can
 * spread it unconditionally.
 */
export function forgeAccountEnvOverlay(
  configDir: string | null | undefined,
): Record<string, string> {
  const normalized = normalizeForgeConfigDir(configDir);
  return normalized ? { GH_CONFIG_DIR: normalized } : {};
}
