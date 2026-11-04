// 页面测试用的宿主桩（ABI v2）：给 Elasticsearch app 塞一条连接。
//
// 页面只从 `host.params` 读启动事实，测试把「一条连接」塞进 params；
// provider 调用走 handlers 按 operationId 分派，日志用 `host.post("navop.log")`。

type Handler = (params: Record<string, unknown>) => unknown;

/** 连接上下文：测试里恒等于「连着一条 Elasticsearch 9 连接，句柄叫 r-1」。 */
export const TEST_CONNECTION = {
  connectionId: 1,
  name: "test",
  contributionId: "elasticsearch9",
  resourceType: "elasticsearch",
  resourceHandle: "r-1",
  alias: "resource",
  config: {},
};

/** 启动事实：和宿主首帧前写进 `host.params` 的形状一致（单路由 app，route 恒为 mapping）。 */
export const TEST_PARAMS: Record<string, unknown> = {
  apiVersion: 2,
  extension: {
    id: "com.navop.elasticsearch",
    title: "Elasticsearch 9",
  },
  route: "mapping",
  backends: ["resource"],
  connection: TEST_CONNECTION,
};

/** 把「provider 方法名 → 返回值/抛错」映射成 `open(..., { host: { params, handlers } })` 要的 handlers。 */
export function hostHandlers(byMethod: Record<string, Handler>) {
  return {
    "navop.resource.invoke": (data: { method?: string; params?: Record<string, unknown> }) => {
      const method = data?.method ?? "";
      const handler = byMethod[method];
      if (!handler) throw new Error(`测试没有为 \`${method}\` 配置返回值`);
      return handler(data?.params ?? {});
    },
    "navop.resource.ping": () => ({ ok: true }),
    "navop.resource.close": () => null,
    "navop.log": () => null,
  };
}
