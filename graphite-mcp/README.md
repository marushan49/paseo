# Graphite MCP for Paseo

Trusted, server-only Paseo plugin that adds Graphite's official MCP server to
new Claude and Codex sessions. Existing MCP servers are preserved.

The plugin invokes `/home/admin/.npm-global/bin/gt mcp`; Graphite credentials
remain in Graphite's own user configuration and are not copied into this
plugin.
