// MQTT 消息页：按时间窗口拉本地环形缓冲，选中一行再按 ID 拉完整 payload。
//
// 数据事实（来自 provider 的实现，写在这里避免被当成 bug）：
//  1. 消息只来自本地环形缓冲（容量 1000 条，oldest→newest），provider 不会回源 broker；
//  2. `queryByWindow` 返回的是摘要（body 被去掉，只有截断的 body_text），
//     完整字节只在 `queryById` 的详情里返回；
//  3. 实时流用 1s 轮询 `queryByWindow` 实现（旧页同样不用 messageStream，
//     因为页面没声明 event 模块），暂停时只是停掉轮询；
//  4. 每次刷新最多读 1000 条，页面只渲染按时间倒序的前 500 条。
import { cleanup, Scroll, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
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
  SplitPane,
  Stack,
} from "../../lib/ui";
import { c, r, t } from "../../lib/theme";

/** 实时流轮询间隔。 */
const POLL_MS = 1000;
/** 单页条数（provider 允许 1..）。 */
const PAGE_SIZE = 200;
/** 一次刷新最多读几页：200 × 5 = 1000，正好是 provider 的缓冲容量。 */
const MAX_PAGES = 5;
/** 页面最多渲染多少行（时间倒序）。 */
const MAX_RENDER = 500;
/** 列表摘要截断长度。 */
const PREVIEW_CHARS = 160;
/** 详情里允许尝试 JSON 解析的最大字符数。 */
const MAX_PARSE_CHARS = 200_000;
/** 详情里最多渲染多少字符，避免一条 1 MiB 的消息把布局撑爆。 */
const MAX_RENDER_CHARS = 20_000;

type WindowKey = "1m" | "5m" | "1h" | "all";

const WINDOWS: Array<{ key: WindowKey; label: string; ms: number | null }> = [
  { key: "1m", label: "1 分钟", ms: 60_000 },
  { key: "5m", label: "5 分钟", ms: 5 * 60_000 },
  { key: "1h", label: "1 小时", ms: 60 * 60_000 },
  { key: "all", label: "全部", ms: null },
];

type Message = {
  message_id: string;
  topic: string;
  body_text: string;
  body: number[] | null;
  properties: Array<[string, string]>;
  store_time: string;
};

/** operationId → provider 方法名。
 *
 * 清单里的 `resourceWorkbenches` 已经不参与运行，这一层映射留在页面里：
 * 页面自己决定"要哪份数据"，宿主只负责把方法名和参数发给 provider。
 */
const OPERATIONS: Record<string, string> = {
  listClients: "middleware/group/clients",
  listTopics: "middleware/topic/list",
  messageStream: "middleware/message/stream",
  metrics: "middleware/metrics",
  publish: "middleware/message/send",
  queryById: "middleware/message/query",
  queryByKey: "middleware/message/query",
  queryByWindow: "middleware/message/query",
  subscribe: "middleware/topic/create",
  unsubscribe: "middleware/topic/delete",
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

function pairsOf(raw: unknown): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const pair of arr(raw, "properties")) {
    if (Array.isArray(pair) && pair.length >= 2) {
      pairs.push([String(pair[0]), String(pair[1])]);
    }
  }
  return pairs;
}

/** provider 的 JSON 形状不保证，统一折成页面用的消息对象。 */
function toMessage(raw: unknown): Message | null {
  if (raw === null || typeof raw !== "object") return null;
  const messageId = str(raw, "message_id", "");
  const topic = str(raw, "topic", "");
  if (messageId.length === 0 && topic.length === 0) return null;
  const bodyValue = (raw as Record<string, unknown>).body;
  const body = Array.isArray(bodyValue) ? bodyValue.map((byte) => Number(byte) & 0xff) : null;
  return {
    message_id: messageId,
    topic,
    body_text: str(raw, "body_text", ""),
    body,
    properties: pairsOf(raw),
    store_time: str(raw, "store_time", ""),
  };
}

function property(message: Message, key: string): string {
  for (const [name, value] of message.properties) {
    if (name === key) return value;
  }
  return "";
}

/** 接收时间优先用 properties.received_at_ms，退回 store_time（本地时间）。 */
function receivedAt(message: Message): number {
  const millis = Number(property(message, "received_at_ms"));
  if (Number.isFinite(millis) && millis > 0) return millis;
  const parsed = Date.parse(message.store_time.replace(" ", "T"));
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** 合成 ID 形如 `mqtt-<seq>`；同一毫秒内用序号兜底排序。 */
function sequenceOf(messageId: string): number {
  const index = messageId.lastIndexOf("-");
  const value = Number(index >= 0 ? messageId.slice(index + 1) : messageId);
  return Number.isFinite(value) ? value : 0;
}

function payloadSize(message: Message): number {
  const declared = Number(property(message, "payload_size"));
  if (Number.isFinite(declared) && declared >= 0) return declared;
  if (message.body !== null) return message.body.length;
  return Buffer.byteLength(payloadText(message), "utf8");
}

function payloadText(message: Message): string {
  // 列表摘要的 body 被 provider 去掉了，只有 body_text；详情才带完整 body，
  // 因此有 body 时优先解码，避免详情仍然显示被截到 1024 字节的摘要。
  if (message.body !== null && message.body.length > 0) {
    return Buffer.from(message.body).toString("utf8");
  }
  return message.body_text;
}

function previewOf(message: Message): string {
  const flat = payloadText(message).replace(/\s+/g, " ").trim();
  if (flat.length === 0) {
    const size = payloadSize(message);
    return size > 0 ? `〈二进制 ${humanBytes(size)}〉` : "（空消息体）";
  }
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat;
}

function isRetained(message: Message): boolean {
  return property(message, "retain") === "true";
}

function qosOf(message: Message): string {
  const value = property(message, "qos");
  return value.length > 0 ? value : "?";
}

function directionOf(message: Message): string {
  return property(message, "direction") === "out" ? "发出" : "收到";
}

/** `11-02 23:14:25`，时间窗口精确到秒，shortTime 只到分钟不够用。 */
function clockOf(millis: number): string {
  if (!Number.isFinite(millis) || millis <= 0) return "-";
  const date = new Date(millis);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(
    date.getMinutes(),
  )}:${two(date.getSeconds())}`;
}

/** MQTT 通配符匹配：`+` 一层，`#` 末尾多层。 */
function topicMatches(filter: string, topic: string): boolean {
  const parts = filter.split("/");
  const actual = topic.split("/");
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === "#") return true;
    if (index >= actual.length) return false;
    if (part !== "+" && part !== actual[index]) return false;
  }
  return parts.length === actual.length;
}

/** 输入不含通配符时按子串过滤；含 +/# 时按 MQTT 过滤器匹配。 */
function matchesFilter(needle: string, topic: string): boolean {
  const filter = needle.trim();
  if (filter.length === 0 || filter === "#") return true;
  if (filter.includes("+") || filter.includes("#")) return topicMatches(filter, topic);
  return topic.toLowerCase().includes(filter.toLowerCase());
}

type JsonView = {
  kind: "empty" | "json" | "invalid";
  text: string;
  error: string;
  truncated: boolean;
  sourceLength: number;
};

/** 详情正文的展示形态：能解析就格式化，不能就退回原文。 */
function jsonViewOf(message: Message): JsonView {
  const raw = payloadText(message);
  if (raw.trim().length === 0) {
    return { kind: "empty", text: "", error: "", truncated: false, sourceLength: 0 };
  }
  const clipped = raw.length > MAX_PARSE_CHARS ? raw.slice(0, MAX_PARSE_CHARS) : raw;
  let text = clipped;
  let kind: JsonView["kind"] = "invalid";
  let error = "";
  try {
    text = JSON.stringify(JSON.parse(clipped), null, 2);
    kind = "json";
  } catch (failure) {
    error = errorMessage(failure);
  }
  const truncated = text.length > MAX_RENDER_CHARS;
  return {
    kind,
    text: truncated ? `${text.slice(0, MAX_RENDER_CHARS)}\n…` : text,
    error,
    truncated,
    sourceLength: raw.length,
  };
}

function metaRows(message: Message): Array<[string, string]> {
  return [
    ["消息 ID", message.message_id.length > 0 ? message.message_id : "-"],
    ["接收时间", clockOf(receivedAt(message))],
    ["QoS", qosOf(message)],
    ["Retained", isRetained(message) ? "是" : "否"],
    ["方向", directionOf(message)],
    ["Payload 大小", humanBytes(payloadSize(message))],
    ["Topic", message.topic],
    ["store_time", message.store_time.length > 0 ? message.store_time : "-"],
  ];
}

export default function Messages() {
  const windowKey = signal<WindowKey>("5m");
  const filterText = signal("");
  const paused = signal(false);
  const fetched = signal<Message[]>([]);
  const total = signal(0);
  const loading = signal(true);
  const error = signal<string | null>(null);
  const liveError = signal<string | null>(null);
  const selectedId = signal<string | null>(null);
  const detail = signal<Message | null>(null);
  const detailLoading = signal(false);
  const detailError = signal<string | null>(null);
  const viewMode = signal<"json" | "raw">("json");
  let inFlight = false;

  function currentWindow() {
    return WINDOWS.find((entry) => entry.key === windowKey()) ?? WINDOWS[1];
  }

  function winLabel(): string {
    return currentWindow().label;
  }

  function filteredRows(): Message[] {
    const needle = filterText();
    const rows = fetched();
    if (needle.trim().length === 0) return rows;
    return rows.filter((message) => matchesFilter(needle, message.topic));
  }

  function visibleRows(): Message[] {
    return filteredRows().slice(0, MAX_RENDER);
  }

  async function refresh(initial: boolean) {
    if (inFlight) return;
    inFlight = true;
    if (initial) loading.set(true);
    try {
      const win = currentWindow();
      const end = Date.now();
      const begin = win.ms === null ? 0 : Math.max(0, end - win.ms);
      const collected: Message[] = [];
      let declaredTotal = 0;
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const result = await dispatch("queryByWindow", {
          ByTimeWindow: {
            topic: "#",
            begin_unix_ms: begin,
            end_unix_ms: end,
            page,
            page_size: PAGE_SIZE,
          },
        });
        const pageObject = result as { total?: unknown; has_more?: unknown } | null;
        const rows = arr(result, "messages")
          .map(toMessage)
          .filter((message): message is Message => message !== null);
        collected.push(...rows);
        if (page === 1) {
          const value = Number(pageObject?.total);
          declaredTotal = Number.isFinite(value) && value > 0 ? value : 0;
        }
        if (pageObject?.has_more !== true || rows.length === 0) break;
      }

      const seen = new Set<string>();
      const unique = collected.filter((message) => {
        if (message.message_id.length === 0 || seen.has(message.message_id)) return false;
        seen.add(message.message_id);
        return true;
      });
      unique.sort(
        (left, right) =>
          receivedAt(right) - receivedAt(left) ||
          sequenceOf(right.message_id) - sequenceOf(left.message_id),
      );
      fetched.set(unique);
      total.set(declaredTotal > 0 ? declaredTotal : unique.length);
      error.set(null);
      liveError.set(null);
    } catch (failure) {
      const message = errorMessage(failure);
      if (fetched().length === 0) error.set(message);
      else liveError.set(message);
    } finally {
      loading.set(false);
      inFlight = false;
    }
  }

  async function select(message: Message, force = false) {
    if (!force && selectedId() === message.message_id) return;
    const id = message.message_id;
    selectedId.set(id);
    detail.set(null);
    detailError.set(null);
    detailLoading.set(true);
    try {
      const result = await dispatch("queryById", {
        ById: { topic: message.topic, message_id: id },
      });
      if (selectedId() !== id) return;
      const full = arr(result, "messages")
        .map(toMessage)
        .find((row): row is Message => row !== null && row.message_id === id);
      if (full === undefined) {
        detailError.set("这条消息已不在 provider 缓冲里（默认只保留最近 1000 条）。");
        return;
      }
      detail.set(full);
    } catch (failure) {
      if (selectedId() === id) detailError.set(errorMessage(failure));
    } finally {
      if (selectedId() === id) detailLoading.set(false);
    }
  }

  function chooseWindow(key: WindowKey) {
    if (windowKey() === key) return;
    windowKey.set(key);
    selectedId.set(null);
    detail.set(null);
    detailError.set(null);
    void refresh(true);
  }

  const timer = setInterval(() => {
    if (paused() || inFlight) return;
    void refresh(false);
  }, POLL_MS);
  cleanup(() => clearInterval(timer));
  void refresh(true);

  function headerRow(): JSX.Element {
    return (
      <Row
        gap={8}
        style={{
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: c.line(),
        }}
      >
        <Text style={t.h1}>消息</Text>
        <Badge text={`${total()} 条`} />
        <View style={{ flex: 1, minWidth: 8 }} />
        <Row gap={4}>
          {WINDOWS.map((entry) =>
            windowKey() === entry.key ? (
              <Button
                label={entry.label}
                small
                tone="primary"
                onPress={() => chooseWindow(entry.key)}
              />
            ) : (
              <Button label={entry.label} small onPress={() => chooseWindow(entry.key)} />
            ),
          )}
        </Row>
        {paused() ? (
          <Button label="继续" small onPress={() => paused.set(false)} />
        ) : (
          <Button label="暂停" small onPress={() => paused.set(true)} />
        )}
        <Button label="刷新" small onPress={() => void refresh(false)} />
      </Row>
    );
  }

  function statusRow(): JSX.Element {
    return (
      <Row
        gap={8}
        style={{
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderBottomColor: c.line(),
        }}
      >
        <View
          style={{
            height: 28,
            width: 300,
            flexShrink: 0,
            borderWidth: 1,
            borderColor: c.line(),
            borderRadius: r.control,
            backgroundColor: c.bg(),
            paddingHorizontal: 8,
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
          }}
        >
          <Input
            value={filterText()}
            onChange={(text) => filterText.set(text)}
            placeholder="按 topic 过滤（子串，或 + / # 通配符）"
            style={{
              flex: 1,
              fontSize: 12,
              paddingHorizontal: 0,
              borderWidth: 0,
              backgroundColor: "transparent",
              color: c.text(),
            }}
          />
        </View>
        <Text style={t.meta}>
          {`窗口：${winLabel()} · 过滤后 ${filteredRows().length} 条 · 渲染最近 ${visibleRows().length} 条`}
        </Text>
        <View style={{ flex: 1, minWidth: 8 }} />
        {paused() ? (
          <Badge text="已暂停" tone="warn" />
        ) : (
          <Badge text="实时轮询" tone="ok" />
        )}
        {liveError() === null ? null : (
          <Notice message={`轮询失败：${liveError() ?? ""}`} tone="danger" />
        )}
      </Row>
    );
  }

  function tableRows(): JSX.Element {
    return (
      <Scroll style={{ flex: 1, minHeight: 0 }}>
        <View style={{ display: "flex", flexDirection: "column" }}>
          <Each of={visibleRows()} key={(message) => message.message_id}>
            {(message) => (
              <View
                onPress={() => void select(message())}
                style={{
                  backgroundColor:
                    selectedId() === message().message_id ? c.hover() : "transparent",
                  borderBottomWidth: 1,
                  borderBottomColor: c.line(),
                }}
              >
                <Row gap={8} style={{ paddingVertical: 7, paddingHorizontal: 10 }}>
                  <Text style={{ ...t.mono, width: 102, color: c.muted() }}>
                    {clockOf(receivedAt(message()))}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{ ...t.mono, flex: 1, minWidth: 0, color: c.text() }}
                  >
                    {message().topic}
                  </Text>
                  <Text style={{ ...t.meta, width: 26, textAlign: "center" }}>
                    {qosOf(message())}
                  </Text>
                  <Text
                    style={{
                      ...t.meta,
                      width: 30,
                      textAlign: "center",
                      color: isRetained(message()) ? c.accent() : c.muted(),
                    }}
                  >
                    {isRetained(message()) ? "R" : "–"}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{ ...t.meta, flex: 1.1, minWidth: 0, color: c.muted() }}
                  >
                    {previewOf(message())}
                  </Text>
                </Row>
              </View>
            )}
          </Each>
        </View>
      </Scroll>
    );
  }

  function tablePane(): JSX.Element {
    return (
      <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <Row
          gap={8}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderBottomWidth: 1,
            borderBottomColor: c.line(),
          }}
        >
          <Text style={{ ...t.label, width: 102 }}>时间</Text>
          <Text style={{ ...t.label, flex: 1, minWidth: 0 }}>topic</Text>
          <Text style={{ ...t.label, width: 26, textAlign: "center" }}>QoS</Text>
          <Text style={{ ...t.label, width: 30, textAlign: "center" }}>保留</Text>
          <Text style={{ ...t.label, flex: 1.1, minWidth: 0 }}>payload 摘要</Text>
        </Row>
        <If
          when={visibleRows().length === 0}
          else={tableRows()}
        >
          <Empty
            title="没有匹配的消息"
            hint={
              fetched().length === 0
                ? "这个时间窗口里 provider 缓冲是空的；等有消息进来，或换更大的窗口。"
                : "当前 topic 过滤没有命中；清空过滤或换一个模式（子串 / + / #）。"
            }
          />
        </If>
        <Row
          gap={8}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderTopWidth: 1,
            borderTopColor: c.line(),
          }}
        >
          <Text style={t.meta}>
            {`窗口内共 ${total()} 条 · 最多渲染 ${MAX_RENDER} 条`}
          </Text>
          <View style={{ flex: 1 }} />
          <Text style={t.meta}>provider 缓冲上限 1000 条</Text>
        </Row>
      </View>
    );
  }

  function payloadBlock(message: Message): JSX.Element {
    const view = jsonViewOf(message);
    const raw = payloadText(message);
    const rawView =
      raw.length > MAX_RENDER_CHARS ? `${raw.slice(0, MAX_RENDER_CHARS)}\n…` : raw;
    const text = viewMode() === "json" && view.kind === "json" ? view.text : rawView;
    return (
      <View style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {viewMode() === "json" ? (
          view.kind === "json" ? (
            <Notice message="JSON 合法，已格式化显示。" tone="ok" />
          ) : view.kind === "invalid" ? (
            <Notice
              message={`JSON 解析失败，已退回原文：${view.error}`}
              tone="warn"
            />
          ) : (
            <Notice message="payload 为空。" />
          )
        ) : null}
        <View
          style={{
            borderWidth: 1,
            borderColor: c.line(),
            borderRadius: r.control,
            backgroundColor: c.bg(),
            padding: 10,
          }}
        >
          <Text
            selectable
            style={{
              ...t.mono,
              fontSize: 12,
              lineHeight: 18,
              color: c.text(),
            }}
          >
            {text.length > 0 ? text : "（空消息体）"}
          </Text>
        </View>
        {view.truncated || raw.length > MAX_RENDER_CHARS ? (
          <Text style={t.meta}>
            {`仅显示前 ${MAX_RENDER_CHARS} 字符（原文 ${raw.length} 字符 / ${payloadSize(
              message,
            )}）。`}
          </Text>
        ) : null}
      </View>
    );
  }

  function detailPane(): JSX.Element {
    if (detailLoading()) return <Loading label="正在读取消息体…" />;
    if (detailError() !== null) {
      const row = fetched().find((message) => message.message_id === selectedId());
      return (
        <Stack padding={14} gap={10}>
          <Notice message={detailError() ?? ""} tone="danger" />
          {row === undefined ? null : (
            <Row>
              <Button label="重新读取" small onPress={() => void select(row, true)} />
            </Row>
          )}
        </Stack>
      );
    }
    const message = detail();
    if (message === null) {
      return (
        <Empty
          title="选择一条消息"
          hint="点击左侧任意消息，查看完整 payload、元数据与格式化 JSON。"
        />
      );
    }
    return (
      <Stack scroll padding={14} gap={12}>
        <Row gap={8} style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}>
            <Text numberOfLines={3} style={{ ...t.mono, fontSize: 13, color: c.text() }}>
              {message.topic}
            </Text>
            <Text style={t.meta}>
              {`${clockOf(receivedAt(message))} · ${directionOf(message)} · QoS ${qosOf(
                message,
              )}`}
            </Text>
          </View>
          {isRetained(message) ? <Badge text="retained" tone="warn" /> : null}
        </Row>

        <Card title="元数据" hint="ID / 时间 / QoS / retained / topic">
          <KeyValue rows={metaRows(message)} columns={2} />
        </Card>

        <Card
          title="Payload"
          hint={`${humanBytes(payloadSize(message))} · ${payloadText(message).length} 字符（UTF-8 解码）`}
          right={
            <Row gap={4}>
              {viewMode() === "json" ? (
                <Button
                  label="格式化 JSON"
                  small
                  tone="primary"
                  onPress={() => viewMode.set("json")}
                />
              ) : (
                <Button label="格式化 JSON" small onPress={() => viewMode.set("json")} />
              )}
              {viewMode() === "raw" ? (
                <Button
                  label="原文"
                  small
                  tone="primary"
                  onPress={() => viewMode.set("raw")}
                />
              ) : (
                <Button label="原文" small onPress={() => viewMode.set("raw")} />
              )}
            </Row>
          }
        >
          {payloadBlock(message)}
        </Card>
      </Stack>
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
      {headerRow()}
      {statusRow()}
      <If when={loading() && fetched().length === 0}>
        <Loading label="正在读取消息…" />
      </If>
      <If when={!loading() && error() !== null && fetched().length === 0}>
        <LoadError message={error() ?? ""} onRetry={() => void refresh(true)} />
      </If>
      <If when={!loading() && error() === null && fetched().length === 0}>
        <Empty
          title="这个时间窗口没有消息"
          hint="provider 只保留最近 1000 条；换一个窗口，或等新消息进来后刷新。"
        />
      </If>
      <If when={fetched().length > 0}>
        <SplitPane width={560} left={tablePane()} right={detailPane()} />
      </If>
    </View>
  );
}
