import { z } from "zod";

export const BrowserImportSourceSchema = z.object({
  id: z.string().min(1),
  browserName: z.string(),
  profileName: z.string(),
});

export const BrowserImportCookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  domain: z.string().min(1),
  path: z.string(),
  // Unix seconds; -1 marks a session cookie.
  expires: z.number(),
  httpOnly: z.boolean(),
  secure: z.boolean(),
  sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
});

export const BrowserImportListSourcesRequestSchema = z.object({
  type: z.literal("browser.import.list_sources.request"),
  requestId: z.string(),
});

export const BrowserImportListSourcesResponseSchema = z.object({
  type: z.literal("browser.import.list_sources.response"),
  payload: z.object({
    requestId: z.string(),
    sources: z.array(BrowserImportSourceSchema),
    error: z.string().nullable(),
  }),
});

export const BrowserImportCookiesRequestSchema = z.object({
  type: z.literal("browser.import.import_cookies.request"),
  requestId: z.string(),
  // "host" reads a profile on the daemon's machine; "cookies" carries cookies the client read locally.
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("host"), sourceId: z.string().min(1) }),
    z.object({ kind: z.literal("cookies"), cookies: z.array(BrowserImportCookieSchema) }),
  ]),
});

export const BrowserImportCookiesResponseSchema = z.object({
  type: z.literal("browser.import.import_cookies.response"),
  payload: z.object({
    requestId: z.string(),
    cookieCount: z.number().int().nonnegative(),
    domainCount: z.number().int().nonnegative(),
    error: z.string().nullable(),
  }),
});

export type BrowserImportSource = z.infer<typeof BrowserImportSourceSchema>;
export type BrowserImportCookie = z.infer<typeof BrowserImportCookieSchema>;
export type BrowserImportListSourcesRequest = z.infer<typeof BrowserImportListSourcesRequestSchema>;
export type BrowserImportCookiesRequest = z.infer<typeof BrowserImportCookiesRequestSchema>;
