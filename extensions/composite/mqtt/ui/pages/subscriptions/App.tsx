// MQTT 订阅管理页。
//
// 数据事实：
//  1. `listTopics` 只返回当前会话的订阅（含连接配置自动生成的 AUTO_SUBSCRIPTION），
//     `queue_count` 在这一条里携带的是订阅 QoS，不是消息数量；
//  2. provider 没有“每个订阅收到多少条”的累计计数，所以“消息数”用本地环形缓冲里
//     该过滤器命中的条数表示，并明确标注为缓冲内条数；
//  3. “活跃”用缓冲里最近 5 分钟内是否有命中消息判断，同样只是本地观测。
import { Scroll, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
import { Input } from "nsh/base";
import { invoke, SLOW_TIMEOUT_MS } from "../../lib/navop";
import { arr, errorMessage, str } from "../../lib/format";
import {
  Badge,
  Button,
  Card,
  ConfirmBar,
  Empty,
  LoadError,
  Loading,
  Notice,
  Row,
} from "../../lib/ui";
import { c, r, t } from "../../lib/theme";

const QOS_OPTIONS = [0, 1, 2] as const;
const ACTIVE_WINDOW_MS = 5 * 60_000;

type Subscription = {
  name: string;
  qos: number | null;
  topicType: string;
  description: string;
};

type SnapshotMessage = {
  topic: string;
  receivedAt: number;
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

function toSubscription(raw: unknown): Subscription | null {
  if (raw === null || typeof raw !== "object") return null;
  const name = str(raw, "name", "");
  if (name.length === 0) return null;
  const queue = Number((raw as Record<string, unknown>).queue_count);
  const qos = queue === 0 || queue === 1 || queue === 2 ? queue : null;
  return {
    name,
    qos,
    topicType: str(raw, "topic_type", ""),
    description: str(raw, "description", ""),
  };
}

function isAutomatic(subscription: Subscription): boolean {
  return subscription.topicType === "AUTO_SUBSCRIPTION";
}

function toSnapshotMessage(raw: unknown): SnapshotMessage | null {
  const topic = str(raw, "topic", "");
  if (topic.length === 0) return null;
  let receivedAt = 0;
  for (const pair of arr(raw, "properties")) {
    if (Array.isArray(pair) && pair[0] === "received_at_ms") {
      receivedAt = Number(pair[1]);
    }
  }
  return { topic, receivedAt: Number.isFinite(receivedAt) ? receivedAt : 0 };
}

/** MQTT 过滤器合法性：`#` 只能是最后一层且独占，`+` 必须独占一层。 */
function filterProblem(filter: string): string | null {
  if (filter.trim().length === 0) return "topic 不能为空。";
  if (filter !== filter.trim()) return "topic 首尾不能有空格。";
  const levels = filter.split("/");
  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index];
    if (level.includes("#") && (level !== "#" || index !== levels.length - 1)) {
      return "「#」只能作为最后一层单独出现。";
    }
    if (level.includes("+") && level !== "+") {
      return "「+」必须独占一层。";
    }
  }
  return null;
}

function topicMatches(filter: string, topic: string): boolean {
  const parts = filter.split("/");
  const actual = topic.split("/");
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index] === "#") return true;
    if (index >= actual.length) return false;
    if (parts[index] !== "+" && parts[index] !== actual[index]) return false;
  }
  return parts.length === actual.length;
}

function qosLabel(qos: number | null): string {
  return qos === null ? "自定义" : String(qos);
}

function statusOf(recent: number | null): { text: string; tone: "ok" | "neutral" | "info" | "warn" } {
  if (recent === null) return { text: "未知", tone: "neutral" };
  if (recent > 0) return { text: "活跃", tone: "ok" };
  return { text: "空闲", tone: "neutral" };
}

export default function Subscriptions() {
  const subscriptions = signal<Subscription[]>([]);
  const snapshot = signal<SnapshotMessage[] | null>(null);
  const loading = signal(true);
  const refreshing = signal(false);
  const error = signal<string | null>(null);
  const snapshotError = signal<string | null>(null);
  const notice = signal<string | null>(null);
  const filterText = signal("");

  const adding = signal(false);
  const newTopic = signal("");
  const newQos = signal<0 | 1 | 2>(1);
  const addBusy = signal(false);
  const addError = signal<string | null>(null);

  const pendingUnsub = signal<string | null>(null);
  const unsubBusy = signal<string | null>(null);

  function visible(): Subscription[] {
    const needle = filterText().trim().toLowerCase();
    if (needle.length === 0) return subscriptions();
    return subscriptions().filter(
      (subscription) =>
        subscription.name.toLowerCase().includes(needle) ||
        subscription.description.toLowerCase().includes(needle),
    );
  }

  function countMatching(filter: string, withinMs: number | null): number | null {
    const messages = snapshot();
    if (messages === null) return null;
    const boundary = withinMs === null ? 0 : Date.now() - withinMs;
    let count = 0;
    for (const message of messages) {
      if (message.receivedAt < boundary) continue;
      if (topicMatches(filter, message.topic)) count += 1;
    }
    return count;
  }

  async function load(initial: boolean) {
    if (refreshing()) return;
    refreshing.set(true);
    if (initial) loading.set(true);
    try {
      const result = await dispatch("listTopics");
      const rows = arr(result, "topics")
        .map(toSubscription)
        .filter((row): row is Subscription => row !== null);
      subscriptions.set(rows);
      error.set(null);
    } catch (failure) {
      if (subscriptions().length === 0) error.set(errorMessage(failure));
      else notice.set(`刷新订阅失败：${errorMessage(failure)}`);
      loading.set(false);
      refreshing.set(false);
      return;
    }

    // 消息计数是辅助信息，失败不阻塞订阅表。
    try {
      const result = await dispatch("queryByWindow", {
        ByTimeWindow: {
          topic: "#",
          begin_unix_ms: 0,
          end_unix_ms: Date.now(),
          page: 1,
          page_size: 1000,
        },
      });
      const rows = arr(result, "messages")
        .map(toSnapshotMessage)
        .filter((row): row is SnapshotMessage => row !== null);
      snapshot.set(rows);
      snapshotError.set(null);
    } catch (failure) {
      snapshot.set(null);
      snapshotError.set(errorMessage(failure));
    } finally {
      loading.set(false);
      refreshing.set(false);
    }
  }

  async function submit() {
    if (addBusy()) return;
    const topic = newTopic().trim();
    const problem = filterProblem(topic);
    if (problem !== null) {
      addError.set(problem);
      return;
    }
    if (subscriptions().some((subscription) => subscription.name === topic)) {
      addError.set("这个 topic 已经在订阅列表里了。");
      return;
    }
    addBusy.set(true);
    addError.set(null);
    try {
      await dispatch("subscribe", { topic, qos: newQos() }, true);
      notice.set(`已订阅 ${topic}（QoS ${newQos()}）。`);
      newTopic.set("");
      adding.set(false);
      await load(false);
    } catch (failure) {
      addError.set(errorMessage(failure));
    } finally {
      addBusy.set(false);
    }
  }

  async function remove(subscription: Subscription) {
    if (unsubBusy() !== null) return;
    unsubBusy.set(subscription.name);
    try {
      await dispatch("unsubscribe", { topic: subscription.name }, true);
      pendingUnsub.set(null);
      notice.set(`已取消订阅 ${subscription.name}。`);
      await load(false);
    } catch (failure) {
      notice.set(`取消订阅失败：${errorMessage(failure)}`);
    } finally {
      unsubBusy.set(null);
    }
  }

  void load(true);

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
        <Text style={t.h1}>订阅</Text>
        <Badge text={`${subscriptions().length} 个`} />
        <View style={{ flex: 1, minWidth: 8 }} />
        <View
          style={{
            height: 28,
            width: 260,
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
            placeholder="搜索订阅模式或说明"
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
        {refreshing() ? (
          <Button label="刷新中…" small disabled />
        ) : (
          <Button label="刷新" small onPress={() => void load(false)} />
        )}
        {adding() ? (
          <Button label="收起表单" small onPress={() => adding.set(false)} />
        ) : (
          <Button
            label="新增订阅"
            small
            tone="primary"
            onPress={() => {
              addError.set(null);
              adding.set(true);
            }}
          />
        )}
      </Row>
    );
  }

  function addForm(): JSX.Element {
    return (
      <Card title="新增订阅" hint="topic 支持 MQTT 通配符：+ 一层，# 末尾多层">
        <View style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Row gap={10} align="center">
            <Input
              value={newTopic()}
              onChange={(text) => newTopic.set(text)}
              onSubmit={() => void submit()}
              placeholder="例如 sensor/+/temperature 或 devices/#"
              style={{
                flex: 1,
                minWidth: 0,
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
            <Text style={t.label}>QoS</Text>
            <Row gap={4}>
              {QOS_OPTIONS.map((qos) =>
                newQos() === qos ? (
                  <Button
                    label={String(qos)}
                    small
                    tone="primary"
                    onPress={() => newQos.set(qos)}
                  />
                ) : (
                  <Button label={String(qos)} small onPress={() => newQos.set(qos)} />
                ),
              )}
            </Row>
            {addBusy() ? (
              <Button label="订阅中…" small disabled />
            ) : (
              <Button label="确认订阅" small tone="primary" onPress={() => void submit()} />
            )}
          </Row>
          {addError() === null ? (
            <Text style={t.meta}>订阅会先校验过滤器格式，写操作会带二次确认。</Text>
          ) : (
            <Notice message={addError() ?? ""} tone="danger" />
          )}
        </View>
      </Card>
    );
  }

  function tableHeader(): JSX.Element {
    return (
      <Row
        gap={8}
        style={{
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderBottomWidth: 1,
          borderBottomColor: c.line(),
        }}
      >
        <Text style={{ ...t.label, flex: 1, minWidth: 0 }}>订阅模式</Text>
        <Text style={{ ...t.label, width: 64, textAlign: "center" }}>QoS</Text>
        <Text style={{ ...t.label, width: 88, textAlign: "right" }}>缓冲内消息</Text>
        <Text style={{ ...t.label, width: 88, textAlign: "right" }}>近 5 分钟</Text>
        <Text style={{ ...t.label, width: 92, textAlign: "center" }}>状态</Text>
        <Text style={{ ...t.label, width: 120, textAlign: "right" }}>操作</Text>
      </Row>
    );
  }

  function statusBadge(subscription: Subscription): JSX.Element {
    if (isAutomatic(subscription)) return <Badge text="自动订阅" tone="info" />;
    const status = statusOf(countMatching(subscription.name, ACTIVE_WINDOW_MS));
    return <Badge text={status.text} tone={status.tone} />;
  }

  function countText(subscription: Subscription, withinMs: number | null): string {
    const count = countMatching(subscription.name, withinMs);
    return count === null ? "—" : String(count);
  }

  function unsubscribeCell(subscription: Subscription): JSX.Element {
    if (isAutomatic(subscription)) return <Text style={t.meta}>只读</Text>;
    if (pendingUnsub() === subscription.name) return <Text style={t.meta}>待确认</Text>;
    // Button 的 onPress 在创建时捕获，因此这里每次条件变化都重建按钮。
    return (
      <Button
        label="取消订阅"
        small
        tone="danger"
        onPress={() => pendingUnsub.set(subscription.name)}
      />
    );
  }

  function subscriptionRow(subscription: Subscription): JSX.Element {
    return (
      <View
        style={{
          borderBottomWidth: 1,
          borderBottomColor: c.line(),
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Row gap={8} style={{ paddingHorizontal: 12, paddingVertical: 9 }}>
          <View style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            <Text numberOfLines={1} style={{ ...t.mono, fontSize: 12.5, color: c.text() }}>
              {subscription.name}
            </Text>
            {subscription.description.length === 0 ? null : (
              <Text numberOfLines={1} style={t.meta}>
                {subscription.description}
              </Text>
            )}
          </View>
          <Text style={{ ...t.meta, width: 64, textAlign: "center" }}>
            {qosLabel(subscription.qos)}
          </Text>
          <Text style={{ ...t.meta, width: 88, textAlign: "right" }}>
            {countText(subscription, null)}
          </Text>
          <Text style={{ ...t.meta, width: 88, textAlign: "right" }}>
            {countText(subscription, ACTIVE_WINDOW_MS)}
          </Text>
          <View style={{ width: 92, alignItems: "center" }}>
            {statusBadge(subscription)}
          </View>
          <View style={{ width: 120, alignItems: "flex-end" }}>
            {unsubscribeCell(subscription)}
          </View>
        </Row>
        <If when={pendingUnsub() === subscription.name}>
          <View style={{ paddingHorizontal: 12, paddingBottom: 9 }}>
            {unsubBusy() === subscription.name ? (
              <ConfirmBar
                message={`取消订阅 ${subscription.name}？对应 queue 会一并删除，之后不再收到匹配消息。`}
                confirmLabel="确认取消"
                busy
                onConfirm={() => void remove(subscription)}
                onCancel={() => pendingUnsub.set(null)}
              />
            ) : (
              <ConfirmBar
                message={`取消订阅 ${subscription.name}？对应 queue 会一并删除，之后不再收到匹配消息。`}
                confirmLabel="确认取消"
                onConfirm={() => void remove(subscription)}
                onCancel={() => pendingUnsub.set(null)}
              />
            )}
          </View>
        </If>
      </View>
    );
  }

  function table(): JSX.Element {
    return (
      <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {tableHeader()}
        <Scroll style={{ flex: 1, minHeight: 0 }}>
          <View style={{ display: "flex", flexDirection: "column" }}>
            <Each of={visible()} key={(subscription) => subscription.name}>
              {(subscription) => subscriptionRow(subscription())}
            </Each>
          </View>
        </Scroll>
        <Row
          gap={8}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderTopWidth: 1,
            borderTopColor: c.line(),
          }}
        >
          <Text style={t.meta}>
            {snapshot() === null
              ? "消息数：本地缓冲不可用"
              : `消息数基于 provider 本地缓冲（上限 1000 条），统计到 ${snapshot()?.length ?? 0} 条`}
          </Text>
          <View style={{ flex: 1 }} />
          <Text style={t.meta}>自动订阅由连接配置维护，不能在这里取消</Text>
        </Row>
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
      <If when={notice() !== null}>
        <View style={{ paddingHorizontal: 14, paddingTop: 8 }}>
          <Notice message={notice() ?? ""} tone="ok" />
        </View>
      </If>
      <If when={snapshotError() !== null}>
        <View style={{ paddingHorizontal: 14, paddingTop: 8 }}>
          <Notice message={`消息统计不可用：${snapshotError() ?? ""}`} tone="warn" />
        </View>
      </If>
      <If when={adding()}>
        <View style={{ paddingHorizontal: 14, paddingTop: 10 }}>
          {addForm()}
        </View>
      </If>

      <If when={loading() && subscriptions().length === 0}>
        <Loading label="正在读取订阅…" />
      </If>
      <If when={!loading() && error() !== null && subscriptions().length === 0}>
        <LoadError message={error() ?? ""} onRetry={() => void load(true)} />
      </If>
      <If when={!loading() && error() === null && subscriptions().length === 0}>
        <Empty
          title="还没有订阅"
          hint="点右上角「新增订阅」创建第一条；连接配置里的自动订阅也会出现在这里。"
        />
      </If>
      <If when={subscriptions().length > 0 && visible().length === 0}>
        <Empty title="没有匹配的订阅" hint="换个搜索词，或清空搜索框。" />
      </If>
      <If when={visible().length > 0}>{table()}</If>
      <If when={subscriptions().length > 0 && visible().length > 0 && error() !== null}>
        <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
          <Notice message={`订阅列表可能不是最新：${error() ?? ""}`} tone="warn" />
        </View>
      </If>
    </View>
  );
}
