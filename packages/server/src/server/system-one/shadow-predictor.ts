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
  if (detailType === "shell") return classifyShellCommand(item.detail?.command ?? "");
  return "mcp";
}

const SEARCH_COMMANDS = new Set(["rg", "grep", "ag", "ack", "fd", "find", "ls", "tree"]);
const READ_COMMANDS = new Set(["cat", "sed", "head", "tail", "nl", "less", "bat", "wc"]);

// Codex and others do most work through the shell, so a command counts as what it does.
function classifyShellCommand(command: string): ShadowStep {
  if (VERIFY_COMMAND.test(command)) return "verify";
  const words = command
    .replace(/^\s*cd\s+\S+\s*&&\s*/, "")
    .trim()
    .split(/\s+/);
  const program = words[0] === "rtk" ? words[1] : words[0];
  if (program && SEARCH_COMMANDS.has(program)) return "search";
  if (program && READ_COMMANDS.has(program)) return "read";
  return "shell";
}

export interface ShadowRecord {
  ts: string;
  agentId: string;
  provider: string;
  predicted: ShadowStep;
  confidence: number;
  actual: ShadowStep;
  hit: boolean;
  /** Jev's second choice also counts; tells whether prefetching two candidates would pay off. */
  top2Hit: boolean;
  jevMs: number;
  /** Time the agent's model spent deciding this step: from the previous event to its start. */
  thinkMs: number | null;
  /** Time between the prediction being ready and the real step starting; negative means too late. */
  leadMs: number;
  /** How long the real step took; a hit that was ready in time could have saved up to this. */
  stepMs: number | null;
}

interface PendingPrediction {
  predicted: ShadowStep;
  top2: ShadowStep[];
  confidence: number;
  jevMs: number;
  readyAt: number;
}

interface OpenCall {
  startedAt: number;
  thinkMs: number | null;
  prediction: Promise<PendingPrediction | null> | null;
}

interface AgentShadowState {
  task: string;
  recent: Array<{ step: ShadowStep; ok: boolean }>;
  pending: Promise<PendingPrediction | null> | null;
  openCalls: Map<string, OpenCall>;
  lastEventAt: number | null;
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
      const prediction = state.pending;
      state.pending = null;
      const now = this.now();
      const thinkMs = state.lastEventAt === null ? null : now - state.lastEventAt;
      state.lastEventAt = null;
      void this.record(agent, prediction, "end_turn", now, null, thinkMs);
    }
  }

  private observeItem(agent: ShadowAgent, state: AgentShadowState, item: AgentTimelineItem): void {
    if (item.type === "user_message") {
      if (!state.task) state.task = item.text.slice(0, MAX_TASK_CHARS);
      state.lastEventAt = this.now();
      state.pending = this.predict(agent, state);
      return;
    }
    if (item.type !== "tool_call") return;
    const call = item as unknown as ToolCallItem;
    let open = state.openCalls.get(call.callId);
    if (!open) {
      const startedAt = this.now();
      const thinkMs = state.lastEventAt === null ? null : startedAt - state.lastEventAt;
      open = { startedAt, thinkMs, prediction: state.pending };
      state.pending = null;
      state.openCalls.set(call.callId, open);
    }
    if (call.status === "running") return;
    state.openCalls.delete(call.callId);
    // The finished event carries the full detail; the running one may not.
    const step = classifyToolCall(call);
    state.recent = [...state.recent, { step, ok: call.status === "completed" }].slice(-MAX_RECENT);
    state.lastEventAt = this.now();
    state.pending = this.predict(agent, state);
    void this.record(
      agent,
      open.prediction,
      step,
      open.startedAt,
      this.now() - open.startedAt,
      open.thinkMs,
    );
  }

  private async record(
    agent: ShadowAgent,
    pending: Promise<PendingPrediction | null> | null,
    actual: ShadowStep,
    startedAt: number,
    stepMs: number | null,
    thinkMs: number | null,
  ): Promise<void> {
    const prediction = await pending;
    if (!prediction) return;
    await this.write({
      ts: new Date().toISOString(),
      agentId: agent.id,
      provider: agent.provider,
      predicted: prediction.predicted,
      confidence: prediction.confidence,
      actual,
      hit: prediction.predicted === actual,
      top2Hit: prediction.top2.includes(actual),
      jevMs: prediction.jevMs,
      thinkMs,
      leadMs: startedAt - prediction.readyAt,
      stepMs,
    });
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
      const top2 = Object.entries(answer.probabilities)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 2)
        .map(([step]) => step as ShadowStep);
      return {
        predicted: answer.choice as ShadowStep,
        top2,
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
      state = { task: "", recent: [], pending: null, openCalls: new Map(), lastEventAt: null };
      this.agents.set(agentId, state);
    }
    return state;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}
