// RocketMQ app 的测试启动事实：通用件来自 @navop/extension-kit/testing。
import { TEST_CONNECTION as BASE_CONNECTION, testParams } from "@navop/extension-kit/testing";

export { hostHandlers } from "@navop/extension-kit/testing";

export const TEST_CONNECTION = {
  ...BASE_CONNECTION,
  contributionId: "rocketmq",
  resourceType: "rocketmq",
  alias: "resource",
};

export const TEST_PARAMS: Record<string, unknown> = testParams({
  extension: { id: "com.navop.middleware.rocketmq", title: "RocketMQ" },
  route: "messages",
  backends: ["resource"],
  connection: TEST_CONNECTION,
});
