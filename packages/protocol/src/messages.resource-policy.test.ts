import { describe, expect, test } from "vitest";

import { MutableDaemonConfigPatchSchema, MutableDaemonConfigSchema } from "./messages.js";

describe("resource policy messages", () => {
  test("defaults the mutable daemon config to balanced", () => {
    expect(
      MutableDaemonConfigSchema.parse({
        mcp: { injectIntoAgents: false },
      }).resourcePolicy,
    ).toBe("balanced");
  });

  test("validates policy patches", () => {
    expect(MutableDaemonConfigPatchSchema.parse({ resourcePolicy: "deep" })).toEqual({
      resourcePolicy: "deep",
    });
    expect(MutableDaemonConfigPatchSchema.safeParse({ resourcePolicy: "unlimited" }).success).toBe(
      false,
    );
  });
});
