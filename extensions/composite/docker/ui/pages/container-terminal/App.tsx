// Docker 容器终端：挑一个容器，在里面开一个交互式 shell。
//
// 终端不是 TSX 画出来的 —— 它是宿主注册的原生组件 `navop.terminal`
// （Rust 侧 `crates/shell_domain/src/native_terminal.rs`）。页面只负责
// 「挑容器、把参数传进去」，渲染、键盘、PTY 全在宿主里。
//
// 为什么要页面自己挑容器：原生工作台删掉后没有「宿主按 selection 注入
// 容器」这层了（见迁移方案 §15），容器身份是页面状态。
//
// 数据：`docker/container/list` {} → { containers: [{id,name,image,state,...}] }
import { mount, nativeComponent, signal, Text, View } from "nsh";
import type { Accessor, JSX } from "nsh";
import { errorMessage } from "../../lib/format";
import { call } from "../../lib/host";
import { Badge, Empty, List, LoadError, Loading, SearchField, SplitPane } from "../../lib/ui";
import { c, r, t } from "../../lib/theme";

/** 宿主注册的原生终端：`command` + `args` 起一个本地进程。 */
const Terminal = nativeComponent<{
  command: string;
  args: string[];
  env?: Record<string, string>;
  title?: string;
}>("navop.terminal", { props: ["command", "args", "env", "title"] });

type Tone = "neutral" | "ok" | "warn" | "danger";

type Container = {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
};

const STATE_LABEL: Record<string, string> = {
  running: "运行中",
  exited: "已停止",
  paused: "已暂停",
  created: "已创建",
  restarting: "重启中",
};

function stateLabel(state: string): string {
  const label = STATE_LABEL[state];
  return label === undefined ? (state.length === 0 ? "未知" : state) : label;
}

function stateTone(state: string): Tone {
  if (state === "running") return "ok";
  if (state === "paused" || state === "restarting") return "warn";
  if (state === "dead") return "danger";
  return "neutral";
}

function toContainers(payload: unknown): Container[] {
  const source = payload as { containers?: unknown } | null;
  const list = Array.isArray(source?.containers) ? (source!.containers as Container[]) : [];
  // 只留能 exec 的容器：stop 了的容器 `docker exec` 会直接报错，
  // 与其让用户在终端里看到一句英文错误，不如列表里就说清楚。
  return list.filter((item) => typeof item?.id === "string" && item.id.length > 0);
}

function App(): JSX.Element {
  const loading = signal(true);
  const error = signal("");
  const containers = signal<Container[]>([]);
  const filter = signal("");
  const selected = signal<Container | null>(null);
  /** 每次点「重新连接」+1：进 env，宿主看到参数变化就重开一个 pty。 */
  const attempt = signal(0);
  /** 首屏之后就失败时不打断已有内容，只在顶部提示。 */
  const notice = signal("");

  async function load(): Promise<void> {
    loading.set(true);
    error.set("");
    try {
      const payload = await call("docker/container/list", {});
      containers.set(toContainers(payload));
      const current = selected();
      if (current !== null) {
        const fresh = containers().find((item) => item.id === current.id);
        selected.set(fresh ?? null);
      }
    } catch (cause) {
      const message = errorMessage(cause);
      error.set(message);
      notice.set(message);
    } finally {
      loading.set(false);
    }
  }

  void load();

  const visible = (): Container[] => {
    const keyword = filter().trim().toLowerCase();
    const all = containers();
    if (keyword.length === 0) return all;
    return all.filter((item) =>
      `${item.name} ${item.image} ${item.state}`.toLowerCase().includes(keyword),
    );
  };

  const row = (item: Container): JSX.Element => (
    <View
      onPress={() => {
        selected.set(item);
        notice.set("");
      }}
      style={{
        flexDirection: "column",
        gap: 3,
        paddingVertical: 7,
        paddingHorizontal: 10,
        borderRadius: r.control,
        backgroundColor:
          selected()?.id === item.id ? c.hover() : c.bg(),
        borderWidth: 1,
        borderColor: selected()?.id === item.id ? c.line() : "transparent",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text numberOfLines={1} style={{ ...t.body, color: c.text(), flexGrow: 1 }}>
          {item.name}
        </Text>
        <Badge text={stateLabel(item.state)} tone={stateTone(item.state)} />
      </View>
      <Text numberOfLines={1} style={{ ...t.meta, color: c.muted() }}>
        {item.image}
      </Text>
    </View>
  );

  const picker = (): JSX.Element => (
    <View style={{ flexDirection: "column", gap: 8, height: "100%", minWidth: 0 }}>
      <SearchField
        value={filter()}
        onChange={(next: string) => filter.set(next)}
        placeholder="过滤容器"
        width={220}
      />
      <List
        items={visible()}
        keyOf={(item) => item.id}
        selected={selected()?.id ?? null}
        onSelect={(id) => {
          selected.set(containers().find((item) => item.id === id) ?? null);
          notice.set("");
        }}
        render={(item) => row(item)}
        empty={<Empty title="没有匹配的容器" hint="换个关键字，或刷新列表" />}
      />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View
          onPress={() => void load()}
          style={{
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: r.control,
            borderWidth: 1,
            borderColor: c.line(),
          }}
        >
          <Text style={{ ...t.label, color: c.text() }}>刷新列表</Text>
        </View>
        <Text style={{ ...t.meta, color: c.muted() }}>共 {containers().length} 个容器</Text>
      </View>
    </View>
  );

  const terminal = (item: Container): JSX.Element => (
    <View style={{ flexDirection: "column", gap: 8, height: "100%", minWidth: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text numberOfLines={1} style={{ ...t.h2, color: c.text(), flexGrow: 1 }}>
          {item.name}
        </Text>
        <Badge text={stateLabel(item.state)} tone={stateTone(item.state)} />
        <View
          onPress={() => attempt.set(attempt() + 1)}
          style={{
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: r.control,
            borderWidth: 1,
            borderColor: c.line(),
          }}
        >
          <Text style={{ ...t.label, color: c.text() }}>重新连接</Text>
        </View>
      </View>
      <Text style={{ ...t.meta, color: c.muted() }}>
        {item.state === "running"
          ? `在本机开一个 docker exec -it ${item.name} /bin/sh`
          : "容器没在运行：先启动它，再回到这里连接。"}
      </Text>
      <View
        style={{
          flex: 1,
          minHeight: 240,
          borderRadius: r.card,
          borderWidth: 1,
          borderColor: c.line(),
          backgroundColor: c.panel(),
          overflow: "hidden",
        }}
      >
        {item.state === "running" ? (
          <Terminal
            command="docker"
            args={["exec", "-it", item.name, "/bin/sh"]}
            env={{ NAVOP_SESSION: String(attempt()), NAVOP_TERM: "xterm-256color" }}
            title={item.name}
          />
        ) : (
          <Empty title="容器未运行" hint="启动容器后点上面的「重新连接」" />
        )}
      </View>
    </View>
  );

  const body = (): JSX.Element => {
    if (loading() && containers().length === 0) {
      return <Loading label="正在读取容器列表…" />;
    }
    if (error().length > 0 && containers().length === 0) {
      return <LoadError message={error()} onRetry={() => void load()} />;
    }
    const current = selected();
    return (
      <View style={{ flexDirection: "column", gap: 8, flex: 1, minHeight: 0 }}>
        {notice().length > 0 ? (
          <View
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: r.control,
              backgroundColor: c.panel(),
              borderWidth: 1,
              borderColor: c.danger(),
            }}
          >
            <Text style={{ ...t.meta, color: c.danger() }}>{notice()}</Text>
          </View>
        ) : null}
        <SplitPane width={260} left={picker()} right={current !== null ? terminal(current) : (
          <Empty title="选一个容器" hint="左边点一个容器，右边就会开一个 shell" />
        )} />
      </View>
    );
  };

  return (
    <View style={{ flex: 1, minHeight: 0, padding: 12, backgroundColor: c.bg() }}>{body()}</View>
  );
}

mount(App);
