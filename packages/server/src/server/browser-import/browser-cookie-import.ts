import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  BrowserImportCookie,
  BrowserImportSource,
} from "@getpaseo/protocol/browser-import/rpc-schemas";
import { execCommand } from "../../utils/spawn.js";

export type { BrowserImportCookie, BrowserImportSource };

export class BrowserImportError extends Error {}

export interface ChromiumBrowser {
  key: string;
  name: string;
  macDir: string | null;
  macKeychainService: string;
  linuxDir: string | null;
  linuxSecretApplication: string;
}

const CHROMIUM_BROWSERS: ChromiumBrowser[] = [
  {
    key: "chrome",
    name: "Google Chrome",
    macDir: "Google/Chrome",
    macKeychainService: "Chrome Safe Storage",
    linuxDir: "google-chrome",
    linuxSecretApplication: "chrome",
  },
  {
    key: "chromium",
    name: "Chromium",
    macDir: "Chromium",
    macKeychainService: "Chromium Safe Storage",
    linuxDir: "chromium",
    linuxSecretApplication: "chromium",
  },
  {
    key: "brave",
    name: "Brave",
    macDir: "BraveSoftware/Brave-Browser",
    macKeychainService: "Brave Safe Storage",
    linuxDir: "BraveSoftware/Brave-Browser",
    linuxSecretApplication: "brave",
  },
  {
    key: "edge",
    name: "Microsoft Edge",
    macDir: "Microsoft Edge",
    macKeychainService: "Microsoft Edge Safe Storage",
    linuxDir: "microsoft-edge",
    linuxSecretApplication: "microsoft-edge",
  },
  {
    key: "arc",
    name: "Arc",
    macDir: "Arc/User Data",
    macKeychainService: "Arc Safe Storage",
    linuxDir: null,
    linuxSecretApplication: "arc",
  },
  {
    key: "vivaldi",
    name: "Vivaldi",
    macDir: "Vivaldi",
    macKeychainService: "Vivaldi Safe Storage",
    linuxDir: "vivaldi",
    linuxSecretApplication: "vivaldi",
  },
];

// Seconds between 1601-01-01 (Chromium's cookie epoch) and 1970-01-01.
const CHROMIUM_EPOCH_OFFSET_SECONDS = 11_644_473_600;
// Playwright rejects expiry beyond 9999-12-31.
const MAX_COOKIE_EXPIRES_SECONDS = 253_402_300_799;
const CHROMIUM_IV = Buffer.alloc(16, 0x20);

interface ResolvedSource extends BrowserImportSource {
  family: "chromium" | "firefox";
  cookiesPath: string;
  browser?: ChromiumBrowser;
}

export interface BrowserImportEnvironment {
  homeDir: string;
  platform: NodeJS.Platform;
  nowSeconds: number;
  /** Returns the Safe Storage password; null when the keyring has none. */
  readSafeStoragePassword: (browser: ChromiumBrowser) => Promise<string | null>;
}

export function defaultBrowserImportEnvironment(): BrowserImportEnvironment {
  const platform = process.platform;
  return {
    homeDir: os.homedir(),
    platform,
    nowSeconds: Date.now() / 1000,
    readSafeStoragePassword: (browser) =>
      platform === "darwin"
        ? readMacKeychainPassword(browser.macKeychainService)
        : readLinuxSecretPassword(browser.linuxSecretApplication),
  };
}

export async function listBrowserImportSources(
  env: BrowserImportEnvironment = defaultBrowserImportEnvironment(),
): Promise<BrowserImportSource[]> {
  const sources = await resolveSources(env);
  return sources.map(({ id, browserName, profileName }) => ({ id, browserName, profileName }));
}

export async function readBrowserImportCookies(
  sourceId: string,
  env: BrowserImportEnvironment = defaultBrowserImportEnvironment(),
): Promise<BrowserImportCookie[]> {
  // Resolve by id instead of accepting a path, so a client can only name detected profiles.
  const source = (await resolveSources(env)).find((candidate) => candidate.id === sourceId);
  if (!source) {
    throw new BrowserImportError(`Browser profile ${sourceId} was not found on this device.`);
  }
  return withDatabaseCopy(source.cookiesPath, async (db) =>
    source.family === "firefox"
      ? readFirefoxCookies(db, env.nowSeconds)
      : readChromiumCookies(db, source.browser!, env),
  );
}

async function resolveSources(env: BrowserImportEnvironment): Promise<ResolvedSource[]> {
  const sources: ResolvedSource[] = [];
  for (const browser of CHROMIUM_BROWSERS) {
    const root = chromiumRoot(browser, env);
    if (!root) continue;
    for (const profile of await listChromiumProfiles(root)) {
      const cookiesPath = [
        path.join(root, profile.dir, "Network", "Cookies"),
        path.join(root, profile.dir, "Cookies"),
      ].find((candidate) => existsSync(candidate));
      if (!cookiesPath) continue;
      sources.push({
        id: `${browser.key}:${profile.dir}`,
        browserName: browser.name,
        profileName: profile.name,
        family: "chromium",
        cookiesPath,
        browser,
      });
    }
  }
  for (const root of firefoxRoots(env)) {
    for (const profile of await listFirefoxProfiles(root)) {
      const cookiesPath = path.join(profile.dir, "cookies.sqlite");
      if (!existsSync(cookiesPath)) continue;
      sources.push({
        id: `firefox:${profile.dir}`,
        browserName: "Firefox",
        profileName: profile.name,
        family: "firefox",
        cookiesPath,
      });
    }
  }
  return sources;
}

function chromiumRoot(browser: ChromiumBrowser, env: BrowserImportEnvironment): string | null {
  if (env.platform === "darwin" && browser.macDir) {
    return path.join(env.homeDir, "Library", "Application Support", browser.macDir);
  }
  if (env.platform === "linux" && browser.linuxDir) {
    return path.join(env.homeDir, ".config", browser.linuxDir);
  }
  return null;
}

function firefoxRoots(env: BrowserImportEnvironment): string[] {
  if (env.platform === "darwin") {
    return [path.join(env.homeDir, "Library", "Application Support", "Firefox")];
  }
  if (env.platform === "linux") {
    return [
      path.join(env.homeDir, ".mozilla", "firefox"),
      path.join(env.homeDir, "snap", "firefox", "common", ".mozilla", "firefox"),
    ];
  }
  return [];
}

async function listChromiumProfiles(root: string): Promise<Array<{ dir: string; name: string }>> {
  try {
    const localState = JSON.parse(await readFile(path.join(root, "Local State"), "utf8")) as {
      profile?: { info_cache?: Record<string, { name?: string }> };
    };
    const cache = localState.profile?.info_cache;
    if (cache && Object.keys(cache).length > 0) {
      return Object.entries(cache).map(([dir, info]) => ({ dir, name: info.name || dir }));
    }
  } catch {
    // No readable Local State: fall back to the conventional profile directory names.
  }
  const entries = await readdir(root).catch(() => [] as string[]);
  return entries
    .filter((entry) => entry === "Default" || /^Profile \d+$/.test(entry))
    .map((dir) => ({ dir, name: dir }));
}

async function listFirefoxProfiles(root: string): Promise<Array<{ dir: string; name: string }>> {
  const ini = await readFile(path.join(root, "profiles.ini"), "utf8").catch(() => null);
  if (!ini) return [];
  const profiles: Array<{ dir: string; name: string }> = [];
  for (const section of ini.split(/^\[/m)) {
    if (!section.startsWith("Profile")) continue;
    const fields = Object.fromEntries(
      section
        .split(/\r?\n/)
        .map((line) => line.split("="))
        .filter((parts) => parts.length >= 2)
        .map(([key, ...rest]) => [key!.trim(), rest.join("=").trim()]),
    );
    if (!fields.Path) continue;
    const dir = fields.IsRelative === "0" ? fields.Path : path.join(root, fields.Path);
    profiles.push({ dir, name: fields.Name || fields.Path });
  }
  return profiles;
}

// node:sqlite ships with Node 22.5+ and Electron 44, but @types/node@20 has no typings for it.
interface SqliteStatement {
  all(): Record<string, unknown>[];
  get(): Record<string, unknown> | undefined;
  setReadBigInts(enabled: boolean): void;
}
interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  close(): void;
}
interface SqliteModule {
  DatabaseSync: new (path: string) => SqliteDatabase;
}

async function withDatabaseCopy<T>(
  dbPath: string,
  read: (db: SqliteDatabase) => T | Promise<T>,
): Promise<T> {
  const sqliteSpecifier: string = "node:sqlite";
  const sqlite = (await import(sqliteSpecifier)) as SqliteModule;
  // The running browser holds a lock on its database; read a private copy including its journal.
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "paseo-cookie-import-"));
  const copyPath = path.join(tempDir, "cookies.db");
  try {
    for (const suffix of ["", "-wal", "-journal"]) {
      if (existsSync(dbPath + suffix)) await copyFile(dbPath + suffix, copyPath + suffix);
    }
    const db = new sqlite.DatabaseSync(copyPath);
    try {
      return await read(db);
    } finally {
      db.close();
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function readAllRows(db: SqliteDatabase, sql: string): Record<string, unknown>[] {
  const statement = db.prepare(sql);
  // Chromium's expires_utc (microseconds since 1601) exceeds Number.MAX_SAFE_INTEGER.
  statement.setReadBigInts(true);
  return statement.all();
}

async function readChromiumCookies(
  db: SqliteDatabase,
  browser: ChromiumBrowser,
  env: BrowserImportEnvironment,
): Promise<BrowserImportCookie[]> {
  const metaVersion = Number(
    db.prepare("SELECT value FROM meta WHERE key = 'version'").get()?.value ?? 0,
  );
  const rows = readAllRows(db, "SELECT * FROM cookies");
  const keys = await chromiumKeys(rows, browser, env);
  const cookies: BrowserImportCookie[] = [];
  let undecryptable = 0;
  for (const row of rows) {
    // Partitioned (CHIPS) cookies need a partition key Playwright's addCookies cannot express here.
    if (row.top_frame_site_key) continue;
    const expires =
      Number(row.has_expires) && Number(row.is_persistent)
        ? Math.min(
            Number(row.expires_utc) / 1_000_000 - CHROMIUM_EPOCH_OFFSET_SECONDS,
            MAX_COOKIE_EXPIRES_SECONDS,
          )
        : -1;
    if (expires !== -1 && expires < env.nowSeconds) continue;
    const domain = String(row.host_key);
    const encrypted = Buffer.from(row.encrypted_value as Uint8Array);
    let value = String(row.value ?? "");
    if (encrypted.length > 0) {
      const decrypted = decryptChromiumCookieValue({ encrypted, keys, domain, metaVersion });
      if (decrypted === null) {
        undecryptable += 1;
        continue;
      }
      value = decrypted;
    }
    const secure = Boolean(Number(row.is_secure));
    cookies.push({
      name: String(row.name),
      value,
      domain,
      path: String(row.path || "/"),
      expires,
      httpOnly: Boolean(Number(row.is_httponly)),
      secure,
      ...sameSiteAttribute(Number(row.samesite), secure),
    });
  }
  if (cookies.length === 0 && undecryptable > 0) {
    throw new BrowserImportError(
      `${browser.name} cookies could not be decrypted with the key from this device's keyring.`,
    );
  }
  return cookies;
}

export interface ChromiumKeys {
  v10: Buffer | null;
  v11: Buffer | null;
}

async function chromiumKeys(
  rows: Record<string, unknown>[],
  browser: ChromiumBrowser,
  env: BrowserImportEnvironment,
): Promise<ChromiumKeys> {
  const prefixes = new Set(
    rows.map((row) =>
      Buffer.from(row.encrypted_value as Uint8Array)
        .subarray(0, 3)
        .toString(),
    ),
  );
  if (env.platform === "darwin") {
    if (!prefixes.has("v10")) return { v10: null, v11: null };
    const password = await env.readSafeStoragePassword(browser);
    if (!password) {
      throw new BrowserImportError(`Keychain has no "${browser.macKeychainService}" entry.`);
    }
    return { v10: deriveChromiumKey(password, 1003), v11: null };
  }
  // Linux: v10 uses Chromium's fixed fallback password, v11 the password from libsecret.
  let v11: Buffer | null = null;
  if (prefixes.has("v11")) {
    const password = await env.readSafeStoragePassword(browser);
    if (!password) {
      throw new BrowserImportError(
        `${browser.name} cookies are encrypted with the system keyring, which is not readable here.`,
      );
    }
    v11 = deriveChromiumKey(password, 1);
  }
  return { v10: deriveChromiumKey("peanuts", 1), v11 };
}

export function deriveChromiumKey(password: string, iterations: number): Buffer {
  return pbkdf2Sync(password, "saltysalt", iterations, 16, "sha1");
}

/** Returns null when the value does not decrypt with the available keys. */
export function decryptChromiumCookieValue(input: {
  encrypted: Buffer;
  keys: ChromiumKeys;
  domain: string;
  metaVersion: number;
}): string | null {
  const prefix = input.encrypted.subarray(0, 3).toString();
  const keysByPrefix: Record<string, Buffer | null> = { v10: input.keys.v10, v11: input.keys.v11 };
  const key = keysByPrefix[prefix];
  if (!key) return null;
  let plaintext: Buffer;
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, CHROMIUM_IV);
    plaintext = Buffer.concat([decipher.update(input.encrypted.subarray(3)), decipher.final()]);
  } catch {
    return null;
  }
  if (input.metaVersion >= 24) {
    // Since DB version 24 the plaintext starts with SHA-256(host_key); it also proves the key was right.
    const hostHash = createHash("sha256").update(input.domain).digest();
    if (plaintext.length < 32 || !plaintext.subarray(0, 32).equals(hostHash)) return null;
    plaintext = plaintext.subarray(32);
  }
  return plaintext.toString("utf8");
}

function sameSiteAttribute(value: number, secure: boolean): Pick<BrowserImportCookie, "sameSite"> {
  if (value === 2) return { sameSite: "Strict" };
  if (value === 1) return { sameSite: "Lax" };
  // Chromium drops SameSite=None cookies that are not Secure.
  if (value === 0 && secure) return { sameSite: "None" };
  return {};
}

function readFirefoxCookies(db: SqliteDatabase, nowSeconds: number): BrowserImportCookie[] {
  // Container and partitioned cookies carry originAttributes; only the default jar maps onto one profile.
  const rows = readAllRows(db, "SELECT * FROM moz_cookies WHERE originAttributes = ''");
  return parseFirefoxCookieRows(rows, nowSeconds);
}

export function parseFirefoxCookieRows(
  rows: Record<string, unknown>[],
  nowSeconds: number,
): BrowserImportCookie[] {
  const cookies: BrowserImportCookie[] = [];
  for (const row of rows) {
    const rawExpiry = Number(row.expiry);
    // Firefox 130+ stores expiry in milliseconds, older versions in seconds.
    const expires = Math.min(
      rawExpiry > 1e11 ? rawExpiry / 1000 : rawExpiry,
      MAX_COOKIE_EXPIRES_SECONDS,
    );
    if (expires < nowSeconds) continue;
    const secure = Boolean(Number(row.isSecure));
    cookies.push({
      name: String(row.name),
      value: String(row.value ?? ""),
      domain: String(row.host),
      path: String(row.path || "/"),
      expires,
      httpOnly: Boolean(Number(row.isHttpOnly)),
      secure,
      ...sameSiteAttribute(Number(row.sameSite), secure),
    });
  }
  return cookies;
}

async function readMacKeychainPassword(service: string): Promise<string | null> {
  try {
    // Waits for the user's answer on the first Keychain prompt.
    const { stdout } = await execCommand(
      "security",
      ["find-generic-password", "-w", "-s", service],
      {
        timeout: 120_000,
        envMode: "internal",
      },
    );
    return String(stdout).trim() || null;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    // `security` exits 44 when the item does not exist; everything else is a denied or failed prompt.
    if (code === 44) return null;
    throw new BrowserImportError(`Keychain access to "${service}" was denied.`);
  }
}

async function readLinuxSecretPassword(application: string): Promise<string | null> {
  try {
    const { stdout } = await execCommand("secret-tool", ["lookup", "application", application], {
      timeout: 30_000,
      envMode: "internal",
    });
    return String(stdout).trim() || null;
  } catch {
    return null;
  }
}
