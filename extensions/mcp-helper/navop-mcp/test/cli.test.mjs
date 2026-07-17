import assert from "node:assert/strict";
import test from "node:test";

import { NavopError, parseCommand } from "../dist/bin.js";

test("CLI parser supports discovery and JSON arguments independent of option order", () => {
  const command = parseCommand([
    "call",
    "terminal.read",
    "--json",
    "--arguments",
    '{"session_id":"ssh-1"}',
    "--discovery",
    "/tmp/public-mcp.json",
  ]);
  assert.equal(command.name, "call");
  assert.deepEqual(command.positional, ["terminal.read"]);
  assert.equal(command.options.get("json"), true);
  assert.equal(command.options.get("arguments"), '{"session_id":"ssh-1"}');
  assert.equal(command.options.get("discovery"), "/tmp/public-mcp.json");
});

test("CLI parser rejects missing option values", () => {
  assert.throws(
    () => parseCommand(["status", "--discovery"]),
    (error) => error instanceof NavopError && error.code === "invalid_arguments",
  );
});
