---
name: navop
description: Operate terminal, database, Redis, SSH/SFTP, and other tools exposed by a running Navop desktop application through the Navop CLI.
---

# Navop

If the current Agent already has native Navop tools, use those tools directly. Otherwise use the `navop` CLI and always request machine-readable output with `--json`.

Run `navop status --json` first. Then use `navop tools --json` and `navop schema <tool> --json`; never guess tool names, arguments, `session_id`, or `connection_id`.

Preserve Navop approval and permission decisions. Never bypass or retry a rejected operation. Prefer reads before writes. Do not interrupt a terminal unless the user explicitly requests it. A mutating call whose connection is lost has an unknown outcome and must not be retried automatically.

See [references/commands.md](references/commands.md) for command examples.
