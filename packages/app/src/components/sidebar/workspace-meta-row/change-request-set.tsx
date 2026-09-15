import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type GestureResponderEvent } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, ChevronRight, GitPullRequest } from "lucide-react-native";
import { openExternalUrl } from "@/utils/open-external-url";
import { PullRequestStateIcon } from "@/git/pull-request-state-icon";
import type {
  RelatedPullRequest,
  RelatedPullRequestsHealth,
  RelatedPullRequestsSummary,
} from "@/git/related-pull-requests";
import type { Theme } from "@/styles/theme";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedGitPullRequest = withUnistyles(GitPullRequest);

const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * The collapsed stand-in for several change requests: how many there are, and the worst thing
 * happening across them. It replaces the single change request and its CI on the line, because
 * a row that reports the checked-out layer's `passed` beside a red sibling reads as finished.
 *
 * Pressing it toggles the list rather than opening a link — the number is a count, not a
 * destination, and there is no single change request it could sensibly navigate to.
 */
export function ChangeRequestSetItem({
  summary,
  expanded,
  onToggle,
}: {
  summary: RelatedPullRequestsSummary;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();

  const handlePressIn = useCallback((event: GestureResponderEvent) => event.stopPropagation(), []);
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onToggle();
    },
    [onToggle],
  );

  const Chevron = expanded ? ThemedChevronDown : ThemedChevronRight;
  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      accessibilityLabel={t("workspace.git.pr.set.toggleAccessibility", {
        count: summary.total,
      })}
      hitSlop={4}
      onPressIn={handlePressIn}
      onPress={handlePress}
      style={pressableStyle}
      testID="workspace-change-request-set"
    >
      <Chevron size={12} uniProps={mutedMapping} />
      <ThemedGitPullRequest size={12} uniProps={mutedMapping} />
      <Text style={styles.countText} numberOfLines={1}>
        {t("workspace.git.pr.set.count", { count: summary.total })}
      </Text>
      {summary.health === "unknown" ? null : (
        <>
          <Text style={styles.separator}>·</Text>
          <Text style={healthTextStyle(summary.health)} numberOfLines={1}>
            {t(HEALTH_LABEL_KEYS[summary.health])}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const HEALTH_LABEL_KEYS = {
  failing: "workspace.git.pr.set.failing",
  running: "workspace.git.pr.set.running",
  passing: "workspace.git.pr.set.passing",
} as const;

/**
 * The expanded set, one change request per line, in the order the daemon resolved: stack order
 * first because that is dependency order, then the rest oldest first.
 *
 * Each line carries its own additions and deletions. They come from the same forge call that
 * resolved the set, and they are the figures that belong to a change request — unlike the
 * workspace diff stat on the row above, which measures the worktree.
 */
export function ChangeRequestSetList({
  pullRequests,
  onRemovePullRequest,
}: {
  pullRequests: readonly RelatedPullRequest[];
  /**
   * Long-press a line to cut it from this workspace's set. Absent where
   * there is nothing to curate against (previews).
   */
  onRemovePullRequest?: (number: number) => void;
}) {
  return (
    <View style={styles.list} testID="workspace-change-request-set-list">
      {pullRequests.map((pullRequest) => (
        <ChangeRequestSetRow
          key={pullRequest.number}
          pullRequest={pullRequest}
          onRemove={onRemovePullRequest}
        />
      ))}
    </View>
  );
}

function ChangeRequestSetRow({
  pullRequest,
  onRemove,
}: {
  pullRequest: RelatedPullRequest;
  onRemove?: (number: number) => void;
}) {
  const { t } = useTranslation();

  const handlePressIn = useCallback((event: GestureResponderEvent) => event.stopPropagation(), []);
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      void openExternalUrl(pullRequest.url);
    },
    [pullRequest.url],
  );
  const handleLongPress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onRemove?.(pullRequest.number);
    },
    [onRemove, pullRequest.number],
  );

  const hasDiff = pullRequest.additions !== undefined || pullRequest.deletions !== undefined;

  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={t("workspace.git.pr.accessibility.pullRequest", {
        number: pullRequest.number,
      })}
      accessibilityHint={
        onRemove
          ? t("workspace.git.pr.set.removePullRequest", { number: pullRequest.number })
          : undefined
      }
      hitSlop={4}
      onPressIn={handlePressIn}
      onPress={handlePress}
      onLongPress={onRemove ? handleLongPress : undefined}
      style={listRowStyle}
      testID={`workspace-change-request-${pullRequest.number}`}
    >
      <PullRequestStateIcon state={pullRequest.state} size={12} />
      <Text
        style={pullRequest.origin === "current" ? styles.numberTextCurrent : styles.numberText}
        numberOfLines={1}
      >
        {pullRequest.number}
      </Text>
      {pullRequest.title ? (
        <Text style={styles.titleText} numberOfLines={1}>
          {pullRequest.title}
        </Text>
      ) : null}
      {pullRequest.isDraft ? (
        <Text style={styles.draftText} numberOfLines={1}>
          {t("workspace.git.pr.set.draft")}
        </Text>
      ) : null}
      {hasDiff ? (
        <View style={styles.diff}>
          <Text style={styles.additions}>{`+${pullRequest.additions ?? 0}`}</Text>
          <Text style={styles.deletions}>{`-${pullRequest.deletions ?? 0}`}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function pressableStyle({ pressed }: { pressed: boolean }) {
  return [styles.item, pressed && styles.itemPressed];
}

function listRowStyle({ pressed }: { pressed: boolean }) {
  return [styles.listRow, pressed && styles.itemPressed];
}

const styles = StyleSheet.create((theme) => ({
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    minWidth: 0,
    flexShrink: 0,
  },
  itemPressed: {
    opacity: 0.82,
  },
  separator: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
    flexShrink: 0,
  },
  countText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
    flexShrink: 0,
  },
  // Indented to the title's rail so the list reads as belonging to the row above it rather than
  // as new rows in the sidebar.
  list: {
    marginTop: theme.spacing[1],
    gap: 2,
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    minWidth: 0,
  },
  numberText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
    flexShrink: 0,
  },
  numberTextCurrent: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
    flexShrink: 0,
    fontWeight: "600",
  },
  titleText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
    flexShrink: 1,
  },
  draftText: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
    flexShrink: 0,
  },
  diff: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 0,
  },
  additions: {
    color: theme.colors.statusSuccess,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
  },
  deletions: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
  },
  healthPassing: {
    color: theme.colors.statusSuccess,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
    flexShrink: 0,
  },
  healthFailing: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
    flexShrink: 0,
  },
  healthRunning: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
    flexShrink: 0,
  },
}));

// Read inside render, never into a module-scope table — see docs/unistyles.md.
function healthTextStyle(health: Exclude<RelatedPullRequestsHealth, "unknown">) {
  if (health === "failing") return styles.healthFailing;
  if (health === "running") return styles.healthRunning;
  return styles.healthPassing;
}
