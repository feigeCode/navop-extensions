import { expect, open, test } from "nsh/test";
import { hostHandlers } from "../../lib/test-host";

const usage = {
  engine: true,
  server_version: "27.3.1",
  cpu_count: 10,
  containers_total: 7,
  containers_running: 3,
  images: 12,
  volumes: 4,
  networks: 5,
  disk_used_bytes: 12_884_901_888,
  disk_reclaimable_bytes: 2_147_483_648,
  containers_memory_bytes: 536_870_912,
  containers_cpu_percent: 12.5,
};

function handlers() {
  return hostHandlers({
    "docker/system/usage": () => usage,
  });
}

test("引擎概览显示运行中容器与磁盘占用", async () => {
  const app = await open("./App.tsx", { width: 1100, height: 800, host: { handlers: handlers() } });
  await app.waitFor("text:Docker 引擎");
  expect(app.texts()).toContain("Docker 引擎");
  const texts = app.texts().join(" ");
  expect(texts).toContain("27.3.1");
  expect(texts).toContain("3 / 7");
  expect(texts).toContain("512.0 MB");
});

test("取数失败时给出重试", async () => {
  const app = await open("./App.tsx", {
    width: 1100,
    height: 800,
    host: {
      handlers: hostHandlers({
        "docker/system/usage": () => {
          throw new Error("daemon 不可用");
        },
      }),
    },
  });
  await app.waitFor("text:重试");
  expect(app.texts().join(" ")).toContain("daemon 不可用");
});
