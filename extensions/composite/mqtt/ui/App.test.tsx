// 外壳行为测试：`params.route` 决定首屏，未知路由回落默认路由，
// 没有连接时内容区只给空态、不渲染页面也不发起 invoke。
import { expect, open, test } from "nsh/test";
import { hostHandlers, TEST_PARAMS } from "./lib/test-host";

// 共享 TEST_PARAMS 是 docker 的样例；这里换成 MQTT 自己的身份，顺带验证侧栏标题。
const PARAMS = {
  ...TEST_PARAMS,
  backends: ["resource"],
  extension: { id: "com.navop.middleware.mqtt", title: "MQTT" },
};

const handlers = hostHandlers({
  "middleware/message/query": () => ({ messages: [], total: 0, has_more: false }),
  "middleware/topic/list": () => ({ topics: [] }),
  "middleware/group/clients": () => ({ clients: [] }),
  "middleware/metrics": () => ({
    tps_in: 0,
    tps_out: 0,
    topic_count: 0,
    connection_count: 1,
    message_count_today: 0,
    extras: [],
  }),
});

test("route 为空：打开默认路由（消息浏览）", async () => {
  const app = await open("./App.tsx", {
    host: { params: { ...PARAMS, route: null }, handlers },
    width: 1280,
    height: 800,
  });
  await app.waitFor("text:消息浏览");
  // 侧栏标题取 params.extension.title，五个路由项 + 内容区是默认页（h1「消息」）。
  expect(app.texts()).toContain("MQTT");
  expect(app.texts()).toContain("连接概览");
  expect(app.texts()).toContain("主题树");
  expect(app.texts()).toContain("消息");
});

test("未知 route：回落默认路由而不是空白", async () => {
  const app = await open("./App.tsx", {
    host: { params: { ...PARAMS, route: "not-a-route" }, handlers },
    width: 1280,
    height: 800,
  });
  await app.waitFor("text:消息浏览");
  expect(app.texts()).toContain("消息");
});

test("route 直接命中非默认页：只渲染该页", async () => {
  const app = await open("./App.tsx", {
    host: { params: { ...PARAMS, route: "topics" }, handlers },
    width: 1280,
    height: 800,
  });
  await app.waitFor("text:主题树");
  expect(app.texts()).toContain("主题");
  expect(app.texts().includes("MQTT 连接")).toBe(false);
});

test("没有连接：空态代替页面，且不发起 invoke", async () => {
  const app = await open("./App.tsx", {
    host: { params: { ...PARAMS, route: "topics", connection: null }, handlers },
    width: 1280,
    height: 800,
  });
  await app.waitFor("text:请先打开一个 MQTT 连接");
  expect(app.texts()).toContain("请先打开一个 MQTT 连接");
  expect(app.texts().includes("主题")).toBe(false);
  const invokes = app.host.calls().filter((call) => call.name === "navop.resource.invoke");
  expect(invokes).toHaveLength(0);
});
