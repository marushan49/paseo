import { randomUUID } from "node:crypto";
import type {
  BrowserActivityEvent,
  BrowserActivityPhase,
  BrowserActivityStep,
} from "@getpaseo/protocol/browser-activity/rpc-schemas";

export interface BrowserActivityPatch {
  phase: BrowserActivityPhase;
  step?: number;
  /** `null` clears the field; `undefined` keeps it. */
  action?: BrowserActivityStep | null;
  next?: BrowserActivityStep | null;
  steps?: BrowserActivityStep[];
}

export interface BrowserActivityReporter {
  update(patch: BrowserActivityPatch): void;
  /**
   * A safe boundary between browser actions. Resolves at once unless the user took over;
   * resolves `true` after a takeover ends so the runner observes the page again first.
   */
  checkpoint(): Promise<boolean>;
}

export interface BrowserActivityRun extends BrowserActivityReporter {
  finish(result: NonNullable<BrowserActivityEvent["result"]>): void;
}

export const NOOP_BROWSER_ACTIVITY: BrowserActivityRun = {
  update: () => {},
  checkpoint: async () => false,
  finish: () => {},
};

interface ActiveRun {
  event: BrowserActivityEvent;
  resume: (() => void) | null;
}

export class BrowserActivityHub {
  private readonly runs = new Map<string, ActiveRun>();

  public constructor(private readonly publish: (event: BrowserActivityEvent) => void) {}

  public start(input: {
    workspaceId: string;
    browserId: string;
    kind: BrowserActivityEvent["kind"];
    label: string;
    totalSteps?: number;
    steps?: BrowserActivityStep[];
  }): BrowserActivityRun {
    const run: ActiveRun = {
      event: {
        runId: randomUUID(),
        workspaceId: input.workspaceId,
        browserId: input.browserId,
        kind: input.kind,
        label: input.label,
        phase: "observing",
        step: 0,
        ...(input.totalSteps !== undefined ? { totalSteps: input.totalSteps } : {}),
        steps: input.steps ?? [],
        pauseRequested: false,
        updatedAt: Date.now(),
      },
      resume: null,
    };
    this.runs.set(run.event.runId, run);
    this.emit(run);
    return {
      update: (patch) => {
        if (this.runs.get(run.event.runId) === run) this.apply(run, patch);
      },
      checkpoint: () => this.checkpoint(run),
      finish: (result) => {
        if (!this.runs.delete(run.event.runId)) return;
        run.event = {
          ...patchEvent(run.event, { phase: "finished", next: null }),
          pauseRequested: false,
          result,
        };
        this.emit(run);
      },
    };
  }

  /** Applies to every active run on the browser; returns whether one matched. */
  public control(input: {
    workspaceId: string;
    browserId: string;
    action: "pause" | "resume";
  }): boolean {
    let applied = false;
    for (const run of this.runs.values()) {
      if (run.event.workspaceId !== input.workspaceId || run.event.browserId !== input.browserId) {
        continue;
      }
      applied = true;
      if (input.action === "pause") {
        if (!run.resume && !run.event.pauseRequested) {
          run.event = { ...run.event, pauseRequested: true };
          this.emit(run);
        }
      } else if (run.resume) {
        run.resume();
      } else if (run.event.pauseRequested) {
        run.event = { ...run.event, pauseRequested: false };
        this.emit(run);
      }
    }
    return applied;
  }

  /** Current state of every active run, for subscribers that join mid-run. */
  public current(): BrowserActivityEvent[] {
    return [...this.runs.values()].map((run) => run.event);
  }

  private async checkpoint(run: ActiveRun): Promise<boolean> {
    if (!run.event.pauseRequested || this.runs.get(run.event.runId) !== run) return false;
    const resumed = new Promise<void>((resolve) => {
      run.resume = resolve;
    });
    run.event = {
      ...patchEvent(run.event, { phase: "paused", action: null }),
      pauseRequested: false,
    };
    this.emit(run);
    await resumed;
    run.resume = null;
    return true;
  }

  private apply(run: ActiveRun, patch: BrowserActivityPatch): void {
    run.event = patchEvent(run.event, patch);
    this.emit(run);
  }

  private emit(run: ActiveRun): void {
    run.event = { ...run.event, updatedAt: Date.now() };
    this.publish(run.event);
  }
}

function patchEvent(
  event: BrowserActivityEvent,
  patch: BrowserActivityPatch,
): BrowserActivityEvent {
  const { action, next, ...rest } = event;
  const nextAction = patch.action === undefined ? action : (patch.action ?? undefined);
  const nextStep = patch.next === undefined ? next : (patch.next ?? undefined);
  return {
    ...rest,
    phase: patch.phase,
    ...(patch.step !== undefined ? { step: patch.step } : {}),
    ...(patch.steps ? { steps: patch.steps } : {}),
    ...(nextAction ? { action: nextAction } : {}),
    ...(nextStep ? { next: nextStep } : {}),
  };
}
