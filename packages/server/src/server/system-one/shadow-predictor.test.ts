import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentStreamEvent } from "../agent/agent-sdk-types.js";
import type {
  TypeSafeDecisionRequest,
  TypeSafeDecisionSource,
} from "../browser-tools/jev-client.js";
import {
  classifyToolCall,
  SHADOW_STEPS,
  ShadowPredictor,
  type ShadowRecord,
} from "./shadow-predictor.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scripted(
  choices: string[],
): TypeSafeDecisionSource & { requests: TypeSafeDecisionRequest[] } {
  const requests: TypeSafeDecisionRequest[] = [];
  return {
    requests,
    decide: async (request) => {
      requests.push(request);
      const choice = choices.shift() ?? "end_turn";
      const probabilities = Object.fromEntries(
        Object.keys(SHADOW_STEPS).map((step) => [step, step === choice ? 1 : 0]),
      );
      return {
        answers: { next: { choice, confidence: 0.9, probabilities } },
        model: "jev",
        latencyMs: 1,
      };
    },
  };
}

function toolCall(status: string, detail: Record<string, unknown>): AgentStreamEvent {
  return {
    type: "timeline",
    provider: "codex",
    item: { type: "tool_call", callId: "c1", name: "exec", status, error: null, detail },
  } as unknown as AgentStreamEvent;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("ShadowPredictor", () => {
  it("scores each prediction against the next real step, with lead time and duration", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "paseo-shadow-"));
    dirs.push(dir);
    const logFile = path.join(dir, "shadow.jsonl");
    let clock = 1_000;
    const source = scripted(["verify", "end_turn"]);
    const predictor = new ShadowPredictor({
      isEnabled: () => true,
      decisionSource: () => source,
      logFile,
      now: () => clock,
    });
    const agent = { id: "a1", provider: "codex", cwd: "/repo" };

    predictor.observe(agent, {
      type: "timeline",
      provider: "codex",
      item: { type: "user_message", text: "Fix the failing test" },
    } as AgentStreamEvent);
    await flush();
    clock = 1_500;
    predictor.observe(
      agent,
      toolCall("running", { type: "shell", command: "npx vitest run a.test.ts" }),
    );
    clock = 4_500;
    predictor.observe(
      agent,
      toolCall("completed", { type: "shell", command: "npx vitest run a.test.ts" }),
    );
    await flush();
    predictor.observe(agent, { type: "turn_completed", provider: "codex" } as AgentStreamEvent);
    await flush();

    const records = readFileSync(logFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as ShadowRecord);
    expect(records).toEqual([
      expect.objectContaining({
        predicted: "verify",
        actual: "verify",
        hit: true,
        leadMs: 500,
        stepMs: 3_000,
      }),
      expect.objectContaining({
        predicted: "end_turn",
        actual: "end_turn",
        hit: true,
        stepMs: null,
      }),
    ]);
    expect(source.requests[1]?.state).toMatchObject({
      task: "Fix the failing test",
      recentSteps: ["verify"],
    });
  });

  it("maps every provider's normalized tool detail onto the same steps", () => {
    const call = (detail: Record<string, unknown>) =>
      classifyToolCall({ callId: "x", name: "any", status: "completed", detail });
    expect(call({ type: "read" })).toBe("read");
    expect(call({ type: "search" })).toBe("search");
    expect(call({ type: "write" })).toBe("edit");
    expect(call({ type: "shell", command: "npm run typecheck" })).toBe("verify");
    expect(call({ type: "shell", command: "git status" })).toBe("shell");
    expect(call({ type: "unknown" })).toBe("mcp");
  });
});
