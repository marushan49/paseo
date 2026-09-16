import { useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useWorkspace } from "@/stores/session-store-hooks";
import { useToast } from "@/contexts/toast-api-context";

interface UseForgeAccountDialogInput {
  serverId?: string;
  workspaceId?: string;
}

/**
 * Which GitHub account one workspace acts as.
 *
 * The daemon already keeps a `GH_CONFIG_DIR` per workspace and hands it to the workspace's
 * agents and to Paseo's own gh calls, which is what makes a work checkout push as the work
 * account while a fork pushes as the private one. Until now that could only be set through the
 * RPC, so the feature existed and was unreachable. Emptying the field clears it back to the
 * machine's default account.
 */
export function useForgeAccountDialog(input: UseForgeAccountDialogInput): {
  forgeAccountDialog: ReactNode;
  openForgeAccountDialog: () => void;
} {
  const { t } = useTranslation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const client = useHostRuntimeClient(input.serverId ?? "");
  const workspace = useWorkspace(input.serverId ?? null, input.workspaceId ?? null);

  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);

  const handleSubmit = useCallback(
    async (value: string) => {
      if (!client || !input.workspaceId) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      const result = await client.setWorkspaceForgeAccount(input.workspaceId, value.trim());
      toast.show(
        result.forgeConfigDir
          ? t("workspace.forgeAccount.saved", { path: result.forgeConfigDir })
          : t("workspace.forgeAccount.cleared"),
      );
    },
    [client, input.workspaceId, t, toast],
  );

  return {
    forgeAccountDialog: (
      <AdaptiveRenameModal
        visible={open}
        title={t("workspace.forgeAccount.title")}
        initialValue={workspace?.forgeConfigDir ?? ""}
        placeholder={t("workspace.forgeAccount.placeholder")}
        submitLabel={t("workspace.forgeAccount.confirm")}
        maxLength={512}
        allowEmpty
        onClose={handleClose}
        onSubmit={handleSubmit}
        testID="workspace-forge-account-dialog"
      />
    ),
    openForgeAccountDialog: handleOpen,
  };
}
