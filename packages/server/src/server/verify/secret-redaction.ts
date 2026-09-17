export const REDACTED_PLACEHOLDER = "[REDACTED]";

export interface SecretRedactor {
  readonly secretCount: number;
  addSecret(value: string): void;
  redact(text: string): string;
}

export function createSecretRedactor(): SecretRedactor {
  const secrets: string[] = [];
  return {
    get secretCount() {
      return secrets.length;
    },
    addSecret(value: string): void {
      if (value.length === 0 || secrets.includes(value)) {
        return;
      }
      secrets.push(value);
      secrets.sort((a, b) => b.length - a.length);
    },
    redact(text: string): string {
      let redacted = text;
      for (const secret of secrets) {
        redacted = redacted.split(secret).join(REDACTED_PLACEHOLDER);
      }
      return redacted;
    },
  };
}

export function normalizeOrigin(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host.length === 0) {
    return null;
  }
  const defaultPort = parsed.protocol === "http:" ? "80" : "443";
  const port = parsed.port;
  return port.length === 0 || port === defaultPort
    ? `${parsed.protocol}//${host}`
    : `${parsed.protocol}//${host}:${port}`;
}

export function isOriginAllowed(url: string, allowedOrigins: readonly string[]): boolean {
  const origin = normalizeOrigin(url);
  if (!origin) {
    return false;
  }
  for (const allowed of allowedOrigins) {
    if (normalizeOrigin(allowed) === origin) {
      return true;
    }
  }
  return false;
}
