import { NavopError } from "./errors.js";

export function success(result: unknown): string {
  return JSON.stringify({ ok: true, result });
}

export function failure(error: unknown): string {
  const normalized = error instanceof NavopError
    ? error
    : new NavopError("protocol_error", error instanceof Error ? error.message : String(error));
  return JSON.stringify({
    ok: false,
    code: normalized.code,
    message: normalized.message,
    ...(normalized.details === undefined ? {} : { details: normalized.details }),
  });
}
