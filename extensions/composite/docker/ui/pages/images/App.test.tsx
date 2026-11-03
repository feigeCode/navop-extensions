import { expect, open, test } from "nsh/test";
import { hostHandlers } from "../../lib/test-host";

const alpine = {
  name: "alpine:3.20",
  remove_target: "alpine:3.20",
  id: "9c6f1b0a2d31",
  tags: ["alpine:3.20", "alpine:latest"],
  tag_count: 2,
  dangling: false,
  created: "2026-01-02T03:04:05Z",
  created_epoch: 1767006245,
  size: "7.8 MB",
  size_mb: 7,
};

const dangling = {
  name: "<none>",
  remove_target: "sha256:deadbeef",
  id: "deadbeefcafe",
  tags: [],
  tag_count: 0,
  dangling: true,
  created: "2026-01-03T04:05:06Z",
  created_epoch: 1767077106,
  size: "12.0 MB",
  size_mb: 12,
};

function handlers(byMethod: Record<string, (params: Record<string, unknown>) => unknown> = {}) {
  return hostHandlers({
    "docker/image/list": () => ({ images: [alpine, dangling] }),
    "docker/image/inspect": (params) => ({
      Id: "sha256:9c6f1b0a2d31",
      Architecture: "arm64",
      Os: "linux",
      Config: { Env: ["PATH=/usr/bin"], WorkingDir: "/app", ExposedPorts: { "8080/tcp": {} } },
      RepoTags: ["alpine:3.20"],
      name: params.name,
    }),
    "docker/image/history": () => ({
      name: "alpine:3.20",
      history: [
        {
          id: "abc123",
          created: "2026-01-02T03:04:05Z",
          created_by: "ADD alpine-rootfs.tar / # buildkit",
          size_bytes: 8183808,
          size: "7.8 MB",
          comment: "",
          tags: ["alpine:3.20"],
        },
      ],
    }),
    "docker/image/remove": () => ({ deleted: "alpine:3.20" }),
    "docker/image/prune": () => ({ deleted: [], space_reclaimed_bytes: 2_147_483_648 }),
    "docker/image/pull": () => ({ action: "pulled" }),
    "docker/image/tag": () => ({ action: "tagged" }),
    ...byMethod,
  });
}

test("列表与详情", async () => {
  const app = await open("./App.tsx", { width: 1100, height: 800, host: { handlers: handlers() } });
  await app.waitFor("text:alpine:3.20");
  expect(app.texts()).toContain("镜像");
  expect(app.texts()).toContain("2 个本地");
  await app.waitFor("text:层历史");
  const texts = app.texts().join(" ");
  expect(texts).toContain("ADD alpine-rootfs.tar / # buildkit");
  expect(texts).toContain("悬空");
  expect(texts).toContain("9c6f1b0a2d31");
});

test("删除走二次确认", async () => {
  let removed: unknown = null;
  const app = await open("./App.tsx", {
    width: 1100,
    height: 800,
    host: {
      handlers: handlers({
        "docker/image/remove": (params) => {
          removed = params.name;
          return { deleted: params.name };
        },
      }),
    },
  });
  await app.waitFor("text:alpine:3.20");
  await app.press("删除镜像");
  await app.waitFor("text:删除镜像 alpine:3.20？此操作不可撤销。");
  await app.press("label:删除");
  await app.wait(200);
  expect(removed).toBe("alpine:3.20");
});

test("清理悬空镜像", async () => {
  let pruned = false;
  let pruneParams: Record<string, unknown> | null = null;
  const app = await open("./App.tsx", {
    width: 1100,
    height: 800,
    host: {
      handlers: handlers({
        "docker/image/prune": (params) => {
          pruned = true;
          pruneParams = params;
          return { deleted: [], space_reclaimed_bytes: 2_147_483_648 };
        },
      }),
    },
  });
  await app.waitFor("text:alpine:3.20");
  await app.press("清理悬空");
  await app.waitFor("text:清理所有悬空镜像与未使用层？");
  await app.press("清理");
  await app.wait(200);
  expect(pruned).toBe(true);
  expect(pruneParams).toEqual({ all: false });
});

test("拉取镜像按 repo:tag 拆分参数", async () => {
  const pulls: unknown[] = [];
  const app = await open("./App.tsx", {
    width: 1100,
    height: 800,
    host: {
      handlers: handlers({
        "docker/image/pull": (params) => {
          pulls.push(params);
          return { action: "pulled" };
        },
      }),
    },
  });
  await app.waitFor("text:alpine:3.20");
  await app.press("拉取镜像");
  await app.type("text:repo/name:tag", "acme/api:1.4");
  await app.press("拉取");
  await app.wait(200);
  expect(pulls).toEqual([{ image: "acme/api", tag: "1.4" }]);
});

test("搜索过滤", async () => {
  const app = await open("./App.tsx", { width: 1100, height: 800, host: { handlers: handlers() } });
  await app.waitFor("text:alpine:3.20");
  await app.type("按名称 / ID / 标签过滤", "deadbeef");
  await app.wait(200);
  const texts = app.texts().join(" ");
  // 过滤后列表只剩悬空镜像那一行（计数改成「匹配 1 / 共 2」）。
  expect(texts).toContain("匹配 1 / 共 2");
  expect(texts).toContain("0 个标签 · 12.0 MB · 01-03 12:05");
});
