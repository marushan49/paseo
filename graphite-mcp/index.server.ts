import type { PluginServerContext } from "@getpaseo/plugin/server";

const GRAPHITE_CLI = "/home/admin/.npm-global/bin/gt";

function supportsGraphiteMcp(provider: string): boolean {
  const providerName = provider.split("/", 1)[0];
  return providerName === "claude" || providerName === "codex";
}

/**
 * Makes Graphite's official MCP server available to every newly created
 * Claude and Codex session while preserving explicitly configured servers.
 */
export default function contribute(server: PluginServerContext) {
  const removeAgentCreate = server.before("agent.create", ({ request }) => {
    if (!supportsGraphiteMcp(request.config.provider)) return request;

    return {
      ...request,
      config: {
        ...request.config,
        mcpServers: {
          ...request.config.mcpServers,
          graphite: {
            type: "stdio",
            command: GRAPHITE_CLI,
            args: ["mcp"],
          },
        },
      },
    };
  });

  return () => {
    removeAgentCreate();
  };
}
