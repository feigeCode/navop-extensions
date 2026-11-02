// MQTT 主题页（资源工作台嵌入的 nsh 页面）。
//
// 左边是「本连接已订阅的过滤器」列表（按 `/` 分段缩进成树形，不做真折叠），
// 右边是选中过滤器在该连接上的参数与本地缓冲里的最近消息。
//
// 两条必须说清、否则会被当成 bug 的事实：
//  1. MQTT 协议没有「列出 broker 全部主题」的接口，`listTopics` 返回的是本连接
//     的订阅过滤器；没订阅的主题这里永远看不到。
//  2. provider 的 `MiddlewareTopicInfo.message_count` 对 MQTT 是 None（见
//     admin.rs::sub_to_topic_info），消息数只能额外读一次本地环形缓冲快照
//     （`queryByWindow`，上限 1000 条）自己数出来，所以文案里写明是「缓冲内」。
//
// nsh 的组件体只跑一次，只有 JSX 位置的绑定会重算：三态用 `<If>` 切换，
// 派生值写成访问器，列表的空态也用 `<If>` 包住（`List` 自己的空态早退是冻结的）。
import { cleanup, host, mount, signal, Text, View } from "nsh";
import type { JSX, ViewStyle } from "nsh";
import { arr, errorMessage, shortTime, str } from "../../lib/format";
import {
  Badge,
  Button,
  Card,
  ConfirmBar,
  Empty,
  KeyValue,
  List,
  ListRow,
  LoadError,
  Loading,
  Notice,
  Row,
  SearchField,
  SplitPane,
  Stack,
} from "../../lib/ui";
import { c, t } from "../../lib/theme";

/** 本地环形缓冲的容量，一次读满就够数了（admin.rs: MQTT_ADMIN_BUFFER_CAPACITY）。 */
const SNAPSHOT_LIMIT = 1000;
/** 右侧每个过滤器最多展示多少条最近消息。 */
const DETAIL_ROWS = 20;
/** 消息正文预览截断长度。 */
const PREVIEW_CHARS = 200;

type Topic = Record<string, unknown>;
type Message = { topic: string; qos: string; retain: boolean; at: number; preview: string };
type Bucket = { count: number; latest: Message[] };

/** 调一次工作台操作；把 provider 的失败折成一句人话。 */
async function dispatch(operationId: string, input?: unknown, confirmed?: boolean): Promise<unknown> {
  try {
    return await host.call("navop.workbench.dispatch", {
      operationId,
      input: input ?? {},
      ...(confirmed === true ? { options: { confirmed: true } } : {}),
    });
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}

/** MQTT 主题匹配：`+` 恰好一段，`#` 匹配剩余所有层级。 */
function topicMatches(filter: string, topic: string): boolean {
  const pattern = filter.split("/");
  const parts = topic.split("/");
  for (let index = 0; index < pattern.length; index += 1) {
    const token = pattern[index];
    if (token === "#") return true;
    if (index >= parts.length) return false;
    if (token === "+") continue;
    if (token !== parts[index]) return false;
  }
  return pattern.length === parts.length;
}

/** provider 把消息属性放在 `[键, 值]` 字符串对里。 */
function property(message: unknown, key: string): string {
  for (const pair of arr(message, "properties")) {
    if (Array.isArray(pair) && String(pair[0]) === key) return String(pair[1]);
  }
  return "";
}

/** 把 `queryByWindow` 的一条摘要消息折成页面需要的形状；空主题丢弃。 */
function toMessage(raw: unknown): Message | null {
  const topic = str(raw, "topic", "");
  if (topic.length === 0) return null;
  const at = Number(property(raw, "received_at_ms"));
  const text = str(raw, "body_text", "").replace(/\s+/g, " ").trim();
  return {
    topic,
    qos: property(raw, "qos") || "?",
    retain: property(raw, "retain") === "true",
    at: Number.isFinite(at) ? at : 0,
    preview: text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text,
  };
}

function qosOf(topic: unknown): number | null {
  if (!topic || typeof topic !== "object") return null;
  const raw = (topic as Record<string, unknown>).queue_count;
  if (raw === null || raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function qosLabel(topic: unknown): string {
  const value = qosOf(topic);
  return value === null ? "—" : String(value);
}

function isAuto(topic: unknown): boolean {
  return str(topic, "topic_type", "") === "AUTO_SUBSCRIPTION";
}

function lastSegment(name: string): string {
  const parts = name.split("/");
  return parts[parts.length - 1];
}

/** 层级缩进：按 `/` 分段数算深度，太深的主题不再继续右移。 */
function depthOf(name: string): number {
  return Math.min(8, Math.max(0, name.split("/").length - 1));
}

export default function Topics() {
  const topics = signal<Topic[]>([]);
  const buckets = signal<Map<string, Bucket>>(new Map());
  const loading = signal(true);
  const firstLoad = signal(true);
  const error = signal<string | null>(null);
  const snapshotError = signal<string | null>(null);
  const notice = signal<string | null>(null);
  const noticeError = signal(false);
  const busy = signal(false);
  const filterText = signal("");
  const selected = signal<string | null>(null);
  const formOpen = signal(false);
  const draftTopic = signal("");
  const draftQos = signal(1);
  const pendingUnsub = signal<string | null>(null);
  let inFlight = false;

  async function load() {
    if (inFlight) return;
    inFlight = true;
    loading.set(true);
    let snapshotFailed = false;
    try {
      const [topicsResult, snapshot] = await Promise.all([
        dispatch("listTopics"),
        dispatch("queryByWindow", {
          ByTimeWindow: {
            topic: "#",
            begin_unix_ms: 0,
            end_unix_ms: Date.now(),
            page: 1,
            page_size: SNAPSHOT_LIMIT,
          },
        }).catch(() => {
          snapshotFailed = true;
          return null;
        }),
      ]);
      const list = Array.isArray(topicsResult) ? topicsResult : arr(topicsResult, "topics");
      const rows = list.filter((item): item is Topic => {
        if (!item || typeof item !== "object") return false;
        return str(item, "name", "").length > 0;
      });
      const messages = arr(snapshot, "messages")
        .map(toMessage)
        .filter((message): message is Message => message !== null)
        .sort((left, right) => right.at - left.at);
      const byFilter = new Map<string, Bucket>();
      for (const topic of rows) {
        const name = str(topic, "name", "");
        const bucket: Bucket = { count: 0, latest: [] };
        for (const message of messages) {
          if (!topicMatches(name, message.topic)) continue;
          bucket.count += 1;
          if (bucket.latest.length < DETAIL_ROWS) bucket.latest.push(message);
        }
        byFilter.set(name, bucket);
      }
      topics.set(rows);
      buckets.set(byFilter);
      snapshotError.set(snapshotFailed ? "本地消息缓冲快照读取失败，消息计数暂不可用。" : null);
      error.set(null);
      const current = selected();
      const exists = current !== null && rows.some((topic) => str(topic, "name", "") === current);
      if (!exists) {
        const first = rows.length > 0 ? str(rows[0], "name", "") : "";
        selected.set(first.length > 0 ? first : null);
        pendingUnsub.set(null);
      }
    } catch (failure) {
      error.set(errorMessage(failure));
    } finally {
      loading.set(false);
      firstLoad.set(false);
      inFlight = false;
    }
  }

  void load();

  // ---- 派生值 ---------------------------------------------------------

  const visibleTopics = () => {
    const needle = filterText().trim().toLowerCase();
    const list = topics();
    if (needle.length === 0) return list;
    return list.filter((topic) => str(topic, "name", "").toLowerCase().includes(needle));
  };
  const selectedTopic = () =>
    topics().find((topic) => str(topic, "name", "") === selected()) ?? null;
  const bucketOf = (name: string): Bucket | undefined => buckets().get(name);
  const countLabel = (name: string): string => {
    if (snapshotError() !== null) return "—";
    const bucket = bucketOf(name);
    return bucket === undefined ? "0 条" : `${bucket.count} 条`;
  };

  // ---- 动作 -----------------------------------------------------------

  function toggleSelect(name: string) {
    selected.set(name);
    pendingUnsub.set(null);
    notice.set(null);
  }

  async function subscribe() {
    if (busy()) return;
    const pattern = draftTopic().trim();
    const qos = draftQos();
    if (pattern.length === 0) {
      noticeError.set(true);
      notice.set("先填一个主题过滤器再订阅。");
      return;
    }
    busy.set(true);
    try {
      await dispatch("subscribe", { topic: pattern, qos }, true);
      noticeError.set(false);
      notice.set(`已订阅 ${pattern}（QoS ${qos}）`);
      draftTopic.set("");
      await load();
    } catch (failure) {
      noticeError.set(true);
      notice.set(`订阅失败：${errorMessage(failure)}`);
    } finally {
      busy.set(false);
    }
  }

  async function unsubscribe() {
    if (busy()) return;
    const name = pendingUnsub();
    if (name === null) return;
    busy.set(true);
    try {
      await dispatch("unsubscribe", { topic: name }, true);
      noticeError.set(false);
      notice.set(`已取消订阅 ${name}`);
      pendingUnsub.set(null);
      await load();
    } catch (failure) {
      noticeError.set(true);
      notice.set(`取消失败：${errorMessage(failure)}`);
    } finally {
      busy.set(false);
    }
  }

  const root: ViewStyle = {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: c.bg(),
  };

  /** 右侧详情：选中过滤器的参数 + 本地缓冲里的最近消息。 */
  function detailPane(): JSX.Element {
    const name = selected();
    if (name === null) {
      return (
        <Empty
          title="选择左侧的主题"
          hint="右侧显示该过滤器的 QoS、订阅类型，以及本地缓冲里匹配到的最近消息。"
        />
      );
    }
    const topic = selectedTopic();
    const auto = isAuto(topic);
    const bucket = bucketOf(name);
    const latest = bucket === undefined ? [] : bucket.latest;
    return (
      <Stack scroll padding={14} gap={12}>
        <Row gap={8} wrap style={{ justifyContent: "space-between" }}>
          <Row gap={8} style={{ minWidth: 0 }}>
            <Text numberOfLines={1} style={{ ...t.mono, fontSize: 14 }}>
              {name}
            </Text>
            <Badge text={auto ? "自动订阅" : "手动订阅"} tone={auto ? "warn" : "neutral"} />
          </Row>
          <If when={auto}>
            <Text style={t.meta}>自动订阅（连接配置 auto_subscribe），要取消请改连接配置</Text>
          </If>
          <If when={!auto}>
            <Button
              label="取消订阅"
              small
              tone="danger"
              onPress={() => pendingUnsub.set(name)}
            />
          </If>
        </Row>

        <If when={pendingUnsub() !== null}>
          <ConfirmBar
            message={`取消订阅 ${name}？provider 会向 broker 撤销该过滤器，之后不再收到匹配的消息。`}
            confirmLabel="确认取消"
            busy={busy()}
            onConfirm={() => void unsubscribe()}
            onCancel={() => pendingUnsub.set(null)}
          />
        </If>

        <If when={auto}>
          <Notice message="自动订阅来自连接配置的 auto_subscribe，不能在页面里单独取消。" tone="warn" />
        </If>

        <Card title="订阅信息">
          <KeyValue
            rows={[
              ["主题过滤器", name],
              ["QoS", qosLabel(topic)],
              ["订阅类型", auto ? "自动订阅（连接配置 auto_subscribe）" : "手动订阅"],
              ["provider 说明", str(topic, "description", "—")],
              ["缓冲内消息", bucket === undefined ? "—" : `${bucket.count} 条`],
            ]}
          />
        </Card>

        <Card
          title={`最近消息（${latest.length}）`}
          hint={`最多 ${DETAIL_ROWS} 条，来自本地缓冲快照（上限 ${SNAPSHOT_LIMIT} 条）`}
        >
          <If
            when={latest.length === 0}
            else={
              <View style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {latest.map((message) => (
                  <View style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <Text numberOfLines={1} style={t.mono}>
                      {message.topic}
                    </Text>
                    <Row gap={6} wrap>
                      <Badge text={`QoS ${message.qos}`} />
                      <If when={message.retain}>
                        <Badge text="retained" tone="warn" />
                      </If>
                      <Text style={t.meta}>
                        {message.at > 0 ? shortTime(new Date(message.at).toISOString()) : "-"}
                      </Text>
                    </Row>
                    <Text
                      numberOfLines={2}
                      style={{ fontSize: 12, color: c.text(), paddingLeft: 2 }}
                    >
                      {message.preview}
                    </Text>
                  </View>
                ))}
              </View>
            }
          >
            <Text style={t.meta}>
              {snapshotError() !== null
                ? "本地缓冲读取失败，暂时无法展示消息。"
                : "本地缓冲里还没有匹配的消息：订阅后等一次发布，或检查过滤器是否真的匹配。"}
            </Text>
          </If>
        </Card>

        <Text style={t.meta}>
          MQTT 没有「列出 broker 全部主题」的接口，这里只列出本连接的订阅过滤器；
          消息数由本地环形缓冲统计，不代表 broker 的历史总量。
        </Text>
      </Stack>
    );
  }

  /** 数据到手后的主界面。 */
  function mainView(): JSX.Element {
    return (
      <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <Row
          gap={8}
          wrap
          style={{
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderBottomWidth: 1,
            borderBottomColor: c.line(),
            justifyContent: "space-between",
          }}
        >
          <Row gap={8} wrap>
            <Text style={t.h1}>主题</Text>
            <Badge text={`${topics().length} 个订阅`} />
            <Text style={t.meta}>消息数来自本地缓冲</Text>
          </Row>
          <Row gap={6}>
            <SearchField
              value={filterText()}
              onChange={(text) => filterText.set(text)}
              placeholder="按主题名过滤"
              width={220}
            />
            <Button
              label={loading() ? "刷新中…" : "刷新"}
              small
              onPress={() => void load()}
            />
            <Button
              label={formOpen() ? "收起订阅" : "订阅"}
              small
              tone="primary"
              onPress={() => {
                formOpen.set(!formOpen());
                notice.set(null);
              }}
            />
          </Row>
        </Row>

        <If when={error() !== null}>
          <Row gap={8} style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            <Notice message={`刷新失败：${error() ?? ""}`} tone="danger" />
            <Button label="重试" small onPress={() => void load()} />
          </Row>
        </If>

        <If when={notice() !== null}>
          <Row style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            <If
              when={noticeError()}
              else={<Notice message={notice() ?? ""} />}
            >
              <Notice message={notice() ?? ""} tone="danger" />
            </If>
          </Row>
        </If>

        <If when={formOpen()}>
          <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
            <Card title="新增订阅" hint="主题可以是过滤器：+ 匹配一层，# 匹配剩余所有层级">
              <Row gap={8} wrap>
                <SearchField
                  value={draftTopic()}
                  onChange={(text) => draftTopic.set(text)}
                  placeholder="例如 sensors/+/temperature 或 devices/#"
                  width={300}
                />
                <Text style={t.label}>QoS</Text>
                {[0, 1, 2].map((qos) => (
                  <If
                    when={draftQos() === qos}
                    else={
                      <Button label={`QoS ${qos}`} small onPress={() => draftQos.set(qos)} />
                    }
                  >
                    <Button
                      label={`QoS ${qos}`}
                      small
                      tone="primary"
                      onPress={() => draftQos.set(qos)}
                    />
                  </If>
                ))}
                <Button
                  label={busy() ? "订阅中…" : "确认订阅"}
                  small
                  tone="primary"
                  onPress={() => void subscribe()}
                />
              </Row>
            </Card>
          </View>
        </If>

        <If when={snapshotError() !== null}>
          <Row style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            <Notice message={snapshotError() ?? ""} tone="danger" />
          </Row>
        </If>

        <SplitPane
          width={320}
          left={
            <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <If
                when={visibleTopics().length === 0}
                else={
                  <List
                    items={visibleTopics()}
                    keyOf={(topic) => str(topic, "name", "")}
                    selected={selected()}
                    onSelect={toggleSelect}
                    render={(topic) => {
                      const name = str(topic, "name", "");
                      return (
                        <View style={{ paddingLeft: depthOf(name) * 14 }}>
                          <ListRow
                            title={lastSegment(name)}
                            subtitle={name}
                            trailing={
                              <Row gap={4}>
                                <Badge text={`QoS ${qosLabel(topic)}`} />
                                <If when={isAuto(topic)}>
                                  <Badge text="自动" tone="warn" />
                                </If>
                                <Badge text={countLabel(name)} />
                              </Row>
                            }
                          />
                        </View>
                      );
                    }}
                  />
                }
              >
                <Empty
                  title={topics().length === 0 ? "还没有订阅任何主题" : "没有匹配的主题"}
                  hint={
                    topics().length === 0
                      ? "点右上角「订阅」添加一个过滤器；也可以在连接配置里把自动订阅设为 #。"
                      : "清空过滤词，或换一个关键词。"
                  }
                />
              </If>
            </View>
          }
          right={detailPane()}
        />
      </View>
    );
  }

  /** 首次加载完成前只显示 Loading；失败给重试，成功后进主界面。 */
  function content(): JSX.Element {
    return (
      <If when={topics().length === 0 && error() !== null} else={mainView()}>
        <LoadError message={error() ?? ""} onRetry={() => void load()} />
      </If>
    );
  }

  return (
    <View style={root}>
      <If when={firstLoad()} else={content()}>
        <Loading label="正在读取订阅主题…" />
      </If>
    </View>
  );
}

mount(Topics);
