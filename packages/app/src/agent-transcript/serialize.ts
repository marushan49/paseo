import type { AgentTimelineItem, ToolCallDetail } from "@getpaseo/protocol/agent-types";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

type TimelinePage = Awaited<ReturnType<DaemonClient["fetchAgentTimeline"]>>;

export type TranscriptEntry = TimelinePage["entries"][number];

export type TranscriptFormat = "markdown" | "json";

export interface TranscriptMetadata {
  agentId: string;
  agentName?: string | null;
  provider?: string | null;
  workspaceName?: string | null;
  epoch?: string | null;
  exportedAt: Date;
  /** Set when collection stopped before reaching the start of history. */
  truncated?: boolean;
}

export interface TranscriptSource {
  metadata: TranscriptMetadata;
  entries: readonly TranscriptEntry[];
}

/**
 * A fence has to outrun the longest backtick run in the payload, otherwise shell
 * output that itself contains ``` closes the block early and the rest of the
 * transcript renders as prose.
 */
function fenceFor(content: string): string {
  let longest = 0;
  for (const run of content.match(/`+/g) ?? []) {
    longest = Math.max(longest, run.length);
  }
  return "`".repeat(Math.max(3, longest + 1));
}

function codeBlock(content: string, language = ""): string {
  const fence = fenceFor(content);
  const body = content.endsWith("\n") ? content.slice(0, -1) : content;
  return `${fence}${language}\n${body}\n${fence}`;
}

function formatTimestamp(timestamp: string): string {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? timestamp : parsed.toISOString();
}

function stringifyUnknown(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function section(heading: string, blocks: readonly string[]): string {
  return [heading, "", ...blocks.filter((block) => block.length > 0)].join("\n");
}

function labelledBlock(label: string, content: string, language = ""): string {
  return `${label}:\n\n${codeBlock(content, language)}\n`;
}

type DetailOf<T extends ToolCallDetail["type"]> = Extract<ToolCallDetail, { type: T }>;

function formatShell(detail: DetailOf<"shell">): string[] {
  const blocks = [labelledBlock("Command", detail.command, "bash")];
  if (detail.cwd) blocks.push(`Working directory: \`${detail.cwd}\`\n`);
  if (detail.output) blocks.push(labelledBlock("Output", detail.output));
  if (detail.exitCode !== undefined && detail.exitCode !== null) {
    blocks.push(`Exit code: ${detail.exitCode}\n`);
  }
  return blocks;
}

function formatEdit(detail: DetailOf<"edit">): string[] {
  const blocks = [`File: \`${detail.filePath}\`\n`];
  if (detail.unifiedDiff) {
    blocks.push(labelledBlock("Diff", detail.unifiedDiff, "diff"));
    return blocks;
  }
  if (detail.oldString) blocks.push(labelledBlock("Before", detail.oldString));
  if (detail.newString) blocks.push(labelledBlock("After", detail.newString));
  return blocks;
}

function formatSearch(detail: DetailOf<"search">): string[] {
  const blocks = [`Query: \`${detail.query}\`\n`];
  if (detail.content) blocks.push(labelledBlock("Results", detail.content));
  if (detail.filePaths?.length) {
    blocks.push(`${detail.filePaths.map((path) => `- \`${path}\``).join("\n")}\n`);
  }
  if (detail.webResults?.length) {
    const lines = detail.webResults.map((result) => `- ${result.title} — ${result.url}`);
    blocks.push(`${lines.join("\n")}\n`);
  }
  return blocks;
}

function formatFetch(detail: DetailOf<"fetch">): string[] {
  const blocks = [`URL: ${detail.url}\n`];
  if (detail.prompt) blocks.push(labelledBlock("Prompt", detail.prompt));
  if (detail.result) blocks.push(labelledBlock("Result", detail.result));
  return blocks;
}

function formatWorktreeSetup(detail: DetailOf<"worktree_setup">): string[] {
  const blocks = [`Worktree: \`${detail.worktreePath}\` (branch \`${detail.branchName}\`)\n`];
  for (const command of detail.commands) {
    blocks.push(
      labelledBlock(`Command ${command.index} (${command.status})`, command.command, "bash"),
    );
    if (command.log) blocks.push(labelledBlock("Log", command.log));
  }
  if (detail.log) blocks.push(labelledBlock("Log", detail.log));
  return blocks;
}

function formatSubAgent(detail: DetailOf<"sub_agent">): string[] {
  const blocks: string[] = [];
  if (detail.subAgentType) blocks.push(`Subagent: ${detail.subAgentType}\n`);
  if (detail.description) blocks.push(`${detail.description}\n`);
  if (detail.log) blocks.push(labelledBlock("Log", detail.log));
  return blocks;
}

function formatFileWithContent(detail: DetailOf<"read"> | DetailOf<"write">): string[] {
  const blocks = [`File: \`${detail.filePath}\`\n`];
  if (detail.content) blocks.push(labelledBlock("Content", detail.content));
  return blocks;
}

function formatUnknown(detail: DetailOf<"unknown">): string[] {
  const blocks: string[] = [];
  const input = stringifyUnknown(detail.input);
  const output = stringifyUnknown(detail.output);
  if (input) blocks.push(labelledBlock("Input", input, "json"));
  if (output) blocks.push(labelledBlock("Output", output, "json"));
  return blocks;
}

function formatToolDetail(detail: ToolCallDetail): string[] {
  switch (detail.type) {
    case "shell":
      return formatShell(detail);
    case "read":
    case "write":
      return formatFileWithContent(detail);
    case "edit":
      return formatEdit(detail);
    case "search":
      return formatSearch(detail);
    case "fetch":
      return formatFetch(detail);
    case "worktree_setup":
      return formatWorktreeSetup(detail);
    case "sub_agent":
      return formatSubAgent(detail);
    case "plain_text":
      return [
        ...(detail.label ? [`${detail.label}\n`] : []),
        ...(detail.text ? [labelledBlock("Text", detail.text)] : []),
      ];
    case "plan":
      return [`${detail.text}\n`];
    case "unknown":
      return formatUnknown(detail);
  }
}

function formatItem(item: AgentTimelineItem, heading: string): string | null {
  switch (item.type) {
    case "user_message":
      return section(`${heading} User`, [`${item.text}\n`]);
    case "assistant_message":
      return section(`${heading} Assistant`, [`${item.text}\n`]);
    case "reasoning":
      return section(`${heading} Reasoning`, [`${item.text}\n`]);
    case "tool_call": {
      const blocks = formatToolDetail(item.detail);
      if (item.error !== null && item.error !== undefined) {
        blocks.push(labelledBlock("Error", stringifyUnknown(item.error)));
      }
      return section(`${heading} Tool: ${item.name} — ${item.status}`, blocks);
    }
    case "todo": {
      const lines = item.items.map((entry) => `- [${entry.completed ? "x" : " "}] ${entry.text}`);
      return section(`${heading} Todo`, [`${lines.join("\n")}\n`]);
    }
    case "error":
      return section(`${heading} Error`, [`${item.message}\n`]);
    case "notification":
      return section(`${heading} Notification (${item.level})`, [`${item.message}\n`]);
    case "compaction":
      return section(`${heading} Compaction — ${item.status}`, [
        item.preTokens === undefined ? "" : `Tokens before: ${item.preTokens}\n`,
      ]);
    case "plugin":
      return section(`${heading} Plugin: ${item.pluginId} (${item.kind})`, [
        labelledBlock("Data", stringifyUnknown(item.data), "json"),
      ]);
    default:
      return null;
  }
}

function formatHeader(metadata: TranscriptMetadata, entryCount: number): string {
  const lines = [
    `- Agent: ${metadata.agentName?.trim() || metadata.agentId}`,
    `- Agent id: ${metadata.agentId}`,
  ];
  if (metadata.provider) lines.push(`- Provider: ${metadata.provider}`);
  if (metadata.workspaceName) lines.push(`- Workspace: ${metadata.workspaceName}`);
  lines.push(`- Exported: ${metadata.exportedAt.toISOString()}`);
  lines.push(`- Items: ${entryCount}`);
  if (metadata.truncated) {
    lines.push("- Note: history was truncated; the oldest messages are missing.");
  }
  return ["# Agent transcript", "", ...lines].join("\n");
}

export function formatTranscriptMarkdown(source: TranscriptSource): string {
  const sections: string[] = [formatHeader(source.metadata, source.entries.length)];
  for (const entry of source.entries) {
    const formatted = formatItem(entry.item, `## [${formatTimestamp(entry.timestamp)}]`);
    if (formatted) sections.push(formatted);
  }
  return `${sections.join("\n---\n\n")}\n`;
}

export function formatTranscriptJson(source: TranscriptSource): string {
  return `${JSON.stringify(
    {
      paseoTranscriptVersion: 1,
      agentId: source.metadata.agentId,
      agentName: source.metadata.agentName ?? null,
      provider: source.metadata.provider ?? null,
      workspaceName: source.metadata.workspaceName ?? null,
      epoch: source.metadata.epoch ?? null,
      exportedAt: source.metadata.exportedAt.toISOString(),
      truncated: source.metadata.truncated === true,
      entries: source.entries,
    },
    null,
    2,
  )}\n`;
}
