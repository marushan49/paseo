/**
 * Which GitHub login a workspace acts as, given that the choice can be made in
 * two places.
 *
 * A person does not decide per workspace that a repository belongs to work.
 * They decide it once for the repository, and every branch worktree cut from it
 * inherits that. So the account lives on the project, and the workspace value is
 * an exception for the one checkout that differs, not the normal way to set it.
 */
export interface ForgeAccountOwner {
  forgeConfigDir: string | null;
}

export type ForgeAccountSource = "workspace" | "project";

export interface ResolvedForgeAccount {
  /** What `GH_CONFIG_DIR` gets. Null means the machine's default account. */
  configDir: string | null;
  /** Where the value came from, so the picker can say "inherited". */
  source: ForgeAccountSource | null;
}

export function resolveForgeConfigDir(input: {
  workspace: ForgeAccountOwner | null | undefined;
  project: ForgeAccountOwner | null | undefined;
}): ResolvedForgeAccount {
  const own = input.workspace?.forgeConfigDir ?? null;
  if (own !== null) {
    return { configDir: own, source: "workspace" };
  }
  const inherited = input.project?.forgeConfigDir ?? null;
  if (inherited !== null) {
    return { configDir: inherited, source: "project" };
  }
  return { configDir: null, source: null };
}
