// 外壳测试：tab 形态（带菜单上下文）与面板形态各一条。
import { expect, open, test } from "nsh/test";
import { TEST_DB_CONTEXT, TEST_PARAMS } from "./lib/test-host";

test("tab 形态显示启动上下文", async () => {
  const app = await open("./App.tsx", {
    width: 1100,
    height: 760,
    host: {
      params: { ...TEST_PARAMS, context: TEST_DB_CONTEXT },
      handlers: {},
    },
  });
  await app.waitFor("text:表详情");
  expect(app.texts()).toContain("node: table / employees");
  expect(app.texts()).toContain("描述这张表");
  app.dispose();
});

test("panel 形态渲染库侧栏面板", async () => {
  const app = await open("./App.tsx", {
    width: 340,
    height: 640,
    host: {
      params: {
        ...TEST_PARAMS,
        surface: "panel",
        panel: "inspector",
        anchor: "db-sidebar",
        context: { connectionId: 1, connectionType: "database" },
      },
      handlers: {},
    },
  });
  await app.waitFor("text:surface: panel · panel: inspector");
  expect(app.texts()).toContain("库表速览");
  expect(app.texts()).toContain("加载库与表");
  app.dispose();
});
