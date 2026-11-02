import { expect, open, test } from "nsh/test";

type Call = { operationId: string };

function handlers(mounts: () => unknown) {
  return {
    "navop.workbench.dispatch": (data: unknown) => {
      const call = data as Call;
      if (call.operationId === "containerMounts") return mounts();
      throw new Error(`unexpected operation: ${call.operationId}`);
    },
  };
}

const SAMPLE = [
  {
    Type: "bind",
    Name: "",
    Source: "/Users/me/app",
    Destination: "/app",
    Mode: "rw",
    RW: true,
  },
  {
    Type: "volume",
    Name: "pgdata",
    Source: "/var/lib/docker/volumes/pgdata/_data",
    Destination: "/var/lib/postgresql/data",
    Mode: "ro",
    RW: false,
  },
  {
    Type: "tmpfs",
    Name: "",
    Source: "",
    Destination: "/tmp",
    Mode: "rw",
    RW: true,
  },
];

test("挂载列表渲染类型、只读标记与源/目标路径", async () => {
  const app = await open("./App.tsx", { host: { handlers: handlers(() => ({ id: "c1", mounts: SAMPLE })) } });
  expect(app.texts()).toContain("挂载");
  expect(app.texts()).toContain("3 个挂载");
  expect(app.texts()).toContain("只读 1");
  expect(app.texts()).toContain("bind");
  expect(app.texts()).toContain("volume");
  expect(app.texts()).toContain("tmpfs");
  expect(app.texts()).toContain("/Users/me/app");
  expect(app.texts()).toContain("/app");
  expect(app.texts()).toContain("名称 pgdata");
  expect(app.texts()).toContain("/var/lib/postgresql/data");
  expect(app.texts()).toContain("源");
  expect(app.texts()).toContain("目标");
  // 两条可写 + 一条只读。
  expect(app.texts().filter((text) => text === "只读").length).toBe(1);
  expect(app.texts().filter((text) => text === "可写").length).toBe(2);
});

test("RW=true 但 Mode=ro 仍按只读处理", async () => {
  const app = await open("./App.tsx", {
    host: {
      handlers: handlers(() => ({
        mounts: [{ Type: "bind", Source: "/etc/hosts", Destination: "/etc/hosts", Mode: "ro", RW: true }],
      })),
    },
  });
  expect(app.texts()).toContain("只读 1");
  expect(app.texts()).toContain("只读");
});

test("空挂载给出解释", async () => {
  const app = await open("./App.tsx", { host: { handlers: handlers(() => ({ mounts: [] })) } });
  expect(app.texts()).toContain("容器没有挂载");
  expect(app.texts().join(" ")).toContain("bind / volume / tmpfs");
});

test("失败态显示错误并可重试", async () => {
  let fail = true;
  const app = await open("./App.tsx", {
    host: {
      handlers: handlers(() => {
        if (fail) throw new Error("permission denied while inspecting container");
        return { mounts: SAMPLE };
      }),
    },
  });
  expect(app.texts().join(" ")).toContain("permission denied while inspecting container");
  fail = false;
  await app.press("重试");
  expect(app.texts()).toContain("3 个挂载");
});
