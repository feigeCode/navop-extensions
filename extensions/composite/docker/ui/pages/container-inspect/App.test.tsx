// 临时自测（交付前删除）：验证默认展开、折叠切换、两列环境变量、原始 JSON 截断与错误态。
import { expect, open, test } from "nsh/test";

const DOC = {
  Id: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  Name: "/web-1",
  Image: "sha256:aaaa",
  State: {
    Status: "running",
    StartedAt: "2026-11-02T09:31:04.123456789Z",
    Health: { Status: "healthy" },
  },
  Config: {
    Image: "nginx:1.27",
    Cmd: ["nginx", "-g", "daemon off;"],
    Env: ["PATH=/usr/local/sbin:/usr/local/bin", "TOKEN=abcdefghijklmnopqrstuvwxyz0123456789"],
  },
  HostConfig: {
    Memory: 1073741824,
    MemorySwap: 2147483648,
    NanoCpus: 1500000000,
    CpuShares: 512,
    PidsLimit: 100,
    RestartPolicy: { Name: "on-failure", MaximumRetryCount: 3 },
    ReadonlyRootfs: false,
  },
  NetworkSettings: {
    Networks: {
      bridge: { IPAddress: "172.17.0.2", Gateway: "172.17.0.1", MacAddress: "02:42:ac:11:00:02", Ports: {} },
    },
    Ports: { "80/tcp": [{ HostIp: "0.0.0.0", HostPort: "8080" }], "443/tcp": null },
  },
  Mounts: [
    { Type: "bind", Source: "/host/data", Destination: "/data", RW: true, Mode: "rw" },
    { Type: "volume", Source: "/var/lib/docker/volumes/x/_data", Destination: "/cache", RW: false, Mode: "z" },
  ],
};

test("inspect: 默认展开基础与网络，其余收起", async () => {
  const app = await open("./App.tsx", {
    host: { handlers: { "navop.workbench.dispatch": () => DOC } },
  });
  await app.waitFor("text:容器详情");
  await app.waitFor("text:web-1");
  expect(app.texts()).toContain("基础");
  expect(app.texts()).toContain("网络");
  expect(app.texts()).toContain("挂载");
  expect(app.texts()).toContain("环境变量");
  expect(app.texts()).toContain("资源限制");
  // 基础展开
  expect(app.texts()).toContain("重启策略");
  expect(app.texts()).toContain("on-failure（最多 3 次）");
  // 网络展开
  expect(app.texts()).toContain("172.17.0.2");
  expect(app.texts()).toContain("0.0.0.0:8080 → 80/tcp");
  expect(app.texts()).toContain("443/tcp（仅暴露）");
  // 挂载 / 环境变量收起
  expect(app.texts().some((t) => t.includes("/host/data"))).toBe(false);
  expect(app.texts().some((t) => t.includes("TOKEN"))).toBe(false);
  expect(app.host.calls()[0].data).toEqual({ operationId: "inspectContainer", input: {} });
});

test("inspect: 点开挂载、环境变量、资源限制", async () => {
  const app = await open("./App.tsx", {
    host: { handlers: { "navop.workbench.dispatch": () => DOC } },
  });
  await app.waitFor("text:web-1");
  await app.press("挂载分组");
  expect(app.texts()).toContain("/host/data → /data");
  expect(app.texts()).toContain("读写 (rw)");
  expect(app.texts()).toContain("只读 (ro)");
  await app.press("环境变量分组");
  expect(app.texts()).toContain("PATH");
  expect(app.texts()).toContain("/usr/local/sbin:/usr/local/bin");
  await app.press("资源限制分组");
  expect(app.texts()).toContain("1.50 核");
  expect(app.texts()).toContain("1.0 GB");
  expect(app.texts()).toContain("2.0 GB");
  // 再点一次收起
  await app.press("挂载分组");
  expect(app.texts().some((t) => t.includes("/host/data"))).toBe(false);
});

test("inspect: 原始 JSON 开关", async () => {
  const app = await open("./App.tsx", {
    host: { handlers: { "navop.workbench.dispatch": () => DOC } },
  });
  await app.waitFor("text:web-1");
  await app.press("原始 JSON");
  expect(app.texts().some((t) => t.includes('"NanoCpus": 1500000000'))).toBe(true);
  await app.press("原始 JSON");
  expect(app.texts().some((t) => t.includes('"NanoCpus": 1500000000'))).toBe(false);
  expect(app.texts()).toContain("重启策略");
});

test("inspect: 原始 JSON 超过 800 行时截断并提示", async () => {
  const big = { ...DOC, Config: { ...DOC.Config, Env: Array.from({ length: 1000 }, (_, i) => `K${i}=v${i}`) } };
  const app = await open("./App.tsx", {
    host: { handlers: { "navop.workbench.dispatch": () => big } },
  });
  await app.waitFor("text:web-1");
  await app.press("原始 JSON");
  const header = app.texts().find((t) => t.startsWith("原始 JSON ·"));
  expect(header?.includes("仅渲染前 800 行")).toBe(true);
});

test("inspect: 失败显示错误并可重试", async () => {
  let fail = true;
  const app = await open("./App.tsx", {
    host: {
      handlers: {
        "navop.workbench.dispatch": () => {
          if (fail) throw new Error("容器未选中：缺少 selection");
          return DOC;
        },
      },
    },
  });
  await app.waitFor("text:加载失败：容器未选中：缺少 selection");
  fail = false;
  await app.press("重试");
  await app.waitFor("text:web-1");
});

test("inspect: 没有数据时显示空态", async () => {
  const app = await open("./App.tsx", {
    host: { handlers: { "navop.workbench.dispatch": () => null } },
  });
  await app.waitFor("text:没有容器数据");
});

test("inspect: 刷新后分组内容更新且保持展开", async () => {
  let doc: unknown = DOC;
  const app = await open("./App.tsx", {
    host: { handlers: { "navop.workbench.dispatch": () => doc } },
  });
  await app.waitFor("text:web-1");
  await app.press("挂载分组");
  expect(app.texts()).toContain("/host/data → /data");
  doc = {
    ...DOC,
    Name: "/web-2",
    Mounts: [{ Type: "bind", Source: "/host/new", Destination: "/new", RW: false }],
  };
  await app.press("刷新");
  await app.waitFor("text:web-2");
  await app.waitUntil(() => app.texts().includes("/host/new → /new"));
  expect(app.texts().some((t) => t.includes("/host/data"))).toBe(false);
  expect(app.texts()).toContain("只读 (ro)");
});
