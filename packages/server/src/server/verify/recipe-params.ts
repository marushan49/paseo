import type { PaseoVerificationRecipe } from "@getpaseo/protocol/paseo-config-schema";

export interface InterpolateRecipeParamsInput {
  recipe: PaseoVerificationRecipe;
  params: Record<string, string>;
}

export type InterpolateRecipeParamsResult =
  | { ok: true; recipe: PaseoVerificationRecipe }
  | { ok: false; error: string };

const PARAM_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export function interpolateRecipeParams(
  input: InterpolateRecipeParamsInput,
): InterpolateRecipeParamsResult {
  const declared = new Set(input.recipe.params ?? []);
  const used = new Set<string>();
  collectParamNames(input.recipe, used);
  for (const name of used) {
    if (!declared.has(name)) {
      return { ok: false, error: `Recipe uses undeclared param "${name}"` };
    }
    if (input.params[name] === undefined) {
      return { ok: false, error: `Recipe needs param "${name}"` };
    }
  }
  for (const name of Object.keys(input.params)) {
    if (!declared.has(name)) {
      return { ok: false, error: `Unknown recipe param "${name}"` };
    }
  }
  const interpolate = (value: string): string =>
    value.replace(PARAM_PATTERN, (_match, name: string) => input.params[name] ?? "");
  const steps = input.recipe.steps.map((step) => interpolateStep(step, interpolate));
  return { ok: true, recipe: { ...input.recipe, steps } };
}

function collectParamNames(recipe: PaseoVerificationRecipe, into: Set<string>): void {
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      PARAM_PATTERN.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = PARAM_PATTERN.exec(value)) !== null) {
        into.add(match[1]);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry);
      }
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const entry of Object.values(value)) {
        visit(entry);
      }
    }
  };
  visit(recipe.steps);
}

function interpolateStep(
  step: PaseoVerificationRecipe["steps"][number],
  interpolate: (value: string) => string,
): PaseoVerificationRecipe["steps"][number] {
  switch (step.action) {
    case "navigate":
      return {
        ...step,
        ...(step.url ? { url: interpolate(step.url) } : {}),
        ...(step.path ? { path: interpolate(step.path) } : {}),
      };
    case "ensure-authenticated":
      return {
        ...step,
        login: {
          ...step.login,
          ...(step.login.url ? { url: interpolate(step.login.url) } : {}),
          ...(step.login.path ? { path: interpolate(step.login.path) } : {}),
        },
        check: {
          ...step.check,
          ...(step.check.url ? { url: interpolate(step.check.url) } : {}),
          ...(step.check.path ? { path: interpolate(step.check.path) } : {}),
        },
      };
    case "click":
      return { ...step, name: interpolate(step.name) };
    case "fill":
      return {
        ...step,
        name: interpolate(step.name),
        ...(step.value !== undefined ? { value: interpolate(step.value) } : {}),
      };
    case "wait-text":
      return { ...step, text: interpolate(step.text) };
    case "assert-visible":
      return { ...step, name: interpolate(step.name) };
    case "assert-text":
      return { ...step, text: interpolate(step.text) };
    case "screenshot":
      return { ...step, name: interpolate(step.name) };
    case "assert-console-errors":
    case "assert-failed-requests":
      return step;
  }
}
