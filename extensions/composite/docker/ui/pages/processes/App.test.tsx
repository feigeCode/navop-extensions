import { expect, open, test } from "nsh/test";

type Call = { operationId: string };

/** 工作台 dispatch 的假实现：按 operationId 返回 provider 形状的数据。 */
function handlers(top: () => unknown, stats: () => unknown) {
  return {
    "navop.workbench.dispatch": (data: unknown) => {
      const call = data as Call;
      if (call.operationId === "containerTop") return top();
      if (call.operationId === "containerStats") return stats();
      throw new Error(`unexpected operation: ${call.operationId}`);
    },
  };
}

test("进程表按 titles 渲染，工具条带容器占用", async () => {
  const app = await open("./App.tsx", {
    host: {
      handlers: handlers(
        () => ({
          id: "c1",
          titles: ["UID", "PID", "CMD"],
          processes: [
            { UID: "root", PID: "1", CMD: "nginx -g daemon off;" },
            { UID: "www", PID: "42", CMD: "php-fpm" },
          ],
        }),
        () => ({
          id: "c1",
          cpu_percent: 12.5,
          memory_usage_bytes: 2048,
          memory_limit_bytes: 8192,
          online_cpus: 4,
        }),
      ),
    },
  });
  expect(app.texts()).toContain("进程");
  expect(app.texts()).toContain("2 个进程");
  expect(app.texts()).toContain("UID");
  expect(app.texts()).toContain("PID");
  expect(app.texts()).toContain("nginx -g daemon off;");
  expect(app.texts()).toContain("php-fpm");
  // 容器整体占用来自副数据源 containerStats。
  expect(app.texts().join(" ")).toContain("CPU 12.5%");
});

test("空进程列表给出解释", async () => {
  const app = await open("./App.tsx", {
    host: {
      handlers: handlers(
        () => ({ id: "c1", titles: [], processes: [] }),
        () => ({ id: "c1" }),
      ),
    },
  });
  expect(app.texts()).toContain("容器里没有可见的进程");
});

test("失败态显示错误并可重试", async () => {
  let fail = true;
  const app = await open("./App.tsx", {
    host: {
      handlers: handlers(
        () => {
          if (fail) throw new Error("docker daemon unavailable");
          return { id: "c1", titles: ["PID", "CMD"], processes: [{ PID: "7", CMD: "sleep 100" }] };
        },
        () => ({ id: "c1" }),
      ),
    },
  });
  expect(app.texts().join(" ")).toContain("docker daemon unavailable");
  fail = false;
  await app.press("重试");
  expect(app.texts()).toContain("sleep 100");
});

test("刷新后行数更新", async () => {
  let count = 1;
  const app = await open("./App.tsx", {
    host: {
      handlers: handlers(
        () => ({
          id: "c1",
          titles: ["PID", "CMD"],
          processes: Array.from({ length: count }, (_, index) => ({ PID: String(index + 1), CMD: `proc-${index + 1}` })),
        }),
        () => ({ id: "c1", cpu_percent: 1, memory_usage_bytes: 1024, memory_limit_bytes: 2048, online_cpus: 2 }),
      ),
    },
  });
  expect(app.texts()).toContain("1 个进程");
  count = 3;
  await app.press("刷新");
  expect(app.texts()).toContain("3 个进程");
  expect(app.texts()).toContain("proc-3");
});

test("调用不带容器 id，auX 列可显示 %CPU / %MEM", async () => {
  const inputs: unknown[] = [];
  const app = await open("./App.tsx", {
    host: {
      handlers: {
        "navop.workbench.dispatch": (data: unknown) => {
          const call = data as Call & { input?: unknown };
          if (call.operationId === "containerTop") {
            inputs.push(call.input);
            return {
              id: "c1",
              titles: ["USER", "PID", "%CPU", "%MEM", "COMMAND"],
              processes: [{ USER: "root", PID: "1", "%CPU": "0.5", "%MEM": "1.2", COMMAND: "nginx" }],
            };
          }
          return { id: "c1" };
        },
      },
    },
  });
  expect(app.texts()).toContain("%CPU");
  expect(app.texts()).toContain("0.5");
  expect(app.texts()).toContain("1.2");
  // 容器由宿主 route 决定，页面必须传空 input。
  expect(inputs.length).toBe(1);
  expect(Object.keys(inputs[0] as Record<string, unknown>).length).toBe(0);
});
