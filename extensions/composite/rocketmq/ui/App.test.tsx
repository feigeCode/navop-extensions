// 外壳行为测试：`params.route` 决定首屏，未知路由回落默认路由，
// 没有连接时内容区只给空态、不渲染页面也不发起 invoke。
import { expect, open, test } from "nsh/test";
import { hostHandlers, TEST_PARAMS } from "./lib/test-host";

// 共享 TEST_PARAMS 是 docker 的样例；这里换成 RocketMQ 自己的身份，顺带验证侧栏标题。
const PARAMS = {
  ...TEST_PARAMS,
  backends: ["resource"],
  extension: { id: "com.navop.middleware.rocketmq", title: "RocketMQ" },
};

// 首屏三条路由都不在挂载时发请求，所以桩里不配方法；真发请求会抛错暴露出来。
const handlers = hostHandlers({});

test("route 为空：打开默认路由（消息查询）", async () => {
  const app = await open("./App.tsx", {
    host: { params: { ...PARAMS, route: null }, handlers },
    width: 1280,
    height: 800,
  });
  await app.waitFor("text:消息查询");
  // 侧栏标题取 params.extension.title，三个路由项齐全，内容区是默认页。
  expect(app.texts()).toContain("RocketMQ");
  expect(app.texts()).toContain("集群概览");
  expect(app.texts()).toContain("发送消息");
  expect(app.texts()).toContain("消息查询");
});

test("未知 route：回落默认路由而不是空白", async () => {
  const app = await open("./App.tsx", {
    host: { params: { ...PARAMS, route: "not-a-route" }, handlers },
    width: 1280,
    height: 800,
  });
  await app.waitFor("text:消息查询");
  expect(app.texts()).toContain("消息查询");
});

test("route 直接命中非默认页：只渲染该页", async () => {
  const app = await open("./App.tsx", {
    host: { params: { ...PARAMS, route: "send-message" }, handlers },
    width: 1280,
    height: 800,
  });
  await app.waitFor("text:发送消息");
  expect(app.texts()).toContain("本页发送历史");
});

test("没有连接：空态代替页面，且不发起 invoke", async () => {
  const app = await open("./App.tsx", {
    host: { params: { ...PARAMS, route: "send-message", connection: null }, handlers },
    width: 1280,
    height: 800,
  });
  await app.waitFor("text:请先打开一个 RocketMQ 连接");
  expect(app.texts()).toContain("请先打开一个 RocketMQ 连接");
  expect(app.texts().includes("发送消息")).toBe(true); // 侧栏仍有该项
  const invokes = app.host.calls().filter((call) => call.name === "navop.resource.invoke");
  expect(invokes).toHaveLength(0);
});
