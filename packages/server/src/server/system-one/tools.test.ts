import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaseoToolConfig, PaseoToolResult } from "../agent/tools/types.js";
import type { DaemonConfigStore } from "../daemon-config-store.js";
import { SystemOneCredentialStore } from "./credential-store.js";
import { registerSystemOneTools } from "./tools.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("registerSystemOneTools", () => {
  it("batches typed questions through the configured Paseo credential", async () => {
    const paseoHome = await mkdtemp(path.join(tmpdir(), "paseo-system-one-tools-"));
    temporaryDirectories.push(paseoHome);
    new SystemOneCredentialStore(paseoHome, { env: {}, sharedEnvFile: "/missing" }).set(
      "private-key",
    );
    let requestBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer private-key");
        return new Response(
          JSON.stringify({
            model: "jev-latest",
            answers: {
              route: {
                choice: "inspect",
                confidence: 0.9,
                probabilities: { inspect: 0.9, implement: 0.1 },
              },
              risky: { noul: 0.2 },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    let handler: ((input: unknown) => Promise<PaseoToolResult>) | null = null;
    let toolConfig: PaseoToolConfig | null = null;
    registerSystemOneTools({
      paseoHome,
      daemonConfigStore: {
        get: () =>
          ({
            systemOne: {
              enabled: true,
              model: "jev-latest",
              minimumConfidence: 0.7,
              configured: true,
              credentialSource: "paseo",
            },
          }) as ReturnType<DaemonConfigStore["get"]>,
      },
      registerTool: (_name: string, _config: PaseoToolConfig, registeredHandler) => {
        toolConfig = _config;
        handler = registeredHandler;
      },
    });

    expect(handler).not.toBeNull();
    if (!toolConfig) throw new Error("Expected System One tool registration");
    expect(
      (toolConfig.inputSchema as { safeParse(input: unknown): { success: boolean } }).safeParse({
        state: { apiKey: "must-not-leave-host" },
        questions: {
          route: {
            type: "choice",
            instructions: "Choose",
            criteria: { a: "A", b: "B" },
          },
        },
      }).success,
    ).toBe(false);
    const result = await handler!({
      state: { task: "Fix the failing settings flow" },
      questions: {
        route: {
          type: "choice",
          instructions: "What should happen next?",
          criteria: { inspect: "Inspect evidence", implement: "Implement the fix" },
        },
        risky: { type: "noul", instructions: "Is the proposed change high risk?" },
      },
    });

    expect(requestBody).toMatchObject({ model: "jev-latest" });
    expect(requestBody?.questions).toBeDefined();
    expect(result.structuredContent).toMatchObject({ minimumConfidence: 0.7 });
    expect(JSON.stringify(result)).not.toContain("private-key");
  });
});
