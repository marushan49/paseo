import { describe, expect, it } from "vitest";

import {
  CredentialError,
  assertCredentialOriginAllowed,
  resolveCredential,
} from "./credential-broker.js";

const definition = {
  usernameEnv: "VERIFY_TEST_EMAIL",
  passwordEnv: "VERIFY_TEST_PASSWORD",
  allowedOrigins: ["http://127.0.0.1:4001"],
};

describe("resolveCredential", () => {
  it("resolves username and password from the process environment", () => {
    const credential = resolveCredential({
      name: "aip-admin",
      definition,
      env: { VERIFY_TEST_EMAIL: "admin@example.com", VERIFY_TEST_PASSWORD: "s3cr3t" },
    });

    expect(credential).toEqual({ username: "admin@example.com", password: "s3cr3t" });
  });

  it("supports passwordless credentials", () => {
    const credential = resolveCredential({
      name: "token-user",
      definition: { usernameEnv: "VERIFY_TEST_EMAIL", allowedOrigins: ["http://127.0.0.1:4001"] },
      env: { VERIFY_TEST_EMAIL: "admin@example.com" },
    });

    expect(credential).toEqual({ username: "admin@example.com", password: undefined });
  });

  it("fails naming the missing variable, never the secret value", () => {
    try {
      resolveCredential({ name: "aip-admin", definition, env: {} });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CredentialError);
      expect((error as CredentialError).code).toBe("credential_missing_env");
      expect((error as Error).message).toContain("VERIFY_TEST_EMAIL");
      expect((error as Error).message).not.toContain("s3cr3t");
    }
  });
});

describe("assertCredentialOriginAllowed", () => {
  it("accepts allowlisted origins", () => {
    expect(() =>
      assertCredentialOriginAllowed({ url: "http://127.0.0.1:4001/login", definition }),
    ).not.toThrow();
  });

  it("denies anything else without leaking secret material", () => {
    try {
      assertCredentialOriginAllowed({ url: "https://evil.example.com/", definition });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CredentialError);
      expect((error as CredentialError).code).toBe("credential_origin_denied");
      expect((error as Error).message).toContain("https://evil.example.com");
      expect((error as Error).message).not.toContain("s3cr3t");
      expect((error as Error).message).not.toContain("VERIFY_TEST_PASSWORD");
    }
  });
});
