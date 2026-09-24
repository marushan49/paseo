import { View, Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { formatDiffCount } from "@/git/file-header-presentation";

interface DiffStatProps {
  additions: number;
  deletions: number;
  testID?: string;
  /**
   * What these two numbers measure. The sidebar's workspace figure counts the whole branch
   * against its base, uncommitted work included, while a change request line counts that one
   * change request — the same glyphs, two different questions, so the one that is not obvious
   * says which it is.
   */
  accessibilityLabel?: string;
}

export function DiffStat({ additions, deletions, testID, accessibilityLabel }: DiffStatProps) {
  return (
    <View
      style={styles.row}
      testID={testID}
      accessibilityRole={accessibilityLabel ? "text" : undefined}
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={styles.additions}>+{formatDiffCount(additions)}</Text>
      <Text style={styles.deletions}>-{formatDiffCount(deletions)}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    height: 20,
    gap: 4,
    flexShrink: 0,
  },
  additions: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.statusSuccess,
  },
  deletions: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.statusDanger,
  },
}));
