import { expect, open, test } from "nsh/test";
import { hostHandlers } from "../../lib/test-host";

const MESSAGES = [
  {
    message_id: "mqtt-2",
    topic: "sensor/b",
    body_text: '{"a":1,"b":[1,2]}',
    properties: [
      ["qos", "1"],
      ["retain", "true"],
      ["direction", "in"],
      ["received_at_ms", "1762100002000"],
      ["payload_size", "17"],
    ],
    store_time: "2026-11-02 23:13:22",
  },
  {
    message_id: "mqtt-1",
    topic: "sensor/a",
    body_text: "hello mqtt",
    properties: [
      ["qos", "0"],
      ["retain", "false"],
      ["direction", "out"],
      ["received_at_ms", "1762100001000"],
      ["payload_size", "10"],
    ],
    store_time: "2026-11-02 23:13:21",
  },
];

/** provider 方法名 → 返回值：窗口查询给摘要，按 ID 查询给单条详情。 */
const handlers = hostHandlers({
  "middleware/message/query": (params) => {
    const input = params as {
      ByTimeWindow?: { begin_unix_ms: number };
      ById?: { message_id: string };
    };
    if (input.ByTimeWindow !== undefined) {
      return { messages: MESSAGES, total: 2, has_more: false };
    }
    const found = MESSAGES.find((message) => message.message_id === input.ById?.message_id);
    return { messages: found === undefined ? [] : [found] };
  },
});

test("messages 列表、窗口与详情", async () => {
  const app = await open("./App.tsx", {
    host: { handlers },
    clock: {},
    width: 1200,
    height: 800,
  });

  await app.waitFor("text:sensor/a");
  await app.waitFor("text:sensor/b");
  expect(app.shows("text:hello mqtt")).toBe(true);

  await app.press("text:sensor/b");
  await app.waitFor("text:元数据");
  await app.waitFor("text:JSON 合法，已格式化显示。");
  expect(app.shows("text:mqtt-2")).toBe(true);

  await app.press("text:全部");
  await app.waitFor("text:消息");

  // 窗口查询走 `middleware/message/query`，参数是 `{ ByTimeWindow: … }`。
  const windows = app.host.calls().filter((call) => {
    if (call.name !== "navop.resource.invoke") return false;
    const data = call.data as { method?: string; params?: { ByTimeWindow?: unknown } };
    return data.method === "middleware/message/query" && data.params?.ByTimeWindow !== undefined;
  });
  expect(windows.length).toBeGreaterThan(0);
  const last = windows[windows.length - 1]!.data as {
    handle: string;
    params: { ByTimeWindow: { begin_unix_ms: number } };
  };
  expect(last.handle).toBe("r-1");
  expect(last.params.ByTimeWindow.begin_unix_ms).toBe(0);

  app.dispose();
});
