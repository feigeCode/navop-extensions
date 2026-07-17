export type ErrorCode =
  | "invalid_arguments"
  | "runtime_unavailable"
  | "discovery_error"
  | "protocol_error"
  | "tool_not_found"
  | "tool_failed"
  | "timeout"
  | "connection_closed"
  | "skill_exists";

export class NavopError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "NavopError";
  }
}

export function exitCode(error: unknown): number {
  if (!(error instanceof NavopError)) return 4;
  if (error.code === "invalid_arguments" || error.code === "skill_exists") return 2;
  if (error.code === "runtime_unavailable") return 3;
  if (error.code === "tool_not_found") return 5;
  if (error.code === "tool_failed") return 6;
  if (error.code === "timeout") return 8;
  if (error.code === "connection_closed") return 9;
  return 4;
}
