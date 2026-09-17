import { describe, expect, it } from "vitest";

import {
  VerifyRecipeListRequestSchema,
  VerifyRecipeListResponseSchema,
  VerifyRecipeRunRequestSchema,
  VerifyRecipeRunResponseSchema,
} from "./rpc-schemas.js";

describe("verify rpc schemas", () => {
  it("parses list request and response", () => {
    expect(
      VerifyRecipeListRequestSchema.parse({
        type: "verify.recipe.list.request",
        workspaceId: "wks_1",
        requestId: "req_1",
      }).type,
    ).toBe("verify.recipe.list.request");

    const response = VerifyRecipeListResponseSchema.parse({
      type: "verify.recipe.list.response",
      payload: {
        requestId: "req_1",
        workspaceId: "wks_1",
        recipes: [{ name: "verify-case-report", params: ["caseId"], stepCount: 6 }],
        error: null,
      },
    });
    expect(response.payload.recipes).toHaveLength(1);
  });

  it("parses run request with params and compact run results", () => {
    const request = VerifyRecipeRunRequestSchema.parse({
      type: "verify.recipe.run.request",
      workspaceId: "wks_1",
      recipeName: "verify-case-report",
      params: { caseId: "abc" },
      requestId: "req_2",
    });
    expect(request.params).toEqual({ caseId: "abc" });

    const response = VerifyRecipeRunResponseSchema.parse({
      type: "verify.recipe.run.response",
      payload: {
        requestId: "req_2",
        workspaceId: "wks_1",
        result: {
          status: "pass",
          recipe: "verify-case-report",
          workspaceId: "wks_1",
          runId: "evr_1",
          profile: "aip-dev",
          authReused: true,
          route: "/en/case/abc",
          checks: [{ name: "authentication", ok: true, detail: "reused session" }],
          consoleErrors: 0,
          failedRequests: 0,
          evidenceRef: "evidence://wks_1/evr_1",
          rawBytes: 1024,
          agentBytes: 256,
        },
        error: null,
      },
    });
    expect(response.payload.result?.status).toBe("pass");
  });

  it("tolerates unknown future fields on responses", () => {
    const response = VerifyRecipeRunResponseSchema.parse({
      type: "verify.recipe.run.response",
      payload: {
        requestId: "req_2",
        workspaceId: "wks_1",
        result: null,
        error: "boom",
        futureField: "ignored",
      },
    });
    expect(response.payload.error).toBe("boom");
  });
});
