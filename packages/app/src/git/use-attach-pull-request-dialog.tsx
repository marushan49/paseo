import { useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import {
  parseAttachPullRequestNumbers,
  submitAttachPullRequests,
} from "@/git/use-attach-pull-request";
import type { ForgeSearchClient } from "@/git/use-forge-search-query";
import { useWorkspace } from "@/stores/session-store-hooks";
import { useHostRuntimeClient } from "@/runtime/host-runtime";

interface UseAttachPullRequestDialogInput {
  serverId?: string;
  workspaceId?: string;
  workspaceKey: string;
}

/**
 * The "attach a pull request" flow for a sidebar workspace row: a number
 * prompt, resolution through the existing forge search RPC, and an
 * ephemeral store write that the meta row merges into its set. Owns its
 * dialog so any row menu (kebab or context, all three row renderers) gets
 * attach by rendering one element and calling one opener — no prop
 * threading through the row tree.
 */
export function useAttachPullRequestDialog(input: UseAttachPullRequestDialogInput): {
  attachDialog: ReactNode;
  openAttachDialog: () => void;
} {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const client = useHostRuntimeClient(input.serverId ?? "");
  const workspace = useWorkspace(input.serverId ?? null, input.workspaceId ?? null);
  const cwd = workspace?.workspaceDirectory ?? null;

  const handleOpen = useCallback(() => {
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  const handleValidate = useCallback(
    (value: string): string | null => {
      if (parseAttachPullRequestNumbers(value) === null) {
        return t("workspace.git.pr.set.attachPlaceholder");
      }
      return null;
    },
    [t],
  );

  const handleSubmit = useCallback(
    async (value: string) => {
      if (!client || !cwd) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      const searchClient: ForgeSearchClient = {
        searchForge: (options) => client.searchForge(options),
      };
      await submitAttachPullRequests({
        client: searchClient,
        cwd,
        workspaceKey: input.workspaceKey,
        rawValue: value,
        formatInvalid: () => t("workspace.git.pr.set.attachPlaceholder"),
        formatNotFound: (numbers) =>
          numbers.length === 1
            ? t("workspace.git.pr.set.attachNotFound", { number: numbers[0] })
            : t("workspace.git.pr.set.attachNotFoundMany", { numbers: numbers.join(", ") }),
      });
    },
    [client, cwd, input.workspaceKey, t],
  );

  return {
    attachDialog: (
      <AttachPullRequestDialog
        visible={open}
        onClose={handleClose}
        onValidate={handleValidate}
        onSubmit={handleSubmit}
      />
    ),
    openAttachDialog: handleOpen,
  };
}

function AttachPullRequestDialog({
  visible,
  onClose,
  onValidate,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  onValidate: (value: string) => string | null;
  onSubmit: (value: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <AdaptiveRenameModal
      visible={visible}
      title={t("workspace.git.pr.set.attachTitle")}
      initialValue=""
      placeholder={t("workspace.git.pr.set.attachPlaceholder")}
      submitLabel={t("workspace.git.pr.set.attachConfirm")}
      maxLength={8}
      onClose={onClose}
      onSubmit={onSubmit}
      validate={onValidate}
      testID="attach-pull-request-dialog"
    />
  );
}
