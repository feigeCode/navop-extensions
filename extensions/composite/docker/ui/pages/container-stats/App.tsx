// Docker 容器资源占用页：从容器工作台的「资源」shell 视图嵌入。
// 容器由宿主按 route 选中，页面不传容器 id；数据只走 dispatch。
//
// 主数据源 `containerStats`（provider 的 docker/container/stats）是一次性采样，
// 只返回 `{ id, cpu_percent, memory_usage_bytes, memory_limit_bytes, online_cpus }`。
// 网络收发与块 IO 目前不在返回结构里（provider 的 summarize_stats 没取
// networks / blkio_stats），页面如实留出位置并标注“宿主未提供”，不伪造数据。
import { host, mount, Scroll, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
import { errorMessage, humanBytes, percent, ratio } from "../../lib/format";
import { Badge, Button, Card, Empty, LoadError, Loading, Meter, Notice, Row, Stat } from "../../lib/ui";
import { c, hairline, t } from "../../lib/theme";

type Sample = Record<string, unknown>;

function numberField(source: Sample | null, key: string): number | null {
  if (source === null) return null;
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clockText(date: Date): string {
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}

/** 调一次工作台操作；把 provider 的失败折成一句人话。 */
async function dispatch(operationId: string, input?: unknown): Promise<unknown> {
  try {
    return await host.call("navop.workbench.dispatch", { operationId, input: input ?? {} });
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}

export default function ContainerStats() {
  const sample = signal<Sample | null>(null);
  const sampledAt = signal("-");
  const loading = signal(true);
  const error = signal<string | null>(null);
  const busy = signal(false);

  const cpu = () => numberField(sample(), "cpu_percent");
  const cores = () => numberField(sample(), "online_cpus");
  const usage = () => numberField(sample(), "memory_usage_bytes");
  const limit = () => numberField(sample(), "memory_limit_bytes");

  function hasSample(): boolean {
    return sample() !== null && (cpu() !== null || usage() !== null);
  }

  function cpuText(): string {
    const value = cpu();
    return value === null ? "-" : `${value.toFixed(1)}%`;
  }

  function coresHint(): string {
    const value = cores();
    if (value === null) return "核数未知";
    return `${value} 个核 · 100% ≈ 1 核满载`;
  }

  function memoryCaption(): string {
    return `${humanBytes(usage())} / ${humanBytes(limit())}`;
  }

  function memoryLeft(): string {
    const used = usage();
    const total = limit();
    if (used === null || total === null) return "-";
    return humanBytes(Math.max(0, total - used));
  }

  async function load() {
    if (busy()) return;
    busy.set(true);
    if (sample() === null) loading.set(true);
    try {
      const result = await dispatch("containerStats");
      const next = (result as Sample | null) ?? null;
      sample.set(next);
      sampledAt.set(clockText(new Date()));
      error.set(null);
    } catch (failure) {
      error.set(errorMessage(failure));
    } finally {
      loading.set(false);
      busy.set(false);
    }
  }

  function content(): JSX.Element {
    if (loading() && sample() === null) {
      return <Loading label="正在采样容器资源占用…" />;
    }
    if (error() !== null && sample() === null) {
      return <LoadError message={error() ?? ""} onRetry={() => void load()} />;
    }
    if (!hasSample()) {
      return (
        <Empty
          title="没有可用的采样"
          hint="containerStats 没有返回 CPU / 内存数据：容器可能已经停止，或这次一次性采样失败。刷新会重新取一次。"
          action={<Button label="重新采样" small onPress={() => void load()} />}
        />
      );
    }
    return (
      <Scroll style={{ flex: 1, minHeight: 0 }}>
        <View style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          {error() === null ? null : <Notice message={`刷新失败：${error() ?? ""}`} />}
          <Row gap={12} wrap>
            <Stat label="CPU 使用率" value={cpuText()} hint={coresHint()} />
            <Stat label="内存用量" value={humanBytes(usage())} hint={`上限 ${humanBytes(limit())}`} />
            <Stat
              label="内存使用率"
              value={percent(usage(), limit())}
              hint={`剩余 ${memoryLeft()}`}
              tone={ratio(usage(), limit()) > 0.9 ? "danger" : "neutral"}
            />
          </Row>

          <Card title="内存" hint="用量 / 上限">
            <Meter ratio={ratio(usage(), limit())} label="内存占用" caption={memoryCaption()} />
            <Row style={{ justifyContent: "space-between" }}>
              <Text style={t.label}>采样时间</Text>
              <Text style={{ ...t.mono, color: c.muted() }}>{sampledAt()}</Text>
            </Row>
            <Text style={t.meta}>
              采样时间取本次请求返回时的本地时间；页面不会自动轮询，需要手动刷新。
            </Text>
          </Card>

          <Card title="网络收发" hint="宿主未提供">
            <Row gap={12} wrap>
              <Stat label="收到" value="—" hint="containerStats 未返回网络字段" />
              <Stat label="发出" value="—" hint="containerStats 未返回网络字段" />
            </Row>
            <Text style={t.meta}>
              provider 的 summarize_stats 只汇总 CPU 与内存，Docker 的 networks（rx / tx 字节与包数）没有被解析。
            </Text>
          </Card>

          <Card title="块 IO" hint="宿主未提供">
            <Row gap={12} wrap>
              <Stat label="读取" value="—" hint="containerStats 未返回块 IO 字段" />
              <Stat label="写入" value="—" hint="containerStats 未返回块 IO 字段" />
            </Row>
            <Text style={t.meta}>
              同样，blkio_stats（read / write 字节数）不在 operation 的返回结构里；补上后这两组指标可以直接填进来。
            </Text>
          </Card>
        </View>
      </Scroll>
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
          <Text style={t.h1}>资源占用</Text>
          <Badge text={`采样 ${sampledAt()}`} tone="info" />
          <Text style={t.meta}>{cores() === null ? "" : `${cores()} 个核`}</Text>
        </Row>
        <Row gap={6}>
          {busy() ? <Text style={t.meta}>正在采样…</Text> : null}
          <Button label="刷新" small onPress={() => void load()} />
        </Row>
      </Row>
      <View style={hairline()} />
      {content()}
    </View>
  );
}

mount(ContainerStats);
