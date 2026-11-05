// MQTT app 的测试启动事实：通用件来自 @navop/extension-kit/testing。
import { TEST_CONNECTION as BASE_CONNECTION, testParams } from "@navop/extension-kit/testing";

export { hostHandlers } from "@navop/extension-kit/testing";

/** 连接上下文：一条 MQTT 连接，句柄 r-1，别名与 `shellApp.backends` 的键一致。 */
export const TEST_CONNECTION = {
  ...BASE_CONNECTION,
  contributionId: "mqtt",
  resourceType: "mqtt",
  alias: "resource",
};

export const TEST_PARAMS: Record<string, unknown> = testParams({
  extension: { id: "com.navop.middleware.mqtt", title: "MQTT" },
  route: "messages",
  backends: ["resource"],
  connection: TEST_CONNECTION,
});
