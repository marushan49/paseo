import { chmodSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SystemOneCredentialStore } from "./credential-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function makeDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

describe("SystemOneCredentialStore", () => {
  it("stores a key privately without returning it in status", async () => {
    const paseoHome = await makeDirectory("paseo-system-one-");
    const store = new SystemOneCredentialStore(paseoHome, { env: {}, sharedEnvFile: "/missing" });

    expect(store.set("private-key")).toEqual({
      configured: true,
      credentialSource: "paseo",
    });

    const filePath = path.join(paseoHome, "secrets", "system-one.json");
    if (process.platform !== "win32") expect(statSync(filePath).mode & 0o777).toBe(0o600);
    expect(readFileSync(filePath, "utf8")).toContain("private-key");
  });

  it("falls back to environment and the shared env file", async () => {
    const paseoHome = await makeDirectory("paseo-system-one-");
    const sharedEnvFile = path.join(await makeDirectory("typesafe-env-"), "env");
    await writeFile(sharedEnvFile, "TYPESAFE_API_KEY='shared-key'\n", { mode: 0o600 });
    chmodSync(sharedEnvFile, 0o600);

    expect(
      new SystemOneCredentialStore(paseoHome, {
        env: { TYPESAFE_API_KEY: "environment-key" },
        sharedEnvFile,
      }).resolve(),
    ).toEqual({ apiKey: "environment-key", source: "environment" });
    expect(new SystemOneCredentialStore(paseoHome, { env: {}, sharedEnvFile }).resolve()).toEqual({
      apiKey: "shared-key",
      source: "env-file",
    });
  });

  it("clears only Paseo's copy and keeps an external fallback", async () => {
    const paseoHome = await makeDirectory("paseo-system-one-");
    const store = new SystemOneCredentialStore(paseoHome, {
      env: { TYPESAFE_API_KEY: "fallback-key" },
      sharedEnvFile: "/missing",
    });
    store.set("paseo-key");

    expect(store.clear()).toEqual({
      configured: true,
      credentialSource: "environment",
    });
  });
});
