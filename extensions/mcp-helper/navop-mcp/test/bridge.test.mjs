import assert from "node:assert/strict";
import net from "node:net";
import { PassThrough } from "node:stream";
import test from "node:test";

import { runBridge } from "../dist/bin.js";

test("stdio bridge sends token first and copies bytes in both directions", async () => {
  let received = "";
  const server = net.createServer((socket) => {
    socket.on("data", (chunk) => {
      received += chunk.toString();
      if (received.endsWith("payload")) {
        socket.end("response");
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const input = new PassThrough();
  const output = new PassThrough();
  let response = "";
  output.setEncoding("utf8");
  output.on("data", (chunk) => { response += chunk; });
  const bridge = runBridge({
    version: 1,
    app: "navop",
    pid: 1,
    host: "127.0.0.1",
    port: address.port,
    token: "d".repeat(64),
    mode: "persistent",
  }, input, output);
  input.end("payload");
  await bridge;
  assert.equal(received, `${"d".repeat(64)}\npayload`);
  assert.equal(response, "response");
  server.close();
});
