/** The daemon-side Playwright host, the one that runs where the code runs. */
export const DAEMON_BROWSER_HOST_ID = "daemon-playwright";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

/**
 * Whether a URL belongs to the daemon's own machine rather than to whichever
 * browser host happens to be in front.
 *
 * Browser hosts are not interchangeable: the desktop app's browser runs on the
 * laptop, the daemon's runs where the code and the dev server do. Picking the
 * most recently registered host for a `localhost` URL therefore loads nothing
 * and reports an empty document, which reads like a broken app rather than a
 * browser on the wrong machine.
 */
export function prefersDaemonHost(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return LOOPBACK_HOSTNAMES.has(hostname);
}
