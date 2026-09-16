import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizeForgeConfigDir } from "./workspace-forge-account.js";

/**
 * The GitHub logins this machine actually has, so a workspace can be pointed at
 * one by name. A config directory is the account as far as `gh` is concerned,
 * but nobody thinks of their work login as `~/.config/gh-work` — they think of
 * it as the username, and that is what a picker has to show.
 */
export interface ForgeAccount {
  /** What `GH_CONFIG_DIR` gets, and what the workspace stores. */
  configDir: string;
  username: string;
  host: string;
}

const AUTH_STATUS_PATTERN = /Logged in to (\S+) account (\S+)/;

export interface DiscoverForgeAccountsDeps {
  /** Runs `gh auth status` under a config directory; returns its combined output. */
  readAuthStatus: (configDir: string) => Promise<string | null>;
  listConfigCandidates?: () => Promise<string[]>;
  /** Directories to include beyond the ones found, e.g. what a workspace already pinned. */
  extraCandidates?: readonly (string | null | undefined)[];
}

export async function discoverForgeAccounts(
  deps: DiscoverForgeAccountsDeps,
): Promise<ForgeAccount[]> {
  const listCandidates = deps.listConfigCandidates ?? listDefaultConfigCandidates;
  const candidates = new Set<string>();
  for (const candidate of await listCandidates()) {
    const normalized = normalizeForgeConfigDir(candidate);
    if (normalized) {
      candidates.add(normalized);
    }
  }
  for (const extra of deps.extraCandidates ?? []) {
    const normalized = normalizeForgeConfigDir(extra);
    if (normalized) {
      candidates.add(normalized);
    }
  }

  const accounts: ForgeAccount[] = [];
  const seen = new Set<string>();
  for (const configDir of [...candidates].sort()) {
    const status = await deps.readAuthStatus(configDir).catch(() => null);
    const parsed = status ? AUTH_STATUS_PATTERN.exec(status) : null;
    if (!parsed) {
      // A directory without a working login is not an account someone can pick;
      // offering it would hand them a workspace whose every gh call fails.
      continue;
    }
    const [, host, username] = parsed;
    if (!host || !username) {
      continue;
    }
    const key = `${host}:${username}:${configDir}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    accounts.push({ configDir, username, host });
  }
  return accounts;
}

/**
 * `~/.config/gh` and its siblings. `gh` itself only ever reads one of them; the
 * convention of parking a second login next to it as `gh-work` is what makes
 * several accounts possible in the first place.
 */
async function listDefaultConfigCandidates(): Promise<string[]> {
  const base = join(homedir(), ".config");
  const fromEnv = (process.env.PASEO_GH_CONFIG_DIRS ?? "")
    .split(":")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  let entries: string[] = [];
  try {
    const found = await readdir(base, { withFileTypes: true });
    entries = found
      .filter((entry) => entry.isDirectory() && /^gh(-|$)/.test(entry.name))
      .map((entry) => join(base, entry.name));
  } catch {
    entries = [];
  }
  return [...entries, ...fromEnv];
}
