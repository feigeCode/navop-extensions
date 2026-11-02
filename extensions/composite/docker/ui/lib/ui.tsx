// 页面用的基础组件。规则只有一条：**样式写在 JSX 属性里**。
//
// nsh 的组件函数体只在挂载时跑一次，所以依赖响应式值（主题、选中态、
// 数据）的样式必须落在属性上，否则不会跟着变。
import type { JSX, TextStyle, ViewStyle } from "nsh";
import { Input } from "nsh/base";
import { Scroll, Text, View } from "nsh";
import { c, hairline, panel, r, t } from "./theme";

type Tone = "neutral" | "ok" | "warn" | "danger" | "info";

const toneColor = (tone: Tone) => {
  switch (tone) {
    case "ok":
      return c.chart(1);
    case "warn":
      return c.chart(4);
    case "danger":
      return c.danger();
    case "info":
      return c.chart(0);
    default:
      return c.muted();
  }
};

/** 纵向堆叠；`scroll` 打开纵向滚动（页面根节点用）。 */
export function Stack(props: {
  gap?: number;
  padding?: number;
  scroll?: boolean;
  style?: ViewStyle;
  children?: JSX.Element | JSX.Element[];
}) {
  const style: ViewStyle = {
    display: "flex",
    flexDirection: "column",
    gap: props.gap ?? 12,
    ...(props.padding === undefined ? {} : { padding: props.padding }),
    ...(props.scroll ? { flex: 1, minHeight: 0 } : {}),
    ...props.style,
  };
  if (props.scroll) {
    return (
      <Scroll style={{ flex: 1, minHeight: 0 }}>
        <View style={style}>{props.children}</View>
      </Scroll>
    );
  }
  return <View style={style}>{props.children}</View>;
}

/** 横向排列，垂直居中。 */
export function Row(props: {
  gap?: number;
  wrap?: boolean;
  align?: "flex-start" | "center" | "flex-end" | "stretch";
  grow?: boolean;
  style?: ViewStyle;
  children?: JSX.Element | JSX.Element[];
}) {
  return (
    <View
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: props.align ?? "center",
        flexWrap: props.wrap ? "wrap" : "nowrap",
        gap: props.gap ?? 8,
        ...(props.grow ? { flex: 1, minWidth: 0 } : {}),
        ...props.style,
      }}
    >
      {props.children}
    </View>
  );
}

/** 卡片：标题 + 右上角操作 + 内容。 */
export function Card(props: {
  title?: string;
  hint?: string;
  right?: JSX.Element;
  padding?: number;
  grow?: boolean;
  children?: JSX.Element | JSX.Element[];
}) {
  return (
    <View style={{ ...panel(props.padding ?? 14), ...(props.grow ? { flex: 1, minWidth: 0 } : {}) }}>
      <View style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {props.title === undefined ? null : (
          <Row style={{ justifyContent: "space-between" }}>
            <View style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Text style={t.h2}>{props.title}</Text>
              {props.hint === undefined ? null : <Text style={t.meta}>{props.hint}</Text>}
            </View>
            {props.right}
          </Row>
        )}
        {props.children}
      </View>
    </View>
  );
}

/** 状态胶囊。 */
export function Badge(props: { text: string; tone?: Tone }) {
  const color = toneColor(props.tone ?? "neutral");
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: r.pill,
        borderWidth: 1,
        borderColor: color,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: "600", color }}>{props.text}</Text>
    </View>
  );
}

/** 按钮：三种语气，外观自己画（nsh/base 的 Button 只管无障碍语义）。 */
export function Button(props: {
  label: string;
  onPress?: () => void;
  tone?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  small?: boolean;
}) {
  const tone = props.tone ?? "ghost";
  const disabled = props.disabled === true;
  const fill =
    tone === "primary" ? c.accent() : tone === "danger" ? "transparent" : "transparent";
  const border = tone === "primary" ? c.accent() : tone === "danger" ? c.danger() : c.line();
  const label = disabled ? c.muted() : tone === "primary" ? c.accentText() : tone === "danger" ? c.danger() : c.text();
  return (
    <View
      onPress={disabled ? undefined : props.onPress}
      role="button"
      accessibilityLabel={props.label}
      style={{
        height: props.small ? 24 : 28,
        paddingHorizontal: props.small ? 9 : 12,
        borderRadius: r.control,
        borderWidth: 1,
        borderColor: border,
        backgroundColor: fill,
        opacity: disabled ? 0.5 : 1,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontSize: props.small ? 12 : 13, fontWeight: "500", color: label }}>
        {props.label}
      </Text>
    </View>
  );
}

/** 搜索框。`onChange` 拿到的是整串新值。 */
export function SearchField(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  width?: number;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 28,
        width: props.width ?? 220,
        paddingHorizontal: 9,
        borderRadius: r.control,
        borderWidth: 1,
        borderColor: c.line(),
        backgroundColor: c.bg(),
      }}
    >
      <Text style={{ fontSize: 12, color: c.muted() }}>⌕</Text>
      <Input
        value={props.value}
        placeholder={props.placeholder ?? "Filter…"}
        onChange={(text) => props.onChange(text)}
        style={{ flex: 1, fontSize: 12, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent" }}
      />
    </View>
  );
}

/** 可滚动的行列表：单选、悬停底色、按 key 高亮。 */
export function List<T>(props: {
  items: T[];
  keyOf: (item: T) => string;
  render: (item: T, index: number) => JSX.Element;
  selected?: string | null;
  onSelect?: (key: string) => void;
  empty?: JSX.Element;
}) {
  if (props.items.length === 0 && props.empty !== undefined) return props.empty;
  return (
    <Scroll style={{ flex: 1, minHeight: 0 }}>
      <View style={{ display: "flex", flexDirection: "column" }}>
        {props.items.map((item, index) => {
          const key = props.keyOf(item);
          const active = props.selected === key;
          return (
            <View
              onPress={props.onSelect === undefined ? undefined : () => props.onSelect?.(key)}
              style={{
                backgroundColor: active ? c.hover() : "transparent",
                borderBottomWidth: index === props.items.length - 1 ? 0 : 1,
                borderBottomColor: c.line(),
              }}
            >
              {props.render(item, index)}
            </View>
          );
        })}
      </View>
    </Scroll>
  );
}

/** 列表里的两行一行式条目：主标题 + 次要信息 + 右侧自由内容。 */
export function ListRow(props: {
  title: string;
  subtitle?: string;
  leading?: JSX.Element;
  trailing?: JSX.Element;
  mono?: boolean;
}) {
  return (
    <Row gap={10} style={{ paddingVertical: 9, paddingHorizontal: 4, minHeight: 40 }}>
      {props.leading}
      <View style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "500", color: c.text() }}>
          {props.title}
        </Text>
        {props.subtitle === undefined ? null : (
          <Text numberOfLines={1} style={{ fontSize: 11, color: c.muted() }}>
            {props.subtitle}
          </Text>
        )}
      </View>
      {props.trailing}
    </Row>
  );
}

/** 空状态：一句解释 + 可选的下一步提示。 */
export function Empty(props: { title: string; hint?: string; action?: JSX.Element }) {
  return (
    <View
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: 24,
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: "500", color: c.text() }}>{props.title}</Text>
      {props.hint === undefined ? null : (
        <Text style={{ fontSize: 12, color: c.muted(), textAlign: "center" }}>{props.hint}</Text>
      )}
      {props.action}
    </View>
  );
}

/** 加载中：一行说明（列表为空时占满可用高度）。 */
export function Loading(props: { label?: string }) {
  return (
    <View
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: 24,
      }}
    >
      <Text style={{ fontSize: 12, color: c.muted() }}>{props.label ?? "Loading…"}</Text>
    </View>
  );
}

/** 失败态：原因 + 重试。错误文案保留原文，便于用户搜索。 */
export function LoadError(props: { message: string; onRetry?: () => void }) {
  return (
    <View style={{ display: "flex", flexDirection: "column", gap: 8, padding: 16 }}>
      <Text style={{ fontSize: 13, color: c.danger() }}>{`加载失败：${props.message}`}</Text>
      {props.onRetry === undefined ? null : (
        <Row>
          <Button label="重试" onPress={props.onRetry} />
        </Row>
      )}
    </View>
  );
}

/** 指标块：大数字 + 说明。 */
export function Stat(props: { label: string; value: string; hint?: string; tone?: Tone }) {
  return (
    <View style={{ ...panel(12), flex: 1, minWidth: 140, display: "flex", flexDirection: "column", gap: 4 }}>
      <Text style={t.label}>{props.label}</Text>
      <Text
        style={{
          fontSize: 22,
          fontWeight: "600",
          color: props.tone === undefined ? c.text() : toneColor(props.tone),
          fontVariant: ["tabular-nums"],
        }}
      >
        {props.value}
      </Text>
      {props.hint === undefined ? null : <Text style={t.meta}>{props.hint}</Text>}
    </View>
  );
}

/** 占用条：0..1 的比例 + 两端说明。 */
export function Meter(props: { ratio: number; label?: string; caption?: string; tone?: Tone }) {
  const clamped = Math.max(0, Math.min(1, props.ratio));
  return (
    <View style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {props.label === undefined && props.caption === undefined ? null : (
        <Row style={{ justifyContent: "space-between" }}>
          <Text style={t.meta}>{props.label ?? ""}</Text>
          <Text style={{ ...t.meta, fontVariant: ["tabular-nums"] }}>{props.caption ?? ""}</Text>
        </Row>
      )}
      <View style={{ height: 8, borderRadius: r.pill, backgroundColor: c.hover(), overflow: "hidden" }}>
        <View
          style={{
            width: `${Math.max(0, Math.round(clamped * 1000) / 10)}%`,
            height: 8,
            borderRadius: r.pill,
            backgroundColor: props.tone === undefined ? c.accent() : toneColor(props.tone),
          }}
        />
      </View>
    </View>
  );
}

/** 键值对表：inspect 类页面的主体。 */
export function KeyValue(props: { rows: Array<[string, string]>; columns?: 1 | 2 }) {
  const columns = props.columns ?? 1;
  return (
    <View
      style={{
        display: "flex",
        flexDirection: columns === 2 ? "row" : "column",
        flexWrap: "wrap",
        gap: columns === 2 ? 12 : 0,
      }}
    >
      {props.rows.map(([key, value]) => (
        <Row
          style={{
            justifyContent: "space-between",
            paddingVertical: 5,
            width: columns === 2 ? "48%" : "100%",
            gap: 12,
          }}
        >
          <Text style={{ fontSize: 12, color: c.muted() }}>{key}</Text>
          <Text style={{ fontSize: 12, color: c.text(), fontVariant: ["tabular-nums"] }}>{value}</Text>
        </Row>
      ))}
    </View>
  );
}

/** 分区标题（列表上方的分组名）。 */
export function SectionTitle(props: { title: string; hint?: string; right?: JSX.Element }) {
  return (
    <Row style={{ justifyContent: "space-between", paddingBottom: 2 }}>
      <Row gap={8}>
        <Text style={t.label}>{props.title}</Text>
        {props.hint === undefined ? null : <Text style={t.meta}>{props.hint}</Text>}
      </Row>
      {props.right}
    </Row>
  );
}

export { Text, View, hairline };

/** 主从布局：左侧列表固定宽度，右侧详情自适应。 */
export function SplitPane(props: {
  width?: number;
  left: JSX.Element;
  right: JSX.Element;
}) {
  return (
    <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "row" }}>
      <View
        style={{
          width: props.width ?? 300,
          flexShrink: 0,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          borderRightWidth: 1,
          borderRightColor: c.line(),
        }}
      >
        {props.left}
      </View>
      <View style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {props.right}
      </View>
    </View>
  );
}

/** 确认条：危险操作执行前的内联二次确认（不用弹出对话框）。 */
export function ConfirmBar(props: {
  message: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Row
      gap={8}
      style={{
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderWidth: 1,
        borderColor: c.danger(),
        borderRadius: r.control,
      }}
    >
      <Text style={{ flex: 1, minWidth: 0, fontSize: 12, color: c.text() }}>{props.message}</Text>
      <Button label="取消" onPress={props.onCancel} small />
      <Button
        label={props.busy ? "执行中…" : props.confirmLabel}
        tone="danger"
        onPress={props.onConfirm}
        disabled={props.busy}
        small
      />
    </Row>
  );
}

/** 一行提示（操作结果/错误），`tone` 决定颜色。 */
export function Notice(props: { message: string; tone?: Tone }) {
  return (
    <Text style={{ fontSize: 12, color: props.tone === undefined ? c.muted() : toneColor(props.tone) }}>
      {props.message}
    </Text>
  );
}
