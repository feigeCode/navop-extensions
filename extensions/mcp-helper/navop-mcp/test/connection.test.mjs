import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";

import { McpConnection } from "../dist/bin.js";

test("MCP client handles partial reads and multiple messages in one chunk", async () => {
  const server = net.createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("{")) continue;
        const request = JSON.parse(line);
        if (request.method === "initialize") {
          const response = JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-11-25", capabilities: {}, serverInfo: { name: "navop", version: "1" } } });
          socket.write(response.slice(0, 12));
          socket.write(`${response.slice(12)}\n${JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" })}\n`);
        } else if (request.method === "tools/list") {
          socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "terminal.read", inputSchema: { type: "object" } }] } })}\n`);
        }
      }
    });
  });
  await listen(server);
  const address = server.address();
  const connection = await McpConnection.connect({ host: "127.0.0.1", port: address.port, token: "b".repeat(64) }, { timeoutMs: 1000 });
  await connection.initialize();
  const result = await connection.request("tools/list", {});
  assert.equal(result.tools[0].name, "terminal.read");
  connection.close();
  server.close();
});

test("MCP client reports timeout, error response, and connection close", async () => {
  const server = net.createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("{")) continue;
        const request = JSON.parse(line);
        if (request.method === "error") socket.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "missing" } })}\n`);
        if (request.method === "close") socket.end();
      }
    });
  });
  await listen(server);
  const address = server.address();
  const connection = await McpConnection.connect({ host: "127.0.0.1", port: address.port, token: "c".repeat(64) }, { timeoutMs: 30, initialize: false });
  await assert.rejects(connection.request("wait", {}), (error) => error.code === "timeout");
  await assert.rejects(connection.request("error", {}), (error) => error.code === "protocol_error");
  await assert.rejects(connection.request("close", {}), (error) => error.code === "connection_closed");
  server.close();
});

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}
