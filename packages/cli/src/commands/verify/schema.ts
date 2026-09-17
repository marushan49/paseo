import type { VerifyRecipeSummary, VerifyRunResult } from "@getpaseo/protocol/messages";
import type { OutputSchema } from "../../output/index.js";

export type VerifyRecipeRow = VerifyRecipeSummary;
export type VerifyRunRow = VerifyRunResult;

export const verifyRecipeSchema: OutputSchema<VerifyRecipeRow> = {
  idField: "name",
  columns: [
    { header: "NAME", field: "name", width: 24 },
    { header: "PROFILE", field: (recipe) => recipe.profile ?? "-", width: 16 },
    { header: "STEPS", field: "stepCount", width: 6, align: "right" },
    { header: "PARAMS", field: (recipe) => recipe.params.join(",") || "-", width: 32 },
  ],
};

export const verifyRunSchema: OutputSchema<VerifyRunRow> = {
  idField: "recipe",
  columns: [
    { header: "RECIPE", field: "recipe", width: 24 },
    { header: "STATUS", field: "status", width: 7 },
    {
      header: "CHECKS",
      field: (run) => `${run.checks.filter((c) => c.ok).length}/${run.checks.length}`,
      width: 7,
    },
    { header: "CONSOLE", field: "consoleErrors", width: 8, align: "right" },
    { header: "FAILED REQ", field: "failedRequests", width: 11, align: "right" },
    { header: "EVIDENCE", field: (run) => run.evidenceRef ?? "-", width: 32 },
  ],
};
