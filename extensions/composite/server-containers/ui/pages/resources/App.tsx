// 进程与 Docker 附属资源的只读表格页。与容器页并列成多页签，
// 命令和列布局参考 motty 的 remote_tools，但沿用本扩展的终端能力面。
import { Scroll, signal, Text, View } from "nsh";
import { Input } from "nsh/base";
import { Button, Empty, IconButton, ListRow, LoadError, Loading, Notice, Row } from "../../lib/ui";
import { c, r, t } from "../../lib/theme";
import { errorMessage } from "../../lib/format";
import {
  commandFailure,
  listServerTargets,
  nowClock,
  runServerCommand,
  type ServerTarget,
} from "../../lib/server";
import { NoTarget, PanelBody, PanelFooter, TargetBar } from "../../lib/panel";

export type ResourceKind = "processes" | "images" | "volumes" | "networks" | "compose";
export type ResourceRow = { id: string; title: string; subtitle: string; status: string };

export function resourceCommand(kind: ResourceKind): string {
  switch (kind) {
    case "processes":
      return "ps -eo pid=,user=,pcpu=,pmem=,etime=,args= --sort=-pcpu 2>&1 | head -n 61";
    case "images":
      return "docker images --format '{{json .}}' 2>&1";
    case "volumes":
      return "docker volume ls --format '{{json .}}' 2>&1";
    case "networks":
      return "docker network ls --format '{{json .}}' 2>&1";
    case "compose":
      return "docker compose ls --format json 2>&1";
  }
}

export function resourceTitle(kind: ResourceKind): string {
  return {
    processes: "服务器进程",
    images: "镜像",
    volumes: "卷",
    networks: "网络",
    compose: "Compose 项目",
  }[kind];
}

function jsonLines(stdout: string): Array<Record<string, unknown>> {
  return stdout.split("\n").flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) return [];
    try {
      return [JSON.parse(trimmed) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

function text(row: Record<string, unknown>, key: string): string {
  return typeof row[key] === "string" ? (row[key] as string) : "";
}

export function parseProcesses(stdout: string): ResourceRow[] {
  return stdout.split("\n").flatMap((line) => {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 6 || !/^\d+$/.test(fields[0])) return [];
    const [pid, user, cpu, memory, elapsed, ...command] = fields;
    return [
      {
        id: pid,
        title: `${pid} · ${user}`,
        subtitle: `CPU ${cpu}% · 内存 ${memory}% · ${elapsed} · ${command.join(" ")}`,
        status: `${cpu}%`,
      },
    ];
  });
}

export function parseResources(kind: Exclude<ResourceKind, "processes">, stdout: string): ResourceRow[] {
  if (kind === "compose") {
    try {
      const document = JSON.parse(stdout.trim()) as unknown;
      const items = Array.isArray(document) ? document : [document];
      return items.flatMap((item) => {
        const row = item as Record<string, unknown>;
        const name = text(row, "Name");
        if (!name) return [];
        return [
          {
            id: name,
            title: name,
            subtitle: text(row, "ConfigFiles"),
            status: text(row, "Status"),
          },
        ];
      });
    } catch {
      return [];
    }
  }
  return jsonLines(stdout).flatMap((row) => {
    if (kind === "images") {
      const name = `${text(row, "Repository")}:${text(row, "Tag")}`;
      return [
        {
          id: text(row, "ID") || name,
          title: name,
          subtitle: `${text(row, "ID")} · ${text(row, "CreatedSince")}`,
          status: text(row, "Size"),
        },
      ];
    }
    if (kind === "volumes") {
      const name = text(row, "Name");
      return [
        {
          id: name,
          title: name,
          subtitle: text(row, "Mountpoint"),
          status: text(row, "Driver"),
        },
      ];
    }
    const name = text(row, "Name");
    return [
      {
        id: text(row, "ID") || name,
        title: name,
        subtitle: text(row, "ID"),
        status: `${text(row, "Driver")} · ${text(row, "Scope")}`,
      },
    ];
  }).filter((row) => row.title.length > 0);
}

export default function ResourcePanel(props: { kind: ResourceKind }) {
  const targets = signal<ServerTarget[]>([]);
  const targetId = signal<string | null>(null);
  const rows = signal<ResourceRow[]>([]);
  const query = signal("");
  const loading = signal(true);
  const error = signal<string | null>(null);
  const updatedAt = signal("");
  let seq = 0;

  function currentTarget(): ServerTarget | null {
    return targets().find((item) => item.sessionId === targetId()) ?? targets()[0] ?? null;
  }

  function visibleRows(): ResourceRow[] {
    const needle = query().trim().toLowerCase();
    if (!needle) return rows();
    return rows().filter((row) =>
      `${row.title} ${row.subtitle} ${row.status}`.toLowerCase().includes(needle),
    );
  }

  async function load() {
    const target = currentTarget();
    if (!target) return;
    const mine = ++seq;
    if (rows().length === 0) loading.set(true);
    try {
      const result = await runServerCommand(target, resourceCommand(props.kind), 20_000);
      if (mine !== seq) return;
      const failure = commandFailure(result, `${resourceTitle(props.kind)}读取失败`);
      if (failure !== null) {
        error.set(failure);
      } else {
        rows.set(
          props.kind === "processes"
            ? parseProcesses(result.stdout)
            : parseResources(props.kind, result.stdout),
        );
        error.set(null);
        updatedAt.set(nowClock());
      }
    } catch (failure) {
      if (mine !== seq) return;
      error.set(errorMessage(failure));
    } finally {
      if (mine === seq) loading.set(false);
    }
  }

  async function init() {
    try {
      const list = await listServerTargets();
      targets.set(list);
      if (list.length > 0) targetId.set(list[0].sessionId);
    } catch (failure) {
      error.set(errorMessage(failure));
    }
    if (targets().length === 0) {
      loading.set(false);
      return;
    }
    await load();
  }

  void init();

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
        <Text style={{ ...t.h2, flex: 1 }}>{resourceTitle(props.kind)}</Text>
        <IconButton glyph="⟳" label={`刷新${resourceTitle(props.kind)}`} onPress={() => void load()} />
      </Row>
      <TargetBar
        targets={targets()}
        currentId={currentTarget()?.sessionId ?? null}
        onSelect={(id) => {
          targetId.set(id);
          rows.set([]);
          void load();
        }}
      />
      <Row gap={8} style={{ paddingHorizontal: 12, paddingVertical: 8, flexShrink: 0 }}>
        <View
          style={{
            flex: 1,
            height: 26,
            paddingHorizontal: 8,
            borderRadius: r.control,
            backgroundColor: c.hover(),
            justifyContent: "center",
          }}
        >
          <Input
            value={query()}
            placeholder="过滤当前列表"
            accessibilityLabel={`过滤${resourceTitle(props.kind)}`}
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
        <Button label="刷新" small onPress={() => void load()} />
      </Row>
      {error() !== null ? (
        <View style={{ paddingHorizontal: 12, paddingBottom: 6 }}>
          <Notice message={error() ?? ""} tone="danger" />
        </View>
      ) : null}
      {targets().length === 0 && !loading() ? (
        <NoTarget hint="打开 SSH 或本地终端后即可读取。" onRetry={() => void init()} />
      ) : loading() && rows().length === 0 ? (
        <Loading label={`正在读取${resourceTitle(props.kind)}…`} />
      ) : error() !== null && rows().length === 0 ? (
        <LoadError message={error() ?? ""} onRetry={() => void load()} />
      ) : visibleRows().length === 0 ? (
        <Empty title="没有匹配的记录" />
      ) : (
        <Scroll style={{ flex: 1, minHeight: 0 }}>
          <View style={{ flexDirection: "column", paddingHorizontal: 6, paddingVertical: 4 }}>
            {visibleRows().map((row) => (
              <ListRow title={row.title} subtitle={row.subtitle} trailing={<Text style={t.meta}>{row.status}</Text>} />
            ))}
          </View>
        </Scroll>
      )}
      <PanelFooter
        left={`${visibleRows().length} / ${rows().length} 条`}
        right={updatedAt() ? `更新于 ${updatedAt()}` : ""}
      />
    </PanelBody>
  );
}
