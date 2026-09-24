import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { EvidenceStore, formatEvidenceRef, parseEvidenceRef } from "./evidence-store.js";

const tempDirs: string[] = [];

function makePaseoHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "paseo-evidence-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("evidence refs", () => {
  it("round-trips workspace, run, and artifact name", () => {
    const ref = formatEvidenceRef({
      workspaceId: "wks_abc123",
      runId: "evr_def456",
      name: "after-login",
    });
    expect(ref).toBe("evidence://wks_abc123/evr_def456/after-login");
    expect(parseEvidenceRef(ref)).toEqual({
      workspaceId: "wks_abc123",
      runId: "evr_def456",
      name: "after-login",
    });
  });

  it("supports run-level refs without an artifact name", () => {
    const ref = formatEvidenceRef({ workspaceId: "wks_abc123", runId: "evr_def456" });
    expect(ref).toBe("evidence://wks_abc123/evr_def456");
    expect(parseEvidenceRef(ref)?.name).toBeUndefined();
  });

  it("rejects refs outside the evidence scheme", () => {
    expect(parseEvidenceRef("artifact://wks_abc123/evr_def456/x")).toBeNull();
    expect(parseEvidenceRef("evidence://wks_abc123")).toBeNull();
    expect(parseEvidenceRef("evidence://wks_abc123/evr_def456/a/b")).toBeNull();
    expect(parseEvidenceRef("not a ref")).toBeNull();
    expect(parseEvidenceRef("evidence://../escape/evr_def456/x")).toBeNull();
  });
});

describe("EvidenceStore", () => {
  it("creates a run with a manifest under the workspace directory", async () => {
    const store = new EvidenceStore({ paseoHome: makePaseoHome() });
    const manifest = await store.createRun({
      workspaceId: "wks_abc123",
      recipe: "verify-case-report",
    });

    expect(manifest.runId).toMatch(/^evr_/);
    expect(manifest.workspaceId).toBe("wks_abc123");
    expect(manifest.recipe).toBe("verify-case-report");
    expect(manifest.artifacts).toEqual([]);

    const reread = await store.getManifest({ workspaceId: "wks_abc123", runId: manifest.runId });
    expect(reread).toEqual(manifest);
  });

  it("writes and reads back text and binary artifacts", async () => {
    const store = new EvidenceStore({ paseoHome: makePaseoHome() });
    const { runId } = await store.createRun({
      workspaceId: "wks_abc123",
      recipe: "verify-case-report",
    });

    const report = await store.writeArtifact({
      runId,
      name: "report",
      kind: "report",
      contentType: "application/json",
      data: JSON.stringify({ status: "pass" }),
    });
    expect(report.bytes).toBeGreaterThan(0);
    expect(report.sha256).toMatch(/^[0-9a-f]{64}$/);

    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    await store.writeArtifact({
      runId,
      name: "after-login",
      kind: "screenshot",
      contentType: "image/png",
      data: png,
    });

    const manifest = await store.getManifest({ workspaceId: "wks_abc123", runId });
    expect(manifest?.artifacts.map((entry) => entry.name).sort()).toEqual([
      "after-login",
      "report",
    ]);

    await expect(
      store.readArtifact({ workspaceId: "wks_abc123", runId, name: "report" }),
    ).resolves.toEqual({
      entry: expect.objectContaining({ name: "report", kind: "report" }),
      data: Buffer.from(JSON.stringify({ status: "pass" }), "utf8"),
    });
    const screenshot = await store.readArtifact({
      workspaceId: "wks_abc123",
      runId,
      name: "after-login",
    });
    expect(screenshot?.data).toEqual(Buffer.from(png));
  });

  it("isolates runs by workspace", async () => {
    const store = new EvidenceStore({ paseoHome: makePaseoHome() });
    const { runId } = await store.createRun({
      workspaceId: "wks_abc123",
      recipe: "verify-case-report",
    });

    await expect(store.getManifest({ workspaceId: "wks_other", runId })).resolves.toBeNull();
    await expect(
      store.readArtifact({ workspaceId: "wks_other", runId, name: "report" }),
    ).resolves.toBeNull();
  });

  it("returns null for unknown runs and artifacts", async () => {
    const store = new EvidenceStore({ paseoHome: makePaseoHome() });
    await expect(
      store.getManifest({ workspaceId: "wks_abc123", runId: "evr_missing" }),
    ).resolves.toBeNull();
    await expect(
      store.readArtifact({ workspaceId: "wks_abc123", runId: "evr_missing", name: "report" }),
    ).resolves.toBeNull();
  });

  it("rejects artifact names that could escape the run directory", async () => {
    const store = new EvidenceStore({ paseoHome: makePaseoHome() });
    const { runId } = await store.createRun({
      workspaceId: "wks_abc123",
      recipe: "verify-case-report",
    });

    await expect(
      store.writeArtifact({
        runId,
        name: "../escape",
        kind: "report",
        contentType: "text/plain",
        data: "x",
      }),
    ).rejects.toThrow();
    await expect(
      store.writeArtifact({
        runId,
        name: "a/b",
        kind: "report",
        contentType: "text/plain",
        data: "x",
      }),
    ).rejects.toThrow();
  });

  it("rejects oversized artifacts instead of storing unbounded bytes", async () => {
    const store = new EvidenceStore({ paseoHome: makePaseoHome(), maxArtifactBytes: 8 });
    const { runId } = await store.createRun({
      workspaceId: "wks_abc123",
      recipe: "verify-case-report",
    });

    await expect(
      store.writeArtifact({
        runId,
        name: "report",
        kind: "report",
        contentType: "text/plain",
        data: "nine-bytes",
      }),
    ).rejects.toThrow();
  });

  it("records finish status on the manifest", async () => {
    const store = new EvidenceStore({ paseoHome: makePaseoHome() });
    const { runId } = await store.createRun({
      workspaceId: "wks_abc123",
      recipe: "verify-case-report",
    });

    await store.finishRun({ runId, status: "pass" });
    const manifest = await store.getManifest({ workspaceId: "wks_abc123", runId });
    expect(manifest?.status).toBe("pass");
    expect(manifest?.finishedAt).toBeTypeOf("string");
  });

  it("prunes oldest runs beyond the per-workspace retention limit", async () => {
    const paseoHome = makePaseoHome();
    const store = new EvidenceStore({ paseoHome, maxRunsPerWorkspace: 3 });

    const runIds: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const manifest = await store.createRun({
        workspaceId: "wks_abc123",
        recipe: "verify-case-report",
      });
      runIds.push(manifest.runId);
    }

    const remaining = readdirSync(join(paseoHome, "artifacts", "wks_abc123")).filter((entry) =>
      entry.startsWith("evr_"),
    );
    expect(remaining).toHaveLength(3);
    expect(remaining).toEqual(expect.arrayContaining(runIds.slice(2)));
  });
});

describe("EvidenceStore capture metadata", () => {
  it("persists an explicit capture time on artifacts", async () => {
    const store = new EvidenceStore({ paseoHome: makePaseoHome() });
    const { runId } = await store.createRun({
      workspaceId: "wks_abc123",
      recipe: "verify-case-report",
    });
    await store.writeArtifact({
      runId,
      name: "after-login",
      kind: "screenshot",
      contentType: "image/png",
      data: new Uint8Array([137, 80, 78, 71]),
      capturedAt: "2026-09-17T10:00:30.000Z",
    });
    const manifest = await store.getManifest({ workspaceId: "wks_abc123", runId });
    expect(manifest?.artifacts[0]?.capturedAt).toBe("2026-09-17T10:00:30.000Z");
  });

  it("defaults the capture time when the caller passes none", async () => {
    const store = new EvidenceStore({ paseoHome: makePaseoHome() });
    const { runId } = await store.createRun({
      workspaceId: "wks_abc123",
      recipe: "verify-case-report",
    });
    await store.writeArtifact({
      runId,
      name: "report",
      kind: "report",
      contentType: "application/json",
      data: "{}",
    });
    const manifest = await store.getManifest({ workspaceId: "wks_abc123", runId });
    expect(manifest?.artifacts[0]?.capturedAt).toBeTypeOf("string");
  });

  it("lists runs newest first and returns none for unknown workspaces", async () => {
    const store = new EvidenceStore({ paseoHome: makePaseoHome() });
    await store.createRun({ workspaceId: "wks_abc123", recipe: "first", agentId: "agent_1" });
    await store.createRun({ workspaceId: "wks_abc123", recipe: "second" });
    const runs = await store.listRuns("wks_abc123");
    expect(runs.map((run) => run.recipe)).toEqual(["second", "first"]);
    expect(runs.map((run) => run.seq)).toEqual([2, 1]);
    expect(runs[0]?.agentId).toBeUndefined();
    expect(runs[1]?.agentId).toBe("agent_1");
    await expect(store.listRuns("wks_unknown")).resolves.toEqual([]);
  });
});
