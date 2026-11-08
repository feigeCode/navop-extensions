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
  /** 侧栏专用的一组（shadcn 的 sidebar token：侧栏底色比页面稍深一点） */
  sidebar: () => token("sidebar"),
  sidebarText: () => token("sidebar-foreground"),
  sidebarActive: () => token("sidebar-accent"),
  sidebarActiveText: () => token("sidebar-accent-foreground"),
  sidebarLine: () => token("sidebar-border"),
  /** 输入框描边（比分割线深一档） */
  field: () => token("input"),
  /** 图表色板，用于分类着色 */
  chart: (index: number) => token(`chart-${((index % 5) + 1) as 1 | 2 | 3 | 4 | 5}`),
};

/** 圆角。 */
export const r = { card: 10, control: 6, pill: 999, chip: 4 };

/** 排版。数字统一 tabular-nums，滚动时不抖。
 *
 * 用 getter 是必须的：对象字面量里的 `color: c.text()` 会在模块加载时
 * 求值一次并冻住，用户切主题时页面不跟着变。写成 getter 之后每次读
 * `t.meta` 都重新取 token，主题一变就重画。
 *
 * 尺子：桌面应用的正文比网页小一档（13 是上限），层级靠字重和灰度拉开，
 * 不靠字号跳变 —— 一屏里同时出现 22 / 17 / 14 / 11 会像后台管理面板。
 */
export const t = {
  /** 页面标题：14/600，和 macOS 侧栏标题一个量级 */
  get h1(): TextStyle {
    return { fontSize: 14, fontWeight: "600", color: c.text() };
  },
  /** 分区标题：12/600 */
  get h2(): TextStyle {
    return { fontSize: 12, fontWeight: "600", color: c.text() };
  },
  /** 正文 */
  get body(): TextStyle {
    return { fontSize: 12.5, color: c.text() };
  },
  /** 列表主行 */
  get row(): TextStyle {
    return { fontSize: 13, fontWeight: "500", color: c.text() };
  },
  /** 分区标签 / 指标名：10/600 宽字距，靠灰度退到背景里 */
  get label(): TextStyle {
    return { fontSize: 10, fontWeight: "600", color: c.muted(), letterSpacing: 0.6 };
  },
  /** 次要信息（时间、说明、计数） */
  get meta(): TextStyle {
    return { fontSize: 11, color: c.muted() };
  },
  /** 等宽数字：ID、端口、路径。正文色，保证别的扩展里当主内容用时不吃亏 */
  get mono(): TextStyle {
    return { fontSize: 11.5, color: c.text(), fontVariant: ["tabular-nums"] };
  },
  /** 等宽 + 退一档灰度：只作辅助信息（短 ID、镜像、路径、IP） */
  get monoDim(): TextStyle {
    return { fontSize: 11, color: c.muted(), fontVariant: ["tabular-nums"] };
  },
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

/** 无描边的分区：靠间距和分割线分组，不再一层层套框。 */
export const section = { display: "flex" as const, flexDirection: "column" as const, gap: 8 };
