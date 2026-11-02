import { expect, open, test } from "nsh/test";

const INDICES = [
  { name: "orders-2026", health: "green", status: "open", pri: 1, rep: 1, docs: 123456, docs_deleted: 0, size_bytes: 2457600, created: "2026-01-02 03:04" },
  { name: "users", health: "yellow", status: "open", pri: 1, rep: 0, docs: 42, docs_deleted: 1, size_bytes: 8192, created: "2026-02-03 04:05" },
  { name: "logs", health: "red", status: "close", pri: 1, rep: 0, docs: null, docs_deleted: 0, size_bytes: null, created: "-" },
];

const ORDERS_MAPPING = {
  "orders-2026": {
    mappings: {
      properties: {
        id: { type: "keyword" },
        created_at: { type: "date" },
        total: { type: "double" },
        customer: {
          properties: {
            name: {
              type: "text",
              analyzer: "ik_max_word",
              fields: { keyword: { type: "keyword", ignore_above: 256 } },
            },
          },
        },
        items: { type: "nested", properties: { sku: { type: "keyword" }, note: { type: "text" } } },
        secret: { type: "keyword", index: false },
        name_alias: { type: "alias", path: "customer.name" },
      },
      runtime: { day_of_week: { type: "keyword", script: { source: "emit(doc['created_at'].value.dayOfWeekEnum.toString())" } } },
    },
  },
};

const USERS_MAPPING = {
  users: {
    mappings: {
      properties: {
        user_id: { type: "keyword" },
        email: { type: "keyword", doc_values: false },
        bio: { type: "text" },
      },
    },
  },
};

const MAPPINGS: Record<string, unknown> = { "orders-2026": ORDERS_MAPPING, users: USERS_MAPPING, logs: {} };

type Request = { operationId: string; input?: { name?: string } };

let listFailure: string | null = null;
let mappingFailure: string | null = null;
let mappingCalls: string[] = [];

function reset(): void {
  listFailure = null;
  mappingFailure = null;
  mappingCalls = [];
}

function dispatch(data: unknown): unknown {
  const request = data as Request;
  if (request.operationId === "listIndices") {
    if (listFailure !== null) throw new Error(listFailure);
    return { indices: INDICES };
  }
  if (request.operationId === "indexMapping") {
    if (mappingFailure !== null) throw new Error(mappingFailure);
    const name = request.input?.name ?? "";
    mappingCalls.push(name);
    return MAPPINGS[name] ?? {};
  }
  throw new Error(`unexpected operation ${request.operationId}`);
}

function current(route: { name: string }): unknown {
  return { pageId: "index-mapping", route, connection: null, capabilities: [] };
}

function openPage(handlers: Record<string, unknown> = {}): ReturnType<typeof open> {
  return open("./App.tsx", {
    width: 1200,
    height: 800,
    host: { handlers: { "navop.workbench.dispatch": dispatch, ...handlers } },
    clock: {},
  });
}

const FIELD_FILTER = "id:field-filter";
const INDEX_FILTER = "id:index-filter";

test("列表渲染：健康状态、文档数与大小，默认选中第一个索引", async () => {
  reset();
  const app = await openPage();

  await app.waitFor("text:orders-2026");
  expect(app.shows("text:users")).toBe(true);
  expect(app.shows("text:logs")).toBe(true);
  expect(app.texts().join("\n")).toContain("123,456 文档");
  expect(app.texts().join("\n")).toContain("2.3 MB");
  expect(app.texts().join("\n")).toContain("副本未分配");

  await app.waitFor("text:customer.name");
  expect(app.shows("text:字段名")).toBe(true);
  expect(app.shows("text:doc_values")).toBe(true);
  expect(app.shows("text:items.sku")).toBe(true);
  expect(app.shows("text:day_of_week")).toBe(true);
  expect(app.texts().join("\n")).toContain("上次更新");
  expect(app.texts().join("\n")).toContain("共 12 个字段");
  expect(mappingCalls).toContain("orders-2026");

  app.dispose();
});

test("路由里的索引名：打开页面就定位到那个索引", async () => {
  reset();
  const app = await openPage({ "navop.workbench.current": () => current({ name: "users" }) });

  await app.waitFor("text:user_id");
  expect(app.shows("text:orders-2026")).toBe(true);
  expect(mappingCalls[0]).toBe("users");

  app.dispose();
});

test("索引过滤：按名称子串收窄列表", async () => {
  reset();
  const app = await openPage();
  await app.waitFor("text:orders-2026");

  await app.type(INDEX_FILTER, "log");
  await app.waitUntil(() => app.shows("text:logs") && !app.shows("text:users"));

  await app.clear(INDEX_FILTER);
  await app.waitUntil(() => app.shows("text:users"));

  app.dispose();
});

test("切换索引：详情换成新索引的字段", async () => {
  reset();
  const app = await openPage();
  await app.waitFor("text:customer.name");

  await app.press("text:users");
  await app.waitFor("text:user_id");
  expect(app.shows("text:customer.name")).toBe(false);
  expect(app.shows("text:email")).toBe(true);
  expect(mappingCalls[mappingCalls.length - 1]).toBe("users");

  await app.press("text:logs");
  await app.waitFor("text:该索引没有显式字段定义");

  app.dispose();
});

test("字段过滤：大小写不敏感子串与 * 分段匹配", async () => {
  reset();
  const app = await openPage();
  await app.waitFor("text:customer.name");

  await app.type(FIELD_FILTER, "ITEM");
  await app.waitUntil(() => app.shows("text:items.sku") && !app.shows("text:customer.name"));

  await app.clear(FIELD_FILTER);
  await app.type(FIELD_FILTER, "customer.*keyword");
  await app.waitUntil(() => app.shows("text:customer.name.keyword") && !app.shows("text:customer.name"));

  await app.clear(FIELD_FILTER);
  await app.waitUntil(() => app.shows("text:customer.name"));

  app.dispose();
});

test("只看可聚合字段：隐藏 object/nested/alias 与无 fielddata 的 text", async () => {
  reset();
  const app = await openPage();
  await app.waitFor("text:customer.name");

  await app.press("只看可聚合字段");
  await app.waitUntil(() => !app.shows("text:customer.name"));

  expect(app.shows("text:customer.name.keyword")).toBe(true);
  expect(app.shows("text:字段名")).toBe(true);
  expect(app.shows("text:doc_values")).toBe(true);
  expect(app.shows("text:items.sku")).toBe(true);
  expect(app.shows("text:day_of_week")).toBe(true);
  expect(app.shows("text:items.note")).toBe(false);
  expect(app.shows("text:name_alias")).toBe(false);

  await app.press("只看可聚合字段");
  await app.waitUntil(() => app.shows("text:customer.name"));

  app.dispose();
});

test("首次加载失败：显示错误与重试，重试成功后出列表", async () => {
  reset();
  listFailure = "connection refused";
  const app = await openPage();

  await app.waitFor("text:加载失败：connection refused");
  listFailure = null;
  await app.press("重试");
  await app.waitFor("text:orders-2026");
  expect(app.shows("text:加载失败：connection refused")).toBe(false);

  app.dispose();
});

test("有数据后刷新失败：保留旧表格并提示快照", async () => {
  reset();
  const app = await openPage();
  await app.waitFor("text:customer.name");

  mappingFailure = "index_not_found_exception: no such index [orders-2026]";
  await app.press("刷新");
  await app.waitUntil(() => app.texts().some((text) => text.includes("刷新失败")));

  expect(app.shows("text:customer.name")).toBe(true);
  expect(app.texts().join("\n")).toContain("no such index");

  app.dispose();
});

test("复制字段名：写入剪贴板并给出提示", async () => {
  reset();
  const app = await openPage();
  await app.waitFor("text:customer.name.keyword");

  await app.press("复制字段 customer.name.keyword");
  await app.waitUntil(() => app.clipboard() !== null);
  expect(app.clipboard()).toBe("customer.name.keyword");
  expect(app.texts().join("\n")).toContain("已复制字段名：customer.name.keyword");

  app.dispose();
});
