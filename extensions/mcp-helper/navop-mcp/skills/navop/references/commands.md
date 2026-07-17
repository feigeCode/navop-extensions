# Navop CLI commands

```bash
navop status --json
navop tools --json
navop schema <tool> --json
navop call <tool> --arguments '<json-object>' --json
```

For larger arguments, use `--file <path>` or `--stdin`. Inspect schemas before calling tools and use identifiers returned by read/list tools.
