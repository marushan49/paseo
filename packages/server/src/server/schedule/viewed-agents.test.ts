import { describe, expect, test } from "vitest";
import { ViewedAgentRegistry } from "./viewed-agents.js";

describe("ViewedAgentRegistry", () => {
  test("an agent nobody subscribed to is not viewed", () => {
    const registry = new ViewedAgentRegistry();
    expect(registry.isViewed("agent-1")).toBe(false);
  });

  test("an agent is viewed while any owner shows it", () => {
    const registry = new ViewedAgentRegistry();
    registry.setViewed("owner-a", ["agent-1", "agent-2"]);
    registry.setViewed("owner-b", ["agent-2"]);

    registry.clearOwner("owner-a");

    // Two people had agent-2 open; one closing it does not end the reading.
    expect(registry.isViewed("agent-2")).toBe(true);
    expect(registry.isViewed("agent-1")).toBe(false);
  });

  test("a new subscription replaces what that owner was showing before", () => {
    const registry = new ViewedAgentRegistry();
    registry.setViewed("owner-a", ["agent-1"]);
    registry.setViewed("owner-a", ["agent-2"]);

    expect(registry.isViewed("agent-1")).toBe(false);
    expect(registry.isViewed("agent-2")).toBe(true);
  });
});
