// 页面与宿主之间的唯一通道（ABI v2）。
//
// 重构成「一个 tab + 最小 API」之后，页面不再有 `dispatch(operationId)` 这种
// 由宿主解释的中间层：要什么数据就直接说 provider 的方法名和参数，
// 宿主只负责把结果（inline / blob / 事件流）解码成普通 JSON 交回来。
//
// 四条通道各归其位：
//   host.params            启动事实（连接、backends、view 身份），同步读，不 await
//   host.call(name, …)     命令：有应答、可失败（`e.code` / `e.retryable` / `e.details`）
//   host.post("navop.log") 通知：无应答，页面不等它
//   host.on("navop.event") 推送：provider 事件流（先 event.subscribe 才有）
//
// v1 的 `navop.context.current`、`navop.log.*`（call 形态）和 `__NAVOP_ERROR__`
// 信封都删了：这里没有启动 RPC，也没有任何 base64 解析。

import { host } from "nsh";

/** 宿主给的连接上下文（`host.params.connection`）。 */
export type Connection = {
  connectionId?: number | string;
  name?: string;
  contributionId?: string;
  resourceType?: string;
  /** 借给页面的资源句柄 —— `invoke()` 用的就是它。 */
  resourceHandle: string;
  alias?: string;
  /** 连接里**非敏感**的配置字段；密码/密钥永远不会出现在这里。 */
  config?: Record<string, unknown>;
};

/** 当前 app 在 `extension.json` 里的身份（一个扩展一个 app，不再有 view 身份）。 */
export type ExtensionInfo = {
  id: string;
  title: string;
};

/** 启动事实：宿主在首帧前写好，页面生命周期内不变。 */
export type Params = {
  apiVersion?: number;
  extension?: ExtensionInfo;
  /** 连接清单声明的初始路由；工具箱打开或没声明时是 null。 */
  route: string | null;
  /** 已激活的 runtime alias，顺序同 `extension.json`。 */
  backends?: string[];
  /** 非连接型 app 是 null。 */
  connection?: Connection | null;
};

/** 一次调用的选项。`timeout` 单位毫秒，`0` 表示不超时。 */
export type InvokeOptions = { timeout?: number };

/** 日志级别（`navop.log` 只认这四个）。 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** provider 事件批次（`navop.event` 推送）。 */
export type EventBatch = {
  handle: string;
  cursor?: number;
  events?: Array<{ seq?: number; data?: unknown }>;
  done?: boolean;
  error?: { code?: string; message?: string; retryable?: boolean };
};

/** 常规命令的默认超时。nsh 自己的缺省也是 30 秒，写出来省得调用点猜。 */
export const DEFAULT_TIMEOUT_MS = 30_000;
/** 慢命令（列表、日志、大查询）用的超时。 */
export const SLOW_TIMEOUT_MS = 60_000;

/** 启动事实：模块顶层读一次即可。 */
export const params = host.params as unknown as Params;

/** 当前页面的 view 身份。 */
export const extension: ExtensionInfo = params.extension ?? { id: "", title: "" };

/** 可用的 runtime alias。 */
export const backends: string[] = params.backends ?? [];

/**
 * 当前页面所属的连接。没有连接（例如工具箱里单独打开的页面）时抛错；
 * 连接失效由宿主处理（remount 或提示重开），页面没有重取接口。
 */
export function connection(): Connection {
  const current = params.connection;
  if (!current || !current.resourceHandle) {
    throw new Error("这个页面需要一个扩展连接（当前上下文里没有资源句柄）");
  }
  return current;
}

/** 连接的显示名，用于页面标题旁的小字。 */
export function connectionLabel(current: Connection = connection()): string {
  return current.name ?? current.contributionId ?? current.resourceType ?? "connection";
}

/**
 * 调 provider 的方法。`method` 是真的方法名（如 `docker/container/list`），
 * `payload` 是它的参数；默认 30 秒超时，慢方法传 `{ timeout: SLOW_TIMEOUT_MS }`
 * 或 `0`（完全交给 provider 自己的超时）。
 */
export async function invoke<T = unknown>(
  method: string,
  payload: Record<string, unknown> = {},
  options: InvokeOptions = {},
): Promise<T> {
  const current = connection();
  const answer = await host.call(
    "navop.resource.invoke",
    { handle: current.resourceHandle, method, params: payload },
    { timeout: options.timeout ?? DEFAULT_TIMEOUT_MS },
  );
  return answer as unknown as T;
}

/** 自己开一个新资源（连接型页面的句柄由宿主给，一般用不到）。返回句柄。 */
export async function open(
  resourceType: string,
  config: Record<string, unknown> = {},
  options: InvokeOptions & { backend?: string } = {},
): Promise<string> {
  const payload: Record<string, unknown> = { resourceType, config };
  if (options.backend) payload.backend = options.backend;
  // 建连比普通命令慢，默认给慢档。
  const answer = await host.call("navop.resource.open", payload, {
    timeout: options.timeout ?? SLOW_TIMEOUT_MS,
  });
  const handle = (answer as { handle?: unknown } | null)?.handle;
  if (typeof handle !== "string" || handle.length === 0) {
    throw new Error(`宿主没有返回资源句柄：${resourceType}`);
  }
  return handle;
}

/** 探活一个句柄。 */
export async function ping(
  handle: string = connection().resourceHandle,
  options: InvokeOptions = {},
): Promise<{ ok?: boolean }> {
  const answer = await host.call(
    "navop.resource.ping",
    { handle },
    { timeout: options.timeout ?? DEFAULT_TIMEOUT_MS },
  );
  return (answer ?? {}) as { ok?: boolean };
}

/** 关掉一个句柄。 */
export async function close(
  handle: string = connection().resourceHandle,
  options: InvokeOptions = {},
): Promise<void> {
  await host.call(
    "navop.resource.close",
    { handle },
    { timeout: options.timeout ?? DEFAULT_TIMEOUT_MS },
  );
}

/** 写一条宿主日志：单向通知，不等应答。 */
export function log(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
  const payload: Record<string, unknown> = { level, message };
  if (fields) payload.fields = fields;
  host.post("navop.log", payload);
}

/**
 * 收 `navop.event` 推送（先用 `navop.event.subscribe` 订阅）。返回停止函数；
 * 组件渲染期注册的监听随卸载自动停。
 */
export function onEvent(listener: (batch: EventBatch) => void): () => void {
  const subscription = host.on<EventBatch>("navop.event", listener);
  return () => subscription();
}
