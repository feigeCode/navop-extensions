import { expect, open, test } from "nsh/test";
import { hostHandlers, TEST_PARAMS as BASE_PARAMS } from "../../lib/test-host";

// 页面测试统一从外壳入口（ui/App.tsx）进入，用本页路由启动。
const TEST_PARAMS = { ...BASE_PARAMS, route: "networks" };

const bridge = { id: "0d3b9a1c7e2f", name: "bridge", driver: "bridge", scope: "local", internal: false };
const appNet = { id: "9f8e7d6c5b4a", name: "app-net", driver: "bridge", scope: "local", internal: true };

function handlers() {
  const networks = [bridge, appNet];
  return hostHandlers({
    "docker/network/list": () => ({ networks }),
    "docker/network/inspect": (params) => {
      const builtin = params.id === bridge.id;
      return {
        Name: builtin ? "bridge" : "app-net",
        Id: params.id,
        Created: "2026-01-02T03:04:05Z",
        Scope: "local",
        Driver: "bridge",
        Internal: !builtin,
        Attachable: false,
        IPAM: {
          Driver: "default",
          Config: builtin
            ? []
            : [{ Subnet: "172.18.0.0/16", Gateway: "172.18.0.1", IPRange: "", AuxiliaryAddresses: {} }],
        },
        Containers: builtin
          ? {}
          : { abc123: { Name: "web", IPv4Address: "172.18.0.2/16", MacAddress: "02:42:ac:12:00:02" } },
        Labels: { team: "infra" },
        Options: {},
      };
    },
    "docker/network/create": (params) => {
      const name = String(params.name ?? "new-net");
      networks.push({ id: "aaaaaaaabbbb", name, driver: String(params.driver ?? "bridge"), scope: "local", internal: false });
      // 真 provider 返回完整 64 位 id；列表里是 12 位短 id。
      return { id: "f".repeat(64), warning: "", action: "created" };
    },
    "docker/network/remove": () => ({}),
    "docker/network/prune": () => ({ deleted: ["x"] }),
  });
}

test("列表与详情", async () => {
  const app = await open("../../App.tsx", { width: 1100, height: 800, host: { params: TEST_PARAMS, handlers: handlers() } });
  await app.waitFor("text:app-net");
  expect(app.texts()).toContain("网络");
  expect(app.texts()).toContain("内建");
  await app.press("text:app-net");
  await app.waitFor("text:子网");
  expect(app.texts()).toContain("172.18.0.0/16");
  expect(app.texts()).toContain("172.18.0.1");
  expect(app.texts()).toContain("web");
  expect(app.texts()).toContain("172.18.0.2/16");
  expect(app.texts()).toContain("team");
});

test("内建网络不可删除", async () => {
  const app = await open("../../App.tsx", { width: 1100, height: 800, host: { params: TEST_PARAMS, handlers: handlers() } });
  await app.waitFor("text:app-net");
  await app.press("text:bridge");
  await app.waitFor("text:内建网络不可删除");
  expect(app.texts()).not.toContain("删除网络 bridge？已连接到它的容器会失去这个网络。");
});

test("新建后按短 id 选中", async () => {
  const app = await open("../../App.tsx", { width: 1100, height: 800, host: { params: TEST_PARAMS, handlers: handlers() } });
  await app.waitFor("text:app-net");
  await app.press("新建网络");
  await app.type("text:网络名称，如 app-net", "new-net");
  await app.press("创建");
  await app.waitFor("text:已创建网络 new-net");
  // 详情头部的 meta 是唯一带 id 的文本，能证明按短 id 重新选中并加载了详情。
  await app.waitFor("text:bridge · local · aaaaaaaabbbb");
});

test("删除走二次确认", async () => {
  const app = await open("../../App.tsx", { width: 1100, height: 800, host: { params: TEST_PARAMS, handlers: handlers() } });
  await app.waitFor("text:app-net");
  await app.press("text:app-net");
  await app.waitFor("text:子网");
  await app.press("删除网络");
  await app.waitFor("text:删除网络 app-net？已连接到它的容器会失去这个网络。");
  await app.press("删除");
  await app.waitFor("text:已删除网络 9f8e7d6c5b4a");
});

test("清理未使用", async () => {
  const app = await open("../../App.tsx", { width: 1100, height: 800, host: { params: TEST_PARAMS, handlers: handlers() } });
  await app.waitFor("text:app-net");
  await app.press("清理未使用");
  await app.waitFor("text:清理所有未被容器使用的网络？");
  await app.press("清理");
  await app.waitFor("text:已清理 1 个未使用网络");
});

test("搜索过滤", async () => {
  const app = await open("../../App.tsx", { width: 1100, height: 800, host: { params: TEST_PARAMS, handlers: handlers() } });
  await app.waitFor("text:app-net");
  await app.type("按名称 / ID / 驱动过滤", "zzz");
  await app.waitFor("text:没有匹配的网络");
});
