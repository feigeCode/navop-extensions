// 页面用的基础组件。规则只有一条：**不要在组件体里算 props**。
//
// nsh 的函数组件体只在挂载时跑一次，但 JSX 的属性表达式与子节点绑定每帧重新
// 求值。所以凡是依赖 props（尤其是响应式值：主题 token、选中态、busy、数据）
// 的东西，都必须**内联写在 JSX 属性/子节点里**，一旦提成组件体常量就会冻住：
// 挂载时是什么值，之后永远是那个值（按钮 disabled 后按不动、进度条不动、
// tone 永远不变，都是同一个根因）。
//
// 需要「值本身也是响应式」时，这些 prop 额外接受 accessor（`() => 值`），
// 用 `pick()` 在 JSX 里取值：`disabled={busy()}` 与 `disabled={() => busy()}`
// 都支持。
import type { JSX, TextStyle, ViewStyle } from "nsh";
import { Input } from "nsh/base";
import { Scroll, Text, View } from "nsh";
import { c, hairline, panel, r, t } from "./theme";

type Tone = "neutral" | "ok" | "warn" | "danger" | "info";
type Maybe<T> = T | (() => T);

/** 取值：accessor 就调用，普通值原样返回。只在 JSX 表达式里调用。 */
const pick = <T,>(value: Maybe<T>): T =>
  typeof value === "function" ? (value as () => T)() : value;

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

const buttonFill = (tone: "primary" | "ghost" | "danger") =>
  tone === "primary" ? c.accent() : "transparent";

const buttonBorder = (tone: "primary" | "ghost" | "danger") =>
  tone === "primary" ? c.accent() : tone === "danger" ? c.danger() : c.line();

const buttonLabel = (tone: "primary" | "ghost" | "danger", disabled: boolean) =>
  disabled ? c.muted() : tone === "primary" ? c.accentText() : tone === "danger" ? c.danger() : c.text();

/** 0..1 → 百分比宽度（Meter 用）。返回类型要写成模板字面量，否则 ViewStyle 的
 * `width` 不接受宽化后的 `string`。 */
const meterWidth = (ratio: number): `${number}%` =>
  `${Math.max(0, Math.round(Math.max(0, Math.min(1, ratio)) * 1000) / 10)}%` as `${number}%`;

/** 纵向堆叠；`scroll` 打开纵向滚动（页面根节点用）。 */
export function Stack(props: {
  gap?: number;
  padding?: number;
  scroll?: Maybe<boolean>;
  style?: ViewStyle;
  children?: JSX.Element | JSX.Element[];
}) {
  return (
    <If
      when={pick(props.scroll ?? false)}
      else={
        <View
          style={{
            display: "flex",
            flexDirection: "column",
            gap: props.gap ?? 12,
            ...(props.padding === undefined ? {} : { padding: props.padding }),
            ...props.style,
          }}
        >
          {props.children}
        </View>
      }
    >
      <Scroll style={{ flex: 1, minHeight: 0 }}>
        <View
          style={{
            display: "flex",
            flexDirection: "column",
            gap: props.gap ?? 12,
            ...(props.padding === undefined ? {} : { padding: props.padding }),
            flex: 1,
            minHeight: 0,
            ...props.style,
          }}
        >
          {props.children}
        </View>
      </Scroll>
    </If>
  );
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

/** 状态胶囊：底色填充，不描边（描边胶囊一多就成"盒子汤"）。 */
export function Badge(props: { text: string; tone?: Maybe<Tone>; dot?: boolean }) {
  return (
    <View
      style={{
        height: 18,
        paddingHorizontal: 7,
        borderRadius: r.pill,
        backgroundColor: c.hover(),
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
      }}
    >
      {props.dot ? <Dot color={toneColor(pick(props.tone ?? "neutral"))} /> : null}
      <Text
        style={{
          fontSize: 10.5,
          fontWeight: "600",
          color: pick(props.tone ?? "neutral") === "neutral" ? c.muted() : toneColor(pick(props.tone ?? "neutral")),
        }}
      >
        {props.text}
      </Text>
    </View>
  );
}

/** 小圆点：状态色。 */
export function Dot(props: { color: Maybe<string>; size?: number }) {
  return (
    <View
      style={{
        width: props.size ?? 6,
        height: props.size ?? 6,
        flexShrink: 0,
        borderRadius: 999,
        backgroundColor: pick(props.color),
      }}
    />
  );
}

/** 按钮：三种语气，外观自己画（nsh/base 的 Button 只管无障碍语义）。 */
export function Button(props: {
  label: string;
  onPress?: () => void;
  tone?: Maybe<"primary" | "ghost" | "danger">;
  disabled?: Maybe<boolean>;
  small?: boolean;
}) {
  return (
    <View
      onPress={pick(props.disabled ?? false) ? undefined : props.onPress}
      role="button"
      accessibilityLabel={props.label}
      hoverStyle={
        pick(props.tone ?? "ghost") === "primary"
          ? undefined
          : { backgroundColor: pick(props.disabled ?? false) ? "transparent" : c.hover() }
      }
      style={{
        height: props.small ? 22 : 26,
        paddingHorizontal: props.small ? 8 : 11,
        borderRadius: r.control,
        borderWidth: pick(props.tone ?? "ghost") === "ghost" ? 0 : 1,
        borderColor: buttonBorder(pick(props.tone ?? "ghost")),
        backgroundColor: buttonFill(pick(props.tone ?? "ghost")),
        opacity: pick(props.disabled ?? false) ? 0.45 : 1,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        cursor: "default",
      }}
    >
      <Text
        style={{
          fontSize: 12,
          fontWeight: "500",
          color: buttonLabel(pick(props.tone ?? "ghost"), pick(props.disabled ?? false)),
        }}
      >
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
        gap: 5,
        height: 26,
        width: props.width ?? 180,
        paddingHorizontal: 8,
        borderRadius: r.control,
        backgroundColor: c.hover(),
      }}
    >
      <Text style={{ fontSize: 11, color: c.muted() }}>⌕</Text>
      <Input
        value={props.value}
        placeholder={props.placeholder ?? "Filter…"}
        onChange={(text) => props.onChange(text)}
        style={{ flex: 1, fontSize: 11.5, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent" }}
      />
    </View>
  );
}

/** 可滚动的行列表：单选、悬停底色、按 key 高亮。 */
export function List<T>(props: {
  items: Maybe<T[]>;
  keyOf: (item: T) => string;
  render: (item: T, index: number) => JSX.Element;
  selected?: Maybe<string | null>;
  onSelect?: (key: string) => void;
  empty?: JSX.Element;
}) {
  return (
    <If
      when={pick(props.items).length === 0 && props.empty !== undefined}
      else={
        <Scroll style={{ flex: 1, minHeight: 0 }}>
          <View style={{ display: "flex", flexDirection: "column", paddingHorizontal: 6, paddingVertical: 4 }}>
            {pick(props.items).map((item, index) => {
              const key = props.keyOf(item);
              const active = pick(props.selected ?? null) === key;
              return (
                <View
                  onPress={props.onSelect === undefined ? undefined : () => props.onSelect?.(key)}
                  role="button"
                  accessibilityState={{ selected: active }}
                  hoverStyle={{ backgroundColor: active ? c.hover() : c.sidebarActive() }}
                  style={{
                    borderRadius: r.control,
                    backgroundColor: active ? c.hover() : "transparent",
                    flexDirection: "row",
                    alignItems: "stretch",
                    cursor: "default",
                  }}
                >
                  <View
                    style={{
                      width: 2,
                      flexShrink: 0,
                      marginVertical: 8,
                      borderRadius: 999,
                      backgroundColor: active ? c.accent() : "transparent",
                    }}
                  />
                  {props.render(item, index)}
                </View>
              );
            })}
          </View>
        </Scroll>
      }
    >
      {props.empty}
    </If>
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
    <Row gap={9} style={{ paddingVertical: 7, paddingHorizontal: 8, minHeight: 42, width: "100%" }}>
      {props.leading}
      <View style={{ display: "flex", flexDirection: "column", gap: 1, flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "500", color: c.text() }}>
          {props.title}
        </Text>
        {props.subtitle === undefined ? null : (
          <Text numberOfLines={1} style={t.meta}>
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
        <Text style={{ fontSize: 11.5, color: c.muted(), textAlign: "center", maxWidth: 320 }}>{props.hint}</Text>
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
      <Text style={{ fontSize: 11.5, color: c.muted() }}>{props.label ?? "Loading…"}</Text>
    </View>
  );
}

/** 失败态：原因 + 重试。错误文案保留原文，便于用户搜索。 */
export function LoadError(props: { message: string; onRetry?: () => void }) {
  return (
    <View style={{ display: "flex", flexDirection: "column", gap: 8, padding: 16 }}>
      <Text style={{ fontSize: 12.5, color: c.danger() }}>{`加载失败：${props.message}`}</Text>
      {props.onRetry === undefined ? null : (
        <Row>
          <Button label="重试" onPress={props.onRetry} />
        </Row>
      )}
    </View>
  );
}

/** 指标块：大数字 + 说明。 */
export function Stat(props: { label: string; value: string; hint?: string; tone?: Maybe<Tone> }) {
  return (
    <View style={{ flex: 1, minWidth: 120, display: "flex", flexDirection: "column", gap: 3 }}>
      <Text style={t.label}>{props.label}</Text>
      <Text
        style={{
          fontSize: 18,
          fontWeight: "600",
          color: props.tone === undefined ? c.text() : toneColor(pick(props.tone)),
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
export function Meter(props: {
  ratio: Maybe<number>;
  label?: string;
  caption?: string;
  tone?: Maybe<Tone>;
}) {
  return (
    <View style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <If when={props.label !== undefined || props.caption !== undefined}>
        <Row style={{ justifyContent: "space-between" }}>
          <Text style={t.meta}>{props.label ?? ""}</Text>
          <Text style={{ ...t.meta, fontVariant: ["tabular-nums"] }}>{props.caption ?? ""}</Text>
        </Row>
      </If>
      <View style={{ height: 4, borderRadius: r.pill, backgroundColor: c.hover(), overflow: "hidden" }}>
        <View
          style={{
            width: meterWidth(pick(props.ratio)),
            height: 4,
            borderRadius: r.pill,
            backgroundColor: props.tone === undefined ? c.accent() : toneColor(pick(props.tone)),
          }}
        />
      </View>
    </View>
  );
}

/** 键值对表：inspect 类页面的主体。 */
export function KeyValue(props: {
  rows: Maybe<Array<[string, string]>>;
  columns?: Maybe<1 | 2>;
}) {
  return (
    <View
      style={{
        display: "flex",
        flexDirection: pick(props.columns ?? 1) === 2 ? "row" : "column",
        flexWrap: "wrap",
        gap: pick(props.columns ?? 1) === 2 ? 12 : 0,
      }}
    >
      {pick(props.rows).map(([key, value]) => (
        <Row
          style={{
            justifyContent: "space-between",
            paddingVertical: 5,
            width: pick(props.columns ?? 1) === 2 ? "48%" : "100%",
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

/** 无描边分区：标题 + 内容，详情页用它替代「卡片套卡片」。 */
export function Section(props: {
  title?: string;
  hint?: string;
  right?: JSX.Element;
  gap?: number;
  children?: JSX.Element | JSX.Element[];
}) {
  return (
    <View style={{ display: "flex", flexDirection: "column", gap: props.gap ?? 8 }}>
      <If when={props.title !== undefined}>
        <SectionTitle title={props.title ?? ""} hint={props.hint} right={props.right} />
      </If>
      {props.children}
    </View>
  );
}

/** 页头工具栏：左侧标题/计数，右侧控件。高度固定 44，去掉描边盒子堆叠。 */
export function Toolbar(props: {
  title?: string;
  hint?: string;
  right?: JSX.Element;
  children?: JSX.Element | JSX.Element[];
}) {
  return (
    <Row
      gap={10}
      style={{
        height: 44,
        flexShrink: 0,
        paddingHorizontal: 14,
        borderBottomWidth: 1,
        borderBottomColor: c.line(),
        justifyContent: "space-between",
      }}
    >
      <Row gap={8} style={{ minWidth: 0, flex: 1 }}>
        <If when={props.title !== undefined}>
          <Text numberOfLines={1} style={t.h2}>{props.title ?? ""}</Text>
        </If>
        <If when={props.hint !== undefined}>
          <Text numberOfLines={1} style={t.meta}>{props.hint ?? ""}</Text>
        </If>
        {props.children}
      </Row>
      <Row gap={6} style={{ flexShrink: 0 }}>
        <If when={props.right !== undefined}>{props.right}</If>
      </Row>
    </Row>
  );
}

/** 图标按钮：单字形，无描边，hover 出底色。用于刷新/关闭这类高频小操作。 */
export function IconButton(props: {
  glyph: string;
  label?: string;
  onPress?: () => void;
  disabled?: Maybe<boolean>;
  tone?: "ghost" | "danger";
  size?: number;
}) {
  const danger = props.tone === "danger";
  return (
    <View
      role="button"
      onPress={pick(props.disabled ?? false) ? undefined : props.onPress}
      accessibilityLabel={props.label ?? props.glyph}
      hoverStyle={{ backgroundColor: c.hover() }}
      activeStyle={{ backgroundColor: c.sidebarActive() }}
      style={{
        width: props.size ?? 26,
        height: props.size ?? 26,
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: r.control,
        backgroundColor: "transparent",
        cursor: "default",
        opacity: pick(props.disabled ?? false) ? 0.4 : 1,
      }}
    >
      <Text
        style={{
          fontSize: 13,
          fontWeight: "500",
          color: danger ? c.danger() : c.text(),
        }}
      >
        {props.glyph}
      </Text>
    </View>
  );
}

/** 分段控件：一组互斥的小选项（全部/运行中/已停止）。 */
export function Segmented<T extends string>(props: {
  options: Array<{ value: T; label: string; testLabel?: string }>;
  value: Maybe<T>;
  onChange: (value: T) => void;
  size?: "normal" | "small";
}) {
  const small = props.size === "small";
  return (
    <Row
      gap={2}
      style={{
        padding: 2,
        borderRadius: r.control,
        backgroundColor: c.hover(),
        flexShrink: 0,
        // 在纵向容器里不拉伸成一条长灰条：轨道只包住选项本身。
        alignSelf: "flex-start",
      }}
    >
      {props.options.map((option) => (
        <View
          role="button"
          onPress={() => props.onChange(option.value)}
          accessibilityLabel={option.testLabel ?? option.label}
          accessibilityState={{ selected: pick(props.value) === option.value }}
          hoverStyle={{ backgroundColor: pick(props.value) === option.value ? c.panel() : c.field() }}
          style={{
            height: small ? 20 : 22,
            paddingHorizontal: small ? 7 : 9,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: r.chip,
            cursor: "default",
            backgroundColor: pick(props.value) === option.value ? c.panel() : "transparent",
            boxShadow:
              pick(props.value) === option.value
                ? "0 1px 2px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.06)"
                : undefined,
          }}
        >
          <Text
            style={{
              fontSize: small ? 10.5 : 11,
              fontWeight: pick(props.value) === option.value ? "600" : "400",
              color: pick(props.value) === option.value ? c.text() : c.muted(),
            }}
          >
            {option.label}
          </Text>
        </View>
      ))}
    </Row>
  );
}

/** 指标块：大数字 + 单位 + 说明，横排成一条（CPU / 内存 / 网络）。 */
export function Metric(props: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  ratio?: Maybe<number>;
  tone?: Maybe<Tone>;
}) {
  return (
    <View style={{ flex: 1, minWidth: 120, display: "flex", flexDirection: "column", gap: 4 }}>
      <Text style={t.label}>{props.label}</Text>
      <Row gap={3} style={{ alignItems: "baseline" }}>
        <Text style={{ fontSize: 18, fontWeight: "600", color: c.text(), fontVariant: ["tabular-nums"] }}>
          {props.value}
        </Text>
        <If when={props.unit !== undefined}>
          <Text style={{ fontSize: 11, color: c.muted() }}>{props.unit ?? ""}</Text>
        </If>
      </Row>
      <If when={props.ratio !== undefined}>
        <View style={{ height: 3, borderRadius: r.pill, backgroundColor: c.hover(), overflow: "hidden" }}>
          <View
            style={{
              width: meterWidth(pick(props.ratio ?? 0)),
              height: 3,
              borderRadius: r.pill,
              backgroundColor: props.tone === undefined ? c.accent() : toneColor(pick(props.tone)),
            }}
          />
        </View>
      </If>
      <If when={props.hint !== undefined}>
        <Text numberOfLines={1} style={t.meta}>{props.hint ?? ""}</Text>
      </If>
    </View>
  );
}

/** 网格键值：标签在上、值在下，按列铺开；宽屏不再出现「标签左值右中间空一大截」。 */
export function KeyValueGrid(props: {
  rows: Maybe<Array<[string, string]>>;
  columns?: Maybe<number>;
  mono?: Maybe<boolean>;
}) {
  const columns = pick(props.columns ?? 2);
  return (
    <View
      style={{
        display: "flex",
        flexDirection: "row",
        flexWrap: "wrap",
        columnGap: 16,
        rowGap: 10,
      }}
    >
      {pick(props.rows).map(([key, value]) => (
        <View
          style={{
            width: `${Math.max(28, Math.floor(100 / Math.max(1, columns)) - 2)}%`,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            minWidth: 0,
          }}
        >
          <Text style={t.label}>{key}</Text>
          <Text
            numberOfLines={2}
            style={{
              fontSize: 12.5,
              color: c.text(),
              fontVariant: pick(props.mono ?? false) ? ["tabular-nums"] : undefined,
            }}
          >
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** 定义列表：标签列定宽、值自适应换行。值很长（路径、命令行）时用它，
 * 而不是把值甩到右边缘。 */
export function KeyValueList(props: {
  rows: Maybe<Array<[string, string]>>;
  labelWidth?: number;
  mono?: Maybe<boolean>;
  selectable?: boolean;
}) {
  return (
    <View style={{ display: "flex", flexDirection: "column" }}>
      {pick(props.rows).map(([key, value]) => (
        <Row
          gap={12}
          style={{
            alignItems: "flex-start",
            paddingVertical: 5,
            borderBottomWidth: 1,
            borderBottomColor: c.line(),
          }}
        >
          <Text numberOfLines={1} style={{ ...t.meta, width: props.labelWidth ?? 150, flexShrink: 0 }}>
            {key}
          </Text>
          <Text
            selectable={props.selectable === true}
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 12,
              color: c.text(),
              fontVariant: pick(props.mono ?? false) ? ["tabular-nums"] : undefined,
            }}
          >
            {value}
          </Text>
        </Row>
      ))}
    </View>
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
export function Notice(props: { message: string; tone?: Maybe<Tone> }) {
  return (
    <Text
      style={{
        fontSize: 11.5,
        color: props.tone === undefined ? c.muted() : toneColor(pick(props.tone)),
      }}
    >
      {props.message}
    </Text>
  );
}
