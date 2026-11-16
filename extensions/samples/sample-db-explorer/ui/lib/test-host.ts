// 页面测试用的宿主桩（ABI v2）：通用件来自 @navop/extension-kit/testing。
//
// 本插件从 `host.params.context` 读启动上下文（DB 树菜单 / 库侧栏面板两条
// 路径同形），测试直接把上下文塞进 params。
import { testParams } from "@navop/extension-kit/testing";

export { hostHandlers } from "@navop/extension-kit/testing";

/** 库树右键菜单带过来的上下文（`contributes.commands[].handler.kind == "nsh"`）。 */
export const TEST_DB_CONTEXT: Record<string, unknown> = {
  commandId: "sample.dbExplorer.openTable",
  connectionId: 1,
  databaseType: "mysql",
  driverId: null,
  node: { id: "1.employees", name: "employees", type: "table" },
};

/** 启动事实：和宿主首帧前写进 `host.params` 的形状一致。 */
export const TEST_PARAMS: Record<string, unknown> = testParams({
  extension: { id: "com.navop.sample.db-explorer", title: "库表速览" },
  route: "table",
  backends: [],
  connection: null,
});
