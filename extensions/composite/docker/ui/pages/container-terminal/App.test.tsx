import { expect, open, test } from "nsh/test";
import { hostHandlers, TEST_PARAMS as BASE_PARAMS } from "../../lib/test-host";

// 页面测试统一从外壳入口（ui/App.tsx）进入，用本页路由启动。
const TEST_PARAMS = { ...BASE_PARAMS, route: "container-terminal" };

const nginx = {
  id: "aaa111",
  name: "web",
  image: "nginx:1.27",
  state: "running",
  status: "Up 3 hours",
  ports: "0.0.0.0:8080->80/tcp",
};

const worker = {
  id: "bbb222",
  name: "worker",
  image: "redis:7",
  state: "exited",
  status: "Exited (0) 2 hours ago",
  ports: "",
};

function handlers(containers: unknown[] = [nginx, worker]) {
  return hostHandlers({
    "docker/container/list": () => ({ containers }),
  });
}

test("列表渲染容器与状态", async () => {
  const app = await open("../../App.tsx", { width: 1100, height: 800, host: { params: TEST_PARAMS, handlers: handlers() } });
  await app.waitFor("text:web");
  expect(app.texts()).toContain("worker");
  expect(app.texts()).toContain("运行中");
  expect(app.texts()).toContain("已停止");
});

test("选中容器后出现终端区域", async () => {
  const app = await open("../../App.tsx", { width: 1100, height: 800, host: { params: TEST_PARAMS, handlers: handlers() } });
  await app.waitFor("text:web");
  await app.press("text:web");
  await app.waitFor("text:重新连接");
  expect(app.texts()).toContain("在本机开一个 docker exec -it web /bin/sh");
});

test("未运行的容器给出提示而不是空终端", async () => {
  const app = await open("../../App.tsx", { width: 1100, height: 800, host: { params: TEST_PARAMS, handlers: handlers() } });
  await app.waitFor("text:worker");
  await app.press("text:worker");
  await app.waitFor("text:容器未运行");
  expect(app.texts()).toContain("启动容器后点上面的「重新连接」");
});

test("空列表提示", async () => {
  const app = await open("../../App.tsx", {
    width: 1100,
    height: 800,
    host: { params: TEST_PARAMS, handlers: handlers([]) },
  });
  await app.waitFor("text:没有匹配的容器");
  expect(app.texts()).toContain("共 0 个容器");
});

test("拉取失败显示重试", async () => {
  const app = await open("../../App.tsx", {
    width: 1100,
    height: 800,
    host: {
      params: TEST_PARAMS,
      handlers: hostHandlers({
        "docker/container/list": () => {
          throw new Error("daemon 未运行");
        },
      }),
    },
  });
  await app.waitFor("text:加载失败：daemon 未运行");
  expect(app.texts()).toContain("重试");
});
