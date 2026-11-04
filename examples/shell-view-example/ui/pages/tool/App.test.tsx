import { expect, open, test } from "nsh/test";

/** `host.params` 的启动事实：页面首帧前由宿主写入，测试直接喂不同形态。 */
function params(overrides: Record<string, unknown> = {}) {
  return {
    apiVersion: 2,
    extension: {
      id: "com.example.shell-view-example",
      title: "Tool",
    },
    route: "tool",
    backends: ["demo"],
    connection: null,
    ...overrides,
  };
}

const page = (startup: Record<string, unknown>, handlers: Record<string, (data: unknown) => unknown>) => ({
  width: 1100,
  height: 800,
  host: { params: startup, handlers },
});

test("没有借来连接时说明当前不是连接型页面", async () => {
  const app = await open(
    "../../App.tsx",
    page(params({ backends: [] }), {
      "navop.log": () => null,
    }),
  );
  await app.waitFor("text:页面上下文");
  await app.waitFor("text:当前页面不是连接型 shell view，没有借来的连接。可以在下面的「打开资源」里用后端别名自己打开一个资源。");
  const text = app.texts().join(" ");
  expect(text.includes("com.example.shell-view-example")).toBe(true);
  expect(text.includes("（未声明）")).toBe(true);
});

test("打开资源后可以调用方法并展示结果", async () => {
  const seen: string[] = [];
  const app = await open(
    "../../App.tsx",
    page(params(), {
      "navop.log": () => null,
      "navop.resource.open": (data) => {
        seen.push(JSON.stringify(data));
        return { handle: "res-1" };
      },
      "navop.resource.invoke": (data) => {
        seen.push(JSON.stringify(data));
        return { items: [{ id: 1, name: "demo" }] };
      },
    }),
  );
  await app.waitFor("text:页面上下文");
  await app.press("打开资源");
  await app.waitFor("text:已打开资源 demo-item（句柄 res-1）。");
  await app.press("调用当前句柄");
  await app.waitFor("text:资源调用成功（demo/list）。");
  const text = app.texts().join(" ");
  expect(text.includes('"items"')).toBe(true);
  expect(seen.some((item) => item.includes('"handle":"res-1"'))).toBe(true);
  expect(seen.some((item) => item.includes('"resourceType":"demo-item"'))).toBe(true);
});

test("借用连接展示上下文并可直接调用", async () => {
  let invokedHandle = "";
  const app = await open(
    "../../App.tsx",
    page(
      params({
        connection: {
          connectionId: "c1",
          name: "本地 Demo",
          contributionId: "demo-connection",
          resourceType: "demo",
          resourceHandle: "conn-1",
          alias: "demo",
        },
      }),
      {
        "navop.log": () => null,
        "navop.resource.invoke": (data) => {
          invokedHandle = (data as { handle: string }).handle;
          return { borrowed: true };
        },
      },
    ),
  );
  await app.waitFor("text:本地 Demo");
  await app.press("用借用资源调用");
  await app.waitFor("text:借用资源调用成功（demo/list）。");
  expect(invokedHandle).toBe("conn-1");
});

test("打开资源失败时显示宿主错误码与消息", async () => {
  const app = await open(
    "../../App.tsx",
    page(params(), {
      "navop.log": () => null,
      "navop.resource.open": () => {
        throw new Error("unknown backend alias `demo`");
      },
    }),
  );
  await app.waitFor("text:页面上下文");
  await app.press("打开资源");
  // 消息是稳定部分；code 与消息渲染在同一段文本里，所以用子串等而不是选择器
  // （`text:` 要求整段文本完全相等）。
  await app.waitUntil(() => app.texts().some((text) => text.includes("unknown backend alias")));
  // code 取决于 nsh 版本：新引擎会对 handler 抛出的 Error 补 ERR_NSH_HOST_ERROR，
  // 旧 CLI（host reject 链路还是老的）给 undefined，页面按设计落到自己的兜底码 PAGE_ERROR；
  // 真实宿主走 reject_error，会带上扩展自己的 code（例如 BACKEND_NOT_FOUND）。
  const text = app.texts().join(" ");
  expect(/PAGE_ERROR|ERR_NSH_HOST_ERROR/.test(text)).toBe(true);
});

test("没有句柄时调用提示 NO_HANDLE", async () => {
  const app = await open(
    "../../App.tsx",
    page(params({ backends: [] }), {
      "navop.log": () => null,
    }),
  );
  await app.waitFor("text:页面上下文");
  await app.press("调用当前句柄");
  await app.waitFor("text:NO_HANDLE：还没有打开的句柄：先在上面「打开资源」，或使用借来的连接。");
});
