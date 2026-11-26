// 服务器日志：底部双栏。左侧是按服务器保存的日志文件记录，右侧是所选
// 文件的输出、输出内搜索和跟随。结构参考 motty 的 remote_logs 面板。
import { cleanup, effect, Scroll, signal, Storage, Text, View } from "nsh";
import {
  Editor,
  Input,
  type EditorRef,
  type EditorSearchResult,
} from "nsh/base";
import { Button, Empty, IconButton, Loading, Notice, Row } from "../../lib/ui";
import { c, r, t } from "../../lib/theme";
import { errorMessage } from "../../lib/format";
import {
  commandFailure,
  listServerTargets,
  nowClock,
  runServerCommand,
  shellQuote,
  type ServerTarget,
} from "../../lib/server";

const FOLLOW_MS = 2000;
const MAX_RENDER_LINES = 1000;
const MAX_RECORDS = 64;
const STORAGE_PREFIX = "records:";

export type LogRecord = {
  id: string;
  name: string;
  path: string;
  lines: string;
  filter: string;
};

/** 行数只接受 1..=5000 的整数，解析失败回退 200。
 *
 * 存储里的记录是用户可改的（也来自旧版本），读回时必须和输入时一样收敛，
 * 否则这个值会被拼进 `tail -n` 命令。
 */
function clampLines(value: string): string {
  const parsed = parseInt(value, 10);
  const lines = isNaN(parsed) ? 200 : Math.min(5000, Math.max(1, parsed));
  return String(lines);
}

export function parseRecords(json: string | null): LogRecord[] {
  if (!json) return [];
  try {
    const value = JSON.parse(json) as unknown;
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      const record = item as Partial<LogRecord>;
      if (typeof record.id !== "string" || typeof record.path !== "string") return [];
      if (!record.path.startsWith("/")) return [];
      return [
        {
          id: record.id,
          name: typeof record.name === "string" && record.name ? record.name : record.path,
          path: record.path,
          lines: clampLines(typeof record.lines === "string" ? record.lines : "200"),
          filter: typeof record.filter === "string" ? record.filter : "",
        },
      ];
    });
  } catch {
    return [];
  }
}

export function serializeRecords(records: LogRecord[]): string {
  return JSON.stringify(records);
}

export function normalizeRecord(record: Omit<LogRecord, "id">): Omit<LogRecord, "id"> {
  return {
    name: record.name.trim() || record.path.trim(),
    path: record.path.trim(),
    lines: clampLines(record.lines),
    filter: record.filter,
  };
}

export function recordValidationError(
  draft: Omit<LogRecord, "id">,
  records: LogRecord[],
  editingId: string | "new" | null,
): string | null {
  if (!draft.path.startsWith("/")) return "日志文件必须使用以 / 开头的绝对路径";
  if (records.length >= MAX_RECORDS && editingId === "new") return `最多保存 ${MAX_RECORDS} 条记录`;
  const duplicate = records.some(
    (record) => record.path === draft.path && record.id !== editingId,
  );
  return duplicate ? "这个日志文件已经有记录了" : null;
}

export function logCommand(path: string, lines: string, filter: string): string {
  // `lines` 会直接进入 shell 命令，这里再收敛一次，避免绕过记录校验的调用方。
  let command = `tail -n ${clampLines(lines)} ${shellQuote(path)}`;
  const needle = filter.trim();
  if (needle.length > 0) command += ` | grep -i -F -- ${shellQuote(needle)}`;
  return command;
}

function Field(props: {
  value: string;
  placeholder: string;
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <View
      style={{
        height: 28,
        paddingHorizontal: 8,
        borderRadius: r.control,
        backgroundColor: c.hover(),
        justifyContent: "center",
      }}
    >
      <Input
        value={props.value}
        placeholder={props.placeholder}
        accessibilityLabel={props.label}
        onChange={(event) => props.onChange(event.value)}
        style={{
          fontSize: 12,
          color: c.text(),
          placeholderColor: c.muted(),
          caretColor: c.text(),
          borderWidth: 0,
          backgroundColor: "transparent",
        }}
      />
    </View>
  );
}

export default function ServerLogs() {
  const targets = signal<ServerTarget[]>([]);
  const targetId = signal<string | null>(null);
  const records = signal<LogRecord[]>([]);
  const selectedId = signal<string | null>(null);
  const editing = signal<string | "new" | null>(null);
  const formName = signal("");
  const formPath = signal("");
  const formLines = signal("200");
  const formFilter = signal("");
  const formError = signal<string | null>(null);
  const content = signal("");
  const query = signal("");
  const caseSensitive = signal(false);
  const wholeWord = signal(false);
  const regex = signal(false);
  const searchResult = signal<EditorSearchResult>({ count: 0 });
  let editor: EditorRef | undefined;
  const loading = signal(false);
  const busy = signal(false);
  const error = signal<string | null>(null);
  const follow = signal(true);
  const updatedAt = signal("");
  let seq = 0;

  function currentTarget(): ServerTarget | null {
    return targets().find((item) => item.sessionId === targetId()) ?? targets()[0] ?? null;
  }

  function storageKey(): string {
    return STORAGE_PREFIX + (currentTarget()?.label ?? "default");
  }

  function selected(): LogRecord | null {
    return records().find((record) => record.id === selectedId()) ?? null;
  }

  async function persist(next: LogRecord[]) {
    records.set(next);
    await Storage.setItem(storageKey(), serializeRecords(next));
  }

  async function loadRecords() {
    const stored = parseRecords(await Storage.getItem(storageKey()));
    records.set(stored);
    selectedId.set(stored[0]?.id ?? null);
    content.set("");
    error.set(null);
    if (stored.length > 0) await load(true);
  }

  async function load(force = false) {
    const target = currentTarget();
    const record = selected();
    if (!target || !record) return;
    if (busy() && !force) return;
    const mine = ++seq;
    busy.set(true);
    try {
      const result = await runServerCommand(
        target,
        logCommand(record.path, record.lines, record.filter),
      );
      if (mine !== seq) return;
      const failure = commandFailure(result, "读取日志失败");
      if (failure !== null) {
        error.set(failure);
      } else {
        content.set(result.stdout);
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

  async function init() {
    loading.set(true);
    try {
      const list = await listServerTargets();
      targets.set(list);
      if (list.length > 0 && targetId() === null) targetId.set(list[0].sessionId);
    } catch (failure) {
      error.set(errorMessage(failure));
    }
    try {
      await loadRecords();
    } catch (failure) {
      error.set(errorMessage(failure));
    } finally {
      loading.set(false);
    }
  }

  async function selectTarget(id: string) {
    if (targetId() === id) return;
    targetId.set(id);
    seq += 1;
    busy.set(false);
    await loadRecords();
  }

  function selectRecord(id: string) {
    if (selectedId() === id) return;
    selectedId.set(id);
    editing.set(null);
    content.set("");
    error.set(null);
    void load(true);
  }

  function openEditor(mode: "new" | "edit") {
    const record = selected();
    formError.set(null);
    if (mode === "edit" && record) {
      formName.set(record.name);
      formPath.set(record.path);
      formLines.set(record.lines);
      formFilter.set(record.filter);
      editing.set(record.id);
      return;
    }
    formName.set("");
    formPath.set("");
    formLines.set("200");
    formFilter.set("");
    editing.set("new");
  }

  async function saveRecord() {
    const draft = normalizeRecord({
      name: formName(),
      path: formPath(),
      lines: formLines(),
      filter: formFilter(),
    });
    const invalid = recordValidationError(draft, records(), editing());
    if (invalid !== null) {
      formError.set(invalid);
      return;
    }
    const mode = editing();
    const next =
      mode === "new"
        ? [...records(), { ...draft, id: `log-${Date.now()}` }]
        : records().map((record) => (record.id === mode ? { ...draft, id: record.id } : record));
    await persist(next);
    editing.set(null);
    const saved = mode === "new" ? next[next.length - 1] : next.find((record) => record.id === mode);
    if (saved) {
      selectedId.set(saved.id);
      content.set("");
      void load(true);
    }
  }

  async function removeSelected() {
    const record = selected();
    if (!record) return;
    const next = records().filter((item) => item.id !== record.id);
    await persist(next);
    selectedId.set(next[0]?.id ?? null);
    content.set("");
    error.set(null);
    if (next.length > 0) void load(true);
  }

  effect(() => {
    if (!follow()) return;
    const timer = setInterval(() => void load(), FOLLOW_MS);
    cleanup(() => clearInterval(timer));
  });

  void init();

  const shownLines = () => {
    const text = content();
    if (text.length === 0) return [];
    const all = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
    return all.slice(-MAX_RENDER_LINES);
  };

  const shownText = () => shownLines().join("\n");
  const searchSummary = () => {
    if (!query()) return "";
    const result = searchResult();
    if (result.error) return "正则表达式无效";
    if (result.count === 0) return "没有匹配";
    return result.current === undefined || result.current === null
      ? `${result.count} 处匹配`
      : `${result.current + 1} / ${result.count}`;
  };

  return (
    <View style={{ flex: 1, minHeight: 0, minWidth: 0, flexDirection: "column", backgroundColor: c.bg() }}>
      <Row
        gap={8}
        style={{
          height: 40,
          paddingHorizontal: 12,
          borderBottomWidth: 1,
          borderBottomColor: c.line(),
          flexShrink: 0,
        }}
      >
        <Text style={{ ...t.h2, flexShrink: 0 }}>服务器日志</Text>
        <Text style={{ ...t.meta, flex: 1, minWidth: 0 }}>{currentTarget()?.label ?? "未连接"}</Text>
        <Button
          label={follow() ? "停止跟随" : "跟随"}
          small
          tone={follow() ? "primary" : "ghost"}
          onPress={() => follow.set(!follow())}
        />
        <IconButton glyph="⟳" label="刷新日志" onPress={() => void load(true)} disabled={busy()} />
      </Row>

      {targets().length > 1 ? (
        <Scroll horizontal style={{ flexShrink: 0, maxHeight: 38 }}>
          <Row gap={6} style={{ paddingHorizontal: 12, paddingVertical: 5 }}>
            {targets().map((item) => (
              <Button
                label={item.label}
                small
                tone={item.sessionId === currentTarget()?.sessionId ? "primary" : "ghost"}
                onPress={() => void selectTarget(item.sessionId)}
              />
            ))}
          </Row>
        </Scroll>
      ) : null}

      <Row align="stretch" style={{ flex: 1, minHeight: 0, minWidth: 0, gap: 0 }}>
        <View
          style={{
            width: 230,
            flexShrink: 0,
            minHeight: 0,
            borderRightWidth: 1,
            borderRightColor: c.line(),
            flexDirection: "column",
          }}
        >
          <Row style={{ height: 38, paddingHorizontal: 8, justifyContent: "space-between", flexShrink: 0 }}>
            <Text style={t.label}>日志文件</Text>
            <IconButton glyph="+" label="新建记录" onPress={() => openEditor("new")} />
          </Row>
          <Scroll style={{ flex: 1, minHeight: 0 }}>
            <View style={{ paddingHorizontal: 6, paddingBottom: 6, flexDirection: "column", gap: 3 }}>
              {records().map((record) => (
                <View
                  role="button"
                  accessibilityLabel={record.name}
                  onPress={() => selectRecord(record.id)}
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 7,
                    borderRadius: r.control,
                    backgroundColor: record.id === selectedId() ? c.hover() : "transparent",
                    flexDirection: "column",
                    gap: 2,
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: "500", color: c.text() }}>{record.name}</Text>
                  <Text style={{ ...t.mono, fontSize: 10, color: c.muted() }}>{record.path}</Text>
                </View>
              ))}
              {records().length === 0 && !loading() ? (
                <Text style={{ ...t.meta, padding: 8 }}>还没有记录，点右上角 + 新建。</Text>
              ) : null}
            </View>
          </Scroll>
        </View>

        <View style={{ flex: 1, minWidth: 0, minHeight: 0, flexDirection: "column" }}>
          {selected() !== null && editing() === null ? (
            <Row gap={6} style={{ paddingHorizontal: 10, paddingVertical: 7, flexShrink: 0 }}>
              <Text style={{ ...t.meta, flex: 1, minWidth: 0 }}>
                {`${selected()?.path} · ${selected()?.lines} 行${selected()?.filter ? ` · 过滤 ${selected()?.filter}` : ""}`}
              </Text>
              <Button label="编辑" small onPress={() => openEditor("edit")} />
              <Button label="删除" small tone="danger" onPress={() => void removeSelected()} />
            </Row>
          ) : null}

          {editing() !== null ? (
            <View
              style={{
                margin: 10,
                padding: 10,
                borderWidth: 1,
                borderColor: c.line(),
                borderRadius: r.card,
                flexDirection: "column",
                gap: 7,
                flexShrink: 0,
              }}
            >
              <Text style={t.label}>{editing() === "new" ? "新建日志记录" : "编辑日志记录"}</Text>
              <Field value={formName()} placeholder="名称（如 nginx 错误日志）" label="日志记录名称" onChange={formName.set} />
              <Field value={formPath()} placeholder="绝对路径（如 /var/log/nginx/error.log）" label="日志文件路径" onChange={formPath.set} />
              <Field value={formLines()} placeholder="读取行数（默认 200）" label="日志读取行数" onChange={formLines.set} />
              <Field value={formFilter()} placeholder="远端过滤关键字（可空）" label="日志过滤关键字" onChange={formFilter.set} />
              {formError() !== null ? <Notice message={formError() ?? ""} tone="danger" /> : null}
              <Row gap={8}>
                <Button label="保存记录" small tone="primary" onPress={() => void saveRecord()} />
                <Button label="取消" small onPress={() => editing.set(null)} />
              </Row>
            </View>
          ) : null}

          {records().length > 0 ? (
            <View style={{ marginHorizontal: 10, marginBottom: 6, flexShrink: 0, gap: 5 }}>
              <Row gap={5}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Field value={query()} placeholder="搜索日志（支持正则）" label="搜索日志输出" onChange={query.set} />
                </View>
                <Button label="Aa" small tone={caseSensitive() ? "primary" : "ghost"} onPress={() => caseSensitive.set(!caseSensitive())} />
                <Button label="W" small tone={wholeWord() && !regex() ? "primary" : "ghost"} disabled={regex()} onPress={() => wholeWord.set(!wholeWord())} />
                <Button label=".*" small tone={regex() ? "primary" : "ghost"} onPress={() => regex.set(!regex())} />
                <IconButton glyph="↑" label="上一个匹配" disabled={!query() || searchResult().count === 0} onPress={() => editor?.run("findPrevious")} />
                <IconButton glyph="↓" label="下一个匹配" disabled={!query() || searchResult().count === 0} onPress={() => editor?.run("findNext")} />
                <Text style={t.meta}>{searchSummary()}</Text>
              </Row>
            </View>
          ) : null}

          {error() !== null ? (
            <View style={{ paddingHorizontal: 10, paddingBottom: 6 }}>
              <Notice message={error() ?? ""} tone="danger" />
            </View>
          ) : null}

          {records().length === 0 && !loading() ? (
            <Empty
              title="为这台服务器添加日志文件"
              hint="记录按服务器分别保存。名称用于识别，路径必须是服务器上的绝对路径。"
              action={<Button label="新建一条记录" small tone="primary" onPress={() => openEditor("new")} />}
            />
          ) : selected() === null ? (
            <Empty title="选择左侧的日志文件" />
          ) : loading() && content() === "" ? (
            <Loading label="正在读取日志…" />
          ) : (
            <View style={{ flex: 1, minHeight: 0 }}>
            <Editor
              style={{ flex: 1, minHeight: 0 }}
              ref={(ref) => (editor = ref)}
              value={shownText()}
              readOnly
              lineNumbers
              softWrap={false}
              folding={false}
              activeLine={false}
              completion={false}
              highlighting={false}
              fontSize={11}
              lineHeight={18}
              scrollBeyondLastLine={false}
              placeholder="（当前日志为空）"
              accessibilityLabel="服务器日志正文编辑器"
              search={{
                query: query(),
                caseSensitive: caseSensitive(),
                wholeWord: wholeWord(),
                regex: regex(),
              }}
              onSearchChange={({ result }) => searchResult.set(result)}
              onFindWithSelection={({ query: value }) => query.set(value)}
              styles={{
                content: { backgroundColor: c.bg(), padding: 6 },
                line: { color: c.text() },
                gutter: { backgroundColor: c.bg(), paddingRight: 6 },
                lineNumber: { color: c.muted(), fontSize: 10 },
              }}
            />
            </View>
          )}

          <Row style={{ paddingHorizontal: 10, paddingVertical: 5, flexShrink: 0, justifyContent: "space-between" }}>
            <Text style={t.meta}>{`${shownLines().length} 行`}</Text>
            <Text style={t.meta}>{updatedAt() ? `更新于 ${updatedAt()}` : ""}</Text>
          </Row>
        </View>
      </Row>
    </View>
  );
}
