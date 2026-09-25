import type { TFunction } from "i18next";
import { create } from "zustand";
import type {
  BrowserActivityEvent,
  BrowserActivityStep,
} from "@getpaseo/protocol/browser-activity/rpc-schemas";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

function activityKey(serverId: string, workspaceId: string, browserId: string): string {
  return `${serverId}\u0000${workspaceId}\u0000${browserId}`;
}

interface BrowserActivityState {
  byBrowser: Record<string, BrowserActivityEvent>;
  apply: (serverId: string, event: BrowserActivityEvent) => void;
  /** A new subscription re-sends live runs; drop the ones that ended while disconnected. */
  resetServer: (serverId: string) => void;
  dismiss: (serverId: string, event: BrowserActivityEvent) => void;
}

export const useBrowserActivityStore = create<BrowserActivityState>((set) => ({
  byBrowser: {},
  apply: (serverId, event) =>
    set((state) => ({
      byBrowser: {
        ...state.byBrowser,
        [activityKey(serverId, event.workspaceId, event.browserId)]: event,
      },
    })),
  resetServer: (serverId) =>
    set((state) => ({
      byBrowser: Object.fromEntries(
        Object.entries(state.byBrowser).filter(
          ([key, event]) => !key.startsWith(`${serverId}\u0000`) || event.phase === "finished",
        ),
      ),
    })),
  dismiss: (serverId, event) =>
    set((state) => {
      const key = activityKey(serverId, event.workspaceId, event.browserId);
      if (state.byBrowser[key]?.runId !== event.runId) return state;
      const { [key]: _dismissed, ...byBrowser } = state.byBrowser;
      return { byBrowser };
    }),
}));

export function useBrowserActivity(
  serverId: string,
  workspaceId: string,
  browserId: string | null | undefined,
): BrowserActivityEvent | null {
  return useBrowserActivityStore((state) =>
    browserId ? (state.byBrowser[activityKey(serverId, workspaceId, browserId)] ?? null) : null,
  );
}

export function isBrowserRunActive(event: BrowserActivityEvent | null): boolean {
  return event !== null && event.phase !== "finished";
}

/** Input stays with the run until it pauses at a safe boundary. */
export function isBrowserRunLocked(event: BrowserActivityEvent | null): boolean {
  return isBrowserRunActive(event) && event?.phase !== "paused";
}

export function browserActivityStatusBucket(
  event: BrowserActivityEvent | null,
): SidebarStateBucket | null {
  if (!event) return null;
  if (event.phase === "paused") return "needs_input";
  if (event.phase !== "finished") return "running";
  return event.result?.status === "failed" ? "failed" : null;
}

/** Operation names are protocol tokens, like command names, and stay untranslated. */
export function describeBrowserActivityStep(step: BrowserActivityStep): string {
  return [
    step.operation.toLowerCase(),
    step.target ? `${step.target.role} “${step.target.name}”` : null,
    step.valueSlot ? `← ${step.valueSlot}` : null,
    step.detail || null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

export function formatBrowserActivityConfidence(
  step: BrowserActivityStep | undefined,
): string | null {
  const values = [step?.confidence, step?.targetConfidence].filter(
    (value): value is number => value !== undefined,
  );
  return values.length > 0 ? `${Math.round(Math.min(...values) * 100)} %` : null;
}

export function formatBrowserActivityStep(event: BrowserActivityEvent, t: TFunction): string {
  return event.totalSteps
    ? t("workspace.browser.activity.stepOf", { step: event.step, total: event.totalSteps })
    : t("workspace.browser.activity.step", { step: event.step });
}

/**
 * The polite live-region text. Observing and deciding read as one state so a Jev step
 * announces twice at most: checking the page, then the chosen action.
 */
export function summarizeBrowserActivity(event: BrowserActivityEvent, t: TFunction): string {
  if (event.phase === "finished") {
    return event.result?.status === "passed"
      ? t("workspace.browser.activity.passed")
      : t("workspace.browser.activity.failed", { message: event.result?.message ?? "" });
  }
  if (event.phase === "paused") return t("workspace.browser.activity.paused");
  if (event.pauseRequested) return t("workspace.browser.activity.pausing");
  const current = event.action
    ? describeBrowserActivityStep(event.action)
    : t("workspace.browser.activity.checkingPage");
  return `${formatBrowserActivityStep(event, t)} · ${current}`;
}

/** Jev picks its next step only after observing again, so it is never guessed here. */
export function describeNextBrowserActivityStep(
  event: BrowserActivityEvent,
  t: TFunction,
): string | null {
  if (event.next) return describeBrowserActivityStep(event.next);
  if (event.kind === "goal" && isBrowserRunActive(event)) {
    return t("workspace.browser.activity.recheckPage");
  }
  return null;
}
