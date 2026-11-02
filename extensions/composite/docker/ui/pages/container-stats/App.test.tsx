import { expect, open, test } from "nsh/test";

type Call = { operationId: string };

function handlers(stats: () => unknown) {
  return {
    "navop.workbench.dispatch": (data: unknown) => {
      const call = data as Call;
      if (call.operationId === "containerStats") return stats();
      throw new Error(`unexpected operation: ${call.operationId}`);
    },
  };
}

const SAMPLE = {
  id: "c1",
  cpu_percent: 12.5,
  memory_usage_bytes: 2048,
  memory_limit_bytes: 8192,
  online_cpus: 4,
};

test("渲染 CPU、内存与采样时间", async () => {
  const app = await open("./App.tsx", { host: { handlers: handlers(() => SAMPLE) } });
  expect(app.texts()).toContain("资源占用");
  expect(app.texts()).toContain("12.5%");
  expect(app.texts()).toContain("2.0 KB");
  expect(app.texts()).toContain("上限 8.0 KB");
  expect(app.texts()).toContain("25.0%");
  expect(app.texts()).toContain("内存占用");
  expect(app.texts()).toContain("2.0 KB / 8.0 KB");
  expect(app.texts()).toContain("采样时间");
  // 工具条上的采样时刻徽标。
  expect(app.texts().filter((text) => /^采样 \d{2}:\d{2}:\d{2}$/.test(text)).length).toBe(1);
  // 网络与块 IO 位置存在，但明确标注宿主未提供。
  expect(app.texts().filter((text) => text === "网络收发").length).toBe(1);
  expect(app.texts().filter((text) => text === "块 IO").length).toBe(1);
  expect(app.texts().filter((text) => text === "宿主未提供").length).toBe(2);
  expect(app.texts().filter((text) => text === "—").length).toBe(4);
});

test("刷新后 CPU 与内存数字更新", async () => {
  let cpu = 1;
  let used = 1024;
  const app = await open("./App.tsx", {
    host: {
      handlers: handlers(() => ({
        id: "c1",
        cpu_percent: cpu,
        memory_usage_bytes: used,
        memory_limit_bytes: 8192,
        online_cpus: 2,
      })),
    },
  });
  expect(app.texts()).toContain("1.0%");
  expect(app.texts()).toContain("1.0 KB");
  cpu = 88.8;
  used = 4096;
  await app.press("刷新");
  expect(app.texts()).toContain("88.8%");
  expect(app.texts()).toContain("4.0 KB");
  expect(app.texts()).not.toContain("1.0%");
});

test("空采样给出解释", async () => {
  const app = await open("./App.tsx", { host: { handlers: handlers(() => ({})) } });
  expect(app.texts()).toContain("没有可用的采样");
  expect(app.texts()).toContain("重新采样");
});

test("失败态显示错误并可重试", async () => {
  let fail = true;
  const app = await open("./App.tsx", {
    host: {
      handlers: handlers(() => {
        if (fail) throw new Error("container is not running");
        return SAMPLE;
      }),
    },
  });
  expect(app.texts().join(" ")).toContain("container is not running");
  fail = false;
  await app.press("重试");
  expect(app.texts()).toContain("12.5%");
});
