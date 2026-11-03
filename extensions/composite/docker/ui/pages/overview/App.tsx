// Docker 引擎概览：一次 summary 调用把整个引擎的"体检结果"画出来。
//
// 数据只有一个来源 `systemUsage`，所以刷新就是重取一次；页面不做轮询，
// 由用户按需要刷新（后端统计本身也不便宜）。
//
// 三态判断写在 `body()` 里而不是组件体里直接早退：nsh 只在挂载时跑一次
// 组件函数体，写在外面的 if 会停在第一次的取值上。
import { host, mount, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
import { errorMessage, humanBytes, percent, str } from "../../lib/format";
import { Badge, Button, Card, LoadError, Loading, Meter, Row, Stack, Stat } from "../../lib/ui";
import { c, t } from "../../lib/theme";

/** operationId → provider 方法名（清单里的工作台声明已不参与运行）。 */
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

/** 调一次 provider 方法。 */
async function invoke(operationId: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const method = OPERATIONS[operationId];
  if (!method) throw new Error(`未知的操作：${operationId}`);
  return await host.call("navop.resource.invoke", { handle: await handle(), method, params });
}

type Usage = Record<string, unknown>;

export default function Overview() {
  const usage = signal<Usage | null>(null);
  const loading = signal(true);
  const error = signal<string | null>(null);
  const refreshed = signal<string | null>(null);

  async function load() {
    loading.set(true);
    error.set(null);
    try {
      const result = (await invoke("systemUsage", {})) as Usage | null;
      usage.set(result ?? {});
      refreshed.set(new Date().toLocaleTimeString());
    } catch (failure) {
      error.set(errorMessage(failure));
    } finally {
      loading.set(false);
    }
  }

  // 进页面就取一次（组件体只跑一次，正好是挂载时机）。
  void load();

  const body = (): JSX.Element => {
    if (loading() && usage() === null && error() === null) {
      return <Loading label="正在读取引擎用量…" />;
    }
    if (error() !== null && usage() === null) {
      return <LoadError message={error() ?? ""} onRetry={() => void load()} />;
    }
    const u = usage() ?? {};
    const running = Number(u.containers_running ?? 0);
    const total = Number(u.containers_total ?? 0);
    const diskUsed = Number(u.disk_used_bytes ?? 0);
    const reclaimable = Number(u.disk_reclaimable_bytes ?? 0);
    const diskTotal = diskUsed + reclaimable;
    const memory = Number(u.containers_memory_bytes ?? 0);
    const engineUp = u.engine === true || running > 0 || total > 0;
    return (
      <Stack scroll padding={16} gap={14}>
        <Row style={{ justifyContent: "space-between" }}>
          <Row gap={8}>
            <Text style={t.h1}>Docker 引擎</Text>
            <Badge text={engineUp ? "运行中" : "不可用"} tone={engineUp ? "ok" : "danger"} />
            <Text style={t.meta}>
              {`Server ${str(u, "server_version", "未知")} · ${Number(u.cpu_count ?? 0)} CPU`}
            </Text>
          </Row>
          <Row gap={8}>
            {refreshed() === null ? null : (
              <Text style={t.meta}>{`${refreshed()} 更新`}</Text>
            )}
            <Button label={loading() ? "刷新中…" : "刷新"} small disabled={loading()} onPress={() => void load()} />
          </Row>
        </Row>

        {error() === null ? null : <Text style={{ fontSize: 12, color: c.danger() }}>{error()}</Text>}

        <Row gap={10} wrap>
          <Stat label="容器" value={`${running} / ${total}`} hint="运行中 / 总数" />
          <Stat label="镜像" value={String(Number(u.images ?? 0))} hint="本地镜像" />
          <Stat label="数据卷" value={String(Number(u.volumes ?? 0))} hint="逻辑卷" />
          <Stat label="网络" value={String(Number(u.networks ?? 0))} hint="网络数" />
        </Row>

        <Card title="磁盘占用" hint="已用 + 可回收">
          <Meter
            ratio={diskTotal > 0 ? diskUsed / diskTotal : 0}
            label="已用空间"
            caption={`${humanBytes(diskUsed)} / ${humanBytes(diskTotal)}`}
          />
          <Row gap={10} wrap>
            <Badge text={`已用 ${humanBytes(diskUsed)}`} tone="info" />
            <Badge
              text={`可回收 ${humanBytes(reclaimable)}（${percent(reclaimable, diskTotal)}）`}
              tone={reclaimable > 0 ? "warn" : "neutral"}
            />
          </Row>
          {reclaimable > 0 ? (
            <Text style={t.meta}>在「镜像」页可以清理悬空镜像来回收这部分空间。</Text>
          ) : (
            <Text style={t.meta}>没有可回收空间。</Text>
          )}
        </Card>

        <Card title="运行中容器的资源" hint="所有运行中容器的合计">
          <Row gap={10} wrap>
            <Stat label="内存合计" value={humanBytes(memory)} hint="cgroup 统计" />
            <Stat
              label="CPU 估计"
              value={`${Number(u.containers_cpu_percent ?? 0).toFixed(1)}%`}
              hint="相对全部核心"
            />
            <Stat label="运行中容器" value={String(running)} hint={`共 ${total} 个`} />
          </Row>
        </Card>

        <Text style={t.meta}>
          数据来自 docker system 统计：镜像与层的大小包含共享层，因此各项相加可能大于磁盘占用。
        </Text>
      </Stack>
    );
  };

  return (
    <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", backgroundColor: c.bg() }}>
      {body()}
    </View>
  );
}

mount(Overview);
