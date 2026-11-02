// Docker 容器日志页（从容器工作台嵌入）。
//
// 数据只有一条：`containerLogsWithTail`。容器由宿主 selection 决定，页面不传
// 容器 id —— 缺 selection 时宿主直接报错，这里把原始错误显示出来（不猜容器）。
//
// 长行处理：**折行**，不做横向滚动。nsh 的 Text 没有 nowrap，横向滚动得把每
// 一行做成一条不可换行的 Text（2000 行就是 2000 个节点）；折行只用一个 Text
// 节点，任何窗口宽度下都能读到完整内容。
//
// 渲染量：只把末尾 MAX_RENDER_LINES 行交给布局，footer 标注实际显示行数。

import { cleanup, effect, host, mount, Scroll, signal, Text, View } from "nsh";
import type { Accessor, JSX } from "nsh";
import { errorMessage, str } from "../../lib/format";
import { Button, Empty, LoadError, Loading, Notice, Row } from "../../lib/ui";
import { c, r, t } from "../../lib/theme";

/** 自动刷新间隔（旧页 FOLLOW_MS 同值）。 */
const FOLLOW_MS = 2000;
/** 最多渲染的行数：只取日志末尾，避免一次性布局上万行。 */
const MAX_RENDER_LINES = 2000;

/** 尾行档位。「全部」是 provider 的硬上限（MAX_LOG_TAIL = 5000）。 */
const TAILS: Array<{ label: string; value: number }> = [
  { label: "100", value: 100 },
  { label: "200", value: 200 },
  { label: "500", value: 500 },
  { label: "1000", value: 1000 },
  { label: "全部", value: 5000 },
];

/** 把 provider 拼好的日志切成行；去掉末尾换行带来的空行。 */
function toLines(text: string): string[] {
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  return trimmed.length === 0 ? [] : trimmed.split("\n");
}

/** 本地时钟（HH:MM:SS），用于「更新于」。 */
function nowClock(): string {
  const now = new Date();
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
}

/** 小按钮：`active` 用 accessor，样式读的是当前值（写在 style 绑定里才响应式）。 */
function chip(
  label: string,
  active: Accessor<boolean>,
  onPress: () => void,
  testLabel?: string,
): JSX.Element {
  return (
    <View
      onPress={onPress}
      role="button"
      accessibilityLabel={testLabel ?? label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: r.control,
        borderWidth: 1,
        borderColor: active() ? c.accent() : c.line(),
        backgroundColor: active() ? c.accent() : "transparent",
      }}
    >
      <Text style={{ ...t.meta, color: active() ? c.accentText() : c.text() }}>{label}</Text>
    </View>
  );
}

export default function LogViewer() {
  const tail = signal(500);
  const raw = signal("");
  const loading = signal(true);
  const busy = signal(false);
  const error = signal<string | null>(null);
  const updatedAt = signal("");
  const follow = signal(false);
  const cleared = signal(false);

  // last-wins：只有最后一次请求的结果允许落到视图上。
  let seq = 0;

  async function load(force = false) {
    if (busy() && !force) return;
    const mine = ++seq;
    busy.set(true);
    if (raw() === "") loading.set(true);
    try {
      const result = await host.call("navop.workbench.dispatch", {
        operationId: "containerLogsWithTail",
        input: { tail: String(tail()) },
      });
      if (mine !== seq) return;
      raw.set(str(result, "logs", ""));
      cleared.set(false);
      updatedAt.set(nowClock());
      error.set(null);
    } catch (failure) {
      if (mine !== seq) return;
      // 已有日志时保留旧内容，只把错误提示在日志上方。
      error.set(errorMessage(failure));
    } finally {
      if (mine === seq) {
        busy.set(false);
        loading.set(false);
      }
    }
  }

  void load(true);

  // 自动刷新：开时每 2 秒重取，关时由 cleanup 清掉定时器。
  effect(() => {
    if (!follow()) return;
    const timer = setInterval(() => {
      void load();
    }, FOLLOW_MS);
    cleanup(() => clearInterval(timer));
  });

  function pickTail(value: number) {
    if (tail() === value) return;
    tail.set(value);
    void load(true);
  }

  // 末尾 MAX_RENDER_LINES 行（每次读都从当前日志重新切）。
  function view() {
    const all = toLines(raw());
    const shown = all.slice(-MAX_RENDER_LINES);
    return {
      total: all.length,
      shown: shown.length,
      text: shown.join("\n"),
      truncated: all.length > shown.length,
    };
  }

  return (
    <View
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        backgroundColor: c.bg(),
      }}
    >
      {/* 工具条：标题 / 行数档位 / 自动刷新 / 清屏 / 刷新 */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderColor: c.line(),
        }}
      >
        <Text style={{ ...t.h1, color: c.text() }}>容器日志</Text>
        {updatedAt() === "" ? null : (
          <Text style={{ ...t.meta, color: c.muted() }}>{`更新于 ${updatedAt()}`}</Text>
        )}
        <View style={{ flex: 1 }} />
        <Text style={{ ...t.label, color: c.muted() }}>显示行数</Text>
        {TAILS.map((option) =>
          chip(option.label, () => tail() === option.value, () => pickTail(option.value), `行数 ${option.label}`),
        )}
        {chip(
          follow() ? "自动刷新 · 开" : "自动刷新 · 关",
          follow,
          () => follow.set(!follow()),
          "自动刷新",
        )}
        {chip("清屏", () => cleared(), () => cleared.set(true), "清屏")}
        <Button label="刷新" small onPress={() => void load(true)} />
      </View>

      {/* 已有日志但刷新失败：错误提示在日志上方，旧日志继续可读 */}
      {error() !== null && raw() !== "" ? (
        <Row
          gap={8}
          style={{
            alignItems: "center",
            paddingHorizontal: 14,
            paddingTop: 8,
            flexWrap: "wrap",
          }}
        >
          <Notice message={`刷新失败：${error()}`} tone="danger" />
          <Button label="重试" small onPress={() => void load(true)} />
        </Row>
      ) : null}

      {/* 主体：三态 + 日志 */}
      <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {error() !== null && raw() === "" ? (
          <LoadError message={error() ?? ""} onRetry={() => void load(true)} />
        ) : loading() && raw() === "" ? (
          <Loading label="正在读取容器日志…" />
        ) : cleared() || toLines(raw()).length === 0 ? (
          <Empty
            title={cleared() ? "已清屏" : "暂无日志"}
            hint={
              cleared()
                ? "点「刷新」重新读取；自动刷新开着时 2 秒后自动恢复。"
                : "这个容器在所选行数内没有输出日志，试试更大的行数。"
            }
          />
        ) : (
          <Scroll style={{ flex: 1, minHeight: 0 }}>
            <View style={{ padding: 12 }}>
              <Text
                selectable
                style={{ ...t.mono, color: c.text(), lineHeight: 18 }}
              >
                {view().text}
              </Text>
            </View>
          </Scroll>
        )}
      </View>

      {/* footer：实际显示行数 + 折行说明 */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          paddingHorizontal: 14,
          paddingVertical: 6,
          borderTopWidth: 1,
          borderColor: c.line(),
        }}
      >
        <Text style={{ ...t.meta, color: c.muted() }}>
          {view().total === 0
            ? "没有可显示的行"
            : view().truncated
              ? `显示最后 ${view().shown} 行（共 ${view().total} 行，已省略前 ${view().total - view().shown} 行）`
              : `显示最后 ${view().shown} 行`}
        </Text>
        <View style={{ flex: 1 }} />
        <Text style={{ ...t.meta, color: c.muted() }}>
          {tail() === 5000 ? "tail 全部（provider 上限 5000）" : `tail ${tail()}`}
        </Text>
        <Text style={{ ...t.meta, color: c.muted() }}>长行自动折行 · 可选中复制</Text>
      </View>
    </View>
  );
}

mount(LogViewer);
