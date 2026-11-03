// MQTT 主题页的行为测试：列表/详情来自 `middleware/topic/list` + `middleware/message/query`，
// 订阅与取消走 `middleware/topic/create` / `middleware/topic/delete`。
import { expect, open, test } from "nsh/test";
import { hostHandlers } from "../../lib/test-host";

type Subscription = {
  name: string;
  queue_count: number;
  topic_type: string;
  description: string;
};

const NOW = Date.now();

test("topics：列表缩进、详情、搜索、订阅与取消订阅", async () => {
  const subscriptions: Subscription[] = [
    { name: "sensors/+/temp", queue_count: 1, topic_type: "USER", description: "温度" },
    {
      name: "devices/#",
      queue_count: 2,
      topic_type: "AUTO_SUBSCRIPTION",
      description: "连接配置自动订阅",
    },
  ];
  const messages = [
    {
      topic: "sensors/1/temp",
      body_text: "21.5",
      properties: [
        ["qos", "1"],
        ["retain", "false"],
        ["received_at_ms", String(NOW - 2000)],
      ],
    },
    {
      topic: "sensors/2/temp",
      body_text: "22.5",
      properties: [
        ["qos", "0"],
        ["retain", "true"],
        ["received_at_ms", String(NOW - 1000)],
      ],
    },
    {
      topic: "devices/a/state",
      body_text: '{"on":true}',
      properties: [["qos", "1"], ["retain", "false"], ["received_at_ms", String(NOW)]],
    },
  ];

  const handlers = hostHandlers({
    "middleware/topic/list": () => ({ topics: subscriptions }),
    "middleware/message/query": () => ({ messages, total: messages.length, has_more: false }),
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
    height: 900,
  });

  await app.waitFor("text:sensors/+/temp");
  const texts = app.texts();
  expect(texts).toContain("devices/#");
  expect(texts).toContain("2 个订阅");
  // 层级缩进：列表行标题只显示最后一段。
  expect(texts).toContain("temp");
  expect(texts).toContain("自动");

  // 默认选中第一条（sensors/+/temp），详情显示匹配到的消息与缓冲内条数。
  await app.waitFor("text:sensors/2/temp");
  expect(app.texts()).toContain("2 条");

  // 选到自动订阅：没有「取消订阅」按钮，只有说明。
  await app.press("text:devices/#");
  await app.waitFor("text:自动订阅来自连接配置的 auto_subscribe，不能在页面里单独取消。");
  expect(app.texts()).toContain("devices/a/state");

  // 搜索过滤：只看 sensors（先把详情切回 sensors，免得右侧详情里还挂着 devices/#）。
  await app.press("text:sensors/+/temp");
  await app.waitFor("text:21.5");
  await app.type("text:按主题名过滤", "sensors");
  await app.waitUntil(() => !app.texts().includes("devices/#"), { timeout: 3000 });
  expect(app.texts()).toContain("sensors/+/temp");
  // 过滤词留在框里：带过滤继续断言订阅/取消订阅（两者都不受列表过滤影响）。

  // 订阅：内联表单 + QoS 2。
  await app.press("text:订阅");
  await app.type("text:例如 sensors/+/temperature 或 devices/#", "alerts/+/critical");
  await app.press("text:QoS 2");
  await app.press("text:确认订阅");
  await app.waitUntil(
    () =>
      app.host
        .calls()
        .some((call) => {
          const data = call.data as { method?: string; params?: { topic?: string; qos?: number } };
          return (
            call.name === "navop.resource.invoke" &&
            data.method === "middleware/topic/create" &&
            data.params?.topic === "alerts/+/critical" &&
            data.params?.qos === 2
          );
        }),
    { timeout: 3000 },
  );
  // 过滤词还是 sensors，列表里看不到新订阅，但页面给了成功提示。
  await app.waitUntil(
    () => app.texts().includes("已订阅 alerts/+/critical（QoS 2）"),
    { timeout: 3000 },
  );
  expect(app.texts()).toContain("3 个订阅");

  // 取消订阅：行内二次确认后才真正调用。
  await app.press("text:sensors/+/temp");
  await app.press("text:取消订阅");
  await app.waitFor("text:确认取消");
  expect(
    app.host.calls().some((call) => {
      const data = call.data as { method?: string };
      return call.name === "navop.resource.invoke" && data.method === "middleware/topic/delete";
    }),
  ).toBe(false);
  await app.press("text:确认取消");
  await app.waitUntil(
    () =>
      app.host.calls().some((call) => {
        const data = call.data as { method?: string; params?: { topic?: string } };
        return (
          call.name === "navop.resource.invoke" &&
          data.method === "middleware/topic/delete" &&
          data.params?.topic === "sensors/+/temp"
        );
      }),
    { timeout: 3000 },
  );

  app.dispose();
});
