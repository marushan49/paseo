import { describe, expect, test, vi } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { startAgentRun, type AgentRunController } from "./agent-prompt.js";
import type { AgentStreamEvent } from "./agent-sdk-types.js";

const OVERLOADED = JSON.stringify({
  name: "APIError",
  data: { message: "Our servers are currently overloaded.", statusCode: 503, isRetryable: true },
});

const AGENT_ID = "agent-1";

function streamOf(events: readonly AgentStreamEvent[]): AsyncGenerator<AgentStreamEvent> {
  return (async function* generate() {
    for (const event of events) {
      yield event;
    }
  })();
}

/**
 * A controller that hands out one canned stream per prompt send, so a test can say what the
 * provider did on the first attempt and what it does on the next.
 */
function createController(streams: readonly (readonly AgentStreamEvent[])[]): {
  controller: AgentRunController;
  sends: () => number;
} {
  let sends = 0;
  const controller = {
    getAgent: () => undefined,
    tryRunOutOfBand: () => false,
    hasInFlightRun: () => false,
    replaceAgentRun: () => {
      throw new Error("not used");
    },
    steerOrReplaceActiveTurn: () => {
      throw new Error("not used");
    },
    streamAgent: () => {
      const events = streams[Math.min(sends, streams.length - 1)] ?? [];
      sends += 1;
      return streamOf(events);
    },
    reloadAgentSession: async () => undefined,
  } as unknown as AgentRunController;
  return { controller, sends: () => sends };
}

const failed = (error: string): AgentStreamEvent =>
  ({ type: "turn_failed", provider: "opencode", error }) as AgentStreamEvent;
const completed = (): AgentStreamEvent =>
  ({ type: "turn_completed", provider: "opencode" }) as AgentStreamEvent;
const toolCall = (): AgentStreamEvent =>
  ({
    type: "timeline",
    provider: "opencode",
    item: { type: "tool_call", id: "t1", name: "write", status: "completed" },
  }) as unknown as AgentStreamEvent;

async function run(controller: AgentRunController): Promise<void> {
  await startAgentRun(controller, AGENT_ID, "do the thing", createTestLogger());
}

describe("provider retry", () => {
  test("sends the prompt again when the provider called its failure passing", async () => {
    const { controller, sends } = createController([[failed(OVERLOADED)], [completed()]]);
    await run(controller);
    await vi.waitFor(() => expect(sends()).toBe(2), { timeout: 8000 });
    // The second attempt completed, so nothing further is sent.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sends()).toBe(2);
  }, 15000);

  test("gives up after the third send rather than looping", async () => {
    const { controller, sends } = createController([[failed(OVERLOADED)]]);
    await run(controller);
    await vi.waitFor(() => expect(sends()).toBe(3), { timeout: 12000 });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(sends()).toBe(3);
  }, 20000);

  test("never replays a turn that already ran a tool", async () => {
    const { controller, sends } = createController([[toolCall(), failed(OVERLOADED)]]);
    await run(controller);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(sends()).toBe(1);
  }, 15000);

  test("a rejected request is not worth repeating", async () => {
    const { controller, sends } = createController([[failed("Invalid API key")]]);
    await run(controller);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(sends()).toBe(1);
  }, 15000);
});
