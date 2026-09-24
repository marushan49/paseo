import { describe, expect, test } from "vitest";
import { buildTerminalRunMarker, readTerminalRun, terminalRunPollDelayMs } from "./terminal-run.js";

describe("buildTerminalRunMarker", () => {
  test("carries the command and a marker the shell prints afterwards", () => {
    const marker = buildTerminalRunMarker("npm test", "11111111-2222-3333-4444-555555555555");
    expect(marker.token).toBe("__paseo_done_11111111222233334444555555555555__");
    expect(marker.input.startsWith("npm test\n")).toBe(true);
    expect(marker.input).toContain("printf");
    expect(marker.input).toContain('"$?"');
    expect(marker.input.endsWith("\n")).toBe(true);
  });

  test("two runs never share a marker", () => {
    expect(buildTerminalRunMarker("ls").token).not.toBe(buildTerminalRunMarker("ls").token);
  });
});

describe("readTerminalRun", () => {
  const marker = buildTerminalRunMarker("npm test", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");

  test("waits while the marker is missing", () => {
    const result = readTerminalRun(["running tests", "1 of 40"], marker);
    expect(result.finished).toBe(false);
    expect(result.exitCode).toBe(null);
    expect(result.lines).toEqual(["running tests", "1 of 40"]);
  });

  test("reads the exit code the shell printed", () => {
    const result = readTerminalRun(
      ["running tests", "all good", "", `${marker.token}:0`, "$ "],
      marker,
    );
    expect(result).toEqual({ lines: ["running tests", "all good"], exitCode: 0, finished: true });
  });

  test("a failure keeps its code", () => {
    expect(readTerminalRun(["boom", `${marker.token}:1`], marker).exitCode).toBe(1);
    expect(readTerminalRun(["boom", `${marker.token}:127`], marker).exitCode).toBe(127);
  });

  test("the echoed command line is not output", () => {
    const echoed = `$ npm test; printf '\\n${marker.token}:%s\\n' "$?"`;
    const result = readTerminalRun([echoed, "ok", `${marker.token}:0`], marker);
    expect(result.lines).toEqual(["ok"]);
  });

  test("an unreadable code still counts as finished", () => {
    const result = readTerminalRun(["done", `${marker.token}:`], marker);
    expect(result.finished).toBe(true);
    expect(result.exitCode).toBe(null);
  });

  test("scrollback before the command stays out", () => {
    const result = readTerminalRun(
      ["old noise", "older noise", "fresh", `${marker.token}:0`],
      marker,
      2,
    );
    expect(result.lines).toEqual(["fresh"]);
  });
});

describe("terminalRunPollDelayMs", () => {
  test("checks often at first and backs off for long commands", () => {
    expect(terminalRunPollDelayMs(0)).toBe(100);
    expect(terminalRunPollDelayMs(5000)).toBe(250);
    expect(terminalRunPollDelayMs(60000)).toBe(500);
  });
});
