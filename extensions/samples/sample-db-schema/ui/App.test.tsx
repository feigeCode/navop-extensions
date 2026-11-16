// 两条入口各一条：面板形态（库侧栏）与详情页（面板 openApp 跳过来）。
import { expect, open, test } from "nsh/test";
import { TEST_PARAMS, TEST_PANEL_CONTEXT, TEST_TAB_CONTEXT } from "./lib/test-host";

test("panel 形态渲染库侧栏面板", async () => {
  const app = await open("./App.tsx", {
    width: 340,
    height: 640,
    host: {
      params: {
        ...TEST_PARAMS,
        surface: "panel",
        panel: "schema",
        anchor: "db-sidebar",
        context: TEST_PANEL_CONTEXT,
      },
      handlers: {},
    },
  });
  await app.waitFor("text:surface: panel · panel: schema");
  expect(app.texts()).toContain("字段速览");
  expect(app.texts()).toContain("加载库与表");
  app.dispose();
});

test("tab 形态显示连接上下文", async () => {
  const app = await open("./App.tsx", {
    width: 1100,
    height: 760,
    host: {
      params: { ...TEST_PARAMS, context: TEST_TAB_CONTEXT },
      handlers: {},
    },
  });
  await app.waitFor("text:字段速览");
  expect(app.texts()).toContain("connection: 1 · type: database");
  app.dispose();
});
