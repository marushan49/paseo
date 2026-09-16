import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Check } from "lucide-react-native";
import type { ForgeAccount } from "@getpaseo/protocol/messages";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useWorkspace } from "@/stores/session-store-hooks";
import { useToast } from "@/contexts/toast-api-context";
import type { Theme } from "@/styles/theme";

const ThemedCheck = withUnistyles(Check);
const accentMapping = (theme: Theme) => ({ color: theme.colors.accent });

interface UseForgeAccountDialogInput {
  serverId?: string;
  workspaceId?: string;
}

/**
 * Which GitHub account one workspace acts as, chosen from the logins this host
 * actually has.
 *
 * The daemon keeps a `GH_CONFIG_DIR` per workspace and hands it to the workspace's
 * agents and to Paseo's own gh calls, which is what makes a work checkout push as
 * the work account while a fork pushes as the private one. The directory is how
 * `gh` thinks of an account; nobody else does, so the list shows usernames and
 * keeps the path as the small print.
 */
export function useForgeAccountDialog(input: UseForgeAccountDialogInput): {
  forgeAccountDialog: ReactNode;
  openForgeAccountDialog: () => void;
} {
  const [open, setOpen] = useState(false);
  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);

  return {
    forgeAccountDialog: open ? (
      <ForgeAccountDialog
        serverId={input.serverId}
        workspaceId={input.workspaceId}
        onClose={handleClose}
      />
    ) : null,
    openForgeAccountDialog: handleOpen,
  };
}

function ForgeAccountDialog({
  serverId,
  workspaceId,
  onClose,
}: UseForgeAccountDialogInput & { onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useHostRuntimeClient(serverId ?? "");
  const workspace = useWorkspace(serverId ?? null, workspaceId ?? null);
  const selected = workspace?.forgeConfigDir ?? null;
  const [accounts, setAccounts] = useState<ForgeAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const header = useMemo<SheetHeader>(() => ({ title: t("workspace.forgeAccount.title") }), [t]);

  useEffect(() => {
    if (!client) {
      return;
    }
    let cancelled = false;
    client
      .listForgeAccounts()
      .then((found) => {
        if (!cancelled) setAccounts(found);
        return;
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setAccounts([]);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const choose = useCallback(
    (configDir: string) => {
      if (!client || !workspaceId) {
        toast.error(t("workspace.terminal.hostDisconnected"));
        return;
      }
      setSaving(configDir);
      void client
        .setWorkspaceForgeAccount(workspaceId, configDir)
        .then((result) => {
          toast.show(
            result.forgeConfigDir
              ? t("workspace.forgeAccount.saved", { path: result.forgeConfigDir })
              : t("workspace.forgeAccount.cleared"),
          );
          onClose();
          return;
        })
        .catch((cause: unknown) => {
          toast.error(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => setSaving(null));
    },
    [client, onClose, t, toast, workspaceId],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      desktopMaxWidth={460}
      testID="workspace-forge-account-dialog"
    >
      <View style={styles.list}>
        <AccountRow
          configDir=""
          label={t("workspace.forgeAccount.defaultOption")}
          detail={t("workspace.forgeAccount.defaultDetail")}
          selected={selected === null}
          busy={saving === ""}
          onSelect={choose}
          testID="forge-account-default"
        />
        {accounts === null ? (
          <View style={styles.loading}>
            <LoadingSpinner size="small" color={styles.spinner.color} />
          </View>
        ) : null}
        {accounts?.map((account) => (
          <AccountRow
            key={account.configDir}
            configDir={account.configDir}
            label={account.username}
            detail={`${account.host} · ${account.configDir}`}
            selected={selected === account.configDir}
            busy={saving === account.configDir}
            onSelect={choose}
            testID={`forge-account-${account.username}`}
          />
        ))}
        {accounts?.length === 0 ? (
          <Text style={styles.empty}>{error ?? t("workspace.forgeAccount.empty")}</Text>
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}

function AccountRow({
  configDir,
  label,
  detail,
  selected,
  busy,
  onSelect,
  testID,
}: {
  configDir: string;
  label: string;
  detail: string;
  selected: boolean;
  busy: boolean;
  onSelect: (configDir: string) => void;
  testID: string;
}) {
  const handlePress = useCallback(() => onSelect(configDir), [configDir, onSelect]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  return (
    <Pressable
      style={styles.row}
      onPress={handlePress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      testID={testID}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowDetail} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      {busy ? <LoadingSpinner size="small" color={styles.spinner.color} /> : null}
      {selected && !busy ? <ThemedCheck size={16} uniProps={accentMapping} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    gap: theme.spacing[1],
    paddingBottom: theme.spacing[2],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  rowDetail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[0.5],
  },
  loading: {
    paddingVertical: theme.spacing[4],
    alignItems: "center",
  },
  spinner: {
    color: theme.colors.foregroundMuted,
  },
  empty: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
  },
}));
