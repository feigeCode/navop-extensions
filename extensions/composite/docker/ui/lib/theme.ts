// Docker 页面的视觉规则（所有页面共用）。
//
// 颜色全部走宿主主题 token：明暗切换、用户换主题时页面会跟着变。页面里
// 不要写死色值 —— 写死的那种在对面主题下会瞎。
import type { TextStyle } from "nsh";
import { token } from "nsh";

/** 语义色角色。取值是函数：token 是响应式的，每次重渲染取最新值。 */
export const c = {
  /** 页面底色 */
  bg: () => token("background"),
  /** 卡片/面板底色 */
  panel: () => token("card"),
  /** 面板上的文字 */
  panelText: () => token("card-foreground"),
  /** 正文 */
  text: () => token("foreground"),
  /** 次要信息（版本号、时间、说明） */
  muted: () => token("muted-foreground"),
  /** 分割线、卡片描边 */
  line: () => token("border"),
  /** 强调色（选中的行、主按钮） */
  accent: () => token("primary"),
  accentText: () => token("primary-foreground"),
  /** 危险操作（删除、清理） */
  danger: () => token("destructive"),
  /** 行悬停/选中底色 */
  hover: () => token("muted"),
  /** 图表色板，用于分类着色 */
  chart: (index: number) => token(`chart-${((index % 5) + 1) as 1 | 2 | 3 | 4 | 5}`),
};

/** 圆角。 */
export const r = { card: 10, control: 6, pill: 999, chip: 4 };

/** 排版。数字统一 tabular-nums，滚动时不抖。 */
export const t = {
  h1: { fontSize: 17, fontWeight: "600", color: c.text() } satisfies TextStyle,
  h2: { fontSize: 14, fontWeight: "600", color: c.text() } satisfies TextStyle,
  body: { fontSize: 13, color: c.text() } satisfies TextStyle,
  label: { fontSize: 11, fontWeight: "500", color: c.muted(), letterSpacing: 0.3 } satisfies TextStyle,
  meta: { fontSize: 11, color: c.muted() } satisfies TextStyle,
  mono: {
    fontSize: 12,
    color: c.text(),
    fontVariant: ["tabular-nums"],
  } satisfies TextStyle,
};

/** 一像素分割线。 */
export const hairline = (vertical = false) =>
  vertical
    ? { width: 1, backgroundColor: c.line(), alignSelf: "stretch" as const }
    : { height: 1, backgroundColor: c.line(), width: "100%" as const };

/** 卡片容器样式（描边 + 圆角 + 内边距）。 */
export const panel = (padding = 14) => ({
  backgroundColor: c.panel(),
  borderWidth: 1,
  borderColor: c.line(),
  borderRadius: r.card,
  padding,
});
