import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveDiscoveryPath, readDiscovery } from "../dist/bin.js";

const TOKEN = "a".repeat(64);

test("explicit discovery path wins over environment and defaults", async () => {
  const result = await resolveDiscoveryPath("/explicit/public-mcp.json", {
    NAVOP_MCP_DISCOVERY: "/env/navop.json",
    ONETCLI_MCP_DISCOVERY: "/env/onetcli.json",
  });
  assert.equal(result, "/explicit/public-mcp.json");
});

test("default discovery search prefers navop and falls back to onetcli", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "navop-discovery-"));
  const legacy = path.join(root, "onetcli", "public-mcp.json");
  await mkdir(path.dirname(legacy), { recursive: true });
  await writeFile(legacy, "{}");

  assert.equal(await resolveDiscoveryPath(undefined, {}, root), legacy);
});

test("discovery accepts navop and legacy app names and rejects unsafe endpoints", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "navop-discovery-"));
  for (const app of ["navop", "onetcli"]) {
    const file = path.join(root, `${app}.json`);
    await writeFile(file, JSON.stringify(discovery({ app })));
    assert.equal((await readDiscovery(file)).app, app);
  }

  const remote = path.join(root, "remote.json");
  await writeFile(remote, JSON.stringify(discovery({ host: "192.0.2.10" })));
  await assert.rejects(readDiscovery(remote), /loopback/);

  const badToken = path.join(root, "token.json");
  await writeFile(badToken, JSON.stringify(discovery({ token: "secret" })));
  await assert.rejects(readDiscovery(badToken), /token/);
});

function discovery(overrides = {}) {
  return {
    version: 1,
    app: "navop",
    pid: 1,
    host: "127.0.0.1",
    port: 3456,
    token: TOKEN,
    mode: "persistent",
    ...overrides,
  };
}
