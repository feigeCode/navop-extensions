// app 外壳的路由测试：入口是 ui/App.tsx，验证默认路由、启动路由、侧栏切换、
// 未知 route 回落，以及「工具箱 app 没有连接也照常渲染页面」（契约 §6）。
import { expect, open, test } from "nsh/test";

const params = {
  apiVersion: 2,
  extension: { id: "com.navop.tools.js-toolbox", title: "JS Toolbox" },
  route: "json",
  backends: [],
  connection: null,
};

/** 页面只会 post navop.log；外壳测试不关心日志。 */
const handlers = { "navop.log": () => null };

test("默认路由渲染 JSON 工具，侧栏列出三个工具", async () => {
  const app = await open("./App.tsx", {
    width: 1100,
    height: 800,
    host: { params, handlers },
  });
  await app.waitFor("text:格式化");
  expect(app.shows("text:Crypto 工具箱")).toBe(true);
  expect(app.shows("text:Hosts 编辑器")).toBe(true);
});

test("按 params.route 打开指定页面", async () => {
  const app = await open("./App.tsx", {
    width: 1100,
    height: 800,
    host: { params: { ...params, route: "crypto" }, handlers },
  });
  await app.waitFor("text:计算摘要");
  expect(app.shows("text:格式化")).toBe(false);
});

test("未知 route 回落默认路由", async () => {
  const app = await open("./App.tsx", {
    width: 1100,
    height: 800,
    host: { params: { ...params, route: "not-a-route" }, handlers },
  });
  await app.waitFor("text:格式化");
});

test("点侧栏切到另一个路由", async () => {
  const app = await open("./App.tsx", {
    width: 1100,
    height: 800,
    host: { params, handlers },
  });
  await app.waitFor("text:格式化");
  await app.press("text:Crypto 工具箱");
  await app.waitFor("text:计算摘要");
  expect(app.shows("text:格式化")).toBe(false);
});

test("工具箱 app 没有连接也照常渲染页面", async () => {
  // Hosts 页读真实 /etc/hosts，需要桌面平台才拿得到原生文件系统。
  const app = await open("./App.tsx", {
    platform: "macos" as const,
    width: 1100,
    height: 800,
    host: { params: { ...params, route: "hosts" }, handlers },
  });
  // `/etc/hosts` 里有 `/`，`text:` 选择器会当正则标志解析，所以用普通文本断言。
  await app.waitFor("text:主机条目");
  const texts = app.texts();
  expect(texts).toContain("/etc/hosts");
  expect(texts.some((text) => text.includes("请先打开一个"))).toBe(false);
});
