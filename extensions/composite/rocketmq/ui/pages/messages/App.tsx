// RocketMQ 消息查询页：查询条件 → 结果表（时间倒序）→ 展开看消息体。
//
// 三个操作各有分工：messageId 优先（queryById）、其次 key（queryByKey）、
// 都没有时按时间窗口翻页（queryByTimeWindow）。时间窗口只对第三种生效。
//
// 数据全走 `navop.resource.invoke`，连接句柄由宿主写在 `host.params.connection`。
import { signal, Text, View } from "nsh";
import { Input } from "nsh/base";
import { invoke, SLOW_TIMEOUT_MS } from "../../lib/navop";
import { arr, errorMessage, humanBytes, str } from "../../lib/format";
import {
  Badge,
  Button,
  Card,
  Empty,
  KeyValue,
  LoadError,
  Loading,
  Notice,
  Row,
  SectionTitle,
  Stack,
} from "../../lib/ui";
import { c, r, t } from "../../lib/theme";

type Json = Record<string, unknown>;
type Mode = "id" | "key" | "time";
type WindowId = "15m" | "1h" | "1d" | "all";
type BodyMode = "pretty" | "raw";

interface TimeWindow {
  id: WindowId;
  label: string;
  ms: number;
}

/** 时间窗口预设；`all` 从 0 开始，等价于「不限起始时间」。 */
const WINDOWS: TimeWindow[] = [
  { id: "15m", label: "15 分钟", ms: 15 * 60 * 1000 },
  { id: "1h", label: "1 小时", ms: 60 * 60 * 1000 },
  { id: "1d", label: "1 天", ms: 24 * 60 * 60 * 1000 },
  { id: "all", label: "全部", ms: 0 },
];

/** provider 单页硬上限（admin.rs 里 page_size 会 clamp 到 100）。 */
const PAGE_SIZE = 100;
/** 页面最多累计 500 条，够翻 5 页。 */
const MAX_ROWS = 500;
/** 单条消息体最多渲染这么多字符，超出的截断并提示。 */
const MAX_BODY_CHARS = 20000;

interface Query {
  mode: Mode;
  topic: string;
  key: string;
  messageId: string;
  begin: number;
  end: number;
}

/** operationId → provider 方法名。
 *
 * 清单里的 `resourceWorkbenches` 已经不参与运行，这一层映射留在页面里：
 * 页面自己决定"要哪份数据"，宿主只负责把方法名和参数发给 provider。
 */
const OPERATIONS: Record<string, string> = {
  clusterOverview: "middleware/cluster/overview",
  createTopic: "middleware/topic/create",
  deleteTopic: "middleware/topic/delete",
  groupClients: "middleware/group/clients",
  groupDetail: "middleware/group/detail",
  listGroups: "middleware/group/list",
  listTopics: "middleware/topic/list",
  metrics: "middleware/metrics",
  queryById: "middleware/message/query",
  queryByKey: "middleware/message/query",
  queryByTimeWindow: "middleware/message/query",
  resetConsumerOffset: "rocketmq/consumer/reset-offset",
  sendMessage: "middleware/message/send",
  topicDetail: "middleware/topic/detail",
  updateTopic: "middleware/topic/update",
};

/** 调一次 provider 方法；把失败折成一句人话。`confirmed` 仅为兼容旧调用点。 */
async function dispatch(
  operationId: string,
  input?: unknown,
  _confirmed?: boolean,
): Promise<unknown> {
  const method = OPERATIONS[operationId];
  if (!method) throw new Error(`未知的操作：${operationId}`);
  try {
    // provider 可能要等 daemon / broker 回话，给慢档超时。
    return await invoke(method, (input as Record<string, unknown>) ?? {}, {
      timeout: SLOW_TIMEOUT_MS,
    });
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}

function asRecord(value: unknown): Json | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Json;
}

/** 数字字段：非数字或非有限值都给 null（provider 各版本字段不一致）。 */
function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function strOf(source: Json, key: string): string {
  const value = source[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** 展示用的时间：provider 给的是本地 `YYYY-MM-DD HH:mm:ss`，原样用，别二次解析。 */
function timeText(message: Json): string {
  const store = strOf(message, "store_time");
  if (store.length > 0) return store;
  const born = strOf(message, "born_time");
  return born.length > 0 ? born : "-";
}

function messageKey(message: Json): string {
  const id = strOf(message, "message_id");
  if (id.length > 0) return id;
  return `${timeText(message)}|${strOf(message, "topic")}|${strOf(message, "key")}`;
}

/** 消息体字节数：有原始字节就数字节，否则按 UTF-8 编码 body_text。 */
function bodySize(message: Json): number {
  const raw = message.body;
  if (Array.isArray(raw)) return raw.length;
  const text = typeof message.body_text === "string" ? message.body_text : "";
  return text.length === 0 ? 0 : new TextEncoder().encode(text).length;
}

/** 消息属性：provider 给的是 [[k, v], ...]，只保留成对的两项。 */
function propRows(message: Json): Array<[string, string]> {
  const raw = message["properties"];
  if (!Array.isArray(raw)) return [];
  const rows: Array<[string, string]> = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) continue;
    rows.push([String(item[0] ?? ""), String(item[1] ?? "")]);
  }
  return rows;
}

interface BodyInfo {
  text: string;
  json: boolean;
  binary: boolean;
}

/** 消息体：优先 body_text，否则把字节按严格 UTF-8 解码；解不出就是二进制。 */
function bodyOf(message: Json): BodyInfo {
  const field = typeof message.body_text === "string" ? message.body_text : "";
  let text = field;
  let binary = false;
  if (text.length === 0 && Array.isArray(message.body) && message.body.length > 0) {
    try {
      const bytes = new Uint8Array(message.body as number[]);
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      binary = true;
    }
  }
  if (text.includes("\u0000")) binary = true;
  const trimmed = text.trim();
  let json = false;
  if (!binary && (trimmed.startsWith("{") || trimmed.startsWith("["))) {
    try {
      JSON.parse(trimmed);
      json = true;
    } catch {
      json = false;
    }
  }
  return { text, json, binary };
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text.trim()), null, 2);
  } catch {
    return text;
  }
}

function hexPreview(message: Json, limit = 64): string {
  if (!Array.isArray(message.body)) return "";
  const total = message.body.length;
  const head = message.body
    .slice(0, limit)
    .map((byte) => (Number(byte) & 0xff).toString(16).padStart(2, "0"))
    .join(" ");
  return total > limit ? `${head} …（共 ${total} B）` : head;
}

/** 倒序合并并按 message_id 去重（翻页时 offset 可能漂移）。 */
function mergeRows(base: Json[], extra: Json[]): Json[] {
  const seen = new Set<string>();
  const merged: Json[] = [];
  for (const message of base.concat(extra)) {
    const key = messageKey(message);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(message);
  }
  merged.sort((left, right) => timeText(right).localeCompare(timeText(left)));
  return merged.slice(0, MAX_ROWS);
}

/** 带边框的输入框，标签在上。 */
function Field(props: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  placeholder: string;
  grow?: boolean;
  width?: number;
  onSubmit?: () => void;
}) {
  return (
    <View
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        ...(props.grow === true ? { flex: 1, minWidth: 0 } : { width: props.width ?? 200 }),
      }}
    >
      <Text style={t.label}>{props.label}</Text>
      <View
        style={{
          height: 30,
          paddingHorizontal: 9,
          borderRadius: r.control,
          borderWidth: 1,
          borderColor: c.line(),
          backgroundColor: c.bg(),
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <Input
          value={props.value}
          placeholder={props.placeholder}
          onChange={(text) => props.onChange(text)}
          onSubmit={() => props.onSubmit?.()}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            color: c.text(),
            paddingHorizontal: 0,
            borderWidth: 0,
            backgroundColor: "transparent",
          }}
        />
      </View>
    </View>
  );
}

export default function Messages() {
  const topic = signal("");
  const key = signal("");
  const messageId = signal("");
  const windowId = signal<WindowId>("1h");
  const querying = signal(false);
  const loadingMore = signal(false);
  const error = signal<string | null>(null);
  const formError = signal<string | null>(null);
  const rows = signal<Json[]>([]);
  const hasMore = signal(false);
  const pageNo = signal(1);
  // provider 回传的 total 只是本页条数，展示时如实标注，不当作全量总数。
  const pageTotal = signal<number | null>(null);
  const active = signal<Query | null>(null);
  const selected = signal<string | null>(null);
  const bodyMode = signal<BodyMode>("pretty");
  const loadedOnce = signal(false);

  const mode = (): Mode => {
    if (messageId().trim().length > 0) return "id";
    if (key().trim().length > 0) return "key";
    return "time";
  };

  const modeLabel = () => {
    const current = mode();
    if (current === "id") return "按 Message ID";
    if (current === "key") return "按 Key";
    return "按时间窗口";
  };

  function buildQuery(): Query | null {
    const topicText = topic().trim();
    if (topicText.length === 0) {
      formError.set("Topic 必填：RocketMQ 按 Topic 路由查询，三种查询方式都需要它。");
      return null;
    }
    const current = mode();
    const window = WINDOWS.find((item) => item.id === windowId()) ?? WINDOWS[0];
    const end = Date.now();
    return {
      mode: current,
      topic: topicText,
      key: key().trim(),
      messageId: messageId().trim(),
      begin: window.ms === 0 ? 0 : end - window.ms,
      end,
    };
  }

  async function fetchPage(
    query: Query,
    page: number,
  ): Promise<{ messages: Json[]; more: boolean; reported: number | null }> {
    let raw: unknown;
    if (query.mode === "id") {
      raw = await dispatch("queryById", {
        ById: { topic: query.topic, message_id: query.messageId },
      });
    } else if (query.mode === "key") {
      raw = await dispatch("queryByKey", { ByKey: { topic: query.topic, key: query.key } });
    } else {
      raw = await dispatch("queryByTimeWindow", {
        ByTimeWindow: {
          topic: query.topic,
          begin_unix_ms: query.begin,
          end_unix_ms: query.end,
          page,
          page_size: PAGE_SIZE,
        },
      });
    }
    const record = asRecord(raw);
    const messages = arr(raw, "messages")
      .map((item) => asRecord(item))
      .filter((item): item is Json => item !== null);
    const more = query.mode === "time" && record !== null && record.has_more === true;
    const reported = record === null ? null : asNumber(record["total"]);
    return { messages, more, reported };
  }

  async function search() {
    if (querying()) return;
    const query = buildQuery();
    if (query === null) return;
    formError.set(null);
    error.set(null);
    querying.set(true);
    try {
      const result = await fetchPage(query, 1);
      active.set(query);
      pageNo.set(1);
      hasMore.set(result.more && result.messages.length < MAX_ROWS);
      pageTotal.set(result.reported);
      rows.set(mergeRows([], result.messages));
      selected.set(null);
      bodyMode.set("pretty");
      loadedOnce.set(true);
    } catch (failure) {
      error.set(errorMessage(failure));
      rows.set([]);
      hasMore.set(false);
      selected.set(null);
    } finally {
      querying.set(false);
    }
  }

  async function loadMore() {
    const query = active();
    if (query === null || loadingMore() || querying()) return;
    if (!hasMore()) return;
    if (rows().length >= MAX_ROWS) return;
    loadingMore.set(true);
    error.set(null);
    try {
      const next = pageNo() + 1;
      const result = await fetchPage(query, next);
      pageNo.set(next);
      const merged = mergeRows(rows(), result.messages);
      rows.set(merged);
      hasMore.set(result.more && merged.length < MAX_ROWS);
      pageTotal.set(result.reported);
    } catch (failure) {
      error.set(errorMessage(failure));
    } finally {
      loadingMore.set(false);
    }
  }

  function toggle(message: Json) {
    const key = messageKey(message);
    if (selected() === key) {
      selected.set(null);
      return;
    }
    selected.set(key);
    bodyMode.set("pretty");
  }

  const textStyle = { ...t.mono, fontFamily: "monospace", lineHeight: 18 };

  function bodyView(message: Json) {
    const body = bodyOf(message);
    const tooLong = body.text.length > MAX_BODY_CHARS;
    const shown = tooLong ? body.text.slice(0, MAX_BODY_CHARS) : body.text;
    const display =
      body.binary
        ? hexPreview(message)
        : bodyMode() === "pretty" && body.json
          ? prettyJson(shown)
          : shown;
    const meta: Array<[string, string]> = [
      ["Message ID", strOf(message, "message_id") || "-"],
      ["Topic", strOf(message, "topic") || "-"],
      ["Tag", strOf(message, "tag") || "<无>"],
      ["Key", strOf(message, "key") || "<无>"],
      ["存储时间", strOf(message, "store_time") || "-"],
      ["生成时间", strOf(message, "born_time") || "-"],
      ["存储 Broker", strOf(message, "store_host") || "-"],
      ["生产者", strOf(message, "born_host") || "-"],
      ["重试次数", strOf(message, "retry_times") || "0"],
      ["消息体大小", humanBytes(bodySize(message))],
    ];
    return (
      <View
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: 12,
          backgroundColor: c.bg(),
          borderTopWidth: 1,
          borderTopColor: c.line(),
        }}
      >
        <Row gap={8} style={{ justifyContent: "space-between" }}>
          <Row gap={8}>
            <Text style={t.label}>消息体</Text>
            <Text style={t.meta}>{humanBytes(bodySize(message))}</Text>
            {body.binary ? (
              <Badge text="二进制" tone="warn" />
            ) : body.json ? (
              <Badge text="JSON" tone="ok" />
            ) : (
              <Badge text="文本" />
            )}
            {tooLong ? <Text style={t.meta}>已截断，仅显示前 {MAX_BODY_CHARS} 字符</Text> : null}
          </Row>
          {body.json && !body.binary ? (
            <Button
              small
              label={bodyMode() === "pretty" ? "原文" : "格式化"}
              onPress={() => bodyMode.set(bodyMode() === "pretty" ? "raw" : "pretty")}
            />
          ) : null}
        </Row>
        {body.binary ? (
          <Notice message="消息体不是合法 UTF-8 文本，按字节十六进制预览。" tone="warn" />
        ) : body.json ? null : (
          <Notice message="内容不是合法 JSON，按原文显示。" />
        )}
        <View
          style={{
            padding: 10,
            borderRadius: r.control,
            borderWidth: 1,
            borderColor: c.line(),
            backgroundColor: c.panel(),
          }}
        >
          <Text selectable style={textStyle}>
            {display.length > 0 ? display : "<空消息体>"}
          </Text>
        </View>
        <KeyValue columns={2} rows={meta} />
        {propRows(message).length === 0 ? null : (
          <View style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <SectionTitle title="消息属性" hint={`${propRows(message).length} 项`} />
            <KeyValue columns={2} rows={propRows(message)} />
          </View>
        )}
      </View>
    );
  }

  const headerCells = () => (
    <Row
      gap={10}
      style={{
        paddingVertical: 6,
        paddingHorizontal: 4,
        borderBottomWidth: 1,
        borderBottomColor: c.line(),
      }}
    >
      <Text numberOfLines={1} style={[t.label, { width: 140 }]}>
        时间
      </Text>
      <Text numberOfLines={1} style={[t.label, { flex: 1, minWidth: 0 }]}>
        Topic
      </Text>
      <Text numberOfLines={1} style={[t.label, { width: 130 }]}>
        Key
      </Text>
      <Text numberOfLines={1} style={[t.label, { width: 100 }]}>
        Tag
      </Text>
      <Text numberOfLines={1} style={[t.label, { width: 90, textAlign: "right" }]}>
        存储大小
      </Text>
      <Text numberOfLines={1} style={[t.label, { width: 60, textAlign: "right" }]}>
        重试
      </Text>
      <View style={{ width: 18 }} />
    </Row>
  );

  const resultBody = () => {
    if (querying() && rows().length === 0) return <Loading label="正在查询消息…" />;
    if (error() !== null && rows().length === 0) {
      return <LoadError message={error() ?? ""} onRetry={() => void search()} />;
    }
    if (rows().length === 0) {
      return (
        <Empty
          title={loadedOnce() ? "没有查询到消息" : "还没有查询结果"}
          hint={
            loadedOnce()
              ? "换个时间窗口，或确认 Topic / Key / Message ID 是否正确。"
              : "填写 Topic 后按时间窗口查询，或再填 Key / Message ID 精确查询。"
          }
        />
      );
    }
    return (
      <View style={{ display: "flex", flexDirection: "column" }}>
        {headerCells()}
        {rows().map((message) => (
          <View style={{ display: "flex", flexDirection: "column" }}>
            <View
              onPress={() => toggle(message)}
              style={{
                cursor: "pointer",
                backgroundColor: selected() === messageKey(message) ? c.hover() : "transparent",
                borderBottomWidth: 1,
                borderBottomColor: c.line(),
              }}
            >
              <Row gap={10} style={{ paddingVertical: 8, paddingHorizontal: 4 }}>
                <Text numberOfLines={1} style={[t.mono, { width: 140 }]}>
                  {timeText(message)}
                </Text>
                <Text numberOfLines={1} style={[{ flex: 1, minWidth: 0, fontSize: 12, color: c.text() }]}>
                  {strOf(message, "topic") || "-"}
                </Text>
                <Text numberOfLines={1} style={[t.mono, { width: 130 }]}>
                  {strOf(message, "key") || "-"}
                </Text>
                <Text numberOfLines={1} style={[t.mono, { width: 100, color: c.muted() }]}>
                  {strOf(message, "tag") || "-"}
                </Text>
                <Text numberOfLines={1} style={[t.mono, { width: 90, textAlign: "right" }]}>
                  {humanBytes(bodySize(message))}
                </Text>
                <Text numberOfLines={1} style={[t.mono, { width: 60, textAlign: "right" }]}>
                  {strOf(message, "retry_times") || "0"}
                </Text>
                <Text style={{ width: 18, fontSize: 11, color: c.muted(), textAlign: "right" }}>
                  {selected() === messageKey(message) ? "▾" : "▸"}
                </Text>
              </Row>
            </View>
            {selected() === messageKey(message) ? bodyView(message) : null}
          </View>
        ))}
      </View>
    );
  };

  const windowButtons = WINDOWS.map((item) => (
    <Button
      small
      label={item.label}
      tone={windowId() === item.id ? "primary" : "ghost"}
      onPress={() => windowId.set(item.id)}
    />
  ));

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
      <Row
        gap={8}
        style={{
          paddingHorizontal: 14,
          paddingVertical: 10,
          justifyContent: "space-between",
          borderBottomWidth: 1,
          borderBottomColor: c.line(),
        }}
      >
        <Row gap={8}>
          <Text style={t.h1}>消息查询</Text>
          <Badge text={modeLabel()} />
          <Text style={t.meta}>
            {rows().length === 0 ? "按时间窗口或 Key / ID 检索" : `已显示 ${rows().length} 条`}
          </Text>
        </Row>
        <Row gap={8}>
          <Text style={t.meta}>
            {querying() ? "查询中…" : rows().length > 0 ? `结果 ${rows().length} 条` : "未查询"}
          </Text>
        </Row>
      </Row>

      <Stack scroll padding={14} gap={12}>
        <Card title="查询条件" hint="messageId 优先，其次 key，否则按时间窗口">
          <Row gap={10} wrap align="flex-end">
            <Field
              label="Topic"
              value={topic()}
              onChange={(text) => topic.set(text)}
              placeholder="例如 order-topic"
              grow
              onSubmit={() => void search()}
            />
            <Field
              label="Message Key"
              value={key()}
              onChange={(text) => key.set(text)}
              placeholder="可选，用于按 Key 查"
              width={200}
              onSubmit={() => void search()}
            />
            <Field
              label="Message ID"
              value={messageId()}
              onChange={(text) => messageId.set(text)}
              placeholder="可选，例如 7F000001... 或 UNIQ_KEY"
              width={260}
              onSubmit={() => void search()}
            />
          </Row>

          <Row gap={8} wrap>
            <Text style={t.label}>时间窗口</Text>
            {windowButtons}
            <Text style={t.meta}>
              仅按 Topic 的窗口查询生效；按 Key / ID 查询时忽略时间窗口。
            </Text>
          </Row>

          <Row gap={8} style={{ justifyContent: "space-between" }}>
            <Text style={t.meta}>
              单页 {PAGE_SIZE} 条，最多累计 {MAX_ROWS} 条，按存储时间倒序；provider 的 total
              只是本页条数，不是全量总数，所以按「本页 total」标注。
            </Text>
            <Button
              label={querying() ? "查询中…" : "查询"}
              tone="primary"
              small
              onPress={() => {
                if (!querying()) void search();
              }}
            />
          </Row>

          {formError() === null ? null : <Notice message={formError() ?? ""} tone="danger" />}
        </Card>

        <Card
          title="查询结果"
          hint={
            rows().length === 0
              ? "尚未查询"
              : `已显示 ${rows().length} / 最多 ${MAX_ROWS} 条${
                  pageTotal() === null ? "" : ` · 本页 total ${pageTotal() ?? 0}`
                }${hasMore() ? " · 还有更多" : ""}`
          }
          right={
            <Row gap={6}>
              {error() === null ? null : <Text style={{ fontSize: 12, color: c.danger() }}>{error() ?? ""}</Text>}
              {/* 用 render 函数条件渲染：nsh 的 onPress 在挂载时绑定，disabled 会被快照。 */}
              {() =>
                hasMore() && rows().length < MAX_ROWS ? (
                  <Button
                    label={loadingMore() ? "加载中…" : "加载更多"}
                    small
                    onPress={() => {
                      if (!loadingMore()) void loadMore();
                    }}
                  />
                ) : null
              }
            </Row>
          }
        >
          {resultBody()}
        </Card>
      </Stack>
    </View>
  );
}
