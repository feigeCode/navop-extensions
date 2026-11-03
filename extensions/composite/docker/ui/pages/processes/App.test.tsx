import { expect, open, test } from "nsh/test";
import { hostHandlers } from "../../lib/test-host";

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

function topResult(id: string) {
  if (id === "c-web") {
    return {
      id,
      titles: ["UID", "PID", "CMD"],
      processes: [
        { UID: "root", PID: "1", CMD: "nginx -g daemon off;" },
        { UID: "www", PID: "42", CMD: "php-fpm" },
      ],
    };
  }
  return {
    id,
    titles: ["UID", "PID", "CMD"],
    processes: [{ UID: "postgres", PID: "9", CMD: "postgres -D /var/lib/postgresql/data" }],
  };
}

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

test("进页面先列容器，未选中时给引导空态且不请求进程", async () => {
  const app = await open("./App.tsx", {
    host: {
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/top": (params) => topResult(String(params.id)),
        "docker/container/stats": (params) => statsResult(String(params.id)),
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  expect(app.texts()).toContain("web");
  expect(app.texts()).toContain("db");
  expect(app.texts()).toContain("2 / 2 个容器");
  expect(app.texts()).toContain("未选择容器");
  // 没选中容器就不该按空 id 去读进程。
  expect(invokeCalls(app, "docker/container/top").length).toBe(0);
});

test("选中容器后按 id 读进程，并显示容器整体占用", async () => {
  const app = await open("./App.tsx", {
    host: {
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/top": (params) => topResult(String(params.id)),
        "docker/container/stats": (params) => statsResult(String(params.id)),
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  await app.press("label:容器 web");
  await app.waitFor("text:nginx -g daemon off;");

  const tops = invokeCalls(app, "docker/container/top");
  expect(tops.length).toBe(1);
  expect(tops[0].params).toEqual({ id: "c-web" });
  expect(app.texts()).toContain("2 个进程");
  expect(app.texts()).toContain("UID");
  expect(app.texts().join(" ")).toContain("CPU 12.5%");
  expect(invokeCalls(app, "docker/container/stats")[0].params).toEqual({ id: "c-web" });
});

test("切换容器会重新请求，且只请求新容器", async () => {
  const app = await open("./App.tsx", {
    host: {
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/top": (params) => topResult(String(params.id)),
        "docker/container/stats": (params) => statsResult(String(params.id)),
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  await app.press("label:容器 web");
  await app.waitFor("text:nginx -g daemon off;");
  // 选中后列表收起，用工具条按钮重新展开。
  await app.press("切换容器");
  await app.press("label:容器 db");
  await app.waitFor("text:postgres -D /var/lib/postgresql/data");
  expect(app.texts().join(" ")).not.toContain("nginx -g daemon off;");
  const tops = invokeCalls(app, "docker/container/top");
  expect(tops.length).toBe(2);
  expect(tops[1].params).toEqual({ id: "c-db" });
});

test("按名称过滤容器列表", async () => {
  const app = await open("./App.tsx", {
    host: {
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/top": (params) => topResult(String(params.id)),
        "docker/container/stats": (params) => statsResult(String(params.id)),
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  await app.type("按名称 / 镜像过滤容器", "db");
  await app.waitFor("text:1 / 2 个容器");
  expect(app.texts()).not.toContain("nginx:1.27");
  await app.press("label:容器 db");
  await app.waitFor("text:postgres -D /var/lib/postgresql/data");
});

test("进程为空时说明原因", async () => {
  const app = await open("./App.tsx", {
    host: {
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/top": (params) => ({ id: String(params.id), titles: [], processes: [] }),
        "docker/container/stats": (params) => ({ id: String(params.id) }),
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  await app.press("label:容器 web");
  await app.waitFor("text:容器里没有可见的进程");
});

test("进程读取失败显示错误并可重试", async () => {
  let fail = true;
  const app = await open("./App.tsx", {
    host: {
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/top": (params) => {
          if (fail) throw new Error("docker daemon unavailable");
          return topResult(String(params.id));
        },
        "docker/container/stats": (params) => statsResult(String(params.id)),
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  await app.press("label:容器 web");
  await app.waitFor("text:加载失败：docker daemon unavailable");
  fail = false;
  await app.press("重试");
  await app.waitFor("text:nginx -g daemon off;");
});
