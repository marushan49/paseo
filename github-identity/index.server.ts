import type { PluginServerContext } from "@getpaseo/plugin/server";
import { GH_CONFIG_DIR, resolveAccount } from "./server/identity";

/**
 * Setzt pro Agent-Session das passende GitHub-Konto, damit private Arbeit nie
 * unter dem 9elf26-Konto landet und umgekehrt.
 *
 * `agent.session_open` statt `agent.create`, weil dieser Hook auch bei resume,
 * refresh und import feuert - eine fortgesetzte Session braucht dieselbe
 * Identität wie beim ersten Start.
 */
export default function contribute(server: PluginServerContext) {
  const removeSessionOpen = server.before("agent.session_open", async ({ request }) => {
    // Eine explizit gesetzte Variable gewinnt: sonst wäre --env wirkungslos.
    if (request.env.GH_CONFIG_DIR) return;

    const account = await resolveAccount(request.cwd);
    console.log(`[github-identity] ${request.cwd} -> ${account}`);
    return { ...request, env: { ...request.env, GH_CONFIG_DIR: GH_CONFIG_DIR[account] } };
  });

  return () => {
    removeSessionOpen();
  };
}
