import type { AgentPromptInput } from "../agent/agent-sdk-types.js";
import { parseChoiceAnswer, type TypeSafeChoiceQuestion } from "../browser-tools/jev-client.js";
import type { DaemonConfigStore } from "../daemon-config-store.js";
import { loadPersistedConfig } from "../persisted-config.js";
import { isSystemOneExcluded } from "./scope.js";
import { createConfiguredSystemOneDecisionSource } from "./tools.js";

const MAX_TASK_CHARS = 6_000;

export interface TurnRouteInput {
  provider: string;
  cwd: string;
  model: string | undefined;
  thinkingOptionId: string | undefined;
  prompt: AgentPromptInput;
}

export interface TurnRoute {
  model?: string;
  thinkingOptionId?: string;
}

export type TurnRouter = (input: TurnRouteInput) => Promise<TurnRoute | null>;

/**
 * Jev picks the cheapest sufficient model and thinking depth for each turn, from
 * the per-provider ladders in `daemon.systemOne.routing` (cheapest first).
 */
export function createSystemOneTurnRouter(options: {
  paseoHome: string;
  daemonConfigStore: Pick<DaemonConfigStore, "get">;
}): TurnRouter {
  return async (input) => {
    const systemOne = options.daemonConfigStore.get().systemOne;
    const ladder = loadPersistedConfig(options.paseoHome).daemon?.systemOne?.routing?.[
      input.provider
    ];
    if (!systemOne?.enabled || !ladder || isSystemOneExcluded(options.paseoHome, input.cwd)) {
      return null;
    }
    const task = promptText(input.prompt).slice(0, MAX_TASK_CHARS);
    if (task.trim().length === 0) return null;

    const questions: Record<string, TypeSafeChoiceQuestion> = {
      model: {
        type: "choice",
        instructions:
          "Pick the least capable model tier that will still do this coding-agent task well. Cheaper tiers save real money; only escalate when the task needs it.",
        criteria: tierCriteria(ladder.models.length, MODEL_TIER_TEXT),
      },
    };
    if (ladder.thinking) {
      questions.thinking = {
        type: "choice",
        instructions: "Pick the minimum reasoning depth that is still sufficient for this task.",
        criteria: tierCriteria(ladder.thinking.length, THINKING_TIER_TEXT),
      };
    }
    const decision = await createConfiguredSystemOneDecisionSource(
      options.paseoHome,
      options.daemonConfigStore,
      () => input.cwd,
    ).decide({
      state: { task, provider: input.provider, currentModel: input.model ?? null },
      questions,
    });

    const route: TurnRoute = {};
    const model = pickTier(decision.answers.model, ladder.models, systemOne.minimumConfidence);
    if (model) route.model = model;
    if (ladder.thinking) {
      const thinking = pickTier(
        decision.answers.thinking,
        ladder.thinking,
        systemOne.minimumConfidence,
      );
      if (thinking) route.thinkingOptionId = thinking;
    }
    return Object.keys(route).length > 0 ? route : null;
  };
}

const MODEL_TIER_TEXT = {
  lowest: "trivial questions, lookups, status checks, small mechanical edits",
  middle: "routine implementation, known-cause fixes, straightforward tests",
  highest: "architecture, hard debugging, security, migrations, risky cross-file changes",
};

const THINKING_TIER_TEXT = {
  lowest: "the answer is obvious or the step is mechanical",
  middle: "a few options must be weighed or a moderate plan is needed",
  highest: "deep multi-step reasoning with subtle trade-offs",
};

function tierCriteria(
  count: number,
  text: { lowest: string; middle: string; highest: string },
): Record<string, string> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `tier${index + 1}`,
      `Tier ${index + 1} of ${count} (1 = cheapest): ${tierFit(index, count, text)}`,
    ]),
  );
}

function tierFit(
  index: number,
  count: number,
  text: { lowest: string; middle: string; highest: string },
): string {
  if (index === 0) return text.lowest;
  if (index === count - 1) return text.highest;
  return text.middle;
}

// Low confidence keeps the current setting rather than guessing.
function pickTier(answer: unknown, ladder: string[], minimumConfidence: number): string | null {
  const choices = ladder.map((_, index) => `tier${index + 1}`);
  const parsed = parseChoiceAnswer(answer, choices);
  if (parsed.confidence < minimumConfidence) return null;
  return ladder[choices.indexOf(parsed.choice)] ?? null;
}

function promptText(prompt: AgentPromptInput): string {
  if (typeof prompt === "string") return prompt;
  return prompt
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
}
