import { describe, expect, it } from "vitest";

import {
  reducePendingThinkingSelection,
  resolveDisplayedThinkingOptionId,
} from "./pending-thinking";

describe("reducePendingThinkingSelection", () => {
  // The daemon applies the change, persists it and broadcasts an agent_update;
  // all of that takes a round trip. The pill has to move on the click, or the
  // control reads as dead and gets clicked again.
  it("holds the pick while the agent still reports the old option", () => {
    const pending = { requested: "max", baseline: "xhigh" };
    expect(reducePendingThinkingSelection(pending, "xhigh")).toBe(pending);
    expect(resolveDisplayedThinkingOptionId(pending, "xhigh")).toBe("max");
  });

  it("lets go once the agent reports the picked option", () => {
    expect(
      reducePendingThinkingSelection({ requested: "max", baseline: "xhigh" }, "max"),
    ).toBeNull();
  });

  // A provider may normalise a pick, and a second client may set something else
  // entirely. Either way the agent has spoken, and its answer outranks the wait.
  it("lets go when the agent answers with a third option", () => {
    expect(
      reducePendingThinkingSelection({ requested: "ultracode", baseline: "xhigh" }, "high"),
    ).toBeNull();
  });

  it("shows the agent's own option when nothing is pending", () => {
    expect(reducePendingThinkingSelection(null, "xhigh")).toBeNull();
    expect(resolveDisplayedThinkingOptionId(null, "xhigh")).toBe("xhigh");
    expect(resolveDisplayedThinkingOptionId(null, null)).toBeNull();
  });
});
