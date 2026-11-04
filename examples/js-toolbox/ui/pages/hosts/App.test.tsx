import { expect, open, test } from "nsh/test";

// 真实读 /etc/hosts：测试跑在桌面平台上，nsh 测试引擎才会打开原生文件系统。
const params = {
  apiVersion: 2,
  extension: { id: "com.navop.tools.js-toolbox", title: "JS Toolbox" },
  route: "hosts",
  backends: [] as string[],
  connection: null,
};
const desktop = { platform: "macos" as const, width: 1100, height: 800, host: { params, handlers: {} } };

test("读取真实 hosts 文件并列出条目", async () => {
  const app = await open("../../App.tsx", desktop);
  await app.waitFor("text:主机条目");
  const texts = app.texts();
  expect(texts).toContain("Hosts 编辑器");
  expect(texts).toContain("/etc/hosts");
  // 任何 macOS / Linux 的 /etc/hosts 都有的回环地址与 localhost。
  expect(texts.join(" ")).toContain("localhost");
  expect(texts.join(" ")).toContain("127.0.0.1");
});

test("过滤无匹配时给出空态说明", async () => {
  const app = await open("../../App.tsx", desktop);
  await app.waitFor("text:主机条目");
  await app.type("按 IP / 主机名过滤", "zzz");
  await app.waitFor("text:没有匹配的条目");
  await app.waitFor("text:清空搜索词，或换一个 IP / 主机名再试。");
});

test("过滤命中 localhost", async () => {
  const app = await open("../../App.tsx", desktop);
  await app.waitFor("text:主机条目");
  await app.type("按 IP / 主机名过滤", "localhost");
  await app.waitFor("text:127.0.0.1");
});

test("新增条目先入列表，保存前二次确认", async () => {
  const app = await open("../../App.tsx", desktop);
  await app.waitFor("text:主机条目");
  await app.press("新增条目");
  await app.type("IP，如 127.0.0.1", "10.0.0.9");
  await app.type("主机名，多个用空格分隔", "api.local");
  await app.press("加入列表");
  await app.waitFor("text:已添加 10.0.0.9 api.local，点「保存」写入文件。");
  expect(app.texts()).toContain("api.local");
  await app.press("label:保存");
  await app.waitFor("label:写入");
  await app.press("取消");
  expect(app.texts().some((text) => text.includes("写回 /etc/hosts？"))).toBe(false);
});

test("禁用条目会变成停用状态", async () => {
  const app = await open("../../App.tsx", desktop);
  await app.waitFor("text:主机条目");
  await app.press("label:禁用 >> nth=0");
  await app.waitFor("text:有未保存修改");
  expect(app.texts()).toContain("启用");
});

test("新增条目要求合法 IP", async () => {
  const app = await open("../../App.tsx", desktop);
  await app.waitFor("text:主机条目");
  await app.press("新增条目");
  await app.type("IP，如 127.0.0.1", "not-an-ip");
  await app.type("主机名，多个用空格分隔", "api.local");
  await app.press("加入列表");
  await app.waitFor("text:「not-an-ip」不像 IPv4 / IPv6 地址。");
});
