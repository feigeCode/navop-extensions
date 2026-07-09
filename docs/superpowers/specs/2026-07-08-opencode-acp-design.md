# OpenCode ACP Design

## Goal

Add a local OpenCode ACP agent extension so one-hub can launch OpenCode through the ACP stdio transport.

## Design

Follow the existing `extensions/acp-agent/*` pattern. The new extension lives at `extensions/acp-agent/opencode-acp`, declares an `acp_agent.json` manifest, and provides shell and Windows launchers under `bin/`.

The launcher assumes `opencode` is already installed locally and directly runs `opencode acp "$@"`. It does not download packages, invoke npm, or bundle the OpenCode binary.

## Packaging And Install

No packaging script changes are needed. `scripts/install-local-acp-agents.sh opencode-acp` should package, verify, and copy the extension into the local one-hub ACP agent directory.

## Testing

Extend `tests/scripts.test.mjs` with an OpenCode ACP extension test that verifies the source manifest and direct `opencode acp` launcher content. Then run the focused script tests and the local install command.
