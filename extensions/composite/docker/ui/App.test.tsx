// app 外壳的路由测试：入口是 ui/App.tsx，验证默认路由、启动路由、
// 侧栏切换、未知 route 回落，以及没有连接时的空态（契约 §6）。
import { expect, open, test } from "nsh/test";
import { hostHandlers, TEST_PARAMS } from "./lib/test-host";

/** 两个列表页都只读列表；外壳测试不关心数据，给空列表即可。 */
const handlers = hostHandlers({
  "docker/container/list": () => ({ containers: [] }),
  "docker/image/list": () => ({ images: [] }),
  "docker/volume/list": () => ({ volumes: [] }),
});

test("默认路由渲染容器页，侧栏有 app 标题与路由项", async () => {
  const app = await open("./App.tsx", {
    width: 1200,
    height: 800,
    host: { params: TEST_PARAMS, handlers },
  });
  await app.waitFor("text:Docker");
  await app.waitFor("text:还没有容器");
  expect(app.shows("text:Docker Images")).toBe(true);
  expect(app.shows("text:Container Terminal")).toBe(true);
});

test("按 params.route 打开指定页面", async () => {
  const app = await open("./App.tsx", {
    width: 1200,
    height: 800,
    host: { params: { ...TEST_PARAMS, route: "images" }, handlers },
  });
  await app.waitFor("text:没有匹配的镜像");
  expect(app.shows("text:还没有容器")).toBe(false);
});

test("未知 route 回落默认路由", async () => {
  const app = await open("./App.tsx", {
    width: 1200,
    height: 800,
    host: { params: { ...TEST_PARAMS, route: "not-a-route" }, handlers },
  });
  await app.waitFor("text:还没有容器");
});

test("点侧栏切到另一个路由", async () => {
  const app = await open("./App.tsx", {
    width: 1200,
    height: 800,
    host: { params: TEST_PARAMS, handlers },
  });
  await app.waitFor("text:还没有容器");
  await app.press("text:Docker Images");
  await app.waitFor("text:没有匹配的镜像");
  expect(app.shows("text:还没有容器")).toBe(false);
});

test("没有连接时只显示空态，不渲染页面", async () => {
  const app = await open("./App.tsx", {
    width: 1200,
    height: 800,
    host: { params: { ...TEST_PARAMS, connection: null }, handlers },
  });
  await app.waitFor("text:请先打开一个 Docker 连接");
  expect(app.shows("text:还没有容器")).toBe(false);
  expect(app.shows("text:刷新")).toBe(false);
});
