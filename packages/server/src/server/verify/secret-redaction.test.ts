import { describe, expect, it } from "vitest";

import { createSecretRedactor, isOriginAllowed, normalizeOrigin } from "./secret-redaction.js";

describe("SecretRedactor", () => {
  it("replaces every occurrence of registered secrets", () => {
    const redactor = createSecretRedactor();
    redactor.addSecret("s3cr3t-pw");
    redactor.addSecret("admin@example.com");

    expect(redactor.redact("login with admin@example.com / s3cr3t-pw failed")).toBe(
      "login with [REDACTED] / [REDACTED] failed",
    );
    expect(redactor.redact("nothing sensitive here")).toBe("nothing sensitive here");
  });

  it("redacts longest secrets first so overlapping values stay fully covered", () => {
    const redactor = createSecretRedactor();
    redactor.addSecret("short");
    redactor.addSecret("short-and-long");

    expect(redactor.redact("value short-and-long here")).toBe("value [REDACTED] here");
  });

  it("ignores empty values instead of redacting everything", () => {
    const redactor = createSecretRedactor();
    redactor.addSecret("");

    expect(redactor.redact("unchanged")).toBe("unchanged");
    expect(redactor.secretCount).toBe(0);
  });
});

describe("origin allowlist", () => {
  it("normalizes http origins with explicit ports", () => {
    expect(normalizeOrigin("http://127.0.0.1:4001/en/case/1")).toBe("http://127.0.0.1:4001");
    expect(normalizeOrigin("https://dev.example.com:443/x")).toBe("https://dev.example.com");
    expect(normalizeOrigin("http://EXAMPLE.com:80/x")).toBe("http://example.com");
  });

  it("returns null for non-http URLs", () => {
    expect(normalizeOrigin("file:///etc/passwd")).toBeNull();
    expect(normalizeOrigin("not a url")).toBeNull();
  });

  it("matches exact origins only", () => {
    const allowed = ["http://127.0.0.1:4001", "https://dev.example.com"];
    expect(isOriginAllowed("http://127.0.0.1:4001/login", allowed)).toBe(true);
    expect(isOriginAllowed("https://dev.example.com/a?b=c", allowed)).toBe(true);
  });

  it("rejects lookalikes, subdomains, ports, and scheme swaps", () => {
    const allowed = ["http://127.0.0.1:4001", "https://dev.example.com"];
    expect(isOriginAllowed("http://127.0.0.1:4002/login", allowed)).toBe(false);
    expect(isOriginAllowed("https://evil-dev.example.com/", allowed)).toBe(false);
    expect(isOriginAllowed("https://dev.example.com.evil.com/", allowed)).toBe(false);
    expect(isOriginAllowed("https://127.0.0.1:4001/", allowed)).toBe(false);
    expect(isOriginAllowed("http://dev.example.com/", allowed)).toBe(false);
  });

  it("fails closed on invalid inputs", () => {
    expect(isOriginAllowed("not a url", ["http://127.0.0.1:4001"])).toBe(false);
    expect(isOriginAllowed("http://127.0.0.1:4001/", [])).toBe(false);
    expect(isOriginAllowed("http://127.0.0.1:4001/", ["not-an-origin"])).toBe(false);
  });
});
