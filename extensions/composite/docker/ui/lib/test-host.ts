// 页面测试用的宿主桩。
//
// 页面现在只走两条通道：`navop.context.current`（拿借来的资源句柄）和
// `navop.resource.invoke`（按方法名调 provider）。测试只要按方法名给返回值，
// 不必再模拟旧的工作台 operation。

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

/** 把「方法名 → 返回值/抛错」映射成 `open(..., { host: { handlers } })` 要的 handlers。 */
export function hostHandlers(byMethod: Record<string, Handler>) {
  return {
    "navop.context.current": () => ({ connection: TEST_CONNECTION }),
    "navop.resource.invoke": (data: { method?: string; params?: Record<string, unknown> }) => {
      const method = data?.method ?? "";
      const handler = byMethod[method];
      if (!handler) throw new Error(`测试没有为 \`${method}\` 配置返回值`);
      return handler(data?.params ?? {});
    },
  };
}
