// 设计预览用的假 docker（只在 `nsh run --target web preview/App.tsx` / `nsh test --target web`
// 下生效）：把宿主的 `host.params` 与 `host.call` 就地替换掉，页面代码一行不改。
//
// 真实页面的 `invoke()` 走 `host.call("navop.resource.invoke")`，这里按 method 回放同一批
// fixture，所以预览里看到的列表、详情、统计和真实连接下走的是同一条渲染路径。
import { host } from "nsh";
import { params } from "../lib/navop";

type Row = {
  id: string;
  name: string;
  image: string;
  state: "running" | "exited" | "paused" | "created";
  status: string;
  ports: string;
  created: string;
  created_epoch: number;
};

const ROWS: Row[] = [
  {
    id: "9f2c71d4a0b8",
    name: "emqx-local",
    image: "emqx/emqx:5.8",
    state: "running",
    status: "Up 3 hours",
    ports: "0.0.0.0:1883->1883/tcp, 0.0.0.0:8083->8083/tcp",
    created: "2026-09-12 12:31",
    created_epoch: 1,
  },
  {
    id: "es-local",
    name: "es-local",
    image: "docker.elastic.co/elasticsearch/elasticsearch:9.1.0",
    state: "running",
    status: "Up 2 days (healthy)",
    ports: "0.0.0.0:9200->9200/tcp",
    created: "2026-09-10 11:08",
    created_epoch: 2,
  },
  {
    id: "rocketmq-broker",
    name: "rocketmq-broker",
    image: "apache/rocketmq:5.3.1",
    state: "exited",
    status: "Exited (137) 7 weeks ago",
    ports: "10909/tcp, 10911/tcp",
    created: "2026-09-12 04:31",
    created_epoch: 3,
  },
  {
    id: "headroom",
    name: "headroom",
    image: "ghcr.io/chopratejas/headroom:code",
    state: "exited",
    status: "Exited (0) 7 weeks ago",
    ports: "",
    created: "2026-09-05 01:24",
    created_epoch: 4,
  },
  {
    id: "buildx_buildkit_codex",
    name: "buildx_buildkit_codex-comi-note-multiarch0",
    image: "moby/buildkit:buildx-stable-1",
    state: "exited",
    status: "Exited (1) 6 weeks ago",
    ports: "",
    created: "2026-09-24 06:05",
    created_epoch: 5,
  },
  {
    id: "redis-dev",
    name: "redis-dev",
    image: "redis:7.4-alpine",
    state: "paused",
    status: "Up 5 minutes (Paused)",
    ports: "0.0.0.0:6379->6379/tcp",
    created: "2026-11-06 14:52",
    created_epoch: 6,
  },
];

function inspectOf(row: Row): Record<string, unknown> {
  const running = row.state === "running";
  return {
    Id: `${row.id}0123456789abcdef0123456789abcdef0123456789abcdef`,
    Name: `/${row.name}`,
    Image: `sha256:${row.id}`,
    Created: "2026-09-12T04:31:00Z",
    State: {
      Status: row.state,
      Running: running,
      Paused: row.state === "paused",
      ExitCode: 0,
      RestartCount: 0,
      StartedAt: "2026-11-06T12:10:00Z",
      FinishedAt: running ? "" : "2026-09-27T15:07:30Z",
      Health: { Status: "healthy" },
    },
    Config: {
      Image: row.image,
      Cmd: ["/opt/emqx/bin/emqx", "foreground"],
      Env: [
        "EMQX_DASHBOARD__DEFAULT_PASSWORD=public",
        "EMQX_NODE__NAME=emqx@node1.navop-middleware",
        "EMQX_LISTENERS__TCP__DEFAULT__BIND=0.0.0.0:1883",
        "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      ],
      Labels: {
        "com.docker.compose.project": "navop-middleware",
        "com.docker.compose.service": "emqx",
        "org.opencontainers.image.version": "5.8.4",
        "org.opencontainers.image.title": "EMQX",
      },
    },
    HostConfig: { RestartPolicy: { Name: "unless-stopped", MaximumRetryCount: 0 } },
    Mounts: [
      {
        Type: "volume",
        Source: "navop-middleware_emqx-data",
        Destination: "/opt/emqx/data",
        RW: true,
      },
      {
        Type: "bind",
        Source: "/Users/hufei/navop-compose/emqx/log",
        Destination: "/opt/emqx/log",
        RW: true,
      },
    ],
    NetworkSettings: {
      Ports: {
        "1883/tcp": [{ HostIp: "0.0.0.0", HostPort: "1883" }],
        "8083/tcp": [{ HostIp: "0.0.0.0", HostPort: "8083" }],
        "18083/tcp": [{ HostIp: "127.0.0.1", HostPort: "18083" }],
        "4370/tcp": null,
      },
      Networks: {
        "navop-middleware": {
          IPAddress: "172.19.0.12",
          Gateway: "172.19.0.1",
          MacAddress: "02:42:ac:13:00:0c",
        },
      },
    },
  };
}

function find(id: unknown): Row | undefined {
  return ROWS.find((row) => row.id === id);
}

const WORLD: Record<string, (input: Record<string, unknown>) => unknown> = {
  "docker/container/list": () => ({ containers: ROWS }),
  "docker/container/inspect": (input) => inspectOf(find(input.id) ?? ROWS[0]),
  "docker/container/top": () => ({
    titles: ["UID", "PID", "PPID", "CMD"],
    processes: [
      { UID: "root", PID: "1", PPID: "0", CMD: "/opt/emqx/bin/emqx foreground" },
      { UID: "emqx", PID: "42", PPID: "1", CMD: "/opt/emqx/bin/beam.smp -- -root /opt/emqx" },
      { UID: "emqx", PID: "57", PPID: "42", CMD: "erl_child_setup 65536" },
    ],
  }),
  "docker/container/files/list": (input) => {
    const target = typeof input.path === "string" && input.path.length > 0 ? input.path : "/";
    const entries: Array<Record<string, string>> = [];
    if (target !== "/") {
      const at = target.replace(/\/$/, "").lastIndexOf("/");
      entries.push({
        name: "..",
        type: "directory",
        size: "-",
        modified: "-",
        path: at <= 0 ? "/" : target.slice(0, at),
      });
    }
    if (target === "/") {
      entries.push(
        { name: "bin", type: "directory", size: "-", modified: "-", path: "/bin" },
        { name: "etc", type: "directory", size: "-", modified: "-", path: "/etc" },
        { name: "opt", type: "directory", size: "-", modified: "-", path: "/opt" },
        { name: "tmp", type: "directory", size: "-", modified: "-", path: "/tmp" },
        { name: "usr", type: "directory", size: "-", modified: "-", path: "/usr" },
        { name: "var", type: "directory", size: "-", modified: "-", path: "/var" },
        { name: ".dockerenv", type: "file", size: "0 B", modified: "2026-09-12 12:31", path: "/.dockerenv" },
      );
    } else if (target === "/opt") {
      entries.push(
        { name: "emqx", type: "directory", size: "-", modified: "-", path: "/opt/emqx" },
        { name: "emqx.tar.gz", type: "file", size: "48.2 MiB", modified: "2026-09-12 12:31", path: "/opt/emqx.tar.gz" },
      );
    } else if (target === "/opt/emqx") {
      entries.push(
        { name: "bin", type: "directory", size: "-", modified: "-", path: "/opt/emqx/bin" },
        { name: "data", type: "directory", size: "-", modified: "-", path: "/opt/emqx/data" },
        { name: "etc", type: "directory", size: "-", modified: "-", path: "/opt/emqx/etc" },
        { name: "log", type: "directory", size: "-", modified: "-", path: "/opt/emqx/log" },
        { name: "LICENSE", type: "file", size: "11.2 KiB", modified: "2026-09-12 12:31", path: "/opt/emqx/LICENSE" },
      );
    } else {
      entries.push(
        { name: "sub", type: "directory", size: "-", modified: "-", path: `${target}/sub` },
        { name: "README.md", type: "file", size: "2.4 KiB", modified: "2026-09-12 12:31", path: `${target}/README.md` },
      );
    }
    return { id: input.id, path: target, entries };
  },
  "docker/container/diff": () => ({
    changes: [
      { path: "/opt/emqx/data/mnesia", kind: "changed" },
      { path: "/opt/emqx/log", kind: "changed" },
      { path: "/tmp/emqx.pid", kind: "added" },
    ],
  }),
  "docker/container/mounts": () => ({
    mounts: [
      { type: "volume", name: "navop-middleware_emqx-data", source: "/opt/emqx/data", destination: "/opt/emqx/data", rw: true },
      { type: "bind", source: "/Users/hufei/navop-compose/emqx/log", destination: "/opt/emqx/log", rw: true },
    ],
  }),
  "docker/container/stats": (input) =>
    find(input.id)?.state === "running"
      ? {
          cpu_percent: 0.42,
          memory_usage_bytes: 268_435_456,
          memory_limit_bytes: 2_147_483_648,
          online_cpus: 8,
        }
      : {},
  "docker/container/start": (input) => {
    const row = find(input.id);
    if (row) {
      row.state = "running";
      row.status = "Up less than a second";
    }
    return null;
  },
  "docker/container/stop": (input) => {
    const row = find(input.id);
    if (row) {
      row.state = "exited";
      row.status = "Exited (0) less than a second ago";
    }
    return null;
  },
};

/** 装好假宿主。模块级调用一次：必须在页面模块求值前完成（import 顺序见 preview/App.tsx）。 */
export function install(route: string): void {
  Object.assign(params, {
    apiVersion: 2,
    extension: { id: "com.navop.docker", title: "Docker" },
    route,
    backends: ["docker"],
    connection: {
      connectionId: 1,
      name: "本地 Docker",
      contributionId: "docker-local",
      resourceType: "docker",
      resourceHandle: "r-1",
      alias: "main",
      config: {},
    },
  });
  const patched = host as unknown as {
    params: unknown;
    call: (name: string, args: unknown) => Promise<unknown>;
  };
  patched.call = async (name: string, args: unknown) => {
    if (name !== "navop.resource.invoke") return null;
    const call = args as { method?: string; params?: Record<string, unknown> };
    const handler = WORLD[call.method ?? ""];
    if (!handler) throw new Error(`预览没有为 \`${call.method}\` 配置假数据`);
    return handler(call.params ?? {});
  };
}

// 预览默认停在容器页。
install("containers");
