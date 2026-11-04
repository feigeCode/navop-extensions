// app 外壳的路由测试：入口是 ui/App.tsx，验证默认路由、启动路由、未知 route
// 回落，以及「单路由 app 不画侧栏」（契约 §6）。
import { expect, open, test } from "nsh/test";

/** 启动事实：页面自己也会读（扩展信息、启动路由、后端别名、借来的连接）。 */
const params = {
  apiVersion: 2,
  extension: { id: "com.example.shell-view-example", title: "Tool" },
  route: "tool",
  backends: ["demo"],
  connection: null,
};

/** 页面加载时会 post 一条 navop.log；外壳测试给个空 handler。 */
const handlers = { "navop.log": () => null };

test("工具箱打开（route 为 null）落到默认路由 tool", async () => {
  const app = await open("./App.tsx", {
    width: 1100,
    height: 800,
    host: { params: { ...params, route: null }, handlers },
  });
  await app.waitFor("text:资源调用示例");
  expect(app.shows("text:页面上下文")).toBe(true);
});

test("未知 route 回落到默认路由，不白屏", async () => {
  const app = await open("./App.tsx", {
    width: 1100,
    height: 800,
    host: { params: { ...params, route: "not-a-route" }, handlers },
  });
  await app.waitFor("text:资源调用示例");
});

test("单路由 app 不画侧栏，直接渲染页面", async () => {
  const app = await open("./App.tsx", {
    width: 1100,
    height: 800,
    host: { params, handlers },
  });
  await app.waitFor("text:资源调用示例");
  // 侧栏的 app 标题/路由项用的是 params.extension.title 与路由表标题（都是 Tool）；
  // 页面 h1 是「资源调用示例」，所以出现「Tool」就说明外壳画了侧栏。
  expect(app.shows("text:Tool")).toBe(false);
});
