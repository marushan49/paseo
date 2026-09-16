import { randomUUID } from "node:crypto";

/**
 * Running a command in a terminal and knowing when it finished.
 *
 * A PTY says nothing about where one command ends. Until now an agent had to send keys, then
 * capture, then guess whether the output it saw was complete — so it read half a build log and
 * carried on as if the build had passed. The command is therefore wrapped with a marker the
 * shell prints only after it returns, carrying the exit code, and the caller waits for that
 * marker to appear in the capture.
 */
export interface TerminalRunMarker {
  /** The line the shell prints when the command is done. */
  readonly token: string;
  /** What to send to the terminal, newline included. */
  readonly input: string;
}

export function buildTerminalRunMarker(command: string, id = randomUUID()): TerminalRunMarker {
  const token = `__paseo_done_${id.replace(/-/g, "")}__`;
  // `printf` rather than `echo` so no shell embellishes the marker, and `$?` is read before
  // anything else can overwrite it.
  return {
    token,
    input: `${command}\nprintf '\\n${token}:%s\\n' "$?"\n`,
  };
}

export interface TerminalRunResult {
  /** Output between the command and the marker, marker excluded. */
  lines: string[];
  exitCode: number | null;
  /** False when the marker never showed up, i.e. the command outlived its wait. */
  finished: boolean;
}

/**
 * Read a capture that may or may not contain the marker yet.
 *
 * `fromLine` is where the command's own output began, so earlier scrollback stays out of the
 * result. A marker line whose exit code will not parse counts as finished with an unknown code
 * rather than as still running: the shell said it was done.
 */
export function readTerminalRun(
  lines: readonly string[],
  marker: TerminalRunMarker,
  fromLine = 0,
): TerminalRunResult {
  const body: string[] = [];
  for (let index = fromLine; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    // The terminal echoes the command back, and that echo carries the marker's own text. It
    // still holds the printf template, so `%s` is what tells the recipe apart from the result
    // it will later print. Reading the echo as the result would report every command finished
    // the instant it started, which is the failure this whole tool exists to prevent.
    if (line.includes(marker.token) && line.includes("%s")) continue;
    const at = line.indexOf(`${marker.token}:`);
    if (at !== -1) {
      const raw = line.slice(at + marker.token.length + 1).trim();
      const parsed = Number.parseInt(raw, 10);
      return {
        lines: trimBlankEdges(body),
        exitCode: Number.isNaN(parsed) ? null : parsed,
        finished: true,
      };
    }
    if (line.includes(marker.token)) continue;
    body.push(line);
  }
  return { lines: trimBlankEdges(body), exitCode: null, finished: false };
}

function trimBlankEdges(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? "").trim() === "") start += 1;
  while (end > start && (lines[end - 1] ?? "").trim() === "") end -= 1;
  return lines.slice(start, end);
}

/** How long to wait between captures while a command is still running. */
export function terminalRunPollDelayMs(elapsedMs: number): number {
  if (elapsedMs < 2000) return 100;
  if (elapsedMs < 10000) return 250;
  return 500;
}
