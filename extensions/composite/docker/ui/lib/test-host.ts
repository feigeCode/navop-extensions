// Docker app 的测试启动事实：通用件来自 @navop/extension-kit/testing。
import { TEST_CONNECTION, testParams } from "@navop/extension-kit/testing";

export { hostHandlers } from "@navop/extension-kit/testing";
export { TEST_CONNECTION } from "@navop/extension-kit/testing";

/** 启动事实：和宿主首帧前写进 `host.params` 的形状一致。 */
export const TEST_PARAMS: Record<string, unknown> = testParams({
  extension: { id: "com.navop.docker", title: "Docker" },
  route: "containers",
  backends: ["docker"],
  connection: TEST_CONNECTION,
});
