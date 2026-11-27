// Kubernetes 面板：经当前服务器上的 kubectl 读取 Pod，独立面板，不与 Docker 混排。
//
// 只依赖服务器上已有的 kubeconfig / 上下文；面板不接收、不保存任何凭据。
import { cleanup, effect, Scroll, signal, Text, View } from "nsh";
import { Input } from "nsh/base";
import {
  Badge,
  Button,
  IconButton,
  ListRow,
  LoadError,
  Loading,
  Notice,
  Row,
  Segmented,
} from "../../lib/ui";
import { c, t } from "../../lib/theme";
import { errorMessage } from "../../lib/format";
import {
  commandFailure,
  listServerTargets,
  nowClock,
  runServerCommand,
  shellQuote,
  type ServerTarget,
} from "../../lib/server";
import { NoTarget, PanelBody, PanelFooter, TargetBar } from "../../lib/panel";

export type KubePod = {
  name: string;
  namespace: string;
  phase: string;
  restarts: string;
  age: string;
  node: string;
  ready: string;
};

const REFRESH_MS = 5000;
const LOG_TAIL = 200;
/** 日志区高度，点：固定高度让标题行下的 Scroll 有确定的可用空间。 */
const LOG_PANEL_HEIGHT = 180;

export function kubectlPodsCommand(namespace: string): string {
  const scope = namespace.trim().length === 0 ? "--all-namespaces" : `-n ${shellQuote(namespace.trim())}`;
  return `kubectl get pods ${scope} -o json`;
}

export function kubectlLogsCommand(namespace: string, pod: string): string {
  return `kubectl logs -n ${shellQuote(namespace)} ${shellQuote(pod)} --tail=${LOG_TAIL} 2>&1`;
}

export function podPhaseTone(phase: string): "ok" | "warn" | "danger" | "neutral" {
  if (phase === "Running" || phase === "Succeeded") return "ok";
  if (phase === "Pending") return "warn";
  if (phase === "Failed") return "danger";
  return "neutral";
}

/** `kubectl get pods -o json` 的 items → 面板行；字段缺失给占位而不是抛错。 */
export function parsePods(stdout: string): KubePod[] {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{")) return [];
  const document = JSON.parse(trimmed) as { items?: unknown[] };
  const items = Array.isArray(document.items) ? document.items : [];
  return items.map((item) => {
    const pod = item as {
      metadata?: { name?: string; namespace?: string; creationTimestamp?: string };
      spec?: { nodeName?: string };
      status?: {
        phase?: string;
        containerStatuses?: Array<{ ready?: boolean; restartCount?: number }>;
      };
    };
    const statuses = pod.status?.containerStatuses ?? [];
    const ready = statuses.filter((status) => status.ready === true).length;
    const restarts = statuses.reduce((total, status) => total + (status.restartCount ?? 0), 0);
    return {
      name: pod.metadata?.name ?? "<unknown>",
      namespace: pod.metadata?.namespace ?? "default",
      phase: pod.status?.phase ?? "Unknown",
      restarts: String(restarts),
      age: formatAge(pod.metadata?.creationTimestamp),
      node: pod.spec?.nodeName ?? "",
      ready: `${ready}/${statuses.length}`,
    };
  });
}

/** kubectl 的 AGE 列是服务端算的；这里用创建时间换算成同形的短文案。 */
export function formatAge(creationTimestamp: string | undefined, now: number = Date.now()): string {
  if (!creationTimestamp) return "";
  const created = Date.parse(creationTimestamp);
  if (Number.isNaN(created)) return "";
  const seconds = Math.max(0, Math.floor((now - created) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

export default function KubernetesPanel() {
  const targets = signal<ServerTarget[]>([]);
  const targetId = signal<string | null>(null);
  const pods = signal<KubePod[]>([]);
  const namespace = signal("");
  const scope = signal("pods");
  const query = signal("");
  const loading = signal(true);
  const busy = signal(false);
  const error = signal<string | null>(null);
  const updatedAt = signal("");
  const autoRefresh = signal(false);
  const selected = signal<KubePod | null>(null);
  const logs = signal("");
  const logsLoading = signal(false);
  let seq = 0;

  function currentTarget(): ServerTarget | null {
    return targets().find((item) => item.sessionId === targetId()) ?? targets()[0] ?? null;
  }

  function visiblePods(): KubePod[] {
    const needle = query().trim().toLowerCase();
    if (needle.length === 0) return pods();
    return pods().filter((pod) =>
      `${pod.namespace} ${pod.name} ${pod.node}`.toLowerCase().includes(needle),
    );
  }

  async function load(force = false) {
    const target = currentTarget();
    if (!target) return;
    if (busy() && !force) return;
    const mine = ++seq;
    busy.set(true);
    if (pods().length === 0) loading.set(true);
    try {
      const result = await runServerCommand(target, kubectlPodsCommand(namespace()), 20_000);
      if (mine !== seq) return;
      const failure = commandFailure(result, "kubectl get pods 失败");
      if (failure !== null) {
        error.set(failure);
      } else {
        pods.set(parsePods(result.stdout));
        error.set(null);
        updatedAt.set(nowClock());
      }
    } catch (failure) {
      if (mine !== seq) return;
      error.set(errorMessage(failure));
    } finally {
      if (mine === seq) {
        busy.set(false);
        loading.set(false);
      }
    }
  }

  async function loadTargets() {
    loading.set(true);
    try {
      const list = await listServerTargets();
      targets.set(list);
      if (list.length > 0 && targetId() === null) targetId.set(list[0].sessionId);
      if (list.length === 0) {
        loading.set(false);
        return;
      }
      await load(true);
    } catch (failure) {
      error.set(errorMessage(failure));
      loading.set(false);
    }
  }

  async function openLogs(pod: KubePod) {
    const target = currentTarget();
    if (!target) return;
    selected.set(pod);
    logs.set("");
    logsLoading.set(true);
    try {
      const result = await runServerCommand(target, kubectlLogsCommand(pod.namespace, pod.name));
      logs.set(result.stdout || result.stderr || "（这个 Pod 还没有日志输出）");
    } catch (failure) {
      logs.set(errorMessage(failure));
    } finally {
      logsLoading.set(false);
    }
  }

  effect(() => {
    if (!autoRefresh()) return;
    const timer = setInterval(() => void load(), REFRESH_MS);
    cleanup(() => clearInterval(timer));
  });

  void loadTargets();

  return (
    <PanelBody>
      <Row
        gap={8}
        style={{
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderBottomColor: c.line(),
          flexShrink: 0,
        }}
      >
        <Text style={{ ...t.h2, flex: 1 }}>
          {`Kubernetes${currentTarget() ? ` · ${currentTarget()?.label}` : ""}`}
        </Text>
        <Button
          label={autoRefresh() ? "停止刷新" : "自动刷新"}
          small
          tone={autoRefresh() ? "primary" : "ghost"}
          onPress={() => autoRefresh.set(!autoRefresh())}
        />
        <IconButton glyph="⟳" label="刷新 Pod" onPress={() => void load(true)} disabled={busy()} />
      </Row>

      <TargetBar
        targets={targets()}
        currentId={currentTarget()?.sessionId ?? null}
        onSelect={(id) => {
          targetId.set(id);
          pods.set([]);
          selected.set(null);
          void load(true);
        }}
      />

      <Row gap={8} style={{ paddingHorizontal: 12, paddingVertical: 8, flexShrink: 0 }}>
        <Segmented
          options={[
            { value: "pods", label: "Pods" },
            { value: "errors", label: "只看异常" },
          ]}
          value={scope()}
          size="small"
          onChange={(value) => scope.set(value)}
        />
        <View
          style={{
            flex: 1,
            minWidth: 0,
            height: 26,
            paddingHorizontal: 8,
            borderRadius: 6,
            backgroundColor: c.hover(),
            justifyContent: "center",
          }}
        >
          <Input
            value={namespace()}
            placeholder="命名空间（空 = 全部）"
            accessibilityLabel="Kubernetes 命名空间"
            onChange={(event) => namespace.set(event.value)}
            onSubmit={() => void load(true)}
            style={{
              fontSize: 11.5,
              color: c.text(),
              placeholderColor: c.muted(),
              caretColor: c.text(),
              borderWidth: 0,
              backgroundColor: "transparent",
            }}
          />
        </View>
      </Row>

      <Row gap={8} style={{ paddingHorizontal: 12, paddingBottom: 8, flexShrink: 0 }}>
        <View
          style={{
            flex: 1,
            minWidth: 0,
            height: 26,
            paddingHorizontal: 8,
            borderRadius: 6,
            backgroundColor: c.hover(),
            justifyContent: "center",
          }}
        >
          <Input
            value={query()}
            placeholder="按名称 / 命名空间 / 节点过滤"
            accessibilityLabel="过滤 Pod"
            onChange={(event) => query.set(event.value)}
            style={{
              fontSize: 11.5,
              color: c.text(),
              placeholderColor: c.muted(),
              caretColor: c.text(),
              borderWidth: 0,
              backgroundColor: "transparent",
            }}
          />
        </View>
        <Button label="应用" small onPress={() => void load(true)} />
      </Row>

      {error() !== null ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 6 }}>
          <Notice message={error() ?? ""} tone="danger" />
        </View>
      ) : null}

      {targets().length === 0 && !loading() ? (
        <NoTarget
          hint="打开一个装有 kubectl 的 SSH 或本地终端后，这里会列出它当前上下文里的 Pod。"
          onRetry={() => void loadTargets()}
        />
      ) : loading() && pods().length === 0 ? (
        <Loading label="正在执行 kubectl get pods…" />
      ) : error() !== null && pods().length === 0 ? (
        <LoadError message={error() ?? ""} onRetry={() => void load(true)} />
      ) : (
        <Scroll style={{ flex: 1, minHeight: 0 }}>
          <View style={{ flexDirection: "column", paddingHorizontal: 6, paddingVertical: 4 }}>
            {(scope() === "errors"
              ? visiblePods().filter((pod) => podPhaseTone(pod.phase) !== "ok")
              : visiblePods()
            ).map((pod) => (
              <View style={{ borderBottomWidth: 1, borderBottomColor: c.line() }}>
                <ListRow
                  title={pod.name}
                  subtitle={`${pod.namespace} · ready ${pod.ready} · 重启 ${pod.restarts} · ${pod.age}`}
                  leading={<Badge text={pod.phase} tone={podPhaseTone(pod.phase)} dot />}
                />
                <Row gap={6} style={{ paddingHorizontal: 8, paddingBottom: 6 }}>
                  <Button label="日志" small onPress={() => void openLogs(pod)} />
                </Row>
              </View>
            ))}
            {visiblePods().length === 0 ? (
              <Text style={{ ...t.meta, padding: 12 }}>当前命名空间下没有 Pod。</Text>
            ) : null}
          </View>
        </Scroll>
      )}

      {selected() !== null ? (
        <View
          style={{
            // 面板再矮也压得住：高度不够时先压日志区，不把列表和页脚挤出面板。
            flexShrink: 1,
            // 日志区必须先有确定高度：里面的 Scroll 是滚动容器，不参与父级的内容测量，
            // 只写 maxHeight 的话这一块会缩成标题行高，日志正文高度为 0（issue #623）。
            height: LOG_PANEL_HEIGHT,
            borderTopWidth: 1,
            borderTopColor: c.line(),
            flexDirection: "column",
          }}
        >
          <Row style={{ paddingHorizontal: 12, paddingTop: 6, justifyContent: "space-between" }}>
            <Text style={t.label}>{`${selected()?.namespace}/${selected()?.name} 日志`}</Text>
            <IconButton glyph="×" label="关闭日志" onPress={() => selected.set(null)} />
          </Row>
          {logsLoading() ? (
            <Loading label="正在读取 Pod 日志…" />
          ) : (
            <Scroll style={{ flex: 1, minHeight: 0 }}>
              <Text style={{ ...t.mono, fontSize: 11, color: c.text(), paddingHorizontal: 12 }}>
                {logs()}
              </Text>
            </Scroll>
          )}
        </View>
      ) : null}

      <PanelFooter
        left={`${visiblePods().length} 个 Pod${namespace().trim() ? ` · ${namespace().trim()}` : " · 全部命名空间"}`}
        right={updatedAt() ? `更新于 ${updatedAt()}` : ""}
      />
    </PanelBody>
  );
}
