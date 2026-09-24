import { z } from "zod";

const TCP_PORT_RANGE_PATTERN = /^(\d{1,5})-(\d{1,5})$/;

export const PaseoServicePortAllocationSchema = z
  .object({
    range: z.string().trim().regex(TCP_PORT_RANGE_PATTERN).optional(),
    portScript: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (value) => value.range !== undefined || value.portScript !== undefined,
    "Expected range or portScript",
  )
  .refine((value) => {
    if (!value.range) return true;
    const match = TCP_PORT_RANGE_PATTERN.exec(value.range);
    if (!match) return false;
    const start = Number(match[1]);
    const end = Number(match[2]);
    return start >= 1 && end <= 65_535 && start <= end;
  }, "Expected an inclusive TCP port range from 1-65535");

export function normalizeLifecycleCommands(commands: unknown): string[] {
  if (typeof commands === "string") {
    return commands.trim().length > 0 ? [commands] : [];
  }
  if (!Array.isArray(commands)) {
    return [];
  }
  return commands.filter((command): command is string => {
    return typeof command === "string" && command.trim().length > 0;
  });
}

export const PaseoLifecycleCommandRawSchema = z.union([z.string(), z.array(z.string())]);

export const PaseoScriptEntryRawSchema = z
  .object({
    type: z.unknown().optional(),
    command: z.unknown().optional(),
    port: z.unknown().optional(),
  })
  .passthrough();

export const PaseoWorktreeConfigRawSchema = z
  .object({
    setup: PaseoLifecycleCommandRawSchema.optional(),
    teardown: PaseoLifecycleCommandRawSchema.optional(),
    terminals: z.unknown().optional(),
    servicePorts: PaseoServicePortAllocationSchema.optional(),
  })
  .passthrough();

export const PaseoMetadataGenerationEntrySchema = z
  .object({
    instructions: z.string().optional(),
  })
  .passthrough()
  .catch({});

export const PaseoBrowserCredentialSchema = z
  .object({
    usernameEnv: z.string().trim().min(1),
    passwordEnv: z.string().trim().min(1).optional(),
    allowedOrigins: z.array(z.string().trim().min(1)).default([]),
  })
  .passthrough();

export const PaseoBrowserConfigRawSchema = z
  .object({
    defaultProfile: z.string().trim().min(1).optional(),
    credentials: z.record(z.string(), PaseoBrowserCredentialSchema).default({}),
  })
  .passthrough();

export const PaseoBrowserConfigSchema = PaseoBrowserConfigRawSchema
  // Lenient for unrelated consumers (worktree setup reads the whole config);
  // the verify runner strict-parses raw sections itself and reports recipe errors loudly.
  .catch({ credentials: {} });

const PaseoRecipeFieldTargetSchema = z
  .object({
    role: z.string().trim().min(1),
    name: z.string().trim().min(1),
  })
  .strict();

const PaseoRecipeTargetSchema = z
  .object({
    url: z.string().trim().min(1).optional(),
    service: z.string().trim().min(1).optional(),
    path: z.string().trim().min(1).optional(),
  })
  .strict();

export const PaseoRecipeStepSchema = z.discriminatedUnion("action", [
  PaseoRecipeTargetSchema.extend({
    action: z.literal("navigate"),
  }),
  z
    .object({
      action: z.literal("ensure-authenticated"),
      credential: z.string().trim().min(1),
      profile: z.string().trim().min(1).optional(),
      login: PaseoRecipeTargetSchema.extend({
        username: PaseoRecipeFieldTargetSchema,
        password: PaseoRecipeFieldTargetSchema,
        submit: PaseoRecipeFieldTargetSchema,
        successText: z.string().trim().min(1).optional(),
      }).strict(),
      check: PaseoRecipeTargetSchema.extend({
        visible: PaseoRecipeFieldTargetSchema,
      }).strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("click"),
      role: z.string().trim().min(1),
      name: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal("fill"),
      role: z.string().trim().min(1),
      name: z.string().trim().min(1),
      value: z.string().optional(),
      credential: z.string().trim().min(1).optional(),
      credentialField: z.enum(["username", "password"]).optional(),
    })
    .strict()
    .refine(
      (step) =>
        (step.value !== undefined) !==
        (step.credential !== undefined && step.credentialField !== undefined),
      "fill needs exactly one of value or credential/credentialField",
    ),
  z
    .object({
      action: z.literal("wait-text"),
      text: z.string().trim().min(1),
      timeoutMs: z.number().int().positive().max(60_000).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("assert-visible"),
      role: z.string().trim().min(1),
      name: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal("assert-text"),
      text: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal("assert-console-errors"),
      max: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      action: z.literal("assert-failed-requests"),
      max: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      action: z.literal("screenshot"),
      name: z.string().trim().min(1),
    })
    .strict(),
  // Jev drives the unscripted part; the verify checks decide whether it passed.
  z
    .object({
      action: z.literal("goal"),
      goal: z.string().trim().min(1),
      verify: z
        .array(
          z.union([
            z.object({ text: z.string().min(1) }).strict(),
            z.object({ url: z.string().min(1) }).strict(),
          ]),
        )
        .min(1),
      values: z
        .record(
          z.string().min(1),
          z
            .object({
              env: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
              description: z.string().min(1).optional(),
            })
            .strict(),
        )
        .optional(),
      maxSteps: z.number().int().min(1).max(30).optional(),
    })
    .strict(),
]);

export const PaseoVerificationRecipeSchema = z
  .object({
    profile: z.string().trim().min(1).optional(),
    params: z.array(z.string().trim().min(1)).default([]),
    steps: z.array(PaseoRecipeStepSchema).min(1),
  })
  .strict();

export const PaseoVerificationConfigRawSchema = z
  .object({
    recipes: z.record(z.string(), PaseoVerificationRecipeSchema).default({}),
  })
  .passthrough();

export const PaseoVerificationConfigSchema = PaseoVerificationConfigRawSchema
  // See PaseoBrowserConfigSchema: lenient here, strict in the verify runner.
  .catch({ recipes: {} });

export const PaseoMetadataGenerationSchema = z
  .object({
    title: PaseoMetadataGenerationEntrySchema.optional(),
    branchName: PaseoMetadataGenerationEntrySchema.optional(),
    commitMessage: PaseoMetadataGenerationEntrySchema.optional(),
    pullRequest: PaseoMetadataGenerationEntrySchema.optional(),
  })
  // COMPAT(projectMetadataAgentTitle): `agentTitle` project metadata prompts were removed
  // in v0.1.96; keep legacy paseo.json parseable until 2026-12-16.
  .passthrough()
  .catch({});

export const PaseoConfigRawSchema = z
  .object({
    worktree: PaseoWorktreeConfigRawSchema.optional(),
    scripts: z.record(z.string(), PaseoScriptEntryRawSchema).optional(),
    metadataGeneration: PaseoMetadataGenerationSchema.optional(),
    browser: PaseoBrowserConfigRawSchema.optional(),
    verification: PaseoVerificationConfigRawSchema.optional(),
  })
  .passthrough();

export const WorktreeConfigSchema = PaseoWorktreeConfigRawSchema.extend({
  setup: z.unknown().optional().transform(normalizeLifecycleCommands),
  teardown: z.unknown().optional().transform(normalizeLifecycleCommands),
})
  .passthrough()
  .catch({ setup: [], teardown: [] });

export const ScriptEntrySchema = PaseoScriptEntryRawSchema.catch({});

export const PaseoConfigSchema = PaseoConfigRawSchema.extend({
  worktree: WorktreeConfigSchema.optional(),
  scripts: z.record(z.string(), ScriptEntrySchema).optional().catch({}),
  metadataGeneration: PaseoMetadataGenerationSchema.optional(),
  browser: PaseoBrowserConfigSchema.optional(),
  verification: PaseoVerificationConfigSchema.optional(),
})
  .passthrough()
  .catch({});

export const PaseoConfigRevisionSchema = z.object({
  mtimeMs: z.number(),
  size: z.number(),
});

export const ProjectConfigRpcErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("project_not_found") }),
  z.object({ code: z.literal("invalid_project_config") }),
  z.object({
    code: z.literal("stale_project_config"),
    currentRevision: PaseoConfigRevisionSchema.nullable(),
  }),
  z.object({ code: z.literal("write_failed") }),
]);

export type PaseoScriptEntryRaw = z.infer<typeof PaseoScriptEntryRawSchema>;
export type PaseoBrowserCredential = z.infer<typeof PaseoBrowserCredentialSchema>;
export type PaseoBrowserConfig = z.infer<typeof PaseoBrowserConfigSchema>;
export type PaseoRecipeStep = z.infer<typeof PaseoRecipeStepSchema>;
export type PaseoVerificationRecipe = z.infer<typeof PaseoVerificationRecipeSchema>;
export type PaseoVerificationConfig = z.infer<typeof PaseoVerificationConfigSchema>;
export type PaseoMetadataGenerationEntry = z.infer<typeof PaseoMetadataGenerationEntrySchema>;
export type PaseoMetadataGeneration = z.infer<typeof PaseoMetadataGenerationSchema>;
export type PaseoServicePortAllocation = z.infer<typeof PaseoServicePortAllocationSchema>;
export type PaseoConfigRaw = z.infer<typeof PaseoConfigRawSchema>;
export type PaseoConfig = z.infer<typeof PaseoConfigSchema>;
export type PaseoConfigRevision = z.infer<typeof PaseoConfigRevisionSchema>;
export type ProjectConfigRpcError = z.infer<typeof ProjectConfigRpcErrorSchema>;
