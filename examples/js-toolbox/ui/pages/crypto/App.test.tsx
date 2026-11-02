import { expect, open, test } from "nsh/test";

const page = { width: 1100, height: 800, host: { handlers: {} } };
const PLACEHOLDER = "例如 hello，或粘贴一段 Base64";

test("计算 SHA-256 摘要", async () => {
  const app = await open("./App.tsx", page);
  await app.waitFor("text:操作");
  await app.type(PLACEHOLDER, "hello");
  await app.press("计算摘要");
  await app.waitFor("text:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  expect(app.texts()).toContain("SHA256 摘要");
});

test("切换算法后摘要跟着变", async () => {
  const app = await open("./App.tsx", page);
  await app.waitFor("text:操作");
  await app.type(PLACEHOLDER, "hello");
  await app.press("md5");
  await app.press("计算摘要");
  await app.waitFor("text:5d41402abc4b2a76b9719d911017c592");
});

test("Base64 编码", async () => {
  const app = await open("./App.tsx", page);
  await app.waitFor("text:操作");
  await app.type(PLACEHOLDER, "hello");
  await app.press("Base64 编码");
  await app.waitFor("text:aGVsbG8=");
});

test("Base64 解码非 ASCII 文本", async () => {
  const app = await open("./App.tsx", page);
  await app.waitFor("text:操作");
  await app.type(PLACEHOLDER, "aMOp");
  await app.press("Base64 解码");
  await app.waitFor("text:hé");
});

test("非法 Base64 立即报错", async () => {
  const app = await open("./App.tsx", page);
  await app.waitFor("text:操作");
  await app.type(PLACEHOLDER, "not base64!!");
  await app.press("Base64 解码");
  await app.waitFor("text:不是合法的 Base64 文本：只接受标准字母表（A-Z a-z 0-9 + /）与结尾的 = 补位。");
});

test("生成 UUID 并显示 v4 格式", async () => {
  const app = await open("./App.tsx", page);
  await app.waitFor("text:操作");
  await app.press("生成 UUID");
  await app.waitFor("text:随机 UUID（v4）");
  const joined = app.texts().join(" ");
  expect(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/.test(joined)).toBe(true);
});
