// RocketMQ 概览页：集群状态条 → 指标卡组 → 节点拓扑表。
//
// 数据全走 `navop.workbench.dispatch`：页面从 RocketMQ 连接工作台嵌入，
// 连接由宿主注入，所以这里不传任何连接参数。
//
// provider 各版本返回的字段并不一致（例如没有消费组数、没有磁盘使用率），
// 所以指标卡是「有字段才有卡」：缺失的指标直接不渲染，不做空卡占位。
import { cleanup, host, mount, signal, Text, View } from "nsh";
import { errorMessage, humanBytes, str } from "../../lib/format";
import {
  Badge,
  Button,
  Card,
  Empty,
  LoadError,
  Loading,
  Meter,
  Notice,
  Row,
  Stack,
  Stat,
} from "../../lib/ui";
import { c, t } from "../../lib/theme";

type Json = Record<string, unknown>;
type Role = "master" | "slave";

interface BrokerNode {
  cluster: string;
  name: string;
  address: string;
  role: Role;
  version: string;
  diskRatio: number | null;
  diskText: string;
}

interface MetricCard {
  label: string;
  value: string;
  hint?: string;
}

/** 自动刷新间隔（与旧 shell 页保持一致）。 */
const REFRESH_MS = 5000;

/** 调一次工作台操作；失败折成一句人话。 */
async function dispatch(operationId: string): Promise<unknown> {
  try {
    return await host.call("navop.workbench.dispatch", { operationId, input: {} });
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}

function asRecord(value: unknown): Json | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Json;
}

/** 取数字字段（provider 的 JSON 不保证是 number，也可能是数字字符串）。 */
function num(source: unknown, key: string): number | null {
  const record = asRecord(source);
  if (record === null) return null;
  const raw = record[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function firstNum(source: unknown, keys: string[]): number | null {
  for (const key of keys) {
    const value = num(source, key);
    if (value !== null) return value;
  }
  return null;
}

/** `extras` 是 `[[k, v], ...]`。 */
function extrasOf(metrics: Json | null): Map<string, string> {
  const map = new Map<string, string>();
  const raw = metrics === null ? null : metrics.extras;
  if (!Array.isArray(raw)) return map;
  for (const item of raw) {
    if (Array.isArray(item) && item.length >= 2) {
      map.set(String(item[0]), String(item[1]));
    }
  }
  return map;
}

/** 有的宿主把指标包在 `{ metrics: … }` 里，两种形状都吃。 */
function unwrapMetrics(value: unknown): Json | null {
  const record = asRecord(value);
  if (record === null) return null;
  return asRecord(record.metrics) ?? record;
}

function clustersOf(value: unknown): Json[] {
  const record = asRecord(value);
  const raw = record !== null && Array.isArray(record.clusters) ? record.clusters : [];
  const list = raw.length > 0 ? raw : Array.isArray(value) ? value : [];
  return list
    .map((item) => asRecord(item))
    .filter((item): item is Json => item !== null);
}

/**
 * 节点角色。契约目前只有主节点地址（clusterOverview 逐 brokerName 取主节点），
 * 所以没有 role 字段时按 Master 处理；将来 provider 补了 role / broker_id 就按字段走。
 */
function roleOf(broker: Json): Role {
  const text = `${str(broker, "role", "")} ${str(broker, "broker_role", "")}`.toLowerCase();
  if (text.includes("slave") || text.includes("从")) return "slave";
  if (text.includes("master") || text.includes("主")) return "master";
  const id = firstNum(broker, ["broker_id", "brokerId"]);
  if (id !== null) return id === 0 ? "master" : "slave";
  return "master";
}

/** 磁盘使用率：优先直接字段（0..1 或百分数），其次 used/total 字节。 */
function diskOf(broker: Json): { ratio: number; text: string } | null {
  const direct = firstNum(broker, [
    "disk_usage",
    "disk_usage_ratio",
    "disk_used_ratio",
    "disk_percent",
    "diskUsage",
  ]);
  if (direct !== null && direct >= 0) {
    const ratio = direct > 1 ? direct / 100 : direct;
    if (ratio <= 1) return { ratio, text: `${Math.round(ratio * 100)}%` };
  }
  const used = firstNum(broker, ["disk_used_bytes", "disk_used"]);
  const total = firstNum(broker, ["disk_total_bytes", "disk_total", "disk_capacity_bytes"]);
  if (used !== null && total !== null && total > 0) {
    return {
      ratio: Math.max(0, Math.min(1, used / total)),
      text: `${humanBytes(used)} / ${humanBytes(total)}`,
    };
  }
  return null;
}

function nodesOf(clusters: Json[]): BrokerNode[] {
  const nodes: BrokerNode[] = [];
  for (const cluster of clusters) {
    const name = str(cluster, "name", "");
    const brokers = Array.isArray(cluster.brokers) ? cluster.brokers : [];
    for (const item of brokers) {
      const broker = asRecord(item);
      if (broker === null) continue;
      const disk = diskOf(broker);
      nodes.push({
        cluster: name.length > 0 ? name : "-",
        name: str(broker, "name", ""),
        address: str(broker, "address", "-"),
        role: roleOf(broker),
        version: str(broker, "version", ""),
        diskRatio: disk === null ? null : disk.ratio,
        diskText: disk === null ? "" : disk.text,
      });
    }
  }
  return nodes;
}

/** 千分位（不依赖 Intl，llrt 上不一定有完整 locale）。 */
function count(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function rate(value: number): string {
  return value.toFixed(1);
}

/** 指标卡：provider 有哪些字段就做哪些卡。 */
function metricCards(metrics: Json | null): MetricCard[] {
  const cards: MetricCard[] = [];
  const extra = extrasOf(metrics);
  const extraNum = (keys: string[]): number | null => {
    for (const key of keys) {
      const raw = extra.get(key);
      if (raw === undefined) continue;
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };

  const topics = firstNum(metrics, ["topic_count", "topicCount"]);
  if (topics !== null) cards.push({ label: "Topic 数", value: count(topics), hint: "NameServer 已注册" });

  const groups =
    firstNum(metrics, ["group_count", "consumer_group_count", "groupCount"]) ??
    extraNum(["group_count", "consumer_group_count"]);
  if (groups !== null) cards.push({ label: "消费组数", value: count(groups), hint: "全部订阅组" });

  const today = firstNum(metrics, ["message_count_today", "messageCountToday"]);
  if (today !== null) cards.push({ label: "今日消息量", value: count(today), hint: "Broker 今日写入" });

  const total =
    firstNum(metrics, ["message_count_total", "total_message_count"]) ??
    extraNum(["msg_put_total", "message_count_total"]);
  if (total !== null) cards.push({ label: "消息总量", value: count(total), hint: "累计写入" });

  const connections = firstNum(metrics, ["connection_count", "connectionCount"]);
  if (connections !== null) {
    cards.push({ label: "连接数", value: count(connections), hint: "生产者 + 消费者" });
  }

  const tpsIn = firstNum(metrics, ["tps_in", "tpsIn"]);
  if (tpsIn !== null) cards.push({ label: "入 TPS", value: rate(tpsIn), hint: "每秒写入" });

  const tpsOut = firstNum(metrics, ["tps_out", "tpsOut"]);
  if (tpsOut !== null) cards.push({ label: "出 TPS", value: rate(tpsOut), hint: "每秒投递" });

  const lag =
    firstNum(metrics, ["lag", "backlog", "diff_total", "consume_lag"]) ??
    extraNum(["lag", "backlog", "diff_total"]);
  if (lag !== null) cards.push({ label: "堆积量", value: count(lag), hint: "消费位点落后" });

  return cards;
}

/** 本地时钟 `HH:mm:ss`（历史记录/更新时间用）。 */
function clock(): string {
  const now = new Date();
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
}

/** 状态条里的一个字段：小标题 + 值 + 可选说明。 */
function Field(props: { label: string; value: string; hint?: string }) {
  return (
    <View style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 120 }}>
      <Text numberOfLines={1} style={t.label}>
        {props.label}
      </Text>
      <Text
        numberOfLines={1}
        style={{ fontSize: 14, fontWeight: "600", color: c.text(), fontVariant: ["tabular-nums"] }}
      >
        {props.value}
      </Text>
      {props.hint === undefined ? null : (
        <Text numberOfLines={1} style={t.meta}>
          {props.hint}
        </Text>
      )}
    </View>
  );
}

export default function Overview() {
  const loading = signal(true);
  const busy = signal(false);
  const error = signal<string | null>(null);
  const metrics = signal<Json | null>(null);
  const clusters = signal<Json[]>([]);
  const updatedAt = signal<string | null>(null);
  const auto = signal(true);

  /** 只认最后一次请求的结果，避免自动刷新与手刷互相盖掉。 */
  let sequence = 0;

  const nodes = () => nodesOf(clusters());
  const hasData = () => metrics() !== null || clusters().length > 0;
  const masterCount = () => nodes().filter((node) => node.role === "master").length;
  const slaveCount = () => nodes().filter((node) => node.role === "slave").length;
  const versions = () => {
    const unique: string[] = [];
    for (const node of nodes()) {
      if (node.version.length === 0 || unique.includes(node.version)) continue;
      unique.push(node.version);
    }
    return unique;
  };

  function load() {
    const ticket = ++sequence;
    if (!hasData()) loading.set(true);
    busy.set(true);
    error.set(null);
    return (async () => {
      try {
        const [rawMetrics, rawClusters] = await Promise.all([
          dispatch("metrics"),
          dispatch("clusterOverview"),
        ]);
        if (ticket !== sequence) return;
        metrics.set(unwrapMetrics(rawMetrics));
        clusters.set(clustersOf(rawClusters));
        updatedAt.set(clock());
      } catch (failure) {
        if (ticket !== sequence) return;
        error.set(errorMessage(failure));
      } finally {
        if (ticket === sequence) {
          loading.set(false);
          busy.set(false);
        }
      }
    })();
  }

  // 自动刷新：整页只有一个定时器，卸载时用 cleanup 释放。
  const timer = setInterval(() => {
    if (auto() && !busy()) void load();
  }, REFRESH_MS);
  cleanup(() => clearInterval(timer));

  void load();

  const statusTone = () => (nodes().length > 0 ? "ok" : "warn");
  const statusLabel = () => (nodes().length > 0 ? "已连接" : "无可用节点");
  const versionText = () => {
    const list = versions();
    return list.length === 0 ? "未知" : list.join(" · ");
  };

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
          <Text style={t.h1}>RocketMQ 概览</Text>
          <Badge text={statusLabel()} tone={statusTone()} />
          <Text style={t.meta}>
            {updatedAt() === null ? "尚未刷新" : `更新于 ${updatedAt() ?? ""}`}
          </Text>
          {auto() ? <Text style={t.meta}>· 每 5 秒自动刷新</Text> : null}
        </Row>
        <Row gap={6}>
          <Button
            label={busy() ? "刷新中…" : "刷新"}
            small
            disabled={busy()}
            onPress={() => void load()}
          />
          <Button
            label={auto() ? "自动刷新：开" : "自动刷新：关"}
            small
            tone={auto() ? "primary" : "ghost"}
            onPress={() => auto.set(!auto())}
          />
        </Row>
      </Row>

      {loading() && !hasData() ? (
        <Loading label="正在读取集群信息…" />
      ) : error() !== null && !hasData() ? (
        <LoadError message={error() ?? ""} onRetry={() => void load()} />
      ) : (
        <Stack scroll padding={14} gap={12}>
          {error() === null ? null : (
            <Notice message={`刷新失败：${error() ?? ""}`} tone="danger" />
          )}

          <Card
            title="集群状态"
            hint={`${clusters().length} 个集群 · ${nodes().length} 个 Broker`}
          >
            <Row gap={16} wrap>
              <Field label="连接状态" value={statusLabel()} />
              <Field label="Broker 数" value={String(nodes().length)} />
              <Field
                label="主从分布"
                value={`主 ${masterCount()} · 从 ${slaveCount()}`}
                hint={slaveCount() === 0 ? "provider 只上报主节点地址" : undefined}
              />
              <Field label="版本" value={versionText()} />
              <Field label="集群数" value={String(clusters().length)} />
            </Row>
          </Card>

          {metricCards(metrics()).length === 0 ? (
            <Notice message="provider 没有返回任何指标字段。" />
          ) : (
            <View style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Row gap={10} style={{ justifyContent: "space-between" }}>
                <Text style={t.label}>关键指标</Text>
                <Text style={t.meta}>按 provider 上报的字段生成</Text>
              </Row>
              <Row gap={10} wrap>
                {metricCards(metrics()).map((card) => (
                  <Stat label={card.label} value={card.value} hint={card.hint} />
                ))}
              </Row>
            </View>
          )}

          <Card title="集群节点" hint="地址取自 NameServer 路由，磁盘使用率视 provider 上报而定">
            {nodes().length === 0 ? (
              <Empty
                title="NameServer 未返回集群拓扑"
                hint="请确认 nameserver 地址与网络可达。"
              />
            ) : (
              <View style={{ display: "flex", flexDirection: "column" }}>
                <Row
                  gap={10}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 2,
                    borderBottomWidth: 1,
                    borderBottomColor: c.line(),
                  }}
                >
                  <Text numberOfLines={1} style={[t.label, { width: 120 }]}>
                    集群
                  </Text>
                  <Text numberOfLines={1} style={[t.label, { flex: 1, minWidth: 0 }]}>
                    Broker
                  </Text>
                  <Text numberOfLines={1} style={[t.label, { width: 180 }]}>
                    地址
                  </Text>
                  <Text numberOfLines={1} style={[t.label, { width: 76 }]}>
                    角色
                  </Text>
                  <Text numberOfLines={1} style={[t.label, { width: 110 }]}>
                    版本
                  </Text>
                  <Text numberOfLines={1} style={[t.label, { width: 180 }]}>
                    磁盘使用率
                  </Text>
                </Row>
                {nodes().map((node) => (
                  <Row
                    gap={10}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 2,
                      borderBottomWidth: 1,
                      borderBottomColor: c.line(),
                    }}
                  >
                    <Text numberOfLines={1} style={[t.meta, { width: 120 }]}>
                      {node.cluster}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[{ flex: 1, minWidth: 0, fontSize: 13, color: c.text() }]}
                    >
                      {node.name.length > 0 ? node.name : "<未命名>"}
                    </Text>
                    <Text numberOfLines={1} style={[t.mono, { width: 180 }]}>
                      {node.address}
                    </Text>
                    <View style={{ width: 76 }}>
                      <Badge
                        text={node.role === "master" ? "Master" : "Slave"}
                        tone={node.role === "master" ? "ok" : "info"}
                      />
                    </View>
                    <Text numberOfLines={1} style={[t.mono, { width: 110 }]}>
                      {node.version.length > 0 ? node.version : "未知"}
                    </Text>
                    <View
                      style={{
                        width: 180,
                        display: "flex",
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      {node.diskRatio === null ? null : (
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Meter
                            ratio={node.diskRatio}
                            tone={node.diskRatio > 0.9 ? "danger" : node.diskRatio > 0.75 ? "warn" : undefined}
                          />
                        </View>
                      )}
                      {node.diskRatio === null ? (
                        <Text style={t.meta}>未上报</Text>
                      ) : (
                        <Text
                          numberOfLines={1}
                          style={[t.mono, { width: 56, textAlign: "right" }]}
                        >
                          {node.diskText}
                        </Text>
                      )}
                    </View>
                  </Row>
                ))}
              </View>
            )}
          </Card>
        </Stack>
      )}
    </View>
  );
}

mount(Overview);
