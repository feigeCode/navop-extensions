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

/** 调一次工作台操作；把 provider 的失败折成一句人话。 */
async function dispatch(operationId: string, input?: unknown, confirmed?: boolean): Promise<unknown> {
  try {
    return await host.call("navop.workbench.dispatch", {
      operationId,
      input: input ?? {},
      ...(confirmed === true ? { options: { confirmed: true } } : {}),
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
      notice.set(`已删除 ${target}`);
      pendingRemove.set(null);
      await load();
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
      notice.set(`已清理悬空镜像${result ? `（${str(result, "reclaimed", "")} 空间）` : ""}`);
      pendingPrune.set(false);
      await load();
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
      notice.set(`已拉取 ${trimmed}`);
      await load();
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
      await dispatch("imageTagByRef", { name: target, repository: repo, tag }, true);
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
        <Text style={{ ...t.mono, width: 70, color: c.muted() }}>{humanBytes(entry && (entry as Record<string, unknown>).size)}</Text>
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
              {`${str(image, "id", "-")} · ${humanBytes(image.size)} · ${tags.length} 个标签`}
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
                <SearchField value={tagRepo()} onChange={tagRepo.set} placeholder="仓库名，如 acme/api" width={260} />
              </View>
              <SearchField value={tagName()} onChange={tagName.set} placeholder="标签，如 1.4" width={120} />
              <Button label={busy() ? "写入中…" : "写入"} tone="primary" small onPress={() => void applyTag()} disabled={busy()} />
            </Row>
          </Card>
        )}

        <Card title="概览">
          <KeyValue
            rows={[
              ["镜像 ID", str(image, "id", "-")],
              ["大小", humanBytes(image.size)],
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
                ["架构", str((detail()?.info as Record<string, unknown>)?.architecture as unknown, "value", str((detail()?.info as Record<string, unknown>), "architecture", "-"))],
                ["操作系统", str(detail()?.info as Record<string, unknown>, "os", "-")],
                ["环境变量", `${arr((detail()?.info as Record<string, unknown>)?.config as unknown, "Env").length} 项`],
                ["工作目录", str((detail()?.info as Record<string, unknown>)?.config as Record<string, unknown> | undefined, "WorkingDir", "-")],
                ["暴露端口", `${Object.keys(((detail()?.info as Record<string, unknown>)?.config as Record<string, unknown> | undefined)?.ExposedPorts as Record<string, unknown> ?? {}).length} 个`],
              ]}
            />
          </Card>
        )}
      </Stack>
    );
  }

  // ---- 页面 ---------------------------------------------------------

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
          <Badge text={`${images().length} 个本地`} />
          <SearchField value={filter()} onChange={filter.set} placeholder="按名称 / ID / 标签过滤" />
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
          <SearchField value={pullRef()} onChange={pullRef.set} placeholder="repo/name:tag" width={280} />
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
                subtitle={`${arr(image, "tags").length} 个标签 · ${humanBytes(image.size)} · ${shortTime(str(image, "created", ""))}`}
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
}

mount(Images);
