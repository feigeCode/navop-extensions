import { expect, open, test } from "nsh/test";
import { hostHandlers } from "../../lib/test-host";

const volume = {
  name: "app-data",
  driver: "local",
  mountpoint: "/var/lib/docker/volumes/app-data/_data",
  scope: "local",
  size_bytes: 2048,
  size: "2.0 KB",
  ref_count: 1,
};

function handlers() {
  return hostHandlers({
    "docker/volume/list": () => ({ volumes: [volume] }),
    "docker/volume/inspect": (params) => ({
      Name: String(params.name ?? ""),
      Driver: "local",
      Mountpoint: "/var/lib/docker/volumes/app-data/_data",
      CreatedAt: "2026-01-02T03:04:05Z",
      Scope: "local",
      Labels: { team: "infra" },
      Options: {},
      Status: null,
    }),
    "docker/volume/create": (params) => ({ Name: String(params.name ?? "") }),
    "docker/volume/remove": () => ({}),
    "docker/volume/prune": () => ({ deleted: ["old"], space_reclaimed_bytes: 2048 }),
  });
}

test("列表与详情", async () => {
  const app = await open("./App.tsx", { width: 1100, height: 800, host: { handlers: handlers() } });
  await app.waitFor("text:app-data");
  expect(app.texts()).toContain("存储卷");
  expect(app.texts()).toContain("app-data");
  await app.press("text:app-data");
  await app.waitFor("text:挂载点");
  expect(app.texts()).toContain("/var/lib/docker/volumes/app-data/_data");
  expect(app.texts()).toContain("team");
  expect(app.texts()).toContain("infra");
});

test("新建存储卷", async () => {
  const app = await open("./App.tsx", { width: 1100, height: 800, host: { handlers: handlers() } });
  await app.waitFor("text:app-data");
  await app.press("新建存储卷");
  await app.type("text:存储卷名称，如 app-data", "newvol");
  await app.press("创建");
  await app.waitFor("text:已创建存储卷 newvol");
});

test("删除走二次确认", async () => {
  const app = await open("./App.tsx", { width: 1100, height: 800, host: { handlers: handlers() } });
  await app.waitFor("text:app-data");
  await app.press("text:app-data");
  await app.waitFor("text:挂载点");
  await app.press("删除存储卷");
  await app.waitFor("text:删除存储卷 app-data？卷里的数据会一并删除，无法恢复。");
  await app.press("删除");
  await app.waitFor("text:已删除存储卷 app-data");
});

test("清理未使用", async () => {
  const app = await open("./App.tsx", { width: 1100, height: 800, host: { handlers: handlers() } });
  await app.waitFor("text:app-data");
  await app.press("清理未使用");
  await app.waitFor("text:清理所有未被容器使用的存储卷？卷里的数据会一并删除。");
  await app.press("清理");
  await app.waitFor("text:已清理 1 个未使用存储卷，回收 2.0 KB");
});

test("搜索过滤", async () => {
  const app = await open("./App.tsx", { width: 1100, height: 800, host: { handlers: handlers() } });
  await app.waitFor("text:app-data");
  await app.type("按名称 / 驱动 / 挂载点过滤", "zzz");
  await app.waitFor("text:没有匹配的存储卷");
});
