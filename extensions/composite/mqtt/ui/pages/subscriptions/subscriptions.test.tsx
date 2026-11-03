import { expect, open, test } from "nsh/test";
import { hostHandlers } from "../../lib/test-host";

type Entry = {
  name: string;
  queue_count: number;
  topic_type: string;
  description: string;
};

test("subscriptions 列表、新增与取消", async () => {
  const subscriptions: Entry[] = [
    {
      name: "sensor/#",
      queue_count: 1,
      topic_type: "AUTO_SUBSCRIPTION",
      description: "连接配置自动订阅",
    },
    {
      name: "alerts/+/critical",
      queue_count: 2,
      topic_type: "USER",
      description: "手工订阅",
    },
  ];
  const now = Date.now();
  const messages = [
    {
      message_id: "mqtt-1",
      topic: "sensor/a",
      properties: [["received_at_ms", String(now - 1000)]],
    },
    {
      message_id: "mqtt-2",
      topic: "alerts/db/critical",
      properties: [["received_at_ms", String(now - 2000)]],
    },
  ];

  const handlers = hostHandlers({
    "middleware/topic/list": () => ({ topics: subscriptions }),
    "middleware/message/query": () => ({ messages, total: messages.length }),
    "middleware/topic/create": (params) => {
      const input = params as { topic: string; qos: number };
      subscriptions.push({
        name: input.topic,
        queue_count: input.qos,
        topic_type: "USER",
        description: "",
      });
      return { queue_count: input.qos };
    },
    "middleware/topic/delete": (params) => {
      const input = params as { topic: string };
      const index = subscriptions.findIndex((entry) => entry.name === input.topic);
      if (index >= 0) subscriptions.splice(index, 1);
      return {};
    },
  });

  const app = await open("./App.tsx", {
    host: { handlers },
    clock: {},
    width: 1280,
    height: 800,
  });

  await app.waitFor("text:sensor/#");
  expect(app.shows("text:自动订阅")).toBe(true);
  expect(app.shows("text:手工订阅")).toBe(true);

  await app.press("text:新增订阅");
  await app.type("text:例如 sensor/+/temperature 或 devices/#", "devices/+/status");
  await app.press("text:2");
  await app.press("text:确认订阅");
  await app.waitFor("text:devices/+/status");
  // 订阅走 `middleware/topic/create`，参数是 `{ topic, qos }`。
  expect(
    app.host.calls().some((call) => {
      const data = call.data as { method?: string; params?: { topic?: string; qos?: number } };
      return (
        call.name === "navop.resource.invoke" &&
        data.method === "middleware/topic/create" &&
        data.params?.qos === 2
      );
    }),
  ).toBe(true);

  await app.press("text:取消订阅 >> nth=0");
  await app.waitFor("text:确认取消");
  await app.press("text:确认取消");
  await app.waitUntil(
    () =>
      app.host.calls().some((call) => {
        const data = call.data as { method?: string; params?: { topic?: string } };
        return (
          call.name === "navop.resource.invoke" &&
          data.method === "middleware/topic/delete" &&
          data.params?.topic === "alerts/+/critical"
        );
      }),
    { timeout: 3000 },
  );

  app.dispose();
});
