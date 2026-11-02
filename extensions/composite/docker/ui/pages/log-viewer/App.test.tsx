// 临时自测（交付前删除）：验证三态、档位切换、自动刷新与清屏。
import { expect, open, test } from "nsh/test";

const LOGS = Array.from({ length: 12 }, (_, i) => `line-${i}`).join("\n") + "\n";

test("logs: 首次加载与档位切换", async () => {
  const app = await open("./App.tsx", {
    host: { handlers: { "navop.workbench.dispatch": () => ({ id: "abc", tail: "500", logs: LOGS }) } },
  });
  await app.waitFor("text:显示最后 12 行");
  expect(app.texts()).toContain("容器日志");
  expect(app.texts().some((t) => t.includes("line-11"))).toBe(true);
  expect(app.texts()).toContain("tail 500");
  const first = app.host.calls()[0];
  expect(first.name).toBe("navop.workbench.dispatch");
  expect(first.data).toEqual({ operationId: "containerLogsWithTail", input: { tail: "500" } });

  await app.press("行数 100");
  expect(app.host.calls().length).toBe(2);
  expect(app.host.calls()[1].data).toEqual({ operationId: "containerLogsWithTail", input: { tail: "100" } });
  expect(app.texts()).toContain("tail 100");

  await app.press("行数 全部");
  expect(app.host.calls()[2].data).toEqual({ operationId: "containerLogsWithTail", input: { tail: "5000" } });
  expect(app.texts()).toContain("tail 全部（provider 上限 5000）");
});

test("logs: 自动刷新 2 秒一次，可关闭", async () => {
  const app = await open("./App.tsx", {
    clock: {},
    host: { handlers: { "navop.workbench.dispatch": () => ({ id: "abc", tail: "500", logs: LOGS }) } },
  });
  await app.waitFor("text:显示最后 12 行");
  expect(app.host.calls().length).toBe(1);

  await app.press("自动刷新");
  await app.wait(4500);
  expect(app.host.calls().length).toBe(3); // 0s + 2s + 4s

  await app.press("自动刷新");
  await app.wait(4500);
  expect(app.host.calls().length).toBe(3); // 关闭后不再增长
});

test("logs: 清屏后显示空态", async () => {
  const app = await open("./App.tsx", {
    host: { handlers: { "navop.workbench.dispatch": () => ({ id: "abc", tail: "500", logs: LOGS }) } },
  });
  await app.waitFor("text:显示最后 12 行");
  await app.press("清屏");
  expect(app.texts()).toContain("已清屏");
  expect(app.texts().some((t) => t.includes("line-11"))).toBe(false);
});

test("logs: 首次失败显示错误与重试，重试成功", async () => {
  let fail = true;
  const app = await open("./App.tsx", {
    host: {
      handlers: {
        "navop.workbench.dispatch": () => {
          if (fail) throw new Error("容器未选中：缺少 selection");
          return { id: "abc", tail: "500", logs: LOGS };
        },
      },
    },
  });
  await app.waitFor("text:加载失败：容器未选中：缺少 selection");
  fail = false;
  await app.press("重试");
  await app.waitFor("text:显示最后 12 行");
});

test("logs: 空日志显示暂无日志", async () => {
  const app = await open("./App.tsx", {
    host: { handlers: { "navop.workbench.dispatch": () => ({ id: "abc", tail: "500", logs: "" }) } },
  });
  await app.waitFor("text:暂无日志");
});

test("logs: 只渲染末尾 2000 行并标注省略", async () => {
  const big = Array.from({ length: 5000 }, (_, i) => `L${i}`).join("\n");
  const app = await open("./App.tsx", {
    host: { handlers: { "navop.workbench.dispatch": () => ({ logs: big }) } },
  });
  await app.waitFor("text:显示最后 2000 行（共 5000 行，已省略前 3000 行）");
  const block = app.texts().find((t) => t.includes("L4999"));
  expect(block?.startsWith("L3000")).toBe(true);
});
