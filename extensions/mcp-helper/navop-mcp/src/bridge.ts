import type { Readable, Writable } from "node:stream";

import { McpConnection } from "./connection.js";
import type { DiscoveryDocument } from "./discovery.js";

export async function runBridge(
  discovery: DiscoveryDocument,
  input: Readable = process.stdin,
  output: Writable = process.stdout,
): Promise<void> {
  const connection = await McpConnection.connect(discovery, { initialize: false });
  const socket = connection.rawSocket();
  await new Promise<void>((resolve, reject) => {
    input.pipe(socket);
    socket.pipe(output);
    socket.once("end", resolve);
    socket.once("error", reject);
    input.once("error", reject);
    output.once("error", reject);
  });
}
