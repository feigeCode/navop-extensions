// 页面测试用的宿主桩（ABI v2）。
//
// 页面只从 `host.params` 读启动事实，所以测试把「一条连接」塞进 params；
// 命令走 handlers 按方法名分派。日志是 `host.post("navop.log")`：列出它是为了
// 让 `app.host.posts()` 能记到，页面不等应答。

type Handler = (params: Record<string, unknown>) => unknown;

/** 连接上下文：测试里恒等于"连着一条连接，句柄叫 r-1"。 */
export const TEST_CONNECTION = {
  connectionId: 1,
  name: "test",
  contributionId: "test",
  resourceType: "test",
  resourceHandle: "r-1",
  alias: "main",
  config: {},
};

/** 启动事实：和宿主首帧前写进 `host.params` 的形状一致。 */
export const TEST_PARAMS: Record<string, unknown> = {
  apiVersion: 2,
  extension: {
    id: "com.navop.docker",
    title: "Docker",
  },
  route: "containers",
  backends: ["docker"],
  connection: TEST_CONNECTION,
};

/** 把「方法名 → 返回值/抛错」映射成 `open(..., { host: { params, handlers } })` 要的 handlers。 */
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
