// MQTT 发布页：表单 + 本页发送历史。
//
// 说明：
//  1. 发送走 `publish`，input 形状是 { topic, body: 字节数组, properties: [["qos", ..], ["retain", ..]] }，
//     与旧页和 extension.json 的参数映射一致；
//  2. JSON 校验只做提示：非法 JSON 不阻止发送，payload 始终按 UTF-8 原文编码；
//  3. 发布主题不允许包含 + / #（那是订阅过滤器语法），这里在发送前拦截；
//  4. 发送历史只存在本页内存里，刷新页面即清空。
import { host, mount, Scroll, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
import { Input } from "nsh/base";
import { errorMessage, humanBytes } from "../../lib/format";
import { Badge, Button, Card, Notice, Row } from "../../lib/ui";
import { c, r, t } from "../../lib/theme";

const QOS_OPTIONS = [0, 1, 2] as const;
const HISTORY_LIMIT = 20;
const MAX_PARSE_CHARS = 200_000;
const MAX_PREVIEW_CHARS = 4000;

type Qos = 0 | 1 | 2;

type HistoryEntry = {
  seq: number;
  topic: string;
  text: string;
  qos: Qos;
  retain: boolean;
  at: number;
};

type JsonInfo =
  | { kind: "empty" }
  | { kind: "large"; length: number }
  | { kind: "json"; pretty: string; truncated: boolean }
  | { kind: "invalid"; error: string };

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

let resourceHandle: string | null = null;

/** 借来的资源句柄：页面所属连接的那一个。 */
async function handle(): Promise<string> {
  if (resourceHandle) return resourceHandle;
  const context = (await host.call("navop.context.current", {})) as {
    connection?: { resourceHandle?: string } | null;
  };
  const found = context?.connection?.resourceHandle;
  if (!found) throw new Error("这个页面需要一个扩展连接（当前上下文里没有资源句柄）");
  resourceHandle = found;
  return found;
}

/** 调一次 provider 方法；把失败折成一句人话。`confirmed` 仅为兼容旧调用点。 */
async function dispatch(
  operationId: string,
  input?: unknown,
  _confirmed?: boolean,
): Promise<unknown> {
  const method = OPERATIONS[operationId];
  if (!method) throw new Error(`未知的操作：${operationId}`);
  try {
    return await host.call("navop.resource.invoke", {
      handle: await handle(),
      method,
      params: (input as Record<string, unknown>) ?? {},
    });
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}

/** 只做提示用的 JSON 校验；非法时返回解析器的原始错误。 */
function jsonInfo(text: string): JsonInfo {
  if (text.trim().length === 0) return { kind: "empty" };
  if (text.length > MAX_PARSE_CHARS) return { kind: "large", length: text.length };
  try {
    const pretty = JSON.stringify(JSON.parse(text), null, 2);
    return {
      kind: "json",
      pretty:
        pretty.length > MAX_PREVIEW_CHARS ? `${pretty.slice(0, MAX_PREVIEW_CHARS)}\n…` : pretty,
      truncated: pretty.length > MAX_PREVIEW_CHARS,
    };
  } catch (failure) {
    return { kind: "invalid", error: errorMessage(failure) };
  }
}

function topicProblem(topic: string): string | null {
  const value = topic.trim();
  if (value.length === 0) return "topic 不能为空。";
  if (value.includes("+") || value.includes("#")) {
    return "发布主题不能包含 + 或 #；通配符只用于订阅。";
  }
  return null;
}

function clockOf(millis: number): string {
  const date = new Date(millis);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}

export default function Publish() {
  const topic = signal("");
  const payloadText = signal("");
  const qos = signal<Qos>(1);
  const retain = signal(false);
  const sending = signal(false);
  const result = signal<{ ok: boolean; text: string } | null>(null);
  const history = signal<HistoryEntry[]>([]);
  let historySeq = 0;

  async function send() {
    if (sending()) return;
    const value = topic().trim();
    const problem = topicProblem(value);
    if (problem !== null) {
      result.set({ ok: false, text: problem });
      return;
    }
    const text = payloadText();
    const bytes = Array.from(Buffer.from(text, "utf8"));
    sending.set(true);
    result.set(null);
    try {
      const response = await dispatch(
        "publish",
        {
          topic: value,
          body: bytes,
          properties: [
            ["qos", String(qos())],
            ["retain", retain() ? "true" : "false"],
          ],
        },
        true,
      );
      const messageId =
        response !== null && typeof response === "object"
          ? String((response as Record<string, unknown>).message_id ?? "")
          : "";
      result.set({
        ok: true,
        text: `已发布到 ${value} · ${humanBytes(bytes.length)}${
          messageId.length > 0 ? ` · ${messageId}` : ""
        }`,
      });
      historySeq += 1;
      const entry: HistoryEntry = {
        seq: historySeq,
        topic: value,
        text,
        qos: qos(),
        retain: retain(),
        at: Date.now(),
      };
      history.set(
        [
          entry,
          ...history().filter(
            (item) =>
              !(
                item.topic === entry.topic &&
                item.text === entry.text &&
                item.qos === entry.qos &&
                item.retain === entry.retain
              ),
          ),
        ].slice(0, HISTORY_LIMIT),
      );
    } catch (failure) {
      result.set({ ok: false, text: errorMessage(failure) });
    } finally {
      sending.set(false);
    }
  }

  function refill(entry: HistoryEntry) {
    topic.set(entry.topic);
    payloadText.set(entry.text);
    qos.set(entry.qos);
    retain.set(entry.retain);
    result.set(null);
  }

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
        <Text style={t.h1}>发布</Text>
        <Badge text="写操作需确认" tone="warn" />
        <View style={{ flex: 1, minWidth: 8 }} />
        <Text style={t.meta}>
          {`payload ${humanBytes(Buffer.byteLength(payloadText(), "utf8"))} · QoS ${qos()}${
            retain() ? " · retain" : ""
          }`}
        </Text>
      </Row>
    );
  }

  function jsonNotice(): JSX.Element | null {
    const info = jsonInfo(payloadText());
    if (info.kind === "empty") return null;
    if (info.kind === "json") {
      return <Notice message="JSON 合法，已生成格式化预览。" tone="ok" />;
    }
    if (info.kind === "large") {
      return (
        <Notice
          message={`内容超过 ${MAX_PARSE_CHARS} 字符，跳过 JSON 校验；仍按原文发送。`}
          tone="warn"
        />
      );
    }
    return (
      <Notice
        message={`JSON 解析失败：${info.error}。不会阻止发送，payload 将按原文 UTF-8 发送。`}
        tone="danger"
      />
    );
  }

  function jsonPreview(): JSX.Element | null {
    const info = jsonInfo(payloadText());
    if (info.kind !== "json") return null;
    return (
      <View
        style={{
          maxHeight: 180,
          borderWidth: 1,
          borderColor: c.line(),
          borderRadius: r.control,
          backgroundColor: c.bg(),
          padding: 8,
        }}
      >
        <Scroll style={{ maxHeight: 164 }}>
          <Text selectable style={{ ...t.mono, fontSize: 12, lineHeight: 17, color: c.text() }}>
            {info.pretty}
          </Text>
        </Scroll>
        {info.truncated ? (
          <Text style={{ ...t.meta, marginTop: 4 }}>
            {`预览最多显示 ${MAX_PREVIEW_CHARS} 字符。`}
          </Text>
        ) : null}
      </View>
    );
  }

  function sendResult(): JSX.Element | null {
    const value = result();
    if (value === null) return null;
    return <Notice message={value.text} tone={value.ok ? "ok" : "danger"} />;
  }

  function sendButton(): JSX.Element {
    const problem = topicProblem(topic());
    if (sending()) {
      return (
        <Row gap={8}>
          <Button label="发送中…" small disabled />
          <Text style={t.meta}>等待 provider 返回结果。</Text>
        </Row>
      );
    }
    if (problem !== null) {
      return (
        <Row gap={8}>
          <Button label="发送" small disabled />
          <Text style={{ ...t.meta, color: c.danger() }}>{problem}</Text>
        </Row>
      );
    }
    return (
      <Row gap={8}>
        <Button label="发送" small tone="primary" onPress={() => void send()} />
        <Text style={t.meta}>会带二次确认；成功后写入本页发送历史。</Text>
      </Row>
    );
  }

  function qosButtons(): JSX.Element {
    return (
      <Row gap={4}>
        {QOS_OPTIONS.map((value) =>
          qos() === value ? (
            <Button label={String(value)} small tone="primary" onPress={() => qos.set(value)} />
          ) : (
            <Button label={String(value)} small onPress={() => qos.set(value)} />
          ),
        )}
      </Row>
    );
  }

  function retainToggle(): JSX.Element {
    return retain() ? (
      <Button label="retain：开" small tone="primary" onPress={() => retain.set(false)} />
    ) : (
      <Button label="retain：关" small onPress={() => retain.set(true)} />
    );
  }

  function form(): JSX.Element {
    return (
      <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <Scroll style={{ flex: 1, minHeight: 0 }}>
          <View style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
            <Card title="目标主题" hint="发布到具体 topic；不支持 + / # 通配符">
              <Input
                testID="topic-input"
                value={topic()}
                onChange={(text) => topic.set(text)}
                placeholder="例如 devices/kitchen/light/set"
                style={{
                  width: "100%",
                  height: 30,
                  fontSize: 13,
                  borderWidth: 1,
                  borderColor: c.line(),
                  borderRadius: r.control,
                  backgroundColor: c.bg(),
                  color: c.text(),
                  paddingHorizontal: 8,
                }}
              />
            </Card>

            <Card
              title="消息内容"
              hint="按 UTF-8 编码为字节数组发送；多行文本原样保留"
              right={
                <Text style={t.meta}>
                  {(`${payloadText().length} 字符 · ${humanBytes(
                    Buffer.byteLength(payloadText(), "utf8"),
                  )}`)}
                </Text>
              }
            >
              <View style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Input
                  testID="payload-input"
                  multiline
                  value={payloadText()}
                  onChange={(text) => payloadText.set(text)}
                  placeholder={'{"temperature": 23.5, "unit": "C"}'}
                  style={{
                    width: "100%",
                    minHeight: 180,
                    height: 180,
                    ...t.mono,
                    fontSize: 12,
                    lineHeight: 18,
                    borderWidth: 1,
                    borderColor: c.line(),
                    borderRadius: r.control,
                    backgroundColor: c.bg(),
                    color: c.text(),
                    paddingHorizontal: 8,
                    paddingVertical: 8,
                  }}
                />
                {jsonNotice()}
                {jsonPreview()}
              </View>
            </Card>

            <Card title="发送选项">
              <View style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <Row gap={10}>
                  <Text style={t.label}>QoS</Text>
                  {qosButtons()}
                  <View style={{ flex: 1 }} />
                  <Text style={t.label}>Retain</Text>
                  {retainToggle()}
                </Row>
                <Row gap={10} align="center" wrap>
                  {sendButton()}
                </Row>
                {sendResult()}
              </View>
            </Card>
          </View>
        </Scroll>
      </View>
    );
  }

  function historyPane(): JSX.Element {
    return (
      <View
        style={{
          width: 320,
          flexShrink: 0,
          borderLeftWidth: 1,
          borderLeftColor: c.line(),
          display: "flex",
          flexDirection: "column",
          backgroundColor: c.panel(),
        }}
      >
        <Row
          gap={6}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderBottomColor: c.line(),
          }}
        >
          <Text style={t.h2}>发送历史</Text>
          <Badge text={`${history().length}/${HISTORY_LIMIT}`} />
          <View style={{ flex: 1 }} />
          <Text style={t.meta}>点击回填</Text>
        </Row>
        <If when={history().length === 0}>
          <View style={{ padding: 14 }}>
            <Text style={t.meta}>
              发送成功后，最近 {HISTORY_LIMIT} 条会出现在这里；点击任意一条可回填主题、payload、QoS 与
              retain。
            </Text>
          </View>
        </If>
        <Scroll style={{ flex: 1, minHeight: 0 }}>
          <View style={{ display: "flex", flexDirection: "column" }}>
            <Each of={history()} key={(entry) => String(entry.seq)}>
              {(entry, index) => (
                <View
                  testID={`history-entry-${index()}`}
                  onPress={() => refill(entry())}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 9,
                    borderBottomWidth: 1,
                    borderBottomColor: c.line(),
                  }}
                >
                  <Row gap={6}>
                    <Text numberOfLines={1} style={{ ...t.mono, flex: 1, minWidth: 0 }}>
                      {entry().topic}
                    </Text>
                    <Text style={t.meta}>{clockOf(entry().at)}</Text>
                  </Row>
                  <Row gap={6} style={{ marginTop: 3 }}>
                    <Text style={t.meta}>QoS {entry().qos}</Text>
                    {entry().retain ? <Badge text="retain" tone="warn" /> : null}
                    <Text style={t.meta}>
                      {humanBytes(Buffer.byteLength(entry().text, "utf8"))}
                    </Text>
                  </Row>
                  <Text numberOfLines={2} style={{ ...t.meta, marginTop: 4, color: c.muted() }}>
                    {entry().text.length > 0
                      ? entry().text.replace(/\s+/g, " ").slice(0, 160)
                      : "（空 payload）"}
                  </Text>
                </View>
              )}
            </Each>
          </View>
        </Scroll>
        <View
          style={{
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderTopWidth: 1,
            borderTopColor: c.line(),
          }}
        >
          <Text style={t.meta}>历史只保存在本页内存，不写入 provider，刷新页面即清空。</Text>
        </View>
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
      {headerRow()}
      <Row gap={0} style={{ flex: 1, minHeight: 0, alignItems: "stretch" }}>
        {form()}
        {historyPane()}
      </Row>
    </View>
  );
}

mount(Publish);
