import type {
  BrowserImportCookiesRequest,
  BrowserImportListSourcesRequest,
} from "@getpaseo/protocol/browser-import/rpc-schemas";
import type { SessionOutboundMessage } from "../messages.js";
import type { DaemonPlaywrightHost } from "../verify/playwright-host.js";
import {
  BrowserImportError,
  listBrowserImportSources,
  readBrowserImportCookies,
} from "./browser-cookie-import.js";

interface BrowserImportSessionDeps {
  host: DaemonPlaywrightHost | null | undefined;
  emit: (message: SessionOutboundMessage) => void;
}

export async function handleBrowserImportListSources(
  request: BrowserImportListSourcesRequest,
  deps: BrowserImportSessionDeps,
): Promise<void> {
  try {
    const sources = await listBrowserImportSources();
    deps.emit({
      type: "browser.import.list_sources.response",
      payload: { requestId: request.requestId, sources, error: null },
    });
  } catch (error) {
    deps.emit({
      type: "browser.import.list_sources.response",
      payload: { requestId: request.requestId, sources: [], error: errorMessage(error) },
    });
  }
}

export async function handleBrowserImportCookies(
  request: BrowserImportCookiesRequest,
  deps: BrowserImportSessionDeps,
): Promise<void> {
  try {
    if (!deps.host) {
      throw new BrowserImportError("The Paseo browser is unavailable on this daemon.");
    }
    const cookies =
      request.source.kind === "host"
        ? await readBrowserImportCookies(request.source.sourceId)
        : request.source.cookies;
    const result = await deps.host.importCookies(cookies);
    deps.emit({
      type: "browser.import.import_cookies.response",
      payload: { requestId: request.requestId, ...result, error: null },
    });
  } catch (error) {
    deps.emit({
      type: "browser.import.import_cookies.response",
      payload: {
        requestId: request.requestId,
        cookieCount: 0,
        domainCount: 0,
        error: errorMessage(error),
      },
    });
  }
}

function errorMessage(error: unknown): string {
  // Unexpected errors can quote SQL rows or file contents; only surface messages we wrote.
  return error instanceof BrowserImportError ? error.message : "Browser import failed.";
}
