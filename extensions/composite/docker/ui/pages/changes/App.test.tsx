import { expect, open, test } from "nsh/test";

type Call = { operationId: string; input?: unknown };

function handlers(changes: () => unknown) {
  return {
    "navop.workbench.dispatch": (data: unknown) => {
      const call = data as Call;
      if (call.operationId === "containerDiff") return changes();
      throw new Error(`unexpected operation: ${call.operationId}`);
    },
  };
}

test("数字 Kind 映射为新增/修改/删除并拆分路径", async () => {
  const app = await open("./App.tsx", {
    host: {
      handlers: handlers(() => ({
        id: "c1",
        changes: [
          { Path: "/etc/nginx/nginx.conf", Kind: 0 },
          { Path: "/usr/local/bin/app", Kind: 1 },
          { Path: "/tmp/old.log", Kind: 2 },
        ],
      })),
    },
  });
  expect(app.texts()).toContain("文件变更");
  expect(app.texts()).toContain("3 项");
  expect(app.texts()).toContain("新增 1");
  expect(app.texts()).toContain("修改 1");
  expect(app.texts()).toContain("删除 1");
  expect(app.texts()).toContain("nginx.conf");
  expect(app.texts()).toContain("/etc/nginx");
  expect(app.texts()).toContain("old.log");
});

test("兼容小写 path/kind 与字母 Kind", async () => {
  const app = await open("./App.tsx", {
    host: {
      handlers: handlers(() => ({
        changes: [
          { path: "/srv/a.txt", kind: "A" },
          { path: "/srv/b.txt", kind: "D" },
        ],
      })),
    },
  });
  expect(app.texts()).toContain("2 项");
  expect(app.texts()).toContain("a.txt");
  expect(app.texts()).toContain("b.txt");
});

test("点击行后显示完整路径", async () => {
  const app = await open("./App.tsx", {
    host: {
      handlers: handlers(() => ({ changes: [{ Path: "/etc/nginx/nginx.conf", Kind: 1 }] })),
    },
  });
  expect(app.texts().join(" ")).toContain("点击任意一行查看完整路径");
  await app.press("nginx.conf");
  expect(app.texts()).toContain("完整路径");
  expect(app.texts()).toContain("/etc/nginx/nginx.conf");
  expect(app.texts().join(" ")).toContain("新增（Added）");
});

test("空变更与失败重试", async () => {
  const empty = await open("./App.tsx", { host: { handlers: handlers(() => ({ changes: [] })) } });
  expect(empty.texts()).toContain("可写层没有文件变更");

  let fail = true;
  const app = await open("./App.tsx", {
    host: {
      handlers: handlers(() => {
        if (fail) throw new Error("container not running");
        return { changes: [{ Path: "/root/.bashrc", Kind: 0 }] };
      }),
    },
  });
  expect(app.texts().join(" ")).toContain("container not running");
  fail = false;
  await app.press("重试");
  expect(app.texts()).toContain(".bashrc");
});
