/** A thinking option the user picked, still waiting for the daemon to confirm it. */
export interface PendingThinkingSelection {
  requested: string;
  /** What the agent read when the request went out, to tell silence from a reply. */
  baseline: string | null;
}

/**
 * Whether a pick is still in flight.
 *
 * The pill renders the agent's own thinking option, which only changes once the
 * daemon has applied the mutation and its `agent_update` has travelled back.
 * Until then the control shows the value it had before the click, so a pick
 * reads as ignored and gets clicked again. Holding the requested option covers
 * that gap.
 *
 * It is held only while the agent still reports the value it had before: any
 * other answer, including a provider normalising the pick to something else,
 * ends the wait. A pending option that outlived its request would be worse than
 * the stale one it replaced.
 */
export function reducePendingThinkingSelection(
  pending: PendingThinkingSelection | null,
  confirmed: string | null,
): PendingThinkingSelection | null {
  if (pending === null) {
    return null;
  }
  if (confirmed === pending.requested || confirmed !== pending.baseline) {
    return null;
  }
  return pending;
}

export function resolveDisplayedThinkingOptionId(
  pending: PendingThinkingSelection | null,
  confirmed: string | null,
): string | null {
  return pending?.requested ?? confirmed;
}
