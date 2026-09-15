import { describe, expect, test } from "vitest";
import {
  requestSwitchAgentProvider,
  resolveSwitchProviderDialog,
  type SwitchAgentProviderDeps,
} from "./switch-provider";

const SWITCH_INPUT = {
  agentId: "agent-1",
  fromProviderLabel: "OpenCode",
  toProvider: "claude",
  toProviderLabel: "Claude Code",
  modelId: "claude-opus-5",
  modelLabel: "Opus 5",
};

function makeDeps(overrides: Partial<SwitchAgentProviderDeps> = {}) {
  const switches: Array<{ agentId: string; provider: string; modelId: string }> = [];
  const errors: unknown[] = [];
  const deps: SwitchAgentProviderDeps = {
    confirm: async () => true,
    setAgentProvider: async (input) => {
      switches.push(input);
    },
    reportError: (error) => {
      errors.push(error);
    },
    ...overrides,
  };
  return { deps, switches, errors };
}

describe("requestSwitchAgentProvider", () => {
  test("switches the agent after the user confirms", async () => {
    const { deps, switches, errors } = makeDeps();

    await requestSwitchAgentProvider(SWITCH_INPUT, deps);

    expect(switches).toEqual([
      { agentId: "agent-1", provider: "claude", modelId: "claude-opus-5" },
    ]);
    expect(errors).toEqual([]);
  });

  test("leaves the agent on its provider when the user cancels", async () => {
    const { deps, switches, errors } = makeDeps({ confirm: async () => false });

    await requestSwitchAgentProvider(SWITCH_INPUT, deps);

    expect(switches).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("reports a rejected switch instead of throwing", async () => {
    const failure = new Error("claude runtime unavailable");
    const { deps, errors } = makeDeps({
      setAgentProvider: async () => {
        throw failure;
      },
    });

    await requestSwitchAgentProvider(SWITCH_INPUT, deps);

    expect(errors).toEqual([failure]);
  });

  test("names both providers and the model so the trade is visible before confirming", () => {
    expect(
      resolveSwitchProviderDialog({
        fromProviderLabel: "OpenCode",
        toProviderLabel: "Claude Code",
        modelLabel: "Opus 5",
      }),
    ).toEqual({
      title: "Switch to Claude Code?",
      message:
        "Opus 5 belongs to Claude Code, so this agent moves off OpenCode. The transcript, " +
        "workspace, and files stay; the OpenCode session ends and Claude Code starts without " +
        "its memory.",
      confirmLabel: "Switch",
      cancelLabel: "Cancel",
      destructive: true,
    });
  });
});
