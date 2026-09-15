import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { collectAgentTranscript } from "@/agent-transcript/collect";
import { pullRequestCurationStore } from "@/git/pull-request-curation-store";
import { resolvePullRequestForAttach } from "@/git/use-attach-pull-request";
import type { ForgeSearchClient } from "@/git/use-forge-search-query";
import { scanTranscriptForPullRequests } from "@/git/scan-workspace-chat";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useWorkspace } from "@/stores/session-store-hooks";
import { useSessionStore } from "@/stores/session-store";
import { useToast } from "@/contexts/toast-api-context";

interface UseScanWorkspaceChatInput {
  serverId?: string;
  workspaceId?: string;
  workspaceKey: string;
}

/** Bounded walk: a scan must stay a background nicety, never a full export. */
const SCAN_MAX_ENTRIES = 3000;
const SCAN_MAX_PAGES = 15;

/**
 * "PRs aus dem Chat übernehmen" for a sidebar workspace row: finds the
 * workspace's most recent agent, walks a bounded transcript tail for pull
 * request references, resolves them through forge search, and records the
 * hits in the ephemeral curation store. Manual trigger by design — the
 * automatic pass belongs daemon-side with the persisted curation it will
 * own (rate limits, persistence), not as an app-startup fan-out.
 */
export function useScanWorkspaceChat(input: UseScanWorkspaceChatInput): {
  scanChat: () => Promise<void>;
  scanning: boolean;
} {
  const { t } = useTranslation();
  const toast = useToast();
  const [scanning, setScanning] = useState(false);
  const client = useHostRuntimeClient(input.serverId ?? "");
  const workspace = useWorkspace(input.serverId ?? null, input.workspaceId ?? null);

  const scanChat = useCallback(async () => {
    if (!client || !workspace?.workspaceDirectory) {
      toast.error(t("workspace.terminal.hostDisconnected"));
      return;
    }
    const agent = findScanAgent(input.serverId, input.workspaceId);
    if (!agent) {
      toast.error(t("workspace.git.pr.set.scanChatNoAgent"));
      return;
    }
    setScanning(true);
    toast.show(t("workspace.git.pr.set.scanChatPullRequests"), { durationMs: null });
    try {
      const transcript = await collectAgentTranscript({
        fetchPage: (options) => client.fetchAgentTimeline(agent.id, options),
        maxEntries: SCAN_MAX_ENTRIES,
        maxPages: SCAN_MAX_PAGES,
        maxRestarts: 0,
      });
      const searchClient: ForgeSearchClient = {
        searchForge: (options) => client.searchForge(options),
      };
      const { attached } = await scanTranscriptForPullRequests({
        entries: transcript.entries,
        resolveNumber: async (number) =>
          resolvePullRequestForAttach({
            client: searchClient,
            cwd: workspace.workspaceDirectory,
            number,
          }).catch(() => null),
      });
      for (const facts of attached) {
        pullRequestCurationStore.attach(input.workspaceKey, facts);
      }
      if (attached.length > 0) {
        toast.show(t("workspace.git.pr.set.scanChatFound", { count: attached.length }));
      } else {
        toast.show(t("workspace.git.pr.set.scanChatEmpty"));
      }
    } catch {
      toast.error(t("workspace.git.pr.set.scanChatEmpty"));
    } finally {
      setScanning(false);
    }
  }, [client, input.serverId, input.workspaceId, input.workspaceKey, workspace, t, toast]);

  return { scanChat, scanning };
}

function findScanAgent(
  serverId: string | undefined,
  workspaceId: string | undefined,
): { id: string } | null {
  if (!serverId || !workspaceId) {
    return null;
  }
  const agents = useSessionStore.getState().sessions[serverId]?.agents;
  if (!agents) {
    return null;
  }
  const candidates = [...agents.values()].filter((agent) => agent.workspaceId === workspaceId);
  candidates.sort((left, right) => right.lastActivityAt.getTime() - left.lastActivityAt.getTime());
  return candidates.find((agent) => !agent.archivedAt) ?? candidates[0] ?? null;
}
