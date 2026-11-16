// 页面测试用的宿主桩（ABI v2）：通用件来自 @navop/extension-kit/testing。
import { testParams } from "@navop/extension-kit/testing";

export { hostHandlers } from "@navop/extension-kit/testing";
export { TEST_CONNECTION } from "@navop/extension-kit/testing";

/** 启动事实：和宿主首帧前写进 `host.params` 的形状一致。 */
export const TEST_PARAMS: Record<string, unknown> = testParams({
  extension: { id: "com.navop.extension-showcase", title: "扩展能力演示" },
  route: "home",
  backends: [],
  connection: null,
});

/** DB 菜单打开时的启动上下文样例（kind:"nsh" 命令下发）。 */
export const TEST_DB_CONTEXT: Record<string, unknown> = {
  commandId: "extension-showcase.openExplorer",
  connectionId: 1,
  databaseType: "mysql",
  driverId: null,
  node: { id: "1.employees", name: "employees", type: "table" },
};
