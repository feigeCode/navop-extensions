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

/** provider 的 inspect 形状：bollard ContainerInspectResponse 的子集。 */
function inspectResult() {
  return {
    Id: "sha256:abc123",
    Name: "/web",
    Image: "sha256:def456",
    State: {
      Status: "running",
      StartedAt: "2026-11-02T10:00:00Z",
      Health: { Status: "healthy" },
    },
    Config: {
      Cmd: ["nginx", "-g", "daemon off;"],
      Env: ["PATH=/usr/sbin", "FOO=bar"],
    },
    HostConfig: {
      RestartPolicy: { Name: "always" },
      Memory: 1048576,
      MemorySwap: -1,
      NanoCpus: 2000000000,
      CpuShares: 0,
      PidsLimit: 100,
      ReadonlyRootfs: false,
    },
    Mounts: [
      {
        Type: "volume",
        Name: "pgdata",
        Source: "/var/lib/docker/volumes/pgdata/_data",
        Destination: "/var/lib/postgresql/data",
        Mode: "rw",
        RW: false,
      },
    ],
    NetworkSettings: {
      Networks: {
        bridge: { IPAddress: "172.17.0.2", Gateway: "172.17.0.1", MacAddress: "02:42:ac:11:00:02" },
      },
      Ports: { "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" }] },
    },
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

test("进页面先列容器，未选中时给引导空态且不请求详情", async () => {
  const app = await open("./App.tsx", {
    host: {
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/inspect": inspectResult,
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  expect(app.texts()).toContain("2 / 2 个容器");
  expect(app.texts()).toContain("未选择容器");
  expect(invokeCalls(app, "docker/container/inspect").length).toBe(0);
});

test("选中容器后按 id 读详情，基础分组默认展开", async () => {
  const app = await open("./App.tsx", {
    host: {
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/inspect": inspectResult,
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  await app.press("label:容器 web");
  await app.waitFor("text:容器 ID");

  const inspects = invokeCalls(app, "docker/container/inspect");
  expect(inspects.length).toBe(1);
  expect(inspects[0].params).toEqual({ id: "c-web" });
  expect(app.texts()).toContain("sha256:abc123");
  expect(app.texts()).toContain("名称");
  expect(app.texts()).toContain("web");
  expect(app.texts()).toContain("running（健康检查 healthy）");
  expect(app.texts()).toContain("启动命令");
  expect(app.texts()).toContain("nginx -g daemon off;");
  expect(app.texts()).toContain("always");
});

test("展开挂载分组后显示来源、目标与只读标记", async () => {
  const app = await open("./App.tsx", {
    host: {
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/inspect": inspectResult,
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  await app.press("label:容器 web");
  await app.waitFor("text:容器 ID");
  await app.press("挂载分组");
  await app.waitFor("text:只读 (ro)");
  expect(app.texts()).toContain("1. volume");
  expect(app.texts()).toContain("/var/lib/docker/volumes/pgdata/_data → /var/lib/postgresql/data");
});

test("可以切到原始 JSON 再切回分组", async () => {
  const app = await open("./App.tsx", {
    host: {
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/inspect": inspectResult,
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  await app.press("label:容器 web");
  await app.waitFor("text:容器 ID");
  await app.press("原始 JSON");
  await app.waitFor("text:查看分组");
  expect(app.texts().join("\n")).toContain("\"Id\": \"sha256:abc123\"");
  await app.press("查看分组");
  await app.waitFor("text:容器 ID");
});

test("详情读取失败显示错误并可重试", async () => {
  let fail = true;
  const app = await open("./App.tsx", {
    host: {
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/inspect": () => {
          if (fail) throw new Error("docker daemon unavailable");
          return inspectResult();
        },
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  await app.press("label:容器 web");
  await app.waitFor("text:加载失败：docker daemon unavailable");
  fail = false;
  await app.press("重试");
  await app.waitFor("text:容器 ID");
});
