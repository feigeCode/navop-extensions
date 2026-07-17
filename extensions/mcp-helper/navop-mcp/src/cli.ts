import { readFile } from "node:fs/promises";

import { McpConnection } from "./connection.js";
import { readDiscovery, resolveDiscoveryPath } from "./discovery.js";
import { NavopError } from "./errors.js";
import { installSkill, printSkill } from "./skill.js";

export interface ParsedCommand {
  name: string;
  positional: string[];
  options: Map<string, string | boolean>;
}

export function parseCommand(argv: string[]): ParsedCommand {
  const [name = "help", ...rest] = argv;
  const positional: string[] = [];
  const options = new Map<string, string | boolean>();
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index]!;
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    if (["--json", "--stdin", "--force"].includes(value)) options.set(value.slice(2), true);
    else {
      const optionValue = rest[++index];
      if (!optionValue) throw new NavopError("invalid_arguments", `${value} requires a value`);
      options.set(value.slice(2), optionValue);
    }
  }
  return { name, positional, options };
}

export async function executeCommand(command: ParsedCommand): Promise<unknown> {
  if (command.name === "skill") return executeSkill(command);
  if (command.name === "mcp") throw new NavopError("invalid_arguments", "mcp is handled by the stdio bridge");
  if (!["status", "tools", "schema", "call"].includes(command.name)) throw new NavopError("invalid_arguments", usage());
  const discoveryPath = await resolveDiscoveryPath(optionString(command, "discovery"));
  const discovery = await readDiscovery(discoveryPath);
  const connection = await McpConnection.connect(discovery, { initialize: false });
  try {
    const server = await connection.initialize();
    if (command.name === "status") return { running: true, discovery: publicDiscovery(discovery, discoveryPath), server };
    const listed = await connection.request("tools/list", {});
    if (command.name === "tools") return listed.tools;
    const toolName = requiredPositional(command, 0, "tool name");
    const tool = listed.tools.find((candidate: any) => candidate.name === toolName);
    if (!tool) throw new NavopError("tool_not_found", `Navop tool not found: ${toolName}`);
    if (command.name === "schema") return tool;
    const argumentsValue = await readArguments(command);
    const result = await connection.request("tools/call", { name: toolName, arguments: argumentsValue });
    if (result?.isError) throw new NavopError("tool_failed", toolFailureMessage(result), result);
    return result;
  } finally {
    connection.close();
  }
}

async function executeSkill(command: ParsedCommand): Promise<unknown> {
  const action = requiredPositional(command, 0, "skill action");
  if (action === "print") return { content: await printSkill() };
  if (action !== "install") throw new NavopError("invalid_arguments", "skill action must be print or install");
  const target = optionString(command, "target") ?? "codex";
  const scope = optionString(command, "scope") ?? "user";
  if (target !== "codex" && target !== "agents") throw new NavopError("invalid_arguments", "--target must be codex or agents");
  if (scope !== "user" && scope !== "project") throw new NavopError("invalid_arguments", "--scope must be user or project");
  return { path: await installSkill({ target, scope, force: command.options.has("force") }) };
}

async function readArguments(command: ParsedCommand): Promise<Record<string, unknown>> {
  const sources = [command.options.has("arguments"), command.options.has("file"), command.options.has("stdin")].filter(Boolean).length;
  if (sources > 1) throw new NavopError("invalid_arguments", "use only one of --arguments, --file, or --stdin");
  let text = "{}";
  if (command.options.has("arguments")) text = optionString(command, "arguments")!;
  if (command.options.has("file")) text = await readFile(optionString(command, "file")!, "utf8");
  if (command.options.has("stdin")) text = await readStdin();
  try {
    const value = JSON.parse(text);
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("not an object");
    return value;
  } catch {
    throw new NavopError("invalid_arguments", "tool arguments must be a JSON object");
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { text += chunk; });
    process.stdin.on("end", () => resolve(text));
    process.stdin.on("error", reject);
  });
}

function publicDiscovery(discovery: any, discoveryPath: string): unknown {
  return { path: discoveryPath, app: discovery.app, pid: discovery.pid, host: discovery.host, port: discovery.port, mode: discovery.mode };
}

function optionString(command: ParsedCommand, name: string): string | undefined {
  const value = command.options.get(name);
  return typeof value === "string" ? value : undefined;
}

function requiredPositional(command: ParsedCommand, index: number, label: string): string {
  const value = command.positional[index];
  if (!value) throw new NavopError("invalid_arguments", `missing ${label}`);
  return value;
}

function toolFailureMessage(result: any): string {
  return result?.structuredContent?.message ?? result?.content?.[0]?.text ?? "Navop tool call failed";
}

export function usage(): string {
  return "Usage: navop mcp|status|tools|schema <tool>|call <tool>|skill print|skill install";
}
