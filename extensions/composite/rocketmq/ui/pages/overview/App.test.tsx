import { expect, open, test } from "nsh/test";
import { hostHandlers, TEST_PARAMS } from "../../lib/test-host";

const NOW = new Date("2026-11-03T10:00:00Z");

const METRICS = {
  tps_in: 12.34,
  tps_out: 9.5,
  topic_count: 8,
  connection_count: 6,
  message_count_today: 12345,
  extras: [
    ["broker_count", "3"],
    ["msg_put_total_today", "12345"],
  ],
};

const CLUSTERS = {
  clusters: [
    {
      name: "DefaultCluster",
      brokers: [
        {
          name: "broker-a",
          address: "10.0.0.1:10911",
          topic_count: 8,
          queue_count: 8,
          version: "v4.9.4",
          tps_in: 12.3,
          tps_out: 9.5,
          disk_usage: 0.42,
        },
        {
          name: "broker-b",
          address: "10.0.0.2:10911",
          topic_count: 8,
          queue_count: 8,
          version: "v4.9.4",
          tps_in: 0,
          tps_out: 0,
          role: "slave",
          disk_used_bytes: 53687091200,
          disk_total_bytes: 214748364800,
        },
      ],
    },
    {
      name: "ClusterB",
      brokers: [{ name: "broker-c", address: "10.0.0.3:10911", topic_count: 1, queue_count: 4 }],
    },
  ],
};

let metricsPayload: unknown = METRICS;
let clustersPayload: unknown = CLUSTERS;
let metricsFailure: string | null = null;
let clustersFailure: string | null = null;
let metricsCalls = 0;

function reset(): void {
  metricsPayload = METRICS;
  clustersPayload = CLUSTERS;
  metricsFailure = null;
  clustersFailure = null;
  metricsCalls = 0;
}

/** 方法名从 App.tsx 的 OPERATIONS 抄：metrics / clusterOverview。 */
function handlers() {
  return hostHandlers({
    "middleware/metrics": () => {
      metricsCalls += 1;
      if (metricsFailure !== null) throw new Error(metricsFailure);
      return metricsPayload;
    },
    "middleware/cluster/overview": () => {
      if (clustersFailure !== null) throw new Error(clustersFailure);
      return clustersPayload;
    },
  });
}

function openPage() {
  return open("../../App.tsx", {
    width: 1280,
    height: 900,
    host: { params: { ...TEST_PARAMS, route: "overview", backends: ["resource"] }, handlers: handlers() },
    clock: { time: NOW },
  });
}

test("加载成功：状态条、指标卡与节点拓扑表", async () => {
  reset();
  const app = await openPage();

  await app.waitFor("text:10.0.0.1:10911");
  expect(app.shows("text:已连接")).toBe(true);
  expect(app.texts()).toContain("2 个集群 · 3 个 Broker");
  expect(app.texts()).toContain("主 2 · 从 1");
  expect(app.texts()).toContain("v4.9.4");
  // 磁盘：0.42 → 42%；字节数换算成 50.0 GB / 200.0 GB。
  expect(app.texts()).toContain("42%");
  expect(app.texts()).toContain("50.0 GB / 200.0 GB");
  // broker-c 没上报版本与磁盘。
  expect(app.texts()).toContain("未上报");
  expect(app.texts()).toContain("未知");

  // 指标卡：provider 有的字段都出卡。
  expect(app.texts()).toContain("Topic 数");
  expect(app.texts()).toContain("今日消息量");
  expect(app.texts()).toContain("连接数");
  expect(app.texts()).toContain("入 TPS");
  expect(app.texts()).toContain("出 TPS");
  expect(app.texts()).toContain("12,345");
  expect(app.texts()).toContain("12.3");
  expect(app.texts()).toContain("9.5");
  // 缺字段的卡不渲染。
  expect(app.texts()).not.toContain("消费组数");
  expect(app.texts()).not.toContain("消息总量");
  expect(app.texts()).not.toContain("堆积量");
});

test("缺字段就没有卡：只有连接数时只出一张", async () => {
  reset();
  metricsPayload = { connection_count: 3 };
  clustersPayload = { clusters: [{ name: "C", brokers: [{ name: "b1", address: "10.0.0.9:10911" }] }] };
  const app = await openPage();

  await app.waitFor("text:10.0.0.9:10911");
  expect(app.texts()).toContain("连接数");
  expect(app.texts()).toContain("3");
  expect(app.texts()).not.toContain("Topic 数");
  expect(app.texts()).not.toContain("入 TPS");
  expect(app.texts()).not.toContain("provider 没有返回任何指标字段。");
});

test("首次加载失败：错误页可重试，重试成功后出数据", async () => {
  reset();
  metricsFailure = "nameserver 未配置";
  const app = await openPage();

  await app.waitFor("text:加载失败：nameserver 未配置");
  metricsFailure = null;
  await app.press("重试");
  await app.waitFor("text:10.0.0.1:10911");
  expect(app.shows("text:加载失败：nameserver 未配置")).toBe(false);
});

test("已有数据时刷新失败：保留旧内容并提示", async () => {
  reset();
  const app = await openPage();
  await app.waitFor("text:10.0.0.1:10911");

  clustersFailure = "connect timeout";
  await app.press("label:刷新");
  await app.waitUntil(() => app.shows("text:刷新失败：connect timeout"));

  expect(app.shows("text:10.0.0.1:10911")).toBe(true);
  expect(app.texts()).toContain("Topic 数");
});

test("自动刷新：5 秒一次，关掉后不再请求", async () => {
  reset();
  const app = await openPage();
  await app.waitFor("text:10.0.0.1:10911");
  const initial = metricsCalls;

  await app.wait(5000);
  expect(metricsCalls).toBe(initial + 1);

  await app.press("自动刷新：开");
  await app.waitFor("text:自动刷新：关");
  const paused = metricsCalls;
  await app.wait(5000);
  expect(metricsCalls).toBe(paused);
});

test("空拓扑：无可用节点、空表与无指标提示", async () => {
  reset();
  metricsPayload = {};
  clustersPayload = { clusters: [] };
  const app = await openPage();

  await app.waitFor("text:NameServer 未返回集群拓扑");
  expect(app.shows("text:无可用节点")).toBe(true);
  expect(app.texts()).toContain("主 0 · 从 0");
  expect(app.texts()).toContain("0 个集群 · 0 个 Broker");
  expect(app.texts()).toContain("provider 没有返回任何指标字段。");
});
