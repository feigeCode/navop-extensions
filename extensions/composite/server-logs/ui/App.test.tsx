// 说明：headless 引擎不注册宿主的 `navop` UI set，终端数据面在这里不可达；
// Storage 是引擎自带能力，因此记录的增删改与持久化可以真实覆盖。
import { expect, open, test } from "nsh/test";
import { TEST_PARAMS, hostHandlers } from "./lib/test-host";
import { logCommand, normalizeRecord, parseRecords, recordValidationError, serializeRecords } from "./pages/logs/App";
import { shellQuote } from "./lib/server";

const SAMPLE = [
  { id: "log-1", name: "nginx 错误", path: "/var/log/nginx/error.log", lines: "200", filter: "" },
  { id: "log-2", name: "syslog", path: "/var/log/syslog", lines: "500", filter: "error" },
];

function openPanel(records = SAMPLE) {
  return open("./App.tsx", {
    width: 900,
    height: 560,
    host: {
      params: { ...TEST_PARAMS, surface: "panel", panel: "server-logs" },
      handlers: hostHandlers({}),
    },
    storage: { "records:default": JSON.stringify(records) },
  });
}

test("没有记录时引导用户新建，而不是给写死的路径", async () => {
  const app = await openPanel([]);
  await app.waitFor("text:为这台服务器添加日志文件");
  await app.press("label:新建记录");
  await app.waitFor("text:新建日志记录");
  await app.type("label:日志记录名称", "应用日志");
  await app.type("label:日志文件路径", "/var/log/app.log");
  await app.press("label:保存记录");
  await app.waitUntil(() => app.texts().some((text) => text.includes("/var/log/app.log · 200 行")));
  app.dispose();
});

test("已保存的记录渲染成可切换的条目", async () => {
  const app = await openPanel();
  await app.waitFor("text:服务器日志");
  expect(app.shows("label:nginx 错误")).toBe(true);
  expect(app.shows("label:syslog")).toBe(true);
  await app.press("label:syslog");
  await app.waitUntil(() => app.texts().some((text) => text.includes("/var/log/syslog · 500 行 · 过滤 error")));
  app.dispose();
});

test("可以编辑已有记录并保存", async () => {
  const app = await openPanel();
  await app.waitFor("label:编辑");
  await app.press("label:编辑");
  await app.waitFor("text:编辑日志记录");
  await app.clear("label:日志文件路径");
  await app.type("label:日志文件路径", "/var/log/nginx/access.log");
  await app.press("label:保存记录");
  await app.waitUntil(() => app.texts().some((text) => text.includes("/var/log/nginx/access.log · 200 行")));
  app.dispose();
});

test("删除记录后回到空态", async () => {
  const app = await openPanel([SAMPLE[0]]);
  await app.waitFor("label:删除");
  await app.press("label:删除");
  await app.waitFor("text:为这台服务器添加日志文件");
  app.dispose();
});

test("记录序列化往返，坏数据按空处理", () => {
  expect(parseRecords(serializeRecords(SAMPLE))).toEqual(SAMPLE);
  expect(parseRecords(null)).toEqual([]);
  expect(parseRecords("not-json")).toEqual([]);
  expect(parseRecords('{"a":1}')).toEqual([]);
  expect(parseRecords('[{"id":"x","path":"/a.log"}]')).toEqual([
    { id: "x", name: "/a.log", path: "/a.log", lines: "200", filter: "" },
  ]);
});

test("读回的行数同样收敛，篡改存储不会带进命令", () => {
  expect(parseRecords('[{"id":"x","path":"/a.log","lines":"99999"}]')[0].lines).toBe("5000");
  expect(parseRecords('[{"id":"x","path":"/a.log","lines":"200; rm -rf /"}]')[0].lines).toBe("200");
  expect(parseRecords('[{"id":"x","path":"/a.log","lines":""}]')[0].lines).toBe("200");
});

test("行数被规范化，路径必填由表单校验", () => {
  expect(normalizeRecord({ name: " a ", path: " /x.log ", lines: "99999", filter: "" }).lines).toBe("5000");
  expect(normalizeRecord({ name: "", path: "/x.log", lines: "abc", filter: "" })).toEqual({
    name: "/x.log",
    path: "/x.log",
    lines: "200",
    filter: "",
  });
});

test("路径必须绝对且同一服务器不能重复", () => {
  const draft = normalizeRecord({ name: "web", path: "/var/log/app.log", lines: "200", filter: "" });
  expect(recordValidationError(draft, [], "new")).toBe(null);
  expect(recordValidationError({ ...draft, path: "tmp/a.log" }, [], "new")).toContain("绝对路径");
  expect(recordValidationError(draft, [{ ...draft, id: "old" }], "new")).toContain("已经有记录");
  expect(recordValidationError(draft, [{ ...draft, id: "old" }], "old")).toBe(null);
});

test("日志正文使用只读 Editor，并接通高亮搜索和导航", async () => {
  const app = await openPanel();
  await app.waitFor("label:服务器日志正文编辑器");
  expect(app.shows("label:服务器日志正文编辑器")).toBe(true);
  await app.waitFor("text:（当前日志为空）");
  await app.press("label:.*");
  await app.type("label:搜索日志输出", "[");
  await app.waitFor("text:正则表达式无效");
  await app.press("label:.*");
  await app.clear("label:搜索日志输出");
  await app.type("label:搜索日志输出", "error");
  await app.waitFor("text:没有匹配");
  await app.press("label:Aa");
  await app.press("label:W");
  expect(app.shows("label:下一个匹配")).toBe(true);
  expect(app.shows("label:上一个匹配")).toBe(true);
  app.dispose();
});

test("logCommand 拼出过滤管道并转义单引号", () => {
  expect(logCommand("/var/log/syslog", "200", "")).toBe("tail -n 200 '/var/log/syslog'");
  expect(logCommand("/var/log/syslog", "500", "error")).toBe(
    "tail -n 500 '/var/log/syslog' | grep -i -F -- 'error'",
  );
  expect(logCommand("/tmp/it's.log", "100", "")).toBe("tail -n 100 '/tmp/it'\\''s.log'");
  expect(logCommand("/var/log/syslog", "200; rm -rf /", "")).toBe("tail -n 200 '/var/log/syslog'");
  expect(shellQuote("a'; rm -rf /; '")).toBe("'a'\\''; rm -rf /; '\\'''");
});
