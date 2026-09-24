import {
  BrowserImportError,
  readBrowserImportCookies,
  type BrowserImportCookie,
} from "@getpaseo/server/browser-import";

export type ReadImportCookiesResult =
  | { ok: true; cookies: BrowserImportCookie[] }
  | { ok: false; error: string };

interface ElectronCookieDetails {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
  sameSite: "unspecified" | "no_restriction" | "lax" | "strict";
}

interface ElectronCookies {
  set(details: ElectronCookieDetails): Promise<void>;
}

const ELECTRON_SAME_SITE = {
  Strict: "strict",
  Lax: "lax",
  None: "no_restriction",
} as const;

export function toElectronCookie(cookie: BrowserImportCookie): ElectronCookieDetails {
  const host = cookie.domain.replace(/^\./, "");
  return {
    url: `${cookie.secure ? "https" : "http"}://${host}${cookie.path}`,
    name: cookie.name,
    value: cookie.value,
    // Electron treats any domain as a domain cookie; host-only cookies must omit it.
    ...(cookie.domain.startsWith(".") ? { domain: cookie.domain } : {}),
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    ...(cookie.expires === -1 ? {} : { expirationDate: cookie.expires }),
    sameSite: cookie.sameSite ? ELECTRON_SAME_SITE[cookie.sameSite] : "unspecified",
  };
}

/**
 * Reads a local browser profile, copies its cookies into the desktop Paseo browser session,
 * and returns them so the renderer can forward them to the daemon's browser.
 */
export async function readImportCookiesIntoSession(input: {
  sourceId: unknown;
  cookies: ElectronCookies;
}): Promise<ReadImportCookiesResult> {
  if (typeof input.sourceId !== "string") {
    return { ok: false, error: "Invalid browser profile." };
  }
  let cookies: BrowserImportCookie[];
  try {
    cookies = await readBrowserImportCookies(input.sourceId);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof BrowserImportError ? error.message : "Browser import failed.",
    };
  }
  await Promise.all(
    cookies.map((cookie) => input.cookies.set(toElectronCookie(cookie)).catch(() => undefined)),
  );
  return { ok: true, cookies };
}
