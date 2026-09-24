import { describe, expect, it } from "vitest";
import { ARIA_SNAPSHOT_SCRIPT } from "./aria-snapshot-script.js";

describe("ARIA snapshot privacy", () => {
  it("does not use mutable input values as accessible names", () => {
    expect(ARIA_SNAPSHOT_SCRIPT).not.toContain("? element.value : null");
  });
});
