// Elasticsearch app 的测试启动事实：通用件来自 @navop/extension-kit/testing。
import { TEST_CONNECTION as BASE_CONNECTION, testParams } from "@navop/extension-kit/testing";

export { hostHandlers } from "@navop/extension-kit/testing";

/** 连接上下文：一条 Elasticsearch 9 连接，句柄 r-1，别名 resource。 */
export const TEST_CONNECTION = {
  ...BASE_CONNECTION,
  contributionId: "elasticsearch9",
  resourceType: "elasticsearch",
  alias: "resource",
};

export const TEST_PARAMS: Record<string, unknown> = testParams({
  extension: { id: "com.navop.elasticsearch", title: "Elasticsearch 9" },
  route: "mapping",
  backends: ["resource"],
  connection: TEST_CONNECTION,
});
