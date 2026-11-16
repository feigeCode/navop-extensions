// 外壳测试：tab 形态按 route 渲染；panel 形态直接渲染面板页；
// DB 菜单上下文（host.params.context）在 explorer 页可见。
import { expect, open, test } from "nsh/test";
import { TEST_CONNECTION, TEST_PARAMS, hostHandlers } from "./lib/test-host";

function openTab(params: Record<string, unknown>) {
  return open("./App.tsx", {
    width: 1200,
    height: 800,
    host: {
      params,
      handlers: hostHandlers({}),
    },
  });
}

test("tab 形态渲染 explorer", async () => {
  const app = await openTab({ ...TEST_PARAMS, route: "explorer" });
  await app.waitFor("text:扩展能力演示");
  app.dispose();
});

test("panel 形态渲染演示面板", async () => {
  const app = await openTab({
    ...TEST_PARAMS,
    surface: "panel",
    panel: "quick-tools",
    connection: TEST_CONNECTION,
  });
  await app.waitFor("text:演示面板");
  app.dispose();
});

test("db-sidebar 锚点的面板渲染库表速览", async () => {
  const app = await openTab({
    ...TEST_PARAMS,
    surface: "panel",
    panel: "db-inspector",
    anchor: "db-sidebar",
    connection: TEST_CONNECTION,
  });
  await app.waitFor("text:库表速览");
  app.dispose();
});

test("context 存在时显示启动上下文", async () => {
  const { TEST_DB_CONTEXT } = await import("./lib/test-host");
  const app = await openTab({
    ...TEST_PARAMS,
    route: "explorer",
    context: TEST_DB_CONTEXT,
  });
  await app.waitFor('text:启动上下文（DB 菜单 kind:"nsh" 下发）');
  app.dispose();
});
