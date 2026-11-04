// Elasticsearch 扩展外壳的启动语义测试：route 回落与「没有连接」空态。
import { expect, open, test } from "nsh/test";
import { hostHandlers, TEST_PARAMS } from "./lib/test-host";

const INDICES = [
  {
    name: "orders-2026",
    health: "green",
    status: "open",
    pri: 1,
    rep: 1,
    docs: 1,
    docs_deleted: 0,
    size_bytes: 1024,
    created: "2026-01-02 03:04",
  },
];

const ORDER_MAPPING: Record<string, unknown> = {
  "orders-2026": {
    mappings: {
      properties: {
        id: { type: "keyword" },
      },
    },
  },
};

/** 只补 app 外壳会触发的两个 provider 方法，够页面挂起来即可。 */
function handlers() {
  return hostHandlers({
    "elasticsearch/index/list": () => ({ indices: INDICES }),
    "elasticsearch/index/mapping": (params) => {
      const name = typeof params.name === "string" ? params.name : "";
      return ORDER_MAPPING[name] ?? {};
    },
  });
}

function paramsWith(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...TEST_PARAMS, ...overrides };
}

function openApp(params: Record<string, unknown>) {
  return open("./App.tsx", { width: 1200, height: 800, host: { params, handlers: handlers() }, clock: {} });
}

test("没有连接时显示空态，不渲染页面也不发 invoke", async () => {
  const app = await openApp(paramsWith({ route: null, connection: null }));
  await app.waitFor("text:请先打开一个 Elasticsearch 9 连接");

  expect(app.shows("text:orders-2026")).toBe(false);
  const resourceCalls = app.host.calls().filter((call) => call.name === "navop.resource.invoke");
  expect(resourceCalls.length).toBe(0);
  app.dispose();
});

test("route 为 null 时回落到默认路由 mapping", async () => {
  const app = await openApp(paramsWith({ route: null }));
  await app.waitFor("text:orders-2026");

  expect(app.shows("text:请先打开一个 Elasticsearch 9 连接")).toBe(false);
  app.dispose();
});

test("未知 route 回落到默认路由", async () => {
  const app = await openApp(paramsWith({ route: "does-not-exist" }));
  await app.waitFor("text:orders-2026");
  app.dispose();
});
