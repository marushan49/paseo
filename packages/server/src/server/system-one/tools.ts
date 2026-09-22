import { z } from "zod";
import type { DaemonConfigStore } from "../daemon-config-store.js";
import { ensureValidJson } from "../json-utils.js";
import {
  TypeSafeSystemOneClient,
  type TypeSafeDecisionRequest,
  type TypeSafeDecisionSource,
} from "../browser-tools/jev-client.js";
import type {
  PaseoToolConfig,
  PaseoToolExecutionContext,
  PaseoToolResult,
} from "../agent/tools/types.js";
import { SystemOneCredentialStore } from "./credential-store.js";

const StructuredValueSchema = z.json();
const SENSITIVE_FIELD_PATTERN =
  /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|private[_-]?key|secret)$/i;
const ChoiceQuestionSchema = z
  .object({
    type: z.literal("choice"),
    instructions: StructuredValueSchema,
    criteria: z.record(z.string().min(1), StructuredValueSchema),
  })
  .strict()
  .refine((question) => Object.keys(question.criteria).length >= 2, {
    message: "Choice questions need at least two criteria",
  });
const ScoreQuestionSchema = z
  .object({
    type: z.literal("score"),
    instructions: StructuredValueSchema,
    criteria: z.array(StructuredValueSchema).min(2).max(20),
  })
  .strict();
const NoulQuestionSchema = z
  .object({
    type: z.literal("noul"),
    instructions: StructuredValueSchema,
    criteria: StructuredValueSchema.optional(),
  })
  .strict();
const SystemOneInputSchema = z
  .object({
    state: StructuredValueSchema,
    questions: z.record(
      z.string().min(1),
      z.discriminatedUnion("type", [ChoiceQuestionSchema, ScoreQuestionSchema, NoulQuestionSchema]),
    ),
  })
  .strict()
  .superRefine((input, context) => {
    const questionCount = Object.keys(input.questions).length;
    if (questionCount < 1 || questionCount > 32) {
      context.addIssue({
        code: "custom",
        path: ["questions"],
        message: "Send between 1 and 32 independent questions in one request",
      });
    }
    if (JSON.stringify(input).length > 64_000) {
      context.addIssue({
        code: "custom",
        message: "System One input exceeds Paseo's 64 KB decision-state limit",
      });
    }
    const sensitivePath = findSensitiveFieldPath(input);
    if (sensitivePath) {
      context.addIssue({
        code: "custom",
        path: sensitivePath,
        message: "Remove secrets before sending state or questions to System One",
      });
    }
  });

function findSensitiveFieldPath(
  value: unknown,
  path: Array<string | number> = [],
): Array<string | number> | null {
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const match = findSensitiveFieldPath(entry, [...path, index]);
      if (match) return match;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_FIELD_PATTERN.test(key)) return [...path, key];
    const match = findSensitiveFieldPath(entry, [...path, key]);
    if (match) return match;
  }
  return null;
}

interface RegisterSystemOneToolsOptions {
  registerTool: (
    name: string,
    config: PaseoToolConfig,
    handler: (
      input: z.infer<typeof SystemOneInputSchema>,
      context: PaseoToolExecutionContext,
    ) => Promise<PaseoToolResult>,
  ) => void;
  paseoHome: string;
  daemonConfigStore: Pick<DaemonConfigStore, "get">;
}

export function createConfiguredSystemOneDecisionSource(
  paseoHome: string,
  daemonConfigStore: Pick<DaemonConfigStore, "get">,
): TypeSafeDecisionSource {
  return {
    async decide(request) {
      const config = daemonConfigStore.get().systemOne;
      if (!config) {
        throw new Error("System One is unavailable on this host. Update the Paseo daemon.");
      }
      if (!config.enabled) {
        throw new Error("System One is disabled. Enable it in Paseo Settings → System One.");
      }
      const credential = new SystemOneCredentialStore(paseoHome).resolve();
      if (!credential) {
        throw new Error("TypeSafe API key is not configured in Paseo Settings → System One.");
      }
      return new TypeSafeSystemOneClient({
        apiKey: credential.apiKey,
        model: config.model,
      }).decide(request);
    },
  };
}

export function registerSystemOneTools(options: RegisterSystemOneToolsOptions): void {
  options.registerTool(
    "system_one_decide",
    {
      title: "Make fast structured decisions with Jev",
      description:
        "Ask Jev one or more independent Choice, Score, or Noul questions over shared structured state. Batch every currently useful question into one call. Use this for fast routing, classification, relevance, risk, confidence, or selecting among a closed set; keep deterministic facts and multi-step reasoning in code. Never include API keys, tokens, passwords, private keys, or other secrets in state or questions.",
      inputSchema: SystemOneInputSchema,
    },
    async (input) => {
      const config = options.daemonConfigStore.get().systemOne;
      if (!config) {
        throw new Error("System One is unavailable on this host. Update the Paseo daemon.");
      }
      const result = await createConfiguredSystemOneDecisionSource(
        options.paseoHome,
        options.daemonConfigStore,
      ).decide(input as TypeSafeDecisionRequest);
      const structuredContent = ensureValidJson({
        ...result,
        minimumConfidence: config.minimumConfidence,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
      };
    },
  );
}
