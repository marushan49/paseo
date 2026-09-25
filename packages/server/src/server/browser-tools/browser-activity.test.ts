import { describe, expect, it } from "vitest";
import type { BrowserActivityEvent } from "@getpaseo/protocol/browser-activity/rpc-schemas";
import { BrowserActivityHub } from "./browser-activity.js";

function createHub() {
  const events: BrowserActivityEvent[] = [];
  const hub = new BrowserActivityHub((event) => events.push(event));
  return { hub, events };
}

describe("BrowserActivityHub", () => {
  it("applies takeover only to the run on the same workspace and browser", () => {
    const { hub, events } = createHub();
    hub.start({ workspaceId: "ws-1", browserId: "tab-a", kind: "goal", label: "Sign in" });

    expect(hub.control({ workspaceId: "ws-2", browserId: "tab-a", action: "pause" })).toBe(false);
    expect(hub.control({ workspaceId: "ws-1", browserId: "tab-b", action: "pause" })).toBe(false);
    expect(events.at(-1)?.pauseRequested).toBe(false);

    expect(hub.control({ workspaceId: "ws-1", browserId: "tab-a", action: "pause" })).toBe(true);
    expect(events.at(-1)).toMatchObject({
      workspaceId: "ws-1",
      browserId: "tab-a",
      pauseRequested: true,
    });
  });

  it("pauses at the next checkpoint and reports the resume", async () => {
    const { hub, events } = createHub();
    const run = hub.start({ workspaceId: "ws-1", browserId: "tab-a", kind: "goal", label: "x" });
    run.update({ phase: "executing", step: 1, action: { operation: "CLICK", status: "active" } });

    expect(await run.checkpoint()).toBe(false);
    hub.control({ workspaceId: "ws-1", browserId: "tab-a", action: "pause" });
    let resumed: boolean | null = null;
    const checkpoint = run.checkpoint().then((value) => {
      resumed = value;
      return value;
    });
    await Promise.resolve();

    expect(resumed).toBeNull();
    expect(events.at(-1)).toMatchObject({ phase: "paused", pauseRequested: false, step: 1 });
    expect(events.at(-1)?.action).toBeUndefined();
    expect(hub.current()).toEqual([events.at(-1)]);

    hub.control({ workspaceId: "ws-1", browserId: "tab-a", action: "resume" });
    await checkpoint;
    expect(resumed).toBe(true);
  });

  it("cancels a pending takeover when resumed before the checkpoint", async () => {
    const { hub, events } = createHub();
    const run = hub.start({ workspaceId: "ws-1", browserId: "tab-a", kind: "goal", label: "x" });
    hub.control({ workspaceId: "ws-1", browserId: "tab-a", action: "pause" });
    hub.control({ workspaceId: "ws-1", browserId: "tab-a", action: "resume" });

    expect(events.at(-1)?.pauseRequested).toBe(false);
    expect(await run.checkpoint()).toBe(false);
  });

  it("publishes the terminal result once and forgets the run", () => {
    const { hub, events } = createHub();
    const run = hub.start({ workspaceId: "ws-1", browserId: "tab-a", kind: "recipe", label: "r" });
    run.update({
      phase: "executing",
      step: 1,
      next: { operation: "click", status: "pending" },
    });
    run.finish({ status: "passed", message: "done" });
    run.finish({ status: "failed", message: "late" });
    run.update({ phase: "executing", step: 2 });

    const terminal = events.filter((event) => event.phase === "finished");
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({ result: { status: "passed", message: "done" }, step: 1 });
    expect(terminal[0]?.next).toBeUndefined();
    expect(events.at(-1)?.phase).toBe("finished");
    expect(hub.current()).toEqual([]);
    expect(hub.control({ workspaceId: "ws-1", browserId: "tab-a", action: "pause" })).toBe(false);
  });
});
