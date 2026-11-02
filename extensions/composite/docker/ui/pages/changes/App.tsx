// Docker 容器文件变更页：从容器工作台的「文件变更」shell 视图嵌入。
// 容器由宿主按 route 选中，页面不传容器 id；数据只走 dispatch。
//
// 主数据源 `containerDiff`（provider 的 docker/container/diff）返回
// `{ id, changes: [{ Path, Kind }] }`。bollard 的 ChangeType 经 serde 序列化
// 成数字：0 = Modified / 1 = Added / 2 = Deleted；旧 gpui-shell 页拿到的则是
// `kind: "A" | "C" | "D"`。这里两种形状都兼容。
import { host, mount, Scroll, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
import { arr, errorMessage, str } from "../../lib/format";
import { Badge, Button, Empty, LoadError, Loading, Notice, Row } from "../../lib/ui";
import { c, hairline, r, t } from "../../lib/theme";

type ChangeKind = "A" | "C" | "D";
type Change = Record<string, unknown>;

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

/** 调一次工作台操作；把 provider 的失败折成一句人话。 */
async function dispatch(operationId: string, input?: unknown): Promise<unknown> {
  try {
    return await host.call("navop.workbench.dispatch", { operationId, input: input ?? {} });
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}

export default function Changes() {
  const changes = signal<Change[]>([]);
  const loading = signal(true);
  const error = signal<string | null>(null);
  const busy = signal(false);
  const selected = signal<number | null>(null);

  function countOf(kind: ChangeKind): number {
    return changes().filter((change) => kindOf(change) === kind).length;
  }

  async function load() {
    if (busy()) return;
    busy.set(true);
    if (changes().length === 0) loading.set(true);
    try {
      const result = await dispatch("containerDiff");
      const list = Array.isArray(result) ? (result as Change[]) : arr(result, "changes") as Change[];
      changes.set(list);
      error.set(null);
      if (selected() !== null && selected()! >= list.length) selected.set(null);
    } catch (failure) {
      error.set(errorMessage(failure));
    } finally {
      loading.set(false);
      busy.set(false);
    }
  }

  function selectedChange(): { change: Change; kind: ChangeKind } | null {
    const index = selected();
    if (index === null) return null;
    const change = changes()[index];
    if (change === undefined) return null;
    return { change, kind: kindOf(change) };
  }

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

  function body(): JSX.Element {
    if (loading() && changes().length === 0) {
      return <Loading label="正在读取容器文件变更…" />;
    }
    if (error() !== null && changes().length === 0) {
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
          <Text style={t.h1}>文件变更</Text>
          <Text style={t.meta}>{`${changes().length} 项`}</Text>
          <Badge text={`新增 ${countOf("A")}`} tone="ok" />
          <Badge text={`修改 ${countOf("C")}`} tone="warn" />
          <Badge text={`删除 ${countOf("D")}`} tone="danger" />
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

mount(Changes);
