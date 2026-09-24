import { describe, expect, it } from "vitest";
import { resolveToolCallOrigin } from "./origin";

describe("resolveToolCallOrigin", () => {
  it("identifies Browser tools by their stable tool namespace", () => {
    expect(resolveToolCallOrigin("paseo.browser_click")).toEqual({
      id: "browser",
      label: "Browser",
      colorName: "sky",
    });
  });

  it("identifies System One decisions without confusing them with provider tools", () => {
    expect(resolveToolCallOrigin("mcp__paseo__system_one_decide")).toEqual({
      id: "system-one",
      label: "System One · Jev",
      colorName: "violet",
    });
    expect(resolveToolCallOrigin("Read")).toBeNull();
  });

  it("uses a stable plugin identity hue without red or green tones", () => {
    const first = resolveToolCallOrigin("custom_tool", { pluginId: "reports" });
    const again = resolveToolCallOrigin("custom_tool", { pluginId: "reports" });
    const legacyRed = resolveToolCallOrigin("custom_tool", { pluginId: "a" });

    expect(first).toEqual(again);
    expect(first).toMatchObject({ id: "plugin:reports", label: "reports" });
    expect(["emerald", "red", "teal"]).not.toContain(first?.colorName);
    expect(legacyRed?.colorName).toBe("pink");
  });
});
