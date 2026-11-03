// MQTT 概览页的行为测试：宿主只提供两个 provider 方法
// （`middleware/metrics` 与 `middleware/group/clients`），页面自己算速率。
import { expect, open, test } from "nsh/test";
import { hostHandlers } from "../../lib/test-host";

const state = { received: 1333, sent: 2008, fail: false };

const handlers = hostHandlers({
  "middleware/metrics": () => {
    if (state.fail) throw new Error("metrics unavailable");
    return {
      tps_in: 0,
      tps_out: 0,
      topic_count: 2,
      connection_count: 1,
      message_count_today: 42,
      extras: [
        ["received_total", String(state.received)],
        ["sent_total", String(state.sent)],
        ["buffered_messages", "7"],
        ["buffer_capacity", "1000"],
      ],
    };
  },
  "middleware/group/clients": () => {
    if (state.fail) throw new Error("metrics unavailable");
    return {
      clients: [
        {
          client_id: "navop-1",
          client_addr: null,
          language: "RUST",
          version: "MQTT 3.1.1",
          subscriptions: ["sensors/#", "devices/+/state"],
        },
      ],
    };
  },
});

test("概览：状态条、指标、速率快照与自动刷新", async () => {
  state.received = 1333;
  state.sent = 2008;
  state.fail = false;

  const app = await open("./App.tsx", {
    host: { handlers },
    clock: {},
    width: 1280,
    height: 900,
  });

  await app.waitFor("text:已连接");
  const texts = app.texts();
  expect(texts).toContain("MQTT 连接");
  expect(texts).toContain("navop-1");
  expect(texts).toContain("MQTT 3.1.1");
  // provider 不回填 client_addr，页面显示占位而不是空白。
  expect(texts).toContain("provider 未返回");
  expect(texts).toContain("1,333");
  expect(texts).toContain("2,008");
  expect(texts).toContain("sensors/#");

  // 两次采样求差：2 秒内多收 100 条、多发 1000 条 → 50.0 /s、500.0 /s。
  state.received += 100;
  state.sent += 1000;
  app.clock.runFor(2000);
  await app.waitUntil(
    () => app.texts().includes("50.0 /s") && app.texts().includes("500.0 /s"),
    { timeout: 3000 },
  );
  expect(app.texts()).toContain("1,433");

  // 自动刷新关掉后，再走 2 秒不应再发请求。
  await app.press("text:自动刷新：开");
  await app.waitFor("text:自动刷新：关");
  const before = app.host.calls().filter((call) => call.name === "navop.resource.invoke").length;
  state.received += 999;
  app.clock.runFor(4000);
  const after = app.host.calls().filter((call) => call.name === "navop.resource.invoke").length;
  expect(after).toBe(before);

  // 手动刷新仍然可用。
  await app.press("text:刷新");
  await app.waitUntil(() => app.texts().includes("2,432"), { timeout: 3000 });

  app.dispose();
});

test("概览：首载失败展示错误并可重试", async () => {
  state.fail = true;
  const app = await open("./App.tsx", {
    host: { handlers },
    clock: {},
    width: 1280,
    height: 900,
  });

  await app.waitFor("text:加载失败：metrics unavailable");
  state.fail = false;
  await app.press("text:重试");
  await app.waitFor("text:已连接");
  expect(app.texts()).toContain("navop-1");

  app.dispose();
});
