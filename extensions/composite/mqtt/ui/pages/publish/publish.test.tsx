import { expect, open, test } from "nsh/test";

const TOPIC = "devices/kitchen/light/set";
const PAYLOAD = '{"a":1,"b":[2,3]}';

test("publish 表单、JSON 提示、发送与历史回填", async () => {
  const calls: Array<Record<string, unknown>> = [];

  function dispatch(data: unknown): unknown {
    const request = data as Record<string, unknown>;
    calls.push(request);
    if (request.operationId === "publish") return { message_id: "mqtt-9" };
    throw new Error(`unexpected operation ${String(request.operationId)}`);
  }

  const app = await open("./App.tsx", {
    host: { handlers: { "navop.workbench.dispatch": dispatch } },
    clock: {},
    width: 1280,
    height: 800,
  });

  await app.type("id:topic-input", TOPIC);
  await app.type("id:payload-input", PAYLOAD);
  await app.waitFor("text:JSON 合法，已生成格式化预览。");

  await app.press("text:发送");
  await app.waitUntil(
    () => app.texts().some((text) => text.startsWith(`已发布到 ${TOPIC}`)),
    { timeout: 3000 },
  );

  const first = calls.find((call) => call.operationId === "publish") as {
    input: { topic: string; body: number[]; properties: Array<[string, string]> };
    options?: { confirmed?: boolean };
  };
  expect(first.input.topic).toBe(TOPIC);
  expect(first.options?.confirmed).toBe(true);
  expect(String.fromCharCode(...first.input.body)).toBe(PAYLOAD);
  expect(first.input.properties).toEqual([
    ["qos", "1"],
    ["retain", "false"],
  ]);

  await app.clear("id:topic-input");
  await app.type("id:topic-input", "other/topic");
  await app.clear("id:payload-input");
  await app.type("id:payload-input", "zzz");
  await app.press("id:history-entry-0");
  expect(app.value("id:topic-input")).toBe(TOPIC);
  expect(app.value("id:payload-input")).toBe(PAYLOAD);

  await app.clear("id:payload-input");
  await app.type("id:payload-input", "{oops");
  await app.waitUntil(
    () => app.texts().some((text) => text.startsWith("JSON 解析失败：")),
    { timeout: 3000 },
  );
  await app.press("text:发送");
  await app.waitUntil(
    () =>
      calls.filter((call) => call.operationId === "publish").length >= 2,
    { timeout: 3000 },
  );

  app.dispose();
});
