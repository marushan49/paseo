import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { collectAgentTranscript } from "@/agent-transcript/collect";
import { pullRequestCurationStore } from "@/git/pull-request-curation-store";
import { resolvePullRequestForAttach } from "@/git/use-attach-pull-request";
import type { ForgeSearchClient } from "@/git/use-forge-search-query";
import { scanTranscriptForPullRequests, type ScanRepository } from "@/git/scan-workspace-chat";
import type { ScanChatFinding } from "@/git/scan-chat-dialog";
import type { RelatedPullRequest } from "@/git/related-pull-requests";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useWorkspace } from "@/stores/session-store-hooks";
import { useSessionStore } from "@/stores/session-store";
import { useToast } from "@/contexts/toast-api-context";

interface UseScanWorkspaceChatInput {
  serverId?: string;
  workspaceId?: string;
  workspaceKey: string;
  /** Already-known pull requests, the only place the app learns its own repo. */
  pullRequests?: readonly RelatedPullRequest[];
}

/** Bounded walk per agent: a scan must stay a background nicety, never a full export. */
const SCAN_MAX_ENTRIES = 1500;
const SCAN_MAX_PAGES = 8;
/** How many of the workspace's agents to walk, most recent first. */
const SCAN_MAX_AGENTS = 3;

export interface ScanWorkspaceChatResult {
  findings: ScanChatFinding[];
  unresolved: number[];
}

/**
 * "PRs aus dem Chat übernehmen" for a sidebar workspace row: walks a bounded
 * transcript tail of the workspace's recent agents, resolves the pull requests
 * its messages name, and hands the result back for someone to confirm.
 *
 * Nothing is attached here. A scan that attaches on its own is only correct when
 * every number a conversation mentions belongs to it, and that is not how people
 * talk: the sessions that ship eight pull requests reference older ones in the
 * same breath. Deciding is the caller's job, and the person's.
 */
export function useScanWorkspaceChat(input: UseScanWorkspaceChatInput): {
  scanChat: () => Promise<ScanWorkspaceChatResult | null>;
  scanning: boolean;
} {
  const { t } = useTranslation();
  const toast = useToast();
  const [scanning, setScanning] = useState(false);
  const client = useHostRuntimeClient(input.serverId ?? "");
  const workspace = useWorkspace(input.serverId ?? null, input.workspaceId ?? null);
  const repo = useMemo(() => repositoryOf(input.pullRequests), [input.pullRequests]);

  const scanChat = useCallback(async (): Promise<ScanWorkspaceChatResult | null> => {
    if (!client || !workspace?.workspaceDirectory) {
      toast.error(t("workspace.terminal.hostDisconnected"));
      return null;
    }
    const agents = findScanAgents(input.serverId, input.workspaceId);
    if (agents.length === 0) {
      toast.error(t("workspace.git.pr.set.scanChatNoAgent"));
      return null;
    }
    setScanning(true);
    try {
      const searchClient: ForgeSearchClient = {
        searchForge: (options) => client.searchForge(options),
      };
      const entries: unknown[] = [];
      for (const agent of agents) {
        const transcript = await collectAgentTranscript({
          fetchPage: (options) => client.fetchAgentTimeline(agent.id, options),
          maxEntries: SCAN_MAX_ENTRIES,
          maxPages: SCAN_MAX_PAGES,
          maxRestarts: 0,
        });
        entries.push(...transcript.entries);
      }
      const scan = await scanTranscriptForPullRequests({
        entries,
        repo,
        resolveNumber: async (number) =>
          resolvePullRequestForAttach({
            client: searchClient,
            cwd: workspace.workspaceDirectory,
            number,
          }).catch(() => null),
      });
      if (scan.found.length === 0) {
        toast.show(t("workspace.git.pr.set.scanChatEmpty"));
        return null;
      }
      const byNumber = new Map(scan.candidates.map((entry) => [entry.number, entry.mentions]));
      return {
        findings: scan.found.map((pullRequest) => ({
          pullRequest,
          mentions: byNumber.get(pullRequest.number) ?? 0,
        })),
        unresolved: scan.unresolved,
      };
    } catch {
      toast.error(t("workspace.git.pr.set.scanChatEmpty"));
      return null;
    } finally {
      setScanning(false);
    }
  }, [client, input.serverId, input.workspaceId, repo, workspace, t, toast]);

  return { scanChat, scanning };
}

/** Records the confirmed choice, which is the only path that writes the set. */
export function attachScannedPullRequests(
  workspaceKey: string,
  pullRequests: readonly RelatedPullRequest[],
): void {
  for (const facts of pullRequests) {
    pullRequestCurationStore.attach(workspaceKey, facts);
  }
}

/**
 * The repo a workspace's pull requests live in, read off one of their URLs. A
 * workspace with no pull requests yet has nothing to compare against, and a scan
 * without that check is still better than no scan.
 */
function repositoryOf(
  pullRequests: readonly RelatedPullRequest[] | undefined,
): ScanRepository | null {
  for (const pullRequest of pullRequests ?? []) {
    const match = /https?:\/\/[^\s/]+\/([^\s/]+)\/([^\s/]+)\/pull\//.exec(pullRequest.url);
    const owner = match?.[1];
    const name = match?.[2];
    if (owner && name) {
      return { owner, name };
    }
  }
  return null;
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
