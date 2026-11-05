// 首页测试：打开外壳并把路由注入为 home（页面测试统一口径，零额外入口文件）。
import { expect, open, test } from "nsh/test";
import { TEST_PARAMS } from "../../lib/test-host";

function openHome() {
  return open("../../App.tsx", {
    width: 1200,
    height: 800,
    host: { params: { ...TEST_PARAMS, route: "home" }, handlers: {} },
  });
}

test("渲染启动事实", async () => {
  const app = await openHome();
  await app.waitFor("text:欢迎使用 Navop 扩展模板");
  const texts = app.texts();
  expect(texts).toContain("apiVersion");
  expect(texts).toContain("2"); // apiVersion 的值
  expect(texts).toContain("home"); // 初始 route
  app.dispose();
});

test("本地 signal 可交互", async () => {
  const app = await openHome();
  await app.waitFor("text:点了 0 次");
  await app.press("点一下");
  await app.waitFor("text:点了 1 次");
  app.dispose();
});
