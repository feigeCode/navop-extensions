import { testParams } from "@navop/extension-kit/testing";

export { hostHandlers } from "@navop/extension-kit/testing";

/** 启动事实：与宿主首帧前写进 `host.params` 的形状一致。 */
export const TEST_PARAMS: Record<string, unknown> = testParams({
  extension: { id: "com.navop.server-containers", title: "服务器容器" },
  route: "docker",
  backends: [],
  connection: null,
});
