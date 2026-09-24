import { describe, expect, it } from "vitest";
import { toElectronCookie } from "./browser-cookie-import.js";

describe("toElectronCookie", () => {
  it("keeps host-only cookies host-only and domain cookies on subdomains", () => {
    const base = { name: "sid", value: "v", path: "/app", httpOnly: true, secure: true };

    expect(toElectronCookie({ ...base, domain: "app.example.com", expires: -1 })).toEqual({
      url: "https://app.example.com/app",
      name: "sid",
      value: "v",
      path: "/app",
      secure: true,
      httpOnly: true,
      sameSite: "unspecified",
    });
    expect(
      toElectronCookie({
        ...base,
        domain: ".example.com",
        expires: 1_900_000_000,
        sameSite: "None",
      }),
    ).toMatchObject({
      url: "https://example.com/app",
      domain: ".example.com",
      expirationDate: 1_900_000_000,
      sameSite: "no_restriction",
    });
  });
});
