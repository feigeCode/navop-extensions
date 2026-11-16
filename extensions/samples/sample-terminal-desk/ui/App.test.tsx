// 外壳测试：tab 形态与面板形态各一条（能力面调用走按钮，不在渲染时触发）。
import { expect, open, test } from "nsh/test";
import { TEST_PARAMS } from "./lib/test-host";

test("tab 形态渲染终端工作台", async () => {
  const app = await open("./App.tsx", {
    width: 1100,
    height: 760,
    host: { params: { ...TEST_PARAMS }, handlers: {} },
  });
  await app.waitFor("text:终端工作台");
  expect(app.texts()).toContain("执行 pwd && date");
  app.dispose();
});

test("panel 形态渲染侧边栏面板", async () => {
  const app = await open("./App.tsx", {
    width: 340,
    height: 640,
    host: {
      params: { ...TEST_PARAMS, surface: "panel", panel: "desk", anchor: "terminal-sidebar" },
      handlers: {},
    },
  });
  await app.waitFor("text:surface: panel · panel: desk");
  expect(app.texts()).toContain("读最近 12 行");
  app.dispose();
});
