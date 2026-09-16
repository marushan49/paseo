import { useCallback } from "react";
import { useAttachPullRequestDialog } from "@/git/use-attach-pull-request-dialog";
import { useScanWorkspaceChat } from "@/git/use-scan-workspace-chat";
import type { RelatedPullRequest } from "@/git/related-pull-requests";
import { ChangeRequestSetList } from "./change-request-set";

/**
 * The expanded set with its two ways of growing wired up: the attach prompt and the chat scan.
 * Both need a host to ask, so they live in this thin shell rather than in the meta row — a row
 * whose workspace has no server keeps rendering the plain list and nothing breaks.
 */
export function ManagedChangeRequestSetList({
  serverId,
  workspaceId,
  workspaceKey,
  pullRequests,
  onRemovePullRequest,
}: {
  serverId: string;
  workspaceId: string;
  workspaceKey: string;
  pullRequests: readonly RelatedPullRequest[];
  onRemovePullRequest: (number: number) => void;
}) {
  const { attachDialog, openAttachDialog } = useAttachPullRequestDialog({
    serverId,
    workspaceId,
    workspaceKey,
  });
  const { scanChat, scanning } = useScanWorkspaceChat({ serverId, workspaceId, workspaceKey });
  const handleScanChat = useCallback(() => {
    void scanChat();
  }, [scanChat]);

  return (
    <>
      <ChangeRequestSetList
        pullRequests={pullRequests}
        onRemovePullRequest={onRemovePullRequest}
        onAttachPullRequest={openAttachDialog}
        onScanChat={handleScanChat}
        scanning={scanning}
      />
      {attachDialog}
    </>
  );
}
