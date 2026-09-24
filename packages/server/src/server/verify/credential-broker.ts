import { isOriginAllowed } from "./secret-redaction.js";

export type CredentialErrorCode = "credential_missing_env" | "credential_origin_denied";

export class CredentialError extends Error {
  public readonly code: CredentialErrorCode;

  public constructor(code: CredentialErrorCode, message: string) {
    super(message);
    this.name = "CredentialError";
    this.code = code;
  }
}

export interface CredentialDefinition {
  usernameEnv: string;
  passwordEnv?: string;
  allowedOrigins: string[];
}

export interface ResolvedCredential {
  username: string;
  password?: string;
}

export interface ResolveCredentialInput {
  name: string;
  definition: CredentialDefinition;
  env: NodeJS.ProcessEnv;
}

export function resolveCredential(input: ResolveCredentialInput): ResolvedCredential {
  const username = readEnvVar(input.env, input.definition.usernameEnv);
  if (!username) {
    throw new CredentialError(
      "credential_missing_env",
      `Credential ${input.name} needs ${input.definition.usernameEnv} in the daemon environment`,
    );
  }
  if (input.definition.passwordEnv === undefined) {
    return { username };
  }
  const password = readEnvVar(input.env, input.definition.passwordEnv);
  if (!password) {
    throw new CredentialError(
      "credential_missing_env",
      `Credential ${input.name} needs ${input.definition.passwordEnv} in the daemon environment`,
    );
  }
  return { username, password };
}

export interface AssertCredentialOriginInput {
  url: string;
  definition: Pick<CredentialDefinition, "allowedOrigins">;
}

export function assertCredentialOriginAllowed(input: AssertCredentialOriginInput): void {
  if (isOriginAllowed(input.url, input.definition.allowedOrigins)) {
    return;
  }
  throw new CredentialError(
    "credential_origin_denied",
    `Credential use denied for ${input.url}; allowed origins: ${input.definition.allowedOrigins.join(", ") || "(none)"}`,
  );
}

function readEnvVar(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return value !== undefined && value.length > 0 ? value : undefined;
}
