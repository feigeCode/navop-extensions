import { expect, open, test } from "nsh/test";
import { hostHandlers, TEST_PARAMS } from "../../lib/test-host";

const TOPIC = "devices/kitchen/light/set";
const PAYLOAD = '{"a":1,"b":[2,3]}';

type SendParams = { topic: string; body: number[]; properties: Array<[string, string]> };

test("publish 表单、JSON 提示、发送与历史回填", async () => {
  // 页面只用一个 provider 方法：`middleware/message/send`。
  const calls: SendParams[] = [];
  const handlers = hostHandlers({
    "middleware/message/send": (params) => {
      calls.push(params as SendParams);
      return { message_id: "mqtt-9" };
    },
  });

  const app = await open("../../App.tsx", {
    host: { params: { ...TEST_PARAMS, route: "publish", backends: ["resource"] }, handlers },
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

  // 发送参数就是 payload 本身：topic / body 字节 / properties。
  const first = calls[0];
  expect(first.topic).toBe(TOPIC);
  expect(String.fromCharCode(...first.body)).toBe(PAYLOAD);
  expect(first.properties).toEqual([
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
    () => calls.length >= 2,
    { timeout: 3000 },
  );

  app.dispose();
});
