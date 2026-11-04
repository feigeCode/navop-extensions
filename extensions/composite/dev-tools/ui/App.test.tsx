// 开发者工具 app 外壳的启动语义测试：只有一个路由 workbench，
// route 缺省或未知都回落到它。
import { open, test } from "nsh/test";
import { TEST_PARAMS } from "./lib/test-host";

function handlers() {
  return {
    "navop.dev.list": () => [],
    "navop.log": () => null,
  };
}

function openApp(route: string | null) {
  return open("./App.tsx", { width: 1100, height: 800, host: { params: { ...TEST_PARAMS, route }, handlers: handlers() } });
}

test("route 为 null 时渲染 workbench", async () => {
  const app = await openApp(null);
  await app.waitFor("text:开发者工具");
  await app.waitFor("text:还没有加载开发工程");
  app.dispose();
});

test("未知 route 回落 workbench", async () => {
  const app = await openApp("does-not-exist");
  await app.waitFor("text:还没有加载开发工程");
  app.dispose();
});
