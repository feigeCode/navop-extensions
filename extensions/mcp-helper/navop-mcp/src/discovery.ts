import { access, readFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { NavopError } from "./errors.js";

const TOKEN_PATTERN = /^[0-9a-fA-F]{64}$/;
const APP_NAMES = new Set(["navop", "onetcli"]);

export interface DiscoveryDocument {
  version: number;
  app: string;
  pid: number;
  host: string;
  port: number;
  token: string;
  mode: string;
  started_at?: string;
  launcher_version?: string;
}

export async function resolveDiscoveryPath(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
  configRoot = defaultConfigRoot(),
): Promise<string> {
  const configured = explicit ?? env.NAVOP_MCP_DISCOVERY ?? env.ONETCLI_MCP_DISCOVERY;
  if (configured) return path.resolve(configured);
  const candidates = ["navop", "onetcli"].map((app) => path.join(configRoot, app, "public-mcp.json"));
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  return candidates[0]!;
}

export async function readDiscovery(file: string): Promise<DiscoveryDocument> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new NavopError("runtime_unavailable", `Navop MCP discovery is unavailable at ${file}`, errorMessage(error));
  }
  return validateDiscovery(value);
}

export function validateDiscovery(value: unknown): DiscoveryDocument {
  if (!value || typeof value !== "object") throw discoveryError("discovery must be an object");
  const document = value as Record<string, unknown>;
  if (document.version !== 1) throw discoveryError(`unsupported discovery version ${String(document.version)}`);
  if (typeof document.app !== "string" || !APP_NAMES.has(document.app)) throw discoveryError("unexpected discovery app");
  if (typeof document.host !== "string" || !isLoopback(document.host)) throw discoveryError("discovery host must be loopback");
  if (!Number.isInteger(document.port) || Number(document.port) < 1 || Number(document.port) > 65535) throw discoveryError("invalid discovery port");
  if (typeof document.token !== "string" || !TOKEN_PATTERN.test(document.token)) throw discoveryError("invalid discovery token");
  if (!Number.isInteger(document.pid) || typeof document.mode !== "string") throw discoveryError("invalid discovery metadata");
  return document as unknown as DiscoveryDocument;
}

function defaultConfigRoot(): string {
  if (process.platform === "win32") return process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support");
  return process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
}

function isLoopback(host: string): boolean {
  if (host === "localhost") return true;
  const ip = net.isIP(host);
  return (ip === 4 && host.startsWith("127.")) || (ip === 6 && (host === "::1" || host === "0:0:0:0:0:0:0:1"));
}

function discoveryError(message: string): NavopError {
  return new NavopError("discovery_error", message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
