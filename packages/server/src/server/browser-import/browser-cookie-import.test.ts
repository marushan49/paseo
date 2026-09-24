import { createCipheriv, createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  BrowserImportError,
  decryptChromiumCookieValue,
  deriveChromiumKey,
  listBrowserImportSources,
  readBrowserImportCookies,
  type BrowserImportEnvironment,
} from "./browser-cookie-import.js";

const NOW = 1_800_000_000;
const FUTURE = NOW + 86_400;
const CHROMIUM_EPOCH_OFFSET = 11_644_473_600;

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "paseo-cookie-fixture-"));
  homes.push(home);
  return home;
}

function env(input: {
  homeDir: string;
  platform: NodeJS.Platform;
  password?: string | null;
}): BrowserImportEnvironment {
  return {
    homeDir: input.homeDir,
    platform: input.platform,
    nowSeconds: NOW,
    readSafeStoragePassword: async () => input.password ?? null,
  };
}

function encrypt(input: { prefix: string; key: Buffer; plaintext: Buffer }): Buffer {
  const cipher = createCipheriv("aes-128-cbc", input.key, Buffer.alloc(16, 0x20));
  return Buffer.concat([Buffer.from(input.prefix), cipher.update(input.plaintext), cipher.final()]);
}

function chromiumPlaintext(domain: string, value: string, metaVersion: number): Buffer {
  const hostHash = createHash("sha256").update(domain).digest();
  return metaVersion >= 24 ? Buffer.concat([hostHash, Buffer.from(value)]) : Buffer.from(value);
}

interface ChromiumRow {
  host_key: string;
  name: string;
  encrypted_value: Buffer;
  expires_seconds: number | null;
  is_secure?: number;
  is_httponly?: number;
  samesite?: number;
  top_frame_site_key?: string;
}

function writeChromiumProfile(input: {
  root: string;
  metaVersion: number;
  rows: ChromiumRow[];
}): void {
  mkdirSync(join(input.root, "Default", "Network"), { recursive: true });
  writeFileSync(
    join(input.root, "Local State"),
    JSON.stringify({ profile: { info_cache: { Default: { name: "Work" } } } }),
  );
  const db = new DatabaseSync(join(input.root, "Default", "Network", "Cookies"));
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE cookies (
      host_key TEXT, top_frame_site_key TEXT, name TEXT, value TEXT, encrypted_value BLOB,
      path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER,
      has_expires INTEGER, is_persistent INTEGER, samesite INTEGER
    );
  `);
  db.prepare("INSERT INTO meta VALUES ('version', ?)").run(String(input.metaVersion));
  const insert = db.prepare("INSERT INTO cookies VALUES (?, ?, ?, '', ?, '/', ?, ?, ?, ?, ?, ?)");
  for (const row of input.rows) {
    const persistent = row.expires_seconds === null ? 0 : 1;
    insert.run(
      row.host_key,
      row.top_frame_site_key ?? "",
      row.name,
      row.encrypted_value,
      row.expires_seconds === null ? 0 : (row.expires_seconds + CHROMIUM_EPOCH_OFFSET) * 1_000_000,
      row.is_secure ?? 1,
      row.is_httponly ?? 0,
      persistent,
      persistent,
      row.samesite ?? -1,
    );
  }
  db.close();
}

describe("Chromium cookie decryption", () => {
  it("decrypts Linux v10 cookies and strips the host hash from DB version 24", async () => {
    const homeDir = makeHome();
    const key = deriveChromiumKey("peanuts", 1);
    writeChromiumProfile({
      root: join(homeDir, ".config", "google-chrome"),
      metaVersion: 24,
      rows: [
        {
          host_key: ".example.com",
          name: "sid",
          encrypted_value: encrypt({
            prefix: "v10",
            key,
            plaintext: chromiumPlaintext(".example.com", "secret-1", 24),
          }),
          expires_seconds: FUTURE,
          is_httponly: 1,
          samesite: 2,
        },
        {
          host_key: "app.example.com",
          name: "session",
          encrypted_value: encrypt({
            prefix: "v10",
            key,
            plaintext: chromiumPlaintext("app.example.com", "secret-2", 24),
          }),
          expires_seconds: null,
          is_secure: 0,
          samesite: 0,
        },
        {
          host_key: ".example.com",
          name: "expired",
          encrypted_value: encrypt({
            prefix: "v10",
            key,
            plaintext: chromiumPlaintext(".example.com", "old", 24),
          }),
          expires_seconds: NOW - 10,
        },
        {
          host_key: ".example.com",
          name: "partitioned",
          encrypted_value: encrypt({
            prefix: "v10",
            key,
            plaintext: chromiumPlaintext(".example.com", "chips", 24),
          }),
          expires_seconds: FUTURE,
          top_frame_site_key: "https://other.example",
        },
      ],
    });
    const linux = env({ homeDir, platform: "linux" });

    expect(await listBrowserImportSources(linux)).toEqual([
      { id: "chrome:Default", browserName: "Google Chrome", profileName: "Work" },
    ]);
    expect(await readBrowserImportCookies("chrome:Default", linux)).toEqual([
      {
        name: "sid",
        value: "secret-1",
        domain: ".example.com",
        path: "/",
        expires: FUTURE,
        httpOnly: true,
        secure: true,
        sameSite: "Strict",
      },
      {
        name: "session",
        value: "secret-2",
        domain: "app.example.com",
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: false,
      },
    ]);
  });

  it("decrypts macOS v10 cookies with the Keychain password before DB version 24", async () => {
    const homeDir = makeHome();
    const key = deriveChromiumKey("keychain-secret", 1003);
    writeChromiumProfile({
      root: join(homeDir, "Library", "Application Support", "BraveSoftware", "Brave-Browser"),
      metaVersion: 23,
      rows: [
        {
          host_key: ".example.org",
          name: "token",
          encrypted_value: encrypt({
            prefix: "v10",
            key,
            plaintext: chromiumPlaintext(".example.org", "mac-value", 23),
          }),
          expires_seconds: FUTURE,
          samesite: 1,
        },
      ],
    });
    const mac = env({ homeDir, platform: "darwin", password: "keychain-secret" });

    const cookies = await readBrowserImportCookies("brave:Default", mac);
    expect(cookies).toEqual([
      expect.objectContaining({ name: "token", value: "mac-value", sameSite: "Lax" }),
    ]);
  });

  it("decrypts Linux v11 cookies with the libsecret password", async () => {
    const homeDir = makeHome();
    writeChromiumProfile({
      root: join(homeDir, ".config", "chromium"),
      metaVersion: 24,
      rows: [
        {
          host_key: ".example.net",
          name: "v11",
          encrypted_value: encrypt({
            prefix: "v11",
            key: deriveChromiumKey("libsecret-password", 1),
            plaintext: chromiumPlaintext(".example.net", "keyring-value", 24),
          }),
          expires_seconds: FUTURE,
        },
      ],
    });

    const withKeyring = env({ homeDir, platform: "linux", password: "libsecret-password" });
    expect(await readBrowserImportCookies("chromium:Default", withKeyring)).toEqual([
      expect.objectContaining({ name: "v11", value: "keyring-value" }),
    ]);

    const withoutKeyring = env({ homeDir, platform: "linux", password: null });
    await expect(readBrowserImportCookies("chromium:Default", withoutKeyring)).rejects.toThrow(
      BrowserImportError,
    );
  });

  it("reports a wrong key instead of returning garbage", async () => {
    const homeDir = makeHome();
    writeChromiumProfile({
      root: join(homeDir, "Library", "Application Support", "Google", "Chrome"),
      metaVersion: 24,
      rows: [
        {
          host_key: ".example.com",
          name: "sid",
          encrypted_value: encrypt({
            prefix: "v10",
            key: deriveChromiumKey("real-password", 1003),
            plaintext: chromiumPlaintext(".example.com", "value", 24),
          }),
          expires_seconds: FUTURE,
        },
      ],
    });
    const mac = env({ homeDir, platform: "darwin", password: "wrong-password" });

    await expect(readBrowserImportCookies("chrome:Default", mac)).rejects.toThrow(
      /could not be decrypted/,
    );
  });

  it("rejects a value whose host hash belongs to another domain", () => {
    const key = deriveChromiumKey("peanuts", 1);
    const encrypted = encrypt({
      prefix: "v10",
      key,
      plaintext: chromiumPlaintext(".other.com", "value", 24),
    });
    expect(
      decryptChromiumCookieValue({
        encrypted,
        keys: { v10: key, v11: null },
        domain: ".example.com",
        metaVersion: 24,
      }),
    ).toBeNull();
  });
});

describe("Firefox cookies", () => {
  it("reads the default cookie jar from profiles.ini with seconds and milliseconds expiry", async () => {
    const homeDir = makeHome();
    const root = join(homeDir, ".mozilla", "firefox");
    mkdirSync(join(root, "abcd.default-release"), { recursive: true });
    writeFileSync(
      join(root, "profiles.ini"),
      [
        "[General]",
        "StartWithLastProfile=1",
        "",
        "[Profile0]",
        "Name=default-release",
        "IsRelative=1",
        "Path=abcd.default-release",
        "",
      ].join("\n"),
    );
    const db = new DatabaseSync(join(root, "abcd.default-release", "cookies.sqlite"));
    db.exec(`CREATE TABLE moz_cookies (
      originAttributes TEXT, name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER,
      isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER
    )`);
    const insert = db.prepare("INSERT INTO moz_cookies VALUES (?, ?, ?, ?, '/', ?, ?, ?, ?)");
    insert.run("", "seconds", "a", ".example.com", FUTURE, 1, 1, 0);
    insert.run("", "millis", "b", "example.com", FUTURE * 1000, 0, 0, 1);
    insert.run("", "expired", "c", ".example.com", NOW - 1, 0, 0, 0);
    insert.run("^userContextId=1", "container", "d", ".example.com", FUTURE, 0, 0, 0);
    db.close();
    const linux = env({ homeDir, platform: "linux" });

    expect(await listBrowserImportSources(linux)).toEqual([
      {
        id: `firefox:${join(root, "abcd.default-release")}`,
        browserName: "Firefox",
        profileName: "default-release",
      },
    ]);
    const [source] = await listBrowserImportSources(linux);
    expect(await readBrowserImportCookies(source!.id, linux)).toEqual([
      {
        name: "seconds",
        value: "a",
        domain: ".example.com",
        path: "/",
        expires: FUTURE,
        httpOnly: true,
        secure: true,
        sameSite: "None",
      },
      {
        name: "millis",
        value: "b",
        domain: "example.com",
        path: "/",
        expires: FUTURE,
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
      },
    ]);
  });

  it("refuses profiles that were not detected", async () => {
    const linux = env({ homeDir: makeHome(), platform: "linux" });
    await expect(readBrowserImportCookies("firefox:/etc", linux)).rejects.toThrow(
      BrowserImportError,
    );
  });
});
