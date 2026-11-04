// Docker 容器进程页。
//
// 宿主已经删掉「原生资源工作台」，页面拿不到 selection 里的容器 id 了：
// 进页面先用 `docker/container/list` 拉容器列表，顶部搜索/列表选一个容器，
// 再用 `docker/container/top`（默认 ps -ef）读它的进程表。没选中容器时只给
// 引导空态，不发数据请求、也不报错。
//
// 列名随 ps 参数变化，所以表头按返回的 titles 动态生成，数字列等宽右对齐。
// `ps -ef` 不含单进程 CPU / 内存，副数据源 `docker/container/stats` 只用来在
// 工具条显示容器整体占用；它失败时静默降级，不影响进程表。
import { Scroll, signal, Text, View } from "nsh";
import type { JSX, TextStyle } from "nsh";
import { arr, errorMessage, humanBytes, str } from "../../lib/format";
import { invoke, SLOW_TIMEOUT_MS } from "../../lib/navop";
import { Badge, Button, Empty, LoadError, Loading, Notice, Row, SearchField } from "../../lib/ui";
import { c, hairline, r, t } from "../../lib/theme";

type ProcessRow = Record<string, unknown> | unknown[];
type ContainerRow = Record<string, unknown>;

type ColumnMeta = { width?: number; align?: "left" | "right" };

/** 列宽与对齐；没有登记的列平分剩余宽度，COMMAND / CMD 吃满剩余。 */
const COLUMNS: Record<string, ColumnMeta | undefined> = {
  UID: { width: 76 },
  USER: { width: 80 },
  PID: { width: 64, align: "right" },
  PPID: { width: 64, align: "right" },
  C: { width: 38, align: "right" },
  "%CPU": { width: 58, align: "right" },
  "%MEM": { width: 58, align: "right" },
  VSZ: { width: 84, align: "right" },
  RSS: { width: 84, align: "right" },
  NI: { width: 42, align: "right" },
  STAT: { width: 54 },
  STIME: { width: 84 },
  START: { width: 86 },
  TIME: { width: 86, align: "right" },
  TTY: { width: 58 },
  COMMAND: {},
  CMD: {},
};

/** 数字列走 t.mono；只有“命令行”用正文排版。 */
const NUMERIC = ["PID", "PPID", "C", "%CPU", "%MEM", "VSZ", "RSS", "NI", "TIME", "UID", "TTY", "STIME", "START"];

function alignOf(title: string): "left" | "right" {
  return COLUMNS[title]?.align ?? "left";
}

function cellStyle(title: string): TextStyle {
  const meta = COLUMNS[title];
  if (meta === undefined || meta.width === undefined) {
    return { flex: 1, minWidth: 0, textAlign: alignOf(title) };
  }
  return { width: meta.width, flexShrink: 0, textAlign: alignOf(title) };
}

/** ps 的单元格可能来自对象（titles 作键）或数组（与 titles 同序）。 */
function cell(row: ProcessRow, titles: string[], title: string): string {
  if (Array.isArray(row)) {
    const index = titles.indexOf(title);
    return index < 0 ? "" : String(row[index] ?? "");
  }
  const record = row as Record<string, unknown>;
  const direct = record[title];
  if (typeof direct === "string") return direct;
  if (typeof direct === "number") return String(direct);
  const key = Object.keys(record).find((name) => name.toLowerCase() === title.toLowerCase());
  if (key === undefined) return "";
  return str(record, key, "");
}

function inferTitles(rows: ProcessRow[]): string[] {
  const first = rows[0];
  if (first === undefined) return [];
  if (Array.isArray(first)) return first.map((_, index) => String(index));
  return Object.keys(first as Record<string, unknown>);
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

export default function Processes() {
  const rows = signal<ProcessRow[]>([]);
  const titles = signal<string[]>([]);
  const stats = signal<Record<string, unknown> | null>(null);
  const loading = signal(true);
  const error = signal<string | null>(null);
  const busy = signal(false);
  const selected = signal<number | null>(null);

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

  async function loadContainers() {
    containersLoading.set(true);
    try {
      const result = await invoke<{ containers?: ContainerRow[] } | ContainerRow[]>("docker/container/list", {}, { timeout: SLOW_TIMEOUT_MS });
      const list = Array.isArray(result) ? (result as ContainerRow[]) : (arr(result, "containers") as ContainerRow[]);
      containers.set(list);
      containersError.set(null);
      // 之前选中的容器不在了（被删/被过滤掉）：清空，别拿旧 id 继续请求。
      const current = selectedId();
      if (current !== null && !list.some((row) => containerId(row) === current)) clearSelection();
    } catch (failure) {
      containersError.set(errorMessage(failure));
    } finally {
      containersLoading.set(false);
    }
  }

  function resetData() {
    rows.set([]);
    titles.set([]);
    stats.set(null);
    selected.set(null);
    error.set(null);
  }

  function clearSelection() {
    selectedId.set(null);
    selectedName.set("");
    resetData();
    loading.set(false);
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
    void load();
  }

  function refresh() {
    if (selectedId() === null) void loadContainers();
    else void load();
  }

  // ---- 数据 ---------------------------------------------------------

  async function load() {
    const id = selectedId();
    if (id === null) return;
    const mine = ++seq;
    busy.set(true);
    if (rows().length === 0) loading.set(true);
    try {
      const result = await invoke<unknown>("docker/container/top", { id }, { timeout: SLOW_TIMEOUT_MS });
      if (mine !== seq) return;
      const list = Array.isArray(result) ? (result as ProcessRow[]) : (arr(result, "processes") as ProcessRow[]);
      const names = Array.isArray(result) ? [] : arr(result, "titles").map(String);
      rows.set(list);
      titles.set(names.length > 0 ? names : inferTitles(list));
      error.set(null);
      if (selected() !== null && selected()! >= list.length) selected.set(null);
    } catch (failure) {
      if (mine !== seq) return;
      error.set(errorMessage(failure));
    } finally {
      if (mine === seq) {
        loading.set(false);
        busy.set(false);
      }
    }
    void loadStats(id, mine);
  }

  /** 顺带取一次容器整体占用，失败不影响进程表。 */
  async function loadStats(id: string, mine: number) {
    try {
      const result = await invoke<Record<string, unknown> | null>("docker/container/stats", { id }, { timeout: SLOW_TIMEOUT_MS });
      if (mine !== seq) return;
      stats.set(result ?? null);
    } catch {
      if (mine === seq) stats.set(null);
    }
  }

  function statsLine(): string {
    const sample = stats();
    if (sample === null) return "";
    const cpu = Number(sample.cpu_percent);
    const cpuText = Number.isFinite(cpu) ? `${cpu.toFixed(1)}%` : "-";
    return `容器 CPU ${cpuText} · 内存 ${humanBytes(sample.memory_usage_bytes)} / ${humanBytes(sample.memory_limit_bytes)}`;
  }

  function selectedCommand(): string | null {
    const index = selected();
    if (index === null) return null;
    const row = rows()[index];
    if (row === undefined) return null;
    const names = titles();
    for (const title of names) {
      if (title === "CMD" || title === "COMMAND") {
        const value = cell(row, names, title);
        if (value.length > 0) return value;
      }
    }
    return null;
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

  // ---- 进程表 -------------------------------------------------------

  function tableHeader(): JSX.Element {
    const names = titles();
    return (
      <Row
        gap={0}
        style={{
          paddingHorizontal: 12,
          paddingVertical: 7,
          backgroundColor: c.panel(),
          borderBottomWidth: 1,
          borderBottomColor: c.line(),
          flexShrink: 0,
        }}
      >
        {names.map((title) => (
          <Text numberOfLines={1} style={{ ...t.label, ...cellStyle(title) }}>
            {title}
          </Text>
        ))}
      </Row>
    );
  }

  function tableRow(row: ProcessRow, names: string[], index: number): JSX.Element {
    // 选中态只写在 style 的 thunk 里，避免每次点行都让整个 body() 重建、滚回顶部。
    return (
      <View
        onPress={() => selected.set(selected() === index ? null : index)}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 0,
          paddingHorizontal: 12,
          paddingVertical: 5,
          backgroundColor: selected() === index ? c.hover() : "transparent",
          borderBottomWidth: 1,
          borderBottomColor: c.line(),
        }}
      >
        {names.map((title) => {
          const mono = NUMERIC.includes(title);
          const style = mono
            ? { ...t.mono, ...cellStyle(title) }
            : { fontSize: 12, color: c.text(), ...cellStyle(title) };
          return (
            <Text numberOfLines={1} style={style}>
              {cell(row, names, title)}
            </Text>
          );
        })}
      </View>
    );
  }

  function footer(): JSX.Element {
    const command = selectedCommand();
    return (
      <View
        style={{
          paddingHorizontal: 12,
          paddingVertical: 7,
          borderTopWidth: 1,
          borderTopColor: c.line(),
          backgroundColor: c.panel(),
          flexShrink: 0,
        }}
      >
        {command === null ? (
          <Text numberOfLines={1} style={t.meta}>
            {`${titles().length} 列来自 ps -ef；单进程 CPU / 内存不在 ps -ef 输出里，工具条显示的是容器整体占用。`}
          </Text>
        ) : (
          <Text numberOfLines={2} style={t.mono}>
            {command}
          </Text>
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
        hint={`连接里有 ${containers().length} 个容器：在上方列表里点一个，页面会读取它的进程表。`}
      />
    );
  }

  function body(): JSX.Element {
    if (selectedId() === null) return selectionGate();
    if (loading() && rows().length === 0) {
      return <Loading label="正在读取容器进程…" />;
    }
    if (error() !== null && rows().length === 0) {
      return <LoadError message={error() ?? ""} onRetry={() => void load()} />;
    }
    if (rows().length === 0) {
      return (
        <Empty
          title="容器里没有可见的进程"
          hint="ps -ef 返回了空列表：容器可能已停止，或者 PID 1 已经退出。可以刷新重试。"
          action={<Button label="重新读取" small onPress={() => void load()} />}
        />
      );
    }
    return (
      <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {error() === null ? null : (
          <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
            <Notice message={`刷新失败：${error() ?? ""}`} />
          </View>
        )}
        {tableHeader()}
        <Scroll style={{ flex: 1, minHeight: 0 }}>
          {rows().map((row, index) => tableRow(row, titles(), index))}
        </Scroll>
        {footer()}
      </View>
    );
  }

  function toolbar(): JSX.Element {
    const id = selectedId();
    return (
      <Row
        gap={8}
        style={{
          paddingHorizontal: 14,
          paddingVertical: 10,
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <Row gap={8}>
          <Text style={t.h1}>进程</Text>
          {id === null ? (
            <Text style={t.meta}>未选择容器</Text>
          ) : (
            <Text style={t.meta}>{`${rows().length} 个进程`}</Text>
          )}
          <Text style={t.meta}>{statsLine()}</Text>
        </Row>
        <Row gap={6}>
          {busy() ? <Text style={t.meta}>正在读取…</Text> : null}
          <Button label="刷新" small onPress={() => refresh()} />
        </Row>
      </Row>
    );
  }

  void loadContainers();

  return (
    <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", backgroundColor: c.bg() }}>
      {toolbar()}
      <View style={hairline()} />
      {containerBar()}
      {body()}
    </View>
  );
}
