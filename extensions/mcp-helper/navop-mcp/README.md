# @navop/mcp

MCP stdio bridge, command-line client, and Codex-style Skill for Navop.

Navop remains the MCP server and security boundary. This package connects to the authenticated loopback runtime created by Navop.

```bash
npx -y @navop/mcp@0.1.0 mcp
npx -y @navop/mcp@0.1.0 status --json
npx -y @navop/mcp@0.1.0 tools --json
npx -y @navop/mcp@0.1.0 schema terminal.read --json
npx -y @navop/mcp@0.1.0 call terminal.read --arguments '{"session_id":"...","lines":100}' --json
npx -y @navop/mcp@0.1.0 skill install --target codex --scope user
```
