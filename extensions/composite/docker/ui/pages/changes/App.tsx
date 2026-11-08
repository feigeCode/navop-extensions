// Docker 容器文件变更页。
//
// 宿主已经删掉「原生资源工作台」，页面拿不到 selection 里的容器 id 了：
// 进页面先用 `docker/container/list` 拉容器列表，顶部搜索/列表选一个容器，
// 再用 `docker/container/diff` 读它的可写层变更。没选中容器时只给引导空态。
//
// provider 返回 `{ id, changes: [{ Path, Kind }] }`。bollard 的 ChangeType 经
// serde 序列化成数字：0 = Modified / 1 = Added / 2 = Deleted；旧 gpui-shell 页
// 拿到的则是 `kind: "A" | "C" | "D"`。这里两种形状都兼容。
import { Scroll, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
import { arr, errorMessage, isContainerStoppedError, str } from "../../lib/format";
import { invoke, SLOW_TIMEOUT_MS } from "../../lib/navop";
import { Badge, Button, Empty, LoadError, Loading, Notice, Row, SearchField } from "../../lib/ui";
import { c, hairline, r, t } from "../../lib/theme";

type ChangeKind = "A" | "C" | "D";
type Change = Record<string, unknown>;
type ContainerRow = Record<string, unknown>;

const KIND_LABEL: Record<ChangeKind, string> = { A: "新增", C: "修改", D: "删除" };
const KIND_LONG: Record<ChangeKind, string> = {
  A: "新增（Added）",
  C: "修改（Modified）",
  D: "删除（Deleted）",
};

/** 变色标记：新增绿、修改黄、删除红。 */
function kindColor(kind: ChangeKind): string {
  if (kind === "A") return c.chart(1);
  if (kind === "D") return c.danger();
  return c.chart(4);
}

/** 变更类型归一化：数字枚举、单字母、英文长名都能认。 */
function kindOf(change: Change): ChangeKind {
  const raw = change.Kind ?? change.kind;
  if (typeof raw === "number") {
    if (raw === 1) return "A";
    if (raw === 2) return "D";
    return "C";
  }
  const text = String(raw ?? "").trim().toUpperCase();
  if (text === "A" || text.startsWith("ADD")) return "A";
  if (text === "D" || text.startsWith("DEL") || text.startsWith("REM")) return "D";
  if (text === "C" || text.startsWith("MOD") || text.startsWith("CHA")) return "C";
  return "C";
}

function pathOf(change: Change): string {
  const value = change.Path ?? change.path;
  return typeof value === "string" && value.length > 0 ? value : str(change, "Path", "-");
}

/** `/usr/lib/x.so` → 末段 + 目录，长路径靠 numberOfLines 省略。 */
function splitPath(path: string): { name: string; dir: string } {
  const trimmed = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  const index = trimmed.lastIndexOf("/");
  if (index < 0) return { name: trimmed, dir: "" };
  const name = trimmed.slice(index + 1);
  const dir = trimmed.slice(0, index);
  return { name: name.length > 0 ? name : "/", dir: dir.length > 0 ? dir : "/" };
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

export default function Changes(props: { containerId?: string } = {}) {
  const changes = signal<Change[]>([]);
  const loading = signal(true);
  const error = signal<string | null>(null);
  const busy = signal(false);
  const selected = signal<number | null>(null);

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

  function countOf(kind: ChangeKind): number {
    return changes().filter((change) => kindOf(change) === kind).length;
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
    changes.set([]);
    selected.set(null);
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
    if (changes().length === 0) loading.set(true);
    try {
      const result = await invoke<unknown>("docker/container/diff", { id }, { timeout: SLOW_TIMEOUT_MS });
      if (mine !== seq) return;
      const list = Array.isArray(result) ? (result as Change[]) : (arr(result, "changes") as Change[]);
      changes.set(list);
      error.set(null);
      if (selected() !== null && selected()! >= list.length) selected.set(null);
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

  function selectedChange(): { change: Change; kind: ChangeKind } | null {
    const index = selected();
    if (index === null) return null;
    const change = changes()[index];
    if (change === undefined) return null;
    return { change, kind: kindOf(change) };
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

  // ---- 变更列表 -----------------------------------------------------

  function changeRow(change: Change, index: number): JSX.Element {
    const kind = kindOf(change);
    const path = pathOf(change);
    const parts = splitPath(path);
    const color = kindColor(kind);
    return (
      <View
        onPress={() => selected.set(selected() === index ? null : index)}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 12,
          paddingVertical: 7,
          backgroundColor: selected() === index ? c.hover() : "transparent",
          borderBottomWidth: 1,
          borderBottomColor: c.line(),
        }}
      >
        <View
          style={{
            width: 20,
            height: 20,
            flexShrink: 0,
            borderRadius: r.chip,
            borderWidth: 1,
            borderColor: color,
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 11, fontWeight: "600", color }}>{kind}</Text>
        </View>
        <View style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={t.mono}>
            {parts.name}
          </Text>
          {parts.dir.length === 0 ? null : (
            <Text numberOfLines={1} style={{ fontSize: 11, color: c.muted() }}>
              {parts.dir}
            </Text>
          )}
        </View>
        <Text style={{ ...t.meta, width: 36, textAlign: "right", flexShrink: 0 }}>{KIND_LABEL[kind]}</Text>
      </View>
    );
  }

  function detailBar(): JSX.Element {
    const picked = selectedChange();
    if (picked === null) {
      return (
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
            点击任意一行查看完整路径；docker diff 只比较容器可写层。
          </Text>
        </View>
      );
    }
    return (
      <View
        style={{
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderTopWidth: 1,
          borderTopColor: c.line(),
          backgroundColor: c.panel(),
          display: "flex",
          flexDirection: "column",
          gap: 4,
          flexShrink: 0,
        }}
      >
        <Row gap={8} style={{ justifyContent: "space-between" }}>
          <Text style={t.label}>完整路径</Text>
          <Text style={{ ...t.meta, color: kindColor(picked.kind) }}>{KIND_LONG[picked.kind]}</Text>
        </Row>
        <Text numberOfLines={3} style={t.mono}>
          {pathOf(picked.change)}
        </Text>
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
        hint={`连接里有 ${containers().length} 个容器：在上方列表里点一个，页面会读取它的文件变更。`}
      />
    );
  }

  function body(): JSX.Element {
    if (selectedId() === null) return selectionGate();
    if (loading() && changes().length === 0) {
      return <Loading label="正在读取容器文件变更…" />;
    }
    if (error() !== null && changes().length === 0) {
      // 容器停止时 docker diff 同样被 409 拒绝，按业务状态解释。
      if (isContainerStoppedError(error() ?? "")) {
        return (
          <Empty
            title="容器不在运行中"
            hint="文件变更对比的是容器可写层（docker diff），容器停止或暂停时不可用。启动容器后再刷新就行。"
            action={<Button label="重试" small onPress={() => void load()} />}
          />
        );
      }
      return <LoadError message={error() ?? ""} onRetry={() => void load()} />;
    }
    if (changes().length === 0) {
      return (
        <Empty
          title="可写层没有文件变更"
          hint="容器启动后没有新增、修改或删除文件；docker diff 只比较容器可写层，不包含镜像层。"
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
            {changes().map((change, index) => changeRow(change, index))}
          </View>
        </Scroll>
        {detailBar()}
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
          <Text style={t.h1}>文件变更</Text>
          {selectedId() === null ? (
            <Text style={t.meta}>未选择容器</Text>
          ) : (
            <>
              <Text style={t.meta}>{`${changes().length} 项`}</Text>
              <Badge text={`新增 ${countOf("A")}`} tone="ok" />
              <Badge text={`修改 ${countOf("C")}`} tone="warn" />
              <Badge text={`删除 ${countOf("D")}`} tone="danger" />
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
