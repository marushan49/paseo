export const WRITING_FENCE_KEYWORD = "writing";

export interface WritingFenceInfo {
  title: string | null;
}

/**
 * A writing fence is `\`\`\`\`writing <optional title>`. The title is the rest of
 * the info line verbatim, because it is prose the user reads — quoting it or
 * restricting its characters would only mangle real subjects like
 * `Re: Angebot (final)`.
 */
export function parseWritingFenceInfo(info: string | null | undefined): WritingFenceInfo | null {
  const trimmed = info?.trim();
  if (!trimmed) return null;

  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!match) return null;
  if (match[1].toLowerCase() !== WRITING_FENCE_KEYWORD) return null;

  const title = match[2]?.trim();
  return { title: title ? title : null };
}
