// Docker 镜像页：左边列表、右边详情。
//
// 数据全走 `navop.workbench.dispatch`：页面拿不到连接，只有工作台知道
// 当前连的是哪台 docker。破坏性操作必须显式 `confirmed: true`。
//
// 从 shell 页嵌入的页面没有 `selection` 绑定，所以所有调用都落在
// `*ByRef` 这一组操作上（参数从 input 读，而不是从工作台选中行读）。
import { mount, signal, Text, View } from "nsh";
import { host } from "nsh";
import type { JSX } from "nsh";
import { arr, errorMessage, humanBytes, joinCommand, shortTime, splitImageRef, str } from "../../lib/format";
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
  SectionTitle,
  SplitPane,
  Stack,
  Stat,
} from "../../lib/ui";
import { c, t } from "../../lib/theme";

type Image = Record<string, unknown>;
type Detail = Record<string, unknown> | null;

/** operationId → provider 方法名。
 *
 * 清单里的 `resourceWorkbenches` 已经不参与运行，这一层映射留在页面里：
 * 页面自己决定"要哪份数据"，宿主只负责把方法名和参数发给 provider。
 */


/** inspect 的返回是 Docker 原始的 PascalCase 结构，别按小写字段读。 */
function pascalRaw(
  info: unknown,
  key: string,
  nested?: string,
): unknown {
  const root = (info ?? null) as Record<string, unknown> | null;
  if (root === null) return null;
  const target =
    nested === undefined ? root : ((root[nested] ?? null) as Record<string, unknown> | null);
  return target?.[key] ?? null;
}

/** PascalCase 字段转展示文本（缺省给 `-`）。 */
function pascal(info: unknown, key: string, nested?: string): string {
  const raw = pascalRaw(info, key, nested);
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  return "-";
}

/** 镜像大小：provider 给的是 `"7.8 MB"` 这种字符串，能直接用就直接用。 */
function sizeText(item: Record<string, unknown> | null): string {
  if (item === null) return "-";
  const size = item.size;
  if (typeof size === "string" && size.trim().length > 0) return size;
  return humanBytes(size);
}

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

export default function Images() {
  const images = signal<Image[]>([]);
  const loading = signal(true);
  const error = signal<string | null>(null);
  const notice = signal<string | null>(null);
  const filter = signal("");
  const selected = signal<string | null>(null);
  const detail = signal<Detail>(null);
  const detailError = signal<string | null>(null);
  const detailLoading = signal(false);
  const pullOpen = signal(false);
  const pullRef = signal("");
  const busy = signal(false);
  const pendingRemove = signal<string | null>(null);
  const pendingPrune = signal(false);
  const tagForm = signal(false);
  const tagRepo = signal("");
  const tagName = signal("");

  const selectedImage = () => images().find((image) => str(image, "remove_target") === selected()) ?? null;
  const visible = () => {
    const needle = filter().trim().toLowerCase();
    if (needle.length === 0) return images();
    return images().filter((image) => {
      const haystack = [str(image, "name", ""), str(image, "id", ""), ...arr(image, "tags").map(String)]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  };

  async function loadDetail(target: string) {
    detailLoading.set(true);
    detailError.set(null);
    try {
      const [info, history] = await Promise.all([
        dispatch("imageInspectByRef", { name: target }),
        dispatch("imageHistoryByRef", { name: target }).catch(() => null),
      ]);
      if (selected() !== target) return;
      detail.set({
        info: (info as Record<string, unknown>) ?? null,
        history: (history as Record<string, unknown>) ?? null,
      });
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
    notice.set(null);
    try {
      const result = await dispatch("listImages");
      const list = Array.isArray(result) ? (result as Image[]) : arr(result, "images") as Image[];
      images.set(list);
      error.set(null);
      const target = selected();
      const stillThere = list.some((image) => str(image, "remove_target") === target);
      if (!stillThere) {
        const first = list.length > 0 ? str(list[0], "remove_target", "") : "";
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
    pullOpen.set(false);
    void loadDetail(target);
  }

  async function remove() {
    const target = pendingRemove();
    if (target === null) return;
    busy.set(true);
    try {
      await dispatch("imageRemoveByRef", { name: target }, true);
      await load();
      notice.set(`已删除 ${target}`);
      pendingRemove.set(null);
    } catch (failure) {
      notice.set(errorMessage(failure));
    } finally {
      busy.set(false);
    }
  }

  async function prune() {
    busy.set(true);
    try {
      const result = await dispatch("imagePrune", { all: false }, true);
      await load();
      notice.set(`已清理悬空镜像${result ? `（${str(result, "reclaimed", "")} 空间）` : ""}`);
      pendingPrune.set(false);
    } catch (failure) {
      notice.set(errorMessage(failure));
    } finally {
      busy.set(false);
    }
  }

  async function pull() {
    const reference = pullRef();
    const trimmed = reference.trim();
    if (trimmed.length === 0) return;
    busy.set(true);
    try {
      const { image, tag } = splitImageRef(trimmed);
      await dispatch("pullImage", { image, tag }, true);
      await load();
      notice.set(`已拉取 ${trimmed}`);
    } catch (failure) {
      notice.set(errorMessage(failure));
    } finally {
      busy.set(false);
    }
  }

  async function applyTag() {
    const target = selected();
    if (target === null) return;
    const repo = tagRepo().trim();
    const tag = tagName().trim();
    if (repo.length === 0 || tag.length === 0) {
      notice.set("打标签需要仓库名与标签");
      return;
    }
    busy.set(true);
    try {
      await dispatch("imageTagByRef", { name: target, repo, tag }, true);
      notice.set(`已打标签 ${repo}:${tag}`);
      tagForm.set(false);
      await load();
    } catch (failure) {
      notice.set(errorMessage(failure));
    } finally {
      busy.set(false);
    }
  }

  void load();

  // ---- 片段 ---------------------------------------------------------

  function historyRows(): JSX.Element[] {
    const history = detail()?.history as Record<string, unknown> | undefined;
    const entries = Array.isArray(history) ? history : arr(history, "history");
    if (entries.length === 0) return [];
    return entries.slice(0, 12).map((entry, index) => (
      <Row gap={10} style={{ paddingVertical: 5 }}>
        <Text style={{ ...t.mono, width: 78, color: c.muted() }}>{shortTime(str(entry, "created", ""))}</Text>
        <Text style={{ ...t.mono, width: 70, color: c.muted() }}>{sizeText(entry)}</Text>
        <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 12, color: c.text() }}>
          {str(entry, "created_by", "-")}
        </Text>
      </Row>
    ));
  }

  function detailPane(): JSX.Element {
    const image = selectedImage();
    if (image === null) {
      return <Empty title="选择左侧的镜像" hint="选中后可以查看配置、层历史，并做删除或打标签。" />;
    }
    const tags = arr(image, "tags").map(String);
    return (
      <Stack scroll padding={14} gap={12}>
        <Row style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <View style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "600", color: c.text() }}>
              {str(image, "name", "<untagged>")}
            </Text>
            <Text numberOfLines={1} style={t.meta}>
              {`${str(image, "id", "-")} · ${sizeText(image)} · ${tags.length} 个标签`}
            </Text>
          </View>
          <Row gap={6}>
            <Button
              label={tagForm() ? "取消" : "打标签"}
              small
              onPress={() => tagForm.set(!tagForm())}
            />
            <Button
              label="删除镜像"
              tone="danger"
              small
              onPress={() => {
                pendingPrune.set(false);
                pendingRemove.set(str(image, "remove_target", ""));
              }}
            />
          </Row>
        </Row>

        {pendingRemove() === null ? null : (
          <ConfirmBar
            message={`删除镜像 ${str(image, "name", "")}？此操作不可撤销。`}
            confirmLabel="删除"
            busy={busy()}
            onConfirm={() => void remove()}
            onCancel={() => pendingRemove.set(null)}
          />
        )}

        {!tagForm() ? null : (
          <Card title="新增标签" hint="例如 acme/api:1.4">
            <Row gap={8}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <SearchField value={tagRepo()} onChange={(text) => tagRepo.set(text)} placeholder="仓库名，如 acme/api" width={260} />
              </View>
              <SearchField value={tagName()} onChange={(text) => tagName.set(text)} placeholder="标签，如 1.4" width={120} />
              <Button label={busy() ? "写入中…" : "写入"} tone="primary" small onPress={() => void applyTag()} disabled={busy()} />
            </Row>
          </Card>
        )}

        <Card title="概览">
          <KeyValue
            rows={[
              ["镜像 ID", str(image, "id", "-")],
              ["大小", sizeText(image)],
              ["创建时间", shortTime(str(image, "created", ""))],
              ["标签", tags.length > 0 ? tags.join(", ") : "<无>"],
              ["入口命令", joinCommand((detail()?.info as Record<string, unknown> | undefined)?.config ?? null)],
            ]}
          />
        </Card>

        <Card title="层历史" hint={detailLoading() ? "读取中…" : "最近 12 层"}>
          {detailError() !== null ? (
            <Notice message={detailError() ?? ""} tone="danger" />
          ) : historyRows().length === 0 ? (
            <Text style={t.meta}>{detailLoading() ? "读取中…" : "没有可显示的层"}</Text>
          ) : (
            <View style={{ display: "flex", flexDirection: "column" }}>{historyRows()}</View>
          )}
        </Card>

        {(detail()?.info as Record<string, unknown> | undefined) === undefined ? null : (
          <Card title="配置">
            <KeyValue
              columns={2}
              rows={[
                ["架构", pascal(detail()?.info, "Architecture")],
                ["操作系统", pascal(detail()?.info, "Os")],
                ["环境变量", `${arr((detail()?.info as Record<string, unknown>)?.Config as unknown, "Env").length} 项`],
                ["工作目录", pascal(detail()?.info, "WorkingDir", "Config")],
                ["暴露端口", `${Object.keys(((pascalRaw(detail()?.info, "Config", "ExposedPorts") ?? {}) as Record<string, unknown>)) .length} 个`],
              ]}
            />
          </Card>
        )}
      </Stack>
    );
  }

  // ---- 页面 ---------------------------------------------------------
  //
  // 三态判断必须发生在 JSX 里：nsh 只在挂载时跑一次组件函数体
  // （untracked），写在外面的早退分支会停在第一次的值上。
  const body = () => {
    if (loading() && images().length === 0 && error() === null) {
      return <Loading label="正在读取镜像列表…" />;
    }
    if (error() !== null && images().length === 0) {
      return <LoadError message={error() ?? ""} onRetry={() => void load()} />;
    }
    return (
    <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", backgroundColor: c.bg() }}>
      <Row gap={8} style={{ paddingHorizontal: 14, paddingVertical: 10, justifyContent: "space-between" }}>
        <Row gap={8}>
          <Text style={t.h1}>镜像</Text>
          <Badge
            text={
              filter().trim().length === 0
                ? `${images().length} 个本地`
                : `匹配 ${visible().length} / 共 ${images().length}`
            }
          />
          <SearchField value={filter()} onChange={(text) => filter.set(text)} placeholder="按名称 / ID / 标签过滤" />
        </Row>
        <Row gap={6}>
          <Button label="刷新" small onPress={() => void load()} />
          <Button
            label={pullOpen() ? "取消拉取" : "拉取镜像"}
            small
            onPress={() => pullOpen.set(!pullOpen())}
          />
          <Button
            label="清理悬空"
            small
            tone="danger"
            onPress={() => {
              pendingRemove.set(null);
              pendingPrune.set(true);
            }}
          />
        </Row>
      </Row>

      {notice() === null ? null : (
        <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
          <Notice message={notice() ?? ""} />
        </View>
      )}

      {!pendingPrune() ? null : (
        <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
          <ConfirmBar
            message="清理所有悬空镜像与未使用层？"
            confirmLabel="清理"
            busy={busy()}
            onConfirm={() => void prune()}
            onCancel={() => pendingPrune.set(false)}
          />
        </View>
      )}

      {!pullOpen() ? null : (
        <Row gap={8} style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
          <SearchField value={pullRef()} onChange={(text) => pullRef.set(text)} placeholder="repo/name:tag" width={280} />
          <Button label={busy() ? "拉取中…" : "拉取"} tone="primary" small onPress={() => void pull()} disabled={busy()} />
          <Text style={t.meta}>冷缓存的大镜像可能要几分钟。</Text>
        </Row>
      )}

      <SplitPane
        left={
          <List
            items={visible()}
            keyOf={(image) => str(image, "remove_target", str(image, "id", ""))}
            selected={selected()}
            onSelect={select}
            render={(image) => (
              <ListRow
                title={str(image, "name", "<untagged>")}
                subtitle={`${arr(image, "tags").length} 个标签 · ${sizeText(image)} · ${shortTime(str(image, "created", ""))}`}
                trailing={image.dangling === true ? <Badge text="悬空" tone="danger" /> : undefined}
              />
            )}
            empty={<Empty title="没有匹配的镜像" hint="清空过滤条件，或先拉取一个镜像。" />}
          />
        }
        right={detailPane()}
      />
    </View>
    );
  };

  return <View style={{ flex: 1, minHeight: 0 }}>{body()}</View>;
}

mount(Images);
