import { append, bindProp, component, cond, each, element, insert, prop, text } from "nsh:rt";
import { cleanup, host, mount, signal, token } from "nsh";

//#region ../../../../packages/extension-kit/src/navop.ts
/** 常规命令的默认超时。nsh 自己的缺省也是 30 秒，写出来省得调用点猜。 */
const DEFAULT_TIMEOUT_MS = 3e4;
/** 慢命令（列表、日志、大查询）用的超时。 */
const SLOW_TIMEOUT_MS = 6e4;
/** 启动事实：模块顶层读一次即可。 */
const params = host.params;
/** 当前页面的 view 身份。 */
const extension = params.extension ?? {
	id: "",
	title: ""
};
/** 可用的 runtime alias。 */
const backends = params.backends ?? [];
/**
* 当前页面所属的连接。没有连接（例如工具箱里单独打开的页面）时抛错；
* 连接失效由宿主处理（remount 或提示重开），页面没有重取接口。
*/
function connection() {
	const current = params.connection;
	if (!current || !current.resourceHandle) throw new Error("这个页面需要一个扩展连接（当前上下文里没有资源句柄）");
	return current;
}
/**
* 调 provider 的方法。`method` 是真的方法名（如 `docker/container/list`），
* `payload` 是它的参数；默认 30 秒超时，慢方法传 `{ timeout: SLOW_TIMEOUT_MS }`
* 或 `0`（完全交给 provider 自己的超时）。
*/
async function invoke(method, payload = {}, options = {}) {
	const current = connection();
	return await host.call("navop.resource.invoke", {
		handle: current.resourceHandle,
		method,
		params: payload
	}, { timeout: options.timeout ?? 3e4 });
}

//#endregion
//#region ../../../../packages/extension-kit/src/theme.ts
/** 语义色角色。取值是函数：token 是响应式的，每次重渲染取最新值。 */
const c = {
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
	chart: (index) => token(`chart-${index % 5 + 1}`)
};
/** 圆角。 */
const r = {
	card: 10,
	control: 6,
	pill: 999,
	chip: 4
};
/** 排版。数字统一 tabular-nums，滚动时不抖。
*
* 用 getter 是必须的：对象字面量里的 `color: c.text()` 会在模块加载时
* 求值一次并冻住，用户切主题时页面不跟着变。写成 getter 之后每次读
* `t.meta` 都重新取 token，主题一变就重画。
*
* 尺子：桌面应用的正文比网页小一档（13 是上限），层级靠字重和灰度拉开，
* 不靠字号跳变 —— 一屏里同时出现 22 / 17 / 14 / 11 会像后台管理面板。
*/
const t = {
	/** 页面标题：14/600，和 macOS 侧栏标题一个量级 */
	get h1() {
		return {
			fontSize: 14,
			fontWeight: "600",
			color: c.text()
		};
	},
	/** 分区标题：12/600 */
	get h2() {
		return {
			fontSize: 12,
			fontWeight: "600",
			color: c.text()
		};
	},
	/** 正文 */
	get body() {
		return {
			fontSize: 12.5,
			color: c.text()
		};
	},
	/** 列表主行 */
	get row() {
		return {
			fontSize: 13,
			fontWeight: "500",
			color: c.text()
		};
	},
	/** 分区标签 / 指标名：10/600 宽字距，靠灰度退到背景里 */
	get label() {
		return {
			fontSize: 10,
			fontWeight: "600",
			color: c.muted(),
			letterSpacing: .6
		};
	},
	/** 次要信息（时间、说明、计数） */
	get meta() {
		return {
			fontSize: 11,
			color: c.muted()
		};
	},
	/** 等宽数字：ID、端口、路径。正文色，保证别的扩展里当主内容用时不吃亏 */
	get mono() {
		return {
			fontSize: 11.5,
			color: c.text(),
			fontVariant: ["tabular-nums"]
		};
	},
	/** 等宽 + 退一档灰度：只作辅助信息（短 ID、镜像、路径、IP） */
	get monoDim() {
		return {
			fontSize: 11,
			color: c.muted(),
			fontVariant: ["tabular-nums"]
		};
	}
};
/** 一像素分割线。 */
const hairline = (vertical = false) => vertical ? {
	width: 1,
	backgroundColor: c.line(),
	alignSelf: "stretch"
} : {
	height: 1,
	backgroundColor: c.line(),
	width: "100%"
};
/** 卡片容器样式（描边 + 圆角 + 内边距）。 */
const panel = (padding = 14) => ({
	backgroundColor: c.panel(),
	borderWidth: 1,
	borderColor: c.line(),
	borderRadius: r.card,
	padding
});

//#endregion
//#region ../../../../packages/extension-kit/src/ui.tsx
/** 取值：accessor 就调用，普通值原样返回。只在 JSX 表达式里调用。 */
const pick = (value) => typeof value === "function" ? value() : value;
const toneColor = (tone) => {
	switch (tone) {
		case "ok": return c.chart(1);
		case "warn": return c.chart(4);
		case "danger": return c.danger();
		case "info": return c.chart(0);
		default: return c.muted();
	}
};
const buttonFill = (tone) => tone === "primary" ? c.accent() : "transparent";
const buttonBorder = (tone) => tone === "primary" ? c.accent() : tone === "danger" ? c.danger() : c.line();
const buttonLabel = (tone, disabled) => disabled ? c.muted() : tone === "primary" ? c.accentText() : tone === "danger" ? c.danger() : c.text();
/** 纵向堆叠；`scroll` 打开纵向滚动（页面根节点用）。 */
function Stack(props) {
	return cond(() => pick(props.scroll ?? false), () => (() => {
		const __nsh_hv1 = element("scroll");
		prop(__nsh_hv1, "style", {
			flex: 1,
			minHeight: 0
		});
		const __nsh_hv2 = element("view");
		bindProp(__nsh_hv2, "style", () => ({
			display: "flex",
			flexDirection: "column",
			gap: props.gap ?? 12,
			...props.padding === void 0 ? {} : { padding: props.padding },
			flex: 1,
			minHeight: 0,
			...props.style
		}));
		insert(__nsh_hv2, () => props.children);
		append(__nsh_hv1, __nsh_hv2);
		return __nsh_hv1;
	})(), () => (() => {
		const __nsh_hv0 = element("view");
		bindProp(__nsh_hv0, "style", () => ({
			display: "flex",
			flexDirection: "column",
			gap: props.gap ?? 12,
			...props.padding === void 0 ? {} : { padding: props.padding },
			...props.style
		}));
		insert(__nsh_hv0, () => props.children);
		return __nsh_hv0;
	})());
}
/** 横向排列，垂直居中。 */
function Row(props) {
	return (() => {
		const __nsh_hv3 = element("view");
		bindProp(__nsh_hv3, "style", () => ({
			display: "flex",
			flexDirection: "row",
			alignItems: props.align ?? "center",
			flexWrap: props.wrap ? "wrap" : "nowrap",
			gap: props.gap ?? 8,
			...props.grow ? {
				flex: 1,
				minWidth: 0
			} : {},
			...props.style
		}));
		insert(__nsh_hv3, () => props.children);
		return __nsh_hv3;
	})();
}
/** 卡片：标题 + 右上角操作 + 内容。 */
function Card(props) {
	return (() => {
		const __nsh_hv4 = element("view");
		bindProp(__nsh_hv4, "style", () => ({
			...panel(props.padding ?? 14),
			...props.grow ? {
				flex: 1,
				minWidth: 0
			} : {}
		}));
		const __nsh_hv5 = element("view");
		prop(__nsh_hv5, "style", {
			display: "flex",
			flexDirection: "column",
			gap: 10
		});
		insert(__nsh_hv5, [() => props.title === void 0 ? null : component(Row, {
			style: { justifyContent: "space-between" },
			get children() {
				return [(() => {
					const __nsh_hv6 = element("view");
					prop(__nsh_hv6, "style", {
						display: "flex",
						flexDirection: "column",
						gap: 2
					});
					const __nsh_hv7 = element("text");
					bindProp(__nsh_hv7, "style", () => t.h2);
					insert(__nsh_hv7, () => props.title);
					append(__nsh_hv6, __nsh_hv7);
					insert(__nsh_hv6, () => props.hint === void 0 ? null : (() => {
						const __nsh_hv8 = element("text");
						bindProp(__nsh_hv8, "style", () => t.meta);
						insert(__nsh_hv8, () => props.hint);
						return __nsh_hv8;
					})());
					return __nsh_hv6;
				})(), () => props.right];
			}
		}), () => props.children]);
		append(__nsh_hv4, __nsh_hv5);
		return __nsh_hv4;
	})();
}
/** 状态胶囊：底色填充，不描边（描边胶囊一多就成"盒子汤"）。 */
function Badge(props) {
	return (() => {
		const __nsh_hv9 = element("view");
		bindProp(__nsh_hv9, "style", () => ({
			height: 18,
			paddingHorizontal: 7,
			borderRadius: r.pill,
			backgroundColor: c.hover(),
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			gap: 4
		}));
		const __nsh_hv10 = element("text");
		bindProp(__nsh_hv10, "style", () => ({
			fontSize: 10.5,
			fontWeight: "600",
			color: pick(props.tone ?? "neutral") === "neutral" ? c.muted() : toneColor(pick(props.tone ?? "neutral"))
		}));
		insert(__nsh_hv10, () => props.text);
		append(__nsh_hv9, __nsh_hv10);
		insert(__nsh_hv9, () => props.dot ? component(Dot, { get color() {
			return toneColor(pick(props.tone ?? "neutral"));
		} }) : null, __nsh_hv10);
		return __nsh_hv9;
	})();
}
/** 小圆点：状态色。 */
function Dot(props) {
	return (() => {
		const __nsh_hv11 = element("view");
		bindProp(__nsh_hv11, "style", () => ({
			width: props.size ?? 6,
			height: props.size ?? 6,
			flexShrink: 0,
			borderRadius: 999,
			backgroundColor: pick(props.color)
		}));
		return __nsh_hv11;
	})();
}
/** 按钮：三种语气，外观自己画（nsh/base 的 Button 只管无障碍语义）。 */
function Button(props) {
	return (() => {
		const __nsh_hv12 = element("view");
		bindProp(__nsh_hv12, "onPress", () => pick(props.disabled ?? false) ? void 0 : props.onPress);
		prop(__nsh_hv12, "role", "button");
		bindProp(__nsh_hv12, "accessibilityLabel", () => props.label);
		bindProp(__nsh_hv12, "hoverStyle", () => pick(props.tone ?? "ghost") === "primary" ? void 0 : { backgroundColor: pick(props.disabled ?? false) ? "transparent" : c.hover() });
		bindProp(__nsh_hv12, "style", () => ({
			height: props.small ? 22 : 26,
			paddingHorizontal: props.small ? 8 : 11,
			borderRadius: r.control,
			borderWidth: pick(props.tone ?? "ghost") === "ghost" ? 0 : 1,
			borderColor: buttonBorder(pick(props.tone ?? "ghost")),
			backgroundColor: buttonFill(pick(props.tone ?? "ghost")),
			opacity: pick(props.disabled ?? false) ? .45 : 1,
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			cursor: "default"
		}));
		const __nsh_hv13 = element("text");
		bindProp(__nsh_hv13, "style", () => ({
			fontSize: 12,
			fontWeight: "500",
			color: buttonLabel(pick(props.tone ?? "ghost"), pick(props.disabled ?? false))
		}));
		insert(__nsh_hv13, () => props.label);
		append(__nsh_hv12, __nsh_hv13);
		return __nsh_hv12;
	})();
}
/** 搜索框。`onChange` 拿到的是整串新值。 */
function SearchField(props) {
	return (() => {
		const __nsh_hv14 = element("view");
		bindProp(__nsh_hv14, "style", () => ({
			flexDirection: "row",
			alignItems: "center",
			gap: 5,
			height: 26,
			width: props.width ?? 180,
			paddingHorizontal: 8,
			borderRadius: r.control,
			backgroundColor: c.hover()
		}));
		const __nsh_hv15 = element("text");
		bindProp(__nsh_hv15, "style", () => ({
			fontSize: 11,
			color: c.muted()
		}));
		const __nsh_hv16 = text("⌕");
		append(__nsh_hv15, __nsh_hv16);
		const __nsh_hv17 = element("input");
		bindProp(__nsh_hv17, "value", () => props.value);
		bindProp(__nsh_hv17, "placeholder", () => props.placeholder ?? "Filter…");
		prop(__nsh_hv17, "onChange", (text) => props.onChange(text));
		prop(__nsh_hv17, "style", {
			flex: 1,
			fontSize: 11.5,
			paddingHorizontal: 0,
			borderWidth: 0,
			backgroundColor: "transparent"
		});
		append(__nsh_hv14, __nsh_hv15);
		append(__nsh_hv14, __nsh_hv17);
		return __nsh_hv14;
	})();
}
/** 可滚动的行列表：单选、悬停底色、按 key 高亮。 */
function List(props) {
	return cond(() => pick(props.items).length === 0 && props.empty !== void 0, () => () => props.empty, () => (() => {
		const __nsh_hv18 = element("scroll");
		prop(__nsh_hv18, "style", {
			flex: 1,
			minHeight: 0
		});
		const __nsh_hv19 = element("view");
		prop(__nsh_hv19, "style", {
			display: "flex",
			flexDirection: "column",
			paddingHorizontal: 6,
			paddingVertical: 4
		});
		insert(__nsh_hv19, () => pick(props.items).map((item, index) => {
			const key = props.keyOf(item);
			const active = pick(props.selected ?? null) === key;
			return (() => {
				const __nsh_hv20 = element("view");
				bindProp(__nsh_hv20, "onPress", () => props.onSelect === void 0 ? void 0 : () => props.onSelect?.(key));
				prop(__nsh_hv20, "role", "button");
				prop(__nsh_hv20, "accessibilityState", { selected: active });
				bindProp(__nsh_hv20, "hoverStyle", () => ({ backgroundColor: active ? c.hover() : c.sidebarActive() }));
				bindProp(__nsh_hv20, "style", () => ({
					borderRadius: r.control,
					backgroundColor: active ? c.hover() : "transparent",
					flexDirection: "row",
					alignItems: "stretch",
					cursor: "default"
				}));
				const __nsh_hv21 = element("view");
				bindProp(__nsh_hv21, "style", () => ({
					width: 2,
					flexShrink: 0,
					marginVertical: 8,
					borderRadius: 999,
					backgroundColor: active ? c.accent() : "transparent"
				}));
				append(__nsh_hv20, __nsh_hv21);
				insert(__nsh_hv20, () => props.render(item, index));
				return __nsh_hv20;
			})();
		}));
		append(__nsh_hv18, __nsh_hv19);
		return __nsh_hv18;
	})());
}
/** 列表里的两行一行式条目：主标题 + 次要信息 + 右侧自由内容。 */
function ListRow(props) {
	return component(Row, {
		gap: 9,
		style: {
			paddingVertical: 7,
			paddingHorizontal: 8,
			minHeight: 42,
			width: "100%"
		},
		get children() {
			return [
				() => props.leading,
				(() => {
					const __nsh_hv22 = element("view");
					prop(__nsh_hv22, "style", {
						display: "flex",
						flexDirection: "column",
						gap: 1,
						flex: 1,
						minWidth: 0
					});
					const __nsh_hv23 = element("text");
					prop(__nsh_hv23, "numberOfLines", 1);
					bindProp(__nsh_hv23, "style", () => ({
						fontSize: 13,
						fontWeight: "500",
						color: c.text()
					}));
					insert(__nsh_hv23, () => props.title);
					append(__nsh_hv22, __nsh_hv23);
					insert(__nsh_hv22, () => props.subtitle === void 0 ? null : (() => {
						const __nsh_hv24 = element("text");
						prop(__nsh_hv24, "numberOfLines", 1);
						bindProp(__nsh_hv24, "style", () => t.meta);
						insert(__nsh_hv24, () => props.subtitle);
						return __nsh_hv24;
					})());
					return __nsh_hv22;
				})(),
				() => props.trailing
			];
		}
	});
}
/** 空状态：一句解释 + 可选的下一步提示。 */
function Empty(props) {
	return (() => {
		const __nsh_hv25 = element("view");
		prop(__nsh_hv25, "style", {
			flex: 1,
			display: "flex",
			flexDirection: "column",
			alignItems: "center",
			justifyContent: "center",
			gap: 6,
			padding: 24
		});
		const __nsh_hv26 = element("text");
		bindProp(__nsh_hv26, "style", () => ({
			fontSize: 13,
			fontWeight: "500",
			color: c.text()
		}));
		insert(__nsh_hv26, () => props.title);
		append(__nsh_hv25, __nsh_hv26);
		insert(__nsh_hv25, [() => props.hint === void 0 ? null : (() => {
			const __nsh_hv27 = element("text");
			bindProp(__nsh_hv27, "style", () => ({
				fontSize: 11.5,
				color: c.muted(),
				textAlign: "center",
				maxWidth: 320
			}));
			insert(__nsh_hv27, () => props.hint);
			return __nsh_hv27;
		})(), () => props.action]);
		return __nsh_hv25;
	})();
}
/** 加载中：一行说明（列表为空时占满可用高度）。 */
function Loading(props) {
	return (() => {
		const __nsh_hv28 = element("view");
		prop(__nsh_hv28, "style", {
			flex: 1,
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			gap: 8,
			padding: 24
		});
		const __nsh_hv29 = element("text");
		bindProp(__nsh_hv29, "style", () => ({
			fontSize: 11.5,
			color: c.muted()
		}));
		insert(__nsh_hv29, () => props.label ?? "Loading…");
		append(__nsh_hv28, __nsh_hv29);
		return __nsh_hv28;
	})();
}
/** 失败态：原因 + 重试。错误文案保留原文，便于用户搜索。 */
function LoadError(props) {
	return (() => {
		const __nsh_hv30 = element("view");
		prop(__nsh_hv30, "style", {
			display: "flex",
			flexDirection: "column",
			gap: 8,
			padding: 16
		});
		const __nsh_hv31 = element("text");
		bindProp(__nsh_hv31, "style", () => ({
			fontSize: 12.5,
			color: c.danger()
		}));
		insert(__nsh_hv31, () => `加载失败：${props.message}`);
		append(__nsh_hv30, __nsh_hv31);
		insert(__nsh_hv30, () => props.onRetry === void 0 ? null : component(Row, { get children() {
			return component(Button, {
				label: "重试",
				get onPress() {
					return props.onRetry;
				}
			});
		} }));
		return __nsh_hv30;
	})();
}
/** 指标块：大数字 + 说明。 */
function Stat(props) {
	return (() => {
		const __nsh_hv32 = element("view");
		prop(__nsh_hv32, "style", {
			flex: 1,
			minWidth: 120,
			display: "flex",
			flexDirection: "column",
			gap: 3
		});
		const __nsh_hv33 = element("text");
		bindProp(__nsh_hv33, "style", () => t.label);
		insert(__nsh_hv33, () => props.label);
		const __nsh_hv34 = element("text");
		bindProp(__nsh_hv34, "style", () => ({
			fontSize: 18,
			fontWeight: "600",
			color: props.tone === void 0 ? c.text() : toneColor(pick(props.tone)),
			fontVariant: ["tabular-nums"]
		}));
		insert(__nsh_hv34, () => props.value);
		append(__nsh_hv32, __nsh_hv33);
		append(__nsh_hv32, __nsh_hv34);
		insert(__nsh_hv32, () => props.hint === void 0 ? null : (() => {
			const __nsh_hv35 = element("text");
			bindProp(__nsh_hv35, "style", () => t.meta);
			insert(__nsh_hv35, () => props.hint);
			return __nsh_hv35;
		})());
		return __nsh_hv32;
	})();
}
/** 键值对表：inspect 类页面的主体。 */
function KeyValue(props) {
	return (() => {
		const __nsh_hv41 = element("view");
		bindProp(__nsh_hv41, "style", () => ({
			display: "flex",
			flexDirection: pick(props.columns ?? 1) === 2 ? "row" : "column",
			flexWrap: "wrap",
			gap: pick(props.columns ?? 1) === 2 ? 12 : 0
		}));
		insert(__nsh_hv41, () => pick(props.rows).map(([key, value]) => component(Row, {
			get style() {
				return {
					justifyContent: "space-between",
					paddingVertical: 5,
					width: pick(props.columns ?? 1) === 2 ? "48%" : "100%",
					gap: 12
				};
			},
			get children() {
				return [(() => {
					const __nsh_hv42 = element("text");
					bindProp(__nsh_hv42, "style", () => ({
						fontSize: 12,
						color: c.muted()
					}));
					insert(__nsh_hv42, key);
					return __nsh_hv42;
				})(), (() => {
					const __nsh_hv43 = element("text");
					bindProp(__nsh_hv43, "style", () => ({
						fontSize: 12,
						color: c.text(),
						fontVariant: ["tabular-nums"]
					}));
					insert(__nsh_hv43, value);
					return __nsh_hv43;
				})()];
			}
		})));
		return __nsh_hv41;
	})();
}
/** 主从布局：左侧列表固定宽度，右侧详情自适应。 */
function SplitPane(props) {
	return (() => {
		const __nsh_hv67 = element("view");
		prop(__nsh_hv67, "style", {
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "row"
		});
		const __nsh_hv68 = element("view");
		bindProp(__nsh_hv68, "style", () => ({
			width: props.width ?? 300,
			flexShrink: 0,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			borderRightWidth: 1,
			borderRightColor: c.line()
		}));
		insert(__nsh_hv68, () => props.left);
		const __nsh_hv69 = element("view");
		prop(__nsh_hv69, "style", {
			flex: 1,
			minWidth: 0,
			minHeight: 0,
			display: "flex",
			flexDirection: "column"
		});
		insert(__nsh_hv69, () => props.right);
		append(__nsh_hv67, __nsh_hv68);
		append(__nsh_hv67, __nsh_hv69);
		return __nsh_hv67;
	})();
}
/** 确认条：危险操作执行前的内联二次确认（不用弹出对话框）。 */
function ConfirmBar(props) {
	return component(Row, {
		gap: 8,
		get style() {
			return {
				paddingHorizontal: 10,
				paddingVertical: 8,
				borderWidth: 1,
				borderColor: c.danger(),
				borderRadius: r.control
			};
		},
		get children() {
			return [
				(() => {
					const __nsh_hv70 = element("text");
					bindProp(__nsh_hv70, "style", () => ({
						flex: 1,
						minWidth: 0,
						fontSize: 12,
						color: c.text()
					}));
					insert(__nsh_hv70, () => props.message);
					return __nsh_hv70;
				})(),
				component(Button, {
					label: "取消",
					get onPress() {
						return props.onCancel;
					},
					small: true
				}),
				component(Button, {
					get label() {
						return props.busy ? "执行中…" : props.confirmLabel;
					},
					tone: "danger",
					get onPress() {
						return props.onConfirm;
					},
					get disabled() {
						return props.busy;
					},
					small: true
				})
			];
		}
	});
}
/** 一行提示（操作结果/错误），`tone` 决定颜色。 */
function Notice(props) {
	return (() => {
		const __nsh_hv71 = element("text");
		bindProp(__nsh_hv71, "style", () => ({
			fontSize: 11.5,
			color: props.tone === void 0 ? c.muted() : toneColor(pick(props.tone))
		}));
		insert(__nsh_hv71, () => props.message);
		return __nsh_hv71;
	})();
}

//#endregion
//#region ../../../../packages/extension-kit/src/format.ts
/** 字节数 → `1.4 GB` 这类人读形式；非法输入给 `-`。 */
function humanBytes(bytes) {
	const value = Number(bytes);
	if (!Number.isFinite(value) || value < 0) return "-";
	const units = [
		"B",
		"KB",
		"MB",
		"GB",
		"TB",
		"PB"
	];
	let size = value;
	let unit = 0;
	while (size >= 1024 && unit < units.length - 1) {
		size /= 1024;
		unit += 1;
	}
	return unit === 0 ? `${size} ${units[unit]}` : `${size.toFixed(1)} ${units[unit]}`;
}
/** `2026-11-02T09:31:04Z` → `11-02 09:31`；解析不了就原样返回。 */
function shortTime(value) {
	if (typeof value !== "string" || value.length === 0) return "-";
	const date = new Date(value.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
	if (Number.isNaN(date.getTime())) return value;
	const two = (n) => String(n).padStart(2, "0");
	return `${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}
/** provider 抛出来的错误可能是 Error、字符串或 `{message}`；统一成一句话。 */
function errorMessage(error) {
	if (typeof error === "string") return error;
	if (error && typeof error === "object") {
		const message = error.message;
		if (typeof message === "string") return message;
	}
	return String(error);
}
/** 取对象上的字符串字段（provider 的 JSON 不保证形状）。 */
function str(source, key, fallback = "-") {
	if (!source || typeof source !== "object") return fallback;
	const value = source[key];
	if (typeof value === "string" && value.length > 0) return value;
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	if (typeof value === "boolean") return value ? "yes" : "no";
	return fallback;
}
/** 取数组字段；不是数组就是空数组。 */
function arr(source, key) {
	if (!source || typeof source !== "object") return [];
	const value = source[key];
	return Array.isArray(value) ? value : [];
}

//#endregion
//#region pages/messages/App.tsx
/** 实时流轮询间隔。 */
const POLL_MS = 1e3;
/** 单页条数（provider 允许 1..）。 */
const PAGE_SIZE = 200;
/** 一次刷新最多读几页：200 × 5 = 1000，正好是 provider 的缓冲容量。 */
const MAX_PAGES = 5;
/** 页面最多渲染多少行（时间倒序）。 */
const MAX_RENDER = 500;
/** 列表摘要截断长度。 */
const PREVIEW_CHARS$1 = 160;
/** 详情里允许尝试 JSON 解析的最大字符数。 */
const MAX_PARSE_CHARS$1 = 2e5;
/** 详情里最多渲染多少字符，避免一条 1 MiB 的消息把布局撑爆。 */
const MAX_RENDER_CHARS = 2e4;
const WINDOWS = [
	{
		key: "1m",
		label: "1 分钟",
		ms: 6e4
	},
	{
		key: "5m",
		label: "5 分钟",
		ms: 3e5
	},
	{
		key: "1h",
		label: "1 小时",
		ms: 36e5
	},
	{
		key: "all",
		label: "全部",
		ms: null
	}
];
/** operationId → provider 方法名。
*
* 清单里的 `resourceWorkbenches` 已经不参与运行，这一层映射留在页面里：
* 页面自己决定"要哪份数据"，宿主只负责把方法名和参数发给 provider。
*/
const OPERATIONS$4 = {
	listClients: "middleware/group/clients",
	listTopics: "middleware/topic/list",
	messageStream: "middleware/message/stream",
	metrics: "middleware/metrics",
	publish: "middleware/message/send",
	queryById: "middleware/message/query",
	queryByKey: "middleware/message/query",
	queryByWindow: "middleware/message/query",
	subscribe: "middleware/topic/create",
	unsubscribe: "middleware/topic/delete"
};
/** 调一次 provider 方法；把失败折成一句人话。`confirmed` 仅为兼容旧调用点。 */
async function dispatch$4(operationId, input, _confirmed) {
	const method = OPERATIONS$4[operationId];
	if (!method) throw new Error(`未知的操作：${operationId}`);
	try {
		return await invoke(method, input ?? {}, { timeout: SLOW_TIMEOUT_MS });
	} catch (error) {
		throw new Error(errorMessage(error));
	}
}
function pairsOf(raw) {
	const pairs = [];
	for (const pair of arr(raw, "properties")) if (Array.isArray(pair) && pair.length >= 2) pairs.push([String(pair[0]), String(pair[1])]);
	return pairs;
}
/** provider 的 JSON 形状不保证，统一折成页面用的消息对象。 */
function toMessage$1(raw) {
	if (raw === null || typeof raw !== "object") return null;
	const messageId = str(raw, "message_id", "");
	const topic = str(raw, "topic", "");
	if (messageId.length === 0 && topic.length === 0) return null;
	const bodyValue = raw.body;
	const body = Array.isArray(bodyValue) ? bodyValue.map((byte) => Number(byte) & 255) : null;
	return {
		message_id: messageId,
		topic,
		body_text: str(raw, "body_text", ""),
		body,
		properties: pairsOf(raw),
		store_time: str(raw, "store_time", "")
	};
}
function property$1(message, key) {
	for (const [name, value] of message.properties) if (name === key) return value;
	return "";
}
/** 接收时间优先用 properties.received_at_ms，退回 store_time（本地时间）。 */
function receivedAt(message) {
	const millis = Number(property$1(message, "received_at_ms"));
	if (Number.isFinite(millis) && millis > 0) return millis;
	const parsed = Date.parse(message.store_time.replace(" ", "T"));
	return Number.isNaN(parsed) ? 0 : parsed;
}
/** 合成 ID 形如 `mqtt-<seq>`；同一毫秒内用序号兜底排序。 */
function sequenceOf(messageId) {
	const index = messageId.lastIndexOf("-");
	const value = Number(index >= 0 ? messageId.slice(index + 1) : messageId);
	return Number.isFinite(value) ? value : 0;
}
function payloadSize(message) {
	const declared = Number(property$1(message, "payload_size"));
	if (Number.isFinite(declared) && declared >= 0) return declared;
	if (message.body !== null) return message.body.length;
	return Buffer.byteLength(payloadText(message), "utf8");
}
function payloadText(message) {
	if (message.body !== null && message.body.length > 0) return Buffer.from(message.body).toString("utf8");
	return message.body_text;
}
function previewOf(message) {
	const flat = payloadText(message).replace(/\s+/g, " ").trim();
	if (flat.length === 0) {
		const size = payloadSize(message);
		return size > 0 ? `〈二进制 ${humanBytes(size)}〉` : "（空消息体）";
	}
	return flat.length > PREVIEW_CHARS$1 ? `${flat.slice(0, PREVIEW_CHARS$1)}…` : flat;
}
function isRetained(message) {
	return property$1(message, "retain") === "true";
}
function qosOf$1(message) {
	const value = property$1(message, "qos");
	return value.length > 0 ? value : "?";
}
function directionOf(message) {
	return property$1(message, "direction") === "out" ? "发出" : "收到";
}
/** `11-02 23:14:25`，时间窗口精确到秒，shortTime 只到分钟不够用。 */
function clockOf$1(millis) {
	if (!Number.isFinite(millis) || millis <= 0) return "-";
	const date = new Date(millis);
	const two = (value) => String(value).padStart(2, "0");
	return `${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}
/** MQTT 通配符匹配：`+` 一层，`#` 末尾多层。 */
function topicMatches$2(filter, topic) {
	const parts = filter.split("/");
	const actual = topic.split("/");
	for (let index = 0; index < parts.length; index += 1) {
		const part = parts[index];
		if (part === "#") return true;
		if (index >= actual.length) return false;
		if (part !== "+" && part !== actual[index]) return false;
	}
	return parts.length === actual.length;
}
/** 输入不含通配符时按子串过滤；含 +/# 时按 MQTT 过滤器匹配。 */
function matchesFilter(needle, topic) {
	const filter = needle.trim();
	if (filter.length === 0 || filter === "#") return true;
	if (filter.includes("+") || filter.includes("#")) return topicMatches$2(filter, topic);
	return topic.toLowerCase().includes(filter.toLowerCase());
}
/** 详情正文的展示形态：能解析就格式化，不能就退回原文。 */
function jsonViewOf(message) {
	const raw = payloadText(message);
	if (raw.trim().length === 0) return {
		kind: "empty",
		text: "",
		error: "",
		truncated: false,
		sourceLength: 0
	};
	const clipped = raw.length > MAX_PARSE_CHARS$1 ? raw.slice(0, MAX_PARSE_CHARS$1) : raw;
	let text = clipped;
	let kind = "invalid";
	let error = "";
	try {
		text = JSON.stringify(JSON.parse(clipped), null, 2);
		kind = "json";
	} catch (failure) {
		error = errorMessage(failure);
	}
	const truncated = text.length > MAX_RENDER_CHARS;
	return {
		kind,
		text: truncated ? `${text.slice(0, MAX_RENDER_CHARS)}\n…` : text,
		error,
		truncated,
		sourceLength: raw.length
	};
}
function metaRows(message) {
	return [
		["消息 ID", message.message_id.length > 0 ? message.message_id : "-"],
		["接收时间", clockOf$1(receivedAt(message))],
		["QoS", qosOf$1(message)],
		["Retained", isRetained(message) ? "是" : "否"],
		["方向", directionOf(message)],
		["Payload 大小", humanBytes(payloadSize(message))],
		["Topic", message.topic],
		["store_time", message.store_time.length > 0 ? message.store_time : "-"]
	];
}
function Messages() {
	const windowKey = signal("5m");
	const filterText = signal("");
	const paused = signal(false);
	const fetched = signal([]);
	const total = signal(0);
	const loading = signal(true);
	const error = signal(null);
	const liveError = signal(null);
	const selectedId = signal(null);
	const detail = signal(null);
	const detailLoading = signal(false);
	const detailError = signal(null);
	const viewMode = signal("json");
	let inFlight = false;
	function currentWindow() {
		return WINDOWS.find((entry) => entry.key === windowKey()) ?? WINDOWS[1];
	}
	function winLabel() {
		return currentWindow().label;
	}
	function filteredRows() {
		const needle = filterText();
		const rows = fetched();
		if (needle.trim().length === 0) return rows;
		return rows.filter((message) => matchesFilter(needle, message.topic));
	}
	function visibleRows() {
		return filteredRows().slice(0, MAX_RENDER);
	}
	async function refresh(initial) {
		if (inFlight) return;
		inFlight = true;
		if (initial) loading.set(true);
		try {
			const win = currentWindow();
			const end = Date.now();
			const begin = win.ms === null ? 0 : Math.max(0, end - win.ms);
			const collected = [];
			let declaredTotal = 0;
			for (let page = 1; page <= MAX_PAGES; page += 1) {
				const result = await dispatch$4("queryByWindow", { ByTimeWindow: {
					topic: "#",
					begin_unix_ms: begin,
					end_unix_ms: end,
					page,
					page_size: PAGE_SIZE
				} });
				const pageObject = result;
				const rows = arr(result, "messages").map(toMessage$1).filter((message) => message !== null);
				collected.push(...rows);
				if (page === 1) {
					const value = Number(pageObject?.total);
					declaredTotal = Number.isFinite(value) && value > 0 ? value : 0;
				}
				if (pageObject?.has_more !== true || rows.length === 0) break;
			}
			const seen = /* @__PURE__ */ new Set();
			const unique = collected.filter((message) => {
				if (message.message_id.length === 0 || seen.has(message.message_id)) return false;
				seen.add(message.message_id);
				return true;
			});
			unique.sort((left, right) => receivedAt(right) - receivedAt(left) || sequenceOf(right.message_id) - sequenceOf(left.message_id));
			fetched.set(unique);
			total.set(declaredTotal > 0 ? declaredTotal : unique.length);
			error.set(null);
			liveError.set(null);
		} catch (failure) {
			const message = errorMessage(failure);
			if (fetched().length === 0) error.set(message);
			else liveError.set(message);
		} finally {
			loading.set(false);
			inFlight = false;
		}
	}
	async function select(message, force = false) {
		if (!force && selectedId() === message.message_id) return;
		const id = message.message_id;
		selectedId.set(id);
		detail.set(null);
		detailError.set(null);
		detailLoading.set(true);
		try {
			const result = await dispatch$4("queryById", { ById: {
				topic: message.topic,
				message_id: id
			} });
			if (selectedId() !== id) return;
			const full = arr(result, "messages").map(toMessage$1).find((row) => row !== null && row.message_id === id);
			if (full === void 0) {
				detailError.set("这条消息已不在 provider 缓冲里（默认只保留最近 1000 条）。");
				return;
			}
			detail.set(full);
		} catch (failure) {
			if (selectedId() === id) detailError.set(errorMessage(failure));
		} finally {
			if (selectedId() === id) detailLoading.set(false);
		}
	}
	function chooseWindow(key) {
		if (windowKey() === key) return;
		windowKey.set(key);
		selectedId.set(null);
		detail.set(null);
		detailError.set(null);
		refresh(true);
	}
	const timer = setInterval(() => {
		if (paused() || inFlight) return;
		refresh(false);
	}, POLL_MS);
	cleanup(() => clearInterval(timer));
	refresh(true);
	function headerRow() {
		return component(Row, {
			gap: 8,
			get style() {
				return {
					paddingHorizontal: 14,
					paddingVertical: 10,
					borderBottomWidth: 1,
					borderBottomColor: c.line()
				};
			},
			get children() {
				return [
					(() => {
						const __nsh_hv0 = element("text");
						bindProp(__nsh_hv0, "style", () => t.h1);
						const __nsh_hv1 = text("消息");
						append(__nsh_hv0, __nsh_hv1);
						return __nsh_hv0;
					})(),
					component(Badge, { get text() {
						return `${total()} 条`;
					} }),
					(() => {
						const __nsh_hv2 = element("view");
						prop(__nsh_hv2, "style", {
							flex: 1,
							minWidth: 8
						});
						return __nsh_hv2;
					})(),
					component(Row, {
						gap: 4,
						get children() {
							return WINDOWS.map((entry) => windowKey() === entry.key ? component(Button, {
								get label() {
									return entry.label;
								},
								small: true,
								tone: "primary",
								onPress: () => chooseWindow(entry.key)
							}) : component(Button, {
								get label() {
									return entry.label;
								},
								small: true,
								onPress: () => chooseWindow(entry.key)
							}));
						}
					}),
					() => paused() ? component(Button, {
						label: "继续",
						small: true,
						onPress: () => paused.set(false)
					}) : component(Button, {
						label: "暂停",
						small: true,
						onPress: () => paused.set(true)
					}),
					component(Button, {
						label: "刷新",
						small: true,
						onPress: () => void refresh(false)
					})
				];
			}
		});
	}
	function statusRow() {
		return component(Row, {
			gap: 8,
			get style() {
				return {
					paddingHorizontal: 14,
					paddingVertical: 8,
					borderBottomWidth: 1,
					borderBottomColor: c.line()
				};
			},
			get children() {
				return [
					(() => {
						const __nsh_hv3 = element("view");
						bindProp(__nsh_hv3, "style", () => ({
							height: 28,
							width: 300,
							flexShrink: 0,
							borderWidth: 1,
							borderColor: c.line(),
							borderRadius: r.control,
							backgroundColor: c.bg(),
							paddingHorizontal: 8,
							display: "flex",
							flexDirection: "row",
							alignItems: "center"
						}));
						const __nsh_hv4 = element("input");
						bindProp(__nsh_hv4, "value", () => filterText());
						prop(__nsh_hv4, "onChange", (text) => filterText.set(text));
						prop(__nsh_hv4, "placeholder", "按 topic 过滤（子串，或 + / # 通配符）");
						bindProp(__nsh_hv4, "style", () => ({
							flex: 1,
							fontSize: 12,
							paddingHorizontal: 0,
							borderWidth: 0,
							backgroundColor: "transparent",
							color: c.text()
						}));
						append(__nsh_hv3, __nsh_hv4);
						return __nsh_hv3;
					})(),
					(() => {
						const __nsh_hv5 = element("text");
						bindProp(__nsh_hv5, "style", () => t.meta);
						insert(__nsh_hv5, () => `窗口：${winLabel()} · 过滤后 ${filteredRows().length} 条 · 渲染最近 ${visibleRows().length} 条`);
						return __nsh_hv5;
					})(),
					(() => {
						const __nsh_hv6 = element("view");
						prop(__nsh_hv6, "style", {
							flex: 1,
							minWidth: 8
						});
						return __nsh_hv6;
					})(),
					() => paused() ? component(Badge, {
						text: "已暂停",
						tone: "warn"
					}) : component(Badge, {
						text: "实时轮询",
						tone: "ok"
					}),
					() => liveError() === null ? null : component(Notice, {
						get message() {
							return `轮询失败：${liveError() ?? ""}`;
						},
						tone: "danger"
					})
				];
			}
		});
	}
	function tableRows() {
		return (() => {
			const __nsh_hv7 = element("scroll");
			prop(__nsh_hv7, "style", {
				flex: 1,
				minHeight: 0
			});
			const __nsh_hv8 = element("view");
			prop(__nsh_hv8, "style", {
				display: "flex",
				flexDirection: "column"
			});
			insert(__nsh_hv8, each(() => visibleRows(), (message) => (() => {
				const __nsh_hv9 = element("view");
				prop(__nsh_hv9, "onPress", () => void select(message()));
				bindProp(__nsh_hv9, "style", () => ({
					backgroundColor: selectedId() === message().message_id ? c.hover() : "transparent",
					borderBottomWidth: 1,
					borderBottomColor: c.line()
				}));
				insert(__nsh_hv9, component(Row, {
					gap: 8,
					style: {
						paddingVertical: 7,
						paddingHorizontal: 10
					},
					get children() {
						return [
							(() => {
								const __nsh_hv10 = element("text");
								bindProp(__nsh_hv10, "style", () => ({
									...t.mono,
									width: 102,
									color: c.muted()
								}));
								insert(__nsh_hv10, () => clockOf$1(receivedAt(message())));
								return __nsh_hv10;
							})(),
							(() => {
								const __nsh_hv11 = element("text");
								prop(__nsh_hv11, "numberOfLines", 1);
								bindProp(__nsh_hv11, "style", () => ({
									...t.mono,
									flex: 1,
									minWidth: 0,
									color: c.text()
								}));
								insert(__nsh_hv11, () => message().topic);
								return __nsh_hv11;
							})(),
							(() => {
								const __nsh_hv12 = element("text");
								bindProp(__nsh_hv12, "style", () => ({
									...t.meta,
									width: 26,
									textAlign: "center"
								}));
								insert(__nsh_hv12, () => qosOf$1(message()));
								return __nsh_hv12;
							})(),
							(() => {
								const __nsh_hv13 = element("text");
								bindProp(__nsh_hv13, "style", () => ({
									...t.meta,
									width: 30,
									textAlign: "center",
									color: isRetained(message()) ? c.accent() : c.muted()
								}));
								insert(__nsh_hv13, () => isRetained(message()) ? "R" : "–");
								return __nsh_hv13;
							})(),
							(() => {
								const __nsh_hv14 = element("text");
								prop(__nsh_hv14, "numberOfLines", 1);
								bindProp(__nsh_hv14, "style", () => ({
									...t.meta,
									flex: 1.1,
									minWidth: 0,
									color: c.muted()
								}));
								insert(__nsh_hv14, () => previewOf(message()));
								return __nsh_hv14;
							})()
						];
					}
				}));
				return __nsh_hv9;
			})(), (message) => message.message_id));
			append(__nsh_hv7, __nsh_hv8);
			return __nsh_hv7;
		})();
	}
	function tablePane() {
		return (() => {
			const __nsh_hv15 = element("view");
			prop(__nsh_hv15, "style", {
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "column"
			});
			insert(__nsh_hv15, [
				component(Row, {
					gap: 8,
					get style() {
						return {
							paddingHorizontal: 10,
							paddingVertical: 6,
							borderBottomWidth: 1,
							borderBottomColor: c.line()
						};
					},
					get children() {
						return [
							(() => {
								const __nsh_hv16 = element("text");
								bindProp(__nsh_hv16, "style", () => ({
									...t.label,
									width: 102
								}));
								const __nsh_hv17 = text("时间");
								append(__nsh_hv16, __nsh_hv17);
								return __nsh_hv16;
							})(),
							(() => {
								const __nsh_hv18 = element("text");
								bindProp(__nsh_hv18, "style", () => ({
									...t.label,
									flex: 1,
									minWidth: 0
								}));
								const __nsh_hv19 = text("topic");
								append(__nsh_hv18, __nsh_hv19);
								return __nsh_hv18;
							})(),
							(() => {
								const __nsh_hv20 = element("text");
								bindProp(__nsh_hv20, "style", () => ({
									...t.label,
									width: 26,
									textAlign: "center"
								}));
								const __nsh_hv21 = text("QoS");
								append(__nsh_hv20, __nsh_hv21);
								return __nsh_hv20;
							})(),
							(() => {
								const __nsh_hv22 = element("text");
								bindProp(__nsh_hv22, "style", () => ({
									...t.label,
									width: 30,
									textAlign: "center"
								}));
								const __nsh_hv23 = text("保留");
								append(__nsh_hv22, __nsh_hv23);
								return __nsh_hv22;
							})(),
							(() => {
								const __nsh_hv24 = element("text");
								bindProp(__nsh_hv24, "style", () => ({
									...t.label,
									flex: 1.1,
									minWidth: 0
								}));
								const __nsh_hv25 = text("payload 摘要");
								append(__nsh_hv24, __nsh_hv25);
								return __nsh_hv24;
							})()
						];
					}
				}),
				cond(() => visibleRows().length === 0, () => component(Empty, {
					title: "没有匹配的消息",
					get hint() {
						return fetched().length === 0 ? "这个时间窗口里 provider 缓冲是空的；等有消息进来，或换更大的窗口。" : "当前 topic 过滤没有命中；清空过滤或换一个模式（子串 / + / #）。";
					}
				}), () => tableRows()),
				component(Row, {
					gap: 8,
					get style() {
						return {
							paddingHorizontal: 10,
							paddingVertical: 6,
							borderTopWidth: 1,
							borderTopColor: c.line()
						};
					},
					get children() {
						return [
							(() => {
								const __nsh_hv26 = element("text");
								bindProp(__nsh_hv26, "style", () => t.meta);
								insert(__nsh_hv26, () => `窗口内共 ${total()} 条 · 最多渲染 ${MAX_RENDER} 条`);
								return __nsh_hv26;
							})(),
							(() => {
								const __nsh_hv27 = element("view");
								prop(__nsh_hv27, "style", { flex: 1 });
								return __nsh_hv27;
							})(),
							(() => {
								const __nsh_hv28 = element("text");
								bindProp(__nsh_hv28, "style", () => t.meta);
								const __nsh_hv29 = text("provider 缓冲上限 1000 条");
								append(__nsh_hv28, __nsh_hv29);
								return __nsh_hv28;
							})()
						];
					}
				})
			]);
			return __nsh_hv15;
		})();
	}
	function payloadBlock(message) {
		const view = jsonViewOf(message);
		const raw = payloadText(message);
		const rawView = raw.length > MAX_RENDER_CHARS ? `${raw.slice(0, MAX_RENDER_CHARS)}\n…` : raw;
		const text = viewMode() === "json" && view.kind === "json" ? view.text : rawView;
		return (() => {
			const __nsh_hv30 = element("view");
			prop(__nsh_hv30, "style", {
				display: "flex",
				flexDirection: "column",
				gap: 8
			});
			const __nsh_hv31 = element("view");
			bindProp(__nsh_hv31, "style", () => ({
				borderWidth: 1,
				borderColor: c.line(),
				borderRadius: r.control,
				backgroundColor: c.bg(),
				padding: 10
			}));
			const __nsh_hv32 = element("text");
			prop(__nsh_hv32, "selectable", true);
			bindProp(__nsh_hv32, "style", () => ({
				...t.mono,
				fontSize: 12,
				lineHeight: 18,
				color: c.text()
			}));
			insert(__nsh_hv32, () => text.length > 0 ? text : "（空消息体）");
			append(__nsh_hv31, __nsh_hv32);
			append(__nsh_hv30, __nsh_hv31);
			insert(__nsh_hv30, () => viewMode() === "json" ? view.kind === "json" ? component(Notice, {
				message: "JSON 合法，已格式化显示。",
				tone: "ok"
			}) : view.kind === "invalid" ? component(Notice, {
				get message() {
					return `JSON 解析失败，已退回原文：${view.error}`;
				},
				tone: "warn"
			}) : component(Notice, { message: "payload 为空。" }) : null, __nsh_hv31);
			insert(__nsh_hv30, () => view.truncated || raw.length > MAX_RENDER_CHARS ? (() => {
				const __nsh_hv33 = element("text");
				bindProp(__nsh_hv33, "style", () => t.meta);
				insert(__nsh_hv33, () => `仅显示前 ${MAX_RENDER_CHARS} 字符（原文 ${raw.length} 字符 / ${payloadSize(message)}）。`);
				return __nsh_hv33;
			})() : null);
			return __nsh_hv30;
		})();
	}
	function detailPane() {
		if (detailLoading()) return component(Loading, { label: "正在读取消息体…" });
		if (detailError() !== null) {
			const row = fetched().find((message) => message.message_id === selectedId());
			return component(Stack, {
				padding: 14,
				gap: 10,
				get children() {
					return [component(Notice, {
						get message() {
							return detailError() ?? "";
						},
						tone: "danger"
					}), () => row === void 0 ? null : component(Row, { get children() {
						return component(Button, {
							label: "重新读取",
							small: true,
							onPress: () => void select(row, true)
						});
					} })];
				}
			});
		}
		const message = detail();
		if (message === null) return component(Empty, {
			title: "选择一条消息",
			hint: "点击左侧任意消息，查看完整 payload、元数据与格式化 JSON。"
		});
		return component(Stack, {
			scroll: true,
			padding: 14,
			gap: 12,
			get children() {
				return [
					component(Row, {
						gap: 8,
						style: {
							justifyContent: "space-between",
							alignItems: "flex-start"
						},
						get children() {
							return [(() => {
								const __nsh_hv34 = element("view");
								prop(__nsh_hv34, "style", {
									display: "flex",
									flexDirection: "column",
									gap: 3,
									flex: 1,
									minWidth: 0
								});
								const __nsh_hv35 = element("text");
								prop(__nsh_hv35, "numberOfLines", 3);
								bindProp(__nsh_hv35, "style", () => ({
									...t.mono,
									fontSize: 13,
									color: c.text()
								}));
								insert(__nsh_hv35, () => message.topic);
								const __nsh_hv36 = element("text");
								bindProp(__nsh_hv36, "style", () => t.meta);
								insert(__nsh_hv36, () => `${clockOf$1(receivedAt(message))} · ${directionOf(message)} · QoS ${qosOf$1(message)}`);
								append(__nsh_hv34, __nsh_hv35);
								append(__nsh_hv34, __nsh_hv36);
								return __nsh_hv34;
							})(), () => isRetained(message) ? component(Badge, {
								text: "retained",
								tone: "warn"
							}) : null];
						}
					}),
					component(Card, {
						title: "元数据",
						hint: "ID / 时间 / QoS / retained / topic",
						get children() {
							return component(KeyValue, {
								get rows() {
									return metaRows(message);
								},
								columns: 2
							});
						}
					}),
					component(Card, {
						title: "Payload",
						get hint() {
							return `${humanBytes(payloadSize(message))} · ${payloadText(message).length} 字符（UTF-8 解码）`;
						},
						get right() {
							return component(Row, {
								gap: 4,
								get children() {
									return [() => viewMode() === "json" ? component(Button, {
										label: "格式化 JSON",
										small: true,
										tone: "primary",
										onPress: () => viewMode.set("json")
									}) : component(Button, {
										label: "格式化 JSON",
										small: true,
										onPress: () => viewMode.set("json")
									}), () => viewMode() === "raw" ? component(Button, {
										label: "原文",
										small: true,
										tone: "primary",
										onPress: () => viewMode.set("raw")
									}) : component(Button, {
										label: "原文",
										small: true,
										onPress: () => viewMode.set("raw")
									})];
								}
							});
						},
						get children() {
							return payloadBlock(message);
						}
					})
				];
			}
		});
	}
	return (() => {
		const __nsh_hv37 = element("view");
		bindProp(__nsh_hv37, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		insert(__nsh_hv37, [
			() => headerRow(),
			() => statusRow(),
			cond(() => loading() && fetched().length === 0, () => component(Loading, { label: "正在读取消息…" })),
			cond(() => !loading() && error() !== null && fetched().length === 0, () => component(LoadError, {
				get message() {
					return error() ?? "";
				},
				onRetry: () => void refresh(true)
			})),
			cond(() => !loading() && error() === null && fetched().length === 0, () => component(Empty, {
				title: "这个时间窗口没有消息",
				hint: "provider 只保留最近 1000 条；换一个窗口，或等新消息进来后刷新。"
			})),
			cond(() => fetched().length > 0, () => component(SplitPane, {
				width: 560,
				get left() {
					return tablePane();
				},
				get right() {
					return detailPane();
				}
			}))
		]);
		return __nsh_hv37;
	})();
}

//#endregion
//#region pages/overview/App.tsx
/** 采样间隔：provider 只给累计值，速率只能靠两次采样的差值算。 */
const REFRESH_MS = 2e3;
/** operationId → provider 方法名。
*
* 清单里的 `resourceWorkbenches` 已经不参与运行，这一层映射留在页面里：
* 页面自己决定"要哪份数据"，宿主只负责把方法名和参数发给 provider。
*/
const OPERATIONS$3 = {
	listClients: "middleware/group/clients",
	listTopics: "middleware/topic/list",
	messageStream: "middleware/message/stream",
	metrics: "middleware/metrics",
	publish: "middleware/message/send",
	queryById: "middleware/message/query",
	queryByKey: "middleware/message/query",
	queryByWindow: "middleware/message/query",
	subscribe: "middleware/topic/create",
	unsubscribe: "middleware/topic/delete"
};
/** `middleware/group/clients` 的 `group` 是标准契约里的必填入参，但 MQTT 没有
* 订阅组这个概念（能力位 `groups=false`、`clients=true`）：provider 里的
* `group_clients(_group)` 忽略该值、返回本地连接自身。这里必须显式给一个非空值，
* 否则 provider 会以 -32602 拒绝（重写前的工作台声明里同样是写死 `"local"`）。 */
const LOCAL_GROUP = "local";
/** 调一次 provider 方法；把失败折成一句人话。`confirmed` 仅为兼容旧调用点。 */
async function dispatch$3(operationId, input, _confirmed) {
	const method = OPERATIONS$3[operationId];
	if (!method) throw new Error(`未知的操作：${operationId}`);
	try {
		return await invoke(method, input ?? {}, { timeout: SLOW_TIMEOUT_MS });
	} catch (error) {
		throw new Error(errorMessage(error));
	}
}
function last(items) {
	return items.length === 0 ? void 0 : items[items.length - 1];
}
function numberField(source, key) {
	if (!source || typeof source !== "object") return 0;
	const value = Number(source[key]);
	return Number.isFinite(value) ? value : 0;
}
/** provider 的 `extras` 是 `[键, 值]` 字符串对；缺键按 0。 */
function extra(metrics, key) {
	for (const pair of arr(metrics, "extras")) if (Array.isArray(pair) && String(pair[0]) === key) {
		const value = Number(pair[1]);
		return Number.isFinite(value) ? value : 0;
	}
	return 0;
}
/** 千分位；nsh 不保证 Intl，自己按三位分组。 */
function count(value) {
	return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function duration(milliseconds) {
	const total = Math.max(0, Math.floor(milliseconds / 1e3));
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor(total % 3600 / 60);
	const seconds = total % 60;
	if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
	return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
/** 本地时间 HH:MM:SS：不依赖 Intl，避免测试/英文环境下出现 AM/PM。 */
function clockText() {
	const now = /* @__PURE__ */ new Date();
	const pad = (value) => String(value).padStart(2, "0");
	return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}
function rateText(value) {
	return value === void 0 ? "—" : `${value.toFixed(1)} /s`;
}
/** 条形刻度数量：用「格子」画条形，格子颜色在 JSX 绑定里读信号，刷新就会跟着变。 */
const BAR_TICKS = [
	0,
	1,
	2,
	3,
	4,
	5,
	6,
	7,
	8,
	9,
	10,
	11,
	12,
	13,
	14,
	15,
	16,
	17,
	18,
	19,
	20,
	21,
	22,
	23,
	24,
	25,
	26,
	27,
	28,
	29,
	30,
	31
];
/**
* 速率条形：`ratio` 与 `caption` 都是访问器。
*
* 设计系统里的 `Meter` 在组件体里一次性读 `ratio` 算宽度，挂载后不会再变，
* 所以这里用格子自己画——每个格子的颜色在 map 的绑定里重新读一次比例。
*/
function RateBar(props) {
	return component(Row, {
		gap: 10,
		get children() {
			return [
				(() => {
					const __nsh_hv0 = element("text");
					bindProp(__nsh_hv0, "style", () => ({
						...t.label,
						width: 28
					}));
					insert(__nsh_hv0, () => props.label);
					return __nsh_hv0;
				})(),
				(() => {
					const __nsh_hv1 = element("view");
					prop(__nsh_hv1, "style", {
						flex: 1,
						minWidth: 0,
						display: "flex",
						flexDirection: "row",
						gap: 2
					});
					insert(__nsh_hv1, () => BAR_TICKS.map((tick) => (() => {
						const __nsh_hv2 = element("view");
						bindProp(__nsh_hv2, "style", () => ({
							flex: 1,
							height: 8,
							borderRadius: 2,
							backgroundColor: tick < Math.round(props.ratio() * BAR_TICKS.length) ? props.color : c.hover()
						}));
						return __nsh_hv2;
					})()));
					return __nsh_hv1;
				})(),
				(() => {
					const __nsh_hv3 = element("text");
					bindProp(__nsh_hv3, "style", () => ({
						...t.mono,
						width: 76,
						textAlign: "right"
					}));
					insert(__nsh_hv3, () => props.caption());
					return __nsh_hv3;
				})()
			];
		}
	});
}
function Overview() {
	const metrics = signal(null);
	const client = signal(null);
	const loading = signal(true);
	const error = signal(null);
	const auto = signal(true);
	const samples = signal([]);
	const rates = signal([]);
	const updatedAt = signal("");
	const now = signal(Date.now());
	const startedAt = Date.now();
	let inFlight = false;
	async function load() {
		if (inFlight) return;
		inFlight = true;
		loading.set(true);
		try {
			const [metricsResult, clientsResult] = await Promise.all([dispatch$3("metrics"), dispatch$3("listClients", { group: LOCAL_GROUP })]);
			const next = metricsResult?.metrics ?? metricsResult ?? {};
			const clients = Array.isArray(clientsResult) ? clientsResult : arr(clientsResult, "clients");
			const head = clients.length > 0 ? clients[0] : null;
			const first = head && typeof head === "object" ? head : null;
			const sample = {
				at: Date.now(),
				received: extra(next, "received_total"),
				sent: extra(next, "sent_total")
			};
			const previous = last(samples());
			if (previous !== void 0) {
				const seconds = (sample.at - previous.at) / 1e3;
				if (seconds > 0) {
					const inbound = Math.max(0, (sample.received - previous.received) / seconds);
					const outbound = Math.max(0, (sample.sent - previous.sent) / seconds);
					rates.set([...rates(), {
						inbound,
						outbound
					}].slice(-14));
				}
			}
			samples.set([...samples(), sample].slice(-14));
			metrics.set(next);
			client.set(first);
			error.set(null);
			updatedAt.set(clockText());
		} catch (failure) {
			error.set(errorMessage(failure));
		} finally {
			loading.set(false);
			inFlight = false;
		}
	}
	load();
	const timer = setInterval(() => {
		now.set(Date.now());
		if (auto()) load();
	}, REFRESH_MS);
	cleanup(() => clearInterval(timer));
	const m = () => metrics() ?? {};
	const conn = () => client();
	const received = () => extra(m(), "received_total");
	const sent = () => extra(m(), "sent_total");
	const today = () => numberField(m(), "message_count_today");
	const filters = () => arr(conn(), "subscriptions").map(String);
	const connected = () => error() === null;
	const latest = () => last(rates());
	const peak = () => Math.max(1, ...rates().map((rate) => Math.max(rate.inbound, rate.outbound)));
	const rateValue = (direction) => {
		const current = latest();
		if (current === void 0) return void 0;
		return direction === "in" ? current.inbound : current.outbound;
	};
	const ratioOf = (direction) => {
		const value = rateValue(direction);
		return value === void 0 ? 0 : value / peak();
	};
	const root = {
		flex: 1,
		minHeight: 0,
		display: "flex",
		flexDirection: "column",
		backgroundColor: c.bg()
	};
	/** 数据到手后的正文；只在 `<If>` 的 else 分支里构造一次。 */
	function body() {
		return (() => {
			const __nsh_hv4 = element("view");
			prop(__nsh_hv4, "style", {
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "column"
			});
			insert(__nsh_hv4, [
				component(Row, {
					gap: 10,
					wrap: true,
					get style() {
						return {
							paddingHorizontal: 16,
							paddingVertical: 12,
							borderBottomWidth: 1,
							borderBottomColor: c.line(),
							justifyContent: "space-between"
						};
					},
					get children() {
						return [component(Row, {
							gap: 10,
							wrap: true,
							get children() {
								return [
									(() => {
										const __nsh_hv5 = element("text");
										bindProp(__nsh_hv5, "style", () => t.h1);
										const __nsh_hv6 = text("MQTT 连接");
										append(__nsh_hv5, __nsh_hv6);
										return __nsh_hv5;
									})(),
									cond(() => connected(), () => component(Badge, {
										text: "已连接",
										tone: "ok"
									}), () => component(Badge, {
										text: "连接中断",
										tone: "danger"
									})),
									component(Row, {
										gap: 4,
										get children() {
											return [(() => {
												const __nsh_hv7 = element("text");
												bindProp(__nsh_hv7, "style", () => t.label);
												const __nsh_hv8 = text("Broker");
												append(__nsh_hv7, __nsh_hv8);
												return __nsh_hv7;
											})(), (() => {
												const __nsh_hv9 = element("text");
												prop(__nsh_hv9, "numberOfLines", 1);
												bindProp(__nsh_hv9, "style", () => t.mono);
												insert(__nsh_hv9, () => str(conn(), "client_addr", "provider 未返回"));
												return __nsh_hv9;
											})()];
										}
									}),
									component(Row, {
										gap: 4,
										get children() {
											return [(() => {
												const __nsh_hv10 = element("text");
												bindProp(__nsh_hv10, "style", () => t.label);
												const __nsh_hv11 = text("协议");
												append(__nsh_hv10, __nsh_hv11);
												return __nsh_hv10;
											})(), (() => {
												const __nsh_hv12 = element("text");
												bindProp(__nsh_hv12, "style", () => t.mono);
												insert(__nsh_hv12, () => str(conn(), "version", "MQTT 3.1.1"));
												return __nsh_hv12;
											})()];
										}
									}),
									component(Row, {
										gap: 4,
										get children() {
											return [(() => {
												const __nsh_hv13 = element("text");
												bindProp(__nsh_hv13, "style", () => t.label);
												const __nsh_hv14 = text("客户端");
												append(__nsh_hv13, __nsh_hv14);
												return __nsh_hv13;
											})(), (() => {
												const __nsh_hv15 = element("text");
												prop(__nsh_hv15, "numberOfLines", 1);
												bindProp(__nsh_hv15, "style", () => t.mono);
												insert(__nsh_hv15, () => str(conn(), "client_id", "-"));
												return __nsh_hv15;
											})()];
										}
									})
								];
							}
						}), component(Row, {
							gap: 6,
							get children() {
								return [
									(() => {
										const __nsh_hv16 = element("text");
										bindProp(__nsh_hv16, "style", () => t.meta);
										insert(__nsh_hv16, () => updatedAt() === "" ? "尚未刷新" : `${updatedAt()} 更新`);
										return __nsh_hv16;
									})(),
									component(Button, {
										get label() {
											return auto() ? "自动刷新：开" : "自动刷新：关";
										},
										small: true,
										onPress: () => auto.set(!auto())
									}),
									component(Button, {
										get label() {
											return loading() ? "刷新中…" : "刷新";
										},
										small: true,
										onPress: () => void load()
									})
								];
							}
						})];
					}
				}),
				cond(() => error() !== null, () => component(Row, {
					gap: 8,
					style: {
						paddingHorizontal: 16,
						paddingTop: 10
					},
					get children() {
						return [component(Notice, {
							get message() {
								return `刷新失败：${error() ?? ""}`;
							},
							tone: "danger"
						}), component(Button, {
							label: "重试",
							small: true,
							onPress: () => void load()
						})];
					}
				})),
				component(Stack, {
					scroll: true,
					padding: 16,
					gap: 14,
					get children() {
						return [
							component(Row, {
								gap: 12,
								wrap: true,
								get children() {
									return [
										component(Stat, {
											label: "累计接收",
											get value() {
												return count(received());
											},
											get hint() {
												return `今日 ${count(today())} 条`;
											},
											tone: "ok"
										}),
										component(Stat, {
											label: "累计发送",
											get value() {
												return count(sent());
											},
											hint: "本连接发布的消息",
											tone: "info"
										}),
										component(Stat, {
											label: "订阅数",
											get value() {
												return count(numberField(m(), "topic_count"));
											},
											hint: "当前活跃的订阅过滤器"
										}),
										component(Stat, {
											label: "连接时长",
											get value() {
												return duration(now() - startedAt);
											},
											hint: "页面挂载起计时（provider 未暴露建立时间）"
										})
									];
								}
							}),
							component(Card, {
								title: "速率快照",
								hint: `每 ${REFRESH_MS / 1e3} 秒采样一次累计计数，取两次差值`,
								get children() {
									return (() => {
										const __nsh_hv17 = element("view");
										prop(__nsh_hv17, "style", {
											display: "flex",
											flexDirection: "column",
											gap: 12
										});
										const __nsh_hv18 = element("view");
										prop(__nsh_hv18, "style", {
											display: "flex",
											flexDirection: "column",
											gap: 6
										});
										insert(__nsh_hv18, [component(Row, {
											gap: 12,
											wrap: true,
											get children() {
												return [(() => {
													const __nsh_hv19 = element("text");
													bindProp(__nsh_hv19, "style", () => t.meta);
													insert(__nsh_hv19, () => latest() === void 0 ? "等待第二次采样：首次进页面只有累计值，还没有差值" : `最近 ${rates().length} 次采样，峰值 ${peak().toFixed(1)} /s`);
													return __nsh_hv19;
												})(), component(Row, {
													gap: 4,
													get children() {
														return [
															(() => {
																const __nsh_hv20 = element("view");
																bindProp(__nsh_hv20, "style", () => ({
																	width: 8,
																	height: 8,
																	borderRadius: 2,
																	backgroundColor: c.chart(1)
																}));
																return __nsh_hv20;
															})(),
															(() => {
																const __nsh_hv21 = element("text");
																bindProp(__nsh_hv21, "style", () => t.meta);
																const __nsh_hv22 = text("接收");
																append(__nsh_hv21, __nsh_hv22);
																return __nsh_hv21;
															})(),
															(() => {
																const __nsh_hv23 = element("view");
																bindProp(__nsh_hv23, "style", () => ({
																	width: 8,
																	height: 8,
																	borderRadius: 2,
																	backgroundColor: c.chart(0)
																}));
																return __nsh_hv23;
															})(),
															(() => {
																const __nsh_hv24 = element("text");
																bindProp(__nsh_hv24, "style", () => t.meta);
																const __nsh_hv25 = text("发送");
																append(__nsh_hv24, __nsh_hv25);
																return __nsh_hv24;
															})()
														];
													}
												})];
											}
										}), component(Row, {
											gap: 3,
											align: "flex-end",
											style: { height: 40 },
											get children() {
												return rates().map((sample) => component(Row, {
													gap: 1,
													align: "flex-end",
													get children() {
														return [(() => {
															const __nsh_hv26 = element("view");
															bindProp(__nsh_hv26, "style", () => ({
																width: 4,
																height: Math.max(2, Math.round(sample.inbound / peak() * 38)),
																borderRadius: 1,
																backgroundColor: c.chart(1)
															}));
															return __nsh_hv26;
														})(), (() => {
															const __nsh_hv27 = element("view");
															bindProp(__nsh_hv27, "style", () => ({
																width: 4,
																height: Math.max(2, Math.round(sample.outbound / peak() * 38)),
																borderRadius: 1,
																backgroundColor: c.chart(0)
															}));
															return __nsh_hv27;
														})()];
													}
												}));
											}
										})]);
										append(__nsh_hv17, __nsh_hv18);
										insert(__nsh_hv17, [component(RateBar, {
											label: "接收",
											ratio: () => ratioOf("in"),
											caption: () => rateText(rateValue("in")),
											get color() {
												return c.chart(1);
											}
										}), component(RateBar, {
											label: "发送",
											ratio: () => ratioOf("out"),
											caption: () => rateText(rateValue("out")),
											get color() {
												return c.chart(0);
											}
										})], __nsh_hv18);
										return __nsh_hv17;
									})();
								}
							}),
							component(Card, {
								title: "连接信息",
								hint: "metrics / listClients 的原样字段",
								get children() {
									return component(KeyValue, {
										columns: 2,
										get rows() {
											return [
												["客户端 ID", str(conn(), "client_id", "-")],
												["协议版本", str(conn(), "version", "-")],
												["客户端语言", str(conn(), "language", "-")],
												["客户端地址", str(conn(), "client_addr", "provider 未返回")],
												["连接数", count(numberField(m(), "connection_count"))],
												["订阅过滤器", `${filters().length} 个`],
												["今日接收", `${count(today())} 条`],
												["本地缓冲", `${count(extra(m(), "buffered_messages"))} / ${count(extra(m(), "buffer_capacity"))}`],
												["累计接收", `${count(received())} 条`],
												["累计发送", `${count(sent())} 条`]
											];
										}
									});
								}
							}),
							component(Card, {
								get title() {
									return `订阅过滤器（${filters().length}）`;
								},
								hint: "订阅后由 provider 回写，点「刷新」可重取",
								get children() {
									return cond(() => filters().length === 0, () => (() => {
										const __nsh_hv30 = element("view");
										prop(__nsh_hv30, "style", {
											display: "flex",
											flexDirection: "column",
											minHeight: 96
										});
										insert(__nsh_hv30, component(Empty, {
											title: "没有订阅过滤器",
											hint: "去「订阅」页添加，或在连接配置里把自动订阅设为 #。"
										}));
										return __nsh_hv30;
									})(), () => (() => {
										const __nsh_hv28 = element("view");
										prop(__nsh_hv28, "style", {
											display: "flex",
											flexDirection: "column",
											gap: 3
										});
										insert(__nsh_hv28, () => filters().map((filter) => (() => {
											const __nsh_hv29 = element("text");
											prop(__nsh_hv29, "numberOfLines", 1);
											bindProp(__nsh_hv29, "style", () => t.mono);
											insert(__nsh_hv29, filter);
											return __nsh_hv29;
										})()));
										return __nsh_hv28;
									})());
								}
							}),
							(() => {
								const __nsh_hv31 = element("text");
								bindProp(__nsh_hv31, "style", () => t.meta);
								const __nsh_hv32 = text("数据来自 MQTT provider 的 middleware/metrics 与 middleware/group/clients；自动刷新只重取这两条， 关掉后点「刷新」手动取。");
								append(__nsh_hv31, __nsh_hv32);
								return __nsh_hv31;
							})()
						];
					}
				})
			]);
			return __nsh_hv4;
		})();
	}
	return (() => {
		const __nsh_hv33 = element("view");
		prop(__nsh_hv33, "style", root);
		insert(__nsh_hv33, cond(() => metrics() === null, () => cond(() => error() !== null, () => component(LoadError, {
			get message() {
				return error() ?? "";
			},
			onRetry: () => void load()
		}), () => component(Loading, { label: "正在读取 MQTT 连接指标…" })), () => body()));
		return __nsh_hv33;
	})();
}

//#endregion
//#region pages/publish/App.tsx
const QOS_OPTIONS$1 = [
	0,
	1,
	2
];
const HISTORY_LIMIT = 20;
const MAX_PARSE_CHARS = 2e5;
const MAX_PREVIEW_CHARS = 4e3;
/** operationId → provider 方法名。
*
* 清单里的 `resourceWorkbenches` 已经不参与运行，这一层映射留在页面里：
* 页面自己决定"要哪份数据"，宿主只负责把方法名和参数发给 provider。
*/
const OPERATIONS$2 = {
	listClients: "middleware/group/clients",
	listTopics: "middleware/topic/list",
	messageStream: "middleware/message/stream",
	metrics: "middleware/metrics",
	publish: "middleware/message/send",
	queryById: "middleware/message/query",
	queryByKey: "middleware/message/query",
	queryByWindow: "middleware/message/query",
	subscribe: "middleware/topic/create",
	unsubscribe: "middleware/topic/delete"
};
/** 调一次 provider 方法；把失败折成一句人话。`confirmed` 仅为兼容旧调用点。 */
async function dispatch$2(operationId, input, _confirmed) {
	const method = OPERATIONS$2[operationId];
	if (!method) throw new Error(`未知的操作：${operationId}`);
	try {
		return await invoke(method, input ?? {}, { timeout: SLOW_TIMEOUT_MS });
	} catch (error) {
		throw new Error(errorMessage(error));
	}
}
/** 只做提示用的 JSON 校验；非法时返回解析器的原始错误。 */
function jsonInfo(text) {
	if (text.trim().length === 0) return { kind: "empty" };
	if (text.length > MAX_PARSE_CHARS) return {
		kind: "large",
		length: text.length
	};
	try {
		const pretty = JSON.stringify(JSON.parse(text), null, 2);
		return {
			kind: "json",
			pretty: pretty.length > MAX_PREVIEW_CHARS ? `${pretty.slice(0, MAX_PREVIEW_CHARS)}\n…` : pretty,
			truncated: pretty.length > MAX_PREVIEW_CHARS
		};
	} catch (failure) {
		return {
			kind: "invalid",
			error: errorMessage(failure)
		};
	}
}
function topicProblem(topic) {
	const value = topic.trim();
	if (value.length === 0) return "topic 不能为空。";
	if (value.includes("+") || value.includes("#")) return "发布主题不能包含 + 或 #；通配符只用于订阅。";
	return null;
}
function clockOf(millis) {
	const date = new Date(millis);
	const two = (value) => String(value).padStart(2, "0");
	return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}
function Publish() {
	const topic = signal("");
	const payloadText = signal("");
	const qos = signal(1);
	const retain = signal(false);
	const sending = signal(false);
	const result = signal(null);
	const history = signal([]);
	let historySeq = 0;
	async function send() {
		if (sending()) return;
		const value = topic().trim();
		const problem = topicProblem(value);
		if (problem !== null) {
			result.set({
				ok: false,
				text: problem
			});
			return;
		}
		const text = payloadText();
		const bytes = Array.from(Buffer.from(text, "utf8"));
		sending.set(true);
		result.set(null);
		try {
			const response = await dispatch$2("publish", {
				topic: value,
				body: bytes,
				properties: [["qos", String(qos())], ["retain", retain() ? "true" : "false"]]
			}, true);
			const messageId = response !== null && typeof response === "object" ? String(response.message_id ?? "") : "";
			result.set({
				ok: true,
				text: `已发布到 ${value} · ${humanBytes(bytes.length)}${messageId.length > 0 ? ` · ${messageId}` : ""}`
			});
			historySeq += 1;
			const entry = {
				seq: historySeq,
				topic: value,
				text,
				qos: qos(),
				retain: retain(),
				at: Date.now()
			};
			history.set([entry, ...history().filter((item) => !(item.topic === entry.topic && item.text === entry.text && item.qos === entry.qos && item.retain === entry.retain))].slice(0, HISTORY_LIMIT));
		} catch (failure) {
			result.set({
				ok: false,
				text: errorMessage(failure)
			});
		} finally {
			sending.set(false);
		}
	}
	function refill(entry) {
		topic.set(entry.topic);
		payloadText.set(entry.text);
		qos.set(entry.qos);
		retain.set(entry.retain);
		result.set(null);
	}
	function headerRow() {
		return component(Row, {
			gap: 8,
			get style() {
				return {
					paddingHorizontal: 14,
					paddingVertical: 10,
					borderBottomWidth: 1,
					borderBottomColor: c.line()
				};
			},
			get children() {
				return [
					(() => {
						const __nsh_hv0 = element("text");
						bindProp(__nsh_hv0, "style", () => t.h1);
						const __nsh_hv1 = text("发布");
						append(__nsh_hv0, __nsh_hv1);
						return __nsh_hv0;
					})(),
					component(Badge, {
						text: "写操作需确认",
						tone: "warn"
					}),
					(() => {
						const __nsh_hv2 = element("view");
						prop(__nsh_hv2, "style", {
							flex: 1,
							minWidth: 8
						});
						return __nsh_hv2;
					})(),
					(() => {
						const __nsh_hv3 = element("text");
						bindProp(__nsh_hv3, "style", () => t.meta);
						insert(__nsh_hv3, () => `payload ${humanBytes(Buffer.byteLength(payloadText(), "utf8"))} · QoS ${qos()}${retain() ? " · retain" : ""}`);
						return __nsh_hv3;
					})()
				];
			}
		});
	}
	function jsonNotice() {
		const info = jsonInfo(payloadText());
		if (info.kind === "empty") return null;
		if (info.kind === "json") return component(Notice, {
			message: "JSON 合法，已生成格式化预览。",
			tone: "ok"
		});
		if (info.kind === "large") return component(Notice, {
			message: `内容超过 ${MAX_PARSE_CHARS} 字符，跳过 JSON 校验；仍按原文发送。`,
			tone: "warn"
		});
		return component(Notice, {
			get message() {
				return `JSON 解析失败：${info.error}。不会阻止发送，payload 将按原文 UTF-8 发送。`;
			},
			tone: "danger"
		});
	}
	function jsonPreview() {
		const info = jsonInfo(payloadText());
		if (info.kind !== "json") return null;
		return (() => {
			const __nsh_hv4 = element("view");
			bindProp(__nsh_hv4, "style", () => ({
				maxHeight: 180,
				borderWidth: 1,
				borderColor: c.line(),
				borderRadius: r.control,
				backgroundColor: c.bg(),
				padding: 8
			}));
			const __nsh_hv5 = element("scroll");
			prop(__nsh_hv5, "style", { maxHeight: 164 });
			const __nsh_hv6 = element("text");
			prop(__nsh_hv6, "selectable", true);
			bindProp(__nsh_hv6, "style", () => ({
				...t.mono,
				fontSize: 12,
				lineHeight: 17,
				color: c.text()
			}));
			insert(__nsh_hv6, () => info.pretty);
			append(__nsh_hv5, __nsh_hv6);
			append(__nsh_hv4, __nsh_hv5);
			insert(__nsh_hv4, () => info.truncated ? (() => {
				const __nsh_hv7 = element("text");
				bindProp(__nsh_hv7, "style", () => ({
					...t.meta,
					marginTop: 4
				}));
				insert(__nsh_hv7, `预览最多显示 ${MAX_PREVIEW_CHARS} 字符。`);
				return __nsh_hv7;
			})() : null);
			return __nsh_hv4;
		})();
	}
	function sendResult() {
		const value = result();
		if (value === null) return null;
		return component(Notice, {
			get message() {
				return value.text;
			},
			get tone() {
				return value.ok ? "ok" : "danger";
			}
		});
	}
	function sendButton() {
		const problem = topicProblem(topic());
		if (sending()) return component(Row, {
			gap: 8,
			get children() {
				return [component(Button, {
					label: "发送中…",
					small: true,
					disabled: true
				}), (() => {
					const __nsh_hv8 = element("text");
					bindProp(__nsh_hv8, "style", () => t.meta);
					const __nsh_hv9 = text("等待 provider 返回结果。");
					append(__nsh_hv8, __nsh_hv9);
					return __nsh_hv8;
				})()];
			}
		});
		if (problem !== null) return component(Row, {
			gap: 8,
			get children() {
				return [component(Button, {
					label: "发送",
					small: true,
					disabled: true
				}), (() => {
					const __nsh_hv10 = element("text");
					bindProp(__nsh_hv10, "style", () => ({
						...t.meta,
						color: c.danger()
					}));
					insert(__nsh_hv10, problem);
					return __nsh_hv10;
				})()];
			}
		});
		return component(Row, {
			gap: 8,
			get children() {
				return [component(Button, {
					label: "发送",
					small: true,
					tone: "primary",
					onPress: () => void send()
				}), (() => {
					const __nsh_hv11 = element("text");
					bindProp(__nsh_hv11, "style", () => t.meta);
					const __nsh_hv12 = text("会带二次确认；成功后写入本页发送历史。");
					append(__nsh_hv11, __nsh_hv12);
					return __nsh_hv11;
				})()];
			}
		});
	}
	function qosButtons() {
		return component(Row, {
			gap: 4,
			get children() {
				return QOS_OPTIONS$1.map((value) => qos() === value ? component(Button, {
					get label() {
						return String(value);
					},
					small: true,
					tone: "primary",
					onPress: () => qos.set(value)
				}) : component(Button, {
					get label() {
						return String(value);
					},
					small: true,
					onPress: () => qos.set(value)
				}));
			}
		});
	}
	function retainToggle() {
		return retain() ? component(Button, {
			label: "retain：开",
			small: true,
			tone: "primary",
			onPress: () => retain.set(false)
		}) : component(Button, {
			label: "retain：关",
			small: true,
			onPress: () => retain.set(true)
		});
	}
	function form() {
		return (() => {
			const __nsh_hv13 = element("view");
			prop(__nsh_hv13, "style", {
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "column"
			});
			const __nsh_hv14 = element("scroll");
			prop(__nsh_hv14, "style", {
				flex: 1,
				minHeight: 0
			});
			const __nsh_hv15 = element("view");
			prop(__nsh_hv15, "style", {
				padding: 14,
				display: "flex",
				flexDirection: "column",
				gap: 12
			});
			insert(__nsh_hv15, [
				component(Card, {
					title: "目标主题",
					hint: "发布到具体 topic；不支持 + / # 通配符",
					get children() {
						return (() => {
							const __nsh_hv16 = element("input");
							prop(__nsh_hv16, "testID", "topic-input");
							bindProp(__nsh_hv16, "value", () => topic());
							prop(__nsh_hv16, "onChange", (text) => topic.set(text));
							prop(__nsh_hv16, "placeholder", "例如 devices/kitchen/light/set");
							bindProp(__nsh_hv16, "style", () => ({
								width: "100%",
								height: 30,
								fontSize: 13,
								borderWidth: 1,
								borderColor: c.line(),
								borderRadius: r.control,
								backgroundColor: c.bg(),
								color: c.text(),
								paddingHorizontal: 8
							}));
							return __nsh_hv16;
						})();
					}
				}),
				component(Card, {
					title: "消息内容",
					hint: "按 UTF-8 编码为字节数组发送；多行文本原样保留",
					get right() {
						return (() => {
							const __nsh_hv17 = element("text");
							bindProp(__nsh_hv17, "style", () => t.meta);
							insert(__nsh_hv17, () => `${payloadText().length} 字符 · ${humanBytes(Buffer.byteLength(payloadText(), "utf8"))}`);
							return __nsh_hv17;
						})();
					},
					get children() {
						return (() => {
							const __nsh_hv18 = element("view");
							prop(__nsh_hv18, "style", {
								display: "flex",
								flexDirection: "column",
								gap: 8
							});
							const __nsh_hv19 = element("input");
							prop(__nsh_hv19, "testID", "payload-input");
							prop(__nsh_hv19, "multiline", true);
							bindProp(__nsh_hv19, "value", () => payloadText());
							prop(__nsh_hv19, "onChange", (text) => payloadText.set(text));
							prop(__nsh_hv19, "placeholder", "{\"temperature\": 23.5, \"unit\": \"C\"}");
							bindProp(__nsh_hv19, "style", () => ({
								width: "100%",
								minHeight: 180,
								height: 180,
								...t.mono,
								fontSize: 12,
								lineHeight: 18,
								borderWidth: 1,
								borderColor: c.line(),
								borderRadius: r.control,
								backgroundColor: c.bg(),
								color: c.text(),
								paddingHorizontal: 8,
								paddingVertical: 8
							}));
							append(__nsh_hv18, __nsh_hv19);
							insert(__nsh_hv18, [() => jsonNotice(), () => jsonPreview()]);
							return __nsh_hv18;
						})();
					}
				}),
				component(Card, {
					title: "发送选项",
					get children() {
						return (() => {
							const __nsh_hv20 = element("view");
							prop(__nsh_hv20, "style", {
								display: "flex",
								flexDirection: "column",
								gap: 10
							});
							insert(__nsh_hv20, [
								component(Row, {
									gap: 10,
									get children() {
										return [
											(() => {
												const __nsh_hv21 = element("text");
												bindProp(__nsh_hv21, "style", () => t.label);
												const __nsh_hv22 = text("QoS");
												append(__nsh_hv21, __nsh_hv22);
												return __nsh_hv21;
											})(),
											() => qosButtons(),
											(() => {
												const __nsh_hv23 = element("view");
												prop(__nsh_hv23, "style", { flex: 1 });
												return __nsh_hv23;
											})(),
											(() => {
												const __nsh_hv24 = element("text");
												bindProp(__nsh_hv24, "style", () => t.label);
												const __nsh_hv25 = text("Retain");
												append(__nsh_hv24, __nsh_hv25);
												return __nsh_hv24;
											})(),
											() => retainToggle()
										];
									}
								}),
								component(Row, {
									gap: 10,
									align: "center",
									wrap: true,
									get children() {
										return sendButton();
									}
								}),
								() => sendResult()
							]);
							return __nsh_hv20;
						})();
					}
				})
			]);
			append(__nsh_hv14, __nsh_hv15);
			append(__nsh_hv13, __nsh_hv14);
			return __nsh_hv13;
		})();
	}
	function historyPane() {
		return (() => {
			const __nsh_hv26 = element("view");
			bindProp(__nsh_hv26, "style", () => ({
				width: 320,
				flexShrink: 0,
				borderLeftWidth: 1,
				borderLeftColor: c.line(),
				display: "flex",
				flexDirection: "column",
				backgroundColor: c.panel()
			}));
			const __nsh_hv36 = element("scroll");
			prop(__nsh_hv36, "style", {
				flex: 1,
				minHeight: 0
			});
			const __nsh_hv37 = element("view");
			prop(__nsh_hv37, "style", {
				display: "flex",
				flexDirection: "column"
			});
			insert(__nsh_hv37, each(() => history(), (entry, index) => (() => {
				const __nsh_hv38 = element("view");
				bindProp(__nsh_hv38, "testID", () => `history-entry-${index()}`);
				prop(__nsh_hv38, "onPress", () => refill(entry()));
				bindProp(__nsh_hv38, "style", () => ({
					paddingHorizontal: 12,
					paddingVertical: 9,
					borderBottomWidth: 1,
					borderBottomColor: c.line()
				}));
				const __nsh_hv44 = element("text");
				prop(__nsh_hv44, "numberOfLines", 2);
				bindProp(__nsh_hv44, "style", () => ({
					...t.meta,
					marginTop: 4,
					color: c.muted()
				}));
				insert(__nsh_hv44, () => entry().text.length > 0 ? entry().text.replace(/\s+/g, " ").slice(0, 160) : "（空 payload）");
				append(__nsh_hv38, __nsh_hv44);
				insert(__nsh_hv38, [component(Row, {
					gap: 6,
					get children() {
						return [(() => {
							const __nsh_hv39 = element("text");
							prop(__nsh_hv39, "numberOfLines", 1);
							bindProp(__nsh_hv39, "style", () => ({
								...t.mono,
								flex: 1,
								minWidth: 0
							}));
							insert(__nsh_hv39, () => entry().topic);
							return __nsh_hv39;
						})(), (() => {
							const __nsh_hv40 = element("text");
							bindProp(__nsh_hv40, "style", () => t.meta);
							insert(__nsh_hv40, () => clockOf(entry().at));
							return __nsh_hv40;
						})()];
					}
				}), component(Row, {
					gap: 6,
					style: { marginTop: 3 },
					get children() {
						return [
							(() => {
								const __nsh_hv41 = element("text");
								bindProp(__nsh_hv41, "style", () => t.meta);
								const __nsh_hv42 = text("QoS ");
								append(__nsh_hv41, __nsh_hv42);
								insert(__nsh_hv41, () => entry().qos);
								return __nsh_hv41;
							})(),
							() => entry().retain ? component(Badge, {
								text: "retain",
								tone: "warn"
							}) : null,
							(() => {
								const __nsh_hv43 = element("text");
								bindProp(__nsh_hv43, "style", () => t.meta);
								insert(__nsh_hv43, () => humanBytes(Buffer.byteLength(entry().text, "utf8")));
								return __nsh_hv43;
							})()
						];
					}
				})], __nsh_hv44);
				return __nsh_hv38;
			})(), (entry) => String(entry.seq)));
			append(__nsh_hv36, __nsh_hv37);
			const __nsh_hv45 = element("view");
			bindProp(__nsh_hv45, "style", () => ({
				paddingHorizontal: 12,
				paddingVertical: 8,
				borderTopWidth: 1,
				borderTopColor: c.line()
			}));
			const __nsh_hv46 = element("text");
			bindProp(__nsh_hv46, "style", () => t.meta);
			const __nsh_hv47 = text("历史只保存在本页内存，不写入 provider，刷新页面即清空。");
			append(__nsh_hv46, __nsh_hv47);
			append(__nsh_hv45, __nsh_hv46);
			append(__nsh_hv26, __nsh_hv36);
			append(__nsh_hv26, __nsh_hv45);
			insert(__nsh_hv26, [component(Row, {
				gap: 6,
				get style() {
					return {
						paddingHorizontal: 12,
						paddingVertical: 10,
						borderBottomWidth: 1,
						borderBottomColor: c.line()
					};
				},
				get children() {
					return [
						(() => {
							const __nsh_hv27 = element("text");
							bindProp(__nsh_hv27, "style", () => t.h2);
							const __nsh_hv28 = text("发送历史");
							append(__nsh_hv27, __nsh_hv28);
							return __nsh_hv27;
						})(),
						component(Badge, { get text() {
							return `${history().length}/${HISTORY_LIMIT}`;
						} }),
						(() => {
							const __nsh_hv29 = element("view");
							prop(__nsh_hv29, "style", { flex: 1 });
							return __nsh_hv29;
						})(),
						(() => {
							const __nsh_hv30 = element("text");
							bindProp(__nsh_hv30, "style", () => t.meta);
							const __nsh_hv31 = text("点击回填");
							append(__nsh_hv30, __nsh_hv31);
							return __nsh_hv30;
						})()
					];
				}
			}), cond(() => history().length === 0, () => (() => {
				const __nsh_hv32 = element("view");
				prop(__nsh_hv32, "style", { padding: 14 });
				const __nsh_hv33 = element("text");
				bindProp(__nsh_hv33, "style", () => t.meta);
				const __nsh_hv34 = text("发送成功后，最近 ");
				const __nsh_hv35 = text(" 条会出现在这里；点击任意一条可回填主题、payload、QoS 与 retain。");
				append(__nsh_hv33, __nsh_hv34);
				append(__nsh_hv33, __nsh_hv35);
				insert(__nsh_hv33, HISTORY_LIMIT, __nsh_hv35);
				append(__nsh_hv32, __nsh_hv33);
				return __nsh_hv32;
			})())], __nsh_hv36);
			return __nsh_hv26;
		})();
	}
	return (() => {
		const __nsh_hv48 = element("view");
		bindProp(__nsh_hv48, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		insert(__nsh_hv48, [() => headerRow(), component(Row, {
			gap: 0,
			style: {
				flex: 1,
				minHeight: 0,
				alignItems: "stretch"
			},
			get children() {
				return [() => form(), () => historyPane()];
			}
		})]);
		return __nsh_hv48;
	})();
}

//#endregion
//#region pages/subscriptions/App.tsx
const QOS_OPTIONS = [
	0,
	1,
	2
];
const ACTIVE_WINDOW_MS = 3e5;
/** operationId → provider 方法名。
*
* 清单里的 `resourceWorkbenches` 已经不参与运行，这一层映射留在页面里：
* 页面自己决定"要哪份数据"，宿主只负责把方法名和参数发给 provider。
*/
const OPERATIONS$1 = {
	listClients: "middleware/group/clients",
	listTopics: "middleware/topic/list",
	messageStream: "middleware/message/stream",
	metrics: "middleware/metrics",
	publish: "middleware/message/send",
	queryById: "middleware/message/query",
	queryByKey: "middleware/message/query",
	queryByWindow: "middleware/message/query",
	subscribe: "middleware/topic/create",
	unsubscribe: "middleware/topic/delete"
};
/** 调一次 provider 方法；把失败折成一句人话。`confirmed` 仅为兼容旧调用点。 */
async function dispatch$1(operationId, input, _confirmed) {
	const method = OPERATIONS$1[operationId];
	if (!method) throw new Error(`未知的操作：${operationId}`);
	try {
		return await invoke(method, input ?? {}, { timeout: SLOW_TIMEOUT_MS });
	} catch (error) {
		throw new Error(errorMessage(error));
	}
}
function toSubscription(raw) {
	if (raw === null || typeof raw !== "object") return null;
	const name = str(raw, "name", "");
	if (name.length === 0) return null;
	const queue = Number(raw.queue_count);
	return {
		name,
		qos: queue === 0 || queue === 1 || queue === 2 ? queue : null,
		topicType: str(raw, "topic_type", ""),
		description: str(raw, "description", "")
	};
}
function isAutomatic(subscription) {
	return subscription.topicType === "AUTO_SUBSCRIPTION";
}
function toSnapshotMessage(raw) {
	const topic = str(raw, "topic", "");
	if (topic.length === 0) return null;
	let receivedAt = 0;
	for (const pair of arr(raw, "properties")) if (Array.isArray(pair) && pair[0] === "received_at_ms") receivedAt = Number(pair[1]);
	return {
		topic,
		receivedAt: Number.isFinite(receivedAt) ? receivedAt : 0
	};
}
/** MQTT 过滤器合法性：`#` 只能是最后一层且独占，`+` 必须独占一层。 */
function filterProblem(filter) {
	if (filter.trim().length === 0) return "topic 不能为空。";
	if (filter !== filter.trim()) return "topic 首尾不能有空格。";
	const levels = filter.split("/");
	for (let index = 0; index < levels.length; index += 1) {
		const level = levels[index];
		if (level.includes("#") && (level !== "#" || index !== levels.length - 1)) return "「#」只能作为最后一层单独出现。";
		if (level.includes("+") && level !== "+") return "「+」必须独占一层。";
	}
	return null;
}
function topicMatches$1(filter, topic) {
	const parts = filter.split("/");
	const actual = topic.split("/");
	for (let index = 0; index < parts.length; index += 1) {
		if (parts[index] === "#") return true;
		if (index >= actual.length) return false;
		if (parts[index] !== "+" && parts[index] !== actual[index]) return false;
	}
	return parts.length === actual.length;
}
function qosLabel$1(qos) {
	return qos === null ? "自定义" : String(qos);
}
function statusOf(recent) {
	if (recent === null) return {
		text: "未知",
		tone: "neutral"
	};
	if (recent > 0) return {
		text: "活跃",
		tone: "ok"
	};
	return {
		text: "空闲",
		tone: "neutral"
	};
}
function Subscriptions() {
	const subscriptions = signal([]);
	const snapshot = signal(null);
	const loading = signal(true);
	const refreshing = signal(false);
	const error = signal(null);
	const snapshotError = signal(null);
	const notice = signal(null);
	const filterText = signal("");
	const adding = signal(false);
	const newTopic = signal("");
	const newQos = signal(1);
	const addBusy = signal(false);
	const addError = signal(null);
	const pendingUnsub = signal(null);
	const unsubBusy = signal(null);
	function visible() {
		const needle = filterText().trim().toLowerCase();
		if (needle.length === 0) return subscriptions();
		return subscriptions().filter((subscription) => subscription.name.toLowerCase().includes(needle) || subscription.description.toLowerCase().includes(needle));
	}
	function countMatching(filter, withinMs) {
		const messages = snapshot();
		if (messages === null) return null;
		const boundary = withinMs === null ? 0 : Date.now() - withinMs;
		let count = 0;
		for (const message of messages) {
			if (message.receivedAt < boundary) continue;
			if (topicMatches$1(filter, message.topic)) count += 1;
		}
		return count;
	}
	async function load(initial) {
		if (refreshing()) return;
		refreshing.set(true);
		if (initial) loading.set(true);
		try {
			const result = await dispatch$1("listTopics");
			const rows = arr(result, "topics").map(toSubscription).filter((row) => row !== null);
			subscriptions.set(rows);
			error.set(null);
		} catch (failure) {
			if (subscriptions().length === 0) error.set(errorMessage(failure));
			else notice.set(`刷新订阅失败：${errorMessage(failure)}`);
			loading.set(false);
			refreshing.set(false);
			return;
		}
		try {
			const result = await dispatch$1("queryByWindow", { ByTimeWindow: {
				topic: "#",
				begin_unix_ms: 0,
				end_unix_ms: Date.now(),
				page: 1,
				page_size: 1e3
			} });
			const rows = arr(result, "messages").map(toSnapshotMessage).filter((row) => row !== null);
			snapshot.set(rows);
			snapshotError.set(null);
		} catch (failure) {
			snapshot.set(null);
			snapshotError.set(errorMessage(failure));
		} finally {
			loading.set(false);
			refreshing.set(false);
		}
	}
	async function submit() {
		if (addBusy()) return;
		const topic = newTopic().trim();
		const problem = filterProblem(topic);
		if (problem !== null) {
			addError.set(problem);
			return;
		}
		if (subscriptions().some((subscription) => subscription.name === topic)) {
			addError.set("这个 topic 已经在订阅列表里了。");
			return;
		}
		addBusy.set(true);
		addError.set(null);
		try {
			await dispatch$1("subscribe", {
				topic,
				qos: newQos()
			}, true);
			notice.set(`已订阅 ${topic}（QoS ${newQos()}）。`);
			newTopic.set("");
			adding.set(false);
			await load(false);
		} catch (failure) {
			addError.set(errorMessage(failure));
		} finally {
			addBusy.set(false);
		}
	}
	async function remove(subscription) {
		if (unsubBusy() !== null) return;
		unsubBusy.set(subscription.name);
		try {
			await dispatch$1("unsubscribe", { topic: subscription.name }, true);
			pendingUnsub.set(null);
			notice.set(`已取消订阅 ${subscription.name}。`);
			await load(false);
		} catch (failure) {
			notice.set(`取消订阅失败：${errorMessage(failure)}`);
		} finally {
			unsubBusy.set(null);
		}
	}
	load(true);
	function headerRow() {
		return component(Row, {
			gap: 8,
			get style() {
				return {
					paddingHorizontal: 14,
					paddingVertical: 10,
					borderBottomWidth: 1,
					borderBottomColor: c.line()
				};
			},
			get children() {
				return [
					(() => {
						const __nsh_hv0 = element("text");
						bindProp(__nsh_hv0, "style", () => t.h1);
						const __nsh_hv1 = text("订阅");
						append(__nsh_hv0, __nsh_hv1);
						return __nsh_hv0;
					})(),
					component(Badge, { get text() {
						return `${subscriptions().length} 个`;
					} }),
					(() => {
						const __nsh_hv2 = element("view");
						prop(__nsh_hv2, "style", {
							flex: 1,
							minWidth: 8
						});
						return __nsh_hv2;
					})(),
					(() => {
						const __nsh_hv3 = element("view");
						bindProp(__nsh_hv3, "style", () => ({
							height: 28,
							width: 260,
							borderWidth: 1,
							borderColor: c.line(),
							borderRadius: r.control,
							backgroundColor: c.bg(),
							paddingHorizontal: 8,
							display: "flex",
							flexDirection: "row",
							alignItems: "center"
						}));
						const __nsh_hv4 = element("input");
						bindProp(__nsh_hv4, "value", () => filterText());
						prop(__nsh_hv4, "onChange", (text) => filterText.set(text));
						prop(__nsh_hv4, "placeholder", "搜索订阅模式或说明");
						bindProp(__nsh_hv4, "style", () => ({
							flex: 1,
							fontSize: 12,
							paddingHorizontal: 0,
							borderWidth: 0,
							backgroundColor: "transparent",
							color: c.text()
						}));
						append(__nsh_hv3, __nsh_hv4);
						return __nsh_hv3;
					})(),
					() => refreshing() ? component(Button, {
						label: "刷新中…",
						small: true,
						disabled: true
					}) : component(Button, {
						label: "刷新",
						small: true,
						onPress: () => void load(false)
					}),
					() => adding() ? component(Button, {
						label: "收起表单",
						small: true,
						onPress: () => adding.set(false)
					}) : component(Button, {
						label: "新增订阅",
						small: true,
						tone: "primary",
						onPress: () => {
							addError.set(null);
							adding.set(true);
						}
					})
				];
			}
		});
	}
	function addForm() {
		return component(Card, {
			title: "新增订阅",
			hint: "topic 支持 MQTT 通配符：+ 一层，# 末尾多层",
			get children() {
				return (() => {
					const __nsh_hv5 = element("view");
					prop(__nsh_hv5, "style", {
						display: "flex",
						flexDirection: "column",
						gap: 10
					});
					insert(__nsh_hv5, [component(Row, {
						gap: 10,
						align: "center",
						get children() {
							return [
								(() => {
									const __nsh_hv6 = element("input");
									bindProp(__nsh_hv6, "value", () => newTopic());
									prop(__nsh_hv6, "onChange", (text) => newTopic.set(text));
									prop(__nsh_hv6, "onSubmit", () => void submit());
									prop(__nsh_hv6, "placeholder", "例如 sensor/+/temperature 或 devices/#");
									bindProp(__nsh_hv6, "style", () => ({
										flex: 1,
										minWidth: 0,
										height: 30,
										fontSize: 13,
										borderWidth: 1,
										borderColor: c.line(),
										borderRadius: r.control,
										backgroundColor: c.bg(),
										color: c.text(),
										paddingHorizontal: 8
									}));
									return __nsh_hv6;
								})(),
								(() => {
									const __nsh_hv7 = element("text");
									bindProp(__nsh_hv7, "style", () => t.label);
									const __nsh_hv8 = text("QoS");
									append(__nsh_hv7, __nsh_hv8);
									return __nsh_hv7;
								})(),
								component(Row, {
									gap: 4,
									get children() {
										return QOS_OPTIONS.map((qos) => newQos() === qos ? component(Button, {
											get label() {
												return String(qos);
											},
											small: true,
											tone: "primary",
											onPress: () => newQos.set(qos)
										}) : component(Button, {
											get label() {
												return String(qos);
											},
											small: true,
											onPress: () => newQos.set(qos)
										}));
									}
								}),
								() => addBusy() ? component(Button, {
									label: "订阅中…",
									small: true,
									disabled: true
								}) : component(Button, {
									label: "确认订阅",
									small: true,
									tone: "primary",
									onPress: () => void submit()
								})
							];
						}
					}), () => addError() === null ? (() => {
						const __nsh_hv9 = element("text");
						bindProp(__nsh_hv9, "style", () => t.meta);
						const __nsh_hv10 = text("订阅会先校验过滤器格式，写操作会带二次确认。");
						append(__nsh_hv9, __nsh_hv10);
						return __nsh_hv9;
					})() : component(Notice, {
						get message() {
							return addError() ?? "";
						},
						tone: "danger"
					})]);
					return __nsh_hv5;
				})();
			}
		});
	}
	function tableHeader() {
		return component(Row, {
			gap: 8,
			get style() {
				return {
					paddingHorizontal: 12,
					paddingVertical: 6,
					borderBottomWidth: 1,
					borderBottomColor: c.line()
				};
			},
			get children() {
				return [
					(() => {
						const __nsh_hv11 = element("text");
						bindProp(__nsh_hv11, "style", () => ({
							...t.label,
							flex: 1,
							minWidth: 0
						}));
						const __nsh_hv12 = text("订阅模式");
						append(__nsh_hv11, __nsh_hv12);
						return __nsh_hv11;
					})(),
					(() => {
						const __nsh_hv13 = element("text");
						bindProp(__nsh_hv13, "style", () => ({
							...t.label,
							width: 64,
							textAlign: "center"
						}));
						const __nsh_hv14 = text("QoS");
						append(__nsh_hv13, __nsh_hv14);
						return __nsh_hv13;
					})(),
					(() => {
						const __nsh_hv15 = element("text");
						bindProp(__nsh_hv15, "style", () => ({
							...t.label,
							width: 88,
							textAlign: "right"
						}));
						const __nsh_hv16 = text("缓冲内消息");
						append(__nsh_hv15, __nsh_hv16);
						return __nsh_hv15;
					})(),
					(() => {
						const __nsh_hv17 = element("text");
						bindProp(__nsh_hv17, "style", () => ({
							...t.label,
							width: 88,
							textAlign: "right"
						}));
						const __nsh_hv18 = text("近 5 分钟");
						append(__nsh_hv17, __nsh_hv18);
						return __nsh_hv17;
					})(),
					(() => {
						const __nsh_hv19 = element("text");
						bindProp(__nsh_hv19, "style", () => ({
							...t.label,
							width: 92,
							textAlign: "center"
						}));
						const __nsh_hv20 = text("状态");
						append(__nsh_hv19, __nsh_hv20);
						return __nsh_hv19;
					})(),
					(() => {
						const __nsh_hv21 = element("text");
						bindProp(__nsh_hv21, "style", () => ({
							...t.label,
							width: 120,
							textAlign: "right"
						}));
						const __nsh_hv22 = text("操作");
						append(__nsh_hv21, __nsh_hv22);
						return __nsh_hv21;
					})()
				];
			}
		});
	}
	function statusBadge(subscription) {
		if (isAutomatic(subscription)) return component(Badge, {
			text: "自动订阅",
			tone: "info"
		});
		const status = statusOf(countMatching(subscription.name, ACTIVE_WINDOW_MS));
		return component(Badge, {
			get text() {
				return status.text;
			},
			get tone() {
				return status.tone;
			}
		});
	}
	function countText(subscription, withinMs) {
		const count = countMatching(subscription.name, withinMs);
		return count === null ? "—" : String(count);
	}
	function unsubscribeCell(subscription) {
		if (isAutomatic(subscription)) return (() => {
			const __nsh_hv23 = element("text");
			bindProp(__nsh_hv23, "style", () => t.meta);
			const __nsh_hv24 = text("只读");
			append(__nsh_hv23, __nsh_hv24);
			return __nsh_hv23;
		})();
		if (pendingUnsub() === subscription.name) return (() => {
			const __nsh_hv25 = element("text");
			bindProp(__nsh_hv25, "style", () => t.meta);
			const __nsh_hv26 = text("待确认");
			append(__nsh_hv25, __nsh_hv26);
			return __nsh_hv25;
		})();
		return component(Button, {
			label: "取消订阅",
			small: true,
			tone: "danger",
			onPress: () => pendingUnsub.set(subscription.name)
		});
	}
	function subscriptionRow(subscription) {
		return (() => {
			const __nsh_hv27 = element("view");
			bindProp(__nsh_hv27, "style", () => ({
				borderBottomWidth: 1,
				borderBottomColor: c.line(),
				display: "flex",
				flexDirection: "column"
			}));
			insert(__nsh_hv27, [component(Row, {
				gap: 8,
				style: {
					paddingHorizontal: 12,
					paddingVertical: 9
				},
				get children() {
					return [
						(() => {
							const __nsh_hv28 = element("view");
							prop(__nsh_hv28, "style", {
								flex: 1,
								minWidth: 0,
								display: "flex",
								flexDirection: "column",
								gap: 2
							});
							const __nsh_hv29 = element("text");
							prop(__nsh_hv29, "numberOfLines", 1);
							bindProp(__nsh_hv29, "style", () => ({
								...t.mono,
								fontSize: 12.5,
								color: c.text()
							}));
							insert(__nsh_hv29, () => subscription.name);
							append(__nsh_hv28, __nsh_hv29);
							insert(__nsh_hv28, () => subscription.description.length === 0 ? null : (() => {
								const __nsh_hv30 = element("text");
								prop(__nsh_hv30, "numberOfLines", 1);
								bindProp(__nsh_hv30, "style", () => t.meta);
								insert(__nsh_hv30, () => subscription.description);
								return __nsh_hv30;
							})());
							return __nsh_hv28;
						})(),
						(() => {
							const __nsh_hv31 = element("text");
							bindProp(__nsh_hv31, "style", () => ({
								...t.meta,
								width: 64,
								textAlign: "center"
							}));
							insert(__nsh_hv31, () => qosLabel$1(subscription.qos));
							return __nsh_hv31;
						})(),
						(() => {
							const __nsh_hv32 = element("text");
							bindProp(__nsh_hv32, "style", () => ({
								...t.meta,
								width: 88,
								textAlign: "right"
							}));
							insert(__nsh_hv32, () => countText(subscription, null));
							return __nsh_hv32;
						})(),
						(() => {
							const __nsh_hv33 = element("text");
							bindProp(__nsh_hv33, "style", () => ({
								...t.meta,
								width: 88,
								textAlign: "right"
							}));
							insert(__nsh_hv33, () => countText(subscription, ACTIVE_WINDOW_MS));
							return __nsh_hv33;
						})(),
						(() => {
							const __nsh_hv34 = element("view");
							prop(__nsh_hv34, "style", {
								width: 92,
								alignItems: "center"
							});
							insert(__nsh_hv34, () => statusBadge(subscription));
							return __nsh_hv34;
						})(),
						(() => {
							const __nsh_hv35 = element("view");
							prop(__nsh_hv35, "style", {
								width: 120,
								alignItems: "flex-end"
							});
							insert(__nsh_hv35, () => unsubscribeCell(subscription));
							return __nsh_hv35;
						})()
					];
				}
			}), cond(() => pendingUnsub() === subscription.name, () => (() => {
				const __nsh_hv36 = element("view");
				prop(__nsh_hv36, "style", {
					paddingHorizontal: 12,
					paddingBottom: 9
				});
				insert(__nsh_hv36, () => unsubBusy() === subscription.name ? component(ConfirmBar, {
					get message() {
						return `取消订阅 ${subscription.name}？对应 queue 会一并删除，之后不再收到匹配消息。`;
					},
					confirmLabel: "确认取消",
					busy: true,
					onConfirm: () => void remove(subscription),
					onCancel: () => pendingUnsub.set(null)
				}) : component(ConfirmBar, {
					get message() {
						return `取消订阅 ${subscription.name}？对应 queue 会一并删除，之后不再收到匹配消息。`;
					},
					confirmLabel: "确认取消",
					onConfirm: () => void remove(subscription),
					onCancel: () => pendingUnsub.set(null)
				}));
				return __nsh_hv36;
			})())]);
			return __nsh_hv27;
		})();
	}
	function table() {
		return (() => {
			const __nsh_hv37 = element("view");
			prop(__nsh_hv37, "style", {
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "column"
			});
			const __nsh_hv38 = element("scroll");
			prop(__nsh_hv38, "style", {
				flex: 1,
				minHeight: 0
			});
			const __nsh_hv39 = element("view");
			prop(__nsh_hv39, "style", {
				display: "flex",
				flexDirection: "column"
			});
			insert(__nsh_hv39, each(() => visible(), (subscription) => subscriptionRow(subscription()), (subscription) => subscription.name));
			append(__nsh_hv38, __nsh_hv39);
			append(__nsh_hv37, __nsh_hv38);
			insert(__nsh_hv37, () => tableHeader(), __nsh_hv38);
			insert(__nsh_hv37, component(Row, {
				gap: 8,
				get style() {
					return {
						paddingHorizontal: 12,
						paddingVertical: 6,
						borderTopWidth: 1,
						borderTopColor: c.line()
					};
				},
				get children() {
					return [
						(() => {
							const __nsh_hv40 = element("text");
							bindProp(__nsh_hv40, "style", () => t.meta);
							insert(__nsh_hv40, () => snapshot() === null ? "消息数：本地缓冲不可用" : `消息数基于 provider 本地缓冲（上限 1000 条），统计到 ${snapshot()?.length ?? 0} 条`);
							return __nsh_hv40;
						})(),
						(() => {
							const __nsh_hv41 = element("view");
							prop(__nsh_hv41, "style", { flex: 1 });
							return __nsh_hv41;
						})(),
						(() => {
							const __nsh_hv42 = element("text");
							bindProp(__nsh_hv42, "style", () => t.meta);
							const __nsh_hv43 = text("自动订阅由连接配置维护，不能在这里取消");
							append(__nsh_hv42, __nsh_hv43);
							return __nsh_hv42;
						})()
					];
				}
			}));
			return __nsh_hv37;
		})();
	}
	return (() => {
		const __nsh_hv44 = element("view");
		bindProp(__nsh_hv44, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		insert(__nsh_hv44, [
			() => headerRow(),
			cond(() => notice() !== null, () => (() => {
				const __nsh_hv45 = element("view");
				prop(__nsh_hv45, "style", {
					paddingHorizontal: 14,
					paddingTop: 8
				});
				insert(__nsh_hv45, component(Notice, {
					get message() {
						return notice() ?? "";
					},
					tone: "ok"
				}));
				return __nsh_hv45;
			})()),
			cond(() => snapshotError() !== null, () => (() => {
				const __nsh_hv46 = element("view");
				prop(__nsh_hv46, "style", {
					paddingHorizontal: 14,
					paddingTop: 8
				});
				insert(__nsh_hv46, component(Notice, {
					get message() {
						return `消息统计不可用：${snapshotError() ?? ""}`;
					},
					tone: "warn"
				}));
				return __nsh_hv46;
			})()),
			cond(() => adding(), () => (() => {
				const __nsh_hv47 = element("view");
				prop(__nsh_hv47, "style", {
					paddingHorizontal: 14,
					paddingTop: 10
				});
				insert(__nsh_hv47, () => addForm());
				return __nsh_hv47;
			})()),
			cond(() => loading() && subscriptions().length === 0, () => component(Loading, { label: "正在读取订阅…" })),
			cond(() => !loading() && error() !== null && subscriptions().length === 0, () => component(LoadError, {
				get message() {
					return error() ?? "";
				},
				onRetry: () => void load(true)
			})),
			cond(() => !loading() && error() === null && subscriptions().length === 0, () => component(Empty, {
				title: "还没有订阅",
				hint: "点右上角「新增订阅」创建第一条；连接配置里的自动订阅也会出现在这里。"
			})),
			cond(() => subscriptions().length > 0 && visible().length === 0, () => component(Empty, {
				title: "没有匹配的订阅",
				hint: "换个搜索词，或清空搜索框。"
			})),
			cond(() => visible().length > 0, () => () => table()),
			cond(() => subscriptions().length > 0 && visible().length > 0 && error() !== null, () => (() => {
				const __nsh_hv48 = element("view");
				prop(__nsh_hv48, "style", {
					paddingHorizontal: 14,
					paddingBottom: 8
				});
				insert(__nsh_hv48, component(Notice, {
					get message() {
						return `订阅列表可能不是最新：${error() ?? ""}`;
					},
					tone: "warn"
				}));
				return __nsh_hv48;
			})())
		]);
		return __nsh_hv44;
	})();
}

//#endregion
//#region pages/topics/App.tsx
/** 本地环形缓冲的容量，一次读满就够数了（admin.rs: MQTT_ADMIN_BUFFER_CAPACITY）。 */
const SNAPSHOT_LIMIT = 1e3;
/** 右侧每个过滤器最多展示多少条最近消息。 */
const DETAIL_ROWS = 20;
/** 消息正文预览截断长度。 */
const PREVIEW_CHARS = 200;
/** operationId → provider 方法名。
*
* 清单里的 `resourceWorkbenches` 已经不参与运行，这一层映射留在页面里：
* 页面自己决定"要哪份数据"，宿主只负责把方法名和参数发给 provider。
*/
const OPERATIONS = {
	listClients: "middleware/group/clients",
	listTopics: "middleware/topic/list",
	messageStream: "middleware/message/stream",
	metrics: "middleware/metrics",
	publish: "middleware/message/send",
	queryById: "middleware/message/query",
	queryByKey: "middleware/message/query",
	queryByWindow: "middleware/message/query",
	subscribe: "middleware/topic/create",
	unsubscribe: "middleware/topic/delete"
};
/** 调一次 provider 方法；把失败折成一句人话。`confirmed` 仅为兼容旧调用点。 */
async function dispatch(operationId, input, _confirmed) {
	const method = OPERATIONS[operationId];
	if (!method) throw new Error(`未知的操作：${operationId}`);
	try {
		return await invoke(method, input ?? {}, { timeout: SLOW_TIMEOUT_MS });
	} catch (error) {
		throw new Error(errorMessage(error));
	}
}
/** MQTT 主题匹配：`+` 恰好一段，`#` 匹配剩余所有层级。 */
function topicMatches(filter, topic) {
	const pattern = filter.split("/");
	const parts = topic.split("/");
	for (let index = 0; index < pattern.length; index += 1) {
		const token = pattern[index];
		if (token === "#") return true;
		if (index >= parts.length) return false;
		if (token === "+") continue;
		if (token !== parts[index]) return false;
	}
	return pattern.length === parts.length;
}
/** provider 把消息属性放在 `[键, 值]` 字符串对里。 */
function property(message, key) {
	for (const pair of arr(message, "properties")) if (Array.isArray(pair) && String(pair[0]) === key) return String(pair[1]);
	return "";
}
/** 把 `queryByWindow` 的一条摘要消息折成页面需要的形状；空主题丢弃。 */
function toMessage(raw) {
	const topic = str(raw, "topic", "");
	if (topic.length === 0) return null;
	const at = Number(property(raw, "received_at_ms"));
	const text = str(raw, "body_text", "").replace(/\s+/g, " ").trim();
	return {
		topic,
		qos: property(raw, "qos") || "?",
		retain: property(raw, "retain") === "true",
		at: Number.isFinite(at) ? at : 0,
		preview: text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text
	};
}
function qosOf(topic) {
	if (!topic || typeof topic !== "object") return null;
	const raw = topic.queue_count;
	if (raw === null || raw === void 0) return null;
	const value = Number(raw);
	return Number.isFinite(value) ? value : null;
}
function qosLabel(topic) {
	const value = qosOf(topic);
	return value === null ? "—" : String(value);
}
function isAuto(topic) {
	return str(topic, "topic_type", "") === "AUTO_SUBSCRIPTION";
}
function lastSegment(name) {
	const parts = name.split("/");
	return parts[parts.length - 1];
}
/** 层级缩进：按 `/` 分段数算深度，太深的主题不再继续右移。 */
function depthOf(name) {
	return Math.min(8, Math.max(0, name.split("/").length - 1));
}
function Topics() {
	const topics = signal([]);
	const buckets = signal(/* @__PURE__ */ new Map());
	const loading = signal(true);
	const firstLoad = signal(true);
	const error = signal(null);
	const snapshotError = signal(null);
	const notice = signal(null);
	const noticeError = signal(false);
	const busy = signal(false);
	const filterText = signal("");
	const selected = signal(null);
	const formOpen = signal(false);
	const draftTopic = signal("");
	const draftQos = signal(1);
	const pendingUnsub = signal(null);
	let inFlight = false;
	async function load() {
		if (inFlight) return;
		inFlight = true;
		loading.set(true);
		let snapshotFailed = false;
		try {
			const [topicsResult, snapshot] = await Promise.all([dispatch("listTopics"), dispatch("queryByWindow", { ByTimeWindow: {
				topic: "#",
				begin_unix_ms: 0,
				end_unix_ms: Date.now(),
				page: 1,
				page_size: SNAPSHOT_LIMIT
			} }).catch(() => {
				snapshotFailed = true;
				return null;
			})]);
			const rows = (Array.isArray(topicsResult) ? topicsResult : arr(topicsResult, "topics")).filter((item) => {
				if (!item || typeof item !== "object") return false;
				return str(item, "name", "").length > 0;
			});
			const messages = arr(snapshot, "messages").map(toMessage).filter((message) => message !== null).sort((left, right) => right.at - left.at);
			const byFilter = /* @__PURE__ */ new Map();
			for (const topic of rows) {
				const name = str(topic, "name", "");
				const bucket = {
					count: 0,
					latest: []
				};
				for (const message of messages) {
					if (!topicMatches(name, message.topic)) continue;
					bucket.count += 1;
					if (bucket.latest.length < DETAIL_ROWS) bucket.latest.push(message);
				}
				byFilter.set(name, bucket);
			}
			topics.set(rows);
			buckets.set(byFilter);
			snapshotError.set(snapshotFailed ? "本地消息缓冲快照读取失败，消息计数暂不可用。" : null);
			error.set(null);
			const current = selected();
			if (!(current !== null && rows.some((topic) => str(topic, "name", "") === current))) {
				const first = rows.length > 0 ? str(rows[0], "name", "") : "";
				selected.set(first.length > 0 ? first : null);
				pendingUnsub.set(null);
			}
		} catch (failure) {
			error.set(errorMessage(failure));
		} finally {
			loading.set(false);
			firstLoad.set(false);
			inFlight = false;
		}
	}
	load();
	const visibleTopics = () => {
		const needle = filterText().trim().toLowerCase();
		const list = topics();
		if (needle.length === 0) return list;
		return list.filter((topic) => str(topic, "name", "").toLowerCase().includes(needle));
	};
	const selectedTopic = () => topics().find((topic) => str(topic, "name", "") === selected()) ?? null;
	const bucketOf = (name) => buckets().get(name);
	const countLabel = (name) => {
		if (snapshotError() !== null) return "—";
		const bucket = bucketOf(name);
		return bucket === void 0 ? "0 条" : `${bucket.count} 条`;
	};
	function toggleSelect(name) {
		selected.set(name);
		pendingUnsub.set(null);
		notice.set(null);
	}
	async function subscribe() {
		if (busy()) return;
		const pattern = draftTopic().trim();
		const qos = draftQos();
		if (pattern.length === 0) {
			noticeError.set(true);
			notice.set("先填一个主题过滤器再订阅。");
			return;
		}
		busy.set(true);
		try {
			await dispatch("subscribe", {
				topic: pattern,
				qos
			}, true);
			noticeError.set(false);
			notice.set(`已订阅 ${pattern}（QoS ${qos}）`);
			draftTopic.set("");
			await load();
		} catch (failure) {
			noticeError.set(true);
			notice.set(`订阅失败：${errorMessage(failure)}`);
		} finally {
			busy.set(false);
		}
	}
	async function unsubscribe() {
		if (busy()) return;
		const name = pendingUnsub();
		if (name === null) return;
		busy.set(true);
		try {
			await dispatch("unsubscribe", { topic: name }, true);
			noticeError.set(false);
			notice.set(`已取消订阅 ${name}`);
			pendingUnsub.set(null);
			await load();
		} catch (failure) {
			noticeError.set(true);
			notice.set(`取消失败：${errorMessage(failure)}`);
		} finally {
			busy.set(false);
		}
	}
	const root = {
		flex: 1,
		minHeight: 0,
		display: "flex",
		flexDirection: "column",
		backgroundColor: c.bg()
	};
	/** 右侧详情：选中过滤器的参数 + 本地缓冲里的最近消息。 */
	function detailPane() {
		const name = selected();
		if (name === null) return component(Empty, {
			title: "选择左侧的主题",
			hint: "右侧显示该过滤器的 QoS、订阅类型，以及本地缓冲里匹配到的最近消息。"
		});
		const topic = selectedTopic();
		const auto = isAuto(topic);
		const bucket = bucketOf(name);
		const latest = bucket === void 0 ? [] : bucket.latest;
		return component(Stack, {
			scroll: true,
			padding: 14,
			gap: 12,
			get children() {
				return [
					component(Row, {
						gap: 8,
						wrap: true,
						style: { justifyContent: "space-between" },
						get children() {
							return [
								component(Row, {
									gap: 8,
									style: { minWidth: 0 },
									get children() {
										return [(() => {
											const __nsh_hv0 = element("text");
											prop(__nsh_hv0, "numberOfLines", 1);
											bindProp(__nsh_hv0, "style", () => ({
												...t.mono,
												fontSize: 14
											}));
											insert(__nsh_hv0, name);
											return __nsh_hv0;
										})(), component(Badge, {
											text: auto ? "自动订阅" : "手动订阅",
											tone: auto ? "warn" : "neutral"
										})];
									}
								}),
								cond(() => auto, () => (() => {
									const __nsh_hv1 = element("text");
									bindProp(__nsh_hv1, "style", () => t.meta);
									const __nsh_hv2 = text("自动订阅（连接配置 auto_subscribe），要取消请改连接配置");
									append(__nsh_hv1, __nsh_hv2);
									return __nsh_hv1;
								})()),
								cond(() => !auto, () => component(Button, {
									label: "取消订阅",
									small: true,
									tone: "danger",
									onPress: () => pendingUnsub.set(name)
								}))
							];
						}
					}),
					cond(() => pendingUnsub() !== null, () => component(ConfirmBar, {
						message: `取消订阅 ${name}？provider 会向 broker 撤销该过滤器，之后不再收到匹配的消息。`,
						confirmLabel: "确认取消",
						get busy() {
							return busy();
						},
						onConfirm: () => void unsubscribe(),
						onCancel: () => pendingUnsub.set(null)
					})),
					cond(() => auto, () => component(Notice, {
						message: "自动订阅来自连接配置的 auto_subscribe，不能在页面里单独取消。",
						tone: "warn"
					})),
					component(Card, {
						title: "订阅信息",
						get children() {
							return component(KeyValue, { get rows() {
								return [
									["主题过滤器", name],
									["QoS", qosLabel(topic)],
									["订阅类型", auto ? "自动订阅（连接配置 auto_subscribe）" : "手动订阅"],
									["provider 说明", str(topic, "description", "—")],
									["缓冲内消息", bucket === void 0 ? "—" : `${bucket.count} 条`]
								];
							} });
						}
					}),
					component(Card, {
						get title() {
							return `最近消息（${latest.length}）`;
						},
						hint: `最多 ${DETAIL_ROWS} 条，来自本地缓冲快照（上限 ${SNAPSHOT_LIMIT} 条）`,
						get children() {
							return cond(() => latest.length === 0, () => (() => {
								const __nsh_hv8 = element("text");
								bindProp(__nsh_hv8, "style", () => t.meta);
								insert(__nsh_hv8, () => snapshotError() !== null ? "本地缓冲读取失败，暂时无法展示消息。" : "本地缓冲里还没有匹配的消息：订阅后等一次发布，或检查过滤器是否真的匹配。");
								return __nsh_hv8;
							})(), () => (() => {
								const __nsh_hv3 = element("view");
								prop(__nsh_hv3, "style", {
									display: "flex",
									flexDirection: "column",
									gap: 8
								});
								insert(__nsh_hv3, () => latest.map((message) => (() => {
									const __nsh_hv4 = element("view");
									prop(__nsh_hv4, "style", {
										display: "flex",
										flexDirection: "column",
										gap: 3
									});
									const __nsh_hv5 = element("text");
									prop(__nsh_hv5, "numberOfLines", 1);
									bindProp(__nsh_hv5, "style", () => t.mono);
									insert(__nsh_hv5, () => message.topic);
									const __nsh_hv7 = element("text");
									prop(__nsh_hv7, "numberOfLines", 2);
									bindProp(__nsh_hv7, "style", () => ({
										fontSize: 12,
										color: c.text(),
										paddingLeft: 2
									}));
									insert(__nsh_hv7, () => message.preview);
									append(__nsh_hv4, __nsh_hv5);
									append(__nsh_hv4, __nsh_hv7);
									insert(__nsh_hv4, component(Row, {
										gap: 6,
										wrap: true,
										get children() {
											return [
												component(Badge, { get text() {
													return `QoS ${message.qos}`;
												} }),
												cond(() => message.retain, () => component(Badge, {
													text: "retained",
													tone: "warn"
												})),
												(() => {
													const __nsh_hv6 = element("text");
													bindProp(__nsh_hv6, "style", () => t.meta);
													insert(__nsh_hv6, () => message.at > 0 ? shortTime(new Date(message.at).toISOString()) : "-");
													return __nsh_hv6;
												})()
											];
										}
									}), __nsh_hv7);
									return __nsh_hv4;
								})()));
								return __nsh_hv3;
							})());
						}
					}),
					(() => {
						const __nsh_hv9 = element("text");
						bindProp(__nsh_hv9, "style", () => t.meta);
						const __nsh_hv10 = text("MQTT 没有「列出 broker 全部主题」的接口，这里只列出本连接的订阅过滤器； 消息数由本地环形缓冲统计，不代表 broker 的历史总量。");
						append(__nsh_hv9, __nsh_hv10);
						return __nsh_hv9;
					})()
				];
			}
		});
	}
	/** 数据到手后的主界面。 */
	function mainView() {
		return (() => {
			const __nsh_hv11 = element("view");
			prop(__nsh_hv11, "style", {
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "column"
			});
			insert(__nsh_hv11, [
				component(Row, {
					gap: 8,
					wrap: true,
					get style() {
						return {
							paddingHorizontal: 16,
							paddingVertical: 12,
							borderBottomWidth: 1,
							borderBottomColor: c.line(),
							justifyContent: "space-between"
						};
					},
					get children() {
						return [component(Row, {
							gap: 8,
							wrap: true,
							get children() {
								return [
									(() => {
										const __nsh_hv12 = element("text");
										bindProp(__nsh_hv12, "style", () => t.h1);
										const __nsh_hv13 = text("主题");
										append(__nsh_hv12, __nsh_hv13);
										return __nsh_hv12;
									})(),
									component(Badge, { get text() {
										return `${topics().length} 个订阅`;
									} }),
									(() => {
										const __nsh_hv14 = element("text");
										bindProp(__nsh_hv14, "style", () => t.meta);
										const __nsh_hv15 = text("消息数来自本地缓冲");
										append(__nsh_hv14, __nsh_hv15);
										return __nsh_hv14;
									})()
								];
							}
						}), component(Row, {
							gap: 6,
							get children() {
								return [
									component(SearchField, {
										get value() {
											return filterText();
										},
										onChange: (text) => filterText.set(text),
										placeholder: "按主题名过滤",
										width: 220
									}),
									component(Button, {
										get label() {
											return loading() ? "刷新中…" : "刷新";
										},
										small: true,
										onPress: () => void load()
									}),
									component(Button, {
										get label() {
											return formOpen() ? "收起订阅" : "订阅";
										},
										small: true,
										tone: "primary",
										onPress: () => {
											formOpen.set(!formOpen());
											notice.set(null);
										}
									})
								];
							}
						})];
					}
				}),
				cond(() => error() !== null, () => component(Row, {
					gap: 8,
					style: {
						paddingHorizontal: 16,
						paddingTop: 8
					},
					get children() {
						return [component(Notice, {
							get message() {
								return `刷新失败：${error() ?? ""}`;
							},
							tone: "danger"
						}), component(Button, {
							label: "重试",
							small: true,
							onPress: () => void load()
						})];
					}
				})),
				cond(() => notice() !== null, () => component(Row, {
					style: {
						paddingHorizontal: 16,
						paddingTop: 8
					},
					get children() {
						return cond(() => noticeError(), () => component(Notice, {
							get message() {
								return notice() ?? "";
							},
							tone: "danger"
						}), () => component(Notice, { get message() {
							return notice() ?? "";
						} }));
					}
				})),
				cond(() => formOpen(), () => (() => {
					const __nsh_hv16 = element("view");
					prop(__nsh_hv16, "style", {
						paddingHorizontal: 16,
						paddingTop: 10
					});
					insert(__nsh_hv16, component(Card, {
						title: "新增订阅",
						hint: "主题可以是过滤器：+ 匹配一层，# 匹配剩余所有层级",
						get children() {
							return component(Row, {
								gap: 8,
								wrap: true,
								get children() {
									return [
										component(SearchField, {
											get value() {
												return draftTopic();
											},
											onChange: (text) => draftTopic.set(text),
											placeholder: "例如 sensors/+/temperature 或 devices/#",
											width: 300
										}),
										(() => {
											const __nsh_hv17 = element("text");
											bindProp(__nsh_hv17, "style", () => t.label);
											const __nsh_hv18 = text("QoS");
											append(__nsh_hv17, __nsh_hv18);
											return __nsh_hv17;
										})(),
										() => [
											0,
											1,
											2
										].map((qos) => cond(() => draftQos() === qos, () => component(Button, {
											label: `QoS ${qos}`,
											small: true,
											tone: "primary",
											onPress: () => draftQos.set(qos)
										}), () => component(Button, {
											label: `QoS ${qos}`,
											small: true,
											onPress: () => draftQos.set(qos)
										}))),
										component(Button, {
											get label() {
												return busy() ? "订阅中…" : "确认订阅";
											},
											small: true,
											tone: "primary",
											onPress: () => void subscribe()
										})
									];
								}
							});
						}
					}));
					return __nsh_hv16;
				})()),
				cond(() => snapshotError() !== null, () => component(Row, {
					style: {
						paddingHorizontal: 16,
						paddingTop: 8
					},
					get children() {
						return component(Notice, {
							get message() {
								return snapshotError() ?? "";
							},
							tone: "danger"
						});
					}
				})),
				component(SplitPane, {
					width: 320,
					get left() {
						return (() => {
							const __nsh_hv19 = element("view");
							prop(__nsh_hv19, "style", {
								flex: 1,
								minHeight: 0,
								display: "flex",
								flexDirection: "column"
							});
							insert(__nsh_hv19, cond(() => visibleTopics().length === 0, () => component(Empty, {
								get title() {
									return topics().length === 0 ? "还没有订阅任何主题" : "没有匹配的主题";
								},
								get hint() {
									return topics().length === 0 ? "点右上角「订阅」添加一个过滤器；也可以在连接配置里把自动订阅设为 #。" : "清空过滤词，或换一个关键词。";
								}
							}), () => component(List, {
								get items() {
									return visibleTopics();
								},
								keyOf: (topic) => str(topic, "name", ""),
								get selected() {
									return selected();
								},
								onSelect: toggleSelect,
								render: (topic) => {
									const name = str(topic, "name", "");
									return (() => {
										const __nsh_hv20 = element("view");
										bindProp(__nsh_hv20, "style", () => ({ paddingLeft: depthOf(name) * 14 }));
										insert(__nsh_hv20, component(ListRow, {
											get title() {
												return lastSegment(name);
											},
											subtitle: name,
											get trailing() {
												return component(Row, {
													gap: 4,
													get children() {
														return [
															component(Badge, { get text() {
																return `QoS ${qosLabel(topic)}`;
															} }),
															cond(() => isAuto(topic), () => component(Badge, {
																text: "自动",
																tone: "warn"
															})),
															component(Badge, { get text() {
																return countLabel(name);
															} })
														];
													}
												});
											}
										}));
										return __nsh_hv20;
									})();
								}
							})));
							return __nsh_hv19;
						})();
					},
					get right() {
						return detailPane();
					}
				})
			]);
			return __nsh_hv11;
		})();
	}
	/** 首次加载完成前只显示 Loading；失败给重试，成功后进主界面。 */
	function content() {
		return cond(() => topics().length === 0 && error() !== null, () => component(LoadError, {
			get message() {
				return error() ?? "";
			},
			onRetry: () => void load()
		}), () => mainView());
	}
	return (() => {
		const __nsh_hv21 = element("view");
		prop(__nsh_hv21, "style", root);
		insert(__nsh_hv21, cond(() => firstLoad(), () => component(Loading, { label: "正在读取订阅主题…" }), () => content()));
		return __nsh_hv21;
	})();
}

//#endregion
//#region App.tsx
/** 默认路由：也是连接清单里 `route` 的值（打开连接先看消息浏览）。 */
const DEFAULT_ROUTE = "messages";
/** 路由表。顺序就是侧栏顺序：概览 → 订阅 → 消息 → 发布 → 主题。 */
const ROUTES = [
	{
		id: "overview",
		title: "连接概览",
		glyph: "O",
		component: Overview
	},
	{
		id: "subscriptions",
		title: "订阅管理",
		glyph: "S",
		component: Subscriptions
	},
	{
		id: "messages",
		title: "消息浏览",
		glyph: "M",
		component: Messages
	},
	{
		id: "publish",
		title: "发布台",
		glyph: "P",
		component: Publish
	},
	{
		id: "topics",
		title: "主题树",
		glyph: "T",
		component: Topics
	}
];
/** 未知 route 回落默认路由（老的 view id、拼写错误都走这里）。 */
function resolveRoute(value) {
	if (typeof value === "string" && ROUTES.some((item) => item.id === value)) return value;
	return DEFAULT_ROUTE;
}
function routeById(id) {
	return ROUTES.find((item) => item.id === id) ?? ROUTES[0];
}
function App() {
	const route = signal(resolveRoute(params.route));
	const connection = params.connection ?? null;
	const title = params.extension?.title ?? "MQTT";
	return (() => {
		const __nsh_hv0 = element("view");
		bindProp(__nsh_hv0, "style", () => ({
			flex: 1,
			minWidth: 0,
			minHeight: 0,
			display: "flex",
			flexDirection: "row",
			backgroundColor: c.bg()
		}));
		const __nsh_hv1 = element("view");
		bindProp(__nsh_hv1, "style", () => ({
			width: 208,
			flexShrink: 0,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.panel(),
			borderRightWidth: 1,
			borderRightColor: c.line()
		}));
		const __nsh_hv2 = element("view");
		prop(__nsh_hv2, "style", {
			paddingHorizontal: 14,
			paddingTop: 14,
			paddingBottom: 10,
			display: "flex",
			flexDirection: "column",
			gap: 2
		});
		const __nsh_hv3 = element("text");
		bindProp(__nsh_hv3, "style", () => t.h1);
		prop(__nsh_hv3, "numberOfLines", 1);
		insert(__nsh_hv3, title);
		const __nsh_hv4 = element("text");
		bindProp(__nsh_hv4, "style", () => t.meta);
		prop(__nsh_hv4, "numberOfLines", 1);
		insert(__nsh_hv4, () => connection === null ? "未连接" : connection.name ?? "已连接");
		append(__nsh_hv2, __nsh_hv3);
		append(__nsh_hv2, __nsh_hv4);
		const __nsh_hv5 = element("view");
		bindProp(__nsh_hv5, "style", () => hairline());
		const __nsh_hv6 = element("scroll");
		prop(__nsh_hv6, "style", {
			flex: 1,
			minHeight: 0
		});
		const __nsh_hv7 = element("view");
		prop(__nsh_hv7, "style", {
			padding: 8,
			display: "flex",
			flexDirection: "column",
			gap: 2
		});
		insert(__nsh_hv7, () => ROUTES.map((item) => (() => {
			const __nsh_hv8 = element("view");
			prop(__nsh_hv8, "role", "button");
			prop(__nsh_hv8, "onPress", () => route.set(item.id));
			bindProp(__nsh_hv8, "style", () => ({
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				gap: 9,
				paddingVertical: 5,
				paddingHorizontal: 8,
				borderRadius: r.control,
				backgroundColor: route() === item.id ? c.hover() : "transparent"
			}));
			const __nsh_hv9 = element("view");
			bindProp(__nsh_hv9, "style", () => ({
				width: 20,
				height: 20,
				flexShrink: 0,
				borderRadius: r.chip,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: route() === item.id ? c.accent() : c.hover()
			}));
			const __nsh_hv10 = element("text");
			bindProp(__nsh_hv10, "style", () => ({
				fontSize: 9,
				fontWeight: "700",
				color: route() === item.id ? c.accentText() : c.muted()
			}));
			insert(__nsh_hv10, () => item.glyph);
			append(__nsh_hv9, __nsh_hv10);
			const __nsh_hv11 = element("view");
			prop(__nsh_hv11, "style", {
				flex: 1,
				minWidth: 0
			});
			const __nsh_hv12 = element("text");
			prop(__nsh_hv12, "numberOfLines", 1);
			bindProp(__nsh_hv12, "style", () => ({
				fontSize: 12,
				fontWeight: route() === item.id ? "600" : "400",
				color: route() === item.id ? c.text() : c.muted()
			}));
			insert(__nsh_hv12, () => item.title);
			append(__nsh_hv11, __nsh_hv12);
			append(__nsh_hv8, __nsh_hv9);
			append(__nsh_hv8, __nsh_hv11);
			return __nsh_hv8;
		})()));
		append(__nsh_hv6, __nsh_hv7);
		const __nsh_hv13 = element("view");
		bindProp(__nsh_hv13, "style", () => hairline());
		const __nsh_hv14 = element("view");
		prop(__nsh_hv14, "style", {
			paddingHorizontal: 14,
			paddingVertical: 10
		});
		const __nsh_hv15 = element("text");
		bindProp(__nsh_hv15, "style", () => t.meta);
		insert(__nsh_hv15, () => `共 ${ROUTES.length} 个视图`);
		append(__nsh_hv14, __nsh_hv15);
		append(__nsh_hv1, __nsh_hv2);
		append(__nsh_hv1, __nsh_hv5);
		append(__nsh_hv1, __nsh_hv6);
		append(__nsh_hv1, __nsh_hv13);
		append(__nsh_hv1, __nsh_hv14);
		const __nsh_hv16 = element("view");
		prop(__nsh_hv16, "style", {
			flex: 1,
			minWidth: 0,
			minHeight: 0,
			display: "flex",
			flexDirection: "column"
		});
		insert(__nsh_hv16, () => {
			if (connection === null) return component(Empty, {
				title: "请先打开一个 MQTT 连接",
				hint: "在工具箱或连接列表里打开 MQTT，连接成功后会显示订阅、消息与发布视图。"
			});
			const Page = routeById(route()).component;
			return component(Page, {});
		});
		append(__nsh_hv0, __nsh_hv1);
		append(__nsh_hv0, __nsh_hv16);
		return __nsh_hv0;
	})();
}
mount(App);

//#endregion
export { App as default };