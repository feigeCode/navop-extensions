# OpenCode ACP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add and locally install an OpenCode ACP agent extension that launches local `opencode acp` through stdio.

**Architecture:** Mirror the existing shell ACP extensions. A static manifest describes one stdio agent, `extension.build.json` declares package metadata and targets, and small platform launchers delegate to a local `opencode` executable.

**Tech Stack:** Shell, Windows batch, JSON manifests, Node test runner.

---

### Task 1: Add Source Extension Test

**Files:**
- Modify: `tests/scripts.test.mjs`

- [ ] **Step 1: Write the failing test**

Add a test near the existing ACP packaging tests:

```js
test("OpenCode ACP extension launches local opencode acp", () => {
  const metadata = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, "extensions/acp-agent/opencode-acp/extension.build.json"),
      "utf8",
    ),
  );
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, "extensions/acp-agent/opencode-acp/acp_agent.json"),
      "utf8",
    ),
  );

  assert.equal(metadata.id, "opencode-acp");
  assert.equal(metadata.kind, "acp_agent");
  assert.equal(metadata.language, "shell");
  assert.equal(metadata.binary, "opencode-acp");
  assert.equal(manifest.id, "opencode-acp");
  assert.equal(manifest.name, "OpenCode");
  assert.equal(manifest.agents[0].transport.type, "stdio");
  assert.equal(manifest.agents[0].transport.command, "bin/opencode-acp");
  assert.deepEqual(manifest.agents[0].transport.args, []);

  const unixLauncher = fs.readFileSync(
    path.join(repoRoot, "extensions/acp-agent/opencode-acp/bin/opencode-acp"),
    "utf8",
  );
  const windowsLauncher = fs.readFileSync(
    path.join(repoRoot, "extensions/acp-agent/opencode-acp/bin/opencode-acp.cmd"),
    "utf8",
  );
  assert.match(unixLauncher, /exec opencode acp "\$@"/);
  assert.match(windowsLauncher, /opencode acp %\*/);
  assert.doesNotMatch(unixLauncher, /npm/);
  assert.doesNotMatch(windowsLauncher, /npm/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk node --test tests/scripts.test.mjs`
Expected: fail because `opencode-acp` extension files do not exist.

### Task 2: Add OpenCode ACP Extension

**Files:**
- Create: `extensions/acp-agent/opencode-acp/acp_agent.json`
- Create: `extensions/acp-agent/opencode-acp/extension.build.json`
- Create: `extensions/acp-agent/opencode-acp/bin/opencode-acp`
- Create: `extensions/acp-agent/opencode-acp/bin/opencode-acp.cmd`

- [ ] **Step 1: Create manifest and build metadata**

Use `id` and binary name `opencode-acp`, display name `OpenCode`, version `0.1.0`, shell language, and the same targets as the existing ACP agents.

- [ ] **Step 2: Create launchers**

Unix launcher:

```sh
#!/usr/bin/env sh
set -eu

if ! command -v opencode >/dev/null 2>&1; then
  echo "opencode was not found. Install OpenCode before starting the OpenCode ACP agent." >&2
  exit 127
fi

exec opencode acp "$@"
```

Windows launcher:

```bat
@echo off
where opencode >nul 2>nul
if errorlevel 1 (
  echo opencode was not found. Install OpenCode before starting the OpenCode ACP agent. 1>&2
  exit /b 127
)

opencode acp %*
```

- [ ] **Step 3: Run focused tests**

Run: `rtk node --test tests/scripts.test.mjs`
Expected: all tests pass.

### Task 3: Install Locally

**Files:**
- Output: `target/local-extension-artifacts/*`
- Output: `$HOME/.config/one-hub/extensions/acp_agents/opencode-acp`

- [ ] **Step 1: Install**

Run: `rtk bash scripts/install-local-acp-agents.sh opencode-acp`
Expected: package verification succeeds and prints the installed destination.

- [ ] **Step 2: Verify installed files**

Run: `rtk find "$HOME/.config/one-hub/extensions/acp_agents/opencode-acp" -maxdepth 3 -type f`
Expected: includes `acp_agent.json`, `bin/opencode-acp`, and `bin/opencode-acp.cmd`.
