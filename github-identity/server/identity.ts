import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";

const run = promisify(execFile);

export type Account = "work" | "private";

export const GH_CONFIG_DIR: Record<Account, string> = {
  work: `${homedir()}/.config/gh-work`,
  private: `${homedir()}/.config/gh-private`,
};

/**
 * Der git-Remote entscheidet, nicht der Pfad: Paseo legt Worktrees unter
 * ~/.paseo/worktrees/<id>/<name> an, wo der Pfad nichts mehr über das Projekt
 * verrät. Der Remote wandert dagegen in jeden Worktree mit.
 */
async function remoteOf(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await run("git", ["config", "--get", "remote.origin.url"], {
      cwd,
      timeout: 5000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export function accountForRemote(remote: string | null): Account | null {
  if (!remote) return null;
  if (remote.includes("github-private") || remote.includes("marushan49/")) return "private";
  if (remote.includes("github-9elf26") || remote.includes("9elf26/")) return "work";
  return null;
}

export function accountForPath(cwd: string): Account | null {
  return cwd.startsWith(`${homedir()}/projects/private/`) ? "private" : null;
}

/**
 * Im Zweifel das Arbeitskonto: das entspricht dem bisherigen Verhalten, also
 * kann die Automatik höchstens etwas richtig machen, nie etwas kaputt.
 */
export async function resolveAccount(cwd: string): Promise<Account> {
  return accountForRemote(await remoteOf(cwd)) ?? accountForPath(cwd) ?? "work";
}
