// Docker 容器详情页（从容器工作台嵌入）。
//
// 数据只有一条：`inspectContainer`。容器由宿主 selection 决定，页面不传容器
// id —— 缺 selection 时宿主直接报错，这里把原始错误显示出来（不猜容器）。
//
// 视图是一组可折叠分组（基础 / 网络 / 挂载 / 环境变量 / 资源限制），外加一个
// 「查看原始 JSON」开关：分组便于扫读，原始 JSON 用于核对 provider 没展开的
// 字段；原始视图只渲染前 RAW_MAX_LINES 行。

import { host, mount, signal, Scroll, Text, View } from "nsh";
import type { Accessor, JSX } from "nsh";
import { errorMessage, humanBytes, joinCommand, shortTime } from "../../lib/format";
import { Badge, Button, Empty, LoadError, Loading, Notice } from "../../lib/ui";
import { c, panel, r, t } from "../../lib/theme";

/** 原始 JSON 最多渲染的行数（超出部分不交给布局）。 */
const RAW_MAX_LINES = 800;

type Doc = Record<string, unknown>;

/** 按路径取字段；中途不是对象就给 undefined。 */
function pick(source: unknown, ...path: string[]): unknown {
  let node: unknown = source;
  for (const key of path) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return undefined;
    node = (node as Doc)[key];
  }
  return node;
}

/** 按路径取对象；不是对象就给空对象。 */
function objOf(source: unknown, ...path: string[]): Doc {
  const value = pick(source, ...path);
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Doc) : {};
}

/** 按路径取数组；不是数组就给空数组。 */
function listOf(source: unknown, ...path: string[]): unknown[] {
  const value = pick(source, ...path);
  return Array.isArray(value) ? value : [];
}

/** 任意 JSON 值 → 一行可读文本。 */
function text(value: unknown, fallback = "-"): string {
  if (typeof value === "string") return value.length > 0 ? value : fallback;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : fallback;
  if (typeof value === "boolean") return value ? "是" : "否";
  return fallback;
}

/** docker 的 Name 带前导 `/`。 */
function containerName(doc: Doc): string {
  const name = text(pick(doc, "Name"), "");
  return name.startsWith("/") ? name.slice(1) : name === "" ? "-" : name;
}

/** `NetworkSettings.Ports` → 行：`0.0.0.0:8080 → 80/tcp`，无绑定写「仅暴露」。 */
function portLines(ports: unknown): string[] {
  if (!ports || typeof ports !== "object" || Array.isArray(ports)) return [];
  const lines: string[] = [];
  for (const [containerPort, bindings] of Object.entries(ports as Doc)) {
    if (!Array.isArray(bindings) || bindings.length === 0) {
      lines.push(`${containerPort}（仅暴露）`);
      continue;
    }
    for (const binding of bindings) {
      const hostIp = text(pick(binding, "HostIp"), "") || "0.0.0.0";
      const hostPort = text(pick(binding, "HostPort"), "-");
      lines.push(`${hostIp}:${hostPort} → ${containerPort}`);
    }
  }
  return lines.sort();
}

/** 内存类限额：0 / 缺失 = 不限。 */
function limitText(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? humanBytes(number) : "不限";
}

/** Swap：-1 表示显式不限，0 表示没单独设置。 */
function swapText(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "未单独设置";
  if (number < 0) return "不限";
  return humanBytes(number);
}

/** CPU 配额：优先 NanoCpus，回退 CpuQuota / CpuPeriod；0 = 不限。 */
function cpuText(hostConfig: Doc): string {
  const nano = Number(pick(hostConfig, "NanoCpus"));
  if (Number.isFinite(nano) && nano > 0) return `${(nano / 1e9).toFixed(2)} 核`;
  const quota = Number(pick(hostConfig, "CpuQuota"));
  const period = Number(pick(hostConfig, "CpuPeriod"));
  if (Number.isFinite(quota) && quota > 0 && Number.isFinite(period) && period > 0) {
    return `${(quota / period).toFixed(2)} 核`;
  }
  return "不限";
}

/** 重启策略：`no` / `always` / `unless-stopped` / `on-failure[:n]`。 */
function restartText(policy: unknown): string {
  const name = text(pick(policy, "Name"), "");
  if (name === "" || name === "no") return "no（不自动重启）";
  const retries = Number(pick(policy, "MaximumRetryCount"));
  if (name === "on-failure" && Number.isFinite(retries) && retries > 0) {
    return `on-failure（最多 ${retries} 次）`;
  }
  return name;
}

/** 状态 → Badge 语气。 */
function statusTone(status: string): "ok" | "warn" | "danger" | "info" | "neutral" {
  if (status === "running") return "ok";
  if (status === "paused" || status === "restarting" || status === "removing") return "warn";
  if (status === "exited" || status === "dead") return "danger";
  if (status === "created") return "info";
  return "neutral";
}

/** 小按钮：`active` 用 accessor，样式读的是当前值（写在 style 绑定里才响应式）。 */
function chip(
  label: string,
  active: Accessor<boolean>,
  onPress: () => void,
  testLabel?: string,
): JSX.Element {
  return (
    <View
      onPress={onPress}
      role="button"
      accessibilityLabel={testLabel ?? label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: r.control,
        borderWidth: 1,
        borderColor: active() ? c.accent() : c.line(),
        backgroundColor: active() ? c.accent() : "transparent",
      }}
    >
      <Text style={{ ...t.meta, color: active() ? c.accentText() : c.text() }}>{label}</Text>
    </View>
  );
}

/** 一行「标签 / 值」；`truncate` 的值单行省略但可选中复制完整内容。 */
function Field(props: { label: string; value: string; mono?: boolean; truncate?: boolean }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 16,
        paddingVertical: 4,
      }}
    >
      <Text style={{ ...t.meta, color: c.muted(), width: 88, flexShrink: 0 }}>{props.label}</Text>
      <Text
        selectable={props.truncate === true}
        numberOfLines={props.truncate === true ? 1 : 0}
        ellipsizeMode="middle"
        style={{
          flex: 1,
          minWidth: 0,
          textAlign: "right",
          ...(props.mono === true ? t.mono : t.body),
          color: c.text(),
        }}
      >
        {props.value}
      </Text>
    </View>
  );
}

/** 分组的折叠区：标题行可点，内容只在展开时构建（数据变化会重建）。 */
function Section(props: {
  title: string;
  hint?: string;
  open: Accessor<boolean>;
  onToggle: () => void;
  body: () => JSX.Element;
}) {
  return (
    <View style={{ ...panel(0), padding: 0, overflow: "hidden" }}>
      <View
        onPress={props.onToggle}
        role="button"
        accessibilityLabel={`${props.title}分组`}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 14,
          paddingVertical: 10,
        }}
      >
        <Text style={{ ...t.h2, color: props.open() ? c.text() : c.muted() }}>
          {props.open() ? "▾" : "▸"}
        </Text>
        <Text style={{ ...t.h2, color: c.text() }}>{props.title}</Text>
        {props.hint === undefined ? null : (
          <Text style={{ ...t.meta, color: c.muted() }}>{props.hint}</Text>
        )}
        <View style={{ flex: 1 }} />
        <Text style={{ ...t.meta, color: c.muted() }}>{props.open() ? "收起" : "展开"}</Text>
      </View>
      {props.open() ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: 12, paddingTop: 2, display: "flex", flexDirection: "column", gap: 6 }}>
          {props.body()}
        </View>
      ) : null}
    </View>
  );
}

/** 端口映射块：每行一个绑定。 */
function PortLines(props: { ports: unknown }) {
  const lines = portLines(props.ports);
  if (lines.length === 0) {
    return <Text style={{ ...t.meta, color: c.muted() }}>没有端口映射</Text>;
  }
  return (
    <View style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {lines.map((line) => (
        <Text selectable style={{ ...t.mono, color: c.text() }}>
          {line}
        </Text>
      ))}
    </View>
  );
}

export default function ContainerInspect() {
  const data = signal<Doc | null>(null);
  const loading = signal(true);
  const busy = signal(false);
  const error = signal<string | null>(null);
  const updatedAt = signal("");
  const showRaw = signal(false);
  // 默认展开「基础」「网络」，其余收起。
  const openBasic = signal(true);
  const openNetwork = signal(true);
  const openMounts = signal(false);
  const openEnv = signal(false);
  const openLimits = signal(false);

  let seq = 0;

  async function load() {
    const mine = ++seq;
    busy.set(true);
    if (data() === null) loading.set(true);
    try {
      const result = await host.call("navop.workbench.dispatch", {
        operationId: "inspectContainer",
        input: {},
      });
      if (mine !== seq) return;
      data.set(result && typeof result === "object" && !Array.isArray(result) ? (result as Doc) : null);
      updatedAt.set(clock());
      error.set(null);
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

  void load();

  const status = () => text(pick(data() ?? {}, "State", "Status"), "unknown");
  const health = () => text(pick(data() ?? {}, "State", "Health", "Status"), "");

  function basicBody(): JSX.Element {
    const doc = data() ?? {};
    const state = objOf(doc, "State");
    const config = objOf(doc, "Config");
    const hostConfig = objOf(doc, "HostConfig");
    const startedAt = text(pick(state, "StartedAt"), "");
    return (
      <View style={{ display: "flex", flexDirection: "column" }}>
        <Field label="容器 ID" value={text(pick(doc, "Id"))} mono truncate />
        <Field label="名称" value={containerName(doc)} />
        <Field label="镜像" value={text(pick(doc, "Image"))} mono truncate />
        <Field label="状态" value={health() === "" ? status() : `${status()}（健康检查 ${health()}）`} />
        <Field
          label="启动时间"
          value={startedAt === "" || startedAt.startsWith("0001-") ? "未启动" : shortTime(startedAt)}
        />
        <Field label="重启策略" value={restartText(pick(hostConfig, "RestartPolicy"))} />
        <Field label="启动命令" value={joinCommand(pick(config, "Cmd"))} mono />
        <Text style={{ ...t.meta, color: c.muted(), marginTop: 6 }}>
          长值单行省略；选中文本即可复制完整内容。
        </Text>
      </View>
    );
  }

  function networkBody(): JSX.Element {
    const doc = data() ?? {};
    const settings = objOf(doc, "NetworkSettings");
    const networks = objOf(settings, "Networks");
    const names = Object.keys(networks);
    if (names.length === 0) {
      return (
        <View style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Field label="IP 地址" value={text(pick(settings, "IPAddress"), "未分配")} mono />
          <Field label="网关" value={text(pick(settings, "Gateway"), "未分配")} mono />
          <Field label="MAC" value={text(pick(settings, "MacAddress"), "未分配")} mono />
          <View style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
            <Text style={{ ...t.meta, color: c.muted() }}>端口映射</Text>
            <PortLines ports={pick(settings, "Ports")} />
          </View>
        </View>
      );
    }
    return (
      <View style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {names.map((name) => {
          const network = objOf(networks, name);
          const bindings = pick(network, "Ports");
          return (
            <View style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Text style={{ ...t.h2, color: c.text() }}>{name}</Text>
              <Field label="IP 地址" value={text(pick(network, "IPAddress"), "未分配")} mono />
              <Field label="网关" value={text(pick(network, "Gateway"), "未分配")} mono />
              <Field label="MAC" value={text(pick(network, "MacAddress"), "未分配")} mono />
              {Array.isArray(bindings) && bindings.length > 0 ? (
                <View style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <Text style={{ ...t.meta, color: c.muted() }}>端口映射</Text>
                  <PortLines ports={bindings} />
                </View>
              ) : null}
            </View>
          );
        })}
        <View style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Text style={{ ...t.meta, color: c.muted() }}>端口映射</Text>
          <PortLines ports={pick(settings, "Ports")} />
        </View>
      </View>
    );
  }

  function mountsBody(): JSX.Element {
    const mounts = listOf(data() ?? {}, "Mounts");
    if (mounts.length === 0) {
      return <Text style={{ ...t.meta, color: c.muted() }}>没有挂载</Text>;
    }
    return (
      <View style={{ display: "flex", flexDirection: "column" }}>
        {mounts.map((mount, index) => {
          const readOnly = pick(mount, "RW") === false;
          const mode = text(pick(mount, "Mode"), "");
          return (
            <View
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 3,
                paddingVertical: 6,
                borderTopWidth: index === 0 ? 0 : 1,
                borderColor: c.line(),
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ ...t.meta, color: c.muted() }}>
                  {`${index + 1}. ${text(pick(mount, "Type"), "bind")}`}
                </Text>
                <Badge text={readOnly ? "只读 (ro)" : "读写 (rw)"} tone={readOnly ? "warn" : "ok"} />
                {mode === "" ? null : (
                  <Text style={{ ...t.meta, color: c.muted() }}>{`模式 ${mode}`}</Text>
                )}
              </View>
              <Text selectable style={{ ...t.mono, color: c.text() }}>
                {`${text(pick(mount, "Source"))} → ${text(pick(mount, "Destination"))}`}
              </Text>
            </View>
          );
        })}
      </View>
    );
  }

  function envBody(): JSX.Element {
    const env = listOf(data() ?? {}, "Config", "Env").map((entry) => String(entry));
    if (env.length === 0) {
      return <Text style={{ ...t.meta, color: c.muted() }}>没有环境变量</Text>;
    }
    return (
      <View style={{ display: "flex", flexDirection: "column" }}>
        {env.map((entry) => {
          const index = entry.indexOf("=");
          const key = index < 0 ? entry : entry.slice(0, index);
          const value = index < 0 ? "" : entry.slice(index + 1);
          return (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingVertical: 4,
                borderBottomWidth: 1,
                borderColor: c.line(),
              }}
            >
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={{ width: 200, flexShrink: 0, ...t.mono, color: c.muted() }}
              >
                {key}
              </Text>
              <Text
                selectable
                numberOfLines={1}
                ellipsizeMode="middle"
                style={{ flex: 1, minWidth: 0, ...t.mono, color: c.text() }}
              >
                {value === "" ? "（空）" : value}
              </Text>
            </View>
          );
        })}
        <Text style={{ ...t.meta, color: c.muted(), marginTop: 6 }}>
          两列：变量名 / 值。值过长会省略；选中文本即可复制完整值。
        </Text>
      </View>
    );
  }

  function limitsBody(): JSX.Element {
    const hostConfig = objOf(data() ?? {}, "HostConfig");
    const pids = Number(pick(hostConfig, "PidsLimit"));
    return (
      <View style={{ display: "flex", flexDirection: "column" }}>
        <Field label="CPU 配额" value={cpuText(hostConfig)} mono />
        <Field
          label="CPU 权重"
          value={Number(pick(hostConfig, "CpuShares")) > 0 ? text(pick(hostConfig, "CpuShares")) : "不限（默认权重）"}
          mono
        />
        <Field label="内存限制" value={limitText(pick(hostConfig, "Memory"))} mono />
        <Field label="Swap" value={swapText(pick(hostConfig, "MemorySwap"))} mono />
        <Field
          label="进程数上限"
          value={Number.isFinite(pids) && pids > 0 ? String(pids) : "不限"}
          mono
        />
        <Field label="只读根文件系统" value={pick(hostConfig, "ReadonlyRootfs") === true ? "是" : "否"} />
      </View>
    );
  }

  function rawBlock(): JSX.Element {
    const json = JSON.stringify(data() ?? {}, null, 2);
    const lines = json.split("\n");
    const shown = lines.slice(0, RAW_MAX_LINES);
    return (
      <View style={{ ...panel(12), gap: 6, display: "flex", flexDirection: "column" }}>
        <Text style={{ ...t.meta, color: c.muted() }}>
          {lines.length > RAW_MAX_LINES
            ? `原始 JSON · 共 ${lines.length} 行，仅渲染前 ${RAW_MAX_LINES} 行`
            : `原始 JSON · ${lines.length} 行`}
        </Text>
        <Text selectable style={{ ...t.mono, color: c.text(), lineHeight: 17 }}>
          {shown.join("\n")}
        </Text>
        <Text style={{ ...t.meta, color: c.muted() }}>长行自动折行 · 可选中复制</Text>
      </View>
    );
  }

  function sectionsBlock(): JSX.Element {
    const doc = data() ?? {};
    const mountCount = listOf(doc, "Mounts").length;
    const envCount = listOf(doc, "Config", "Env").length;
    const networkCount = Object.keys(objOf(doc, "NetworkSettings", "Networks")).length;
    return (
      <View style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Section
          title="基础"
          hint={containerName(doc)}
          open={openBasic}
          onToggle={() => openBasic.set(!openBasic())}
          body={basicBody}
        />
        <Section
          title="网络"
          hint={networkCount === 0 ? "无网络信息" : `${networkCount} 个网络`}
          open={openNetwork}
          onToggle={() => openNetwork.set(!openNetwork())}
          body={networkBody}
        />
        <Section
          title="挂载"
          hint={`${mountCount} 项`}
          open={openMounts}
          onToggle={() => openMounts.set(!openMounts())}
          body={mountsBody}
        />
        <Section
          title="环境变量"
          hint={`${envCount} 项`}
          open={openEnv}
          onToggle={() => openEnv.set(!openEnv())}
          body={envBody}
        />
        <Section
          title="资源限制"
          hint="CPU / 内存"
          open={openLimits}
          onToggle={() => openLimits.set(!openLimits())}
          body={limitsBody}
        />
      </View>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        backgroundColor: c.bg(),
      }}
    >
      {/* 工具条：标题 / 状态 / 刷新 / 原始 JSON 开关 */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderColor: c.line(),
        }}
      >
        <Text style={{ ...t.h1, color: c.text() }}>容器详情</Text>
        {data() === null ? null : <Badge text={status()} tone={statusTone(status())} />}
        {data() === null ? null : (
          <Text style={{ ...t.meta, color: c.muted() }}>{containerName(data() ?? {})}</Text>
        )}
        <View style={{ flex: 1 }} />
        <Text style={{ ...t.meta, color: c.muted() }}>
          {loading() ? "读取中…" : busy() ? "刷新中…" : updatedAt() === "" ? "" : `更新于 ${updatedAt()}`}
        </Text>
        <Button label="刷新" small onPress={() => void load()} />
        {chip(
          showRaw() ? "查看分组" : "查看原始 JSON",
          showRaw,
          () => showRaw.set(!showRaw()),
          "原始 JSON",
        )}
      </View>

      {/* 主体：三态 + 内容 */}
      <View style={{ flex: 1, minHeight: 0 }}>
        {data() === null && error() !== null ? (
          <LoadError message={error() ?? ""} onRetry={() => void load()} />
        ) : data() === null && loading() ? (
          <Loading label="正在读取容器详情…" />
        ) : data() === null ? (
          <Empty title="没有容器数据" hint="宿主没有返回 inspect 文档，试试刷新。" />
        ) : (
          <Scroll style={{ flex: 1, minHeight: 0 }}>
            <View style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              {error() === null ? null : (
                <Notice message={`刷新失败：${error()}`} tone="danger" />
              )}
              {showRaw() ? rawBlock() : sectionsBlock()}
            </View>
          </Scroll>
        )}
      </View>
    </View>
  );
}

/** 本地时钟（HH:MM:SS）。 */
function clock(): string {
  const now = new Date();
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
}

mount(ContainerInspect);
