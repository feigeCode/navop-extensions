// Docker 容器进程页：从容器工作台的「进程」shell 视图嵌入。
// 容器由宿主按 route 选中，页面不传容器 id；数据只走 dispatch。
//
// 主数据源 `containerTop`（provider 的 docker/container/top，默认 ps -ef）：
// 列名随 ps 参数变化，所以表头按返回的 titles 动态生成，数字列等宽右对齐。
// `ps -ef` 不含单进程 CPU / 内存，副数据源 `containerStats` 只用来在工具条
// 显示容器整体占用；它失败时静默降级，不影响进程表。
import { host, mount, Scroll, signal, Text, View } from "nsh";
import type { JSX, TextStyle } from "nsh";
import { arr, errorMessage, humanBytes, str } from "../../lib/format";
import { Button, Empty, LoadError, Loading, Notice, Row } from "../../lib/ui";
import { c, hairline, t } from "../../lib/theme";

type ProcessRow = Record<string, unknown> | unknown[];

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

/** 调一次工作台操作；把 provider 的失败折成一句人话。 */
async function dispatch(operationId: string, input?: unknown): Promise<unknown> {
  try {
    return await host.call("navop.workbench.dispatch", { operationId, input: input ?? {} });
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}

export default function Processes() {
  const rows = signal<ProcessRow[]>([]);
  const titles = signal<string[]>([]);
  const stats = signal<Record<string, unknown> | null>(null);
  const loading = signal(true);
  const error = signal<string | null>(null);
  const busy = signal(false);
  const selected = signal<number | null>(null);

  async function load() {
    if (busy()) return;
    busy.set(true);
    if (rows().length === 0) loading.set(true);
    try {
      const result = await dispatch("containerTop");
      const list = Array.isArray(result) ? (result as ProcessRow[]) : arr(result, "processes") as ProcessRow[];
      const names = Array.isArray(result) ? [] : arr(result, "titles").map(String);
      rows.set(list);
      titles.set(names.length > 0 ? names : inferTitles(list));
      error.set(null);
      if (selected() !== null && selected()! >= list.length) selected.set(null);
    } catch (failure) {
      error.set(errorMessage(failure));
    } finally {
      loading.set(false);
      busy.set(false);
    }
    void loadStats();
  }

  /** 顺带取一次容器整体占用，失败不影响进程表。 */
  async function loadStats() {
    try {
      const result = await dispatch("containerStats");
      stats.set((result as Record<string, unknown> | null) ?? null);
    } catch {
      stats.set(null);
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
          const command = title === "CMD" || title === "COMMAND";
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

  function body(): JSX.Element {
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

  void load();

  return (
    <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", backgroundColor: c.bg() }}>
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
          <Text style={t.meta}>{`${rows().length} 个进程`}</Text>
          <Text style={t.meta}>{statsLine()}</Text>
        </Row>
        <Row gap={6}>
          {busy() ? <Text style={t.meta}>正在读取…</Text> : null}
          <Button label="刷新" small onPress={() => void load()} />
        </Row>
      </Row>
      <View style={hairline()} />
      {body()}
    </View>
  );
}

mount(Processes);
