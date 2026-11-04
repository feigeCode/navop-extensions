import { expect, open, test } from "nsh/test";
import { hostHandlers, TEST_PARAMS as BASE_PARAMS } from "../../lib/test-host";

// 页面测试统一从外壳入口（ui/App.tsx）进入，用本页路由启动。
const TEST_PARAMS = { ...BASE_PARAMS, route: "changes" };

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

/** provider 的 diff 形状：Kind 是数字 0=C / 1=A / 2=D，字段 PascalCase。 */
function diffResult() {
  return {
    id: "c-web",
    changes: [
      { Path: "/etc/nginx/conf.d/default.conf", Kind: 1 },
      { Path: "/usr/share/nginx/html/index.html", Kind: 0 },
      { Path: "/tmp/old.log", Kind: 2 },
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

test("进页面先列容器，未选中时给引导空态且不请求变更", async () => {
  const app = await open("../../App.tsx", {
    width: 1200,
    height: 800,
    host: {
      params: TEST_PARAMS,
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/diff": diffResult,
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  expect(app.texts()).toContain("web");
  expect(app.texts()).toContain("db");
  expect(app.texts()).toContain("2 / 2 个容器");
  expect(app.texts()).toContain("未选择容器");
  expect(invokeCalls(app, "docker/container/diff").length).toBe(0);
});

test("选中容器后按 id 读变更，并显示三类计数", async () => {
  const app = await open("../../App.tsx", {
    width: 1200,
    height: 800,
    host: {
      params: TEST_PARAMS,
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/diff": diffResult,
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  await app.press("label:容器 web");
  await app.waitFor("text:index.html");

  const diffs = invokeCalls(app, "docker/container/diff");
  expect(diffs.length).toBe(1);
  expect(diffs[0].params).toEqual({ id: "c-web" });
  expect(app.texts()).toContain("3 项");
  expect(app.texts()).toContain("新增 1");
  expect(app.texts()).toContain("修改 1");
  expect(app.texts()).toContain("删除 1");
  expect(app.texts()).toContain("default.conf");
  expect(app.texts()).toContain("/usr/share/nginx/html");
});

test("点击变更行后在底部展示完整路径与类型", async () => {
  const app = await open("../../App.tsx", {
    width: 1200,
    height: 800,
    host: {
      params: TEST_PARAMS,
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/diff": diffResult,
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  await app.press("label:容器 web");
  await app.waitFor("text:index.html");
  await app.press("text:index.html");
  // `text:` 的值以 `/` 开头会被当成正则字面量，这里等固定文案，再用 texts() 断言路径。
  await app.waitFor("text:完整路径");
  expect(app.texts()).toContain("/usr/share/nginx/html/index.html");
  expect(app.texts()).toContain("修改（Modified）");
  // 再点一次收起详情。
  await app.press("text:index.html");
  await app.waitFor("text:点击任意一行查看完整路径；docker diff 只比较容器可写层。");
});

test("没有变更时说明可写层为空", async () => {
  const app = await open("../../App.tsx", {
    width: 1200,
    height: 800,
    host: {
      params: TEST_PARAMS,
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/diff": () => ({ id: "c-web", changes: [] }),
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  await app.press("label:容器 web");
  await app.waitFor("text:可写层没有文件变更");
});

test("变更读取失败显示错误并可重试", async () => {
  let fail = true;
  const app = await open("../../App.tsx", {
    width: 1200,
    height: 800,
    host: {
      params: TEST_PARAMS,
      handlers: hostHandlers({
        "docker/container/list": containerList,
        "docker/container/diff": () => {
          if (fail) throw new Error("docker daemon unavailable");
          return diffResult();
        },
      }),
    },
  });
  await app.waitFor("text:先选择一个容器");
  await app.press("label:容器 web");
  await app.waitFor("text:加载失败：docker daemon unavailable");
  fail = false;
  await app.press("重试");
  await app.waitFor("text:index.html");
});
