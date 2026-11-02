import { expect, open, test } from "nsh/test";

function handlers() {
  return {
    "navop.workbench.dispatch": (data: unknown) => {
      const payload = data as Record<string, unknown>;
      const operationId = payload.operationId;
      if (operationId === "listTopics") {
        return {
          topics: [
            { name: "sensors/+/temp", topic_type: "SUBSCRIPTION", queue_count: 1, description: null },
            {
              name: "devices/#",
              topic_type: "AUTO_SUBSCRIPTION",
              queue_count: 2,
              description: "连接配置自动订阅(auto_subscribe),不可单独取消",
            },
          ],
        };
      }
      if (operationId === "queryByWindow") {
        return {
          total: 2,
          has_more: false,
          messages: [
            { topic: "sensors/1/temp", body_text: "21.5", properties: [["qos", "1"], ["retain", "false"], ["received_at_ms", "1000"]] },
            { topic: "sensors/2/temp", body_text: "22.0", properties: [["qos", "0"], ["retain", "true"], ["received_at_ms", "2000"]] },
            { topic: "other/x", body_text: "ignore", properties: [["qos", "0"], ["retain", "false"], ["received_at_ms", "3000"]] },
          ],
        };
      }
      return {};
    },
  };
}

test("topics 列表、详情、取消订阅二次确认", async () => {
  const app = await open("./App.tsx", { clock: {}, width: 1280, height: 800, host: { handlers: handlers() } });
  const initial = app.texts();
  console.log("INITIAL:", initial.join(" | "));
  expect(initial).toContain("sensors/+/temp");
  expect(initial.join(" ")).toContain("2 条");

  await app.press("sensors/+/temp");
  const detail = app.texts().join(" | ");
  console.log("DETAIL:", detail);
  expect(detail).toContain("手动订阅");
  expect(detail).toContain("sensors/1/temp");

  await app.press("取消订阅");
  expect(app.texts().join(" ")).toContain("取消订阅 sensors/+/temp");

  await app.press("确认取消");
  const calls = app.host.calls() as { name: string; data: Record<string, unknown> }[];
  const unsubscribe = calls.filter((call) => {
    const data = call.data as { operationId?: string };
    return call.name === "navop.workbench.dispatch" && data.operationId === "unsubscribe";
  });
  console.log("UNSUBSCRIBE_CALLS:", JSON.stringify(unsubscribe));
  expect(unsubscribe.length).toBe(1);
  expect(JSON.stringify(unsubscribe[0])).toContain('"confirmed":true');
  expect(JSON.stringify(unsubscribe[0])).toContain("sensors/+/temp");

  await app.press("devices/#");
  const auto = app.texts().join(" | ");
  console.log("AUTO_DETAIL:", auto);
  expect(auto).toContain("自动订阅（连接配置 auto_subscribe）");
  expect(app.shows("取消订阅")).toBe(false);
});
