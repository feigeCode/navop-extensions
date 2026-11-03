// 页面与宿主之间的唯一通道。
//
// 重构成「一个 tab + 最小 API」之后，页面不再有 `dispatch(operationId)` 这种
// 由宿主解释的中间层：要什么数据就直接说 provider 的方法名和参数，
// 宿主只负责把结果（inline / blob / 事件流）解码成普通 JSON 交回来。

import { host } from "nsh";

/** 宿主给的连接上下文（`navop.context.current().connection`）。 */
export type Connection = {
  connectionId?: number;
  name?: string;
  contributionId?: string;
  resourceType?: string;
  /** 借给页面的资源句柄 —— `call()` 用的就是它。 */
  resourceHandle: string;
  alias?: string;
  /** 连接里**非敏感**的配置字段；密码/密钥永远不会出现在这里。 */
  config?: Record<string, unknown>;
};

let cached: Connection | null = null;

/** 当前页面所属的连接。没有连接（例如工具箱里单独打开的页面）时抛错。 */
export async function connection(): Promise<Connection> {
  if (cached) return cached;
  const context = (await host.call("navop.context.current", {})) as {
    connection?: Connection | null;
  };
  const found = context?.connection;
  if (!found?.resourceHandle) {
    throw new Error("这个页面需要一个扩展连接（当前上下文里没有资源句柄）");
  }
  cached = found;
  return found;
}

/** 调 provider 的方法。等价于旧方言的 `dispatch(operationId, input)`，但方法名是真的。 */
export async function call<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const conn = await connection();
  return (await host.call("navop.resource.invoke", {
    handle: conn.resourceHandle,
    method,
    params,
  })) as T;
}

/** 连接的显示名，用于页面标题旁的小字。 */
export function connectionLabel(conn: Connection): string {
  return conn.name ?? conn.contributionId ?? conn.resourceType ?? "connection";
}
