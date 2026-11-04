// 页面测试用的宿主桩（ABI v2）：开发者工具 app 没有连接，只有启动事实。
//
// app 只从 `host.params` 读 route，测试把 route 塞进 params；
// `navop.dev.*` 由各测试自己给 handlers，不在这里预置。

/** 启动事实：和宿主首帧前写进 `host.params` 的形状一致（单路由 app，route 恒为 workbench）。 */
export const TEST_PARAMS: Record<string, unknown> = {
  apiVersion: 2,
  extension: {
    id: "com.navop.devtools",
    title: "开发者工具",
  },
  route: "workbench",
  backends: [],
  connection: null,
};
