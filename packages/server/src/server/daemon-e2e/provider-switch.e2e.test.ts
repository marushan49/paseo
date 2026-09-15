import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { createDaemonTestContext, type DaemonTestContext } from "../test-utils/index.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import type { SessionOutboundMessage } from "../messages.js";

type AgentUpdatePayload = Extract<SessionOutboundMessage, { type: "agent_update" }>["payload"];
type AgentUpsertPayload = Extract<AgentUpdatePayload, { kind: "upsert" }>;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function collectAgentUpdates(client: DaemonClient): {
  updates: AgentUpdatePayload[];
  unsub: () => void;
} {
  const updates: AgentUpdatePayload[] = [];
  const unsub = client.on("agent_update", (message) => {
    if (message.type === "agent_update") {
      updates.push(message.payload);
    }
  });
  return { updates, unsub };
}

function lastUpsertFor(
  updates: AgentUpdatePayload[],
  agentId: string,
): AgentUpsertPayload | undefined {
  return updates.findLast(
    (u): u is AgentUpsertPayload => u.kind === "upsert" && u.agent.id === agentId,
  );
}

describe("cross-provider brain switching", () => {
  let ctx: DaemonTestContext;

  beforeAll(async () => {
    ctx = await createDaemonTestContext();
  }, 30000);

  afterAll(async () => {
    if (ctx) await ctx.cleanup();
  }, 30000);

  test("the agent keeps its identity and lands on the new provider's model", async () => {
    const { updates, unsub } = collectAgentUpdates(ctx.client);
    const agent = await ctx.client.createAgent({
      provider: "codex",
      cwd: "/tmp",
      model: "gpt-5.4-mini",
    });
    await sleep(300);

    await ctx.client.setAgentProvider(agent.id, "claude", "sonnet");
    await sleep(500);

    const switched = lastUpsertFor(updates, agent.id);
    expect(switched?.agent.provider).toBe("claude");
    expect(switched?.agent.model).toBe("sonnet");
    expect(switched?.agent.cwd).toBe(agent.cwd);
    unsub();
  });

  test("the switch is the authoritative state a fresh client bootstraps into", async () => {
    const agent = await ctx.client.createAgent({
      provider: "codex",
      cwd: "/tmp",
      model: "gpt-5.4-mini",
    });
    await sleep(200);

    await ctx.client.setAgentProvider(agent.id, "claude", "haiku");
    await sleep(300);

    const client2 = new DaemonClient({ url: `ws://127.0.0.1:${ctx.daemon.port}/ws` });
    await client2.connect();
    try {
      const bootstrap = await client2.fetchAgents({ subscribe: {} });
      const found = bootstrap.entries.find((e) => e.agent.id === agent.id);
      expect(found?.agent.provider).toBe("claude");
      expect(found?.agent.model).toBe("haiku");
    } finally {
      await client2.close();
    }
  });

  test("a switch to an unavailable provider is refused and leaves the agent where it was", async () => {
    const { updates, unsub } = collectAgentUpdates(ctx.client);
    const agent = await ctx.client.createAgent({
      provider: "codex",
      cwd: "/tmp",
      model: "gpt-5.4-mini",
    });
    await sleep(300);

    await expect(
      ctx.client.setAgentProvider(agent.id, "not-a-provider", "some-model"),
    ).rejects.toThrow();
    await sleep(300);

    expect(lastUpsertFor(updates, agent.id)?.agent.provider).toBe("codex");
    unsub();
  });
});
