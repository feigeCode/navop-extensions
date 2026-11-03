import { expect, open, test } from "nsh/test";

const page = { width: 1100, height: 800, host: { handlers: {} } };
const PLACEHOLDER = '例如 {"name":"navop","tags":["nsh","tsx"]}';

function screen(app: Awaited<ReturnType<typeof open>>): string {
  return app.texts().join(" ");
}

test("格式化 JSON 输出两空格缩进", async () => {
  const app = await open("./App.tsx", page);
  await app.waitFor("text:输入");
  await app.type(PLACEHOLDER, '{"b":1,"a":[1,2]}');
  await app.press("格式化");
  await app.waitFor("text:格式化结果（缩进 2 空格）");
  const text = screen(app);
  expect(text.includes('"b": 1')).toBe(true);
  expect(text.includes('"a": [')).toBe(true);
});

test("切换 4 空格后缩进跟着变", async () => {
  const app = await open("./App.tsx", page);
  await app.waitFor("text:输入");
  await app.type(PLACEHOLDER, '{"b":1}');
  await app.press("4 空格");
  await app.press("格式化");
  await app.waitFor("text:格式化结果（缩进 4 空格）");
  expect(screen(app).includes('    "b": 1')).toBe(true);
});

test("压缩后结果只有一行", async () => {
  const app = await open("./App.tsx", page);
  await app.waitFor("text:输入");
  await app.type(PLACEHOLDER, '{"b": 1, "a": [1, 2]}');
  await app.press("压缩");
  await app.waitFor("text:压缩结果");
  expect(screen(app).includes('{"b":1,"a":[1,2]}')).toBe(true);
});

test("非法 JSON 立即给出错误位置", async () => {
  const app = await open("./App.tsx", page);
  await app.waitFor("text:输入");
  await app.type(PLACEHOLDER, '{"a": }');
  await app.press("格式化");
  const text = screen(app);
  expect(text.includes("JSON 解析失败")).toBe(true);
  expect(text.includes("第 1 行")).toBe(true);
});

test("转义后得到 JSON 字符串字面量", async () => {
  const app = await open("./App.tsx", page);
  await app.waitFor("text:输入");
  await app.type(PLACEHOLDER, 'a"b');
  await app.press("转义");
  await app.waitFor("text:转义结果");
  expect(screen(app).includes('"a\\"b"')).toBe(true);
});

test("反转义还原成纯文本", async () => {
  const app = await open("./App.tsx", page);
  await app.waitFor("text:输入");
  await app.type(PLACEHOLDER, '"a\\"b"');
  await app.press("反转义");
  await app.waitFor("text:反转义结果");
  expect(screen(app).includes('a"b')).toBe(true);
});

test("反转义非字符串时提示需要字符串字面量", async () => {
  const app = await open("./App.tsx", page);
  await app.waitFor("text:输入");
  await app.type(PLACEHOLDER, "123");
  await app.press("反转义");
  await app.waitFor("text:反转义需要一个 JSON 字符串字面量（以引号开头和结尾的文本）。");
});

test("清空后回到空态", async () => {
  const app = await open("./App.tsx", page);
  await app.waitFor("text:输入");
  await app.type(PLACEHOLDER, '{"a":1}');
  await app.press("格式化");
  await app.waitFor("text:格式化结果（缩进 2 空格）");
  await app.press("清空");
  await app.waitFor("text:还没有结果");
  expect(screen(app).includes('"a": 1')).toBe(false);
});
