// Docker 容器挂载页。
//
// 宿主已经删掉「原生资源工作台」，页面拿不到 selection 里的容器 id 了：
// 进页面先用 `docker/container/list` 拉容器列表，顶部搜索/列表选一个容器，
// 再用 `docker/container/mounts` 读它的挂载。没选中容器时只给引导空态。
//
// provider 返回 `{ id, mounts: [{ Type, Name, Source, Destination, Mode, RW, Driver, Propagation }] }`。
// 字段是 bollard 的 PascalCase；`RW === false`（或 Mode 以 ro 开头）即只读。
// 挂载数量通常很少，路径不截断，直接换行显示完整值。
import { Scroll, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
import { arr, errorMessage, str } from "../../lib/format";
import { invoke, SLOW_TIMEOUT_MS } from "../../lib/navop";
import { Badge, Button, Empty, LoadError, Loading, Notice, Row, SearchField } from "../../lib/ui";
import { c, hairline, r, t } from "../../lib/theme";

type MountPoint = Record<string, unknown>;
type ContainerRow = Record<string, unknown>;
type Tone = "neutral" | "ok" | "warn" | "danger" | "info";

/** 挂载类型 → 胶囊配色；未知类型保持中性。 */
function typeTone(type: string): Tone {
  const text = type.toLowerCase();
  if (text === "bind") return "info";
  if (text === "volume") return "ok";
  if (text === "tmpfs") return "warn";
  return "neutral";
}

function typeOf(entry: MountPoint): string {
  const type = str(entry, "Type", "").toLowerCase();
  return type.length > 0 ? type : "bind";
}

function modeOf(entry: MountPoint): string {
  return str(entry, "Mode", "默认");
}

function isReadOnly(entry: MountPoint): boolean {
  if (entry.RW === false) return true;
  return /^ro\b/.test(str(entry, "Mode", ""));
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

export default function ContainerMounts(props: { containerId?: string } = {}) {
  const mounts = signal<MountPoint[]>([]);
  const loading = signal(true);
  const error = signal<string | null>(null);
  const busy = signal(false);

  const containers = signal<ContainerRow[]>([]);
  const containerQuery = signal("");
  const containersLoading = signal(true);
  const containersError = signal<string | null>(null);
  /** 从容器页的「单容器」标签进来时预设容器：页面不再要求先自己挑一个。 */
  const presetId = typeof props.containerId === "string" && props.containerId.length > 0 ? props.containerId : null;
  const selectedId = signal<string | null>(presetId);
  const selectedName = signal("");
  /** 预设了容器就收起挑选列表，只留一条状态条。 */
  const pickerOpen = signal(presetId === null);

  // last-wins：切容器时旧请求的响应直接丢弃。
  let seq = 0;

  function readOnlyCount(): number {
    return mounts().filter((entry) => isReadOnly(entry)).length;
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
    mounts.set([]);
    error.set(null);
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
      const result = await invoke<{ containers?: ContainerRow[] } | ContainerRow[]>("docker/container/list", {}, { timeout: SLOW_TIMEOUT_MS });
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
    const mine = ++seq;
    busy.set(true);
    if (mounts().length === 0) loading.set(true);
    try {
      const result = await invoke<unknown>("docker/container/mounts", { id }, { timeout: SLOW_TIMEOUT_MS });
      if (mine !== seq) return;
      const list = Array.isArray(result) ? (result as MountPoint[]) : (arr(result, "mounts") as MountPoint[]);
      mounts.set(list);
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

  // ---- 挂载列表 -----------------------------------------------------

  function mountRow(entry: MountPoint): JSX.Element {
    const type = typeOf(entry);
    const readOnly = isReadOnly(entry);
    const name = str(entry, "Name", "");
    return (
      <View
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 5,
          paddingHorizontal: 12,
          paddingVertical: 9,
          borderBottomWidth: 1,
          borderBottomColor: c.line(),
        }}
      >
        <Row gap={8}>
          <Badge text={type} tone={typeTone(type)} />
          {readOnly ? <Badge text="只读" tone="warn" /> : <Badge text="可写" tone="neutral" />}
          <Text numberOfLines={1} style={t.meta}>{`模式 ${modeOf(entry)}`}</Text>
          <Text numberOfLines={1} style={{ ...t.meta, flex: 1, minWidth: 0, textAlign: "right" }}>
            {name.length > 0 ? `名称 ${name}` : ""}
          </Text>
        </Row>
        <Row gap={6} align="flex-start">
          <Text style={{ ...t.label, width: 26, flexShrink: 0 }}>源</Text>
          <Text style={{ ...t.mono, flex: 1, minWidth: 0 }}>{str(entry, "Source", "-")}</Text>
        </Row>
        <Row gap={6} align="flex-start">
          <Text style={{ ...t.label, width: 26, flexShrink: 0 }}>目标</Text>
          <Text style={{ ...t.mono, flex: 1, minWidth: 0 }}>{str(entry, "Destination", "-")}</Text>
        </Row>
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
        hint={`连接里有 ${containers().length} 个容器：在上方列表里点一个，页面会读取它的挂载。`}
      />
    );
  }

  function body(): JSX.Element {
    if (selectedId() === null) return selectionGate();
    if (loading() && mounts().length === 0) {
      return <Loading label="正在读取容器挂载…" />;
    }
    if (error() !== null && mounts().length === 0) {
      return <LoadError message={error() ?? ""} onRetry={() => void load()} />;
    }
    if (mounts().length === 0) {
      return (
        <Empty
          title="容器没有挂载"
          hint="容器启动时没有声明 bind / volume / tmpfs 挂载，因此没有宿主机路径映射进来。"
          action={<Button label="重新读取" small onPress={() => void load()} />}
        />
      );
    }
    return (
      <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {error() === null ? null : (
          <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
            <Notice message={`刷新失败：${error() ?? ""}`} />
          </View>
        )}
        <Scroll style={{ flex: 1, minHeight: 0 }}>
          <View style={{ display: "flex", flexDirection: "column" }}>
            {mounts().map((entry) => mountRow(entry))}
          </View>
        </Scroll>
        <View
          style={{
            paddingHorizontal: 12,
            paddingVertical: 7,
            borderTopWidth: 1,
            borderTopColor: c.line(),
            backgroundColor: c.panel(),
            flexShrink: 0,
          }}
        >
          <Text numberOfLines={1} style={t.meta}>
            数据来自容器 Mounts 字段；RW=false 或 Mode 以 ro 开头的挂载按只读显示。
          </Text>
        </View>
      </View>
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
          <Text style={t.h1}>挂载</Text>
          {selectedId() === null ? (
            <Text style={t.meta}>未选择容器</Text>
          ) : (
            <>
              <Text style={t.meta}>{`${mounts().length} 个挂载`}</Text>
              <Badge text={`只读 ${readOnlyCount()}`} tone="warn" />
            </>
          )}
        </Row>
        <Row gap={6}>
          {busy() ? <Text style={t.meta}>正在读取…</Text> : null}
          <Button label="刷新" small onPress={() => refresh()} />
        </Row>
      </Row>
    );
  }

  void loadContainers();
  // 预设了容器就直接取数：这条路径没有用户点击，只能在这里主动触发一次。
  if (presetId !== null) void load();

  return (
    <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", backgroundColor: c.bg() }}>
      {toolbar()}
      <View style={hairline()} />
      {presetId === null ? containerBar() : null}
      {body()}
    </View>
  );
}
