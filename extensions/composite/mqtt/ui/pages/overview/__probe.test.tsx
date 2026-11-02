import { expect, open, test } from "nsh/test";

function handlers() {
  let calls = 0;
  return {
    "navop.workbench.dispatch": (data: unknown) => {
      const operationId = (data as Record<string, unknown>).operationId;
      if (operationId === "metrics") {
        calls += 1;
        return {
          metrics: {
            tps_in: 1.5, tps_out: 0.5, topic_count: 2, connection_count: 1, message_count_today: 7,
            extras: [
              ["received_total", String(1233 + calls * 100)],
              ["sent_total", String(8 + calls * 1000)],
              ["buffered_messages", "12"],
              ["buffer_capacity", "1000"],
            ],
          },
        };
      }
      return { clients: [{ client_id: "navop-1", client_addr: null, language: "RUST", version: "MQTT 3.1.1", subscriptions: ["a/#"] }] };
    },
  };
}

test("overview 刷新后更新计数并算出速率", async () => {
  const app = await open("./App.tsx", { clock: {}, host: { handlers: handlers() } });
  expect(app.texts()).toContain("1,333");
  await app.press("自动刷新：开");
  expect(app.texts()).toContain("自动刷新：关");
  app.clock.runFor(2000);
  await app.press("刷新");
  const texts = app.texts();
  console.log("AFTER_REFRESH:", texts.join(" | "));
  expect(texts).toContain("1,433");
  expect(texts.join(" ")).toContain("50.0 /s");
  expect(texts.join(" ")).toContain("500.0 /s");
});
