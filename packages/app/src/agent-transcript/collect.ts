import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { TranscriptEntry } from "./serialize";

type TimelineRequest = Parameters<DaemonClient["fetchAgentTimeline"]>[1];
type TimelinePage = Awaited<ReturnType<DaemonClient["fetchAgentTimeline"]>>;

export type TranscriptPageFetcher = (options: TimelineRequest) => Promise<TimelinePage>;

export interface CollectTranscriptOptions {
  fetchPage: TranscriptPageFetcher;
  pageSize?: number;
  maxEntries?: number;
  maxPages?: number;
  /** A rewind restarts the walk; a second one keeps what was already collected. */
  maxRestarts?: number;
}

export interface CollectedTranscript {
  entries: TranscriptEntry[];
  epoch: string | null;
  agent: TimelinePage["agent"];
  truncated: boolean;
}

const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_MAX_ENTRIES = 20_000;
const DEFAULT_MAX_PAGES = 500;
const DEFAULT_MAX_RESTARTS = 1;

/**
 * Walks the timeline from the tail to the start of history. The daemon only ever
 * serves bounded pages, so a complete export is a loop rather than one request.
 */
export async function collectAgentTranscript(
  options: CollectTranscriptOptions,
): Promise<CollectedTranscript> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const maxRestarts = options.maxRestarts ?? DEFAULT_MAX_RESTARTS;

  let restarts = 0;
  for (;;) {
    const result = await walkFromTail({ ...options, pageSize, maxEntries, maxPages });
    if (result.kind === "collected") {
      return result.transcript;
    }
    if (restarts >= maxRestarts) {
      return { ...result.partial, truncated: true };
    }
    restarts += 1;
  }
}

type WalkResult =
  | { kind: "collected"; transcript: CollectedTranscript }
  | { kind: "rewound"; partial: CollectedTranscript };

async function walkFromTail(input: {
  fetchPage: TranscriptPageFetcher;
  pageSize: number;
  maxEntries: number;
  maxPages: number;
}): Promise<WalkResult> {
  const pages: TranscriptEntry[][] = [];
  let collected = 0;
  let truncated = false;

  const tail = await input.fetchPage({
    direction: "tail",
    limit: input.pageSize,
    projection: "projected",
  });
  const epoch = tail.epoch;
  const agent = tail.agent;
  pages.push([...tail.entries]);
  collected += tail.entries.length;

  let cursor = tail.startCursor;
  let hasOlder = tail.hasOlder;
  let pageCount = 1;

  while (hasOlder && cursor && collected < input.maxEntries && pageCount < input.maxPages) {
    const page = await input.fetchPage({
      direction: "before",
      cursor,
      limit: input.pageSize,
      projection: "projected",
    });
    pageCount += 1;

    if (page.epoch !== epoch) {
      return {
        kind: "rewound",
        partial: { entries: pages.flat(), epoch, agent, truncated: true },
      };
    }
    if (page.entries.length === 0) {
      // An empty page that still claims older history would spin forever.
      truncated = page.hasOlder;
      break;
    }

    pages.unshift([...page.entries]);
    collected += page.entries.length;
    cursor = page.startCursor;
    hasOlder = page.hasOlder;
  }

  if (hasOlder && (collected >= input.maxEntries || pageCount >= input.maxPages || !cursor)) {
    truncated = true;
  }

  return {
    kind: "collected",
    transcript: { entries: pages.flat(), epoch, agent, truncated },
  };
}
