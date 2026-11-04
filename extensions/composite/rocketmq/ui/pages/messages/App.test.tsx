import { expect, open, test } from "nsh/test";
import { hostHandlers, TEST_PARAMS } from "../../lib/test-host";

const NOW = new Date("2026-11-03T10:00:00Z").getTime();

const JSON_MSG = {
  message_id: "7F00000100002A9F0000000000000001",
  topic: "order-topic",
  tag: "TAG_A",
  key: "ORDER-1",
  store_time: "2026-11-03 10:00:00",
  born_time: "2026-11-03 09:59:59",
  store_host: "10.0.0.1:10911",
  born_host: "10.0.0.9",
  retry_times: 0,
  body_text: '{"orderId":"A1001","amount":99.5}',
  properties: [["UNIQ_KEY", "7F00000100002A9F0000000000000001"]],
};

const TEXT_MSG = {
  message_id: "7F00000100002A9F0000000000000002",
  topic: "order-topic",
  tag: "TAG_B",
  key: "ORDER-2",
  store_time: "2026-11-03 10:05:00",
  born_time: "2026-11-03 10:04:59",
  retry_times: 2,
  body_text: "plain text payload",
};

const BINARY_MSG = {
  message_id: "7F00000100002A9F0000000000000003",
  topic: "order-topic",
  store_time: "2026-11-03 09:00:00",
  body: [255, 254, 0, 1],
};

const PAGE_ONE = { messages: [JSON_MSG, TEXT_MSG, BINARY_MSG], total: 3, has_more: false };

let calls: Record<string, unknown>[] = [];
let queryFailure: string | null = null;
let byIdPayload: unknown = { messages: [JSON_MSG], total: 1, has_more: false };
let byKeyPayload: unknown = { messages: [TEXT_MSG], total: 1, has_more: false };
let timePages: Record<number, unknown> | null = null;

function reset(): void {
  calls = [];
  queryFailure = null;
  byIdPayload = { messages: [JSON_MSG], total: 1, has_more: false };
  byKeyPayload = { messages: [TEXT_MSG], total: 1, has_more: false };
  timePages = null;
}

/** 三种查询在 provider 侧是同一个方法：middleware/message/query。 */
function handlers() {
  return hostHandlers({
    "middleware/message/query": (params) => {
      calls.push(params as Record<string, unknown>);
      if (queryFailure !== null) throw new Error(queryFailure);
      const byId = params.ById as Record<string, unknown> | undefined;
      if (byId !== undefined) return byIdPayload;
      const byKey = params.ByKey as Record<string, unknown> | undefined;
      if (byKey !== undefined) return byKeyPayload;
      const window = params.ByTimeWindow as Record<string, unknown> | undefined;
      const page = typeof window?.page === "number" ? window.page : 1;
      if (timePages !== null && timePages[page] !== undefined) return timePages[page];
      return PAGE_ONE;
    },
  });
}

function openPage() {
  return open("../../App.tsx", {
    width: 1280,
    height: 900,
    host: { params: { ...TEST_PARAMS, route: "messages", backends: ["resource"] }, handlers: handlers() },
    clock: { time: NOW },
  });
}

const TOPIC_INPUT = "text:例如 order-topic";
const KEY_INPUT = "text:可选，用于按 Key 查";
const ID_INPUT = "text:可选，例如 7F000001... 或 UNIQ_KEY";

test("按时间窗口查询：默认 1 小时，结果按时间倒序并标注条数", async () => {
  reset();
  const app = await openPage();

  await app.type(TOPIC_INPUT, "order-topic");
  expect(app.shows("text:按时间窗口")).toBe(true);
  await app.press("查询");
  await app.waitFor("text:ORDER-1");

  const texts = app.texts();
  const newest = texts.indexOf("2026-11-03 10:05:00");
  const middle = texts.indexOf("2026-11-03 10:00:00");
  const oldest = texts.indexOf("2026-11-03 09:00:00");
  expect(newest >= 0 && newest < middle && middle < oldest).toBe(true);
  expect(texts).toContain("18 B");
  expect(texts).toContain("TAG_B");
  expect(texts).toContain("2");
  expect(texts).toContain("已显示 3 条");
  expect(texts).toContain("已显示 3 / 最多 500 条 · 本页 total 3");

  const window = calls[0].ByTimeWindow as Record<string, number | string>;
  expect(window.topic).toBe("order-topic");
  expect(window.page).toBe(1);
  expect(window.page_size).toBe(100);
  expect(window.begin_unix_ms).toBe(NOW - 3600000);
  expect(window.end_unix_ms).toBe(NOW);
});

test("时间窗口按钮：切到 15 分钟换 begin", async () => {
  reset();
  const app = await openPage();

  await app.type(TOPIC_INPUT, "order-topic");
  await app.press("15 分钟");
  await app.press("查询");
  await app.waitFor("text:ORDER-1");

  const window = calls[0].ByTimeWindow as Record<string, number>;
  expect(window.begin_unix_ms).toBe(NOW - 900000);
});

test("按 Key 查询：messageId 留空时走 ByKey，忽略时间窗口", async () => {
  reset();
  const app = await openPage();

  await app.type(TOPIC_INPUT, "order-topic");
  await app.type(KEY_INPUT, "ORDER-2");
  expect(app.shows("text:按 Key")).toBe(true);
  await app.press("查询");
  await app.waitFor("text:ORDER-2");
  // 正文只在选中行展开后可见。
  await app.press("text:ORDER-2");
  await app.waitFor("text:plain text payload");

  expect(calls.length).toBe(1);
  expect(calls[0].ByKey === undefined).toBe(false);
  expect(calls[0].ByTimeWindow).toBeNull();
  expect((calls[0].ByKey as Record<string, string>).key).toBe("ORDER-2");
  expect((calls[0].ByKey as Record<string, string>).topic).toBe("order-topic");
});

test("按 Message ID 查询：messageId 优先于 key", async () => {
  reset();
  const app = await openPage();

  await app.type(TOPIC_INPUT, "order-topic");
  await app.type(KEY_INPUT, "ORDER-2");
  await app.type(ID_INPUT, "7F00000100002A9F0000000000000001");
  expect(app.shows("text:按 Message ID")).toBe(true);
  await app.press("查询");
  await app.waitFor("text:ORDER-1");

  expect(calls[0].ById === undefined).toBe(false);
  expect(calls[0].ByKey).toBeNull();
  const byId = calls[0].ById as Record<string, string>;
  expect(byId.topic).toBe("order-topic");
  expect(byId.message_id).toBe("7F00000100002A9F0000000000000001");
});

test("Topic 必填：缺 Topic 不请求，直接给错误", async () => {
  reset();
  const app = await openPage();

  await app.type(KEY_INPUT, "ORDER-2");
  await app.press("查询");
  await app.waitFor("text:Topic 必填：RocketMQ 按 Topic 路由查询，三种查询方式都需要它。");
  expect(calls.length).toBe(0);
});

test("展开 JSON 消息体：格式化与原文切换", async () => {
  reset();
  const app = await openPage();

  await app.type(TOPIC_INPUT, "order-topic");
  await app.press("查询");
  await app.waitFor("text:ORDER-1");
  await app.press("text:ORDER-1");

  await app.waitFor("text:消息体");
  expect(app.shows("text:JSON")).toBe(true);
  expect(app.texts()).toContain('{\n  "orderId": "A1001",\n  "amount": 99.5\n}');
  expect(app.texts()).toContain("10.0.0.1:10911");
  expect(app.texts()).toContain("UNIQ_KEY");

  await app.press("原文");
  await app.waitFor("text:格式化");
  expect(app.texts()).toContain('{"orderId":"A1001","amount":99.5}');
  expect(app.shows("text:格式化")).toBe(true);

  await app.press("格式化");
  await app.waitFor("text:原文");
  expect(app.texts()).toContain('{\n  "orderId": "A1001",\n  "amount": 99.5\n}');
});

test("非 JSON 消息体：原文加提示，没有切换按钮", async () => {
  reset();
  const app = await openPage();

  await app.type(TOPIC_INPUT, "order-topic");
  await app.press("查询");
  await app.waitFor("text:ORDER-2");
  await app.press("text:ORDER-2");

  await app.waitFor("text:内容不是合法 JSON，按原文显示。");
  expect(app.texts()).toContain("plain text payload");
  expect(app.shows("text:原文")).toBe(false);
  expect(app.shows("text:格式化")).toBe(false);
});

test("二进制消息体：按十六进制预览", async () => {
  reset();
  const app = await openPage();

  await app.type(TOPIC_INPUT, "order-topic");
  await app.press("查询");
  await app.waitFor("text:2026-11-03 09:00:00");
  await app.press("text:2026-11-03 09:00:00");

  await app.waitFor("text:消息体不是合法 UTF-8 文本，按字节十六进制预览。");
  expect(app.shows("text:二进制")).toBe(true);
  expect(app.texts()).toContain("ff fe 00 01");
});

test("查询失败：错误可重试", async () => {
  reset();
  queryFailure = "broker 不可达";
  const app = await openPage();

  await app.type(TOPIC_INPUT, "order-topic");
  await app.press("查询");
  await app.waitFor("text:加载失败：broker 不可达");

  queryFailure = null;
  await app.press("重试");
  await app.waitFor("text:ORDER-1");
  expect(app.shows("text:加载失败：broker 不可达")).toBe(false);
});

test("加载更多：第二页按时间并入并去重", async () => {
  reset();
  timePages = {
    1: { messages: [TEXT_MSG, JSON_MSG], total: 2, has_more: true },
    2: { messages: [BINARY_MSG, JSON_MSG], total: 2, has_more: false },
  };
  const app = await openPage();

  await app.type(TOPIC_INPUT, "order-topic");
  await app.press("查询");
  await app.waitFor("text:ORDER-1");
  expect(app.texts()).toContain("已显示 2 / 最多 500 条 · 本页 total 2 · 还有更多");

  await app.press("加载更多");
  await app.waitUntil(() => app.shows("text:2026-11-03 09:00:00"));
  expect(app.texts()).toContain("已显示 3 / 最多 500 条 · 本页 total 2");
  // 第二页 has_more=false：按钮收起。
  expect(app.shows("text:加载更多")).toBe(false);

  const texts = app.texts();
  const newest = texts.indexOf("2026-11-03 10:05:00");
  const middle = texts.indexOf("2026-11-03 10:00:00");
  const oldest = texts.indexOf("2026-11-03 09:00:00");
  expect(newest < middle && middle < oldest).toBe(true);
});
