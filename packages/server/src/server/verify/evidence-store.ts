import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { writeJsonFileAtomic } from "../atomic-file.js";

export const EVIDENCE_SCHEME = "evidence://";
export const EVIDENCE_MANIFEST_VERSION = 1;
const DEFAULT_MAX_RUNS_PER_WORKSPACE = 20;
const DEFAULT_MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
const RUN_ID_PATTERN = /^evr_[0-9a-f-]{1,64}$/;
const SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export type EvidenceArtifactKind =
  | "screenshot"
  | "trace"
  | "dom-snapshot"
  | "console-log"
  | "network-log"
  | "test-log"
  | "build-log"
  | "report";

export type EvidenceRunStatus = "pass" | "fail" | "error";

export interface EvidenceArtifactEntry {
  name: string;
  kind: EvidenceArtifactKind;
  fileName: string;
  contentType: string;
  bytes: number;
  sha256: string;
  capturedAt: string;
  timelineCursor?: EvidenceTimelineCursor;
}

export interface EvidenceTimelineCursor {
  epoch: string;
  seq: number;
}

export interface EvidenceRunManifest {
  version: typeof EVIDENCE_MANIFEST_VERSION;
  runId: string;
  workspaceId: string;
  recipe: string;
  seq: number;
  startedAt: string;
  finishedAt?: string;
  status?: EvidenceRunStatus;
  agentId?: string;
  artifacts: EvidenceArtifactEntry[];
}

export interface EvidenceRef {
  workspaceId: string;
  runId: string;
  name?: string;
}

export interface EvidenceStoreOptions {
  paseoHome: string;
  maxRunsPerWorkspace?: number;
  maxArtifactBytes?: number;
  now?: () => Date;
}

export interface CreateEvidenceRunInput {
  workspaceId: string;
  recipe: string;
  agentId?: string;
}

export interface WriteEvidenceArtifactInput {
  runId: string;
  name: string;
  kind: EvidenceArtifactKind;
  contentType: string;
  data: string | Uint8Array;
  capturedAt?: string;
  timelineCursor?: EvidenceTimelineCursor;
}

export interface FinishEvidenceRunInput {
  runId: string;
  status: EvidenceRunStatus;
}

export function formatEvidenceRef(ref: EvidenceRef): string {
  return ref.name === undefined
    ? `${EVIDENCE_SCHEME}${ref.workspaceId}/${ref.runId}`
    : `${EVIDENCE_SCHEME}${ref.workspaceId}/${ref.runId}/${ref.name}`;
}

export function parseEvidenceRef(value: string): EvidenceRef | null {
  if (!value.startsWith(EVIDENCE_SCHEME)) {
    return null;
  }
  const rest = value.slice(EVIDENCE_SCHEME.length);
  const segments = rest.split("/");
  if (segments.length !== 2 && segments.length !== 3) {
    return null;
  }
  const [workspaceId, runId, name] = segments;
  if (!workspaceId || !runId || !isSafeSegment(workspaceId) || !isSafeSegment(runId)) {
    return null;
  }
  if (name !== undefined && !isSafeSegment(name)) {
    return null;
  }
  return name === undefined ? { workspaceId, runId } : { workspaceId, runId, name };
}

function isSafeSegment(value: string): boolean {
  return SEGMENT_PATTERN.test(value);
}

function assertSafeSegment(value: string, label: string): void {
  if (!isSafeSegment(value)) {
    throw new Error(`Invalid evidence ${label}: ${value}`);
  }
}

export class EvidenceStore {
  private readonly paseoHome: string;
  private readonly maxRunsPerWorkspace: number;
  private readonly maxArtifactBytes: number;
  private readonly now: () => Date;
  private readonly runLocks = new Map<string, Promise<void>>();
  private readonly workspaceLocks = new Map<string, Promise<void>>();

  public constructor(options: EvidenceStoreOptions) {
    this.paseoHome = options.paseoHome;
    this.maxRunsPerWorkspace = options.maxRunsPerWorkspace ?? DEFAULT_MAX_RUNS_PER_WORKSPACE;
    this.maxArtifactBytes = options.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;
    this.now = options.now ?? (() => new Date());
  }

  public async createRun(input: CreateEvidenceRunInput): Promise<EvidenceRunManifest> {
    assertSafeSegment(input.workspaceId, "workspace id");
    return this.withWorkspaceLock(input.workspaceId, async () => {
      const runId = `evr_${randomUUID()}`;
      const seq = await this.nextSequence(input.workspaceId);
      const manifest: EvidenceRunManifest = {
        version: EVIDENCE_MANIFEST_VERSION,
        runId,
        workspaceId: input.workspaceId,
        recipe: input.recipe,
        seq,
        startedAt: this.now().toISOString(),
        ...(input.agentId ? { agentId: input.agentId } : {}),
        artifacts: [],
      };
      await fs.mkdir(this.runDir(input.workspaceId, runId), { recursive: true });
      await this.writeManifest(manifest);
      await this.pruneWorkspace(input.workspaceId);
      return manifest;
    });
  }

  public async writeArtifact(input: WriteEvidenceArtifactInput): Promise<EvidenceArtifactEntry> {
    assertSafeSegment(input.name, "artifact name");
    const data =
      typeof input.data === "string" ? Buffer.from(input.data, "utf8") : Buffer.from(input.data);
    if (data.byteLength > this.maxArtifactBytes) {
      throw new Error(
        `Evidence artifact ${input.name} is ${data.byteLength} bytes, above the ${this.maxArtifactBytes} byte limit`,
      );
    }
    return this.withRunLock(input.runId, async () => {
      const manifest = await this.loadManifestByRunId(input.runId);
      const fileName = `${input.name}${extensionFor(input.kind, input.contentType)}`;
      const filePath = path.join(this.runDir(manifest.workspaceId, input.runId), fileName);
      await fs.writeFile(filePath, data);
      const entry: EvidenceArtifactEntry = {
        name: input.name,
        kind: input.kind,
        fileName,
        contentType: input.contentType,
        bytes: data.byteLength,
        sha256: createHash("sha256").update(data).digest("hex"),
        capturedAt: input.capturedAt ?? this.now().toISOString(),
        ...(input.timelineCursor ? { timelineCursor: input.timelineCursor } : {}),
      };
      const artifacts = manifest.artifacts.filter((existing) => existing.name !== input.name);
      artifacts.push(entry);
      await this.writeManifest({ ...manifest, artifacts });
      return entry;
    });
  }

  public async finishRun(input: FinishEvidenceRunInput): Promise<void> {
    await this.withRunLock(input.runId, async () => {
      const manifest = await this.loadManifestByRunId(input.runId);
      await this.writeManifest({
        ...manifest,
        status: input.status,
        finishedAt: this.now().toISOString(),
      });
    });
  }

  public async getManifest(input: {
    workspaceId: string;
    runId: string;
  }): Promise<EvidenceRunManifest | null> {
    const manifest = await this.tryLoadManifest(input.workspaceId, input.runId);
    if (!manifest || manifest.workspaceId !== input.workspaceId) {
      return null;
    }
    return manifest;
  }

  public async listRuns(workspaceId: string): Promise<EvidenceRunManifest[]> {
    assertSafeSegment(workspaceId, "workspace id");
    const workspaceDir = path.join(this.paseoHome, "artifacts", workspaceId);
    let runIds: string[] = [];
    try {
      runIds = await fs.readdir(workspaceDir);
    } catch {
      return [];
    }
    const manifests: EvidenceRunManifest[] = [];
    for (const runId of runIds) {
      if (runId === "meta.json") {
        continue;
      }
      const manifest = await this.tryLoadManifest(workspaceId, runId);
      if (manifest) {
        manifests.push(manifest);
      }
    }
    manifests.sort((a, b) => b.seq - a.seq);
    return manifests;
  }

  public async readArtifact(input: {
    workspaceId: string;
    runId: string;
    name: string;
  }): Promise<{ entry: EvidenceArtifactEntry; data: Buffer } | null> {
    assertSafeSegment(input.name, "artifact name");
    const manifest = await this.getManifest({ workspaceId: input.workspaceId, runId: input.runId });
    if (!manifest) {
      return null;
    }
    const entry = manifest.artifacts.find((candidate) => candidate.name === input.name);
    if (!entry) {
      return null;
    }
    const data = await fs.readFile(
      path.join(this.runDir(manifest.workspaceId, input.runId), entry.fileName),
    );
    return { entry, data };
  }

  private runDir(workspaceId: string, runId: string): string {
    return path.join(this.paseoHome, "artifacts", workspaceId, runId);
  }

  private manifestPath(workspaceId: string, runId: string): string {
    return path.join(this.runDir(workspaceId, runId), "manifest.json");
  }

  private async writeManifest(manifest: EvidenceRunManifest): Promise<void> {
    await writeJsonFileAtomic(this.manifestPath(manifest.workspaceId, manifest.runId), manifest);
  }

  private async tryLoadManifest(
    workspaceId: string,
    runId: string,
  ): Promise<EvidenceRunManifest | null> {
    if (!RUN_ID_PATTERN.test(runId) || !isSafeSegment(workspaceId)) {
      return null;
    }
    try {
      const raw = await fs.readFile(this.manifestPath(workspaceId, runId), "utf8");
      const manifest = JSON.parse(raw) as EvidenceRunManifest;
      if (manifest.runId !== runId) {
        return null;
      }
      return manifest;
    } catch {
      return null;
    }
  }

  private async loadManifestByRunId(runId: string): Promise<EvidenceRunManifest> {
    if (!RUN_ID_PATTERN.test(runId)) {
      throw new Error(`Invalid evidence run id: ${runId}`);
    }
    const workspaceDir = path.join(this.paseoHome, "artifacts");
    let workspaceIds: string[] = [];
    try {
      workspaceIds = await fs.readdir(workspaceDir);
    } catch {
      throw new Error(`Evidence run not found: ${runId}`);
    }
    for (const workspaceId of workspaceIds) {
      const manifest = await this.tryLoadManifest(workspaceId, runId);
      if (manifest) {
        return manifest;
      }
    }
    throw new Error(`Evidence run not found: ${runId}`);
  }

  private async withRunLock<T>(runId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.runLocks.get(runId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.runLocks.set(runId, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.runLocks.get(runId) === tail) {
        this.runLocks.delete(runId);
      }
    }
  }

  private async nextSequence(workspaceId: string): Promise<number> {
    const metaPath = path.join(this.paseoHome, "artifacts", workspaceId, "meta.json");
    let next = 1;
    try {
      const raw = await fs.readFile(metaPath, "utf8");
      const meta = JSON.parse(raw) as { nextSeq?: unknown };
      if (typeof meta.nextSeq === "number" && Number.isInteger(meta.nextSeq) && meta.nextSeq >= 1) {
        next = meta.nextSeq;
      }
    } catch {
      next = 1;
    }
    await writeJsonFileAtomic(metaPath, { nextSeq: next + 1 });
    return next;
  }

  private async withWorkspaceLock<T>(workspaceId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.workspaceLocks.get(workspaceId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.workspaceLocks.set(workspaceId, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.workspaceLocks.get(workspaceId) === tail) {
        this.workspaceLocks.delete(workspaceId);
      }
    }
  }

  private async pruneWorkspace(workspaceId: string): Promise<void> {
    const workspaceDir = path.join(this.paseoHome, "artifacts", workspaceId);
    let runIds: string[] = [];
    try {
      runIds = await fs.readdir(workspaceDir);
    } catch {
      return;
    }
    if (runIds.length <= this.maxRunsPerWorkspace) {
      return;
    }
    const withSeq: Array<{ runId: string; seq: number }> = [];
    for (const runId of runIds) {
      if (runId === "meta.json") {
        continue;
      }
      const manifest = await this.tryLoadManifest(workspaceId, runId);
      if (manifest) {
        withSeq.push({ runId, seq: manifest.seq ?? 0 });
      }
    }
    withSeq.sort((a, b) => a.seq - b.seq);
    const overflow = withSeq.slice(0, withSeq.length - this.maxRunsPerWorkspace);
    for (const entry of overflow) {
      await fs.rm(path.join(workspaceDir, entry.runId), { recursive: true, force: true });
    }
  }
}

function extensionFor(kind: EvidenceArtifactKind, contentType: string): string {
  if (contentType === "image/png") {
    return ".png";
  }
  if (contentType === "application/json") {
    return ".json";
  }
  switch (kind) {
    case "screenshot":
      return ".png";
    case "trace":
      return ".zip";
    case "report":
    case "console-log":
    case "network-log":
    case "test-log":
    case "build-log":
    case "dom-snapshot":
      return ".json";
  }
}
