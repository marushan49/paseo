import { describe, expect, it } from "vitest";
import type { PaseoVerificationRecipe } from "@getpaseo/protocol/paseo-config-schema";

import { interpolateRecipeParams } from "./recipe-params.js";

function recipeWithSteps(
  params: string[],
  steps: PaseoVerificationRecipe["steps"],
): PaseoVerificationRecipe {
  return { params, steps };
}

describe("interpolateRecipeParams", () => {
  it("replaces declared params in urls, paths, and text", () => {
    const result = interpolateRecipeParams({
      recipe: recipeWithSteps(
        ["caseId"],
        [
          { action: "navigate", service: "frontend", path: "/en/case/{{caseId}}" },
          { action: "assert-text", text: "Case {{caseId}}" },
        ],
      ),
      params: { caseId: "abc-123" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recipe.steps[0]).toEqual({
        action: "navigate",
        service: "frontend",
        path: "/en/case/abc-123",
      });
      expect(result.recipe.steps[1]).toEqual({ action: "assert-text", text: "Case abc-123" });
    }
  });

  it("fails naming the missing param", () => {
    const result = interpolateRecipeParams({
      recipe: recipeWithSteps(["caseId"], [{ action: "assert-text", text: "Case {{caseId}}" }]),
      params: {},
    });

    expect(result).toEqual({ ok: false, error: 'Recipe needs param "caseId"' });
  });

  it("fails on undeclared placeholders and undeclared params", () => {
    const undeclared = interpolateRecipeParams({
      recipe: recipeWithSteps([], [{ action: "assert-text", text: "Case {{caseId}}" }]),
      params: { caseId: "abc-123" },
    });
    expect(undeclared).toEqual({ ok: false, error: 'Recipe uses undeclared param "caseId"' });

    const extra = interpolateRecipeParams({
      recipe: recipeWithSteps([], [{ action: "assert-text", text: "hello" }]),
      params: { typo: "1" },
    });
    expect(extra).toEqual({ ok: false, error: 'Unknown recipe param "typo"' });
  });

  it("leaves recipes without params untouched", () => {
    const recipe = recipeWithSteps([], [{ action: "assert-console-errors", max: 0 }]);
    const result = interpolateRecipeParams({ recipe, params: {} });

    expect(result).toEqual({ ok: true, recipe });
  });
});
