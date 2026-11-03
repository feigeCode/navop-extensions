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

/** provider 的 logs 形状：`{ id, logs }`，logs 是拼好的多行字符串。 */
function logsResult(id: string) {
  return {
    id,
    logs: "/docker-entrypoint.sh: Configuration complete\nnginx: listening on :80\nGET /health 200\n",
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

test("进页面先列容器，未选中时给引导空态且不请求日志", async () => {
  const app = await open("./App.tsx", {
    host: {
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/logs": (params) => logsResult(String(params.id)),
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  expect(app.texts()).toContain("2 / 2 个容器");
  expect(app.texts()).toContain("未选择容器");
  expect(invokeCalls(app, "docker/container/logs").length).toBe(0);
});

test("选中容器后按 id 读日志，tail 传字符串", async () => {
  const app = await open("./App.tsx", {
    host: {
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/logs": (params) => logsResult(String(params.id)),
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  await app.press("label:容器 web");
  await app.waitFor("text:显示行数");
  expect(app.texts().join("\n")).toContain("nginx: listening on :80");

  const logs = invokeCalls(app, "docker/container/logs");
  expect(logs.length).toBe(1);
  // provider 用 Value::as_str 读 tail，所以必须是字符串。
  expect(logs[0].params).toEqual({ id: "c-web", tail: "500" });
});

test("切换行数档位会重新请求，并带上新的 tail", async () => {
  const app = await open("./App.tsx", {
    host: {
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/logs": (params) => logsResult(String(params.id)),
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  await app.press("label:容器 web");
  await app.waitFor("text:显示行数");
  await app.press("行数 全部");
  await app.waitFor("text:tail 全部（provider 上限 5000）");
  const logs = invokeCalls(app, "docker/container/logs");
  expect(logs.length).toBe(2);
  expect(logs[1].params).toEqual({ id: "c-web", tail: "5000" });
});

test("没有日志时说明可能原因", async () => {
  const app = await open("./App.tsx", {
    host: {
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/logs": (params) => ({ id: String(params.id), logs: "" }),
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  await app.press("label:容器 web");
  await app.waitFor("text:暂无日志");
});

test("日志读取失败显示错误并可重试", async () => {
  let fail = true;
  const app = await open("./App.tsx", {
    host: {
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/logs": (params) => {
          if (fail) throw new Error("docker daemon unavailable");
          return logsResult(String(params.id));
        },
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  await app.press("label:容器 web");
  await app.waitFor("text:加载失败：docker daemon unavailable");
  fail = false;
  await app.press("重试");
  await app.waitFor("text:显示行数");
  expect(app.texts().join("\n")).toContain("nginx: listening on :80");
});
