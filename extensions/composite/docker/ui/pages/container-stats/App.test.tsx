import { expect, open, test } from "nsh/test";
import { hostHandlers, TEST_PARAMS as BASE_PARAMS } from "../../lib/test-host";

// 页面测试统一从外壳入口（ui/App.tsx）进入，用本页路由启动。
const TEST_PARAMS = { ...BASE_PARAMS, route: "container-stats" };

/** docker/container/list 的返回形状（provider 的 all(true) 列表）。 */
function containerList() {
  return {
    containers: [
      {
        id: "c-web",
        name: "web",
        image: "nginx:1.27",
        state: "running",
        status: "Up 3 minutes",
        ports: "80/tcp",
        created: "2026-11-02 10:00:00",
        created_epoch: 1,
      },
      {
        id: "c-db",
        name: "db",
        image: "postgres:16",
        state: "exited",
        status: "Exited (0) 2 hours ago",
        ports: "5432/tcp",
        created: "2026-11-02 09:00:00",
        created_epoch: 2,
      },
    ],
  };
}

/** provider 的 stats 形状：一次采样，只有 CPU / 内存 / 核数。 */
function statsResult(id: string) {
  return {
    id,
    cpu_percent: 12.5,
    memory_usage_bytes: 2048,
    memory_limit_bytes: 8192,
    online_cpus: 4,
  };
}

/** 取出某次 host.call 的参数，方便断言页面到底传了什么。 */
function invokeCalls(app: Awaited<ReturnType<typeof open>>, method: string) {
  return app
    .host.calls()
    .filter((entry) => entry.name === "navop.resource.invoke")
    .map((entry) => entry.data as { method?: string; params?: Record<string, unknown> })
    .filter((call) => call.method === method);
}

test("进页面先列容器，未选中时给引导空态且不采样", async () => {
  const app = await open("../../App.tsx", {
    width: 1200,
    height: 800,
    host: {
      params: TEST_PARAMS,
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/stats": (params) => statsResult(String(params.id)),
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  expect(app.texts()).toContain("2 / 2 个容器");
  expect(app.texts()).toContain("未选择容器");
  expect(invokeCalls(app, "docker/container/stats").length).toBe(0);
});

test("选中容器后按 id 采样，展示 CPU、内存与 Meter", async () => {
  const app = await open("../../App.tsx", {
    width: 1200,
    height: 800,
    host: {
      params: TEST_PARAMS,
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/stats": (params) => statsResult(String(params.id)),
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  await app.press("label:容器 web");
  await app.waitFor("text:12.5%");

  const stats = invokeCalls(app, "docker/container/stats");
  expect(stats.length).toBe(1);
  expect(stats[0].params).toEqual({ id: "c-web" });
  expect(app.texts()).toContain("CPU 使用率");
  expect(app.texts()).toContain("4 个核 · 100% ≈ 1 核满载");
  expect(app.texts()).toContain("内存用量");
  expect(app.texts()).toContain("2.0 KB");
  expect(app.texts()).toContain("内存使用率");
  expect(app.texts()).toContain("25.0%");
  expect(app.texts()).toContain("2.0 KB / 8.0 KB");
  // 宿主没有网络 / 块 IO 字段，页面明确标注而不是留白或编数据。
  expect(app.texts()).toContain("宿主未提供");
});

test("自动刷新开着时按选中容器周期采样", async () => {
  const app = await open("../../App.tsx", {
    width: 1200,
    height: 800,
    host: {
      params: TEST_PARAMS,
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/stats": (params) => statsResult(String(params.id)),
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  await app.press("label:容器 web");
  await app.waitFor("text:12.5%");
  const before = invokeCalls(app, "docker/container/stats").length;
  await app.press("自动刷新");
  await app.waitFor("text:自动刷新 · 2s");
  // 采样间隔 2s，等一个周期后应该多一次 stats 调用。
  await app.wait(2600);
  expect(invokeCalls(app, "docker/container/stats").length).toBeGreaterThan(before);
});

test("采样为空时说明可能原因", async () => {
  const app = await open("../../App.tsx", {
    width: 1200,
    height: 800,
    host: {
      params: TEST_PARAMS,
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/stats": (params) => ({ id: String(params.id) }),
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  await app.press("label:容器 web");
  await app.waitFor("text:没有可用的采样");
});

test("采样失败显示错误并可重试", async () => {
  let fail = true;
  const app = await open("../../App.tsx", {
    width: 1200,
    height: 800,
    host: {
      params: TEST_PARAMS,
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/stats": (params) => {
          if (fail) throw new Error("docker daemon unavailable");
          return statsResult(String(params.id));
        },
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  await app.press("label:容器 web");
  await app.waitFor("text:加载失败：docker daemon unavailable");
  fail = false;
  await app.press("重试");
  await app.waitFor("text:12.5%");
});
