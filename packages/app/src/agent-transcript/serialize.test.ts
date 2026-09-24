import { describe, expect, test } from "vitest";
import {
  formatTranscriptJson,
  formatTranscriptMarkdown,
  type TranscriptEntry,
  type TranscriptMetadata,
} from "./serialize";

const EXPORTED_AT = new Date("2026-09-15T10:00:00.000Z");

function metadata(overrides: Partial<TranscriptMetadata> = {}): TranscriptMetadata {
  return {
    agentId: "agent-1",
    agentName: "unusual-seahorse",
    provider: "claude",
    epoch: "epoch-1",
    exportedAt: EXPORTED_AT,
    ...overrides,
  };
}

function entry(item: TranscriptEntry["item"], seq = 1): TranscriptEntry {
  return {
    provider: "claude",
    item,
    timestamp: "2026-09-15T09:59:00.000Z",
    seqStart: seq,
    seqEnd: seq,
    sourceSeqRanges: [],
    collapsed: [],
  } as TranscriptEntry;
}

describe("formatTranscriptMarkdown", () => {
  test("includes the user prompt, the reply, and the reasoning", () => {
    const output = formatTranscriptMarkdown({
      metadata: metadata(),
      entries: [
        entry({ type: "user_message", text: "build it" }, 1),
        entry({ type: "reasoning", text: "thinking about it" }, 2),
        entry({ type: "assistant_message", text: "done" }, 3),
      ],
    });

    expect(output).toContain("## [2026-09-15T09:59:00.000Z] User");
    expect(output).toContain("build it");
    expect(output).toContain("## [2026-09-15T09:59:00.000Z] Reasoning");
    expect(output).toContain("thinking about it");
    expect(output).toContain("## [2026-09-15T09:59:00.000Z] Assistant");
    expect(output).toContain("done");
  });

  test("keeps the shell command, its output, and the exit code", () => {
    const output = formatTranscriptMarkdown({
      metadata: metadata(),
      entries: [
        entry({
          type: "tool_call",
          callId: "call-1",
          name: "Bash",
          status: "completed",
          error: null,
          detail: {
            type: "shell",
            command: "npm run typecheck",
            cwd: "/repo",
            output: "3 errors",
            exitCode: 1,
          },
        }),
      ],
    });

    expect(output).toContain("## [2026-09-15T09:59:00.000Z] Tool: Bash — completed");
    expect(output).toContain("npm run typecheck");
    expect(output).toContain("Working directory: `/repo`");
    expect(output).toContain("3 errors");
    expect(output).toContain("Exit code: 1");
  });

  test("keeps a failed tool call's error payload", () => {
    const output = formatTranscriptMarkdown({
      metadata: metadata(),
      entries: [
        entry({
          type: "tool_call",
          callId: "call-2",
          name: "Bash",
          status: "failed",
          error: { message: "command not found" },
          detail: { type: "shell", command: "nope" },
        }),
      ],
    });

    expect(output).toContain("Tool: Bash — failed");
    expect(output).toContain("command not found");
  });

  test("escapes output that contains a fence so the block cannot close early", () => {
    const output = formatTranscriptMarkdown({
      metadata: metadata(),
      entries: [
        entry({
          type: "tool_call",
          callId: "call-3",
          name: "Bash",
          status: "completed",
          error: null,
          detail: { type: "shell", command: "cat README.md", output: "```js\ncode\n```" },
        }),
      ],
    });

    expect(output).toContain("````\n```js\ncode\n```\n````");
  });

  test("reports truncated history in the header", () => {
    const output = formatTranscriptMarkdown({
      metadata: metadata({ truncated: true }),
      entries: [],
    });

    expect(output).toContain("history was truncated");
  });

  test("renders errors and notifications", () => {
    const output = formatTranscriptMarkdown({
      metadata: metadata(),
      entries: [
        entry({ type: "error", message: "agent crashed" }, 1),
        entry({ type: "notification", level: "warning", message: "host offline" }, 2),
      ],
    });

    expect(output).toContain("Error");
    expect(output).toContain("agent crashed");
    expect(output).toContain("Notification (warning)");
    expect(output).toContain("host offline");
  });
});

describe("formatTranscriptJson", () => {
  test("round-trips the raw entries and the metadata", () => {
    const entries = [entry({ type: "user_message", text: "hello" })];
    const parsed = JSON.parse(formatTranscriptJson({ metadata: metadata(), entries }));

    expect(parsed.paseoTranscriptVersion).toBe(1);
    expect(parsed.agentId).toBe("agent-1");
    expect(parsed.agentName).toBe("unusual-seahorse");
    expect(parsed.epoch).toBe("epoch-1");
    expect(parsed.exportedAt).toBe(EXPORTED_AT.toISOString());
    expect(parsed.truncated).toBe(false);
    expect(parsed.entries).toEqual(JSON.parse(JSON.stringify(entries)));
  });
});
