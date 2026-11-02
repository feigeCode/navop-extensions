// 开发者工具页的行为测试：把宿主侧 9 个 navop.dev.* 入口和 navop.log.info 全部 mock 掉，
// 覆盖列表/详情、打开视图的参数形状、添加目录（pickDirectory → 轮询 pickResult → open）、
// 日志刷新与档位、移除二次确认。
import { expect, open, test } from "nsh/test";

const DEMO = {
  root: "/work/demo-ext",
  id: "com.example.demo",
  name: "示例扩展",
  version: "0.2.1",
  error: null,
  watching: false,
  views: [{ id: "main", title: "主面板", surface: "tab", category: null }],
};

const OTHER = {
  root: "/work/other-ext",
  id: "com.example.other",
  name: "另一个工程",
  version: "0.1.0",
  error: null,
  watching: true,
  views: [{ id: "settings", title: "设置", surface: "toolbox", category: null }],
};

function handlers(initial: unknown[]) {
  const state = {
    projects: [...initial],
    picks: [] as (string | null)[],
  };
  const logs = (root: string, tail: number): string[] => {
    const lines = [
      "[nsh] dev catalog ready",
      "[nsh] registry abi ok",
      "[load error] could not resolve mod",
    ].slice(0, tail);
    return lines.map((line, index) => `${root}#${index} ${line}`);
  };
  return {
    state,
    handlers: {
      "navop.dev.list": () => state.projects,
      "navop.dev.open": (data: unknown) => {
        const root = String((data as Record<string, unknown>).root);
        const added = { ...DEMO, root, id: "com.example.new", name: "新工程", views: [{ id: "main", title: "主面板", surface: "tab" }] };
        state.projects = [...state.projects, added];
        return { root, id: added.id, error: null };
      },
      "navop.dev.reload": (data: unknown) => ({ root: String((data as Record<string, unknown>).root), id: "com.example.demo", error: null }),
      "navop.dev.watch": () => ({ watching: true }),
      "navop.dev.remove": (data: unknown) => {
        const root = String((data as Record<string, unknown>).root);
        state.projects = state.projects.filter((project) => (project as Record<string, unknown>).root !== root);
        return { root, id: "com.example.demo", error: null };
      },
      "navop.dev.openView": () => null,
      "navop.dev.logs": (data: unknown) => {
        const payload = data as Record<string, unknown>;
        return logs(String(payload.root), Number(payload.tail ?? 200));
      },
      "navop.dev.pickDirectory": () => "pending",
      "navop.dev.pickResult": () => (state.picks.length > 0 ? state.picks.shift()! : null),
      "navop.log.info": () => null,
    },
  };
}

test("列表与默认选中详情", async () => {
  const mock = handlers([DEMO, OTHER]);
  const app = await open("./App.tsx", { width: 1100, height: 800, host: { handlers: mock.handlers } });
  await app.waitFor("text:开发者工具");
  await app.waitFor("text:示例扩展");

  const texts = app.texts();
  expect(texts).toContain("2 个工程 · 1 个监听中");
  expect(texts).toContain("/work/demo-ext");
  expect(texts).toContain("主面板");
  expect(texts).toContain("v0.2.1");
  expect(texts).toContain("就绪");
  expect(texts).toContain("扩展视图");
});

test("打开视图按 extensionId + viewId 调 openView", async () => {
  const mock = handlers([DEMO, OTHER]);
  const app = await open("./App.tsx", { width: 1100, height: 800, host: { handlers: mock.handlers } });
  await app.waitFor("text:主面板");
  await app.press("text:打开");
  await app.waitFor("text:已请求打开视图 main");

  const calls = app.host.calls().filter((call) => call.name === "navop.dev.openView");
  expect(calls.length).toBe(1);
  expect(calls[0]!.data).toEqual({ extensionId: "com.example.demo", viewId: "main" });
});

test("添加工程：pickResult 拿到路径后 open", async () => {
  const mock = handlers([DEMO]);
  mock.state.picks = ["/work/new-ext"];
  const app = await open("./App.tsx", { width: 1100, height: 800, host: { handlers: mock.handlers } });
  await app.waitFor("text:示例扩展");
  await app.press("text:添加工程…");
  await app.waitFor("text:已加载工程 /work/new-ext");

  const opened = app.host.calls().filter((call) => call.name === "navop.dev.open");
  expect(opened.length).toBe(1);
  expect(opened[0]!.data).toEqual({ root: "/work/new-ext" });
  await app.waitFor("text:新工程");
});

test("日志面板：查看日志、切档位、刷新", async () => {
  const mock = handlers([DEMO, OTHER]);
  const app = await open("./App.tsx", { width: 1100, height: 800, host: { handlers: mock.handlers } });
  await app.waitFor("text:示例扩展");
  await app.press("text:查看日志");
  // 日志行以 `/` 开头：`text:/…` 会被当成正则字面量，所以这里按 texts() 找。
  const hasLine = (needle: string): boolean => app.texts().some((line) => line.includes(needle));
  await app.waitUntil(() => hasLine("/work/demo-ext#0 [nsh] dev catalog ready"));

  const first = app.host.calls().filter((call) => call.name === "navop.dev.logs");
  expect(first.length).toBe(1);
  expect(first[0]!.data).toEqual({ root: "/work/demo-ext", tail: 200 });

  await app.press("text:500");
  await app.waitUntil(() => hasLine("/work/demo-ext#2 [load error] could not resolve mod"));
  const last = app.host.calls().filter((call) => call.name === "navop.dev.logs").pop();
  expect(last!.data).toEqual({ root: "/work/demo-ext", tail: 500 });

  const before = app.host.calls().filter((call) => call.name === "navop.dev.logs").length;
  await app.press("text:刷新日志");
  await app.waitUntil(() => hasLine("/work/demo-ext#0 [nsh] dev catalog ready"));
  expect(app.host.calls().filter((call) => call.name === "navop.dev.logs").length).toBe(before + 1);
});

test("移除工程需要二次确认", async () => {
  const mock = handlers([DEMO, OTHER]);
  const app = await open("./App.tsx", { width: 1100, height: 800, host: { handlers: mock.handlers } });
  await app.waitFor("text:示例扩展");
  await app.press("text:移除工程");
  await app.waitFor("text:移除开发工程 /work/demo-ext？只从工作台卸载，不会删除磁盘上的文件。");
  expect(app.host.calls().filter((call) => call.name === "navop.dev.remove").length).toBe(0);

  await app.press("text:确认移除");
  await app.waitFor("text:已移除工程 /work/demo-ext");
  const calls = app.host.calls().filter((call) => call.name === "navop.dev.remove");
  expect(calls.length).toBe(1);
  expect(calls[0]!.data).toEqual({ root: "/work/demo-ext" });
});

test("首载失败展示错误并可重试", async () => {
  const mock = handlers([DEMO]);
  let attempts = 0;
  mock.handlers["navop.dev.list"] = () => {
    attempts += 1;
    if (attempts === 1) throw new Error("dev catalog unavailable");
    return mock.state.projects;
  };
  const app = await open("./App.tsx", { width: 1100, height: 800, host: { handlers: mock.handlers } });
  await app.waitFor("text:加载失败：dev catalog unavailable");
  await app.press("text:重试");
  await app.waitFor("text:示例扩展");
  expect(app.texts()).toContain("主面板");
});
