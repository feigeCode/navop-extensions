// 开发者工具 app 的测试启动事实：没有连接，只有启动事实。
import { testParams } from "@navop/extension-kit/testing";

export { hostHandlers } from "@navop/extension-kit/testing";

export const TEST_PARAMS: Record<string, unknown> = testParams({
  extension: { id: "com.navop.devtools", title: "开发者工具" },
  route: "workbench",
  backends: [],
  connection: null,
});
