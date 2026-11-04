// 数据全走 `navop.resource.invoke`：句柄由宿主写在 `host.params.connection` 里，
// 页面自己决定调哪个 provider 方法。
import { computed, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
import { Input } from "nsh/base";
import { invoke, SLOW_TIMEOUT_MS } from "../../lib/navop";
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

type Network = Record<string, unknown>;
type Detail = Record<string, unknown> | null;

/** Docker 自带的三个网络；它们删不掉。 */
const BUILTIN_NAMES = new Set(["bridge", "host", "none"]);

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

function isBuiltin(network: unknown): boolean {
  return BUILTIN_NAMES.has(str(network, "name", ""));
}

function isTrue(source: unknown, key: string): boolean {
  return !!source && typeof source === "object" && (source as Record<string, unknown>)[key] === true;
}

/** 布尔字段 → 是 / 否。 */
function flag(source: unknown, key: string): string {
  return isTrue(source, key) ? "是" : "否";
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

export default function Networks() {
  const networks = signal<Network[]>([]);
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
  const createDriver = signal("bridge");
  const busy = signal(false);
  const pendingRemove = signal<string | null>(null);
  const pendingPrune = signal(false);

  // 只在首次加载 / 首次失败时切换整块内容，刷新时不重建工具条。
  const firstLoad = computed(() => loading() && networks().length === 0 && error() === null);
  const firstError = computed(() => error() !== null && networks().length === 0);

  const selectedNetwork = () => networks().find((network) => str(network, "id") === selected()) ?? null;

  const visible = () => {
    const needle = filter().trim().toLowerCase();
    if (needle.length === 0) return networks();
    return networks().filter((network) => {
      const haystack = [str(network, "name", ""), str(network, "id", ""), str(network, "driver", "")]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  };

  async function loadDetail(target: string) {
    detailLoading.set(true);
    detailError.set(null);
    try {
      const info = await dispatch("networkInspectById", { id: target });
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
      const result = await dispatch("listNetworks");
      const list = (Array.isArray(result) ? result : arr(result, "networks")) as Network[];
      networks.set(list);
      error.set(null);
      const target = selected();
      const stillThere = list.some((network) => str(network, "id") === target);
      if (!stillThere) {
        const first = list.length > 0 ? str(list[0], "id", "") : "";
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
    const driver = createDriver().trim() || "bridge";
    if (name.length === 0) {
      notice.set("请先填网络名称");
      return;
    }
    busy.set(true);
    try {
      await dispatch("networkCreate", { name, driver }, true);
      createOpen.set(false);
      createName.set("");
      createDriver.set("bridge");
      await load();
      // 列表里是 12 位短 id，按名字回查再选中，避免拿完整 id 匹配不上。
      const found = networks().find((network) => str(network, "name") === name);
      if (found !== undefined) {
        const id = str(found, "id");
        selected.set(id);
        detail.set(null);
        void loadDetail(id);
      }
      notice.set(`已创建网络 ${name}`);
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
      await dispatch("networkRemoveById", { id: target }, true);
      pendingRemove.set(null);
      if (selected() === target) selected.set(null);
      await load();
      notice.set(`已删除网络 ${target}`);
    } catch (failure) {
      notice.set(errorMessage(failure));
    } finally {
      busy.set(false);
    }
  }

  async function prune() {
    busy.set(true);
    try {
      const result = await dispatch("networkPrune", {}, true);
      const deleted = arr(result, "deleted").length;
      pendingPrune.set(false);
      await load();
      notice.set(deleted === 0 ? "没有可清理的未使用网络" : `已清理 ${deleted} 个未使用网络`);
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
              title={filter().trim().length === 0 ? "还没有网络" : "没有匹配的网络"}
              hint={
                filter().trim().length === 0
                  ? "点右上角「新建网络」创建一个；bridge / host / none 是 Docker 自带的网络。"
                  : "清空搜索词，或换一个名称 / ID / 驱动再试。"
              }
            />
          ) : (
            <List
              items={visible()}
              keyOf={(network) => str(network, "id", "")}
              selected={selected()}
              onSelect={select}
              render={(network) => (
                <ListRow
                  title={str(network, "name")}
                  subtitle={`${str(network, "driver")} · ${str(network, "scope")} · ${str(network, "id")}`}
                  trailing={
                    <Row gap={4}>
                      {isBuiltin(network) ? <Badge text="内建" /> : null}
                      {isTrue(network, "internal") ? <Badge text="内部" tone="info" /> : null}
                    </Row>
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
    const network = selectedNetwork();
    if (network === null) {
      return <Empty title="选择左侧的网络" hint="选中后可以查看子网、已连接容器与标签，并删除这个网络。" />;
    }
    const name = str(network, "name");
    const id = str(network, "id");
    const info = detail();
    const builtin = isBuiltin(network);
    const labels = rowsOf(info?.Labels);
    const options = rowsOf(info?.Options);
    const ipam = (info?.IPAM ?? null) as Record<string, unknown> | null;
    const configs = arr(ipam, "Config") as Array<Record<string, unknown>>;
    const containers = Object.entries((info?.Containers ?? {}) as Record<string, unknown>).map(([key, value]) => ({
      id: key,
      entry: (value && typeof value === "object" ? value : {}) as Record<string, unknown>,
    }));
    return (
      <Stack scroll padding={14} gap={12}>
        <Row style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <View style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}>
            <Row gap={6}>
              <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "600", color: c.text() }}>
                {name}
              </Text>
              {builtin ? <Badge text="内建" /> : null}
              {isTrue(network, "internal") ? <Badge text="内部" tone="info" /> : null}
            </Row>
            <Text numberOfLines={1} style={t.meta}>{`${str(network, "driver")} · ${str(network, "scope")} · ${id}`}</Text>
          </View>
          <Button
            label={builtin ? "内建网络不可删除" : "删除网络"}
            tone={builtin ? undefined : "danger"}
            small
            disabled={builtin || busy()}
            onPress={() => {
              pendingPrune.set(false);
              pendingRemove.set(id);
            }}
          />
        </Row>

        {pendingRemove() === id ? (
          <ConfirmBar
            message={`删除网络 ${name}？已连接到它的容器会失去这个网络。`}
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
            <Button label="重试" small onPress={() => void loadDetail(id)} />
          </Row>
        )}

        <Card title="概览" hint={detailLoading() ? "读取中…" : undefined}>
          <KeyValue
            columns={2}
            rows={[
              ["名称", name],
              ["网络 ID", id],
              ["驱动", str(info ?? network, "Driver", str(network, "driver"))],
              ["Scope", str(info ?? network, "Scope", str(network, "scope"))],
              ["内建", builtin ? "是" : "否"],
              ["内部网络", flag(info ?? network, "Internal")],
              ["可附加", flag(info ?? network, "Attachable")],
              ["创建时间", shortTime(str(info, "Created", ""))],
            ]}
          />
        </Card>

        <Card title="IPAM 配置" hint={str(ipam, "Driver", "")} >
          {configs.length === 0 ? (
            <Text style={t.meta}>没有配置子网（host / none 这类内建网络通常如此）。</Text>
          ) : (
            <View style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {configs.map((config, index) => (
                <View style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {configs.length > 1 ? <Text style={t.label}>{`子网 ${index + 1}`}</Text> : null}
                  <KeyValue
                    columns={2}
                    rows={[
                      ["子网", str(config, "Subnet", "-")],
                      ["网关", str(config, "Gateway", "-")],
                      ["IP 范围", str(config, "IPRange", "-")],
                      ["辅助地址", rowsOf(config?.AuxiliaryAddresses).map(([key, value]) => `${key}=${value}`).join(", ") || "-"],
                    ]}
                  />
                </View>
              ))}
            </View>
          )}
        </Card>

        <Card title="已连接容器" hint={containers.length === 0 ? "无" : `${containers.length} 个`}>
          {containers.length === 0 ? (
            <Text style={t.meta}>暂无容器连接到这个网络。</Text>
          ) : (
            <View style={{ display: "flex", flexDirection: "column" }}>
              {containers.map(({ id: containerId, entry }) => (
                <Row gap={10} style={{ paddingVertical: 5 }}>
                  <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 12, color: c.text() }}>
                    {str(entry, "Name", containerId.slice(0, 12))}
                  </Text>
                  <Text style={{ ...t.mono, color: c.muted() }}>{str(entry, "IPv4Address", "-")}</Text>
                </Row>
              ))}
            </View>
          )}
        </Card>

        <Card title="标签" hint={labels.length === 0 ? "无" : `${labels.length} 项`}>
          {labels.length === 0 ? <Text style={t.meta}>这个网络没有设置标签。</Text> : <KeyValue rows={labels} />}
        </Card>

        {options.length === 0 ? null : (
          <Card title="驱动选项">
            <KeyValue rows={options} />
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
          <Text style={t.h1}>网络</Text>
          <Badge text={`${networks().length} 个`} />
          <SearchField value={filter()} onChange={(value) => filter.set(value)} placeholder="按名称 / ID / 驱动过滤" />
        </Row>
        <Row gap={6}>
          <Button label="刷新" small onPress={() => void load()} />
          <Button
            label={createOpen() ? "取消新建" : "新建网络"}
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

      {error() === null || networks().length === 0 ? null : (
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
            message="清理所有未被容器使用的网络？"
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
            placeholder="网络名称，如 app-net"
            width={220}
            onSubmit={() => void create()}
          />
          <Field
            value={createDriver()}
            onChange={(text) => createDriver.set(text)}
            placeholder="驱动，默认 bridge"
            width={150}
            onSubmit={() => void create()}
          />
          <Button label={busy() ? "创建中…" : "创建"} tone="primary" small disabled={busy()} onPress={() => void create()} />
          <Text style={t.meta}>驱动留空按 bridge 处理。</Text>
        </Row>
      )}

      {() => (firstLoad() ? <Loading label="正在读取网络列表…" /> : null)}
      {() => (firstError() ? <LoadError message={error() ?? ""} onRetry={() => void load()} /> : null)}
      {() => (firstLoad() || firstError() ? null : <SplitPane left={listPane()} right={detailPane()} />)}
    </View>
  );
}
