// RocketMQ 发送消息页：左侧表单，右侧本页发送历史（最近 20 条，可回填）。
//
// 消息体按 UTF-8 编码成字节数组发送（SendMessageRequest.body 是 Vec<u8>）。
// JSON 合法性只做即时提示，不阻止发送原文。发送是写操作，由宿主确认。
import { signal, Text, View } from "nsh";
import { Input } from "nsh/base";
import { invoke as hostInvoke, SLOW_TIMEOUT_MS } from "../../lib/navop";
import { errorMessage, humanBytes } from "../../lib/format";
import { Badge, Button, Card, Empty, List, Notice, Row, SectionTitle, Stack } from "../../lib/ui";
import { c, r, t } from "../../lib/theme";

/** operationId → provider 方法名（清单里的工作台声明已不参与运行）。 */
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

/** 调一次 provider 方法。 */
async function invoke(operationId: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const method = OPERATIONS[operationId];
  if (!method) throw new Error(`未知的操作：${operationId}`);
  // provider 可能要等 daemon / broker 回话，给慢档超时。
  return await hostInvoke(method, params, { timeout: SLOW_TIMEOUT_MS });
}

type JsonState = "empty" | "ok" | "bad";

interface HistoryEntry {
  id: string;
  topic: string;
  tag: string;
  key: string;
  body: string;
  ok: boolean;
  detail: string;
  at: string;
}

interface SendOutcome {
  ok: boolean;
  title: string;
  detail: string;
  messageId: string;
  status: string;
}

const HISTORY_LIMIT = 20;

function jsonState(text: string): JsonState {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "empty";
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return "bad";
  try {
    JSON.parse(trimmed);
    return "ok";
  } catch {
    return "bad";
  }
}

function nowText(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function oneLine(text: string, limit = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function textOf(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** 带边框的输入框，标签在上；`mono` 用于消息体。 */
function Field(props: {
  label: string;
  hint?: string;
  value: string;
  onChange: (text: string) => void;
  placeholder: string;
  required?: boolean;
  testID?: string;
}) {
  return (
    <View style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}>
      <Row gap={6}>
        <Text style={t.label}>{props.label}</Text>
        {props.required === true ? <Text style={{ fontSize: 11, color: c.danger() }}>必填</Text> : null}
        {props.hint === undefined ? null : <Text style={t.meta}>{props.hint}</Text>}
      </Row>
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
          testID={props.testID}
          value={props.value}
          placeholder={props.placeholder}
          onChange={(text) => props.onChange(text)}
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

export default function SendMessage() {
  const topic = signal("");
  const tag = signal("");
  const key = signal("");
  const body = signal("");
  const sending = signal(false);
  const formError = signal<string | null>(null);
  const outcome = signal<SendOutcome | null>(null);
  const history = signal<HistoryEntry[]>([]);
  const seq = signal(0);

  const state = () => jsonState(body());

  function applyHistory(entry: HistoryEntry) {
    topic.set(entry.topic);
    tag.set(entry.tag);
    key.set(entry.key);
    body.set(entry.body);
    formError.set(null);
    outcome.set(null);
  }

  function pushHistory(entry: Omit<HistoryEntry, "id">) {
    const next = seq() + 1;
    seq.set(next);
    const withId: HistoryEntry = { ...entry, id: `h${next}` };
    history.set([withId].concat(history()).slice(0, HISTORY_LIMIT));
  }

  async function send() {
    if (sending()) return;
    const topicText = topic().trim();
    if (topicText.length === 0) {
      formError.set("请先填写 Topic。");
      return;
    }
    const tagText = tag().trim();
    const keyText = key().trim();
    const bodyText = body();
    formError.set(null);
    outcome.set(null);
    sending.set(true);
    try {
      const input: Record<string, unknown> = { topic: topicText };
      if (tagText.length > 0) input.tag = tagText;
      if (keyText.length > 0) input.key = keyText;
      input.body = Array.from(new TextEncoder().encode(bodyText));
      // 写操作：确认由页面自己负责（ConfirmBar），直接发。
      const raw = await invoke("sendMessage", input);
      const record = asRecord(raw);
      const messageId = record === null ? "" : textOf(record, "message_id");
      const status = record === null ? "" : textOf(record, "status");
      outcome.set({
        ok: true,
        title: "发送成功",
        detail: status.length > 0 ? `状态：${status}` : "服务端已接收",
        messageId,
        status,
      });
      pushHistory({
        topic: topicText,
        tag: tagText,
        key: keyText,
        body: bodyText,
        ok: true,
        detail: messageId.length > 0 ? messageId : status,
        at: nowText(),
      });
    } catch (failure) {
      const reason = errorMessage(failure);
      outcome.set({ ok: false, title: "发送失败", detail: reason, messageId: "", status: "" });
      pushHistory({
        topic: topicText,
        tag: tagText,
        key: keyText,
        body: bodyText,
        ok: false,
        detail: reason,
        at: nowText(),
      });
    } finally {
      sending.set(false);
    }
  }

  const stateBadge = () => {
    const current = state();
    if (current === "ok") return <Badge text="JSON 合法" tone="ok" />;
    if (current === "bad") return <Badge text="JSON 不合法" tone="warn" />;
    return <Badge text="空消息体" />;
  };

  const stateHint = () => {
    const current = state();
    if (current === "ok") return "将按原始文本发送（不会重新序列化）。";
    if (current === "bad") return "不是合法 JSON，仍会按原文发送。";
    return "纯文本也可以发送；消息体为空时发送空消息。";
  };

  const resultView = () => {
    const current = outcome();
    if (current === null) return null;
    if (current.ok) {
      return (
        <Notice
          tone="ok"
          message={`${current.title}${current.messageId.length > 0 ? `：${current.messageId}` : ""}`}
        />
      );
    }
    return <Notice tone="danger" message={`${current.title}：${current.detail}`} />;
  };

  const form = () => (
    <Stack scroll padding={14} gap={12}>
      <Card title="消息目标" hint="Topic 必填，Tag / Key 可选">
        <Row gap={10} wrap>
          <Field
            label="Topic"
            required
            value={topic()}
            onChange={(text) => topic.set(text)}
            placeholder="例如 order-topic"
            testID="topic"
          />
          <Field label="Tag" value={tag()} onChange={(text) => tag.set(text)} placeholder="可选，用于消费过滤" testID="tag" />
          <Field label="Key" value={key()} onChange={(text) => key.set(text)} placeholder="可选，业务唯一键" testID="key" />
        </Row>
      </Card>

      <Card
        title="消息体"
        hint={`${humanBytes(byteLength(body()))} · UTF-8 编码`}
        right={stateBadge()}
      >
        <View
          style={{
            height: 260,
            padding: 10,
            borderRadius: r.control,
            borderWidth: 1,
            borderColor: c.line(),
            backgroundColor: c.bg(),
            display: "flex",
            flexDirection: "column",
          }}
        >
          <Input
            testID="body"
            multiline
            value={body()}
            placeholder={'例如 {"orderId":"A1001","amount":99.5}'}
            onChange={(text) => body.set(text)}
            style={{
              flex: 1,
              minHeight: 0,
              fontSize: 13,
              lineHeight: 19,
              fontFamily: "monospace",
              color: c.text(),
              paddingHorizontal: 0,
              borderWidth: 0,
              backgroundColor: "transparent",
            }}
          />
        </View>
        <Row gap={8} wrap>
          <Text style={t.meta}>{stateHint()}</Text>
        </Row>
      </Card>

      {formError() === null ? null : <Notice tone="danger" message={formError() ?? ""} />}
      {resultView()}

      <Row gap={8} style={{ justifyContent: "space-between" }}>
        <Text style={t.meta}>
          发送为写操作，会先请求宿主确认；正文按原样编码，不做 JSON 重排。
        </Text>
        <Row gap={6}>
          <Button
            label="清空"
            small
            tone="ghost"
            onPress={() => {
              body.set("");
              outcome.set(null);
              formError.set(null);
            }}
          />
          {/* nsh 的 onPress 在挂载时绑定，所以不靠 disabled：守卫在 send() 里做。 */}
          <Button
            label={sending() ? "发送中…" : "发送"}
            tone="primary"
            small
            onPress={() => void send()}
          />
        </Row>
      </Row>
    </Stack>
  );

  const historyPanel = () => (
    <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <View style={{ paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.line() }}>
        <SectionTitle
          title="本页发送历史"
          hint={`最近 ${HISTORY_LIMIT} 条 · 点击回填`}
          right={
            <Button
              label="清空"
              small
              tone="ghost"
              onPress={() => {
                if (history().length === 0) return;
                history.set([]);
              }}
            />
          }
        />
      </View>
      {() =>
        history().length === 0 ? (
          <Empty
            title="还没有发送记录"
            hint="发送成功或失败的消息都会留在本页，方便回填重发。"
          />
        ) : (
          <List
            items={history()}
            keyOf={(entry) => entry.id}
            onSelect={(id) => {
              const entry = history().find((item) => item.id === id);
              if (entry !== undefined) applyHistory(entry);
            }}
            render={(entry) => (
              <View style={{ display: "flex", flexDirection: "column", gap: 3, padding: 10 }}>
                <Row gap={6}>
                  <Text numberOfLines={1} style={[t.mono, { flex: 1, minWidth: 0, color: c.text() }]}>
                    {entry.topic}
                  </Text>
                  <Badge text={entry.ok ? "成功" : "失败"} tone={entry.ok ? "ok" : "danger"} />
                  <Text style={t.meta}>{entry.at}</Text>
                </Row>
                <Text numberOfLines={1} style={t.meta}>
                  {entry.tag.length > 0 ? `tag=${entry.tag}` : "tag=-"} ·{" "}
                  {entry.key.length > 0 ? `key=${entry.key}` : "key=-"}
                </Text>
                <Text numberOfLines={2} style={{ fontSize: 11, color: c.muted(), lineHeight: 15 }}>
                  {entry.body.length === 0 ? "<空消息体>" : oneLine(entry.body)}
                </Text>
                {entry.detail.length === 0 ? null : (
                  <Text numberOfLines={1} style={{ fontSize: 11, color: entry.ok ? c.muted() : c.danger() }}>
                    {entry.detail}
                  </Text>
                )}
              </View>
            )}
          />
        )
      }
    </View>
  );

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
          <Text style={t.h1}>发送消息</Text>
          <Badge text="写操作" tone="info" />
          <Text style={t.meta}>发送前由宿主确认</Text>
        </Row>
        <Text style={t.meta}>本页历史 {history().length} 条</Text>
      </Row>
      <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "row" }}>
        <View style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {form()}
        </View>
        <View
          style={{
            width: 320,
            flexShrink: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            borderLeftWidth: 1,
            borderLeftColor: c.line(),
          }}
        >
          {historyPanel()}
        </View>
      </View>
    </View>
  );
}
