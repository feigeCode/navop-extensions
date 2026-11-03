// Docker 容器日志页。
//
// 宿主已经删掉「原生资源工作台」，页面拿不到 selection 里的容器 id 了：
// 进页面先用 `docker/container/list` 拉容器列表，顶部搜索/列表选一个容器，
// 再用 `docker/container/logs`（tail 是字符串）读它的日志。没选中容器时只给
// 引导空态，不请求日志、也不开自动刷新。
//
// 长行处理：**折行**，不做横向滚动。nsh 的 Text 没有 nowrap，横向滚动得把每
// 一行做成一条不可换行的 Text（2000 行就是 2000 个节点）；折行只用一个 Text
// 节点，任何窗口宽度下都能读到完整内容。
//
// 渲染量：只把末尾 MAX_RENDER_LINES 行交给布局，footer 标注实际显示行数。

import { cleanup, effect, mount, Scroll, signal, Text, View } from "nsh";
import type { Accessor, JSX } from "nsh";
import { arr, errorMessage, str } from "../../lib/format";
import { call } from "../../lib/host";
import { Badge, Button, Empty, LoadError, Loading, Notice, Row, SearchField } from "../../lib/ui";
import { c, hairline, r, t } from "../../lib/theme";

type ContainerRow = Record<string, unknown>;

/** 自动刷新间隔（旧页 FOLLOW_MS 同值）。 */
const FOLLOW_MS = 2000;
/** 最多渲染的行数：只取日志末尾，避免一次性布局上万行。 */
const MAX_RENDER_LINES = 2000;

/** 尾行档位。「全部」是 provider 的硬上限（MAX_LOG_TAIL = 5000）。 */
const TAILS: Array<{ label: string; value: number }> = [
  { label: "100", value: 100 },
  { label: "200", value: 200 },
  { label: "500", value: 500 },
  { label: "1000", value: 1000 },
  { label: "全部", value: 5000 },
];

/** 把 provider 拼好的日志切成行；去掉末尾换行带来的空行。 */
function toLines(text: string): string[] {
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  return trimmed.length === 0 ? [] : trimmed.split("\n");
}

/** 本地时钟（HH:MM:SS），用于「更新于」。 */
function nowClock(): string {
  const now = new Date();
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
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

// ---- 容器列表 -------------------------------------------------------

const containerId = (row: ContainerRow): string => str(row, "id", "");
const containerName = (row: ContainerRow): string => str(row, "name", "");
const containerImage = (row: ContainerRow): string => str(row, "image", "");
const containerState = (row: ContainerRow): string => str(row, "state", "");

function stateTone(state: string): "ok" | "warn" | "danger" | "neutral" {
  if (state === "running") return "ok";
  if (state === "paused" || state === "restarting") return "warn";
  if (state === "exited" || state === "dead") return "danger";
  return "neutral";
}

export default function LogViewer() {
  const tail = signal(500);
  const raw = signal("");
  const loading = signal(true);
  const busy = signal(false);
  const error = signal<string | null>(null);
  const updatedAt = signal("");
  const follow = signal(false);
  const cleared = signal(false);

  const containers = signal<ContainerRow[]>([]);
  const containerQuery = signal("");
  const containersLoading = signal(true);
  const containersError = signal<string | null>(null);
  const selectedId = signal<string | null>(null);
  const selectedName = signal("");
  const pickerOpen = signal(true);

  // last-wins：只有最后一次请求的结果允许落到视图上（切容器时尤其重要）。
  let seq = 0;

  function visibleContainers(): ContainerRow[] {
    const needle = containerQuery().trim().toLowerCase();
    if (needle.length === 0) return containers();
    return containers().filter((row) =>
      `${containerName(row)} ${containerImage(row)}`.toLowerCase().includes(needle),
    );
  }

  function selectedSummary(): string {
    const id = selectedId();
    if (id === null) return "";
    const row = containers().find((item) => containerId(item) === id);
    return row === undefined ? selectedName() : `${containerName(row)} · ${containerImage(row)}`;
  }

  function resetData() {
    raw.set("");
    error.set(null);
    updatedAt.set("");
    cleared.set(false);
  }

  function clearSelection() {
    selectedId.set(null);
    selectedName.set("");
    resetData();
    loading.set(false);
    follow.set(false);
    pickerOpen.set(true);
  }

  function selectContainer(row: ContainerRow) {
    const id = containerId(row);
    if (id.length === 0) return;
    if (selectedId() === id) {
      pickerOpen.set(false);
      return;
    }
    selectedId.set(id);
    selectedName.set(containerName(row));
    pickerOpen.set(false);
    resetData();
    loading.set(true);
    void load(true);
  }

  async function loadContainers() {
    containersLoading.set(true);
    try {
      const result = await call<{ containers?: ContainerRow[] } | ContainerRow[]>("docker/container/list", {});
      const list = Array.isArray(result) ? (result as ContainerRow[]) : (arr(result, "containers") as ContainerRow[]);
      containers.set(list);
      containersError.set(null);
      const current = selectedId();
      if (current !== null && !list.some((row) => containerId(row) === current)) clearSelection();
    } catch (failure) {
      containersError.set(errorMessage(failure));
    } finally {
      containersLoading.set(false);
    }
  }

  async function load(force = false) {
    const id = selectedId();
    if (id === null) return;
    if (busy() && !force) return;
    const mine = ++seq;
    busy.set(true);
    if (raw() === "") loading.set(true);
    try {
      // provider 用 Value::as_str 读 tail，必须传字符串。
      const result = await call<unknown>("docker/container/logs", { id, tail: String(tail()) });
      if (mine !== seq) return;
      raw.set(str(result, "logs", ""));
      cleared.set(false);
      updatedAt.set(nowClock());
      error.set(null);
    } catch (failure) {
      if (mine !== seq) return;
      // 已有日志时保留旧内容，只把错误提示在日志上方。
      error.set(errorMessage(failure));
    } finally {
      if (mine === seq) {
        busy.set(false);
        loading.set(false);
      }
    }
  }

  function pickTail(value: number) {
    if (tail() === value) return;
    tail.set(value);
    void load(true);
  }

  // 自动刷新：开且已选容器时每 2 秒重取，关时由 cleanup 清掉定时器。
  effect(() => {
    if (!follow() || selectedId() === null) return;
    const timer = setInterval(() => {
      void load();
    }, FOLLOW_MS);
    cleanup(() => clearInterval(timer));
  });

  // 末尾 MAX_RENDER_LINES 行（每次读都从当前日志重新切）。
  function view() {
    const all = toLines(raw());
    const shown = all.slice(-MAX_RENDER_LINES);
    return {
      total: all.length,
      shown: shown.length,
      text: shown.join("\n"),
      truncated: all.length > shown.length,
    };
  }

  // ---- 容器选择区 ---------------------------------------------------

  function pickerList(): JSX.Element | null {
    if (!pickerOpen()) return null;
    return (
      <View
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          marginHorizontal: 14,
          marginBottom: 8,
          padding: 6,
          borderWidth: 1,
          borderColor: c.line(),
          borderRadius: r.card,
          backgroundColor: c.panel(),
        }}
      >
        {containersLoading() && containers().length === 0 ? (
          <Text style={t.meta}>正在读取容器列表…</Text>
        ) : containersError() !== null && containers().length === 0 ? (
          <Row gap={8}>
            <Text style={{ ...t.meta, color: c.danger() }}>{`容器列表读取失败：${containersError()}`}</Text>
            <Button label="重试" small onPress={() => void loadContainers()} />
          </Row>
        ) : visibleContainers().length === 0 ? (
          <Text style={t.meta}>
            {containers().length === 0 ? "这个连接里没有容器。" : "没有匹配的容器，换个关键词试试。"}
          </Text>
        ) : (
          <Scroll style={{ maxHeight: 168 }}>
            <View style={{ display: "flex", flexDirection: "column" }}>
              {visibleContainers().map((row) => containerOption(row))}
            </View>
          </Scroll>
        )}
      </View>
    );
  }

  function containerOption(row: ContainerRow): JSX.Element {
    const id = containerId(row);
    const state = containerState(row);
    return (
      <View
        onPress={() => selectContainer(row)}
        role="button"
        accessibilityLabel={`容器 ${containerName(row)}`}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 8,
          paddingVertical: 6,
          borderRadius: r.control,
          backgroundColor: selectedId() === id ? c.hover() : "transparent",
        }}
      >
        <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "500", color: c.text(), width: 180 }}>
          {containerName(row)}
        </Text>
        <Text numberOfLines={1} style={{ ...t.mono, fontSize: 11, color: c.muted(), flex: 1, minWidth: 0 }}>
          {containerImage(row)}
        </Text>
        <Badge text={state.length === 0 ? "unknown" : state} tone={stateTone(state)} />
      </View>
    );
  }

  function pickerToggle(): JSX.Element {
    return (
      <Button
        label={pickerOpen() ? "收起列表" : selectedId() === null ? "选择容器" : "切换容器"}
        small
        onPress={() => pickerOpen.set(!pickerOpen())}
      />
    );
  }

  function containerBar(): JSX.Element {
    return (
      <View style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <Row wrap gap={8} style={{ paddingHorizontal: 14, paddingBottom: pickerOpen() ? 6 : 10 }}>
          <SearchField
            value={containerQuery()}
            onChange={(text) => {
              containerQuery.set(text);
              if (!pickerOpen()) pickerOpen.set(true);
            }}
            placeholder="按名称 / 镜像过滤容器"
            width={280}
          />
          <Text style={t.meta}>{`${visibleContainers().length} / ${containers().length} 个容器`}</Text>
          {selectedId() === null ? (
            <Text style={t.meta}>未选择容器</Text>
          ) : (
            <Text numberOfLines={1} style={{ ...t.meta, color: c.text(), maxWidth: 360 }}>
              {selectedSummary()}
            </Text>
          )}
          <View style={{ flex: 1 }} />
          <Button label="刷新列表" small onPress={() => void loadContainers()} />
          {pickerToggle()}
        </Row>
        {pickerList()}
      </View>
    );
  }

  // ---- 工具条与日志 -------------------------------------------------

  function toolbar(): JSX.Element {
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          paddingHorizontal: 14,
          paddingVertical: 10,
          flexShrink: 0,
        }}
      >
        <Text style={{ ...t.h1, color: c.text() }}>容器日志</Text>
        {selectedId() === null ? (
          <Text style={{ ...t.meta, color: c.muted() }}>未选择容器</Text>
        ) : updatedAt() === "" ? null : (
          <Text style={{ ...t.meta, color: c.muted() }}>{`更新于 ${updatedAt()}`}</Text>
        )}
        <View style={{ flex: 1 }} />
        {selectedId() === null ? null : (
          <>
            <Text style={{ ...t.label, color: c.muted() }}>显示行数</Text>
            {TAILS.map((option) =>
              chip(option.label, () => tail() === option.value, () => pickTail(option.value), `行数 ${option.label}`),
            )}
            {chip(
              follow() ? "自动刷新 · 开" : "自动刷新 · 关",
              follow,
              () => follow.set(!follow()),
              "自动刷新",
            )}
            {chip("清屏", () => cleared(), () => cleared.set(true), "清屏")}
            <Button label="刷新" small onPress={() => void load(true)} />
          </>
        )}
      </View>
    );
  }

  function selectionGate(): JSX.Element {
    if (containersError() !== null && containers().length === 0) {
      return <LoadError message={containersError() ?? ""} onRetry={() => void loadContainers()} />;
    }
    if (containersLoading() && containers().length === 0) {
      return <Loading label="正在读取容器列表…" />;
    }
    if (containers().length === 0) {
      return (
        <Empty
          title="这个连接里没有容器"
          hint="docker/container/list 返回了空列表（包含已停止的容器）：先在 Docker 里创建或启动一个容器。"
          action={<Button label="重新读取容器列表" small onPress={() => void loadContainers()} />}
        />
      );
    }
    return (
      <Empty
        title="先选择一个容器"
        hint={`连接里有 ${containers().length} 个容器：在上方列表里点一个，页面会读取它的日志。`}
      />
    );
  }

  function body(): JSX.Element {
    if (selectedId() === null) return selectionGate();
    return (
      <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {error() !== null && raw() !== "" ? (
          <Row
            gap={8}
            style={{
              alignItems: "center",
              paddingHorizontal: 14,
              paddingTop: 8,
              flexWrap: "wrap",
            }}
          >
            <Notice message={`刷新失败：${error()}`} />
            <Button label="重试" small onPress={() => void load(true)} />
          </Row>
        ) : null}

        {error() !== null && raw() === "" ? (
          <LoadError message={error() ?? ""} onRetry={() => void load(true)} />
        ) : loading() && raw() === "" ? (
          <Loading label="正在读取容器日志…" />
        ) : cleared() || toLines(raw()).length === 0 ? (
          <Empty
            title={cleared() ? "已清屏" : "暂无日志"}
            hint={
              cleared()
                ? "点「刷新」重新读取；自动刷新开着时 2 秒后自动恢复。"
                : "这个容器在所选行数内没有输出日志，试试更大的行数。"
            }
          />
        ) : (
          <Scroll style={{ flex: 1, minHeight: 0 }}>
            <View style={{ padding: 12 }}>
              <Text selectable style={{ ...t.mono, color: c.text(), lineHeight: 18 }}>
                {view().text}
              </Text>
            </View>
          </Scroll>
        )}
      </View>
    );
  }

  function footer(): JSX.Element {
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          paddingHorizontal: 14,
          paddingVertical: 6,
          borderTopWidth: 1,
          borderColor: c.line(),
          flexShrink: 0,
        }}
      >
        <Text style={{ ...t.meta, color: c.muted() }}>
          {selectedId() === null
            ? "选择容器后显示日志行数"
            : view().total === 0
              ? "没有可显示的行"
              : view().truncated
                ? `显示最后 ${view().shown} 行（共 ${view().total} 行，已省略前 ${view().total - view().shown} 行）`
                : `显示最后 ${view().shown} 行`}
        </Text>
        <View style={{ flex: 1 }} />
        <Text style={{ ...t.meta, color: c.muted() }}>
          {tail() === 5000 ? "tail 全部（provider 上限 5000）" : `tail ${tail()}`}
        </Text>
        <Text style={{ ...t.meta, color: c.muted() }}>长行自动折行 · 可选中复制</Text>
      </View>
    );
  }

  void loadContainers();

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
      {toolbar()}
      <View style={hairline()} />
      {containerBar()}
      {body()}
      {footer()}
    </View>
  );
}

mount(LogViewer);
