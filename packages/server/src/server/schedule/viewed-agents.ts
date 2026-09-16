/**
 * Which agents someone currently has open, as reported by the clients' timeline
 * subscriptions. The app subscribes to exactly the timelines it renders (see
 * `createViewedTimelineOwner`), so a subscribed agent is one a human is looking
 * at right now.
 *
 * Scheduled runs use this to decide when their workspace may be cleared away:
 * "archive on finish" means the agent is done, and the reader usually is not.
 */
export class ViewedAgentRegistry {
  private readonly byOwner = new Map<string, ReadonlySet<string>>();

  setViewed(ownerId: string, agentIds: Iterable<string>): void {
    this.byOwner.set(ownerId, new Set(agentIds));
  }

  clearOwner(ownerId: string): void {
    this.byOwner.delete(ownerId);
  }

  isViewed(agentId: string): boolean {
    for (const agentIds of this.byOwner.values()) {
      if (agentIds.has(agentId)) {
        return true;
      }
    }
    return false;
  }
}
