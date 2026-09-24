import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { AgentStreamEvent, AgentTimelineItem } from "../agent/agent-sdk-types.js";
import { parseChoiceAnswer, type TypeSafeDecisionSource } from "../browser-tools/jev-client.js";

/**
 * Shadow mode: after every finished tool call, Jev predicts the next step of the
 * agent, and the real next step scores it. Nothing is changed or executed; the
 * log tells whether speculative prefetching would pay off, per provider.
 */

export const SHADOW_STEPS = {
  read: "Read a file",
  search: "Search the code (grep, glob, find)",
  edit: "Edit or write a file",
  verify: "Run tests, lint, typecheck, or a build",
  shell: "Run another shell command",
  fetch: "Fetch a URL or search the web",
  sub_agent: "Start a subagent or delegate",
  mcp: "Call an MCP or Paseo tool",
  end_turn: "Stop using tools and answer the user",
} as const;

export type ShadowStep = keyof typeof SHADOW_STEPS;

const VERIFY_COMMAND = /\b(test|vitest|jest|pytest|lint|typecheck|tsc|build|cargo check|go vet)\b/i;
const MAX_RECENT = 8;
const MAX_TASK_CHARS = 2_000;

interface ToolCallItem {
  callId: string;
  name: string;
  status: string;
  detail?: { type?: string; command?: string };
}

export function classifyToolCall(item: ToolCallItem): ShadowStep {
  const detailType = item.detail?.type;
  if (detailType === "read") return "read";
  if (detailType === "search") return "search";
  if (detailType === "edit" || detailType === "write") return "edit";
  if (detailType === "fetch") return "fetch";
  if (detailType === "sub_agent") return "sub_agent";
  if (detailType === "shell") {
    return VERIFY_COMMAND.test(item.detail?.command ?? "") ? "verify" : "shell";
  }
  return "mcp";
}

export interface ShadowRecord {
  ts: string;
  agentId: string;
  provider: string;
  predicted: ShadowStep;
  confidence: number;
  actual: ShadowStep;
  hit: boolean;
  jevMs: number;
  /** Time between the prediction being ready and the real step starting; negative means too late. */
  leadMs: number;
  /** How long the real step took; a hit that was ready in time could have saved up to this. */
  stepMs: number | null;
}

interface PendingPrediction {
  predicted: ShadowStep;
  confidence: number;
  jevMs: number;
  readyAt: number;
}

interface OpenCall {
  step: ShadowStep;
  startedAt: number;
  endedAt: number | null;
  record: Omit<ShadowRecord, "stepMs"> | null;
}

interface AgentShadowState {
  task: string;
  recent: Array<{ step: ShadowStep; ok: boolean }>;
  pending: Promise<PendingPrediction | null> | null;
  openCalls: Map<string, OpenCall>;
}

export interface ShadowAgent {
  id: string;
  provider: string;
  cwd: string;
}

export class ShadowPredictor {
  private readonly agents = new Map<string, AgentShadowState>();

  public constructor(
    private readonly options: {
      isEnabled: (cwd: string) => boolean;
      decisionSource: (cwd: string) => TypeSafeDecisionSource;
      logFile: string;
      now?: () => number;
    },
  ) {}

  public observe(agent: ShadowAgent, event: AgentStreamEvent): void {
    if (!this.options.isEnabled(agent.cwd)) return;
    const state = this.stateFor(agent.id);
    if (event.type === "timeline") {
      this.observeItem(agent, state, event.item);
    } else if (event.type === "turn_completed") {
      void this.score(agent, state, "end_turn", null);
    }
  }

  private observeItem(agent: ShadowAgent, state: AgentShadowState, item: AgentTimelineItem): void {
    if (item.type === "user_message") {
      if (!state.task) state.task = item.text.slice(0, MAX_TASK_CHARS);
      state.pending = this.predict(agent, state);
      return;
    }
    if (item.type !== "tool_call") return;
    const call = item as unknown as ToolCallItem;
    const open = state.openCalls.get(call.callId);
    if (!open) {
      const step = classifyToolCall(call);
      const entry: OpenCall = { step, startedAt: this.now(), endedAt: null, record: null };
      state.openCalls.set(call.callId, entry);
      void this.score(agent, state, step, entry);
      if (call.status === "running") return;
    }
    if (call.status === "running") return;
    const finished = state.openCalls.get(call.callId);
    if (!finished) return;
    state.openCalls.delete(call.callId);
    state.recent = [
      ...state.recent,
      { step: finished.step, ok: call.status === "completed" },
    ].slice(-MAX_RECENT);
    finished.endedAt = this.now();
    // The score may still be waiting for Jev; whichever side finishes last writes.
    if (finished.record) void this.writeCall(finished);
    state.pending = this.predict(agent, state);
  }

  private async score(
    agent: ShadowAgent,
    state: AgentShadowState,
    actual: ShadowStep,
    call: OpenCall | null,
  ): Promise<void> {
    const pendingPromise = state.pending;
    state.pending = null;
    if (!pendingPromise) return;
    const startedAt = call?.startedAt ?? this.now();
    const prediction = await pendingPromise;
    if (!prediction) return;
    const record: Omit<ShadowRecord, "stepMs"> = {
      ts: new Date().toISOString(),
      agentId: agent.id,
      provider: agent.provider,
      predicted: prediction.predicted,
      confidence: prediction.confidence,
      actual,
      hit: prediction.predicted === actual,
      jevMs: prediction.jevMs,
      leadMs: startedAt - prediction.readyAt,
    };
    if (!call) {
      await this.write({ ...record, stepMs: null });
      return;
    }
    call.record = record;
    if (call.endedAt !== null) await this.writeCall(call);
  }

  private async writeCall(call: OpenCall): Promise<void> {
    if (!call.record || call.endedAt === null) return;
    const record = call.record;
    call.record = null;
    await this.write({ ...record, stepMs: call.endedAt - call.startedAt });
  }

  private async predict(
    agent: ShadowAgent,
    state: AgentShadowState,
  ): Promise<PendingPrediction | null> {
    const startedAt = this.now();
    try {
      const decision = await this.options.decisionSource(agent.cwd).decide({
        state: {
          task: state.task || "(unknown)",
          provider: agent.provider,
          recentSteps: state.recent.map((entry) => `${entry.step}${entry.ok ? "" : " (failed)"}`),
        },
        questions: {
          next: {
            type: "choice",
            instructions:
              "A coding agent just finished the last of recentSteps while working on task. Predict its very next step.",
            criteria: { ...SHADOW_STEPS },
          },
        },
      });
      const answer = parseChoiceAnswer(decision.answers.next, Object.keys(SHADOW_STEPS));
      return {
        predicted: answer.choice as ShadowStep,
        confidence: answer.confidence,
        jevMs: this.now() - startedAt,
        readyAt: this.now(),
      };
    } catch {
      return null;
    }
  }

  private async write(record: ShadowRecord): Promise<void> {
    try {
      await mkdir(path.dirname(this.options.logFile), { recursive: true });
      await appendFile(this.options.logFile, `${JSON.stringify(record)}\n`);
    } catch {
      // Shadow mode must never affect the agent.
    }
  }

  private stateFor(agentId: string): AgentShadowState {
    let state = this.agents.get(agentId);
    if (!state) {
      state = { task: "", recent: [], pending: null, openCalls: new Map() };
      this.agents.set(agentId, state);
    }
    return state;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}
