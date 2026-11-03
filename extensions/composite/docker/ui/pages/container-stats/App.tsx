// Docker 容器资源占用页。
//
// 宿主已经删掉「原生资源工作台」，页面拿不到 selection 里的容器 id 了：
// 进页面先用 `docker/container/list` 拉容器列表，顶部搜索/列表选一个容器，
// 再用 `docker/container/stats` 采一次样。没选中容器时只给引导空态。
//
// provider 返回 `{ id, cpu_percent, memory_usage_bytes, memory_limit_bytes, online_cpus }`。
// 网络收发与块 IO 目前不在返回结构里（summarize_stats 没取 networks /
// blkio_stats），页面如实留出位置并标注「宿主未提供」，不伪造数据。
// 自动刷新只对选中的容器生效，切走/取消选中后不再采样。
import { mount, Scroll, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
import { arr, errorMessage, humanBytes, percent, ratio, str } from "../../lib/format";
import { call } from "../../lib/host";
import { Badge, Button, Card, Empty, LoadError, Loading, Meter, Notice, Row, SearchField, Stat } from "../../lib/ui";
import { c, hairline, r, t } from "../../lib/theme";

type Sample = Record<string, unknown>;
type ContainerRow = Record<string, unknown>;

function numberField(source: Sample | null, key: string): number | null {
  if (source === null) return null;
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clockText(date: Date): string {
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}

// ---- 容器列表 -------------------------------------------------------

const containerId = (row: ContainerRow): string => str(row, "id", "");
const containerName = (row: ContainerRow): string => str(row, "name", "");
const containerImage = (row: ContainerRow): string => str(row, "image", "");
const containerState = (row: ContainerRow): string => str(row, "state", "");

function stateTone(state: string): "ok" | "warn" | "danger" | "neutral" {
  if (state === "running") return "ok";
  if (state === "paused" || state === "restarting") return "warn";
  if (state === "exited" || state === "dead") return "danger";
  return "neutral";
}

const AUTO_REFRESH_MS = 2000;

export default function ContainerStats() {
  const sample = signal<Sample | null>(null);
  const sampledAt = signal("-");
  const loading = signal(true);
  const error = signal<string | null>(null);
  const busy = signal(false);
  const autoRefresh = signal(false);

  const containers = signal<ContainerRow[]>([]);
  const containerQuery = signal("");
  const containersLoading = signal(true);
  const containersError = signal<string | null>(null);
  const selectedId = signal<string | null>(null);
  const selectedName = signal("");
  const pickerOpen = signal(true);

  // last-wins：切容器时旧请求的响应直接丢弃。
  let seq = 0;
  let timer: number | null = null;

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

  function visibleContainers(): ContainerRow[] {
    const needle = containerQuery().trim().toLowerCase();
    if (needle.length === 0) return containers();
    return containers().filter((row) =>
      `${containerName(row)} ${containerImage(row)}`.toLowerCase().includes(needle),
    );
  }

  function selectedSummary(): string {
    const id = selectedId();
    if (id === null) return "";
    const row = containers().find((item) => containerId(item) === id);
    return row === undefined ? selectedName() : `${containerName(row)} · ${containerImage(row)}`;
  }

  function resetData() {
    sample.set(null);
    sampledAt.set("-");
    error.set(null);
  }

  function stopTimer() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function setAutoRefresh(on: boolean) {
    autoRefresh.set(on);
    stopTimer();
    if (on) {
      timer = setInterval(() => {
        if (selectedId() !== null) void load();
      }, AUTO_REFRESH_MS);
    }
  }

  function clearSelection() {
    selectedId.set(null);
    selectedName.set("");
    resetData();
    loading.set(false);
    pickerOpen.set(true);
  }

  function selectContainer(row: ContainerRow) {
    const id = containerId(row);
    if (id.length === 0) return;
    if (selectedId() === id) {
      pickerOpen.set(false);
      return;
    }
    selectedId.set(id);
    selectedName.set(containerName(row));
    pickerOpen.set(false);
    resetData();
    loading.set(true);
    void load();
  }

  function refresh() {
    if (selectedId() === null) void loadContainers();
    else void load();
  }

  async function loadContainers() {
    containersLoading.set(true);
    try {
      const result = await call<{ containers?: ContainerRow[] } | ContainerRow[]>("docker/container/list", {});
      const list = Array.isArray(result) ? (result as ContainerRow[]) : (arr(result, "containers") as ContainerRow[]);
      containers.set(list);
      containersError.set(null);
      const current = selectedId();
      if (current !== null && !list.some((row) => containerId(row) === current)) clearSelection();
    } catch (failure) {
      containersError.set(errorMessage(failure));
    } finally {
      containersLoading.set(false);
    }
  }

  async function load() {
    const id = selectedId();
    if (id === null) return;
    if (busy()) return;
    const mine = ++seq;
    busy.set(true);
    if (sample() === null) loading.set(true);
    try {
      const result = await call<Sample | null>("docker/container/stats", { id });
      if (mine !== seq) return;
      sample.set(result ?? null);
      sampledAt.set(clockText(new Date()));
      error.set(null);
    } catch (failure) {
      if (mine !== seq) return;
      error.set(errorMessage(failure));
    } finally {
      if (mine === seq) {
        loading.set(false);
        busy.set(false);
      }
    }
  }

  // ---- 容器选择区 ---------------------------------------------------

  function pickerList(): JSX.Element | null {
    if (!pickerOpen()) return null;
    return (
      <View
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          marginHorizontal: 14,
          marginBottom: 8,
          padding: 6,
          borderWidth: 1,
          borderColor: c.line(),
          borderRadius: r.card,
          backgroundColor: c.panel(),
        }}
      >
        {containersLoading() && containers().length === 0 ? (
          <Text style={t.meta}>正在读取容器列表…</Text>
        ) : containersError() !== null && containers().length === 0 ? (
          <Row gap={8}>
            <Text style={{ ...t.meta, color: c.danger() }}>{`容器列表读取失败：${containersError()}`}</Text>
            <Button label="重试" small onPress={() => void loadContainers()} />
          </Row>
        ) : visibleContainers().length === 0 ? (
          <Text style={t.meta}>
            {containers().length === 0 ? "这个连接里没有容器。" : "没有匹配的容器，换个关键词试试。"}
          </Text>
        ) : (
          <Scroll style={{ maxHeight: 168 }}>
            <View style={{ display: "flex", flexDirection: "column" }}>
              {visibleContainers().map((row) => containerOption(row))}
            </View>
          </Scroll>
        )}
      </View>
    );
  }

  function containerOption(row: ContainerRow): JSX.Element {
    const id = containerId(row);
    const state = containerState(row);
    return (
      <View
        onPress={() => selectContainer(row)}
        role="button"
        accessibilityLabel={`容器 ${containerName(row)}`}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 8,
          paddingVertical: 6,
          borderRadius: r.control,
          backgroundColor: selectedId() === id ? c.hover() : "transparent",
        }}
      >
        <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "500", color: c.text(), width: 180 }}>
          {containerName(row)}
        </Text>
        <Text numberOfLines={1} style={{ ...t.mono, fontSize: 11, color: c.muted(), flex: 1, minWidth: 0 }}>
          {containerImage(row)}
        </Text>
        <Badge text={state.length === 0 ? "unknown" : state} tone={stateTone(state)} />
      </View>
    );
  }

  function pickerToggle(): JSX.Element {
    return (
      <Button
        label={pickerOpen() ? "收起列表" : selectedId() === null ? "选择容器" : "切换容器"}
        small
        onPress={() => pickerOpen.set(!pickerOpen())}
      />
    );
  }

  function autoRefreshToggle(): JSX.Element {
    return (
      <Button
        label={autoRefresh() ? `自动刷新 · ${AUTO_REFRESH_MS / 1000}s` : "自动刷新"}
        small
        tone={autoRefresh() ? "primary" : "ghost"}
        onPress={() => setAutoRefresh(!autoRefresh())}
      />
    );
  }

  function containerBar(): JSX.Element {
    return (
      <View style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <Row wrap gap={8} style={{ paddingHorizontal: 14, paddingBottom: pickerOpen() ? 6 : 10 }}>
          <SearchField
            value={containerQuery()}
            onChange={(text) => {
              containerQuery.set(text);
              if (!pickerOpen()) pickerOpen.set(true);
            }}
            placeholder="按名称 / 镜像过滤容器"
            width={280}
          />
          <Text style={t.meta}>{`${visibleContainers().length} / ${containers().length} 个容器`}</Text>
          {selectedId() === null ? (
            <Text style={t.meta}>未选择容器</Text>
          ) : (
            <Text numberOfLines={1} style={{ ...t.meta, color: c.text(), maxWidth: 360 }}>
              {selectedSummary()}
            </Text>
          )}
          <View style={{ flex: 1 }} />
          <Button label="刷新列表" small onPress={() => void loadContainers()} />
          {pickerToggle()}
        </Row>
        {pickerList()}
      </View>
    );
  }

  function selectionGate(): JSX.Element {
    if (containersError() !== null && containers().length === 0) {
      return <LoadError message={containersError() ?? ""} onRetry={() => void loadContainers()} />;
    }
    if (containersLoading() && containers().length === 0) {
      return <Loading label="正在读取容器列表…" />;
    }
    if (containers().length === 0) {
      return (
        <Empty
          title="这个连接里没有容器"
          hint="docker/container/list 返回了空列表（包含已停止的容器）：先在 Docker 里创建或启动一个容器。"
          action={<Button label="重新读取容器列表" small onPress={() => void loadContainers()} />}
        />
      );
    }
    return (
      <Empty
        title="先选择一个容器"
        hint={`连接里有 ${containers().length} 个容器：在上方列表里点一个，页面会采样它的资源占用。`}
      />
    );
  }

  function content(): JSX.Element {
    if (selectedId() === null) return selectionGate();
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
              {autoRefresh()
                ? `采样时间取本次请求返回时的本地时间；自动刷新每 ${AUTO_REFRESH_MS / 1000} 秒采样一次。`
                : "采样时间取本次请求返回时的本地时间；默认只手动刷新，可以打开自动刷新。"}
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

  function toolbar(): JSX.Element {
    return (
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
          {selectedId() === null ? (
            <Text style={t.meta}>未选择容器</Text>
          ) : (
            <>
              <Badge text={`采样 ${sampledAt()}`} tone="info" />
              <Text style={t.meta}>{cores() === null ? "" : `${cores()} 个核`}</Text>
            </>
          )}
        </Row>
        <Row gap={6}>
          {busy() ? <Text style={t.meta}>正在采样…</Text> : null}
          {selectedId() === null ? null : autoRefreshToggle()}
          <Button label="刷新" small onPress={() => refresh()} />
        </Row>
      </Row>
    );
  }

  void loadContainers();

  return (
    <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", backgroundColor: c.bg() }}>
      {toolbar()}
      <View style={hairline()} />
      {containerBar()}
      {content()}
    </View>
  );
}

mount(ContainerStats);
