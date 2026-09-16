import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { collectAgentTranscript } from "@/agent-transcript/collect";
import { pullRequestCurationStore } from "@/git/pull-request-curation-store";
import { resolvePullRequestForAttach } from "@/git/use-attach-pull-request";
import type { ForgeSearchClient } from "@/git/use-forge-search-query";
import { scanTranscriptForPullRequests } from "@/git/scan-workspace-chat";
import type { RelatedPullRequest } from "@/git/related-pull-requests";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useWorkspace } from "@/stores/session-store-hooks";
import { useSessionStore } from "@/stores/session-store";
import { useToast } from "@/contexts/toast-api-context";

interface UseScanWorkspaceChatInput {
  serverId?: string;
  workspaceId?: string;
  workspaceKey: string;
}

/** Bounded walk per agent: a scan must stay a background nicety, never a full export. */
const SCAN_MAX_ENTRIES = 1500;
const SCAN_MAX_PAGES = 8;
/** How many of the workspace's agents to walk, most recent first. */
const SCAN_MAX_AGENTS = 3;

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
    const agents = findScanAgents(input.serverId, input.workspaceId);
    if (agents.length === 0) {
      toast.error(t("workspace.git.pr.set.scanChatNoAgent"));
      return;
    }
    setScanning(true);
    toast.show(t("workspace.git.pr.set.scanChatPullRequests"), { durationMs: null });
    try {
      const searchClient: ForgeSearchClient = {
        searchForge: (options) => client.searchForge(options),
      };
      const attached: RelatedPullRequest[] = [];
      for (const agent of agents) {
        const transcript = await collectAgentTranscript({
          fetchPage: (options) => client.fetchAgentTimeline(agent.id, options),
          maxEntries: SCAN_MAX_ENTRIES,
          maxPages: SCAN_MAX_PAGES,
          maxRestarts: 0,
        });
        const { attached: hits } = await scanTranscriptForPullRequests({
          entries: transcript.entries,
          resolveNumber: async (number) =>
            resolvePullRequestForAttach({
              client: searchClient,
              cwd: workspace.workspaceDirectory,
              number,
            }).catch(() => null),
        });
        attached.push(...hits);
      }
      const seen = new Set<number>();
      for (const facts of attached) {
        if (seen.has(facts.number)) {
          continue;
        }
        seen.add(facts.number);
        pullRequestCurationStore.attach(input.workspaceKey, facts);
      }
      if (seen.size > 0) {
        toast.show(t("workspace.git.pr.set.scanChatFound", { count: seen.size }));
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

function findScanAgents(
  serverId: string | undefined,
  workspaceId: string | undefined,
): { id: string }[] {
  if (!serverId || !workspaceId) {
    return [];
  }
  const agents = useSessionStore.getState().sessions[serverId]?.agents;
  if (!agents) {
    return [];
  }
  const candidates = [...agents.values()].filter((agent) => agent.workspaceId === workspaceId);
  candidates.sort((left, right) => right.lastActivityAt.getTime() - left.lastActivityAt.getTime());
  // Active sessions first, archived ones still count: their timelines keep
  // the references long after the work shipped.
  const active = candidates.filter((agent) => !agent.archivedAt);
  const archived = candidates.filter((agent) => agent.archivedAt);
  return [...active, ...archived].slice(0, SCAN_MAX_AGENTS);
}
