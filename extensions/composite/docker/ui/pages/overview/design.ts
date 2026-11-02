// Docker 扩展的设计语言：等宽数字、克制的色、密度优先。
//
// 颜色与圆角全部来自宿主主题的 token（`token()` 是响应式的：明暗外观或
// 主题变化时读到它们的组件自动重绘）。页面里不要写死颜色。
import { token, type TextStyle, type ViewStyle } from "nsh";

/** 颜色角色。 */
export const c = {
  get bg() { return token("background"); },
  get fg() { return token("foreground"); },
  get card() { return token("card"); },
  get cardFg() { return token("card-foreground"); },
  get muted() { return token("muted-foreground"); },
  get line() { return token("border"); },
  get accent() { return token("primary"); },
  get onAccent() { return token("primary-foreground"); },
  get danger() { return token("destructive"); },
  get warn() { return token("chart-3"); },
  get ok() { return token("chart-1"); },
  get inset() { return token("muted"); },
};

/** 圆角（点）。 */
export const r = {
  get card() { return 10; },
  get pill() { return 999; },
};

/** 字号与排版：数字一律等宽，避免刷新时抖动。 */
export const t = {
  h1: { fontSize: 17, fontWeight: "600" } as TextStyle,
  label: {
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  } as TextStyle,
  num: {
    fontSize: 22,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  } as TextStyle,
  meta: { fontSize: 11.5, fontVariant: ["tabular-nums"] } as TextStyle,
};

/** 一张卡片：底、边、圆角、内边距。 */
export const card = (extra?: ViewStyle): ViewStyle => ({
  backgroundColor: c.card,
  borderWidth: 1,
  borderColor: c.line,
  borderRadius: r.card,
  padding: 14,
  gap: 10,
  ...extra,
});

/** 小圆角标签（状态/计数）。 */
export const pill = (color: string, textColor: string): ViewStyle => ({
  flexDirection: "row",
  alignItems: "center",
  gap: 5,
  paddingHorizontal: 8,
  paddingVertical: 3,
  borderRadius: r.pill,
  backgroundColor: color,
});

/** 圆点。 */
export const dot = (color: string): ViewStyle => ({
  width: 6,
  height: 6,
  borderRadius: 3,
  backgroundColor: color,
});
