import { identityColor } from "@/styles/identity-colors";
import { StyleSheet } from "react-native-unistyles";
import { Text, View } from "react-native";
import type { ToolCallOrigin } from "./origin";

const MAX_VISIBLE_ORIGINS = 3;

export function ToolCallOriginIndicator({ origins }: { origins: readonly ToolCallOrigin[] }) {
  if (origins.length === 0) return null;

  const visibleOrigins = origins.slice(0, MAX_VISIBLE_ORIGINS);
  const hiddenCount = origins.length - visibleOrigins.length;

  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={origins.map((origin) => origin.label).join(", ")}
      testID="tool-call-origin-indicator"
    >
      {visibleOrigins.map((origin) => (
        <View key={origin.id} style={styles.tag}>
          <View style={[styles.dot, { backgroundColor: identityColor(origin.colorName) }]} />
          <Text numberOfLines={1} style={styles.label}>
            {origin.label}
          </Text>
        </View>
      ))}
      {hiddenCount > 0 ? <Text style={styles.more}>+{hiddenCount}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 1,
    marginRight: theme.spacing[2],
  },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 1,
    maxWidth: 180,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
    flexShrink: 0,
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
    minWidth: 0,
  },
  more: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
