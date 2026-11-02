// Docker 容器挂载页：从容器工作台的「挂载」shell 视图嵌入。
// 容器由宿主按 route 选中，页面不传容器 id；数据只走 dispatch。
//
// 主数据源 `containerMounts`（provider 的 docker/container/mounts）返回
// `{ id, mounts: [{ Type, Name, Source, Destination, Mode, RW, Driver, Propagation }] }`。
// 字段是 bollard 的 PascalCase；`RW === false`（或 Mode 以 ro 开头）即只读。
// 挂载数量通常很少，路径不截断，直接换行显示完整值。
import { host, mount, Scroll, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
import { arr, errorMessage, str } from "../../lib/format";
import { Badge, Button, Empty, LoadError, Loading, Notice, Row } from "../../lib/ui";
import { c, hairline, t } from "../../lib/theme";

type MountPoint = Record<string, unknown>;
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

/** 调一次工作台操作；把 provider 的失败折成一句人话。 */
async function dispatch(operationId: string, input?: unknown): Promise<unknown> {
  try {
    return await host.call("navop.workbench.dispatch", { operationId, input: input ?? {} });
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}

export default function ContainerMounts() {
  const mounts = signal<MountPoint[]>([]);
  const loading = signal(true);
  const error = signal<string | null>(null);
  const busy = signal(false);

  function readOnlyCount(): number {
    return mounts().filter((entry) => isReadOnly(entry)).length;
  }

  async function load() {
    if (busy()) return;
    busy.set(true);
    if (mounts().length === 0) loading.set(true);
    try {
      const result = await dispatch("containerMounts");
      const list = Array.isArray(result) ? (result as MountPoint[]) : arr(result, "mounts") as MountPoint[];
      mounts.set(list);
      error.set(null);
    } catch (failure) {
      error.set(errorMessage(failure));
    } finally {
      loading.set(false);
      busy.set(false);
    }
  }

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

  function body(): JSX.Element {
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
          <Text style={t.h1}>挂载</Text>
          <Text style={t.meta}>{`${mounts().length} 个挂载`}</Text>
          <Badge text={`只读 ${readOnlyCount()}`} tone="warn" />
        </Row>
        <Row gap={6}>
          {busy() ? <Text style={t.meta}>正在读取…</Text> : null}
          <Button label="刷新" small onPress={() => void load()} />
        </Row>
      </Row>
      <View style={hairline()} />
      {body()}
    </View>
  );
}

mount(ContainerMounts);
