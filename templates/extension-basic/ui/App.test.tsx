// 外壳测试：route 缺省 / 未知都回落首页，显式 route 打开对应页面。
//
// 页面测试（ui/pages/<route>/App.test.tsx）也走这个入口，只是注入自己的 route。
import { expect, open, test } from "nsh/test";
import { TEST_PARAMS } from "./lib/test-host";

function openApp(route: string | null) {
  return open("./App.tsx", {
    width: 1200,
    height: 800,
    host: { params: { ...TEST_PARAMS, route }, handlers: {} },
  });
}

test("route 缺省时渲染首页", async () => {
  const app = await openApp(null);
  await app.waitFor("text:欢迎使用 Navop 扩展模板");
  expect(app.texts()).toContain("首页");
  app.dispose();
});

test("显式 route 打开关于页", async () => {
  const app = await openApp("about");
  await app.waitFor("text:这个模板演示什么");
  app.dispose();
});

test("未知 route 回落首页", async () => {
  const app = await openApp("does-not-exist");
  await app.waitFor("text:欢迎使用 Navop 扩展模板");
  app.dispose();
});
