// navop.ui / navop.app / navop.terminal 能力面绑定（走 nsh 的 nativeModule）。
//
// - navop.ui（modules: ["ui"]）：弹通知；长任务进度用 navop.job。
// - navop.app（modules: ["app"]）：跨 surface 导航（打开扩展 tab）。
// - navop.terminal（modules: ["terminal"]）：读/写宿主终端会话（Public MCP
//   同一通道）；写入是高权限动作，安装期会提示。
//
// 这三个能力面都是 nativeModule 的同步/异步方法——没有 timeout 参数，
// 超时语义由宿主决定（终端 wait 自带 timeoutMs 长轮询）。

import {
  navopNative,
  type TerminalExecResult,
  type TerminalSshExecResult,
} from "./native";

export type { TerminalExecResult, TerminalSshExecResult };

// -- navop.ui --

export type NotifyLevel = "info" | "success" | "warning" | "error";

/** 弹一条宿主通知（右下角，自动消失）。 */
export async function notify(
  title: string,
  message?: string,
  level: NotifyLevel = "info",
): Promise<void> {
  const payload: { level: NotifyLevel; title: string; message?: string } = { level, title };
  if (message !== undefined && message.length > 0) payload.message = message;
  await navopNative().Ui.notify(payload);
}

// -- navop.app --

export type OpenAppOptions = {
  /** 目标扩展 id；缺省打开本扩展（页面自己所在 app）。 */
  extensionId?: string;
  /** 打开的初始路由（进目标页面的 host.params.route）。 */
  route?: string;
  /** 附加上下文（进目标页面的 host.params.context）。 */
  context?: Record<string, unknown>;
};

/**
 * 打开一个扩展 app tab（跨 surface 导航）。目标 tab 按
 * (extensionId, route) 复用：已有同键 tab 只激活，不重放 context。
 */
export async function openApp(options: OpenAppOptions = {}): Promise<void> {
  const payload: {
    extensionId?: string;
    route?: string;
    context?: Record<string, unknown>;
  } = {};
  if (options.extensionId) payload.extensionId = options.extensionId;
  if (options.route) payload.route = options.route;
  if (options.context) payload.context = options.context;
  await navopNative().App.open(payload);
}

// -- navop.terminal --

export type TerminalSession = {
  sessionId: string;
  connectionId?: number | string | null;
  title: string;
  host?: string;
  /** "Local" | "Ssh" | ...（宿主枚举的 Debug 拼写）。 */
  kind: string;
  connected: boolean;
  cwd?: string | null;
  rows: number;
  cols: number;
};

export type TerminalReadResult = {
  sessionId: string;
  text: string;
  returnedLines: number;
  availableLines: number;
  historySize?: number;
  screenLines: number;
  columns: number;
  altScreen?: boolean;
  displayOffset?: number;
  cursorRow?: number;
  cursorColumn?: number;
};

/** 列出宿主里的终端会话。 */
export async function listTerminals(): Promise<TerminalSession[]> {
  const answer = await navopNative().Terminal.list();
  return ((answer as { sessions?: TerminalSession[] })?.sessions ?? []) as TerminalSession[];
}

/**
 * 读终端的最近文本（scrollback）。`lines` 1..=2000，默认 200；
 * `sessionId` 缺省取第一个已连接的会话。
 */
export async function readTerminal(
  sessionId?: string,
  lines: number = 200,
): Promise<TerminalReadResult> {
  const payload: { sessionId?: string; lines: number } = { lines };
  if (sessionId) payload.sessionId = sessionId;
  return (await navopNative().Terminal.read(payload)) as TerminalReadResult;
}

/**
 * 等终端输出变化（长轮询）。给 `previous` 就等它变；不给就把当前快照当
 * 基线再等（`tail -f` 语义，不会立刻返回）。
 *
 * `changed: false` 表示等满 `timeoutMs` 也没有新输出——不是错误，可以再
 * 次调用续等。返回值与 `readTerminal` 同形，外加 `changed` 标志。
 */
export async function waitTerminal(
  options: {
    sessionId?: string;
    previous?: string;
    lines?: number;
    timeoutMs?: number;
  } = {},
): Promise<TerminalReadResult & { changed: boolean }> {
  const payload: {
    sessionId?: string;
    previous?: string;
    lines: number;
    timeoutMs?: number;
  } = { lines: options.lines ?? 200 };
  if (options.sessionId) payload.sessionId = options.sessionId;
  if (options.previous !== undefined) payload.previous = options.previous;
  if (options.timeoutMs !== undefined) payload.timeoutMs = options.timeoutMs;
  return (await navopNative().Terminal.wait(payload)) as TerminalReadResult & {
    changed: boolean;
  };
}

/**
 * 向终端写输入（等价敲键盘）。`text` 不能为空；写入是高权限动作。
 * 返回写入的字节数。
 */
export async function writeTerminal(
  text: string,
  sessionId?: string,
): Promise<number> {
  const payload: { text: string; sessionId?: string } = { text };
  if (sessionId) payload.sessionId = sessionId;
  const answer = await navopNative().Terminal.write(payload);
  return ((answer as { bytes?: number })?.bytes ?? 0) as number;
}

/**
 * 在一个已经开着的终端里执行命令并等输出。
 *
 * 这条命令走用户的 shell（复用它的 cwd、环境、代理与别名），本地终端和
 * SSH 终端都可以。`submit: false` 只写入不回车；`waitForOutput: false`
 * 只提交不等输出。
 *
 * 要拿结构化 stdout/stderr、或要在远端跑后台任务，用 {@link sshExec}。
 */
export async function execInTerminal(options: {
  command: string;
  sessionId?: string;
  submit?: boolean;
  waitForOutput?: boolean;
  readyTimeoutMs?: number;
  timeoutMs?: number;
}): Promise<TerminalExecResult> {
  return (await navopNative().Terminal.exec(options)) as TerminalExecResult;
}

/**
 * 在 SSH 会话上执行一条命令（独立调用，stdout / stderr 分开）。
 *
 * `mode: "background"` 会立刻返回并带上 `commandId`，之后用
 * {@link pollSshCommand} / {@link readSshCommand} / {@link cancelSshCommand}
 * 跟进——这几个方法还没接到扩展能力面，需要的话先在宿主侧补。
 */
export async function sshExec(options: {
  sessionId: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  mode?: "foreground" | "background";
}): Promise<TerminalSshExecResult> {
  return (await navopNative().Terminal.sshExec(options)) as TerminalSshExecResult;
}
