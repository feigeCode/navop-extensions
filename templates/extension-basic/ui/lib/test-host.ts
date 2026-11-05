// 页面测试用的宿主桩（ABI v2）：通用件来自 @navop/extension-kit/testing。
//
// 页面只从 `host.params` 读启动事实，所以测试把启动事实塞进 params；
// 命令走 handlers 按方法名分派。日志是 `host.post("navop.log")`：列出它是为了让
// `app.host.posts()` 能记到，页面不等应答。
import { testParams } from "@navop/extension-kit/testing";

export { hostHandlers } from "@navop/extension-kit/testing";
export { TEST_CONNECTION } from "@navop/extension-kit/testing";

/** 启动事实：和宿主首帧前写进 `host.params` 的形状一致。 */
export const TEST_PARAMS: Record<string, unknown> = testParams({
  extension: { id: "com.example.template", title: "扩展模板" },
  route: "home",
  backends: [],
  connection: null,
});
