// Docker 容器文件浏览页（类 SFTP 的目录树浏览）。
//
// 从容器页的「文件」标签进来时会带上 containerId，页面直接浏览那台容器的
// 文件系统；没有预设容器时（深链打开）先自己挑一个。
//
// provider 的 `docker/container/files/list` 是在容器里跑 `ls -Ap` + `stat`
// （走 docker exec，所以容器必须是运行中），返回：
//   { id, path: "/etc", entries: [{ name, type: directory|file|unknown,
//                                  size: "12 B", modified: "2026-11-06 10:00", path }] }
// 目录项排在最前，根目录没有 ".." 行（非根目录第一行就是 ".."）。
import { Scroll, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
import { arr, errorMessage, isContainerStoppedError, str } from "../../lib/format";
import { invoke, SLOW_TIMEOUT_MS } from "../../lib/navop";
import { Badge, Button, Empty, IconButton, LoadError, Loading, Notice, Row, SearchField } from "../../lib/ui";
import { c, hairline, r, t } from "../../lib/theme";

type Entry = Record<string, unknown>;
type ContainerRow = Record<string, unknown>;

const entryName = (entry: Entry): string => str(entry, "name", "");
const entryPath = (entry: Entry): string => str(entry, "path", "");
const entryType = (entry: Entry): string => str(entry, "type", "file");
const entrySize = (entry: Entry): string => str(entry, "size", "-");
const entryModified = (entry: Entry): string => str(entry, "modified", "-");
const isDirectory = (entry: Entry): boolean => entryType(entry) === "directory";

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

/** 路径拆成面包屑：`/opt/emqx/data` → ["/", "opt", "emqx", "data"]。 */
function crumbs(path: string): Array<{ label: string; path: string }> {
  if (path === "/" || path.length === 0) return [{ label: "/", path: "/" }];
  const parts = path.split("/").filter((part) => part.length > 0);
  const list: Array<{ label: string; path: string }> = [{ label: "/", path: "/" }];
  let cursor = "";
  for (const part of parts) {
    cursor += `/${part}`;
    list.push({ label: part, path: cursor });
  }
  return list;
}

export default function ContainerFiles(props: { containerId?: string } = {}) {
  const entries = signal<Entry[]>([]);
  const path = signal("/");
  const loading = signal(true);
  const error = signal<string | null>(null);
  const busy = signal(false);

  const containers = signal<ContainerRow[]>([]);
  const containerQuery = signal("");
  const containersLoading = signal(true);
  const containersError = signal<string | null>(null);
  /** 从容器页的「文件」标签进来时预设容器：页面不再要求先自己挑一个。 */
  const presetId = typeof props.containerId === "string" && props.containerId.length > 0 ? props.containerId : null;
  const selectedId = signal<string | null>(presetId);
  const selectedName = signal("");
  const pickerOpen = signal(presetId === null);

  // last-wins：切目录 / 切容器时旧请求的响应直接丢弃。
  let seq = 0;

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

  function directoryCount(): number {
    return entries().filter((entry) => isDirectory(entry) && entryName(entry) !== "..").length;
  }

  function fileCount(): number {
    return entries().filter((entry) => !isDirectory(entry)).length;
  }

  function resetData() {
    entries.set([]);
    path.set("/");
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
    void load("/");
  }

  function refresh() {
    if (selectedId() === null) void loadContainers();
    else void load(path());
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

  async function load(target: string) {
    const id = selectedId();
    if (id === null) return;
    const mine = ++seq;
    busy.set(true);
    if (entries().length === 0) loading.set(true);
    try {
      const result = await invoke<unknown>("docker/container/files/list", { id, path: target }, { timeout: SLOW_TIMEOUT_MS });
      if (mine !== seq) return;
      const list = Array.isArray(result) ? (result as Entry[]) : (arr(result, "entries") as Entry[]);
      const readed = Array.isArray(result) ? target : str(result, "path", target);
      path.set(readed);
      entries.set(list);
      error.set(null);
    } catch (failure) {
      if (mine !== seq) return;
      error.set(errorMessage(failure));
      entries.set([]);
    } finally {
      if (mine === seq) {
        loading.set(false);
        busy.set(false);
      }
    }
  }

  function go(target: string) {
    entries.set([]);
    loading.set(true);
    void load(target);
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

  // ---- 路径栏 -------------------------------------------------------

  function pathBar(): JSX.Element {
    const list = crumbs(path());
    return (
      <Row
        gap={6}
        style={{
          paddingHorizontal: 12,
          paddingVertical: 7,
          borderBottomWidth: 1,
          borderBottomColor: c.line(),
          backgroundColor: c.panel(),
          flexShrink: 0,
        }}
      >
        {list.map((crumb, index) => {
          const last = index === list.length - 1;
          return (
            <View style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
              {index > 1 ? <Text style={{ ...t.meta, color: c.muted() }}>/</Text> : null}
              <View
                role="button"
                accessibilityLabel={`路径 ${crumb.path}`}
                onPress={() => {
                  if (!last) go(crumb.path);
                }}
                style={{ paddingHorizontal: 4, paddingVertical: 2, borderRadius: r.chip }}
              >
                <Text
                  style={{
                    ...t.mono,
                    fontSize: 11.5,
                    color: last ? c.text() : c.muted(),
                    fontWeight: last ? "600" : "400",
                  }}
                >
                  {crumb.label}
                </Text>
              </View>
            </View>
          );
        })}
        <View style={{ flex: 1 }} />
        <Text style={t.meta}>{`${directoryCount()} 个目录 · ${fileCount()} 个文件`}</Text>
        <Button label="上级" small onPress={() => go(parentOf(path()))} disabled={() => path() === "/"} />
        <IconButton
          glyph="↻"
          label="刷新目录"
          disabled={() => busy()}
          onPress={() => void load(path())}
        />
      </Row>
    );
  }

  // ---- 文件列表 -----------------------------------------------------

  function entryRow(entry: Entry): JSX.Element {
    const isDir = isDirectory(entry);
    const name = entryName(entry);
    return (
      <View
        role="button"
        accessibilityLabel={isDir ? `目录 ${name}` : `文件 ${name}`}
        onPress={() => {
          if (isDir) go(entryPath(entry));
        }}
        hoverStyle={{ backgroundColor: c.hover() }}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 12,
          paddingVertical: 7,
          borderBottomWidth: 1,
          borderBottomColor: c.line(),
          cursor: isDir ? "pointer" : "default",
          width: "100%",
        }}
      >
        <Text style={{ ...t.mono, fontSize: 11, color: isDir ? c.accent() : c.muted(), width: 12 }}>
          {name === ".." ? "↑" : isDir ? "▸" : "·"}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 12.5, color: c.text(), flex: 1, minWidth: 0 }}>
          {name}
        </Text>
        <Text style={{ ...t.mono, fontSize: 11, color: c.muted(), width: 84, textAlign: "right", flexShrink: 0 }}>
          {isDir ? "" : entrySize(entry)}
        </Text>
        <Text style={{ ...t.mono, fontSize: 11, color: c.muted(), width: 128, flexShrink: 0 }}>
          {isDir ? "" : entryModified(entry)}
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
        hint={`连接里有 ${containers().length} 个容器：在上方列表里点一个，页面会浏览它的文件系统。`}
      />
    );
  }

  function body(): JSX.Element {
    if (selectedId() === null) return selectionGate();
    if (loading() && entries().length === 0) {
      return <Loading label="正在读取目录…" />;
    }
    if (error() !== null && entries().length === 0) {
      // 容器没在跑时 docker exec 会 409：这不是故障，给一条能看懂的提示。
      if (isContainerStoppedError(error() ?? "")) {
        return (
          <Empty
            title="容器不在运行中"
            hint="浏览容器文件要进容器执行命令（docker exec），容器停止或被暂停时不可用。启动容器后会自动恢复。"
            action={<Button label="重试" small onPress={() => void load(path())} />}
          />
        );
      }
      return <LoadError message={error() ?? ""} onRetry={() => void load(path())} />;
    }
    if (entries().length === 0) {
      return (
        <Empty
          title="空目录"
          hint={`${path()} 里没有任何文件。`}
          action={<Button label="重新读取" small onPress={() => void load(path())} />}
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
          <View style={{ display: "flex", flexDirection: "column" }}>{entries().map((entry) => entryRow(entry))}</View>
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
            在容器内执行 ls -Ap / stat 读取；点目录进入，点面包屑回上级。
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
          <Text style={t.h1}>文件</Text>
          {selectedId() === null ? (
            <Text style={t.meta}>未选择容器</Text>
          ) : (
            <Text numberOfLines={1} style={{ ...t.meta, maxWidth: 420 }}>
              {`${selectedName()} · ${path()}`}
            </Text>
          )}
        </Row>
        <Row gap={6}>
          {busy() ? <Text style={t.meta}>正在读取…</Text> : null}
          <Button label="上级" small onPress={() => go(parentOf(path()))} disabled={() => path() === "/"} />
          <Button label="刷新" small onPress={() => refresh()} />
        </Row>
      </Row>
    );
  }

  void loadContainers();
  // 预设了容器就直接取数：这条路径没有用户点击，只能在这里主动触发一次。
  if (presetId !== null) void load("/");

  return (
    <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", backgroundColor: c.bg() }}>
      {presetId === null ? toolbar() : null}
      <View style={hairline()} />
      {presetId === null ? containerBar() : null}
      {selectedId() === null ? null : pathBar()}
      {body()}
    </View>
  );
}

/** 上一级目录；根目录返回自身。 */
function parentOf(path: string): string {
  if (path === "/" || path.length === 0) return "/";
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const at = trimmed.lastIndexOf("/");
  if (at <= 0) return "/";
  return trimmed.slice(0, at);
}
