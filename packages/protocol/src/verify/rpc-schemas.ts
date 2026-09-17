import { z } from "zod";

export const VerifyRecipeSummarySchema = z.object({
  name: z.string().min(1),
  profile: z.string().min(1).optional(),
  params: z.array(z.string()),
  stepCount: z.number().int().nonnegative(),
});

export const VerifyCheckResultSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  detail: z.string().optional(),
});

export const VerifyRunResultSchema = z.object({
  status: z.enum(["pass", "fail"]),
  recipe: z.string(),
  workspaceId: z.string(),
  runId: z.string().nullable(),
  profile: z.string().nullable(),
  authReused: z.boolean().nullable(),
  route: z.string().nullable(),
  checks: z.array(VerifyCheckResultSchema),
  consoleErrors: z.number().int().nonnegative(),
  failedRequests: z.number().int().nonnegative(),
  evidenceRef: z.string().nullable(),
  rawBytes: z.number().int().nonnegative(),
  agentBytes: z.number().int().nonnegative(),
  error: z.string().optional(),
});

export const VerifyRecipeListRequestSchema = z.object({
  type: z.literal("verify.recipe.list.request"),
  workspaceId: z.string(),
  requestId: z.string(),
});

export const VerifyRecipeListResponseSchema = z.object({
  type: z.literal("verify.recipe.list.response"),
  payload: z.object({
    requestId: z.string(),
    workspaceId: z.string(),
    recipes: z.array(VerifyRecipeSummarySchema),
    error: z.string().nullable(),
  }),
});

export const VerifyRecipeRunRequestSchema = z.object({
  type: z.literal("verify.recipe.run.request"),
  workspaceId: z.string(),
  recipeName: z.string(),
  params: z.record(z.string(), z.string()).optional(),
  requestId: z.string(),
});

export const VerifyRecipeRunResponseSchema = z.object({
  type: z.literal("verify.recipe.run.response"),
  payload: z.object({
    requestId: z.string(),
    workspaceId: z.string(),
    result: VerifyRunResultSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export type VerifyRecipeSummary = z.infer<typeof VerifyRecipeSummarySchema>;
export type VerifyCheckResult = z.infer<typeof VerifyCheckResultSchema>;
export type VerifyRunResult = z.infer<typeof VerifyRunResultSchema>;
export type VerifyRecipeListRequest = z.infer<typeof VerifyRecipeListRequestSchema>;
export type VerifyRecipeListResponse = z.infer<typeof VerifyRecipeListResponseSchema>;
export type VerifyRecipeRunRequest = z.infer<typeof VerifyRecipeRunRequestSchema>;
export type VerifyRecipeRunResponse = z.infer<typeof VerifyRecipeRunResponseSchema>;

export const EvidenceTimelineCursorSchema = z.object({
  epoch: z.string(),
  seq: z.number().int().nonnegative(),
});

export const EvidenceArtifactSummarySchema = z.object({
  name: z.string(),
  kind: z.string(),
  contentType: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string(),
  capturedAt: z.string().optional(),
  timelineCursor: EvidenceTimelineCursorSchema.optional(),
});

export const EvidenceRunSummarySchema = z.object({
  runId: z.string(),
  workspaceId: z.string(),
  recipe: z.string(),
  seq: z.number().int().nonnegative(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  status: z.enum(["pass", "fail", "error"]).optional(),
  agentId: z.string().optional(),
  artifactCount: z.number().int().nonnegative(),
  artifacts: z.array(EvidenceArtifactSummarySchema).optional(),
});

export const VerifyEvidenceRunListRequestSchema = z.object({
  type: z.literal("verify.evidence.run.list.request"),
  workspaceId: z.string(),
  requestId: z.string(),
});

export const VerifyEvidenceRunListResponseSchema = z.object({
  type: z.literal("verify.evidence.run.list.response"),
  payload: z.object({
    requestId: z.string(),
    workspaceId: z.string(),
    runs: z.array(EvidenceRunSummarySchema),
    error: z.string().nullable(),
  }),
});

export const VerifyEvidenceArtifactGetRequestSchema = z.object({
  type: z.literal("verify.evidence.artifact.get.request"),
  workspaceId: z.string(),
  runId: z.string(),
  name: z.string(),
  requestId: z.string(),
});

export const VerifyEvidenceArtifactGetResponseSchema = z.object({
  type: z.literal("verify.evidence.artifact.get.response"),
  payload: z.object({
    requestId: z.string(),
    workspaceId: z.string(),
    artifact: EvidenceArtifactSummarySchema.nullable(),
    dataBase64: z.string().nullable(),
    error: z.string().nullable(),
  }),
});

export type EvidenceTimelineCursor = z.infer<typeof EvidenceTimelineCursorSchema>;
export type EvidenceArtifactSummary = z.infer<typeof EvidenceArtifactSummarySchema>;
export type EvidenceRunSummary = z.infer<typeof EvidenceRunSummarySchema>;
export type VerifyEvidenceRunListRequest = z.infer<typeof VerifyEvidenceRunListRequestSchema>;
export type VerifyEvidenceRunListResponse = z.infer<typeof VerifyEvidenceRunListResponseSchema>;
export type VerifyEvidenceArtifactGetRequest = z.infer<
  typeof VerifyEvidenceArtifactGetRequestSchema
>;
export type VerifyEvidenceArtifactGetResponse = z.infer<
  typeof VerifyEvidenceArtifactGetResponseSchema
>;
