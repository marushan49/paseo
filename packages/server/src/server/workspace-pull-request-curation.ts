export interface PullRequestCuration {
  added: number[];
  removed: number[];
}

/**
 * A number can only be one of the two, and the newer decision wins: attaching
 * something that was dropped is the way to take the dropping back. Sorted so two
 * clients that made the same decisions store the same thing.
 */
export function normalizePullRequestCuration(curation: {
  added: readonly number[];
  removed: readonly number[];
}): PullRequestCuration {
  const removed = [...new Set(curation.removed)].sort((left, right) => left - right);
  const added = [...new Set(curation.added)]
    .filter((number) => !removed.includes(number))
    .sort((left, right) => left - right);
  return { added, removed };
}

/**
 * The incremental form, for callers that know what they want to change rather
 * than what the whole set should be — an agent attaching the pull requests it
 * just opened has no business restating the ones it did not touch.
 */
export function applyPullRequestCurationChange(input: {
  stored: { added: readonly number[]; removed: readonly number[] } | null | undefined;
  attach?: readonly number[];
  remove?: readonly number[];
}): PullRequestCuration {
  const attach = new Set(input.attach ?? []);
  const remove = new Set(input.remove ?? []);
  // Asking for both in one call is a contradiction; dropping wins, as it does
  // everywhere else in the curation.
  for (const number of remove) {
    attach.delete(number);
  }
  const added = [...(input.stored?.added ?? []), ...attach].filter((number) => !remove.has(number));
  const removed = [...(input.stored?.removed ?? []), ...remove].filter(
    (number) => !attach.has(number),
  );
  return normalizePullRequestCuration({ added, removed });
}
