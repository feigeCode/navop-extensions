// 数据全走 `navop.resource.invoke`：句柄从 `navop.context.current` 拿，
// 页面自己决定调哪个 provider 方法。
import { computed, host, mount, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
import { Input } from "nsh/base";
import { arr, errorMessage, humanBytes, shortTime, str } from "../../lib/format";
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
import { c, r, t } from "../../lib/theme";

type Volume = Record<string, unknown>;
type Detail = Record<string, unknown> | null;

/** operationId → provider 方法名。
 *
 * 清单里的 `resourceWorkbenches` 已经不参与运行，这一层映射留在页面里：
 * 页面自己决定"要哪份数据"，宿主只负责把方法名和参数发给 provider。
 */
const OPERATIONS: Record<string, string> = {
  containerCreate: "docker/container/create",
  containerDiff: "docker/container/diff",
  containerFilesDelete: "docker/container/files/delete",
  containerFilesList: "docker/container/files/list",
  containerKill: "docker/container/kill",
  containerLogs: "docker/container/logs",
  containerLogsWithTail: "docker/container/logs",
  containerMounts: "docker/container/mounts",
  containerPause: "docker/container/pause",
  containerRename: "docker/container/rename",
  containerStats: "docker/container/stats",
  containerTop: "docker/container/top",
  containerUnpause: "docker/container/unpause",
  containerUpdate: "docker/container/update",
  imageHistory: "docker/image/history",
  imageHistoryByRef: "docker/image/history",
  imageInspect: "docker/image/inspect",
  imageInspectByRef: "docker/image/inspect",
  imagePrune: "docker/image/prune",
  imageRemoveByRef: "docker/image/remove",
  imageTag: "docker/image/tag",
  imageTagByRef: "docker/image/tag",
  inspectContainer: "docker/container/inspect",
  inspectNetwork: "docker/network/inspect",
  inspectVolume: "docker/volume/inspect",
  listContainers: "docker/container/list",
  listImages: "docker/image/list",
  listNetworks: "docker/network/list",
  listVolumes: "docker/volume/list",
  networkConnect: "docker/network/connect",
  networkCreate: "docker/network/create",
  networkDisconnect: "docker/network/disconnect",
  networkInspectById: "docker/network/inspect",
  networkPrune: "docker/network/prune",
  networkRemoveById: "docker/network/remove",
  pullImage: "docker/image/pull",
  removeContainer: "docker/container/remove",
  removeImage: "docker/image/remove",
  removeNetwork: "docker/network/remove",
  removeVolume: "docker/volume/remove",
  restartContainer: "docker/container/restart",
  startContainer: "docker/container/start",
  stopContainer: "docker/container/stop",
  systemInfo: "docker/system/info",
  systemPrune: "docker/system/prune",
  systemUsage: "docker/system/usage",
  volumeCreate: "docker/volume/create",
  volumeInspectByName: "docker/volume/inspect",
  volumePrune: "docker/volume/prune",
  volumeRemoveByName: "docker/volume/remove",
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

/** 键值对象 → KeyValue 的行；数组也展开成一行一项。 */
function rowsOf(source: unknown): Array<[string, string]> {
  if (!source || typeof source !== "object") return [];
  return Object.entries(source as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => {
      const text = typeof value === "string" ? value : Array.isArray(value) ? value.map(String).join(", ") : JSON.stringify(value);
      return [key, text ?? String(value)] as [string, string];
    });
}

/** 单行输入框。SearchField 带放大镜，名称 / 驱动字段用它不合适。 */
function Field(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  width?: number;
  onSubmit?: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        height: 28,
        width: props.width ?? 200,
        paddingHorizontal: 9,
        borderRadius: r.control,
        borderWidth: 1,
        borderColor: c.line(),
        backgroundColor: c.bg(),
      }}
    >
      <Input
        value={props.value}
        placeholder={props.placeholder ?? ""}
        onChange={(text) => props.onChange(text)}
        onSubmit={() => props.onSubmit?.()}
        style={{ flex: 1, fontSize: 12, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent" }}
      />
    </View>
  );
}

export default function Volumes() {
  const volumes = signal<Volume[]>([]);
  const loading = signal(true);
  const error = signal<string | null>(null);
  const notice = signal<string | null>(null);
  const filter = signal("");
  const selected = signal<string | null>(null);
  const detail = signal<Detail>(null);
  const detailLoading = signal(false);
  const detailError = signal<string | null>(null);
  const createOpen = signal(false);
  const createName = signal("");
  const createDriver = signal("local");
  const busy = signal(false);
  const pendingRemove = signal<string | null>(null);
  const pendingPrune = signal(false);

  // 只在首次加载 / 首次失败时切换整块内容，刷新时不重建工具条。
  const firstLoad = computed(() => loading() && volumes().length === 0 && error() === null);
  const firstError = computed(() => error() !== null && volumes().length === 0);

  const selectedVolume = () => volumes().find((volume) => str(volume, "name") === selected()) ?? null;

  const visible = () => {
    const needle = filter().trim().toLowerCase();
    if (needle.length === 0) return volumes();
    return volumes().filter((volume) => {
      const haystack = [str(volume, "name", ""), str(volume, "driver", ""), str(volume, "mountpoint", "")]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  };

  async function loadDetail(target: string) {
    detailLoading.set(true);
    detailError.set(null);
    try {
      const info = await dispatch("volumeInspectByName", { name: target });
      if (selected() !== target) return;
      detail.set((info as Detail) ?? null);
    } catch (failure) {
      if (selected() !== target) return;
      detail.set(null);
      detailError.set(errorMessage(failure));
    } finally {
      if (selected() === target) detailLoading.set(false);
    }
  }

  async function load() {
    loading.set(true);
    try {
      const result = await dispatch("listVolumes");
      const list = (Array.isArray(result) ? result : arr(result, "volumes")) as Volume[];
      volumes.set(list);
      error.set(null);
      const target = selected();
      const stillThere = list.some((volume) => str(volume, "name") === target);
      if (!stillThere) {
        const first = list.length > 0 ? str(list[0], "name", "") : "";
        selected.set(first.length > 0 ? first : null);
        detail.set(null);
      }
    } catch (failure) {
      error.set(errorMessage(failure));
    } finally {
      loading.set(false);
    }
    const target = selected();
    if (target !== null) void loadDetail(target);
  }

  function select(target: string) {
    if (selected() === target) return;
    selected.set(target);
    detail.set(null);
    detailError.set(null);
    pendingRemove.set(null);
    void loadDetail(target);
  }

  async function create() {
    const name = createName().trim();
    const driver = createDriver().trim() || "local";
    if (name.length === 0) {
      notice.set("请先填存储卷名称");
      return;
    }
    busy.set(true);
    try {
      const created = await dispatch("volumeCreate", { name, driver }, true);
      createOpen.set(false);
      createName.set("");
      createDriver.set("local");
      selected.set(str(created, "Name", name));
      await load();
      notice.set(`已创建存储卷 ${name}`);
    } catch (failure) {
      notice.set(errorMessage(failure));
    } finally {
      busy.set(false);
    }
  }

  async function remove() {
    const target = pendingRemove();
    if (target === null || target.length === 0) return;
    busy.set(true);
    try {
      await dispatch("volumeRemoveByName", { name: target }, true);
      pendingRemove.set(null);
      if (selected() === target) selected.set(null);
      await load();
      notice.set(`已删除存储卷 ${target}`);
    } catch (failure) {
      notice.set(errorMessage(failure));
    } finally {
      busy.set(false);
    }
  }

  async function prune() {
    busy.set(true);
    try {
      const result = await dispatch("volumePrune", {}, true);
      const deleted = arr(result, "deleted").length;
      const reclaimed = Number((result as Record<string, unknown> | null)?.space_reclaimed_bytes ?? 0);
      pendingPrune.set(false);
      await load();
      notice.set(
        deleted === 0
          ? "没有可清理的未使用存储卷"
          : `已清理 ${deleted} 个未使用存储卷${Number.isFinite(reclaimed) && reclaimed > 0 ? `，回收 ${humanBytes(reclaimed)}` : ""}`,
      );
    } catch (failure) {
      notice.set(errorMessage(failure));
    } finally {
      busy.set(false);
    }
  }

  void load();

  // ---- 片段 ---------------------------------------------------------

  function listPane(): JSX.Element {
    return (
      <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", backgroundColor: c.panel() }}>
        {() =>
          visible().length === 0 ? (
            <Empty
              title={filter().trim().length === 0 ? "还没有存储卷" : "没有匹配的存储卷"}
              hint={
                filter().trim().length === 0
                  ? "点右上角「新建存储卷」创建一个；容器挂载匿名卷后刷新也能看到。"
                  : "清空搜索词，或换一个名称 / 驱动 / 挂载点再试。"
              }
            />
          ) : (
            <List
              items={visible()}
              keyOf={(volume) => str(volume, "name", "")}
              selected={selected()}
              onSelect={select}
              render={(volume) => (
                <ListRow
                  title={str(volume, "name")}
                  subtitle={str(volume, "mountpoint", "-")}
                  trailing={
                    <View style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                      <Text style={{ ...t.mono, fontSize: 11 }}>{str(volume, "size")}</Text>
                      <Text style={t.meta}>{str(volume, "driver")}</Text>
                    </View>
                  }
                />
              )}
            />
          )
        }
      </View>
    );
  }

  function detailPane(): JSX.Element {
    const volume = selectedVolume();
    if (volume === null) {
      return <Empty title="选择左侧的存储卷" hint="选中后可以查看驱动、挂载点与标签，并删除这个卷。" />;
    }
    const name = str(volume, "name");
    const info = detail();
    const labels = rowsOf(info?.Labels);
    const options = rowsOf(info?.Options);
    const status = arr(info, "Status").map(String);
    const refs = Number(volume.ref_count);
    const scope = str(info ?? volume, "Scope", str(volume, "scope"));
    const driver = str(info ?? volume, "Driver", str(volume, "driver"));
    const mountpoint = str(info ?? volume, "Mountpoint", str(volume, "mountpoint", "-"));
    return (
      <Stack scroll padding={14} gap={12}>
        <Row style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <View style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "600", color: c.text() }}>
              {name}
            </Text>
            <Text numberOfLines={1} style={t.meta}>{`${driver} · ${scope} · ${str(volume, "size")}`}</Text>
          </View>
          <Button
            label="删除存储卷"
            tone="danger"
            small
            disabled={busy()}
            onPress={() => {
              pendingPrune.set(false);
              pendingRemove.set(name);
            }}
          />
        </Row>

        {pendingRemove() === name ? (
          <ConfirmBar
            message={`删除存储卷 ${name}？卷里的数据会一并删除，无法恢复。`}
            confirmLabel="删除"
            busy={busy()}
            onConfirm={() => void remove()}
            onCancel={() => pendingRemove.set(null)}
          />
        ) : null}

        {detailError() === null ? null : (
          <Row gap={8}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Notice message={`读取详情失败：${detailError()}`} tone="danger" />
            </View>
            <Button label="重试" small onPress={() => void loadDetail(name)} />
          </Row>
        )}

        <Card title="概览" hint={detailLoading() ? "读取中…" : undefined}>
          <KeyValue
            rows={[
              ["名称", name],
              ["驱动", driver],
              ["Scope", scope],
              ["大小", str(volume, "size")],
              ["引用容器", Number.isFinite(refs) && refs >= 0 ? String(refs) : "-"],
              ["创建时间", shortTime(str(info, "CreatedAt", ""))],
              ["挂载点", mountpoint],
            ]}
          />
        </Card>

        <Card title="标签" hint={labels.length === 0 ? "无" : `${labels.length} 项`}>
          {labels.length === 0 ? <Text style={t.meta}>这个存储卷没有设置标签。</Text> : <KeyValue rows={labels} />}
        </Card>

        {options.length === 0 ? null : (
          <Card title="驱动选项">
            <KeyValue rows={options} />
          </Card>
        )}

        {status.length === 0 ? null : (
          <Card title="状态">
            <Text style={t.meta}>{status.join(" · ")}</Text>
          </Card>
        )}
      </Stack>
    );
  }

  // ---- 页面 ---------------------------------------------------------

  return (
    <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", backgroundColor: c.bg() }}>
      <Row wrap gap={8} style={{ paddingHorizontal: 14, paddingVertical: 10, justifyContent: "space-between" }}>
        <Row gap={8}>
          <Text style={t.h1}>存储卷</Text>
          <Badge text={`${volumes().length} 个`} />
          <SearchField value={filter()} onChange={(value) => filter.set(value)} placeholder="按名称 / 驱动 / 挂载点过滤" />
        </Row>
        <Row gap={6}>
          <Button label="刷新" small onPress={() => void load()} />
          <Button
            label={createOpen() ? "取消新建" : "新建存储卷"}
            small
            onPress={() => createOpen.set(!createOpen())}
          />
          <Button
            label="清理未使用"
            small
            tone="danger"
            onPress={() => {
              pendingRemove.set(null);
              pendingPrune.set(true);
            }}
          />
        </Row>
      </Row>

      {error() === null || volumes().length === 0 ? null : (
        <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
          <Notice message={`刷新失败：${error()}`} tone="danger" />
        </View>
      )}

      {notice() === null ? null : (
        <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
          <Notice message={notice() ?? ""} />
        </View>
      )}

      {!pendingPrune() ? null : (
        <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
          <ConfirmBar
            message="清理所有未被容器使用的存储卷？卷里的数据会一并删除。"
            confirmLabel="清理"
            busy={busy()}
            onConfirm={() => void prune()}
            onCancel={() => pendingPrune.set(false)}
          />
        </View>
      )}

      {!createOpen() ? null : (
        <Row wrap gap={8} style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
          <Field
            value={createName()}
            onChange={(text) => createName.set(text)}
            placeholder="存储卷名称，如 app-data"
            width={220}
            onSubmit={() => void create()}
          />
          <Field
            value={createDriver()}
            onChange={(text) => createDriver.set(text)}
            placeholder="驱动，默认 local"
            width={150}
            onSubmit={() => void create()}
          />
          <Button label={busy() ? "创建中…" : "创建"} tone="primary" small disabled={busy()} onPress={() => void create()} />
          <Text style={t.meta}>驱动留空按 local 处理。</Text>
        </Row>
      )}

      {() => (firstLoad() ? <Loading label="正在读取存储卷列表…" /> : null)}
      {() => (firstError() ? <LoadError message={error() ?? ""} onRetry={() => void load()} /> : null)}
      {() => (firstLoad() || firstError() ? null : <SplitPane left={listPane()} right={detailPane()} />)}
    </View>
  );
}

mount(Volumes);
