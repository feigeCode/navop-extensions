// 页面测试用的宿主桩（ABI v2）：通用件来自 @navop/extension-kit/testing。
//
// 本插件只有面板 + 详情页两条入口，启动上下文都从 `host.params.context` 读。
import { testParams } from "@navop/extension-kit/testing";

export { hostHandlers } from "@navop/extension-kit/testing";

/** 面板启动上下文（库侧栏）：当前连接。 */
export const TEST_PANEL_CONTEXT: Record<string, unknown> = {
  connectionId: 1,
  connectionType: "database",
  params: null,
};

/** 详情页启动上下文（面板 openApp 带过去的）。 */
export const TEST_TAB_CONTEXT: Record<string, unknown> = {
  connectionId: 1,
  databaseType: "database",
};

/** 启动事实：和宿主首帧前写进 `host.params` 的形状一致。 */
export const TEST_PARAMS: Record<string, unknown> = testParams({
  extension: { id: "com.navop.sample.db-schema", title: "字段速览" },
  route: "schema",
  backends: [],
  connection: null,
});
