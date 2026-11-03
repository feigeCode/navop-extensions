import { expect, open, test } from "nsh/test";
import { hostHandlers } from "../../lib/test-host";

type Row = {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  created: string;
  created_epoch: number;
};

/** 一个可变的假 docker：操作会真的改掉列表，页面刷新后能看到结果。 */
function world() {
  const containers: Row[] = [
    {
      id: "c1",
      name: "web",
      image: "nginx:1.27",
      state: "running",
      status: "Up 3 hours",
      ports: "8080->80/tcp",
      created: "2026-11-02 10:00",
      created_epoch: 1,
    },
    {
      id: "c2",
      name: "db",
      image: "postgres:16",
      state: "exited",
      status: "Exited (0) 2 hours ago",
      ports: "5432/tcp",
      created: "2026-11-01 09:00",
      created_epoch: 2,
    },
    {
      id: "c3",
      name: "cache",
      image: "redis:7",
      state: "paused",
      status: "Up 5 minutes (Paused)",
      ports: "",
      created: "2026-11-02 09:00",
      created_epoch: 3,
    },
  ];

  let listFails = false;

  function find(id: unknown): Row | undefined {
    return containers.find((row) => row.id === id);
  }

  function setState(id: unknown, state: string, status: string) {
    const row = find(id);
    if (row !== undefined) {
      row.state = state;
      row.status = status;
    }
  }

  function inspect(id: unknown): Record<string, unknown> {
    const row = find(id);
    const name = row?.name ?? "unknown";
    const state = row?.state ?? "exited";
    const image = row?.image ?? "unknown";
    const running = state === "running";
    return {
      Id: `${name}0123456789abcdef0123456789abcdef0123456789abcdef`,
      Name: `/${name}`,
      Image: `sha256:${name}abcdef`,
      Created: "2026-11-02T01:00:00Z",
      State: {
        Status: state,
        Running: running,
        Paused: state === "paused",
        StartedAt: running ? "2026-11-02T10:00:00Z" : "0001-01-01T00:00:00Z",
        ExitCode: running ? 0 : 137,
        RestartCount: 2,
        Health: running ? { Status: "healthy" } : undefined,
      },
      Config: {
        Image: image,
        Cmd: ["nginx", "-g", "daemon off;"],
        Env: ["PATH=/usr/local/sbin:/usr/local/bin", "TZ=Asia/Shanghai"],
        Labels: { "com.docker.compose.project": "demo" },
      },
      HostConfig: {
        RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 },
        Memory: 536870912,
      },
      NetworkSettings: {
        Networks: {
          bridge: {
            IPAddress: name === "web" ? "172.17.0.2" : "172.17.0.3",
            Gateway: "172.17.0.1",
            MacAddress: "02:42:ac:11:00:02",
          },
        },
        Ports: name === "web" ? { "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" }] } : {},
      },
      Mounts: [
        { Type: "bind", Source: "/srv/www", Destination: "/usr/share/nginx/html", RW: true },
      ],
    };
  }

  const handlers = hostHandlers({
    "docker/container/list": () => {
      if (listFails) throw new Error("connection refused");
      return { containers: containers.map((row) => ({ ...row })) };
    },
    "docker/container/inspect": (params) => inspect(params.id),
    "docker/container/stats": () => ({
      cpu_percent: 3.25,
      memory_usage_bytes: 50 * 1024 * 1024,
      memory_limit_bytes: 512 * 1024 * 1024,
      online_cpus: 4,
    }),
    "docker/container/start": (params) => {
      setState(params.id, "running", "Up 1 second");
      return { id: params.id, action: "started" };
    },
    "docker/container/stop": (params) => {
      setState(params.id, "exited", "Exited (0) 1 second ago");
      return { id: params.id, action: "stopped" };
    },
    "docker/container/restart": (params) => {
      setState(params.id, "running", "Up 1 second");
      return { id: params.id, action: "restarted" };
    },
    "docker/container/pause": (params) => {
      setState(params.id, "paused", "Up 1 second (Paused)");
      return { id: params.id, action: "paused" };
    },
    "docker/container/unpause": (params) => {
      setState(params.id, "running", "Up 1 second");
      return { id: params.id, action: "unpaused" };
    },
    "docker/container/remove": (params) => {
      const at = containers.findIndex((row) => row.id === params.id);
      if (at >= 0) containers.splice(at, 1);
      return { id: params.id, action: "removed" };
    },
  });

  return {
    containers,
    handlers,
    failList(fails: boolean) {
      listFails = fails;
    },
  };
}

/** 页面上所有文本拼在一起，方便做「包含」断言（多行 Text 是一个节点）。 */
function shown(app: { texts(): string[] }): string {
  return app.texts().join("\n");
}

function methodCalls(
  app: { host: { calls(): Array<{ name: string; data: unknown }> } },
  method: string,
): Array<{ handle?: string; method?: string; params?: Record<string, unknown> }> {
  return app.host
    .calls()
    .filter((entry) => entry.name === "navop.resource.invoke")
    .map((entry) => entry.data as { handle?: string; method?: string; params?: Record<string, unknown> })
    .filter((data) => data.method === method);
}

test("列表渲染：名称、镜像、状态、文档数", async () => {
  const w = world();
  const app = await open("./App.tsx", {
    width: 1200,
    height: 800,
    host: { handlers: w.handlers },
    clock: {},
  });
  await app.waitFor("text:web");

  const text = shown(app);
  expect(text).toContain("容器");
  expect(text).toContain("3 个 · 运行中 1");
  expect(text).toContain("nginx:1.27");
  expect(text).toContain("运行中");
  expect(text).toContain("postgres:16");
  expect(text).toContain("已停止");
  expect(text).toContain("redis:7");
  expect(text).toContain("已暂停");

  // 首次加载会自动选中第一个容器，并拉一次 inspect。
  await app.waitFor("text:概览");
  expect(shown(app)).toContain("unless-stopped");
  expect(shown(app)).toContain("172.17.0.2");
  expect(methodCalls(app, "docker/container/inspect")[0]?.params).toEqual({ id: "c1" });
  app.dispose();
});

test("搜索过滤：名称 / 镜像子串", async () => {
  const w = world();
  const app = await open("./App.tsx", {
    width: 1200,
    height: 800,
    host: { handlers: w.handlers },
    clock: {},
  });
  await app.waitFor("text:web");

  await app.type("id:container-filter", "postgres");
  await app.waitFor("text:db");
  let text = shown(app);
  expect(text).toContain("Exited (0) 2 hours ago · postgres:16");
  expect(text).not.toContain("Up 3 hours · nginx:1.27");
  expect(text).not.toContain("Up 5 minutes (Paused) · redis:7");

  await app.clear("id:container-filter");
  await app.waitFor("text:web");
  text = shown(app);
  expect(text).toContain("Up 3 hours · nginx:1.27");
  expect(text).toContain("Up 5 minutes (Paused) · redis:7");
  app.dispose();
});

test("状态过滤：运行中 / 已停止 / 全部", async () => {
  const w = world();
  const app = await open("./App.tsx", {
    width: 1200,
    height: 800,
    host: { handlers: w.handlers },
    clock: {},
  });
  await app.waitFor("text:web");

  await app.press("过滤:运行中");
  await app.waitFor("text:Up 3 hours · nginx:1.27");
  let text = shown(app);
  expect(text).not.toContain("Exited (0) 2 hours ago · postgres:16");
  expect(text).not.toContain("Up 5 minutes (Paused) · redis:7");

  await app.press("过滤:已停止");
  await app.waitFor("text:Exited (0) 2 hours ago · postgres:16");
  text = shown(app);
  expect(text).toContain("Up 5 minutes (Paused) · redis:7");
  expect(text).not.toContain("Up 3 hours · nginx:1.27");

  await app.press("过滤:全部");
  await app.waitFor("text:Up 3 hours · nginx:1.27");
  text = shown(app);
  expect(text).toContain("Exited (0) 2 hours ago · postgres:16");
  app.dispose();
});

test("选中后的详情：状态、网络、挂载、环境变量", async () => {
  const w = world();
  const app = await open("./App.tsx", {
    width: 1200,
    height: 800,
    host: { handlers: w.handlers },
    clock: {},
  });
  await app.waitFor("text:web");

  await app.press("text:db");
  await app.waitUntil(() => shown(app).includes("/usr/share/nginx/html（读写 · bind）"));
  const text = shown(app);
  expect(text).toContain("网络");
  expect(text).toContain("172.17.0.3");
  expect(text).toContain("/srv/www");
  expect(text).toContain("/usr/share/nginx/html（读写 · bind）");
  expect(text).toContain("TZ");
  expect(text).toContain("Asia/Shanghai");
  expect(methodCalls(app, "docker/container/inspect").some((call) => call.params?.id === "c2")).toBe(true);
  app.dispose();
});

test("启动按钮：调用带容器 id，刷新后状态变化", async () => {
  const w = world();
  const app = await open("./App.tsx", {
    width: 1200,
    height: 800,
    host: { handlers: w.handlers },
    clock: {},
  });
  await app.waitFor("text:web");

  await app.press("text:db");
  await app.waitFor("text:启动");
  await app.press("启动");

  await app.waitFor("text:已启动容器 db");
  const start = methodCalls(app, "docker/container/start");
  expect(start.length).toBe(1);
  expect(start[0]?.params).toEqual({ id: "c2" });
  expect(start[0]?.handle).toBe("r-1");

  // 刷新后 db 变成运行中：列表与详情都跟着变。
  await app.waitFor("text:Up 1 second · postgres:16");
  expect(shown(app)).toContain("3 个 · 运行中 2");
  expect(app.shows("text:停止")).toBe(true);
  app.dispose();
});

test("删除走页内二次确认", async () => {
  const w = world();
  const app = await open("./App.tsx", {
    width: 1200,
    height: 800,
    host: { handlers: w.handlers },
    clock: {},
  });
  await app.waitFor("text:web");

  await app.press("text:db");
  await app.waitFor("text:启动");
  await app.press("删除容器");
  await app.waitFor("text:删除容器 db？会先强制停止再删除（匿名卷一并删除），无法恢复。");

  // 没确认之前不能调 remove。
  expect(methodCalls(app, "docker/container/remove").length).toBe(0);

  await app.press("删除");
  await app.waitFor("text:已删除容器 db");
  expect(methodCalls(app, "docker/container/remove")[0]?.params).toEqual({ id: "c2" });
  expect(w.containers.map((row) => row.id)).toEqual(["c1", "c3"]);
  expect(app.shows("text:db")).toBe(false);

  // 删掉当前选中项后回到第一个容器，不报错。
  await app.waitFor("text:概览");
  expect(shown(app)).toContain("web");
  app.dispose();
});

test("列表失败：显示错误 + 重试", async () => {
  const w = world();
  w.failList(true);
  const app = await open("./App.tsx", {
    width: 1200,
    height: 800,
    host: { handlers: w.handlers },
    clock: {},
  });
  await app.waitFor("text:加载失败：connection refused");

  w.failList(false);
  await app.press("重试");
  await app.waitFor("text:web");
  expect(shown(app)).toContain("nginx:1.27");
  app.dispose();
});

test("没有选中容器时显示引导空态", async () => {
  const w = world();
  w.containers.splice(0, w.containers.length);
  const app = await open("./App.tsx", {
    width: 1200,
    height: 800,
    host: { handlers: w.handlers },
    clock: {},
  });
  await app.waitFor("text:还没有容器");
  expect(shown(app)).toContain("docker run");
  expect(shown(app)).toContain("选择一个容器");
  app.dispose();
});

test("暂停与恢复：按钮随状态切换", async () => {
  const w = world();
  const app = await open("./App.tsx", {
    width: 1200,
    height: 800,
    host: { handlers: w.handlers },
    clock: {},
  });
  await app.waitFor("text:web");
  await app.waitFor("text:暂停");

  await app.press("暂停");
  await app.waitFor("text:已暂停容器 web");
  expect(methodCalls(app, "docker/container/pause")[0]?.params).toEqual({ id: "c1" });
  await app.waitFor("text:恢复");
  expect(shown(app)).toContain("Up 1 second (Paused) · nginx:1.27");

  await app.press("恢复");
  await app.waitFor("text:已恢复容器 web");
  expect(methodCalls(app, "docker/container/unpause")[0]?.params).toEqual({ id: "c1" });
  await app.waitFor("text:暂停");
  app.dispose();
});

test("停止：详情按钮回落为启动", async () => {
  const w = world();
  const app = await open("./App.tsx", {
    width: 1200,
    height: 800,
    host: { handlers: w.handlers },
    clock: {},
  });
  await app.waitFor("text:web");
  await app.press("停止");
  await app.waitFor("text:已停止容器 web");
  expect(methodCalls(app, "docker/container/stop")[0]?.params).toEqual({ id: "c1" });
  await app.waitFor("text:启动");
  expect(shown(app)).toContain("Exited (0) 1 second ago · nginx:1.27");
  expect(shown(app)).toContain("3 个 · 运行中 0");
  app.dispose();
});

test("刷新按钮重新拉列表", async () => {
  const w = world();
  const app = await open("./App.tsx", {
    width: 1200,
    height: 800,
    host: { handlers: w.handlers },
    clock: {},
  });
  await app.waitFor("text:web");
  const before = methodCalls(app, "docker/container/list").length;
  await app.press("刷新");
  await app.waitUntil(() => methodCalls(app, "docker/container/list").length > before);
  expect(shown(app)).toContain("3 个 · 运行中 1");
  app.dispose();
});

test("没有连接时显示可读错误", async () => {
  const handlers = {
    "navop.context.current": () => {
      throw new Error("当前窗口没有扩展连接");
    },
    "navop.resource.invoke": () => ({}),
  };
  const app = await open("./App.tsx", {
    width: 1200,
    height: 800,
    host: { handlers },
    clock: {},
  });
  await app.waitFor("text:加载失败：当前窗口没有扩展连接");
  expect(app.shows("text:重试")).toBe(true);
  app.dispose();
});
