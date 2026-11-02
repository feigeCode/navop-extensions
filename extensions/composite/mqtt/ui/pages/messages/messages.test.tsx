import { expect, open, test } from "nsh/test";

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

function dispatch(data: unknown): unknown {
  const request = data as { operationId: string; input?: Record<string, unknown> };
  if (request.operationId === "queryByWindow") {
    return { messages: MESSAGES, total: 2, has_more: false };
  }
  if (request.operationId === "queryById") {
    const input = request.input as { ById: { message_id: string } };
    const found = MESSAGES.find((message) => message.message_id === input.ById.message_id);
    return { messages: found === undefined ? [] : [found] };
  }
  throw new Error(`unexpected operation ${request.operationId}`);
}

test("messages 列表、窗口与详情", async () => {
  const app = await open("./App.tsx", {
    host: { handlers: { "navop.workbench.dispatch": dispatch } },
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

  const calls = app.host.calls();
  const windows = calls.filter(
    (call) =>
      call.name === "navop.workbench.dispatch" &&
      (call.data as { operationId: string }).operationId === "queryByWindow",
  );
  expect(windows.length).toBeGreaterThan(0);
  const last = windows[windows.length - 1].data as {
    input: { ByTimeWindow: { begin_unix_ms: number } };
  };
  expect(last.input.ByTimeWindow.begin_unix_ms).toBe(0);

  app.dispose();
});
