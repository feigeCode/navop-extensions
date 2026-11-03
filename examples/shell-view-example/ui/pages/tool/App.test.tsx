import { expect, open, test } from "nsh/test";

const page = (handlers: Record<string, (data: unknown) => unknown>) => ({
  width: 1100,
  height: 800,
  host: { handlers },
});

/** 宿主错误信封：message + 标记 + base64url(json)。 */
function hostError(code: string, message: string): Error {
  const payload = Buffer.from(JSON.stringify({ code, message, retryable: false }), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return new Error(`${message}\n__NAVOP_ERROR__${payload}`);
}

test("没有借来连接时说明当前不是连接型页面", async () => {
  const app = await open(
    "./App.tsx",
    page({
      "navop.context.current": () => ({ extensionId: "com.example.shell-view-example", viewId: "tool", backends: [], connection: null }),
      "navop.log.info": () => null,
    }),
  );
  await app.waitFor("text:页面上下文");
  await app.waitFor("text:当前页面不是连接型 shell view，没有借来的连接。可以在下面的「打开资源」里用后端别名自己打开一个资源。");
});

test("打开资源后可以调用方法并展示结果", async () => {
  const seen: string[] = [];
  const app = await open(
    "./App.tsx",
    page({
      "navop.context.current": () => ({ extensionId: "com.example.shell-view-example", viewId: "tool", backends: ["demo"], connection: null }),
      "navop.log.info": () => null,
      "navop.resource.open": (data) => {
        seen.push(JSON.stringify(data));
        return { handle: "res-1", capabilities: ["item.list"], metadata: null };
      },
      "navop.resource.invoke": (data) => {
        seen.push(JSON.stringify(data));
        return { kind: "inline", value: { items: [{ id: 1, name: "demo" }] } };
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
  expect(text.includes("item.list")).toBe(true);
  expect(seen.some((item) => item.includes('"handle":"res-1"'))).toBe(true);
});

test("借用连接展示上下文并可直接调用", async () => {
  let invokedHandle = "";
  const app = await open(
    "./App.tsx",
    page({
      "navop.context.current": () => ({
        extensionId: "com.example.shell-view-example",
        viewId: "tool",
        backends: ["demo"],
        connection: {
          connectionId: "c1",
          name: "本地 Demo",
          contributionId: "demo-connection",
          resourceType: "demo",
          resourceHandle: "conn-1",
          alias: "demo",
        },
      }),
      "navop.log.info": () => null,
      "navop.resource.invoke": (data) => {
        invokedHandle = (data as { handle: string }).handle;
        return { kind: "inline", value: { borrowed: true } };
      },
    }),
  );
  await app.waitFor("text:本地 Demo");
  await app.press("用借用资源调用");
  await app.waitFor("text:借用资源调用成功（demo/list）。");
  expect(invokedHandle).toBe("conn-1");
});

test("打开资源失败时显示宿主错误码", async () => {
  const app = await open(
    "./App.tsx",
    page({
      "navop.context.current": () => ({ extensionId: "com.example.shell-view-example", viewId: "tool", backends: ["demo"], connection: null }),
      "navop.log.info": () => null,
      "navop.resource.open": () => {
        throw hostError("BACKEND_NOT_FOUND", "unknown backend alias `demo`");
      },
    }),
  );
  await app.waitFor("text:页面上下文");
  await app.press("打开资源");
  await app.waitFor("text:BACKEND_NOT_FOUND：unknown backend alias `demo`");
});

test("没有句柄时调用提示 NO_HANDLE", async () => {
  const app = await open(
    "./App.tsx",
    page({
      "navop.context.current": () => ({ extensionId: "com.example.shell-view-example", viewId: "tool", backends: [], connection: null }),
      "navop.log.info": () => null,
    }),
  );
  await app.waitFor("text:页面上下文");
  await app.press("调用当前句柄");
  await app.waitFor("text:NO_HANDLE：还没有打开的句柄：先在上面「打开资源」，或使用借来的连接。");
});
