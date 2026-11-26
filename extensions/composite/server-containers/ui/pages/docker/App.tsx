// Docker 面板：在当前服务器上执行 `docker ps` / `docker logs` 与生命周期操作。
//
// 与 com.navop.docker 扩展的分工：那个扩展连 Docker 守护进程（socket/TCP），
// 功能完整；这个面板面向「我已经 SSH 到一台服务器，只想快速看容器」，复用
// 现有终端会话，不要求服务器暴露 Docker 端口。
import { cleanup, effect, Scroll, signal, Text, View } from "nsh";
import { Input } from "nsh/base";
import {
  Badge,
  Button,
  ConfirmBar,
  IconButton,
  ListRow,
  LoadError,
  Loading,
  Notice,
  Row,
  Segmented,
} from "../../lib/ui";
import { c, t } from "../../lib/theme";
import { errorMessage } from "../../lib/format";
import {
  commandFailure,
  listServerTargets,
  nowClock,
  runServerCommand,
  shellQuote,
  type ServerTarget,
} from "../../lib/server";
import { NoTarget, PanelBody, PanelFooter, TargetBar } from "../../lib/panel";

export type DockerContainer = {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
};

const REFRESH_MS = 5000;
const LOG_TAIL = 200;

/** `docker ps --format '{{json .}}'` 每行一个 JSON 对象；坏行跳过而不是整页失败。 */
export function parseContainers(stdout: string): DockerContainer[] {
  const rows: DockerContainer[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const value = JSON.parse(trimmed) as Record<string, unknown>;
      const read = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : "");
      rows.push({
        id: read("ID"),
        name: read("Names") || read("Name") || read("ID"),
        image: read("Image"),
        state: read("State").toLowerCase(),
        status: read("Status"),
        ports: read("Ports"),
      });
    } catch {
      // 单个容器的输出异常不应拖垮整列。
    }
  }
  return rows;
}

export function containerStateTone(state: string): "ok" | "warn" | "danger" | "neutral" {
  if (state === "running") return "ok";
  if (state === "paused" || state === "restarting") return "warn";
  if (state === "exited" || state === "dead") return "danger";
  return "neutral";
}

export function dockerListCommand(all: boolean): string {
  return `docker ps${all ? " -a" : ""} --format '{{json .}}'`;
}

export function dockerActionCommand(action: string, id: string): string {
  return `docker ${action} ${shellQuote(id)}`;
}

export function dockerLogsCommand(id: string): string {
  return `docker logs --tail ${LOG_TAIL} ${shellQuote(id)} 2>&1`;
}

export default function DockerPanel() {
  const targets = signal<ServerTarget[]>([]);
  const targetId = signal<string | null>(null);
  const rows = signal<DockerContainer[]>([]);
  const showAll = signal("all");
  const query = signal("");
  const loading = signal(true);
  const busy = signal(false);
  const error = signal<string | null>(null);
  const updatedAt = signal("");
  const autoRefresh = signal(false);
  const selectedId = signal<string | null>(null);
  const logs = signal("");
  const logsLoading = signal(false);
  const pendingAction = signal<{ action: string; id: string; name: string } | null>(null);
  const actionBusy = signal(false);
  let seq = 0;

  function currentTarget(): ServerTarget | null {
    return targets().find((item) => item.sessionId === targetId()) ?? targets()[0] ?? null;
  }

  function visibleRows(): DockerContainer[] {
    const needle = query().trim().toLowerCase();
    if (needle.length === 0) return rows();
    return rows().filter((row) =>
      `${row.name} ${row.image} ${row.id}`.toLowerCase().includes(needle),
    );
  }

  async function load(force = false) {
    const target = currentTarget();
    if (!target) return;
    if (busy() && !force) return;
    const mine = ++seq;
    busy.set(true);
    if (rows().length === 0) loading.set(true);
    try {
      const result = await runServerCommand(target, dockerListCommand(showAll() === "all"));
      if (mine !== seq) return;
      const failure = commandFailure(result, "docker ps 失败");
      if (failure !== null) {
        error.set(failure);
      } else {
        rows.set(parseContainers(result.stdout));
        error.set(null);
        updatedAt.set(nowClock());
      }
    } catch (failure) {
      if (mine !== seq) return;
      error.set(errorMessage(failure));
    } finally {
      if (mine === seq) {
        busy.set(false);
        loading.set(false);
      }
    }
  }

  async function loadTargets() {
    loading.set(true);
    try {
      const list = await listServerTargets();
      targets.set(list);
      if (list.length > 0 && targetId() === null) targetId.set(list[0].sessionId);
      if (list.length === 0) {
        loading.set(false);
        return;
      }
      await load(true);
    } catch (failure) {
      error.set(errorMessage(failure));
      loading.set(false);
    }
  }

  async function openLogs(row: DockerContainer) {
    const target = currentTarget();
    if (!target) return;
    selectedId.set(row.id);
    logs.set("");
    logsLoading.set(true);
    try {
      const result = await runServerCommand(target, dockerLogsCommand(row.id));
      logs.set(result.stdout || result.stderr || "（这个容器还没有日志输出）");
    } catch (failure) {
      logs.set(errorMessage(failure));
    } finally {
      logsLoading.set(false);
    }
  }

  async function runAction() {
    const pending = pendingAction();
    const target = currentTarget();
    if (!pending || !target) return;
    actionBusy.set(true);
    try {
      const result = await runServerCommand(target, dockerActionCommand(pending.action, pending.id));
      const failure = commandFailure(result, `docker ${pending.action} 失败`);
      if (failure !== null) {
        error.set(failure);
      } else {
        error.set(null);
        pendingAction.set(null);
      }
      await load(true);
    } catch (failure) {
      error.set(errorMessage(failure));
    } finally {
      actionBusy.set(false);
    }
  }

  effect(() => {
    if (!autoRefresh()) return;
    const timer = setInterval(() => void load(), REFRESH_MS);
    cleanup(() => clearInterval(timer));
  });

  void loadTargets();

  return (
    <PanelBody>
      <Row
        gap={8}
        style={{
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderBottomColor: c.line(),
          flexShrink: 0,
        }}
      >
        <Text style={{ ...t.h2, flex: 1 }}>
          {`服务器容器${currentTarget() ? ` · ${currentTarget()?.label}` : ""}`}
        </Text>
        <Button
          label={autoRefresh() ? "停止刷新" : "自动刷新"}
          small
          tone={autoRefresh() ? "primary" : "ghost"}
          onPress={() => autoRefresh.set(!autoRefresh())}
        />
        <IconButton glyph="⟳" label="刷新容器" onPress={() => void load(true)} disabled={busy()} />
      </Row>

      <TargetBar
        targets={targets()}
        currentId={currentTarget()?.sessionId ?? null}
        onSelect={(id) => {
          targetId.set(id);
          rows.set([]);
          logs.set("");
          selectedId.set(null);
          void load(true);
        }}
      />

      <Row gap={8} style={{ paddingHorizontal: 12, paddingVertical: 8, flexShrink: 0 }}>
        <Segmented
          options={[
            { value: "running", label: "运行中" },
            { value: "all", label: "全部" },
          ]}
          value={showAll()}
          size="small"
          onChange={(value) => {
            showAll.set(value);
            void load(true);
          }}
        />
        <View
          style={{
            flex: 1,
            minWidth: 0,
            height: 26,
            paddingHorizontal: 8,
            borderRadius: 6,
            backgroundColor: c.hover(),
            justifyContent: "center",
          }}
        >
          <Input
            value={query()}
            placeholder="按名称 / 镜像 / id 过滤"
            accessibilityLabel="过滤容器"
            onChange={(event) => query.set(event.value)}
            style={{
              fontSize: 11.5,
              color: c.text(),
              placeholderColor: c.muted(),
              caretColor: c.text(),
              borderWidth: 0,
              backgroundColor: "transparent",
            }}
          />
        </View>
      </Row>

      {pendingAction() !== null ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
          <ConfirmBar
            message={`确认在 ${currentTarget()?.label ?? "当前服务器"} 上 ${pendingAction()?.action} 容器 ${pendingAction()?.name}？`}
            confirmLabel={pendingAction()?.action ?? ""}
            busy={actionBusy()}
            onConfirm={() => void runAction()}
            onCancel={() => pendingAction.set(null)}
          />
        </View>
      ) : null}

      {error() !== null ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 6 }}>
          <Notice message={error() ?? ""} tone="danger" />
        </View>
      ) : null}

      {targets().length === 0 && !loading() ? (
        <NoTarget
          hint="打开一个 SSH 或本地终端后，这里会直接列出那台机器上的 Docker 容器。"
          onRetry={() => void loadTargets()}
        />
      ) : loading() && rows().length === 0 ? (
        <Loading label="正在执行 docker ps…" />
      ) : error() !== null && rows().length === 0 ? (
        <LoadError message={error() ?? ""} onRetry={() => void load(true)} />
      ) : (
        <Scroll style={{ flex: 1, minHeight: 0 }}>
          <View style={{ flexDirection: "column", paddingHorizontal: 6, paddingVertical: 4 }}>
            {visibleRows().length === 0 ? (
              <Text style={{ ...t.meta, padding: 12 }}>
                {rows().length === 0 ? "这个服务器上没有匹配的容器。" : "没有匹配过滤条件的容器。"}
              </Text>
            ) : (
              visibleRows().map((row) => (
                <View style={{ borderBottomWidth: 1, borderBottomColor: c.line() }}>
                  <ListRow
                    title={row.name}
                    subtitle={`${row.image} · ${row.status || row.state} · ${row.id}`}
                    leading={<Badge text={row.state || "unknown"} tone={containerStateTone(row.state)} dot />}
                  />
                  {row.ports ? (
                    <Text style={{ ...t.mono, fontSize: 10.5, color: c.muted(), paddingHorizontal: 8, paddingBottom: 4 }}>
                      {`端口  ${row.ports}`}
                    </Text>
                  ) : null}
                  <Row gap={6} style={{ paddingHorizontal: 8, paddingBottom: 6 }} wrap>
                    <Button label="日志" small onPress={() => void openLogs(row)} />
                    {row.state === "running" ? (
                      <Button
                        label="重启"
                        small
                        onPress={() =>
                          pendingAction.set({ action: "restart", id: row.id, name: row.name })
                        }
                      />
                    ) : null}
                    {row.state === "running" ? (
                      <Button
                        label="停止"
                        small
                        tone="danger"
                        onPress={() => pendingAction.set({ action: "stop", id: row.id, name: row.name })}
                      />
                    ) : (
                      <Button
                        label="启动"
                        small
                        onPress={() => pendingAction.set({ action: "start", id: row.id, name: row.name })}
                      />
                    )}
                  </Row>
                </View>
              ))
            )}
          </View>
        </Scroll>
      )}

      {selectedId() !== null ? (
        <View
          style={{
            flexShrink: 0,
            maxHeight: 180,
            borderTopWidth: 1,
            borderTopColor: c.line(),
            flexDirection: "column",
          }}
        >
          <Row style={{ paddingHorizontal: 12, paddingTop: 6, justifyContent: "space-between" }}>
            <Text style={t.label}>{`容器日志（末尾 ${LOG_TAIL} 行）`}</Text>
            <IconButton glyph="×" label="关闭日志" onPress={() => selectedId.set(null)} />
          </Row>
          {logsLoading() ? (
            <Loading label="正在读取容器日志…" />
          ) : (
            <Scroll style={{ flex: 1, minHeight: 0 }}>
              <Text style={{ ...t.mono, fontSize: 11, color: c.text(), paddingHorizontal: 12 }}>
                {logs()}
              </Text>
            </Scroll>
          )}
        </View>
      ) : null}

      <PanelFooter
        left={`${visibleRows().length} / ${rows().length} 个容器`}
        right={updatedAt() ? `更新于 ${updatedAt()}` : ""}
      />
    </PanelBody>
  );
}
