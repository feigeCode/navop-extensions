#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { runBridge } from "./bridge.js";
import { executeCommand, parseCommand, usage } from "./cli.js";
import { readDiscovery, resolveDiscoveryPath } from "./discovery.js";
import { exitCode } from "./errors.js";
import { failure, success } from "./output.js";

export { runBridge } from "./bridge.js";
export { executeCommand, parseCommand } from "./cli.js";
export { McpConnection } from "./connection.js";
export { readDiscovery, resolveDiscoveryPath, validateDiscovery } from "./discovery.js";
export { NavopError } from "./errors.js";
export { installSkill, printSkill } from "./skill.js";

async function main(argv: string[]): Promise<void> {
  if (argv.length === 0 && process.argv[1]?.endsWith("navop-mcp")) {
    argv = ["mcp"];
  }
  if (argv.includes("--version") || argv.includes("-V")) {
    process.stdout.write("0.1.0\n");
    return;
  }
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const command = parseCommand(argv);
  if (command.name === "mcp") {
    const discoveryPath = await resolveDiscoveryPath(command.options.get("discovery") as string | undefined);
    await runBridge(await readDiscovery(discoveryPath));
    return;
  }
  const json = command.options.has("json");
  try {
    const result = await executeCommand(command);
    const humanResult = command.name === "skill" && command.positional[0] === "print"
      ? (result as { content: string }).content
      : formatHuman(result);
    process.stdout.write(json ? `${success(result)}\n` : `${humanResult}\n`);
  } catch (error) {
    const message = json ? failure(error) : error instanceof Error ? error.message : String(error);
    (json ? process.stdout : process.stderr).write(`${message}\n`);
    process.exitCode = exitCode(error);
  }
}

function formatHuman(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = exitCode(error);
  });
}
