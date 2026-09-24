import { deriveIdentityColorName, type IdentityColorName } from "@/styles/identity-colors";

export interface ToolCallOrigin {
  id: string;
  label: string;
  colorName: IdentityColorName;
}

const PLUGIN_COLOR_REPLACEMENTS: Partial<Record<IdentityColorName, IdentityColorName>> = {
  emerald: "amber",
  red: "pink",
  teal: "blue",
};

export function createPluginOrigin(pluginId: string): ToolCallOrigin {
  const derivedColor = deriveIdentityColorName(pluginId);
  return {
    id: `plugin:${pluginId}`,
    label: pluginId,
    colorName: PLUGIN_COLOR_REPLACEMENTS[derivedColor] ?? derivedColor,
  };
}

export function resolveToolCallOrigin(
  toolName: string,
  metadata?: Record<string, unknown>,
): ToolCallOrigin | null {
  const normalizedName = toolName
    .trim()
    .toLowerCase()
    .replace(/[.\s:/-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const pluginId = metadata?.pluginId;

  if (typeof pluginId === "string" && pluginId.trim()) {
    return createPluginOrigin(pluginId.trim());
  }

  if (normalizedName === "browser" || normalizedName.includes("browser_")) {
    return { id: "browser", label: "Browser", colorName: "sky" };
  }

  if (normalizedName === "system_one_decide" || normalizedName.endsWith("_system_one_decide")) {
    return { id: "system-one", label: "System One · Jev", colorName: "violet" };
  }

  return null;
}
