// 数据全走 `navop.resource.invoke`：句柄由宿主写在 `host.params.connection` 里，
// 页面自己决定调哪个 provider 方法。
import { cleanup, signal, Text, View } from "nsh";
import type { JSX, ViewStyle } from "nsh";
import { invoke, SLOW_TIMEOUT_MS } from "../../lib/navop";
import { arr, errorMessage, str } from "../../lib/format";
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
  Stack,
  Stat,
} from "../../lib/ui";
import { c, t } from "../../lib/theme";

/** 采样间隔：provider 只给累计值，速率只能靠两次采样的差值算。 */
const REFRESH_MS = 2000;
/** 速率历史保留多少个采样点（条形图的列数）。 */
const RATE_SAMPLES = 14;

type Metrics = Record<string, unknown>;
type Client = Record<string, unknown>;
type Sample = { at: number; received: number; sent: number };
type Rate = { inbound: number; outbound: number };
type Direction = "in" | "out";

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

/** `middleware/group/clients` 的 `group` 是标准契约里的必填入参，但 MQTT 没有
 * 订阅组这个概念（能力位 `groups=false`、`clients=true`）：provider 里的
 * `group_clients(_group)` 忽略该值、返回本地连接自身。这里必须显式给一个非空值，
 * 否则 provider 会以 -32602 拒绝（重写前的工作台声明里同样是写死 `"local"`）。 */
const LOCAL_GROUP = "local";

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

function last<T>(items: T[]): T | undefined {
  return items.length === 0 ? undefined : items[items.length - 1];
}

function numberField(source: unknown, key: string): number {
  if (!source || typeof source !== "object") return 0;
  const value = Number((source as Record<string, unknown>)[key]);
  return Number.isFinite(value) ? value : 0;
}

/** provider 的 `extras` 是 `[键, 值]` 字符串对；缺键按 0。 */
function extra(metrics: Metrics, key: string): number {
  for (const pair of arr(metrics, "extras")) {
    if (Array.isArray(pair) && String(pair[0]) === key) {
      const value = Number(pair[1]);
      return Number.isFinite(value) ? value : 0;
    }
  }
  return 0;
}

/** 千分位；nsh 不保证 Intl，自己按三位分组。 */
function count(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function duration(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/** 本地时间 HH:MM:SS：不依赖 Intl，避免测试/英文环境下出现 AM/PM。 */
function clockText(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function rateText(value: number | undefined): string {
  return value === undefined ? "—" : `${value.toFixed(1)} /s`;
}

/** 条形刻度数量：用「格子」画条形，格子颜色在 JSX 绑定里读信号，刷新就会跟着变。 */
const BAR_TICKS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
  27, 28, 29, 30, 31,
];

/**
 * 速率条形：`ratio` 与 `caption` 都是访问器。
 *
 * 设计系统里的 `Meter` 在组件体里一次性读 `ratio` 算宽度，挂载后不会再变，
 * 所以这里用格子自己画——每个格子的颜色在 map 的绑定里重新读一次比例。
 */
function RateBar(props: {
  label: string;
  ratio: () => number;
  caption: () => string;
  color: string;
}) {
  return (
    <Row gap={10}>
      <Text style={{ ...t.label, width: 28 }}>{props.label}</Text>
      <View style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "row", gap: 2 }}>
        {BAR_TICKS.map((tick) => (
          <View
            style={{
              flex: 1,
              height: 8,
              borderRadius: 2,
              backgroundColor:
                tick < Math.round(props.ratio() * BAR_TICKS.length) ? props.color : c.hover(),
            }}
          />
        ))}
      </View>
      <Text style={{ ...t.mono, width: 76, textAlign: "right" }}>{props.caption()}</Text>
    </Row>
  );
}

export default function Overview() {
  const metrics = signal<Metrics | null>(null);
  const client = signal<Client | null>(null);
  const loading = signal(true);
  const error = signal<string | null>(null);
  const auto = signal(true);
  const samples = signal<Sample[]>([]);
  const rates = signal<Rate[]>([]);
  const updatedAt = signal("");
  const now = signal(Date.now());
  const startedAt = Date.now();
  let inFlight = false;

  async function load() {
    if (inFlight) return;
    inFlight = true;
    loading.set(true);
    try {
      const [metricsResult, clientsResult] = await Promise.all([
        dispatch("metrics"),
        dispatch("listClients", { group: LOCAL_GROUP }),
      ]);
      const next = ((metricsResult as Record<string, unknown> | null)?.metrics ??
        metricsResult ??
        {}) as Metrics;
      const clients = Array.isArray(clientsResult) ? clientsResult : arr(clientsResult, "clients");
      const head = clients.length > 0 ? clients[0] : null;
      const first = head && typeof head === "object" ? (head as Client) : null;
      const sample: Sample = {
        at: Date.now(),
        received: extra(next, "received_total"),
        sent: extra(next, "sent_total"),
      };
      const previous = last(samples());
      if (previous !== undefined) {
        const seconds = (sample.at - previous.at) / 1000;
        if (seconds > 0) {
          const inbound = Math.max(0, (sample.received - previous.received) / seconds);
          const outbound = Math.max(0, (sample.sent - previous.sent) / seconds);
          rates.set([...rates(), { inbound, outbound }].slice(-RATE_SAMPLES));
        }
      }
      samples.set([...samples(), sample].slice(-RATE_SAMPLES));
      metrics.set(next);
      client.set(first);
      error.set(null);
      updatedAt.set(clockText());
    } catch (failure) {
      error.set(errorMessage(failure));
    } finally {
      loading.set(false);
      inFlight = false;
    }
  }

  void load();
  const timer = setInterval(() => {
    now.set(Date.now());
    if (auto()) void load();
  }, REFRESH_MS);
  // 页面卸载后别再拿已销毁的 signal 做写入。
  cleanup(() => clearInterval(timer));

  // ---- 派生值：一律写成访问器，避免冻结在组件体那次执行上 ----------------

  const m = () => metrics() ?? {};
  const conn = () => client();
  const received = () => extra(m(), "received_total");
  const sent = () => extra(m(), "sent_total");
  const today = () => numberField(m(), "message_count_today");
  const filters = () => arr(conn(), "subscriptions").map(String);
  const connected = () => error() === null;
  const latest = () => last(rates());
  const peak = () => Math.max(1, ...rates().map((rate) => Math.max(rate.inbound, rate.outbound)));
  const rateValue = (direction: Direction): number | undefined => {
    const current = latest();
    if (current === undefined) return undefined;
    return direction === "in" ? current.inbound : current.outbound;
  };
  const ratioOf = (direction: Direction): number => {
    const value = rateValue(direction);
    return value === undefined ? 0 : value / peak();
  };

  const root: ViewStyle = {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: c.bg(),
  };

  /** 数据到手后的正文；只在 `<If>` 的 else 分支里构造一次。 */
  function body(): JSX.Element {
    return (
      <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <Row
          gap={10}
          wrap
          style={{
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderBottomWidth: 1,
            borderBottomColor: c.line(),
            justifyContent: "space-between",
          }}
        >
          <Row gap={10} wrap>
            <Text style={t.h1}>MQTT 连接</Text>
            <If
              when={connected()}
              else={<Badge text="连接中断" tone="danger" />}
            >
              <Badge text="已连接" tone="ok" />
            </If>
            <Row gap={4}>
              <Text style={t.label}>Broker</Text>
              <Text numberOfLines={1} style={t.mono}>
                {str(conn(), "client_addr", "provider 未返回")}
              </Text>
            </Row>
            <Row gap={4}>
              <Text style={t.label}>协议</Text>
              <Text style={t.mono}>{str(conn(), "version", "MQTT 3.1.1")}</Text>
            </Row>
            <Row gap={4}>
              <Text style={t.label}>客户端</Text>
              <Text numberOfLines={1} style={t.mono}>
                {str(conn(), "client_id", "-")}
              </Text>
            </Row>
          </Row>
          <Row gap={6}>
            <Text style={t.meta}>{updatedAt() === "" ? "尚未刷新" : `${updatedAt()} 更新`}</Text>
            <Button
              label={auto() ? "自动刷新：开" : "自动刷新：关"}
              small
              onPress={() => auto.set(!auto())}
            />
            <Button
              label={loading() ? "刷新中…" : "刷新"}
              small
              onPress={() => void load()}
            />
          </Row>
        </Row>

        <If when={error() !== null}>
          <Row gap={8} style={{ paddingHorizontal: 16, paddingTop: 10 }}>
            <Notice message={`刷新失败：${error() ?? ""}`} tone="danger" />
            <Button label="重试" small onPress={() => void load()} />
          </Row>
        </If>

        <Stack scroll padding={16} gap={14}>
          <Row gap={12} wrap>
            <Stat
              label="累计接收"
              value={count(received())}
              hint={`今日 ${count(today())} 条`}
              tone="ok"
            />
            <Stat label="累计发送" value={count(sent())} hint="本连接发布的消息" tone="info" />
            <Stat
              label="订阅数"
              value={count(numberField(m(), "topic_count"))}
              hint="当前活跃的订阅过滤器"
            />
            <Stat
              label="连接时长"
              value={duration(now() - startedAt)}
              hint="页面挂载起计时（provider 未暴露建立时间）"
            />
          </Row>

          <Card title="速率快照" hint={`每 ${REFRESH_MS / 1000} 秒采样一次累计计数，取两次差值`}>
            <View style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <RateBar
                label="接收"
                ratio={() => ratioOf("in")}
                caption={() => rateText(rateValue("in"))}
                color={c.chart(1)}
              />
              <RateBar
                label="发送"
                ratio={() => ratioOf("out")}
                caption={() => rateText(rateValue("out"))}
                color={c.chart(0)}
              />
              <View style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <Row gap={12} wrap>
                  <Text style={t.meta}>
                    {latest() === undefined
                      ? "等待第二次采样：首次进页面只有累计值，还没有差值"
                      : `最近 ${rates().length} 次采样，峰值 ${peak().toFixed(1)} /s`}
                  </Text>
                  <Row gap={4}>
                    <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c.chart(1) }} />
                    <Text style={t.meta}>接收</Text>
                    <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: c.chart(0) }} />
                    <Text style={t.meta}>发送</Text>
                  </Row>
                </Row>
                <Row gap={3} align="flex-end" style={{ height: 40 }}>
                  {rates().map((sample) => (
                    <Row gap={1} align="flex-end">
                      <View
                        style={{
                          width: 4,
                          height: Math.max(2, Math.round((sample.inbound / peak()) * 38)),
                          borderRadius: 1,
                          backgroundColor: c.chart(1),
                        }}
                      />
                      <View
                        style={{
                          width: 4,
                          height: Math.max(2, Math.round((sample.outbound / peak()) * 38)),
                          borderRadius: 1,
                          backgroundColor: c.chart(0),
                        }}
                      />
                    </Row>
                  ))}
                </Row>
              </View>
            </View>
          </Card>

          <Card title="连接信息" hint="metrics / listClients 的原样字段">
            <KeyValue
              columns={2}
              rows={[
                ["客户端 ID", str(conn(), "client_id", "-")],
                ["协议版本", str(conn(), "version", "-")],
                ["客户端语言", str(conn(), "language", "-")],
                ["客户端地址", str(conn(), "client_addr", "provider 未返回")],
                ["连接数", count(numberField(m(), "connection_count"))],
                ["订阅过滤器", `${filters().length} 个`],
                ["今日接收", `${count(today())} 条`],
                [
                  "本地缓冲",
                  `${count(extra(m(), "buffered_messages"))} / ${count(extra(m(), "buffer_capacity"))}`,
                ],
                ["累计接收", `${count(received())} 条`],
                ["累计发送", `${count(sent())} 条`],
              ]}
            />
          </Card>

          <Card title={`订阅过滤器（${filters().length}）`} hint="订阅后由 provider 回写，点「刷新」可重取">
            <If
              when={filters().length === 0}
              else={
                <View style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {filters().map((filter) => (
                    <Text numberOfLines={1} style={t.mono}>
                      {filter}
                    </Text>
                  ))}
                </View>
              }
            >
              <View style={{ display: "flex", flexDirection: "column", minHeight: 96 }}>
                <Empty
                  title="没有订阅过滤器"
                  hint="去「订阅」页添加，或在连接配置里把自动订阅设为 #。"
                />
              </View>
            </If>
          </Card>

          <Text style={t.meta}>
            数据来自 MQTT provider 的 middleware/metrics 与 middleware/group/clients；自动刷新只重取这两条，
            关掉后点「刷新」手动取。
          </Text>
        </Stack>
      </View>
    );
  }

  return (
    <View style={root}>
      <If when={metrics() === null} else={body()}>
        <If when={error() !== null} else={<Loading label="正在读取 MQTT 连接指标…" />}>
          <LoadError message={error() ?? ""} onRetry={() => void load()} />
        </If>
      </If>
    </View>
  );
}
