// 「当前服务器」的抽象：面板不自己管连接，而是复用宿主里已连接的终端会话。
//
// SSH 会话走 `sshExec`（独立调用，stdout/stderr 分开，不污染用户终端）；
// 本地终端走 `exec`（经过用户 shell，输出里可能带命令回显）。
import {
  execInTerminal,
  listTerminals,
  sshExec,
  type TerminalSession,
} from "./navop";

export type ServerTarget = {
  sessionId: string;
  label: string;
  ssh: boolean;
};

export type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  status?: string;
};

export const COMMAND_TIMEOUT_MS = 15_000;

export function toTarget(session: TerminalSession): ServerTarget {
  return {
    sessionId: session.sessionId,
    label: session.host ?? session.title ?? session.sessionId,
    ssh: session.kind === "Ssh",
  };
}

/** 已连接的会话就是可选的服务器；缺省取第一个。 */
export async function listServerTargets(): Promise<ServerTarget[]> {
  const sessions = await listTerminals();
  return sessions.filter((session) => session.connected).map(toTarget);
}

/** 单引号包裹 + 内部转义：路径/关键字不会被 shell 当成命令注入。 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function runServerCommand(
  target: ServerTarget,
  command: string,
  timeoutMs: number = COMMAND_TIMEOUT_MS,
): Promise<CommandResult> {
  if (target.ssh) {
    const result = await sshExec({ sessionId: target.sessionId, command, timeoutMs });
    if (result.timedOut) throw new Error(`命令超时（${timeoutMs}ms）：${command}`);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      status: result.status,
    };
  }
  const result = await execInTerminal({ sessionId: target.sessionId, command, timeoutMs });
  return { stdout: result.output, stderr: "", exitCode: result.exitCode };
}

/** 命令失败时给出可读原因。宿主的 SSH 通道正常结束时 exitCode 也可能
 * 是 null（远端未上报退出码），不能把 stdout 当成错误展示。 */
export function commandFailure(result: CommandResult, fallback: string): string | null {
  if (result.status === "failed" || result.status === "cancelled") {
    return result.stderr.trim() || result.stdout.trim() || fallback;
  }
  // null = 没有退出码，不等于失败；只有明确的非零退出码才拒绝解析输出。
  if (result.exitCode === null || result.exitCode === 0) return null;
  const detail = result.stderr.trim() || result.stdout.trim();
  return detail.length > 0 ? detail : `${fallback}（exit ${result.exitCode}）`;
}

export function nowClock(): string {
  const now = new Date();
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
}
