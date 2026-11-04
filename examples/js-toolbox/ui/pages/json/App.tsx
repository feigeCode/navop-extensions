// JSON 小工具：格式化、压缩、转义与字符串反转义。
//
// 解析全部在页面内完成。解析失败时尽量把错误位置换算成「第几行第几列」，
// 让用户能直接定位到出问题的字符。
import { Clipboard, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
import { Input } from "nsh/base";
import { errorMessage } from "../../lib/format";
import { Badge, Button, Card, Empty, Notice, Row, SplitPane, Stack } from "../../lib/ui";
import { c, r, t } from "../../lib/theme";

type Indent = 2 | 4;

type Result = { text: string; label: string } | null;

/** 把 `position N`（0 起的字符下标）换算成行与列（1 起）。 */
function describePosition(source: string, position: number): string {
  const before = source.slice(0, Math.max(0, Math.min(position, source.length)));
  const line = before.split("\n").length;
  const column = before.length - before.lastIndexOf("\n");
  return `第 ${line} 行第 ${column} 列（第 ${position + 1} 个字符）`;
}

/** JSON 解析错误 → 中文说明；带位置时补上行列。 */
function describeParseError(source: string, failure: unknown): string {
  const message = errorMessage(failure).trim();
  if (message.length === 0) return "JSON 解析失败：内容不合法。";
  const withPosition = /position\s+(\d+)/i.exec(message);
  if (withPosition !== null) {
    const position = Number(withPosition[1]);
    if (Number.isFinite(position) && position >= 0) {
      return `JSON 解析失败：${message}（${describePosition(source, position)}）`;
    }
  }
  if (/unexpected end of json/i.test(message)) {
    return "JSON 解析失败：内容不完整，括号或引号没有闭合。";
  }
  if (/unexpected token/i.test(message)) {
    const matched = /unexpected token:\s*'(.*)'/i.exec(message);
    const token = matched === null ? null : matched[1];
    const at = token === null ? -1 : source.indexOf(token);
    if (token !== null && at >= 0) {
      return `JSON 解析失败：意外字符「${token}」（${describePosition(source, at)}），检查逗号、括号与引号是否配对。`;
    }
    return "JSON 解析失败：出现了意外字符，检查逗号、括号与引号是否配对。";
  }
  return `JSON 解析失败：${message}`;
}

/** 多行等宽输入框。 */
function CodeArea(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  grow?: boolean;
  height?: number;
}) {
  return (
    <View
      style={{
        flex: props.grow === true ? 1 : undefined,
        minHeight: props.height ?? 200,
        paddingHorizontal: 9,
        paddingVertical: 7,
        borderRadius: r.control,
        borderWidth: 1,
        borderColor: c.line(),
        backgroundColor: c.bg(),
      }}
    >
      <Input
        value={props.value}
        placeholder={props.placeholder ?? ""}
        multiline
        onChange={(text) => props.onChange(text)}
        style={{ flex: 1, fontSize: 12, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent" }}
      />
    </View>
  );
}

/** 左侧输入区：输入框本身只建一次，字符数等文字走响应式子节点。 */
function SourcePane(props: {
  read: () => string;
  write: (value: string) => void;
  problem: () => string | null;
}): JSX.Element {
  return (
    <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: 12, gap: 8 }}>
      <Row gap={8} align="center">
        <Text style={t.h2}>输入</Text>
        <Badge text={`${props.read().length} 字符`} />
        <Text style={t.meta}>{`${props.read().split("\n").length} 行`}</Text>
      </Row>
      <CodeArea
        value={props.read()}
        onChange={props.write}
        placeholder={'例如 {"name":"navop","tags":["nsh","tsx"]}'}
        grow
        height={260}
      />
      {() =>
        props.problem() === null ? null : <Notice message={props.problem() ?? ""} tone="danger" />
      }
    </View>
  );
}

/** 右侧输出区：结果变化时整体重画，这里没有输入框，不会影响焦点。 */
function ResultPane(props: { result: () => Result }): JSX.Element {
  return (
    <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: 12, gap: 8 }}>
      <Row gap={8} align="center">
        <Text style={t.h2}>输出</Text>
        <Badge text="格式化 / 压缩 / 转义 / 反转义" />
      </Row>
      <View style={{ flex: 1, minHeight: 0 }}>{() => body()}</View>
    </View>
  );

  function body(): JSX.Element {
    const current = props.result();
    if (current === null) {
      return (
        <Empty
          title="还没有结果"
          hint="在左侧输入 JSON，再选一个操作（格式化 / 压缩 / 转义 / 反转义）。"
        />
      );
    }
    return (
      <View style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minHeight: 0 }}>
        <Row gap={8} align="center">
          <Badge text={current.label} tone="info" />
          <Text style={t.meta}>{`${current.text.length} 字符`}</Text>
        </Row>
        <View style={{ flex: 1, minHeight: 0, padding: 10, borderRadius: r.control, borderWidth: 1, borderColor: c.line(), backgroundColor: c.panel() }}>
          <Stack scroll padding={0} gap={0}>
            <Text selectable style={{ ...t.mono, lineHeight: 18 }}>
              {current.text}
            </Text>
          </Stack>
        </View>
      </View>
    );
  }
}

export default function Json() {
  const source = signal("");
  const indent = signal<Indent>(2);
  const result = signal<Result>(null);
  const error = signal<string | null>(null);
  const notice = signal<string | null>(null);

  function run(kind: "format" | "minify" | "escape" | "unescape") {
    if (source().trim().length === 0) {
      result.set(null);
      error.set("先在上方输入 JSON 文本。");
      return;
    }
    try {
      switch (kind) {
        case "format":
          result.set({ text: JSON.stringify(JSON.parse(source()), null, indent()), label: `格式化结果（缩进 ${indent()} 空格）` });
          break;
        case "minify":
          result.set({ text: JSON.stringify(JSON.parse(source())), label: "压缩结果" });
          break;
        case "escape":
          result.set({ text: JSON.stringify(source()), label: "转义结果" });
          break;
        case "unescape": {
          const value: unknown = JSON.parse(source());
          if (typeof value !== "string") {
            result.set(null);
            error.set("反转义需要一个 JSON 字符串字面量（以引号开头和结尾的文本）。");
            return;
          }
          result.set({ text: value, label: "反转义结果" });
          break;
        }
      }
      error.set(null);
      notice.set(null);
    } catch (failure) {
      result.set(null);
      error.set(describeParseError(source(), failure));
    }
  }

  async function copy() {
    const current = result();
    if (current === null) return;
    try {
      await Clipboard.writeText(current.text);
      notice.set("已复制到剪贴板。");
    } catch (failure) {
      notice.set(`复制失败：${errorMessage(failure)}`);
    }
  }

  function reset() {
    source.set("");
    result.set(null);
    error.set(null);
    notice.set(null);
  }

  return (
    <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", backgroundColor: c.bg() }}>
      <Row wrap gap={8} style={{ paddingHorizontal: 14, paddingVertical: 10, justifyContent: "space-between" }}>
        <Row gap={8} align="center">
          <Text style={t.h1}>JSON 工具</Text>
          <Badge text="本地计算" tone="ok" />
        </Row>
        <Row wrap gap={6} align="center">
          <Text style={t.label}>缩进</Text>
          {() => (
            <Row gap={6}>
              <Button label="2 空格" small tone={indent() === 2 ? "primary" : "ghost"} onPress={() => indent.set(2)} />
              <Button label="4 空格" small tone={indent() === 4 ? "primary" : "ghost"} onPress={() => indent.set(4)} />
            </Row>
          )}
          <Button label="格式化" small tone="primary" onPress={() => run("format")} />
          <Button label="压缩" small onPress={() => run("minify")} />
          <Button label="转义" small onPress={() => run("escape")} />
          <Button label="反转义" small onPress={() => run("unescape")} />
          <Button label="复制结果" small onPress={() => void copy()} />
          <Button label="清空" small onPress={reset} />
        </Row>
      </Row>

      {() =>
        notice() === null ? null : (
          <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
            <Notice message={notice() ?? ""} />
          </View>
        )
      }

      <View style={{ flex: 1, minHeight: 0 }}>
        <SplitPane
          width={540}
          left={<SourcePane read={source} write={(value: string) => source.set(value)} problem={error} />}
          right={<ResultPane result={result} />}
        />
      </View>
    </View>
  );
}

