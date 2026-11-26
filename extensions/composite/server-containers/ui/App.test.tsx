// 数据面（navop.terminal 的 UI set）在 headless 引擎里不可达，因此 UI 用例
// 覆盖外壳与路由，命令拼装 / 输出解析用纯函数用例覆盖。
import { expect, open, test } from "nsh/test";
import { TEST_PARAMS, hostHandlers } from "./lib/test-host";
import { commandFailure } from "./lib/server";
import {
  containerStateTone,
  dockerActionCommand,
  dockerListCommand,
  dockerLogsCommand,
  parseContainers,
} from "./pages/docker/App";
import {
  formatAge,
  kubectlLogsCommand,
  kubectlPodsCommand,
  parsePods,
  podPhaseTone,
} from "./pages/kubernetes/App";
import {
  parseProcesses,
  parseResources,
  resourceCommand,
} from "./pages/resources/App";

function openApp(params: Record<string, unknown>) {
  return open("./App.tsx", {
    width: 1000,
    height: 640,
    host: { params, handlers: hostHandlers({}) },
  });
}

test("一个面板内可切换 Docker / Kubernetes 页签", async () => {
  const app = await openApp({ ...TEST_PARAMS, surface: "panel", panel: "containers" });
  await app.waitFor("text:服务器容器");
  expect(app.shows("label:运行中")).toBe(true);
  expect(app.shows("label:全部")).toBe(true);
  await app.press("label:页签 Kubernetes");
  await app.waitFor("text:只看异常");
  expect(app.shows("label:Pods")).toBe(true);
  await app.press("label:页签 容器");
  await app.waitFor("text:运行中");
  app.dispose();
});

test("tab 形态按 route 切换 Docker / Kubernetes", async () => {
  const app = await openApp({ ...TEST_PARAMS, route: "docker" });
  await app.waitFor("text:服务器容器");
  await app.press("label:页签 Kubernetes");
  await app.waitFor("text:只看异常");
  app.dispose();
});

test("正常 SSH 输出没有退出码时仍进入列表解析", () => {
  const stdout = '{"ID":"abc123","Names":"web","Image":"nginx","State":"running","Status":"Up 2 hours"}\n';
  const result = { stdout, stderr: "", exitCode: null, status: "exited" };
  expect(commandFailure(result, "docker ps 失败")).toBe(null);
  expect(parseContainers(result.stdout)).toEqual([
    { id: "abc123", name: "web", image: "nginx", state: "running", status: "Up 2 hours", ports: "" },
  ]);
  expect(commandFailure({ ...result, exitCode: 1 }, "失败")).toContain("abc123");
});

test("docker ps 的逐行 JSON 被解析成容器行，坏行跳过", () => {
  const rows = parseContainers(
    '{"ID":"abc123","Names":"web","Image":"nginx:1.27","State":"running","Status":"Up 2 hours","Ports":"80/tcp"}\nnot-json\n{"ID":"def456","Names":"db","Image":"postgres:17","State":"exited","Status":"Exited (0) 1 hour ago"}\n',
  );
  expect(rows.length).toBe(2);
  expect(rows[0].name).toBe("web");
  expect(rows[0].state).toBe("running");
  expect(rows[1].status).toBe("Exited (0) 1 hour ago");
  expect(containerStateTone(rows[0].state)).toBe("ok");
  expect(containerStateTone(rows[1].state)).toBe("danger");
});

test("docker 命令拼装含 -a、日志 tail 与动作", () => {
  expect(dockerListCommand(true)).toBe("docker ps -a --format '{{json .}}'");
  expect(dockerListCommand(false)).toBe("docker ps --format '{{json .}}'");
  expect(dockerActionCommand("stop", "abc123")).toBe("docker stop 'abc123'");
  expect(dockerLogsCommand("abc123")).toBe("docker logs --tail 200 'abc123' 2>&1");
});

test("kubectl 命令带命名空间与 tail", () => {
  expect(kubectlPodsCommand("")).toBe("kubectl get pods --all-namespaces -o json");
  expect(kubectlPodsCommand("kube-system")).toBe("kubectl get pods -n 'kube-system' -o json");
  expect(kubectlLogsCommand("default", "web-1")).toBe(
    "kubectl logs -n 'default' 'web-1' --tail=200 2>&1",
  );
});

test("进程列表解析 PID、用户、CPU 与完整命令", () => {
  const rows = parseProcesses("  123 root  12.5  3.4  2-01:02:03 /usr/bin/java -Xmx4g\ninvalid\n");
  expect(rows.length).toBe(1);
  expect(rows[0].id).toBe("123");
  expect(rows[0].subtitle).toContain("CPU 12.5%");
  expect(rows[0].subtitle).toContain("/usr/bin/java -Xmx4g");
});

test("镜像、卷、网络和 Compose 输出解析", () => {
  expect(parseResources("images", '{"Repository":"nginx","Tag":"latest","ID":"abc","CreatedSince":"2 days ago","Size":"200MB"}')).toEqual([
    { id: "abc", title: "nginx:latest", subtitle: "abc · 2 days ago", status: "200MB" },
  ]);
  expect(parseResources("volumes", '{"Name":"data","Driver":"local","Mountpoint":"/var/lib/docker/volumes/data"}')[0].title).toBe("data");
  expect(parseResources("networks", '{"Name":"bridge","ID":"n1","Driver":"bridge","Scope":"local"}')[0].status).toBe("bridge · local");
  expect(parseResources("compose", '[{"Name":"shop","Status":"running(2)","ConfigFiles":"/srv/shop/compose.yml"}]')[0]).toEqual({
    id: "shop",
    title: "shop",
    subtitle: "/srv/shop/compose.yml",
    status: "running(2)",
  });
  expect(resourceCommand("processes")).toContain("--sort=-pcpu");
});

test("kubectl JSON 被解析成 Pod 行（ready / 重启 / 年龄）", () => {
  const pods = parsePods(
    JSON.stringify({
      items: [
        {
          metadata: {
            name: "web-1",
            namespace: "default",
            creationTimestamp: "2026-01-01T00:00:00Z",
          },
          spec: { nodeName: "node-a" },
          status: {
            phase: "Running",
            containerStatuses: [{ ready: true, restartCount: 2 }, { ready: false, restartCount: 1 }],
          },
        },
      ],
    }),
  );
  expect(pods.length).toBe(1);
  expect(pods[0].ready).toBe("1/2");
  expect(pods[0].restarts).toBe("3");
  expect(pods[0].node).toBe("node-a");
  expect(podPhaseTone(pods[0].phase)).toBe("ok");
  expect(podPhaseTone("Pending")).toBe("warn");
  expect(formatAge("2026-01-01T00:00:00Z", Date.parse("2026-01-02T01:00:00Z"))).toBe("1d");
});
