// RocketMQ 消息查询纯逻辑测试:时间输入解析、查询载荷构造、消息整形。
//
// 这些用例由仓级守卫 `tests/scripts.test.mjs` 的
// "extension node tests are discovered and actually executed" 真正执行
// (扩展自身没有独立的 CI 入口),所以这里失败会让 CI 红。
import assert from "node:assert/strict";
import test from "node:test";

import {
  PAGE_SIZES,
  TIME_PRESETS,
  bodyText,
  buildQuery,
  formatMillis,
  messageProperties,
  messageTime,
  parseTimeInput,
  presetWindow,
  previewOf,
  shortId,
} from "../../ui/message-model.js";

test("parseTimeInput 接受 Unix 毫秒原样返回", () => {
  assert.equal(parseTimeInput("1735689600000", null), 1735689600000);
  assert.equal(parseTimeInput(" 1735689600000 ", null), 1735689600000);
});

test("parseTimeInput 解析本地时间文本", () => {
  const expected = new Date(2025, 0, 2, 8, 30, 15, 0).getTime();
  assert.equal(parseTimeInput("2025-01-02 08:30:15", null), expected);
  // 秒可省略;日期与小时允许不补零。
  assert.equal(parseTimeInput("2025-01-02 08:30", null), new Date(2025, 0, 2, 8, 30, 0, 0).getTime());
  assert.equal(parseTimeInput("2025-1-2 8:30", null), new Date(2025, 0, 2, 8, 30, 0, 0).getTime());
});

test("parseTimeInput 空输入返回 fallback 而不是 0", () => {
  assert.equal(parseTimeInput("", 4242), 4242);
  assert.equal(parseTimeInput("   ", null), null);
});

test("parseTimeInput 对非法输入抛错而不静默回落", () => {
  // 静默回落到"当前时刻"会让重置消费位点这类写操作看起来成功、实际跳过了积压。
  assert.throws(() => parseTimeInput("abc", null), /时间格式非法/);
  assert.throws(() => parseTimeInput("2025-13-01 00:00", null), /时间不存在/);
  assert.throws(() => parseTimeInput("2025-02-30 00:00", null), /时间不存在/);
  assert.throws(() => parseTimeInput("2025-01-02 25:00", null), /时间不存在/);
  // 10 位通常是 Unix 秒,必须点出来而不是当成 1970 年的毫秒。
  assert.throws(() => parseTimeInput("1735689600", null), /Unix 秒/);
});

test("presetWindow 按预设跨度回推开始时间", () => {
  const now = 1_700_000_000_000;
  const hour = TIME_PRESETS.find((preset) => preset.id === "1h");
  assert.deepEqual(presetWindow("1h", now), { beginMs: now - hour.ms, endMs: now });
});

test("buildQuery 时间窗口模式产出 ByTimeWindow 变体", () => {
  const now = 1_700_000_000_000;
  const { operation, input } = buildQuery("time", {
    topic: " order-topic ",
    preset: "1h",
    pageSize: 50,
    page: 3,
  }, now);
  assert.equal(operation, "queryByTimeWindow");
  assert.equal(input.ByTimeWindow.topic, "order-topic");
  assert.equal(input.ByTimeWindow.end_unix_ms, now);
  assert.equal(input.ByTimeWindow.begin_unix_ms, now - 60 * 60 * 1000);
  assert.equal(input.ByTimeWindow.page, 3);
  assert.equal(input.ByTimeWindow.page_size, 50);
});

test("buildQuery 自定义区间解析两端时间", () => {
  const begin = new Date(2025, 0, 2, 8, 0, 0, 0).getTime();
  const end = new Date(2025, 0, 2, 9, 0, 0, 0).getTime();
  const { input } = buildQuery("time", {
    topic: "order-topic",
    preset: "custom",
    begin: "2025-01-02 08:00",
    end: "2025-01-02 09:00",
  });
  assert.equal(input.ByTimeWindow.begin_unix_ms, begin);
  assert.equal(input.ByTimeWindow.end_unix_ms, end);
});

test("buildQuery 自定义区间缺开始时间时拦截", () => {
  assert.throws(
    () => buildQuery("time", { topic: "order-topic", preset: "custom", begin: "", end: "" }),
    /自定义区间需要填写开始时间/,
  );
});

test("buildQuery 自定义区间起止倒置时拦截", () => {
  assert.throws(
    () => buildQuery("time", {
      topic: "order-topic",
      preset: "custom",
      begin: "2025-01-02 10:00",
      end: "2025-01-02 09:00",
    }),
    /开始时间必须早于结束时间/,
  );
});

test("buildQuery Key 与 ID 模式映射到各自的变体", () => {
  const byKey = buildQuery("key", { topic: "order-topic", key: "order-1" });
  assert.equal(byKey.operation, "queryByKey");
  assert.deepEqual(byKey.input, { ByKey: { topic: "order-topic", key: "order-1" } });

  const byId = buildQuery("id", { topic: "order-topic", messageId: "0A0A0A0A00001234" });
  assert.equal(byId.operation, "queryById");
  // 契约字段名是 message_id(snake_case),不是 messageId —— 写错会被 serde 当缺字段。
  assert.deepEqual(byId.input, { ById: { topic: "order-topic", message_id: "0A0A0A0A00001234" } });
});

test("buildQuery 缺 topic / key / id 时给出可读拦截", () => {
  assert.throws(() => buildQuery("time", { topic: "  " }), /请先填写 Topic/);
  assert.throws(() => buildQuery("key", { topic: "order-topic", key: "" }), /请填写 Message Key/);
  assert.throws(() => buildQuery("id", { topic: "order-topic", messageId: "" }), /请填写 Message ID/);
});

test("buildQuery 页码下限与页大小白名单", () => {
  const { input } = buildQuery("time", { topic: "t", preset: "10m", page: 0, pageSize: 999 });
  assert.equal(input.ByTimeWindow.page, 1);
  assert.equal(input.ByTimeWindow.page_size, PAGE_SIZES[1]);
});

test("消息整形:body_text / 二进制体 / 属性 / 时间回落", () => {
  assert.equal(bodyText({ body_text: "hello" }), "hello");
  assert.equal(bodyText({ body: [1, 2, 3] }), "<二进制消息体 3 B>");
  assert.equal(bodyText({}), "");

  assert.deepEqual(messageProperties({ properties: [["KEYS", "order-1"], ["bad"]] }), [
    ["KEYS", "order-1"],
  ]);

  assert.equal(messageTime({ store_time: "2025-01-02 08:00:00" }), "2025-01-02 08:00:00");
  assert.equal(messageTime({ born_time: "2025-01-02 07:59:59" }), "2025-01-02 07:59:59");
  assert.equal(messageTime({}), "-");
});

test("previewOf 压缩空白并截断", () => {
  assert.equal(previewOf({ body_text: "a\n\n b   c" }), "a b c");
  const long = previewOf({ body_text: "x".repeat(200) }, 10);
  assert.equal(long, `${"x".repeat(10)}…`);
  assert.equal(previewOf({}), "");
});

test("shortId 压缩长 ID 但保留两端", () => {
  assert.equal(shortId("short"), "short");
  const long = shortId("0A0A0A0A0000123456789ABCDEF0", 8, 4);
  assert.equal(long, "0A0A0A0A…DEF0");
});

test("formatMillis 输出本地时间文本", () => {
  const ms = new Date(2025, 0, 2, 8, 30, 15, 0).getTime();
  assert.equal(formatMillis(ms), "2025-01-02 08:30:15");
  assert.equal(formatMillis("nope"), "-");
});
