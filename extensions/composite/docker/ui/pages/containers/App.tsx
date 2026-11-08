// Docker 容器页：左边列表、右边详情，详情里带生命周期操作。
//
// 这个页面替代了被删掉的原生资源工作台表格页：数据不再经过工作台的
// `dispatch(operationId)`，也没有「宿主按 selection 挑容器」这一层 —— 页面
// 自己拿连接借来的资源句柄，直接按 provider 方法名要数据（`lib/navop.ts`）。
//
//   docker/container/list    {}            → { containers: [...] }
//   docker/container/inspect { id }        → docker inspect 原始文档
//   docker/container/stats   { id }        → { cpu_percent, memory_usage_bytes, … }
//   docker/container/{start,stop,restart,pause,unpause,remove} { id }
//
// 删除是唯一破坏性操作：走页内 ConfirmBar 二次确认，`remove` 在 provider 侧
// 强制 `force: true` + `v: true`（匿名卷一并删除），文案里写清楚。
import { computed, signal, Text, View } from "nsh";
import type { Accessor, JSX } from "nsh";
import { Input } from "nsh/base";
import { arr, errorMessage, humanBytes, joinCommand, percent, shortTime, str } from "../../lib/format";
import { invoke, SLOW_TIMEOUT_MS } from "../../lib/navop";
import {
  Badge,
  ConfirmBar,
  Dot,
  Empty,
  IconButton,
  KeyValueGrid,
  KeyValueList,
  List,
  ListRow,
  LoadError,
  Loading,
  Metric,
  Notice,
  Row,
  Section,
  Segmented,
  SplitPane,
  Stack,
  Toolbar,
} from "../../lib/ui";
import { c, r, t } from "../../lib/theme";
import Processes from "../processes/App";
import Changes from "../changes/App";
import ContainerFiles from "../container-files/App";
import ContainerInspect from "../container-inspect/App";
import ContainerMounts from "../container-mounts/App";
import ContainerStats from "../container-stats/App";
import ContainerTerminal from "../container-terminal/App";

type Tone = "neutral" | "ok" | "warn" | "danger" | "info";
type StateFilter = "all" | "running" | "stopped";
type ActionName = "start" | "stop" | "restart" | "pause" | "unpause";

/** 详情区标签：概览是页面自己的摘要，其余复用「单容器」那几页（进来时预设当前容器）。 */
type DetailTab = "overview" | "processes" | "files" | "changes" | "inspect" | "mounts" | "stats" | "terminal";

/** 列表行（provider 的 `docker/container/list` 已经把字段摊平好了）。 */
type Container = {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  created: string;
};

type Stats = {
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  cpus: number;
};

/** 一次最多显示多少条环境变量 / 标签，避免一屏几千行。 */
const ENV_LIMIT = 40;
const LABEL_LIMIT = 20;

const STATE_LABEL: Record<string, string> = {
  running: "运行中",
  exited: "已停止",
  paused: "已暂停",
  created: "已创建",
  restarting: "重启中",
  removing: "删除中",
  dead: "已死亡",
};

const ACTION_PAST: Record<ActionName, string> = {
  start: "已启动",
  stop: "已停止",
  restart: "已重启",
  pause: "已暂停",
  unpause: "已恢复",
};

function stateLabel(state: string): string {
  const label = STATE_LABEL[state];
  return label === undefined ? (state.length === 0 ? "未知" : state) : label;
}

function stateTone(state: string): Tone {
  if (state === "running") return "ok";
  if (state === "paused" || state === "restarting" || state === "removing") return "warn";
  if (state === "dead") return "danger";
  return "neutral";
}

function stateColor(state: string): string {
  const tone = stateTone(state);
  if (tone === "ok") return c.chart(1);
  if (tone === "warn") return c.chart(4);
  if (tone === "danger") return c.danger();
  return c.muted();
}

// ---- 取值助手：inspect 是 docker 的原始文档，字段可能整段缺失 ----------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick(source: unknown, key: string): unknown {
  return isObject(source) ? source[key] : undefined;
}

/** 把任意值读成一句可显示文本；缺失时给 fallback。 */
function text(value: unknown, fallback = "-"): string {
  if (typeof value === "string") return value.length === 0 ? fallback : value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : fallback;
  if (typeof value === "boolean") return value ? "是" : "否";
  return fallback;
}

function numberOr(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toContainer(value: unknown): Container {
  return {
    id: str(value, "id", ""),
    name: str(value, "name", ""),
    image: str(value, "image", ""),
    state: str(value, "state", ""),
    status: str(value, "status", ""),
    ports: str(value, "ports", ""),
    created: str(value, "created", "-"),
  };
}

function toStats(value: unknown): Stats {
  return {
    cpuPercent: numberOr(pick(value, "cpu_percent"), 0),
    memoryUsage: numberOr(pick(value, "memory_usage_bytes"), 0),
    memoryLimit: numberOr(pick(value, "memory_limit_bytes"), 0),
    cpus: numberOr(pick(value, "online_cpus"), 0),
  };
}

function nowClock(): string {
  const now = new Date();
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(now.getHours())}:${two(now.getMinutes())}`;
}

function restartText(policy: unknown): string {
  const name = text(pick(policy, "Name"), "");
  if (name.length === 0 || name === "no") return "不自动重启";
  const retries = numberOr(pick(policy, "MaximumRetryCount"), 0);
  return retries > 0 ? `${name}（最多 ${retries} 次）` : name;
}

/** 状态 + 健康检查 + 暂停位（inspect 里这三处是分开的）。 */
function stateText(state: unknown): string {
  const status = text(pick(state, "Status"), "");
  const health = text(pick(state, "Health"), "");
  const healthStatus = text(pick(pick(state, "Health"), "Status"), "");
  const parts = [status.length === 0 ? "未知" : stateLabel(status)];
  if (healthStatus.length > 0) parts.push(`健康检查 ${healthStatus}`);
  else if (health.length > 0) parts.push(`健康检查 ${health}`);
  if (pick(state, "Paused") === true) parts.push("已暂停");
  return parts.join(" · ");
}

/** `NetworkSettings.Ports` → `0.0.0.0:8080 → 80/tcp` 这样的行。 */
function portLines(info: unknown): string[] {
  const ports = pick(pick(info, "NetworkSettings"), "Ports");
  if (!isObject(ports)) return [];
  const lines: string[] = [];
  for (const [containerPort, bindings] of Object.entries(ports)) {
    if (!Array.isArray(bindings) || bindings.length === 0) {
      lines.push(`${containerPort}（仅暴露，未发布）`);
      continue;
    }
    for (const binding of bindings) {
      const hostIp = text(pick(binding, "HostIp"), "0.0.0.0");
      const hostPort = text(pick(binding, "HostPort"), "");
      lines.push(hostPort.length === 0 ? `${containerPort}（仅暴露，未发布）` : `${hostIp}:${hostPort} → ${containerPort}`);
    }
  }
  return lines;
}

/** 各网络的名字 → IP / 网关 / MAC。 */
function networkRows(info: unknown): Array<[string, string]> {
  const networks = pick(pick(info, "NetworkSettings"), "Networks");
  if (!isObject(networks)) return [];
  return Object.entries(networks).map(([name, value]) => {
    const parts: string[] = [];
    const ip = text(pick(value, "IPAddress"), "");
    const gateway = text(pick(value, "Gateway"), "");
    const mac = text(pick(value, "MacAddress"), "");
    if (ip.length > 0) parts.push(ip);
    if (gateway.length > 0) parts.push(`网关 ${gateway}`);
    if (mac.length > 0) parts.push(mac);
    return [name, parts.length === 0 ? "未分配地址" : parts.join(" · ")] as [string, string];
  });
}

/** 挂载：源 → 目标（读写位）。 */
function mountRows(info: unknown): Array<[string, string]> {
  const mounts = pick(info, "Mounts");
  if (!Array.isArray(mounts)) return [];
  return mounts.map((mount) => {
    const source = text(pick(mount, "Source"), "-");
    const destination = text(pick(mount, "Destination"), "-");
    const mode = pick(mount, "RW") === false ? "只读" : "读写";
    const type = text(pick(mount, "Type"), "");
    return [source, `${destination}（${mode}${type.length === 0 ? "" : ` · ${type}`}）`] as [string, string];
  });
}

/** `Config.Env` 是 `KEY=VALUE` 字符串数组。 */
function envRows(info: unknown): Array<[string, string]> {
  const env = pick(pick(info, "Config"), "Env");
  if (!Array.isArray(env)) return [];
  return env.map((entry) => {
    const line = typeof entry === "string" ? entry : String(entry);
    const at = line.indexOf("=");
    return (at < 0 ? [line, ""] : [line.slice(0, at), line.slice(at + 1)]) as [string, string];
  });
}

function labelRows(info: unknown): Array<[string, string]> {
  const labels = pick(pick(info, "Config"), "Labels");
  if (!isObject(labels)) return [];
  return Object.entries(labels).map(([key, value]) => [key, text(value, "")] as [string, string]);
}

function overviewRows(info: Record<string, unknown>): Array<[string, string]> {
  const state = pick(info, "State");
  const config = pick(info, "Config");
  const hostConfig = pick(info, "HostConfig");
  return [
    ["容器 ID", text(pick(info, "Id")).slice(0, 12)],
    ["名称", text(pick(info, "Name")).replace(/^\//, "")],
    ["镜像", text(pick(config, "Image"), text(pick(info, "Image")))],
    ["状态", stateText(state)],
    ["启动时间", shortTime(text(pick(state, "StartedAt"), ""))],
    ["创建时间", shortTime(text(pick(info, "Created"), ""))],
    ["退出码", text(pick(state, "ExitCode"), "0")],
    ["重启次数", text(pick(state, "RestartCount"), "0")],
    ["重启策略", restartText(pick(hostConfig, "RestartPolicy"))],
    ["启动命令", joinCommand(pick(config, "Cmd"))],
  ];
}

// ---- 小控件 ----------------------------------------------------------------
//
// 这里的小控件必须把响应式值内联在 JSX 属性里（nsh 组件体只在挂载时跑一次），
// 所以样式直接写属性，不经过 lib 里「把 props 读成常量」的组件。

/** 操作按钮：主操作填色，其余纯文字 + hover 底色，不再一排描边盒子。 */
function ActionButton(props: {
  label: string | Accessor<string>;
  testLabel?: string;
  tone?: "primary" | "ghost" | "danger";
  disabled?: Accessor<boolean>;
  onPress: () => void;
}): JSX.Element {
  const label = (): string => (typeof props.label === "function" ? props.label() : props.label);
  const disabled = (): boolean => props.disabled?.() === true;
  const tone = props.tone ?? "ghost";
  const testLabel = props.testLabel ?? (typeof props.label === "string" ? props.label : "");
  return (
    <View
      role="button"
      accessibilityLabel={testLabel}
      onPress={() => {
        if (disabled()) return;
        props.onPress();
      }}
      hoverStyle={{ backgroundColor: tone === "primary" ? c.accent() : c.hover() }}
      style={{
        height: 26,
        paddingHorizontal: 10,
        borderRadius: r.control,
        backgroundColor: tone === "primary" ? c.accent() : "transparent",
        opacity: disabled() ? 0.45 : 1,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        cursor: "default",
      }}
    >
      <Text
        style={{
          fontSize: 12,
          fontWeight: "500",
          color:
            tone === "primary"
              ? c.accentText()
              : tone === "danger"
                ? c.danger()
                : disabled()
                  ? c.muted()
                  : c.text(),
        }}
      >
        {label()}
      </Text>
    </View>
  );
}

/** 过滤输入框：lib 的 SearchField 不暴露 testID，测试里要用 `id:` 定位，所以自己包一层。 */
function FilterField(props: {
  testID: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        height: 24,
        width: 190,
        paddingHorizontal: 8,
        borderRadius: r.control,
        backgroundColor: c.hover(),
      }}
    >
      <Text style={{ fontSize: 11, color: c.muted() }}>⌕</Text>
      <Input
        testID={props.testID}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(text) => props.onChange(text)}
        style={{ flex: 1, fontSize: 11.5, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent" }}
      />
    </View>
  );
}

export default function Containers() {
  const rows = signal<Container[]>([]);
  const loading = signal(true);
  const listError = signal<string | null>(null);
  const filter = signal("");
  const stateFilter = signal<StateFilter>("all");
  const selected = signal<string | null>(null);
  const detail = signal<Record<string, unknown> | null>(null);
  const detailLoading = signal(false);
  const detailError = signal<string | null>(null);
  const stats = signal<Stats | null>(null);
  const busy = signal(false);
  const pendingRemove = signal<string | null>(null);
  const notice = signal<string | null>(null);
  const noticeTone = signal<Tone>("neutral");
  const updatedAt = signal<string | null>(null);
  const detailTab = signal<DetailTab>("overview");

  // last-wins：只有最后一次请求的响应允许落到视图上（2 个并发操作时尤其重要）。
  let listSeq = 0;
  let detailSeq = 0;
  let statsSeq = 0;

  const firstLoad = computed(() => loading() && rows().length === 0 && listError() === null);
  const firstError = computed(() => listError() !== null && rows().length === 0);

  function say(message: string, tone: Tone = "neutral") {
    notice.set(message);
    noticeTone.set(tone);
  }

  function selectedRow(): Container | null {
    return rows().find((row) => row.id === selected()) ?? null;
  }

  function runningCount(): number {
    return rows().filter((row) => row.state === "running").length;
  }

  function visible(): Container[] {
    const needle = filter().trim().toLowerCase();
    const mode = stateFilter();
    return rows().filter((row) => {
      if (mode === "running" && row.state !== "running") return false;
      if (mode === "stopped" && row.state === "running") return false;
      if (needle.length === 0) return true;
      return `${row.name} ${row.image}`.toLowerCase().includes(needle);
    });
  }

  async function load() {
    const mine = ++listSeq;
    loading.set(true);
    try {
      const result = await invoke<{ containers?: unknown }>("docker/container/list", {}, { timeout: SLOW_TIMEOUT_MS });
      if (mine !== listSeq) return;
      const list = arr(result, "containers").map(toContainer);
      rows.set(list);
      listError.set(null);
      updatedAt.set(nowClock());
      syncSelection(list);
    } catch (failure) {
      if (mine !== listSeq) return;
      listError.set(errorMessage(failure));
    } finally {
      if (mine === listSeq) loading.set(false);
    }
  }

  /** 列表刷新后：选中的容器还在就留着，没了就换成第一个。 */
  function syncSelection(list: Container[]) {
    const current = selected();
    const stillThere = current !== null && list.some((row) => row.id === current);
    if (stillThere) return;
    const next = list.length > 0 ? list[0].id : null;
    selected.set(next);
    detail.set(null);
    stats.set(null);
    detailError.set(null);
    pendingRemove.set(null);
    if (next !== null) void loadDetail(next);
  }

  function select(id: string) {
    if (selected() === id) return;
    selected.set(id);
    detail.set(null);
    stats.set(null);
    detailError.set(null);
    pendingRemove.set(null);
    void loadDetail(id);
  }

  async function loadDetail(id: string) {
    const mine = ++detailSeq;
    detailLoading.set(true);
    detailError.set(null);
    try {
      const raw = await invoke("docker/container/inspect", { id }, { timeout: SLOW_TIMEOUT_MS });
      if (mine !== detailSeq || selected() !== id) return;
      detail.set(isObject(raw) ? raw : null);
    } catch (failure) {
      if (mine !== detailSeq || selected() !== id) return;
      detail.set(null);
      detailError.set(errorMessage(failure));
    } finally {
      if (mine === detailSeq && selected() === id) detailLoading.set(false);
    }
    void loadStats(id);
  }

  /** stats 失败不算错误：容器刚好退出、provider 采样失败都会走到这里。 */
  async function loadStats(id: string) {
    const mine = ++statsSeq;
    stats.set(null);
    try {
      const raw = await invoke("docker/container/stats", { id }, { timeout: SLOW_TIMEOUT_MS });
      if (mine !== statsSeq || selected() !== id) return;
      stats.set(toStats(raw));
    } catch {
      if (mine === statsSeq && selected() === id) stats.set(null);
    }
  }

  async function act(action: ActionName, row: Container) {
    if (busy()) return;
    busy.set(true);
    pendingRemove.set(null);
    try {
      await invoke(`docker/container/${action}`, { id: row.id });
      say(`${ACTION_PAST[action]}容器 ${row.name.length > 0 ? row.name : row.id.slice(0, 12)}`);
      await load();
      if (selected() === row.id) await loadDetail(row.id);
    } catch (failure) {
      say(`${actionLabel(action)}失败：${errorMessage(failure)}`, "danger");
    } finally {
      busy.set(false);
    }
  }

  async function remove(row: Container) {
    if (busy()) return;
    busy.set(true);
    try {
      await invoke("docker/container/remove", { id: row.id });
      pendingRemove.set(null);
      if (selected() === row.id) {
        selected.set(null);
        detail.set(null);
        stats.set(null);
      }
      say(`已删除容器 ${row.name.length > 0 ? row.name : row.id.slice(0, 12)}`);
      await load();
    } catch (failure) {
      say(`删除失败：${errorMessage(failure)}`, "danger");
    } finally {
      busy.set(false);
    }
  }

  function actionLabel(action: ActionName): string {
    switch (action) {
      case "start":
        return "启动";
      case "stop":
        return "停止";
      case "restart":
        return "重启";
      case "pause":
        return "暂停";
      case "unpause":
        return "恢复";
    }
  }

  void load();

  // ---- 片段 ----------------------------------------------------------------
  //
  // 这些是「片段构造函数」而不是组件：它们在外层的 `{() => …}` 里每帧重新调用，
  // 所以可以直接读信号，不必再包一层响应式包装。

  function listPane(): JSX.Element {
    return (
      <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {() =>
          visible().length === 0 ? (
            <Empty
              title={rows().length === 0 ? "还没有容器" : "没有匹配的容器"}
              hint={
                rows().length === 0
                  ? "在终端里 docker run 一个容器，然后点右上角「刷新」。"
                  : "清空搜索词，或把状态过滤切回「全部」。"
              }
            />
          ) : (
            <List
              items={visible()}
              keyOf={(row) => (row.id.length > 0 ? row.id : row.name)}
              selected={selected()}
              onSelect={select}
              render={(row) => (
                <ListRow
                  title={row.name.length > 0 ? row.name : row.id.slice(0, 12)}
                  subtitle={`${row.status.length > 0 ? row.status : stateLabel(row.state)} · ${row.image}`}
                  leading={<Dot color={stateColor(row.state)} size={7} />}
                  trailing={
                    <View
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: 3,
                        width: 66,
                        flexShrink: 0,
                      }}
                    >
                      <Badge text={stateLabel(row.state)} tone={stateTone(row.state)} />
                      <Text numberOfLines={1} style={{ ...t.meta, fontSize: 10 }}>
                        {row.created.replace(/^\d{4}-/, "")}
                      </Text>
                    </View>
                  }
                />
              )}
            />
          )
        }
      </View>
    );
  }

  /** 生命周期操作：运行中先给「停止」，已暂停先给「恢复」，其余给「启动」。 */
  function actions(row: Container): JSX.Element {
    const controls: JSX.Element[] = [];
    if (row.state === "running") {
      controls.push(
        <ActionButton label="停止" disabled={busy} onPress={() => void act("stop", row)} />,
        <ActionButton label="重启" disabled={busy} onPress={() => void act("restart", row)} />,
        <ActionButton label="暂停" disabled={busy} onPress={() => void act("pause", row)} />,
      );
    } else if (row.state === "paused") {
      controls.push(
        <ActionButton label="恢复" tone="primary" disabled={busy} onPress={() => void act("unpause", row)} />,
        <ActionButton label="停止" disabled={busy} onPress={() => void act("stop", row)} />,
      );
    } else {
      controls.push(
        <ActionButton label="启动" tone="primary" disabled={busy} onPress={() => void act("start", row)} />,
      );
    }
    controls.push(
      <ActionButton
        label="删除容器"
        tone="danger"
        disabled={busy}
        onPress={() => {
          notice.set(null);
          pendingRemove.set(pendingRemove() === row.id ? null : row.id);
        }}
      />,
    );
    return <Row gap={4}>{controls}</Row>;
  }

  /** 运行中才有的实时指标：一条，而不是卡片里再套卡片。 */
  function metrics(row: Container): JSX.Element | null {
    if (row.state !== "running") return null;
    const sample = stats();
    const limit = sample === null ? 0 : sample.memoryLimit;
    const used = sample === null ? 0 : sample.memoryUsage;
    return (
      <View
        style={{
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: c.line(),
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <Text style={t.label}>资源占用</Text>
        {sample === null ? (
          <Text style={t.meta}>正在采样…</Text>
        ) : (
          <Row gap={26}>
            <Metric
              label="CPU"
              value={sample.cpuPercent.toFixed(1)}
              unit="%"
              hint={sample.cpus > 0 ? `${sample.cpus} 个 CPU` : undefined}
            />
            <Metric
              label="内存"
              value={humanBytes(used)}
              hint={limit > 0 ? `上限 ${humanBytes(limit)}` : "无上限"}
            />
            <Metric label="内存占比" value={limit > 0 ? percent(used, limit) : "—"} />
          </Row>
        )}
      </View>
    );
  }

  function detailBody(row: Container): JSX.Element {
    const name = row.name.length > 0 ? row.name : row.id.slice(0, 12);
    return (
      <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <View
          style={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: 12,
            gap: 5,
            borderBottomWidth: 1,
            borderBottomColor: c.line(),
          }}
        >
          <Row gap={10} style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <View style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              <Row gap={7} style={{ alignItems: "center" }}>
                <Dot color={stateColor(row.state)} size={7} />
                <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: "600", color: c.text() }}>
                  {name}
                </Text>
                <Badge text={stateLabel(row.state)} tone={stateTone(row.state)} />
              </Row>
              <Row gap={8} style={{ alignItems: "center" }}>
                <Text numberOfLines={1} style={t.monoDim}>
                  {row.id.slice(0, 12)}
                </Text>
                <Text numberOfLines={1} style={{ ...t.meta, flex: 1, minWidth: 0 }}>
                  {row.image}
                </Text>
              </Row>
            </View>
            {actions(row)}
          </Row>
        </View>

        {() =>
          pendingRemove() === row.id ? (
            <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
              <ConfirmBar
                message={`删除容器 ${name}？会先强制停止再删除（匿名卷一并删除），无法恢复。`}
                confirmLabel="删除"
                busy={busy()}
                onConfirm={() => void remove(row)}
                onCancel={() => pendingRemove.set(null)}
              />
            </View>
          ) : null
        }

        <View style={{ paddingHorizontal: 16, paddingTop: 10, flexShrink: 0 }}>
          <Segmented
            value={detailTab()}
            options={[
              { value: "overview" as DetailTab, label: "概览", testLabel: "详情:概览" },
              { value: "processes" as DetailTab, label: "进程", testLabel: "详情:进程" },
              { value: "files" as DetailTab, label: "文件", testLabel: "详情:文件" },
              { value: "changes" as DetailTab, label: "变更", testLabel: "详情:变更" },
              { value: "inspect" as DetailTab, label: "检查", testLabel: "详情:检查" },
              { value: "mounts" as DetailTab, label: "挂载", testLabel: "详情:挂载" },
              { value: "stats" as DetailTab, label: "统计", testLabel: "详情:统计" },
              { value: "terminal" as DetailTab, label: "终端", testLabel: "详情:终端" },
            ]}
            onChange={(value) => detailTab.set(value)}
          />
        </View>

        {() => (detailTab() === "overview" ? overviewTab(row) : containerTab(row))}
      </View>
    );
  }

  /** 「概览」：页面自己的摘要 + 指标条，其余标签把活交给单容器页。 */
  function overviewTab(row: Container): JSX.Element {
    const info = detail();
    const networks = info === null ? [] : networkRows(info);
    const ports = info === null ? [] : portLines(info);
    const mounts = info === null ? [] : mountRows(info);
    const env = info === null ? [] : envRows(info);
    const labels = info === null ? [] : labelRows(info);
    const shownEnv = env.slice(0, ENV_LIMIT);
    const shownLabels = labels.slice(0, LABEL_LIMIT);
    return (
      <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {metrics(row)}

        <Stack scroll padding={16} gap={20}>
          {() =>
            detailError() === null ? null : (
              <Row gap={8}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Notice message={`读取详情失败：${detailError() ?? ""}`} tone="danger" />
                </View>
                <ActionButton label="重试" testLabel="重试读取详情" onPress={() => void loadDetail(row.id)} />
              </Row>
            )
          }
          {() => (detailLoading() && info === null ? <Loading label="正在读取容器详情…" /> : null)}
          {info === null ? null : (
            <Section title="概览">
              <KeyValueGrid rows={overviewRows(info)} columns={2} />
            </Section>
          )}
          {networks.length === 0 && ports.length === 0 ? null : (
            <Section title="网络" hint={networks.length > 0 ? `${networks.length} 个网络` : undefined}>
              {networks.length === 0 ? null : <KeyValueList rows={networks} labelWidth={140} />}
              <Text style={t.label}>端口</Text>
              {ports.length === 0 ? (
                <Text style={t.meta}>没有发布端口。</Text>
              ) : (
                ports.map((line) => (
                  <Text style={{ ...t.mono, fontSize: 11.5 }} selectable>
                    {line}
                  </Text>
                ))
              )}
            </Section>
          )}
          {mounts.length === 0 ? null : (
            <Section title="挂载" hint={`${mounts.length} 处`}>
              <KeyValueList rows={mounts} labelWidth={240} mono selectable />
            </Section>
          )}
          {env.length === 0 ? null : (
            <Section
              title="环境变量"
              hint={env.length > shownEnv.length ? `${env.length} 项，显示前 ${shownEnv.length} 项` : `${env.length} 项`}
            >
              <KeyValueList rows={shownEnv} labelWidth={220} mono selectable />
            </Section>
          )}
          {labels.length === 0 ? null : (
            <Section
              title="标签"
              hint={
                labels.length > shownLabels.length
                  ? `${labels.length} 项，显示前 ${shownLabels.length} 项`
                  : `${labels.length} 项`
              }
            >
              <KeyValueList rows={shownLabels} labelWidth={220} mono selectable />
            </Section>
          )}
        </Stack>
      </View>
    );
  }

  /** 单容器标签：直接嵌那一页，并把当前容器预设进去，所以不需要再挑一次。 */
  function containerTab(row: Container): JSX.Element {
    const tab = detailTab();
    return (
      <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {tab === "processes" ? (
          <Processes containerId={row.id} />
        ) : tab === "files" ? (
          <ContainerFiles containerId={row.id} />
        ) : tab === "changes" ? (
          <Changes containerId={row.id} />
        ) : tab === "inspect" ? (
          <ContainerInspect containerId={row.id} />
        ) : tab === "mounts" ? (
          <ContainerMounts containerId={row.id} />
        ) : tab === "stats" ? (
          <ContainerStats containerId={row.id} />
        ) : (
          <ContainerTerminal containerId={row.id} />
        )}
      </View>
    );
  }

  function detailPane(): JSX.Element {
    return (
      <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {() => {
          const row = selectedRow();
          return row === null ? (
            <Empty title="选择一个容器" hint="左侧点一个容器查看详情；可以启动、停止、重启、暂停，或删除它。" />
          ) : (
            detailBody(row)
          );
        }}
      </View>
    );
  }

  // ---- 页面 ----------------------------------------------------------------

  return (
    <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", backgroundColor: c.bg() }}>
      <Toolbar
        title="容器"
        hint={`${rows().length} 个 · 运行中 ${runningCount()}`}
        right={
          <Row gap={6} style={{ alignItems: "center" }}>
            <If when={updatedAt() !== null}>
              <Text style={t.meta}>{`上次更新 ${updatedAt() ?? ""}`}</Text>
            </If>
            <IconButton glyph="↻" label="刷新" disabled={() => loading() || busy()} onPress={() => void load()} />
          </Row>
        }
      >
        <FilterField
          testID="container-filter"
          value={filter()}
          placeholder="按名称 / 镜像过滤"
          onChange={(value) => filter.set(value)}
        />
        <Segmented
          value={stateFilter()}
          options={[
            { value: "all" as StateFilter, label: "全部", testLabel: "过滤:全部" },
            { value: "running" as StateFilter, label: "运行中", testLabel: "过滤:运行中" },
            { value: "stopped" as StateFilter, label: "已停止", testLabel: "过滤:已停止" },
          ]}
          onChange={(value) => stateFilter.set(value)}
        />
      </Toolbar>

      {() =>
        listError() !== null && rows().length > 0 ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            <Notice message={`刷新失败，下面是上次的列表：${listError() ?? ""}`} tone="danger" />
          </View>
        ) : null
      }

      {() =>
        notice() === null ? null : (
          <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            <Notice message={notice() ?? ""} tone={noticeTone()} />
          </View>
        )
      }

      {() => (firstLoad() ? <Loading label="正在读取容器列表…" /> : null)}
      {() => (firstError() ? <LoadError message={listError() ?? ""} onRetry={() => void load()} /> : null)}
      {() => (firstLoad() || firstError() ? null : <SplitPane width={300} left={listPane()} right={detailPane()} />)}
    </View>
  );
}
