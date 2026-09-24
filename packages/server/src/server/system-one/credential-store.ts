import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { writePrivateFileAtomicSync } from "../private-files.js";

const StoredSystemOneCredentialSchema = z.object({ apiKey: z.string().trim().min(1) }).strict();

export type SystemOneCredentialSource = "paseo" | "environment" | "env-file";

export interface ResolvedSystemOneCredential {
  apiKey: string;
  source: SystemOneCredentialSource;
}

export interface SystemOneCredentialStatus {
  configured: boolean;
  credentialSource: SystemOneCredentialSource | null;
}

export class SystemOneCredentialStore {
  private readonly filePath: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly sharedEnvFile: string;

  public constructor(
    paseoHome: string,
    options: { env?: NodeJS.ProcessEnv; sharedEnvFile?: string } = {},
  ) {
    this.filePath = path.join(paseoHome, "secrets", "system-one.json");
    this.env = options.env ?? process.env;
    this.sharedEnvFile =
      options.sharedEnvFile ??
      this.env.TYPESAFE_ENV_FILE ??
      path.join(homedir(), ".config", "typesafe-ai", "env");
  }

  public resolve(): ResolvedSystemOneCredential | null {
    return this.candidates()[0] ?? null;
  }

  /** Every distinct configured key, in priority order. */
  public candidates(): ResolvedSystemOneCredential[] {
    const all: ResolvedSystemOneCredential[] = [];
    const stored = this.readStored();
    if (stored) all.push({ apiKey: stored.apiKey, source: "paseo" });

    const environmentKey = this.env.TYPESAFE_API_KEY?.trim();
    if (environmentKey) all.push({ apiKey: environmentKey, source: "environment" });

    const sharedKey = readApiKeyFromEnvFile(this.sharedEnvFile);
    if (sharedKey) all.push({ apiKey: sharedKey, source: "env-file" });

    return all.filter(
      (credential, index) => all.findIndex((other) => other.apiKey === credential.apiKey) === index,
    );
  }

  public getStatus(): SystemOneCredentialStatus {
    const credential = this.resolve();
    return {
      configured: credential !== null,
      credentialSource: credential?.source ?? null,
    };
  }

  public set(apiKey: string): SystemOneCredentialStatus {
    const parsed = StoredSystemOneCredentialSchema.parse({ apiKey });
    writePrivateFileAtomicSync(this.filePath, `${JSON.stringify(parsed)}\n`);
    return this.getStatus();
  }

  public clear(): SystemOneCredentialStatus {
    rmSync(this.filePath, { force: true });
    return this.getStatus();
  }

  private readStored(): z.infer<typeof StoredSystemOneCredentialSchema> | null {
    if (!existsSync(this.filePath)) return null;
    try {
      return StoredSystemOneCredentialSchema.parse(JSON.parse(readFileSync(this.filePath, "utf8")));
    } catch {
      throw new Error("Paseo's System One credential file is invalid.");
    }
  }
}

function readApiKeyFromEnvFile(filePath: string): string | null {
  let contents: string;
  try {
    contents = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?TYPESAFE_API_KEY\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const value = stripMatchingQuotes(match[1] ?? "").trim();
    if (value) return value;
  }
  return null;
}

function stripMatchingQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  return (first === '"' && last === '"') || (first === "'" && last === "'")
    ? value.slice(1, -1)
    : value;
}
