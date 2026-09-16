import type { WorkspaceLabelDefinition } from "@getpaseo/protocol/workspace-labels";
import type { PrHint } from "@/git/pr-hint";
import {
  shouldPresentAsSet,
  summarizeRelatedPullRequests,
  type RelatedPullRequest,
  type RelatedPullRequestsSummary,
} from "@/git/related-pull-requests";
import type { SidebarChecksDisplay } from "@/components/sidebar/display-preferences/checks-display";
import type { SidebarRowItems } from "@/components/sidebar/display-preferences/row-items";
import { selectCheckSummary, type CheckSummary } from "./check-summary";
import type { WorkspaceServiceSummary } from "./service-summary";

/**
 * What ends up on the line under a workspace title, in the order it is read: where the
 * workspace lives, what change it belongs to, whether that change is passing, what it is
 * running, and what someone filed it under. Identity first, then the work, then the work's
 * state, then the labels a person put on it.
 *
 * Labels are one item rather than one per label: they are drawn as a run of chips with a single
 * separator in front of them, so the line reads as four peers however many labels a workspace
 * carries.
 */
export type MetaRowItem =
  | { kind: "branch"; name: string }
  | { kind: "project"; name: string }
  | { kind: "host" }
  | { kind: "changeRequest"; hint: PrHint }
  | {
      kind: "changeRequestSet";
      pullRequests: readonly RelatedPullRequest[];
      summary: RelatedPullRequestsSummary;
      /** The one change request's number when that is all there is, so the line names it. */
      soleNumber: number | null;
      expanded: boolean;
    }
  | { kind: "checks"; summary: CheckSummary; label: boolean }
  | { kind: "services"; summary: WorkspaceServiceSummary }
  | { kind: "labels"; labels: readonly WorkspaceLabelDefinition[] };

/**
 * Which peers a row should draw, given what it knows and what the user left switched on.
 *
 * Kept out of the component because this — not the markup — is the part with rules in it: every
 * toggle answers for itself, so a row can end up showing checks with no change request beside
 * them, and CI resolves from the hint even when the hint itself is not drawn.
 *
 * The host is filtered upstream, where the badge map is built: a host that should show nothing
 * has no badge to hand down, so by the time a row sees one it is meant to be drawn.
 */
export function selectMetaRowItems(input: {
  currentBranch: string | null;
  projectName: string | null;
  hasHostBadge: boolean;
  prHint: PrHint | null;
  relatedPullRequests?: readonly RelatedPullRequest[];
  setExpanded?: boolean;
  serviceSummary: WorkspaceServiceSummary | null;
  labels: readonly WorkspaceLabelDefinition[];
  visible: SidebarRowItems;
  checksDisplay: SidebarChecksDisplay;
}): MetaRowItem[] {
  const {
    currentBranch,
    projectName,
    hasHostBadge,
    prHint,
    serviceSummary,
    labels,
    visible,
    checksDisplay,
  } = input;
  const relatedPullRequests = input.relatedPullRequests ?? [];
  const asSet = shouldPresentAsSet(relatedPullRequests);
  const items: MetaRowItem[] = [];

  if (currentBranch && visible.branch) {
    items.push({ kind: "branch", name: currentBranch });
  }
  if (projectName && visible.project) {
    items.push({ kind: "project", name: projectName });
  }
  if (hasHostBadge) {
    items.push({ kind: "host" });
  }
  // A set replaces both the single change request and the separate CI item: it already reports
  // the worst state across every layer, and leaving the checked-out layer's own `passed` beside
  // it is the reading that sends you away from a red sibling.
  if (asSet && visible.changeRequest) {
    items.push({
      kind: "changeRequestSet",
      pullRequests: relatedPullRequests,
      summary: summarizeRelatedPullRequests(relatedPullRequests),
      soleNumber: soleChangeRequestNumber(relatedPullRequests),
      expanded: input.setExpanded === true,
    });
  } else if (prHint && visible.changeRequest) {
    items.push({ kind: "changeRequest", hint: prHint });
  }

  // Independent of the change request, even though checks are read off one. Tying them together
  // meant the checks setting could sit on a value while nothing was drawn, which is a control that
  // lies about its own state. Showing checks without the change request beside them is the
  // stranger combination, but it is the one you asked for and it is what you get.
  if (checksDisplay !== "none" && !(asSet && visible.changeRequest)) {
    const summary = selectCheckSummary(prHint);
    if (summary) {
      items.push({ kind: "checks", summary, label: checksDisplay === "iconAndText" });
    }
  }

  if (serviceSummary && visible.services) {
    items.push({ kind: "services", summary: serviceSummary });
  }

  if (labels.length > 0 && visible.labels) {
    items.push({ kind: "labels", labels });
  }

  return items;
}

/** The number to name on the collapsed line, or null when the set has more than one. */
function soleChangeRequestNumber(pullRequests: readonly RelatedPullRequest[]): number | null {
  if (pullRequests.length !== 1) {
    return null;
  }
  return pullRequests[0]?.number ?? null;
}
