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

/** provider 的 mounts 形状：bollard MountPoint，字段 PascalCase。 */
function mountsResult() {
  return {
    id: "c-web",
    mounts: [
      {
        Type: "bind",
        Name: "",
        Source: "/Users/me/app",
        Destination: "/app",
        Mode: "rw",
        RW: true,
      },
      {
        Type: "volume",
        Name: "pgdata",
        Source: "/var/lib/docker/volumes/pgdata/_data",
        Destination: "/var/lib/postgresql/data",
        Mode: "ro",
        RW: false,
      },
      {
        Type: "tmpfs",
        Name: "",
        Source: "",
        Destination: "/tmp",
        Mode: "",
        RW: true,
      },
    ],
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

test("进页面先列容器，未选中时给引导空态且不请求挂载", async () => {
  const app = await open("./App.tsx", {
    host: {
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/mounts": mountsResult,
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  expect(app.texts()).toContain("2 / 2 个容器");
  expect(app.texts()).toContain("未选择容器");
  expect(invokeCalls(app, "docker/container/mounts").length).toBe(0);
});

test("选中容器后按 id 读挂载，展示类型 / 只读标记 / 源与目标", async () => {
  const app = await open("./App.tsx", {
    host: {
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/mounts": mountsResult,
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  await app.press("label:容器 web");
  await app.waitFor("text:/app");

  const mounts = invokeCalls(app, "docker/container/mounts");
  expect(mounts.length).toBe(1);
  expect(mounts[0].params).toEqual({ id: "c-web" });
  expect(app.texts()).toContain("3 个挂载");
  expect(app.texts()).toContain("只读 1");
  expect(app.texts()).toContain("bind");
  expect(app.texts()).toContain("volume");
  expect(app.texts()).toContain("tmpfs");
  expect(app.texts()).toContain("只读");
  expect(app.texts()).toContain("可写");
  expect(app.texts()).toContain("名称 pgdata");
  expect(app.texts()).toContain("/Users/me/app");
  expect(app.texts()).toContain("/var/lib/postgresql/data");
  expect(app.texts()).toContain("模式 ro");
});

test("切换容器会重新请求，且只请求新容器", async () => {
  const app = await open("./App.tsx", {
    host: {
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/mounts": (params) =>
          String(params.id) === "c-db"
            ? { id: "c-db", mounts: [{ Type: "volume", Name: "pgdata", Source: "/v", Destination: "/db", Mode: "rw", RW: true }] }
            : mountsResult(),
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  await app.press("label:容器 web");
  await app.waitFor("text:/app");
  await app.press("切换容器");
  await app.press("label:容器 db");
  await app.waitFor("text:/db");
  const mounts = invokeCalls(app, "docker/container/mounts");
  expect(mounts.length).toBe(2);
  expect(mounts[1].params).toEqual({ id: "c-db" });
});

test("容器没有挂载时说明原因", async () => {
  const app = await open("./App.tsx", {
    host: {
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/mounts": () => ({ id: "c-web", mounts: [] }),
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  await app.press("label:容器 web");
  await app.waitFor("text:容器没有挂载");
});

test("挂载读取失败显示错误并可重试", async () => {
  let fail = true;
  const app = await open("./App.tsx", {
    host: {
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/mounts": () => {
          if (fail) throw new Error("docker daemon unavailable");
          return mountsResult();
        },
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  await app.press("label:容器 web");
  await app.waitFor("text:加载失败：docker daemon unavailable");
  fail = false;
  await app.press("重试");
  await app.waitFor("text:/app");
});
