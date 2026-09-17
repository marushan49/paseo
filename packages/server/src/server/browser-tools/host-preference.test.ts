import { describe, expect, it } from "vitest";

import { prefersDaemonHost } from "./host-preference.js";

describe("prefersDaemonHost", () => {
  // The daemon is the machine the code runs on. A loopback address means the
  // dev server on that machine, and no other host can reach it: the desktop
  // app's browser would resolve localhost to the laptop and load nothing.
  it("claims loopback addresses for the daemon", () => {
    expect(prefersDaemonHost("http://localhost:3002")).toBe(true);
    expect(prefersDaemonHost("http://127.0.0.1:8080/x")).toBe(true);
    expect(prefersDaemonHost("https://[::1]:5173")).toBe(true);
    expect(prefersDaemonHost("http://localhost")).toBe(true);
  });

  it("leaves the wider internet to whichever host is in front", () => {
    expect(prefersDaemonHost("https://github.com/acme/app")).toBe(false);
    expect(prefersDaemonHost("https://app.9elf26.ai")).toBe(false);
  });

  // A hostname that merely starts with the word is a different machine.
  it("does not mistake a lookalike hostname for loopback", () => {
    expect(prefersDaemonHost("http://localhost.evil.test/")).toBe(false);
    expect(prefersDaemonHost("http://mylocalhost:3000")).toBe(false);
    expect(prefersDaemonHost("http://127.0.0.1.evil.test/")).toBe(false);
  });

  it("says no when there is no usable url", () => {
    expect(prefersDaemonHost(undefined)).toBe(false);
    expect(prefersDaemonHost("")).toBe(false);
    expect(prefersDaemonHost("not a url")).toBe(false);
  });
});
