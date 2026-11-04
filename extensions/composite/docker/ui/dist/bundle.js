import { append, bindProp, component, cond, element, insert, prop, text } from "nsh:rt";
import { cleanup, computed, effect, host, mount, nativeComponent, signal, token } from "nsh";

//#region lib/navop.ts
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
async function invoke$1(method, payload = {}, options = {}) {
	const current = connection();
	return await host.call("navop.resource.invoke", {
		handle: current.resourceHandle,
		method,
		params: payload
	}, { timeout: options.timeout ?? 3e4 });
}

//#endregion
//#region lib/theme.ts
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
*/
const t = {
	get h1() {
		return {
			fontSize: 17,
			fontWeight: "600",
			color: c.text()
		};
	},
	get h2() {
		return {
			fontSize: 14,
			fontWeight: "600",
			color: c.text()
		};
	},
	get body() {
		return {
			fontSize: 13,
			color: c.text()
		};
	},
	get label() {
		return {
			fontSize: 11,
			fontWeight: "500",
			color: c.muted(),
			letterSpacing: .3
		};
	},
	get meta() {
		return {
			fontSize: 11,
			color: c.muted()
		};
	},
	get mono() {
		return {
			fontSize: 12,
			color: c.text(),
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
//#region lib/ui.tsx
/** 取值：accessor 就调用，普通值原样返回。只在 JSX 表达式里调用。 */
const pick$2 = (value) => typeof value === "function" ? value() : value;
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
/** 0..1 → 百分比宽度（Meter 用）。返回类型要写成模板字面量，否则 ViewStyle 的
* `width` 不接受宽化后的 `string`。 */
const meterWidth = (ratio) => `${Math.max(0, Math.round(Math.max(0, Math.min(1, ratio)) * 1e3) / 10)}%`;
/** 纵向堆叠；`scroll` 打开纵向滚动（页面根节点用）。 */
function Stack(props) {
	return cond(() => pick$2(props.scroll ?? false), () => (() => {
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
/** 状态胶囊。 */
function Badge(props) {
	return (() => {
		const __nsh_hv9 = element("view");
		bindProp(__nsh_hv9, "style", () => ({
			paddingHorizontal: 8,
			paddingVertical: 2,
			borderRadius: r.pill,
			borderWidth: 1,
			borderColor: toneColor(pick$2(props.tone ?? "neutral")),
			display: "flex",
			flexDirection: "row",
			alignItems: "center"
		}));
		const __nsh_hv10 = element("text");
		bindProp(__nsh_hv10, "style", () => ({
			fontSize: 11,
			fontWeight: "600",
			color: toneColor(pick$2(props.tone ?? "neutral"))
		}));
		insert(__nsh_hv10, () => props.text);
		append(__nsh_hv9, __nsh_hv10);
		return __nsh_hv9;
	})();
}
/** 按钮：三种语气，外观自己画（nsh/base 的 Button 只管无障碍语义）。 */
function Button(props) {
	return (() => {
		const __nsh_hv11 = element("view");
		bindProp(__nsh_hv11, "onPress", () => pick$2(props.disabled ?? false) ? void 0 : props.onPress);
		prop(__nsh_hv11, "role", "button");
		bindProp(__nsh_hv11, "accessibilityLabel", () => props.label);
		bindProp(__nsh_hv11, "style", () => ({
			height: props.small ? 24 : 28,
			paddingHorizontal: props.small ? 9 : 12,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: buttonBorder(pick$2(props.tone ?? "ghost")),
			backgroundColor: buttonFill(pick$2(props.tone ?? "ghost")),
			opacity: pick$2(props.disabled ?? false) ? .5 : 1,
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center"
		}));
		const __nsh_hv12 = element("text");
		bindProp(__nsh_hv12, "style", () => ({
			fontSize: props.small ? 12 : 13,
			fontWeight: "500",
			color: buttonLabel(pick$2(props.tone ?? "ghost"), pick$2(props.disabled ?? false))
		}));
		insert(__nsh_hv12, () => props.label);
		append(__nsh_hv11, __nsh_hv12);
		return __nsh_hv11;
	})();
}
/** 搜索框。`onChange` 拿到的是整串新值。 */
function SearchField(props) {
	return (() => {
		const __nsh_hv13 = element("view");
		bindProp(__nsh_hv13, "style", () => ({
			flexDirection: "row",
			alignItems: "center",
			gap: 6,
			height: 28,
			width: props.width ?? 220,
			paddingHorizontal: 9,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: c.line(),
			backgroundColor: c.bg()
		}));
		const __nsh_hv14 = element("text");
		bindProp(__nsh_hv14, "style", () => ({
			fontSize: 12,
			color: c.muted()
		}));
		const __nsh_hv15 = text("⌕");
		append(__nsh_hv14, __nsh_hv15);
		const __nsh_hv16 = element("input");
		bindProp(__nsh_hv16, "value", () => props.value);
		bindProp(__nsh_hv16, "placeholder", () => props.placeholder ?? "Filter…");
		prop(__nsh_hv16, "onChange", (text) => props.onChange(text));
		prop(__nsh_hv16, "style", {
			flex: 1,
			fontSize: 12,
			paddingHorizontal: 0,
			borderWidth: 0,
			backgroundColor: "transparent"
		});
		append(__nsh_hv13, __nsh_hv14);
		append(__nsh_hv13, __nsh_hv16);
		return __nsh_hv13;
	})();
}
/** 可滚动的行列表：单选、悬停底色、按 key 高亮。 */
function List(props) {
	return cond(() => pick$2(props.items).length === 0 && props.empty !== void 0, () => () => props.empty, () => (() => {
		const __nsh_hv17 = element("scroll");
		prop(__nsh_hv17, "style", {
			flex: 1,
			minHeight: 0
		});
		const __nsh_hv18 = element("view");
		prop(__nsh_hv18, "style", {
			display: "flex",
			flexDirection: "column"
		});
		insert(__nsh_hv18, () => pick$2(props.items).map((item, index) => {
			const key = props.keyOf(item);
			const active = pick$2(props.selected ?? null) === key;
			return (() => {
				const __nsh_hv19 = element("view");
				bindProp(__nsh_hv19, "onPress", () => props.onSelect === void 0 ? void 0 : () => props.onSelect?.(key));
				bindProp(__nsh_hv19, "style", () => ({
					backgroundColor: active ? c.hover() : "transparent",
					borderBottomWidth: index === pick$2(props.items).length - 1 ? 0 : 1,
					borderBottomColor: c.line()
				}));
				insert(__nsh_hv19, () => props.render(item, index));
				return __nsh_hv19;
			})();
		}));
		append(__nsh_hv17, __nsh_hv18);
		return __nsh_hv17;
	})());
}
/** 列表里的两行一行式条目：主标题 + 次要信息 + 右侧自由内容。 */
function ListRow(props) {
	return component(Row, {
		gap: 10,
		style: {
			paddingVertical: 9,
			paddingHorizontal: 4,
			minHeight: 40
		},
		get children() {
			return [
				() => props.leading,
				(() => {
					const __nsh_hv20 = element("view");
					prop(__nsh_hv20, "style", {
						display: "flex",
						flexDirection: "column",
						gap: 2,
						flex: 1,
						minWidth: 0
					});
					const __nsh_hv21 = element("text");
					prop(__nsh_hv21, "numberOfLines", 1);
					bindProp(__nsh_hv21, "style", () => ({
						fontSize: 13,
						fontWeight: "500",
						color: c.text()
					}));
					insert(__nsh_hv21, () => props.title);
					append(__nsh_hv20, __nsh_hv21);
					insert(__nsh_hv20, () => props.subtitle === void 0 ? null : (() => {
						const __nsh_hv22 = element("text");
						prop(__nsh_hv22, "numberOfLines", 1);
						bindProp(__nsh_hv22, "style", () => ({
							fontSize: 11,
							color: c.muted()
						}));
						insert(__nsh_hv22, () => props.subtitle);
						return __nsh_hv22;
					})());
					return __nsh_hv20;
				})(),
				() => props.trailing
			];
		}
	});
}
/** 空状态：一句解释 + 可选的下一步提示。 */
function Empty(props) {
	return (() => {
		const __nsh_hv23 = element("view");
		prop(__nsh_hv23, "style", {
			flex: 1,
			display: "flex",
			flexDirection: "column",
			alignItems: "center",
			justifyContent: "center",
			gap: 6,
			padding: 24
		});
		const __nsh_hv24 = element("text");
		bindProp(__nsh_hv24, "style", () => ({
			fontSize: 13,
			fontWeight: "500",
			color: c.text()
		}));
		insert(__nsh_hv24, () => props.title);
		append(__nsh_hv23, __nsh_hv24);
		insert(__nsh_hv23, [() => props.hint === void 0 ? null : (() => {
			const __nsh_hv25 = element("text");
			bindProp(__nsh_hv25, "style", () => ({
				fontSize: 12,
				color: c.muted(),
				textAlign: "center"
			}));
			insert(__nsh_hv25, () => props.hint);
			return __nsh_hv25;
		})(), () => props.action]);
		return __nsh_hv23;
	})();
}
/** 加载中：一行说明（列表为空时占满可用高度）。 */
function Loading(props) {
	return (() => {
		const __nsh_hv26 = element("view");
		prop(__nsh_hv26, "style", {
			flex: 1,
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			gap: 8,
			padding: 24
		});
		const __nsh_hv27 = element("text");
		bindProp(__nsh_hv27, "style", () => ({
			fontSize: 12,
			color: c.muted()
		}));
		insert(__nsh_hv27, () => props.label ?? "Loading…");
		append(__nsh_hv26, __nsh_hv27);
		return __nsh_hv26;
	})();
}
/** 失败态：原因 + 重试。错误文案保留原文，便于用户搜索。 */
function LoadError(props) {
	return (() => {
		const __nsh_hv28 = element("view");
		prop(__nsh_hv28, "style", {
			display: "flex",
			flexDirection: "column",
			gap: 8,
			padding: 16
		});
		const __nsh_hv29 = element("text");
		bindProp(__nsh_hv29, "style", () => ({
			fontSize: 13,
			color: c.danger()
		}));
		insert(__nsh_hv29, () => `加载失败：${props.message}`);
		append(__nsh_hv28, __nsh_hv29);
		insert(__nsh_hv28, () => props.onRetry === void 0 ? null : component(Row, { get children() {
			return component(Button, {
				label: "重试",
				get onPress() {
					return props.onRetry;
				}
			});
		} }));
		return __nsh_hv28;
	})();
}
/** 指标块：大数字 + 说明。 */
function Stat(props) {
	return (() => {
		const __nsh_hv30 = element("view");
		bindProp(__nsh_hv30, "style", () => ({
			...panel(12),
			flex: 1,
			minWidth: 140,
			display: "flex",
			flexDirection: "column",
			gap: 4
		}));
		const __nsh_hv31 = element("text");
		bindProp(__nsh_hv31, "style", () => t.label);
		insert(__nsh_hv31, () => props.label);
		const __nsh_hv32 = element("text");
		bindProp(__nsh_hv32, "style", () => ({
			fontSize: 22,
			fontWeight: "600",
			color: props.tone === void 0 ? c.text() : toneColor(pick$2(props.tone)),
			fontVariant: ["tabular-nums"]
		}));
		insert(__nsh_hv32, () => props.value);
		append(__nsh_hv30, __nsh_hv31);
		append(__nsh_hv30, __nsh_hv32);
		insert(__nsh_hv30, () => props.hint === void 0 ? null : (() => {
			const __nsh_hv33 = element("text");
			bindProp(__nsh_hv33, "style", () => t.meta);
			insert(__nsh_hv33, () => props.hint);
			return __nsh_hv33;
		})());
		return __nsh_hv30;
	})();
}
/** 占用条：0..1 的比例 + 两端说明。 */
function Meter(props) {
	return (() => {
		const __nsh_hv34 = element("view");
		prop(__nsh_hv34, "style", {
			display: "flex",
			flexDirection: "column",
			gap: 6
		});
		const __nsh_hv37 = element("view");
		bindProp(__nsh_hv37, "style", () => ({
			height: 8,
			borderRadius: r.pill,
			backgroundColor: c.hover(),
			overflow: "hidden"
		}));
		const __nsh_hv38 = element("view");
		bindProp(__nsh_hv38, "style", () => ({
			width: meterWidth(pick$2(props.ratio)),
			height: 8,
			borderRadius: r.pill,
			backgroundColor: props.tone === void 0 ? c.accent() : toneColor(pick$2(props.tone))
		}));
		append(__nsh_hv37, __nsh_hv38);
		append(__nsh_hv34, __nsh_hv37);
		insert(__nsh_hv34, cond(() => props.label !== void 0 || props.caption !== void 0, () => component(Row, {
			style: { justifyContent: "space-between" },
			get children() {
				return [(() => {
					const __nsh_hv35 = element("text");
					bindProp(__nsh_hv35, "style", () => t.meta);
					insert(__nsh_hv35, () => props.label ?? "");
					return __nsh_hv35;
				})(), (() => {
					const __nsh_hv36 = element("text");
					bindProp(__nsh_hv36, "style", () => ({
						...t.meta,
						fontVariant: ["tabular-nums"]
					}));
					insert(__nsh_hv36, () => props.caption ?? "");
					return __nsh_hv36;
				})()];
			}
		})), __nsh_hv37);
		return __nsh_hv34;
	})();
}
/** 键值对表：inspect 类页面的主体。 */
function KeyValue(props) {
	return (() => {
		const __nsh_hv39 = element("view");
		bindProp(__nsh_hv39, "style", () => ({
			display: "flex",
			flexDirection: pick$2(props.columns ?? 1) === 2 ? "row" : "column",
			flexWrap: "wrap",
			gap: pick$2(props.columns ?? 1) === 2 ? 12 : 0
		}));
		insert(__nsh_hv39, () => pick$2(props.rows).map(([key, value]) => component(Row, {
			get style() {
				return {
					justifyContent: "space-between",
					paddingVertical: 5,
					width: pick$2(props.columns ?? 1) === 2 ? "48%" : "100%",
					gap: 12
				};
			},
			get children() {
				return [(() => {
					const __nsh_hv40 = element("text");
					bindProp(__nsh_hv40, "style", () => ({
						fontSize: 12,
						color: c.muted()
					}));
					insert(__nsh_hv40, key);
					return __nsh_hv40;
				})(), (() => {
					const __nsh_hv41 = element("text");
					bindProp(__nsh_hv41, "style", () => ({
						fontSize: 12,
						color: c.text(),
						fontVariant: ["tabular-nums"]
					}));
					insert(__nsh_hv41, value);
					return __nsh_hv41;
				})()];
			}
		})));
		return __nsh_hv39;
	})();
}
/** 主从布局：左侧列表固定宽度，右侧详情自适应。 */
function SplitPane(props) {
	return (() => {
		const __nsh_hv44 = element("view");
		prop(__nsh_hv44, "style", {
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "row"
		});
		const __nsh_hv45 = element("view");
		bindProp(__nsh_hv45, "style", () => ({
			width: props.width ?? 300,
			flexShrink: 0,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			borderRightWidth: 1,
			borderRightColor: c.line()
		}));
		insert(__nsh_hv45, () => props.left);
		const __nsh_hv46 = element("view");
		prop(__nsh_hv46, "style", {
			flex: 1,
			minWidth: 0,
			minHeight: 0,
			display: "flex",
			flexDirection: "column"
		});
		insert(__nsh_hv46, () => props.right);
		append(__nsh_hv44, __nsh_hv45);
		append(__nsh_hv44, __nsh_hv46);
		return __nsh_hv44;
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
					const __nsh_hv47 = element("text");
					bindProp(__nsh_hv47, "style", () => ({
						flex: 1,
						minWidth: 0,
						fontSize: 12,
						color: c.text()
					}));
					insert(__nsh_hv47, () => props.message);
					return __nsh_hv47;
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
		const __nsh_hv48 = element("text");
		bindProp(__nsh_hv48, "style", () => ({
			fontSize: 12,
			color: props.tone === void 0 ? c.muted() : toneColor(pick$2(props.tone))
		}));
		insert(__nsh_hv48, () => props.message);
		return __nsh_hv48;
	})();
}

//#endregion
//#region lib/format.ts
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
/** 百分比，保留一位小数；分母为 0 时给 `-`。 */
function percent(part, total) {
	const value = Number(part);
	const whole = Number(total);
	if (!Number.isFinite(value) || !Number.isFinite(whole) || whole <= 0) return "-";
	return `${(value / whole * 100).toFixed(1)}%`;
}
/** 0..1 的比例，用于进度条宽度；越界会被夹紧。 */
function ratio(part, total) {
	const value = Number(part);
	const whole = Number(total);
	if (!Number.isFinite(value) || !Number.isFinite(whole) || whole <= 0) return 0;
	return Math.max(0, Math.min(1, value / whole));
}
/** `2026-11-02T09:31:04Z` → `11-02 09:31`；解析不了就原样返回。 */
function shortTime(value) {
	if (typeof value !== "string" || value.length === 0) return "-";
	const date = new Date(value.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
	if (Number.isNaN(date.getTime())) return value;
	const two = (n) => String(n).padStart(2, "0");
	return `${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}
/** Docker 把 Cmd 交给页面时是数组；按 CLI 的样子拼起来。 */
function joinCommand(value) {
	if (Array.isArray(value)) return value.length > 0 ? value.join(" ") : "-";
	if (typeof value === "string" && value.length > 0) return value;
	return "-";
}
/** `ghcr.io/acme/api:1.4` → 仓库 + 标签；registry 端口不会误判成标签。 */
function splitImageRef(reference) {
	const index = reference.lastIndexOf(":");
	if (index > 0 && !reference.slice(index + 1).includes("/")) return {
		image: reference.slice(0, index),
		tag: reference.slice(index + 1) || "latest"
	};
	return {
		image: reference,
		tag: "latest"
	};
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
//#region pages/containers/App.tsx
/** 一次最多显示多少条环境变量 / 标签，避免一屏几千行。 */
const ENV_LIMIT = 40;
const LABEL_LIMIT = 20;
const STATE_LABEL$1 = {
	running: "运行中",
	exited: "已停止",
	paused: "已暂停",
	created: "已创建",
	restarting: "重启中",
	removing: "删除中",
	dead: "已死亡"
};
const ACTION_PAST = {
	start: "已启动",
	stop: "已停止",
	restart: "已重启",
	pause: "已暂停",
	unpause: "已恢复"
};
function stateLabel$1(state) {
	const label = STATE_LABEL$1[state];
	return label === void 0 ? state.length === 0 ? "未知" : state : label;
}
function stateTone$6(state) {
	if (state === "running") return "ok";
	if (state === "paused" || state === "restarting" || state === "removing") return "warn";
	if (state === "dead") return "danger";
	return "neutral";
}
function stateColor(state) {
	const tone = stateTone$6(state);
	if (tone === "ok") return c.chart(1);
	if (tone === "warn") return c.chart(4);
	if (tone === "danger") return c.danger();
	return c.muted();
}
function isObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function pick$1(source, key) {
	return isObject(source) ? source[key] : void 0;
}
/** 把任意值读成一句可显示文本；缺失时给 fallback。 */
function text$2(value, fallback = "-") {
	if (typeof value === "string") return value.length === 0 ? fallback : value;
	if (typeof value === "number") return Number.isFinite(value) ? String(value) : fallback;
	if (typeof value === "boolean") return value ? "是" : "否";
	return fallback;
}
function numberOr(value, fallback) {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return fallback;
}
function toContainer(value) {
	return {
		id: str(value, "id", ""),
		name: str(value, "name", ""),
		image: str(value, "image", ""),
		state: str(value, "state", ""),
		status: str(value, "status", ""),
		ports: str(value, "ports", ""),
		created: str(value, "created", "-")
	};
}
function toStats(value) {
	return {
		cpuPercent: numberOr(pick$1(value, "cpu_percent"), 0),
		memoryUsage: numberOr(pick$1(value, "memory_usage_bytes"), 0),
		memoryLimit: numberOr(pick$1(value, "memory_limit_bytes"), 0),
		cpus: numberOr(pick$1(value, "online_cpus"), 0)
	};
}
function nowClock$1() {
	const now = /* @__PURE__ */ new Date();
	const two = (value) => String(value).padStart(2, "0");
	return `${two(now.getHours())}:${two(now.getMinutes())}`;
}
function restartText$1(policy) {
	const name = text$2(pick$1(policy, "Name"), "");
	if (name.length === 0 || name === "no") return "不自动重启";
	const retries = numberOr(pick$1(policy, "MaximumRetryCount"), 0);
	return retries > 0 ? `${name}（最多 ${retries} 次）` : name;
}
/** 状态 + 健康检查 + 暂停位（inspect 里这三处是分开的）。 */
function stateText(state) {
	const status = text$2(pick$1(state, "Status"), "");
	const health = text$2(pick$1(state, "Health"), "");
	const healthStatus = text$2(pick$1(pick$1(state, "Health"), "Status"), "");
	const parts = [status.length === 0 ? "未知" : stateLabel$1(status)];
	if (healthStatus.length > 0) parts.push(`健康检查 ${healthStatus}`);
	else if (health.length > 0) parts.push(`健康检查 ${health}`);
	if (pick$1(state, "Paused") === true) parts.push("已暂停");
	return parts.join(" · ");
}
/** `NetworkSettings.Ports` → `0.0.0.0:8080 → 80/tcp` 这样的行。 */
function portLines$1(info) {
	const ports = pick$1(pick$1(info, "NetworkSettings"), "Ports");
	if (!isObject(ports)) return [];
	const lines = [];
	for (const [containerPort, bindings] of Object.entries(ports)) {
		if (!Array.isArray(bindings) || bindings.length === 0) {
			lines.push(`${containerPort}（仅暴露，未发布）`);
			continue;
		}
		for (const binding of bindings) {
			const hostIp = text$2(pick$1(binding, "HostIp"), "0.0.0.0");
			const hostPort = text$2(pick$1(binding, "HostPort"), "");
			lines.push(hostPort.length === 0 ? `${containerPort}（仅暴露，未发布）` : `${hostIp}:${hostPort} → ${containerPort}`);
		}
	}
	return lines;
}
/** 各网络的名字 → IP / 网关 / MAC。 */
function networkRows(info) {
	const networks = pick$1(pick$1(info, "NetworkSettings"), "Networks");
	if (!isObject(networks)) return [];
	return Object.entries(networks).map(([name, value]) => {
		const parts = [];
		const ip = text$2(pick$1(value, "IPAddress"), "");
		const gateway = text$2(pick$1(value, "Gateway"), "");
		const mac = text$2(pick$1(value, "MacAddress"), "");
		if (ip.length > 0) parts.push(ip);
		if (gateway.length > 0) parts.push(`网关 ${gateway}`);
		if (mac.length > 0) parts.push(mac);
		return [name, parts.length === 0 ? "未分配地址" : parts.join(" · ")];
	});
}
/** 挂载：源 → 目标（读写位）。 */
function mountRows(info) {
	const mounts = pick$1(info, "Mounts");
	if (!Array.isArray(mounts)) return [];
	return mounts.map((mount) => {
		const source = text$2(pick$1(mount, "Source"), "-");
		const destination = text$2(pick$1(mount, "Destination"), "-");
		const mode = pick$1(mount, "RW") === false ? "只读" : "读写";
		const type = text$2(pick$1(mount, "Type"), "");
		return [source, `${destination}（${mode}${type.length === 0 ? "" : ` · ${type}`}）`];
	});
}
/** `Config.Env` 是 `KEY=VALUE` 字符串数组。 */
function envRows(info) {
	const env = pick$1(pick$1(info, "Config"), "Env");
	if (!Array.isArray(env)) return [];
	return env.map((entry) => {
		const line = typeof entry === "string" ? entry : String(entry);
		const at = line.indexOf("=");
		return at < 0 ? [line, ""] : [line.slice(0, at), line.slice(at + 1)];
	});
}
function labelRows(info) {
	const labels = pick$1(pick$1(info, "Config"), "Labels");
	if (!isObject(labels)) return [];
	return Object.entries(labels).map(([key, value]) => [key, text$2(value, "")]);
}
function overviewRows(info) {
	const state = pick$1(info, "State");
	const config = pick$1(info, "Config");
	const hostConfig = pick$1(info, "HostConfig");
	return [
		["容器 ID", text$2(pick$1(info, "Id")).slice(0, 12)],
		["名称", text$2(pick$1(info, "Name")).replace(/^\//, "")],
		["镜像", text$2(pick$1(config, "Image"), text$2(pick$1(info, "Image")))],
		["状态", stateText(state)],
		["启动时间", shortTime(text$2(pick$1(state, "StartedAt"), ""))],
		["创建时间", shortTime(text$2(pick$1(info, "Created"), ""))],
		["退出码", text$2(pick$1(state, "ExitCode"), "0")],
		["重启次数", text$2(pick$1(state, "RestartCount"), "0")],
		["重启策略", restartText$1(pick$1(hostConfig, "RestartPolicy"))],
		["启动命令", joinCommand(pick$1(config, "Cmd"))]
	];
}
function ToolButton(props) {
	const label = () => typeof props.label === "function" ? props.label() : props.label;
	const disabled = () => props.disabled?.() === true;
	const tone = props.tone ?? "ghost";
	const testLabel = props.testLabel ?? (typeof props.label === "string" ? props.label : "");
	return (() => {
		const __nsh_hv0 = element("view");
		prop(__nsh_hv0, "role", "button");
		prop(__nsh_hv0, "accessibilityLabel", testLabel);
		prop(__nsh_hv0, "onPress", () => {
			if (disabled()) return;
			props.onPress();
		});
		bindProp(__nsh_hv0, "style", () => ({
			height: 24,
			paddingHorizontal: 10,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: tone === "danger" ? c.danger() : tone === "primary" ? c.accent() : c.line(),
			backgroundColor: tone === "primary" ? c.accent() : "transparent",
			opacity: disabled() ? .5 : 1,
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center"
		}));
		const __nsh_hv1 = element("text");
		bindProp(__nsh_hv1, "style", () => ({
			fontSize: 12,
			fontWeight: "500",
			color: tone === "primary" ? c.accentText() : tone === "danger" ? c.danger() : disabled() ? c.muted() : c.text()
		}));
		insert(__nsh_hv1, () => label());
		append(__nsh_hv0, __nsh_hv1);
		return __nsh_hv0;
	})();
}
function chip$2(label, active, testLabel, onPress) {
	return (() => {
		const __nsh_hv2 = element("view");
		prop(__nsh_hv2, "role", "button");
		prop(__nsh_hv2, "accessibilityLabel", testLabel);
		prop(__nsh_hv2, "onPress", onPress);
		bindProp(__nsh_hv2, "style", () => ({
			flexDirection: "row",
			alignItems: "center",
			paddingHorizontal: 10,
			paddingVertical: 5,
			borderRadius: r.pill,
			borderWidth: 1,
			borderColor: active() ? c.accent() : c.line(),
			backgroundColor: active() ? c.accent() : "transparent"
		}));
		const __nsh_hv3 = element("text");
		bindProp(__nsh_hv3, "style", () => ({
			...t.meta,
			color: active() ? c.accentText() : c.text()
		}));
		insert(__nsh_hv3, label);
		append(__nsh_hv2, __nsh_hv3);
		return __nsh_hv2;
	})();
}
/** 过滤输入框：lib 的 SearchField 不暴露 testID，测试里要用 `id:` 定位，所以自己包一层。 */
function FilterField(props) {
	return (() => {
		const __nsh_hv4 = element("view");
		bindProp(__nsh_hv4, "style", () => ({
			flexDirection: "row",
			alignItems: "center",
			gap: 6,
			height: 28,
			width: 240,
			paddingHorizontal: 9,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: c.line(),
			backgroundColor: c.bg()
		}));
		const __nsh_hv5 = element("text");
		bindProp(__nsh_hv5, "style", () => ({
			fontSize: 12,
			color: c.muted()
		}));
		const __nsh_hv6 = text("⌕");
		append(__nsh_hv5, __nsh_hv6);
		const __nsh_hv7 = element("input");
		bindProp(__nsh_hv7, "testID", () => props.testID);
		bindProp(__nsh_hv7, "value", () => props.value);
		bindProp(__nsh_hv7, "placeholder", () => props.placeholder);
		prop(__nsh_hv7, "onChange", (text) => props.onChange(text));
		prop(__nsh_hv7, "style", {
			flex: 1,
			fontSize: 12,
			paddingHorizontal: 0,
			borderWidth: 0,
			backgroundColor: "transparent"
		});
		append(__nsh_hv4, __nsh_hv5);
		append(__nsh_hv4, __nsh_hv7);
		return __nsh_hv4;
	})();
}
function dot(state) {
	return (() => {
		const __nsh_hv8 = element("view");
		bindProp(__nsh_hv8, "style", () => ({
			width: 8,
			height: 8,
			borderRadius: 999,
			backgroundColor: stateColor(state),
			flexShrink: 0
		}));
		return __nsh_hv8;
	})();
}
function Containers() {
	const rows = signal([]);
	const loading = signal(true);
	const listError = signal(null);
	const filter = signal("");
	const stateFilter = signal("all");
	const selected = signal(null);
	const detail = signal(null);
	const detailLoading = signal(false);
	const detailError = signal(null);
	const stats = signal(null);
	const busy = signal(false);
	const pendingRemove = signal(null);
	const notice = signal(null);
	const noticeTone = signal("neutral");
	const updatedAt = signal(null);
	let listSeq = 0;
	let detailSeq = 0;
	let statsSeq = 0;
	const firstLoad = computed(() => loading() && rows().length === 0 && listError() === null);
	const firstError = computed(() => listError() !== null && rows().length === 0);
	function say(message, tone = "neutral") {
		notice.set(message);
		noticeTone.set(tone);
	}
	function selectedRow() {
		return rows().find((row) => row.id === selected()) ?? null;
	}
	function runningCount() {
		return rows().filter((row) => row.state === "running").length;
	}
	function visible() {
		const needle = filter().trim().toLowerCase();
		const mode = stateFilter();
		return rows().filter((row) => {
			if (mode === "running" && row.state !== "running") return false;
			if (mode === "stopped" && row.state === "running") return false;
			if (needle.length === 0) return true;
			return `${row.name} ${row.image}`.toLowerCase().includes(needle);
		});
	}
	async function load() {
		const mine = ++listSeq;
		loading.set(true);
		try {
			const result = await invoke$1("docker/container/list", {}, { timeout: SLOW_TIMEOUT_MS });
			if (mine !== listSeq) return;
			const list = arr(result, "containers").map(toContainer);
			rows.set(list);
			listError.set(null);
			updatedAt.set(nowClock$1());
			syncSelection(list);
		} catch (failure) {
			if (mine !== listSeq) return;
			listError.set(errorMessage(failure));
		} finally {
			if (mine === listSeq) loading.set(false);
		}
	}
	/** 列表刷新后：选中的容器还在就留着，没了就换成第一个。 */
	function syncSelection(list) {
		const current = selected();
		if (current !== null && list.some((row) => row.id === current)) return;
		const next = list.length > 0 ? list[0].id : null;
		selected.set(next);
		detail.set(null);
		stats.set(null);
		detailError.set(null);
		pendingRemove.set(null);
		if (next !== null) loadDetail(next);
	}
	function select(id) {
		if (selected() === id) return;
		selected.set(id);
		detail.set(null);
		stats.set(null);
		detailError.set(null);
		pendingRemove.set(null);
		loadDetail(id);
	}
	async function loadDetail(id) {
		const mine = ++detailSeq;
		detailLoading.set(true);
		detailError.set(null);
		try {
			const raw = await invoke$1("docker/container/inspect", { id }, { timeout: SLOW_TIMEOUT_MS });
			if (mine !== detailSeq || selected() !== id) return;
			detail.set(isObject(raw) ? raw : null);
		} catch (failure) {
			if (mine !== detailSeq || selected() !== id) return;
			detail.set(null);
			detailError.set(errorMessage(failure));
		} finally {
			if (mine === detailSeq && selected() === id) detailLoading.set(false);
		}
		loadStats(id);
	}
	/** stats 失败不算错误：容器刚好退出、provider 采样失败都会走到这里。 */
	async function loadStats(id) {
		const mine = ++statsSeq;
		stats.set(null);
		try {
			const raw = await invoke$1("docker/container/stats", { id }, { timeout: SLOW_TIMEOUT_MS });
			if (mine !== statsSeq || selected() !== id) return;
			stats.set(toStats(raw));
		} catch {
			if (mine === statsSeq && selected() === id) stats.set(null);
		}
	}
	async function act(action, row) {
		if (busy()) return;
		busy.set(true);
		pendingRemove.set(null);
		try {
			await invoke$1(`docker/container/${action}`, { id: row.id });
			say(`${ACTION_PAST[action]}容器 ${row.name.length > 0 ? row.name : row.id.slice(0, 12)}`);
			await load();
			if (selected() === row.id) await loadDetail(row.id);
		} catch (failure) {
			say(`${actionLabel(action)}失败：${errorMessage(failure)}`, "danger");
		} finally {
			busy.set(false);
		}
	}
	async function remove(row) {
		if (busy()) return;
		busy.set(true);
		try {
			await invoke$1("docker/container/remove", { id: row.id });
			pendingRemove.set(null);
			if (selected() === row.id) {
				selected.set(null);
				detail.set(null);
				stats.set(null);
			}
			say(`已删除容器 ${row.name.length > 0 ? row.name : row.id.slice(0, 12)}`);
			await load();
		} catch (failure) {
			say(`删除失败：${errorMessage(failure)}`, "danger");
		} finally {
			busy.set(false);
		}
	}
	function actionLabel(action) {
		switch (action) {
			case "start": return "启动";
			case "stop": return "停止";
			case "restart": return "重启";
			case "pause": return "暂停";
			case "unpause": return "恢复";
		}
	}
	load();
	function filters() {
		return component(Row, {
			gap: 6,
			get children() {
				return [
					() => chip$2("全部", () => stateFilter() === "all", "过滤:全部", () => stateFilter.set("all")),
					() => chip$2("运行中", () => stateFilter() === "running", "过滤:运行中", () => stateFilter.set("running")),
					() => chip$2("已停止", () => stateFilter() === "stopped", "过滤:已停止", () => stateFilter.set("stopped"))
				];
			}
		});
	}
	function listPane() {
		return (() => {
			const __nsh_hv9 = element("view");
			bindProp(__nsh_hv9, "style", () => ({
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "column",
				backgroundColor: c.panel()
			}));
			insert(__nsh_hv9, () => visible().length === 0 ? component(Empty, {
				get title() {
					return rows().length === 0 ? "还没有容器" : "没有匹配的容器";
				},
				get hint() {
					return rows().length === 0 ? "在终端里 docker run 一个容器，然后点右上角「刷新」。" : "清空搜索词，或把状态过滤切回「全部」。";
				}
			}) : component(List, {
				get items() {
					return visible();
				},
				keyOf: (row) => row.id.length > 0 ? row.id : row.name,
				get selected() {
					return selected();
				},
				onSelect: select,
				render: (row) => component(ListRow, {
					get title() {
						return row.name.length > 0 ? row.name : row.id.slice(0, 12);
					},
					get subtitle() {
						return `${row.status.length > 0 ? row.status : stateLabel$1(row.state)} · ${row.image}`;
					},
					get leading() {
						return dot(row.state);
					},
					get trailing() {
						return (() => {
							const __nsh_hv10 = element("view");
							prop(__nsh_hv10, "style", {
								display: "flex",
								flexDirection: "column",
								alignItems: "flex-end",
								gap: 2
							});
							const __nsh_hv11 = element("text");
							bindProp(__nsh_hv11, "style", () => t.meta);
							insert(__nsh_hv11, () => row.created);
							append(__nsh_hv10, __nsh_hv11);
							insert(__nsh_hv10, component(Badge, {
								get text() {
									return stateLabel$1(row.state);
								},
								get tone() {
									return stateTone$6(row.state);
								}
							}), __nsh_hv11);
							return __nsh_hv10;
						})();
					}
				})
			}));
			return __nsh_hv9;
		})();
	}
	function actions(row) {
		const controls = [];
		if (row.state === "running") controls.push(component(ToolButton, {
			label: "停止",
			testLabel: "停止",
			disabled: busy,
			onPress: () => void act("stop", row)
		}), component(ToolButton, {
			label: "重启",
			testLabel: "重启",
			disabled: busy,
			onPress: () => void act("restart", row)
		}), component(ToolButton, {
			label: "暂停",
			testLabel: "暂停",
			disabled: busy,
			onPress: () => void act("pause", row)
		}));
		else if (row.state === "paused") controls.push(component(ToolButton, {
			label: "恢复",
			testLabel: "恢复",
			disabled: busy,
			onPress: () => void act("unpause", row)
		}), component(ToolButton, {
			label: "停止",
			testLabel: "停止",
			disabled: busy,
			onPress: () => void act("stop", row)
		}));
		else controls.push(component(ToolButton, {
			label: "启动",
			testLabel: "启动",
			disabled: busy,
			onPress: () => void act("start", row)
		}));
		controls.push(component(ToolButton, {
			label: "删除容器",
			testLabel: "删除容器",
			tone: "danger",
			disabled: busy,
			onPress: () => {
				notice.set(null);
				pendingRemove.set(pendingRemove() === row.id ? null : row.id);
			}
		}));
		return component(Row, {
			gap: 6,
			get children() {
				return controls;
			}
		});
	}
	function overviewCard(info) {
		if (info === null) return null;
		return component(Card, {
			title: "概览",
			get children() {
				return component(KeyValue, { get rows() {
					return overviewRows(info);
				} });
			}
		});
	}
	function resourcesCard(row) {
		if (row.state !== "running") return component(Card, {
			title: "资源占用",
			hint: "容器未运行",
			get children() {
				return (() => {
					const __nsh_hv12 = element("text");
					bindProp(__nsh_hv12, "style", () => t.meta);
					const __nsh_hv13 = text("启动容器后这里显示 CPU / 内存的实时采样。");
					append(__nsh_hv12, __nsh_hv13);
					return __nsh_hv12;
				})();
			}
		});
		const sample = stats();
		if (sample === null) return component(Card, {
			title: "资源占用",
			get children() {
				return (() => {
					const __nsh_hv14 = element("text");
					bindProp(__nsh_hv14, "style", () => t.meta);
					const __nsh_hv15 = text("暂无实时数据（provider 采样失败，或容器刚启动还没攒到一个样本）。");
					append(__nsh_hv14, __nsh_hv15);
					return __nsh_hv14;
				})();
			}
		});
		const limit = sample.memoryLimit > 0 ? sample.memoryLimit : 0;
		const usedRatio = limit > 0 ? sample.memoryUsage / limit : 0;
		return component(Card, {
			title: "资源占用",
			get hint() {
				return sample.cpus > 0 ? `${sample.cpus} 个 CPU` : void 0;
			},
			get children() {
				return [component(Row, {
					gap: 12,
					get children() {
						return [component(Stat, {
							label: "CPU",
							get value() {
								return `${sample.cpuPercent.toFixed(2)}%`;
							}
						}), component(Stat, {
							label: "内存",
							get value() {
								return humanBytes(sample.memoryUsage);
							},
							get hint() {
								return limit > 0 ? `上限 ${humanBytes(limit)}` : "无限";
							}
						})];
					}
				}), component(Meter, {
					ratio: usedRatio,
					label: "内存使用率",
					get caption() {
						return limit > 0 ? percent(sample.memoryUsage, limit) : "—";
					}
				})];
			}
		});
	}
	function networkCard(info) {
		if (info === null) return null;
		const networks = networkRows(info);
		const ports = portLines$1(info);
		if (networks.length === 0 && ports.length === 0) return null;
		return component(Card, {
			title: "网络",
			get hint() {
				return networks.length > 0 ? `${networks.length} 个网络` : void 0;
			},
			get children() {
				return [() => networks.length === 0 ? null : component(KeyValue, { rows: networks }), (() => {
					const __nsh_hv16 = element("view");
					prop(__nsh_hv16, "style", {
						display: "flex",
						flexDirection: "column",
						gap: 4
					});
					const __nsh_hv17 = element("text");
					bindProp(__nsh_hv17, "style", () => t.label);
					const __nsh_hv18 = text("端口");
					append(__nsh_hv17, __nsh_hv18);
					append(__nsh_hv16, __nsh_hv17);
					insert(__nsh_hv16, () => ports.length === 0 ? (() => {
						const __nsh_hv19 = element("text");
						bindProp(__nsh_hv19, "style", () => t.meta);
						const __nsh_hv20 = text("没有发布端口。");
						append(__nsh_hv19, __nsh_hv20);
						return __nsh_hv19;
					})() : ports.map((line) => (() => {
						const __nsh_hv21 = element("text");
						bindProp(__nsh_hv21, "style", () => ({
							...t.mono,
							fontSize: 11
						}));
						prop(__nsh_hv21, "selectable", true);
						insert(__nsh_hv21, line);
						return __nsh_hv21;
					})()));
					return __nsh_hv16;
				})()];
			}
		});
	}
	function mountsCard(info) {
		if (info === null) return null;
		const mounts = mountRows(info);
		if (mounts.length === 0) return null;
		return component(Card, {
			title: "挂载",
			get hint() {
				return `${mounts.length} 处`;
			},
			get children() {
				return component(KeyValue, { rows: mounts });
			}
		});
	}
	function envCard(info) {
		if (info === null) return null;
		const env = envRows(info);
		if (env.length === 0) return null;
		const shown = env.slice(0, ENV_LIMIT);
		return component(Card, {
			title: "环境变量",
			get hint() {
				return env.length > shown.length ? `${env.length} 项，显示前 ${shown.length} 项` : `${env.length} 项`;
			},
			get children() {
				return component(KeyValue, { rows: shown });
			}
		});
	}
	function labelsCard(info) {
		if (info === null) return null;
		const labels = labelRows(info);
		if (labels.length === 0) return null;
		const shown = labels.slice(0, LABEL_LIMIT);
		return component(Card, {
			title: "标签",
			get hint() {
				return labels.length > shown.length ? `${labels.length} 项，显示前 ${shown.length} 项` : `${labels.length} 项`;
			},
			get children() {
				return component(KeyValue, { rows: shown });
			}
		});
	}
	function detailBody(row) {
		const info = detail();
		const name = row.name.length > 0 ? row.name : row.id.slice(0, 12);
		return (() => {
			const __nsh_hv22 = element("view");
			prop(__nsh_hv22, "style", {
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "column"
			});
			const __nsh_hv23 = element("view");
			bindProp(__nsh_hv23, "style", () => ({
				paddingHorizontal: 14,
				paddingVertical: 10,
				gap: 6,
				borderBottomWidth: 1,
				borderBottomColor: c.line()
			}));
			const __nsh_hv26 = element("text");
			prop(__nsh_hv26, "numberOfLines", 1);
			bindProp(__nsh_hv26, "style", () => t.meta);
			insert(__nsh_hv26, () => row.image);
			append(__nsh_hv23, __nsh_hv26);
			insert(__nsh_hv23, component(Row, {
				gap: 8,
				style: { justifyContent: "space-between" },
				get children() {
					return [component(Row, {
						gap: 8,
						style: {
							flex: 1,
							minWidth: 0
						},
						get children() {
							return [
								(() => {
									const __nsh_hv24 = element("text");
									prop(__nsh_hv24, "numberOfLines", 1);
									bindProp(__nsh_hv24, "style", () => ({
										fontSize: 15,
										fontWeight: "600",
										color: c.text()
									}));
									insert(__nsh_hv24, name);
									return __nsh_hv24;
								})(),
								component(Badge, {
									get text() {
										return stateLabel$1(row.state);
									},
									get tone() {
										return stateTone$6(row.state);
									}
								}),
								(() => {
									const __nsh_hv25 = element("text");
									prop(__nsh_hv25, "numberOfLines", 1);
									bindProp(__nsh_hv25, "style", () => t.mono);
									insert(__nsh_hv25, () => row.id.slice(0, 12));
									return __nsh_hv25;
								})()
							];
						}
					}), () => actions(row)];
				}
			}), __nsh_hv26);
			append(__nsh_hv22, __nsh_hv23);
			insert(__nsh_hv22, [() => pendingRemove() === row.id ? (() => {
				const __nsh_hv27 = element("view");
				prop(__nsh_hv27, "style", {
					paddingHorizontal: 14,
					paddingTop: 10
				});
				insert(__nsh_hv27, component(ConfirmBar, {
					message: `删除容器 ${name}？会先强制停止再删除（匿名卷一并删除），无法恢复。`,
					confirmLabel: "删除",
					get busy() {
						return busy();
					},
					onConfirm: () => void remove(row),
					onCancel: () => pendingRemove.set(null)
				}));
				return __nsh_hv27;
			})() : null, component(Stack, {
				scroll: true,
				padding: 14,
				gap: 12,
				get children() {
					return [
						() => detailError() === null ? null : component(Row, {
							gap: 8,
							get children() {
								return [(() => {
									const __nsh_hv28 = element("view");
									prop(__nsh_hv28, "style", {
										flex: 1,
										minWidth: 0
									});
									insert(__nsh_hv28, component(Notice, {
										get message() {
											return `读取详情失败：${detailError() ?? ""}`;
										},
										tone: "danger"
									}));
									return __nsh_hv28;
								})(), component(ToolButton, {
									label: "重试",
									testLabel: "重试读取详情",
									onPress: () => void loadDetail(row.id)
								})];
							}
						}),
						() => detailLoading() && info === null ? component(Loading, { label: "正在读取容器详情…" }) : null,
						() => overviewCard(info),
						() => resourcesCard(row),
						() => networkCard(info),
						() => mountsCard(info),
						() => envCard(info),
						() => labelsCard(info)
					];
				}
			})]);
			return __nsh_hv22;
		})();
	}
	function detailPane() {
		return (() => {
			const __nsh_hv29 = element("view");
			prop(__nsh_hv29, "style", {
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "column"
			});
			insert(__nsh_hv29, () => {
				const row = selectedRow();
				return row === null ? component(Empty, {
					title: "选择一个容器",
					hint: "左侧点一个容器查看详情；可以启动、停止、重启、暂停，或删除它。"
				}) : detailBody(row);
			});
			return __nsh_hv29;
		})();
	}
	return (() => {
		const __nsh_hv30 = element("view");
		bindProp(__nsh_hv30, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		insert(__nsh_hv30, [
			component(Row, {
				wrap: true,
				gap: 8,
				style: {
					paddingHorizontal: 14,
					paddingVertical: 10,
					justifyContent: "space-between"
				},
				get children() {
					return [component(Row, {
						gap: 8,
						get children() {
							return [
								(() => {
									const __nsh_hv31 = element("text");
									bindProp(__nsh_hv31, "style", () => t.h1);
									const __nsh_hv32 = text("容器");
									append(__nsh_hv31, __nsh_hv32);
									return __nsh_hv31;
								})(),
								() => component(Badge, { get text() {
									return `${rows().length} 个 · 运行中 ${runningCount()}`;
								} }),
								component(FilterField, {
									testID: "container-filter",
									get value() {
										return filter();
									},
									placeholder: "按名称 / 镜像过滤",
									onChange: (value) => filter.set(value)
								}),
								() => filters()
							];
						}
					}), component(Row, {
						gap: 8,
						get children() {
							return [() => updatedAt() === null ? null : (() => {
								const __nsh_hv33 = element("text");
								bindProp(__nsh_hv33, "style", () => t.meta);
								insert(__nsh_hv33, () => `上次更新 ${updatedAt() ?? ""}`);
								return __nsh_hv33;
							})(), component(ToolButton, {
								label: () => loading() ? "刷新中…" : "刷新",
								testLabel: "刷新",
								disabled: () => loading() || busy(),
								onPress: () => void load()
							})];
						}
					})];
				}
			}),
			() => listError() !== null && rows().length > 0 ? (() => {
				const __nsh_hv34 = element("view");
				prop(__nsh_hv34, "style", {
					paddingHorizontal: 14,
					paddingBottom: 8
				});
				insert(__nsh_hv34, component(Notice, {
					get message() {
						return `刷新失败，下面是上次的列表：${listError() ?? ""}`;
					},
					tone: "danger"
				}));
				return __nsh_hv34;
			})() : null,
			() => notice() === null ? null : (() => {
				const __nsh_hv35 = element("view");
				prop(__nsh_hv35, "style", {
					paddingHorizontal: 14,
					paddingBottom: 8
				});
				insert(__nsh_hv35, component(Notice, {
					get message() {
						return notice() ?? "";
					},
					get tone() {
						return noticeTone();
					}
				}));
				return __nsh_hv35;
			})(),
			() => firstLoad() ? component(Loading, { label: "正在读取容器列表…" }) : null,
			() => firstError() ? component(LoadError, {
				get message() {
					return listError() ?? "";
				},
				onRetry: () => void load()
			}) : null,
			() => firstLoad() || firstError() ? null : component(SplitPane, {
				width: 320,
				get left() {
					return listPane();
				},
				get right() {
					return detailPane();
				}
			})
		]);
		return __nsh_hv30;
	})();
}

//#endregion
//#region pages/images/App.tsx
/** operationId → provider 方法名。
*
* 清单里的 `resourceWorkbenches` 已经不参与运行，这一层映射留在页面里：
* 页面自己决定"要哪份数据"，宿主只负责把方法名和参数发给 provider。
*/
/** inspect 的返回是 Docker 原始的 PascalCase 结构，别按小写字段读。 */
function pascalRaw(info, key, nested) {
	const root = info ?? null;
	if (root === null) return null;
	return (nested === void 0 ? root : root[nested] ?? null)?.[key] ?? null;
}
/** PascalCase 字段转展示文本（缺省给 `-`）。 */
function pascal(info, key, nested) {
	const raw = pascalRaw(info, key, nested);
	if (typeof raw === "string" && raw.length > 0) return raw;
	if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
	return "-";
}
/** 镜像大小：provider 给的是 `"7.8 MB"` 这种字符串，能直接用就直接用。 */
function sizeText(item) {
	if (item === null) return "-";
	const size = item.size;
	if (typeof size === "string" && size.trim().length > 0) return size;
	return humanBytes(size);
}
const OPERATIONS$3 = {
	containerCreate: "docker/container/create",
	containerDiff: "docker/container/diff",
	containerFilesDelete: "docker/container/files/delete",
	containerFilesList: "docker/container/files/list",
	containerKill: "docker/container/kill",
	containerLogs: "docker/container/logs",
	containerLogsWithTail: "docker/container/logs",
	containerMounts: "docker/container/mounts",
	containerPause: "docker/container/pause",
	containerRename: "docker/container/rename",
	containerStats: "docker/container/stats",
	containerTop: "docker/container/top",
	containerUnpause: "docker/container/unpause",
	containerUpdate: "docker/container/update",
	imageHistory: "docker/image/history",
	imageHistoryByRef: "docker/image/history",
	imageInspect: "docker/image/inspect",
	imageInspectByRef: "docker/image/inspect",
	imagePrune: "docker/image/prune",
	imageRemoveByRef: "docker/image/remove",
	imageTag: "docker/image/tag",
	imageTagByRef: "docker/image/tag",
	inspectContainer: "docker/container/inspect",
	inspectNetwork: "docker/network/inspect",
	inspectVolume: "docker/volume/inspect",
	listContainers: "docker/container/list",
	listImages: "docker/image/list",
	listNetworks: "docker/network/list",
	listVolumes: "docker/volume/list",
	networkConnect: "docker/network/connect",
	networkCreate: "docker/network/create",
	networkDisconnect: "docker/network/disconnect",
	networkInspectById: "docker/network/inspect",
	networkPrune: "docker/network/prune",
	networkRemoveById: "docker/network/remove",
	pullImage: "docker/image/pull",
	removeContainer: "docker/container/remove",
	removeImage: "docker/image/remove",
	removeNetwork: "docker/network/remove",
	removeVolume: "docker/volume/remove",
	restartContainer: "docker/container/restart",
	startContainer: "docker/container/start",
	stopContainer: "docker/container/stop",
	systemInfo: "docker/system/info",
	systemPrune: "docker/system/prune",
	systemUsage: "docker/system/usage",
	volumeCreate: "docker/volume/create",
	volumeInspectByName: "docker/volume/inspect",
	volumePrune: "docker/volume/prune",
	volumeRemoveByName: "docker/volume/remove"
};
/** 调一次 provider 方法；把失败折成一句人话。`confirmed` 仅为兼容旧调用点。 */
async function dispatch$2(operationId, input, _confirmed) {
	const method = OPERATIONS$3[operationId];
	if (!method) throw new Error(`未知的操作：${operationId}`);
	try {
		return await invoke$1(method, input ?? {}, { timeout: SLOW_TIMEOUT_MS });
	} catch (error) {
		throw new Error(errorMessage(error));
	}
}
function Images() {
	const images = signal([]);
	const loading = signal(true);
	const error = signal(null);
	const notice = signal(null);
	const filter = signal("");
	const selected = signal(null);
	const detail = signal(null);
	const detailError = signal(null);
	const detailLoading = signal(false);
	const pullOpen = signal(false);
	const pullRef = signal("");
	const busy = signal(false);
	const pendingRemove = signal(null);
	const pendingPrune = signal(false);
	const tagForm = signal(false);
	const tagRepo = signal("");
	const tagName = signal("");
	const selectedImage = () => images().find((image) => str(image, "remove_target") === selected()) ?? null;
	const visible = () => {
		const needle = filter().trim().toLowerCase();
		if (needle.length === 0) return images();
		return images().filter((image) => {
			return [
				str(image, "name", ""),
				str(image, "id", ""),
				...arr(image, "tags").map(String)
			].join(" ").toLowerCase().includes(needle);
		});
	};
	async function loadDetail(target) {
		detailLoading.set(true);
		detailError.set(null);
		try {
			const [info, history] = await Promise.all([dispatch$2("imageInspectByRef", { name: target }), dispatch$2("imageHistoryByRef", { name: target }).catch(() => null)]);
			if (selected() !== target) return;
			detail.set({
				info: info ?? null,
				history: history ?? null
			});
		} catch (failure) {
			if (selected() !== target) return;
			detail.set(null);
			detailError.set(errorMessage(failure));
		} finally {
			if (selected() === target) detailLoading.set(false);
		}
	}
	async function load() {
		loading.set(true);
		notice.set(null);
		try {
			const result = await dispatch$2("listImages");
			const list = Array.isArray(result) ? result : arr(result, "images");
			images.set(list);
			error.set(null);
			const target = selected();
			if (!list.some((image) => str(image, "remove_target") === target)) {
				const first = list.length > 0 ? str(list[0], "remove_target", "") : "";
				selected.set(first.length > 0 ? first : null);
				detail.set(null);
			}
		} catch (failure) {
			error.set(errorMessage(failure));
		} finally {
			loading.set(false);
		}
		const target = selected();
		if (target !== null) loadDetail(target);
	}
	function select(target) {
		if (selected() === target) return;
		selected.set(target);
		detail.set(null);
		detailError.set(null);
		pendingRemove.set(null);
		pullOpen.set(false);
		loadDetail(target);
	}
	async function remove() {
		const target = pendingRemove();
		if (target === null) return;
		busy.set(true);
		try {
			await dispatch$2("imageRemoveByRef", { name: target }, true);
			await load();
			notice.set(`已删除 ${target}`);
			pendingRemove.set(null);
		} catch (failure) {
			notice.set(errorMessage(failure));
		} finally {
			busy.set(false);
		}
	}
	async function prune() {
		busy.set(true);
		try {
			const result = await dispatch$2("imagePrune", { all: false }, true);
			await load();
			notice.set(`已清理悬空镜像${result ? `（${str(result, "reclaimed", "")} 空间）` : ""}`);
			pendingPrune.set(false);
		} catch (failure) {
			notice.set(errorMessage(failure));
		} finally {
			busy.set(false);
		}
	}
	async function pull() {
		const trimmed = pullRef().trim();
		if (trimmed.length === 0) return;
		busy.set(true);
		try {
			const { image, tag } = splitImageRef(trimmed);
			await dispatch$2("pullImage", {
				image,
				tag
			}, true);
			await load();
			notice.set(`已拉取 ${trimmed}`);
		} catch (failure) {
			notice.set(errorMessage(failure));
		} finally {
			busy.set(false);
		}
	}
	async function applyTag() {
		const target = selected();
		if (target === null) return;
		const repo = tagRepo().trim();
		const tag = tagName().trim();
		if (repo.length === 0 || tag.length === 0) {
			notice.set("打标签需要仓库名与标签");
			return;
		}
		busy.set(true);
		try {
			await dispatch$2("imageTagByRef", {
				name: target,
				repo,
				tag
			}, true);
			notice.set(`已打标签 ${repo}:${tag}`);
			tagForm.set(false);
			await load();
		} catch (failure) {
			notice.set(errorMessage(failure));
		} finally {
			busy.set(false);
		}
	}
	load();
	function historyRows() {
		const history = detail()?.history;
		const entries = Array.isArray(history) ? history : arr(history, "history");
		if (entries.length === 0) return [];
		return entries.slice(0, 12).map((entry, index) => component(Row, {
			gap: 10,
			style: { paddingVertical: 5 },
			get children() {
				return [
					(() => {
						const __nsh_hv0 = element("text");
						bindProp(__nsh_hv0, "style", () => ({
							...t.mono,
							width: 78,
							color: c.muted()
						}));
						insert(__nsh_hv0, () => shortTime(str(entry, "created", "")));
						return __nsh_hv0;
					})(),
					(() => {
						const __nsh_hv1 = element("text");
						bindProp(__nsh_hv1, "style", () => ({
							...t.mono,
							width: 70,
							color: c.muted()
						}));
						insert(__nsh_hv1, () => sizeText(entry));
						return __nsh_hv1;
					})(),
					(() => {
						const __nsh_hv2 = element("text");
						prop(__nsh_hv2, "numberOfLines", 1);
						bindProp(__nsh_hv2, "style", () => ({
							flex: 1,
							minWidth: 0,
							fontSize: 12,
							color: c.text()
						}));
						insert(__nsh_hv2, () => str(entry, "created_by", "-"));
						return __nsh_hv2;
					})()
				];
			}
		}));
	}
	function detailPane() {
		const image = selectedImage();
		if (image === null) return component(Empty, {
			title: "选择左侧的镜像",
			hint: "选中后可以查看配置、层历史，并做删除或打标签。"
		});
		const tags = arr(image, "tags").map(String);
		return component(Stack, {
			scroll: true,
			padding: 14,
			gap: 12,
			get children() {
				return [
					component(Row, {
						style: {
							justifyContent: "space-between",
							alignItems: "flex-start",
							gap: 12
						},
						get children() {
							return [(() => {
								const __nsh_hv3 = element("view");
								prop(__nsh_hv3, "style", {
									display: "flex",
									flexDirection: "column",
									gap: 3,
									flex: 1,
									minWidth: 0
								});
								const __nsh_hv4 = element("text");
								prop(__nsh_hv4, "numberOfLines", 1);
								bindProp(__nsh_hv4, "style", () => ({
									fontSize: 15,
									fontWeight: "600",
									color: c.text()
								}));
								insert(__nsh_hv4, () => str(image, "name", "<untagged>"));
								const __nsh_hv5 = element("text");
								prop(__nsh_hv5, "numberOfLines", 1);
								bindProp(__nsh_hv5, "style", () => t.meta);
								insert(__nsh_hv5, () => `${str(image, "id", "-")} · ${sizeText(image)} · ${tags.length} 个标签`);
								append(__nsh_hv3, __nsh_hv4);
								append(__nsh_hv3, __nsh_hv5);
								return __nsh_hv3;
							})(), component(Row, {
								gap: 6,
								get children() {
									return [component(Button, {
										get label() {
											return tagForm() ? "取消" : "打标签";
										},
										small: true,
										onPress: () => tagForm.set(!tagForm())
									}), component(Button, {
										label: "删除镜像",
										tone: "danger",
										small: true,
										onPress: () => {
											pendingPrune.set(false);
											pendingRemove.set(str(image, "remove_target", ""));
										}
									})];
								}
							})];
						}
					}),
					() => pendingRemove() === null ? null : component(ConfirmBar, {
						get message() {
							return `删除镜像 ${str(image, "name", "")}？此操作不可撤销。`;
						},
						confirmLabel: "删除",
						get busy() {
							return busy();
						},
						onConfirm: () => void remove(),
						onCancel: () => pendingRemove.set(null)
					}),
					() => !tagForm() ? null : component(Card, {
						title: "新增标签",
						hint: "例如 acme/api:1.4",
						get children() {
							return component(Row, {
								gap: 8,
								get children() {
									return [
										(() => {
											const __nsh_hv6 = element("view");
											prop(__nsh_hv6, "style", {
												flex: 1,
												minWidth: 0
											});
											insert(__nsh_hv6, component(SearchField, {
												get value() {
													return tagRepo();
												},
												onChange: (text) => tagRepo.set(text),
												placeholder: "仓库名，如 acme/api",
												width: 260
											}));
											return __nsh_hv6;
										})(),
										component(SearchField, {
											get value() {
												return tagName();
											},
											onChange: (text) => tagName.set(text),
											placeholder: "标签，如 1.4",
											width: 120
										}),
										component(Button, {
											get label() {
												return busy() ? "写入中…" : "写入";
											},
											tone: "primary",
											small: true,
											onPress: () => void applyTag(),
											get disabled() {
												return busy();
											}
										})
									];
								}
							});
						}
					}),
					component(Card, {
						title: "概览",
						get children() {
							return component(KeyValue, { get rows() {
								return [
									["镜像 ID", str(image, "id", "-")],
									["大小", sizeText(image)],
									["创建时间", shortTime(str(image, "created", ""))],
									["标签", tags.length > 0 ? tags.join(", ") : "<无>"],
									["入口命令", joinCommand((detail()?.info)?.config ?? null)]
								];
							} });
						}
					}),
					component(Card, {
						title: "层历史",
						get hint() {
							return detailLoading() ? "读取中…" : "最近 12 层";
						},
						get children() {
							return detailError() !== null ? component(Notice, {
								get message() {
									return detailError() ?? "";
								},
								tone: "danger"
							}) : historyRows().length === 0 ? (() => {
								const __nsh_hv7 = element("text");
								bindProp(__nsh_hv7, "style", () => t.meta);
								insert(__nsh_hv7, () => detailLoading() ? "读取中…" : "没有可显示的层");
								return __nsh_hv7;
							})() : (() => {
								const __nsh_hv8 = element("view");
								prop(__nsh_hv8, "style", {
									display: "flex",
									flexDirection: "column"
								});
								insert(__nsh_hv8, () => historyRows());
								return __nsh_hv8;
							})();
						}
					}),
					() => detail()?.info === void 0 ? null : component(Card, {
						title: "配置",
						get children() {
							return component(KeyValue, {
								columns: 2,
								get rows() {
									return [
										["架构", pascal(detail()?.info, "Architecture")],
										["操作系统", pascal(detail()?.info, "Os")],
										["环境变量", `${arr((detail()?.info)?.Config, "Env").length} 项`],
										["工作目录", pascal(detail()?.info, "WorkingDir", "Config")],
										["暴露端口", `${Object.keys(pascalRaw(detail()?.info, "Config", "ExposedPorts") ?? {}).length} 个`]
									];
								}
							});
						}
					})
				];
			}
		});
	}
	const body = () => {
		if (loading() && images().length === 0 && error() === null) return component(Loading, { label: "正在读取镜像列表…" });
		if (error() !== null && images().length === 0) return component(LoadError, {
			get message() {
				return error() ?? "";
			},
			onRetry: () => void load()
		});
		return (() => {
			const __nsh_hv9 = element("view");
			bindProp(__nsh_hv9, "style", () => ({
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "column",
				backgroundColor: c.bg()
			}));
			insert(__nsh_hv9, [
				component(Row, {
					gap: 8,
					style: {
						paddingHorizontal: 14,
						paddingVertical: 10,
						justifyContent: "space-between"
					},
					get children() {
						return [component(Row, {
							gap: 8,
							get children() {
								return [
									(() => {
										const __nsh_hv10 = element("text");
										bindProp(__nsh_hv10, "style", () => t.h1);
										const __nsh_hv11 = text("镜像");
										append(__nsh_hv10, __nsh_hv11);
										return __nsh_hv10;
									})(),
									component(Badge, { get text() {
										return filter().trim().length === 0 ? `${images().length} 个本地` : `匹配 ${visible().length} / 共 ${images().length}`;
									} }),
									component(SearchField, {
										get value() {
											return filter();
										},
										onChange: (text) => filter.set(text),
										placeholder: "按名称 / ID / 标签过滤"
									})
								];
							}
						}), component(Row, {
							gap: 6,
							get children() {
								return [
									component(Button, {
										label: "刷新",
										small: true,
										onPress: () => void load()
									}),
									component(Button, {
										get label() {
											return pullOpen() ? "取消拉取" : "拉取镜像";
										},
										small: true,
										onPress: () => pullOpen.set(!pullOpen())
									}),
									component(Button, {
										label: "清理悬空",
										small: true,
										tone: "danger",
										onPress: () => {
											pendingRemove.set(null);
											pendingPrune.set(true);
										}
									})
								];
							}
						})];
					}
				}),
				() => notice() === null ? null : (() => {
					const __nsh_hv12 = element("view");
					prop(__nsh_hv12, "style", {
						paddingHorizontal: 14,
						paddingBottom: 8
					});
					insert(__nsh_hv12, component(Notice, { get message() {
						return notice() ?? "";
					} }));
					return __nsh_hv12;
				})(),
				() => !pendingPrune() ? null : (() => {
					const __nsh_hv13 = element("view");
					prop(__nsh_hv13, "style", {
						paddingHorizontal: 14,
						paddingBottom: 8
					});
					insert(__nsh_hv13, component(ConfirmBar, {
						message: "清理所有悬空镜像与未使用层？",
						confirmLabel: "清理",
						get busy() {
							return busy();
						},
						onConfirm: () => void prune(),
						onCancel: () => pendingPrune.set(false)
					}));
					return __nsh_hv13;
				})(),
				() => !pullOpen() ? null : component(Row, {
					gap: 8,
					style: {
						paddingHorizontal: 14,
						paddingBottom: 10
					},
					get children() {
						return [
							component(SearchField, {
								get value() {
									return pullRef();
								},
								onChange: (text) => pullRef.set(text),
								placeholder: "repo/name:tag",
								width: 280
							}),
							component(Button, {
								get label() {
									return busy() ? "拉取中…" : "拉取";
								},
								tone: "primary",
								small: true,
								onPress: () => void pull(),
								get disabled() {
									return busy();
								}
							}),
							(() => {
								const __nsh_hv14 = element("text");
								bindProp(__nsh_hv14, "style", () => t.meta);
								const __nsh_hv15 = text("冷缓存的大镜像可能要几分钟。");
								append(__nsh_hv14, __nsh_hv15);
								return __nsh_hv14;
							})()
						];
					}
				}),
				component(SplitPane, {
					get left() {
						return component(List, {
							get items() {
								return visible();
							},
							keyOf: (image) => str(image, "remove_target", str(image, "id", "")),
							get selected() {
								return selected();
							},
							onSelect: select,
							render: (image) => component(ListRow, {
								get title() {
									return str(image, "name", "<untagged>");
								},
								get subtitle() {
									return `${arr(image, "tags").length} 个标签 · ${sizeText(image)} · ${shortTime(str(image, "created", ""))}`;
								},
								get trailing() {
									return image.dangling === true ? component(Badge, {
										text: "悬空",
										tone: "danger"
									}) : void 0;
								}
							}),
							get empty() {
								return component(Empty, {
									title: "没有匹配的镜像",
									hint: "清空过滤条件，或先拉取一个镜像。"
								});
							}
						});
					},
					get right() {
						return detailPane();
					}
				})
			]);
			return __nsh_hv9;
		})();
	};
	return (() => {
		const __nsh_hv16 = element("view");
		prop(__nsh_hv16, "style", {
			flex: 1,
			minHeight: 0
		});
		insert(__nsh_hv16, () => body());
		return __nsh_hv16;
	})();
}

//#endregion
//#region pages/volumes/App.tsx
/** operationId → provider 方法名。
*
* 清单里的 `resourceWorkbenches` 已经不参与运行，这一层映射留在页面里：
* 页面自己决定"要哪份数据"，宿主只负责把方法名和参数发给 provider。
*/
const OPERATIONS$2 = {
	containerCreate: "docker/container/create",
	containerDiff: "docker/container/diff",
	containerFilesDelete: "docker/container/files/delete",
	containerFilesList: "docker/container/files/list",
	containerKill: "docker/container/kill",
	containerLogs: "docker/container/logs",
	containerLogsWithTail: "docker/container/logs",
	containerMounts: "docker/container/mounts",
	containerPause: "docker/container/pause",
	containerRename: "docker/container/rename",
	containerStats: "docker/container/stats",
	containerTop: "docker/container/top",
	containerUnpause: "docker/container/unpause",
	containerUpdate: "docker/container/update",
	imageHistory: "docker/image/history",
	imageHistoryByRef: "docker/image/history",
	imageInspect: "docker/image/inspect",
	imageInspectByRef: "docker/image/inspect",
	imagePrune: "docker/image/prune",
	imageRemoveByRef: "docker/image/remove",
	imageTag: "docker/image/tag",
	imageTagByRef: "docker/image/tag",
	inspectContainer: "docker/container/inspect",
	inspectNetwork: "docker/network/inspect",
	inspectVolume: "docker/volume/inspect",
	listContainers: "docker/container/list",
	listImages: "docker/image/list",
	listNetworks: "docker/network/list",
	listVolumes: "docker/volume/list",
	networkConnect: "docker/network/connect",
	networkCreate: "docker/network/create",
	networkDisconnect: "docker/network/disconnect",
	networkInspectById: "docker/network/inspect",
	networkPrune: "docker/network/prune",
	networkRemoveById: "docker/network/remove",
	pullImage: "docker/image/pull",
	removeContainer: "docker/container/remove",
	removeImage: "docker/image/remove",
	removeNetwork: "docker/network/remove",
	removeVolume: "docker/volume/remove",
	restartContainer: "docker/container/restart",
	startContainer: "docker/container/start",
	stopContainer: "docker/container/stop",
	systemInfo: "docker/system/info",
	systemPrune: "docker/system/prune",
	systemUsage: "docker/system/usage",
	volumeCreate: "docker/volume/create",
	volumeInspectByName: "docker/volume/inspect",
	volumePrune: "docker/volume/prune",
	volumeRemoveByName: "docker/volume/remove"
};
/** 调一次 provider 方法；把失败折成一句人话。`confirmed` 仅为兼容旧调用点。 */
async function dispatch$1(operationId, input, _confirmed) {
	const method = OPERATIONS$2[operationId];
	if (!method) throw new Error(`未知的操作：${operationId}`);
	try {
		return await invoke$1(method, input ?? {}, { timeout: SLOW_TIMEOUT_MS });
	} catch (error) {
		throw new Error(errorMessage(error));
	}
}
/** 键值对象 → KeyValue 的行；数组也展开成一行一项。 */
function rowsOf$1(source) {
	if (!source || typeof source !== "object") return [];
	return Object.entries(source).filter(([, value]) => value !== null && value !== void 0).map(([key, value]) => {
		return [key, (typeof value === "string" ? value : Array.isArray(value) ? value.map(String).join(", ") : JSON.stringify(value)) ?? String(value)];
	});
}
/** 单行输入框。SearchField 带放大镜，名称 / 驱动字段用它不合适。 */
function Field$2(props) {
	return (() => {
		const __nsh_hv0 = element("view");
		bindProp(__nsh_hv0, "style", () => ({
			flexDirection: "row",
			alignItems: "center",
			height: 28,
			width: props.width ?? 200,
			paddingHorizontal: 9,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: c.line(),
			backgroundColor: c.bg()
		}));
		const __nsh_hv1 = element("input");
		bindProp(__nsh_hv1, "value", () => props.value);
		bindProp(__nsh_hv1, "placeholder", () => props.placeholder ?? "");
		prop(__nsh_hv1, "onChange", (text) => props.onChange(text));
		prop(__nsh_hv1, "onSubmit", () => props.onSubmit?.());
		prop(__nsh_hv1, "style", {
			flex: 1,
			fontSize: 12,
			paddingHorizontal: 0,
			borderWidth: 0,
			backgroundColor: "transparent"
		});
		append(__nsh_hv0, __nsh_hv1);
		return __nsh_hv0;
	})();
}
function Volumes() {
	const volumes = signal([]);
	const loading = signal(true);
	const error = signal(null);
	const notice = signal(null);
	const filter = signal("");
	const selected = signal(null);
	const detail = signal(null);
	const detailLoading = signal(false);
	const detailError = signal(null);
	const createOpen = signal(false);
	const createName = signal("");
	const createDriver = signal("local");
	const busy = signal(false);
	const pendingRemove = signal(null);
	const pendingPrune = signal(false);
	const firstLoad = computed(() => loading() && volumes().length === 0 && error() === null);
	const firstError = computed(() => error() !== null && volumes().length === 0);
	const selectedVolume = () => volumes().find((volume) => str(volume, "name") === selected()) ?? null;
	const visible = () => {
		const needle = filter().trim().toLowerCase();
		if (needle.length === 0) return volumes();
		return volumes().filter((volume) => {
			return [
				str(volume, "name", ""),
				str(volume, "driver", ""),
				str(volume, "mountpoint", "")
			].join(" ").toLowerCase().includes(needle);
		});
	};
	async function loadDetail(target) {
		detailLoading.set(true);
		detailError.set(null);
		try {
			const info = await dispatch$1("volumeInspectByName", { name: target });
			if (selected() !== target) return;
			detail.set(info ?? null);
		} catch (failure) {
			if (selected() !== target) return;
			detail.set(null);
			detailError.set(errorMessage(failure));
		} finally {
			if (selected() === target) detailLoading.set(false);
		}
	}
	async function load() {
		loading.set(true);
		try {
			const result = await dispatch$1("listVolumes");
			const list = Array.isArray(result) ? result : arr(result, "volumes");
			volumes.set(list);
			error.set(null);
			const target = selected();
			if (!list.some((volume) => str(volume, "name") === target)) {
				const first = list.length > 0 ? str(list[0], "name", "") : "";
				selected.set(first.length > 0 ? first : null);
				detail.set(null);
			}
		} catch (failure) {
			error.set(errorMessage(failure));
		} finally {
			loading.set(false);
		}
		const target = selected();
		if (target !== null) loadDetail(target);
	}
	function select(target) {
		if (selected() === target) return;
		selected.set(target);
		detail.set(null);
		detailError.set(null);
		pendingRemove.set(null);
		loadDetail(target);
	}
	async function create() {
		const name = createName().trim();
		const driver = createDriver().trim() || "local";
		if (name.length === 0) {
			notice.set("请先填存储卷名称");
			return;
		}
		busy.set(true);
		try {
			const created = await dispatch$1("volumeCreate", {
				name,
				driver
			}, true);
			createOpen.set(false);
			createName.set("");
			createDriver.set("local");
			selected.set(str(created, "Name", name));
			await load();
			notice.set(`已创建存储卷 ${name}`);
		} catch (failure) {
			notice.set(errorMessage(failure));
		} finally {
			busy.set(false);
		}
	}
	async function remove() {
		const target = pendingRemove();
		if (target === null || target.length === 0) return;
		busy.set(true);
		try {
			await dispatch$1("volumeRemoveByName", { name: target }, true);
			pendingRemove.set(null);
			if (selected() === target) selected.set(null);
			await load();
			notice.set(`已删除存储卷 ${target}`);
		} catch (failure) {
			notice.set(errorMessage(failure));
		} finally {
			busy.set(false);
		}
	}
	async function prune() {
		busy.set(true);
		try {
			const result = await dispatch$1("volumePrune", {}, true);
			const deleted = arr(result, "deleted").length;
			const reclaimed = Number(result?.space_reclaimed_bytes ?? 0);
			pendingPrune.set(false);
			await load();
			notice.set(deleted === 0 ? "没有可清理的未使用存储卷" : `已清理 ${deleted} 个未使用存储卷${Number.isFinite(reclaimed) && reclaimed > 0 ? `，回收 ${humanBytes(reclaimed)}` : ""}`);
		} catch (failure) {
			notice.set(errorMessage(failure));
		} finally {
			busy.set(false);
		}
	}
	load();
	function listPane() {
		return (() => {
			const __nsh_hv2 = element("view");
			bindProp(__nsh_hv2, "style", () => ({
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "column",
				backgroundColor: c.panel()
			}));
			insert(__nsh_hv2, () => visible().length === 0 ? component(Empty, {
				get title() {
					return filter().trim().length === 0 ? "还没有存储卷" : "没有匹配的存储卷";
				},
				get hint() {
					return filter().trim().length === 0 ? "点右上角「新建存储卷」创建一个；容器挂载匿名卷后刷新也能看到。" : "清空搜索词，或换一个名称 / 驱动 / 挂载点再试。";
				}
			}) : component(List, {
				get items() {
					return visible();
				},
				keyOf: (volume) => str(volume, "name", ""),
				get selected() {
					return selected();
				},
				onSelect: select,
				render: (volume) => component(ListRow, {
					get title() {
						return str(volume, "name");
					},
					get subtitle() {
						return str(volume, "mountpoint", "-");
					},
					get trailing() {
						return (() => {
							const __nsh_hv3 = element("view");
							prop(__nsh_hv3, "style", {
								display: "flex",
								flexDirection: "column",
								alignItems: "flex-end",
								gap: 2
							});
							const __nsh_hv4 = element("text");
							bindProp(__nsh_hv4, "style", () => ({
								...t.mono,
								fontSize: 11
							}));
							insert(__nsh_hv4, () => str(volume, "size"));
							const __nsh_hv5 = element("text");
							bindProp(__nsh_hv5, "style", () => t.meta);
							insert(__nsh_hv5, () => str(volume, "driver"));
							append(__nsh_hv3, __nsh_hv4);
							append(__nsh_hv3, __nsh_hv5);
							return __nsh_hv3;
						})();
					}
				})
			}));
			return __nsh_hv2;
		})();
	}
	function detailPane() {
		const volume = selectedVolume();
		if (volume === null) return component(Empty, {
			title: "选择左侧的存储卷",
			hint: "选中后可以查看驱动、挂载点与标签，并删除这个卷。"
		});
		const name = str(volume, "name");
		const info = detail();
		const labels = rowsOf$1(info?.Labels);
		const options = rowsOf$1(info?.Options);
		const status = arr(info, "Status").map(String);
		const refs = Number(volume.ref_count);
		const scope = str(info ?? volume, "Scope", str(volume, "scope"));
		const driver = str(info ?? volume, "Driver", str(volume, "driver"));
		const mountpoint = str(info ?? volume, "Mountpoint", str(volume, "mountpoint", "-"));
		return component(Stack, {
			scroll: true,
			padding: 14,
			gap: 12,
			get children() {
				return [
					component(Row, {
						style: {
							justifyContent: "space-between",
							alignItems: "flex-start",
							gap: 12
						},
						get children() {
							return [(() => {
								const __nsh_hv6 = element("view");
								prop(__nsh_hv6, "style", {
									display: "flex",
									flexDirection: "column",
									gap: 3,
									flex: 1,
									minWidth: 0
								});
								const __nsh_hv7 = element("text");
								prop(__nsh_hv7, "numberOfLines", 1);
								bindProp(__nsh_hv7, "style", () => ({
									fontSize: 15,
									fontWeight: "600",
									color: c.text()
								}));
								insert(__nsh_hv7, name);
								const __nsh_hv8 = element("text");
								prop(__nsh_hv8, "numberOfLines", 1);
								bindProp(__nsh_hv8, "style", () => t.meta);
								insert(__nsh_hv8, () => `${driver} · ${scope} · ${str(volume, "size")}`);
								append(__nsh_hv6, __nsh_hv7);
								append(__nsh_hv6, __nsh_hv8);
								return __nsh_hv6;
							})(), component(Button, {
								label: "删除存储卷",
								tone: "danger",
								small: true,
								get disabled() {
									return busy();
								},
								onPress: () => {
									pendingPrune.set(false);
									pendingRemove.set(name);
								}
							})];
						}
					}),
					() => pendingRemove() === name ? component(ConfirmBar, {
						message: `删除存储卷 ${name}？卷里的数据会一并删除，无法恢复。`,
						confirmLabel: "删除",
						get busy() {
							return busy();
						},
						onConfirm: () => void remove(),
						onCancel: () => pendingRemove.set(null)
					}) : null,
					() => detailError() === null ? null : component(Row, {
						gap: 8,
						get children() {
							return [(() => {
								const __nsh_hv9 = element("view");
								prop(__nsh_hv9, "style", {
									flex: 1,
									minWidth: 0
								});
								insert(__nsh_hv9, component(Notice, {
									get message() {
										return `读取详情失败：${detailError()}`;
									},
									tone: "danger"
								}));
								return __nsh_hv9;
							})(), component(Button, {
								label: "重试",
								small: true,
								onPress: () => void loadDetail(name)
							})];
						}
					}),
					component(Card, {
						title: "概览",
						get hint() {
							return detailLoading() ? "读取中…" : void 0;
						},
						get children() {
							return component(KeyValue, { get rows() {
								return [
									["名称", name],
									["驱动", driver],
									["Scope", scope],
									["大小", str(volume, "size")],
									["引用容器", Number.isFinite(refs) && refs >= 0 ? String(refs) : "-"],
									["创建时间", shortTime(str(info, "CreatedAt", ""))],
									["挂载点", mountpoint]
								];
							} });
						}
					}),
					component(Card, {
						title: "标签",
						get hint() {
							return labels.length === 0 ? "无" : `${labels.length} 项`;
						},
						get children() {
							return labels.length === 0 ? (() => {
								const __nsh_hv10 = element("text");
								bindProp(__nsh_hv10, "style", () => t.meta);
								const __nsh_hv11 = text("这个存储卷没有设置标签。");
								append(__nsh_hv10, __nsh_hv11);
								return __nsh_hv10;
							})() : component(KeyValue, { rows: labels });
						}
					}),
					() => options.length === 0 ? null : component(Card, {
						title: "驱动选项",
						get children() {
							return component(KeyValue, { rows: options });
						}
					}),
					() => status.length === 0 ? null : component(Card, {
						title: "状态",
						get children() {
							return (() => {
								const __nsh_hv12 = element("text");
								bindProp(__nsh_hv12, "style", () => t.meta);
								insert(__nsh_hv12, () => status.join(" · "));
								return __nsh_hv12;
							})();
						}
					})
				];
			}
		});
	}
	return (() => {
		const __nsh_hv13 = element("view");
		bindProp(__nsh_hv13, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		insert(__nsh_hv13, [
			component(Row, {
				wrap: true,
				gap: 8,
				style: {
					paddingHorizontal: 14,
					paddingVertical: 10,
					justifyContent: "space-between"
				},
				get children() {
					return [component(Row, {
						gap: 8,
						get children() {
							return [
								(() => {
									const __nsh_hv14 = element("text");
									bindProp(__nsh_hv14, "style", () => t.h1);
									const __nsh_hv15 = text("存储卷");
									append(__nsh_hv14, __nsh_hv15);
									return __nsh_hv14;
								})(),
								component(Badge, { get text() {
									return `${volumes().length} 个`;
								} }),
								component(SearchField, {
									get value() {
										return filter();
									},
									onChange: (value) => filter.set(value),
									placeholder: "按名称 / 驱动 / 挂载点过滤"
								})
							];
						}
					}), component(Row, {
						gap: 6,
						get children() {
							return [
								component(Button, {
									label: "刷新",
									small: true,
									onPress: () => void load()
								}),
								component(Button, {
									get label() {
										return createOpen() ? "取消新建" : "新建存储卷";
									},
									small: true,
									onPress: () => createOpen.set(!createOpen())
								}),
								component(Button, {
									label: "清理未使用",
									small: true,
									tone: "danger",
									onPress: () => {
										pendingRemove.set(null);
										pendingPrune.set(true);
									}
								})
							];
						}
					})];
				}
			}),
			() => error() === null || volumes().length === 0 ? null : (() => {
				const __nsh_hv16 = element("view");
				prop(__nsh_hv16, "style", {
					paddingHorizontal: 14,
					paddingBottom: 8
				});
				insert(__nsh_hv16, component(Notice, {
					get message() {
						return `刷新失败：${error()}`;
					},
					tone: "danger"
				}));
				return __nsh_hv16;
			})(),
			() => notice() === null ? null : (() => {
				const __nsh_hv17 = element("view");
				prop(__nsh_hv17, "style", {
					paddingHorizontal: 14,
					paddingBottom: 8
				});
				insert(__nsh_hv17, component(Notice, { get message() {
					return notice() ?? "";
				} }));
				return __nsh_hv17;
			})(),
			() => !pendingPrune() ? null : (() => {
				const __nsh_hv18 = element("view");
				prop(__nsh_hv18, "style", {
					paddingHorizontal: 14,
					paddingBottom: 8
				});
				insert(__nsh_hv18, component(ConfirmBar, {
					message: "清理所有未被容器使用的存储卷？卷里的数据会一并删除。",
					confirmLabel: "清理",
					get busy() {
						return busy();
					},
					onConfirm: () => void prune(),
					onCancel: () => pendingPrune.set(false)
				}));
				return __nsh_hv18;
			})(),
			() => !createOpen() ? null : component(Row, {
				wrap: true,
				gap: 8,
				style: {
					paddingHorizontal: 14,
					paddingBottom: 10
				},
				get children() {
					return [
						component(Field$2, {
							get value() {
								return createName();
							},
							onChange: (text) => createName.set(text),
							placeholder: "存储卷名称，如 app-data",
							width: 220,
							onSubmit: () => void create()
						}),
						component(Field$2, {
							get value() {
								return createDriver();
							},
							onChange: (text) => createDriver.set(text),
							placeholder: "驱动，默认 local",
							width: 150,
							onSubmit: () => void create()
						}),
						component(Button, {
							get label() {
								return busy() ? "创建中…" : "创建";
							},
							tone: "primary",
							small: true,
							get disabled() {
								return busy();
							},
							onPress: () => void create()
						}),
						(() => {
							const __nsh_hv19 = element("text");
							bindProp(__nsh_hv19, "style", () => t.meta);
							const __nsh_hv20 = text("驱动留空按 local 处理。");
							append(__nsh_hv19, __nsh_hv20);
							return __nsh_hv19;
						})()
					];
				}
			}),
			() => firstLoad() ? component(Loading, { label: "正在读取存储卷列表…" }) : null,
			() => firstError() ? component(LoadError, {
				get message() {
					return error() ?? "";
				},
				onRetry: () => void load()
			}) : null,
			() => firstLoad() || firstError() ? null : component(SplitPane, {
				get left() {
					return listPane();
				},
				get right() {
					return detailPane();
				}
			})
		]);
		return __nsh_hv13;
	})();
}

//#endregion
//#region pages/networks/App.tsx
/** Docker 自带的三个网络；它们删不掉。 */
const BUILTIN_NAMES = /* @__PURE__ */ new Set([
	"bridge",
	"host",
	"none"
]);
/** operationId → provider 方法名。
*
* 清单里的 `resourceWorkbenches` 已经不参与运行，这一层映射留在页面里：
* 页面自己决定"要哪份数据"，宿主只负责把方法名和参数发给 provider。
*/
const OPERATIONS$1 = {
	containerCreate: "docker/container/create",
	containerDiff: "docker/container/diff",
	containerFilesDelete: "docker/container/files/delete",
	containerFilesList: "docker/container/files/list",
	containerKill: "docker/container/kill",
	containerLogs: "docker/container/logs",
	containerLogsWithTail: "docker/container/logs",
	containerMounts: "docker/container/mounts",
	containerPause: "docker/container/pause",
	containerRename: "docker/container/rename",
	containerStats: "docker/container/stats",
	containerTop: "docker/container/top",
	containerUnpause: "docker/container/unpause",
	containerUpdate: "docker/container/update",
	imageHistory: "docker/image/history",
	imageHistoryByRef: "docker/image/history",
	imageInspect: "docker/image/inspect",
	imageInspectByRef: "docker/image/inspect",
	imagePrune: "docker/image/prune",
	imageRemoveByRef: "docker/image/remove",
	imageTag: "docker/image/tag",
	imageTagByRef: "docker/image/tag",
	inspectContainer: "docker/container/inspect",
	inspectNetwork: "docker/network/inspect",
	inspectVolume: "docker/volume/inspect",
	listContainers: "docker/container/list",
	listImages: "docker/image/list",
	listNetworks: "docker/network/list",
	listVolumes: "docker/volume/list",
	networkConnect: "docker/network/connect",
	networkCreate: "docker/network/create",
	networkDisconnect: "docker/network/disconnect",
	networkInspectById: "docker/network/inspect",
	networkPrune: "docker/network/prune",
	networkRemoveById: "docker/network/remove",
	pullImage: "docker/image/pull",
	removeContainer: "docker/container/remove",
	removeImage: "docker/image/remove",
	removeNetwork: "docker/network/remove",
	removeVolume: "docker/volume/remove",
	restartContainer: "docker/container/restart",
	startContainer: "docker/container/start",
	stopContainer: "docker/container/stop",
	systemInfo: "docker/system/info",
	systemPrune: "docker/system/prune",
	systemUsage: "docker/system/usage",
	volumeCreate: "docker/volume/create",
	volumeInspectByName: "docker/volume/inspect",
	volumePrune: "docker/volume/prune",
	volumeRemoveByName: "docker/volume/remove"
};
/** 调一次 provider 方法；把失败折成一句人话。`confirmed` 仅为兼容旧调用点。 */
async function dispatch(operationId, input, _confirmed) {
	const method = OPERATIONS$1[operationId];
	if (!method) throw new Error(`未知的操作：${operationId}`);
	try {
		return await invoke$1(method, input ?? {}, { timeout: SLOW_TIMEOUT_MS });
	} catch (error) {
		throw new Error(errorMessage(error));
	}
}
function isBuiltin(network) {
	return BUILTIN_NAMES.has(str(network, "name", ""));
}
function isTrue(source, key) {
	return !!source && typeof source === "object" && source[key] === true;
}
/** 布尔字段 → 是 / 否。 */
function flag(source, key) {
	return isTrue(source, key) ? "是" : "否";
}
/** 键值对象 → KeyValue 的行；数组也展开成一行一项。 */
function rowsOf(source) {
	if (!source || typeof source !== "object") return [];
	return Object.entries(source).filter(([, value]) => value !== null && value !== void 0).map(([key, value]) => {
		return [key, (typeof value === "string" ? value : Array.isArray(value) ? value.map(String).join(", ") : JSON.stringify(value)) ?? String(value)];
	});
}
/** 单行输入框。SearchField 带放大镜，名称 / 驱动字段用它不合适。 */
function Field$1(props) {
	return (() => {
		const __nsh_hv0 = element("view");
		bindProp(__nsh_hv0, "style", () => ({
			flexDirection: "row",
			alignItems: "center",
			height: 28,
			width: props.width ?? 200,
			paddingHorizontal: 9,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: c.line(),
			backgroundColor: c.bg()
		}));
		const __nsh_hv1 = element("input");
		bindProp(__nsh_hv1, "value", () => props.value);
		bindProp(__nsh_hv1, "placeholder", () => props.placeholder ?? "");
		prop(__nsh_hv1, "onChange", (text) => props.onChange(text));
		prop(__nsh_hv1, "onSubmit", () => props.onSubmit?.());
		prop(__nsh_hv1, "style", {
			flex: 1,
			fontSize: 12,
			paddingHorizontal: 0,
			borderWidth: 0,
			backgroundColor: "transparent"
		});
		append(__nsh_hv0, __nsh_hv1);
		return __nsh_hv0;
	})();
}
function Networks() {
	const networks = signal([]);
	const loading = signal(true);
	const error = signal(null);
	const notice = signal(null);
	const filter = signal("");
	const selected = signal(null);
	const detail = signal(null);
	const detailLoading = signal(false);
	const detailError = signal(null);
	const createOpen = signal(false);
	const createName = signal("");
	const createDriver = signal("bridge");
	const busy = signal(false);
	const pendingRemove = signal(null);
	const pendingPrune = signal(false);
	const firstLoad = computed(() => loading() && networks().length === 0 && error() === null);
	const firstError = computed(() => error() !== null && networks().length === 0);
	const selectedNetwork = () => networks().find((network) => str(network, "id") === selected()) ?? null;
	const visible = () => {
		const needle = filter().trim().toLowerCase();
		if (needle.length === 0) return networks();
		return networks().filter((network) => {
			return [
				str(network, "name", ""),
				str(network, "id", ""),
				str(network, "driver", "")
			].join(" ").toLowerCase().includes(needle);
		});
	};
	async function loadDetail(target) {
		detailLoading.set(true);
		detailError.set(null);
		try {
			const info = await dispatch("networkInspectById", { id: target });
			if (selected() !== target) return;
			detail.set(info ?? null);
		} catch (failure) {
			if (selected() !== target) return;
			detail.set(null);
			detailError.set(errorMessage(failure));
		} finally {
			if (selected() === target) detailLoading.set(false);
		}
	}
	async function load() {
		loading.set(true);
		try {
			const result = await dispatch("listNetworks");
			const list = Array.isArray(result) ? result : arr(result, "networks");
			networks.set(list);
			error.set(null);
			const target = selected();
			if (!list.some((network) => str(network, "id") === target)) {
				const first = list.length > 0 ? str(list[0], "id", "") : "";
				selected.set(first.length > 0 ? first : null);
				detail.set(null);
			}
		} catch (failure) {
			error.set(errorMessage(failure));
		} finally {
			loading.set(false);
		}
		const target = selected();
		if (target !== null) loadDetail(target);
	}
	function select(target) {
		if (selected() === target) return;
		selected.set(target);
		detail.set(null);
		detailError.set(null);
		pendingRemove.set(null);
		loadDetail(target);
	}
	async function create() {
		const name = createName().trim();
		const driver = createDriver().trim() || "bridge";
		if (name.length === 0) {
			notice.set("请先填网络名称");
			return;
		}
		busy.set(true);
		try {
			await dispatch("networkCreate", {
				name,
				driver
			}, true);
			createOpen.set(false);
			createName.set("");
			createDriver.set("bridge");
			await load();
			const found = networks().find((network) => str(network, "name") === name);
			if (found !== void 0) {
				const id = str(found, "id");
				selected.set(id);
				detail.set(null);
				loadDetail(id);
			}
			notice.set(`已创建网络 ${name}`);
		} catch (failure) {
			notice.set(errorMessage(failure));
		} finally {
			busy.set(false);
		}
	}
	async function remove() {
		const target = pendingRemove();
		if (target === null || target.length === 0) return;
		busy.set(true);
		try {
			await dispatch("networkRemoveById", { id: target }, true);
			pendingRemove.set(null);
			if (selected() === target) selected.set(null);
			await load();
			notice.set(`已删除网络 ${target}`);
		} catch (failure) {
			notice.set(errorMessage(failure));
		} finally {
			busy.set(false);
		}
	}
	async function prune() {
		busy.set(true);
		try {
			const result = await dispatch("networkPrune", {}, true);
			const deleted = arr(result, "deleted").length;
			pendingPrune.set(false);
			await load();
			notice.set(deleted === 0 ? "没有可清理的未使用网络" : `已清理 ${deleted} 个未使用网络`);
		} catch (failure) {
			notice.set(errorMessage(failure));
		} finally {
			busy.set(false);
		}
	}
	load();
	function listPane() {
		return (() => {
			const __nsh_hv2 = element("view");
			bindProp(__nsh_hv2, "style", () => ({
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "column",
				backgroundColor: c.panel()
			}));
			insert(__nsh_hv2, () => visible().length === 0 ? component(Empty, {
				get title() {
					return filter().trim().length === 0 ? "还没有网络" : "没有匹配的网络";
				},
				get hint() {
					return filter().trim().length === 0 ? "点右上角「新建网络」创建一个；bridge / host / none 是 Docker 自带的网络。" : "清空搜索词，或换一个名称 / ID / 驱动再试。";
				}
			}) : component(List, {
				get items() {
					return visible();
				},
				keyOf: (network) => str(network, "id", ""),
				get selected() {
					return selected();
				},
				onSelect: select,
				render: (network) => component(ListRow, {
					get title() {
						return str(network, "name");
					},
					get subtitle() {
						return `${str(network, "driver")} · ${str(network, "scope")} · ${str(network, "id")}`;
					},
					get trailing() {
						return component(Row, {
							gap: 4,
							get children() {
								return [() => isBuiltin(network) ? component(Badge, { text: "内建" }) : null, () => isTrue(network, "internal") ? component(Badge, {
									text: "内部",
									tone: "info"
								}) : null];
							}
						});
					}
				})
			}));
			return __nsh_hv2;
		})();
	}
	function detailPane() {
		const network = selectedNetwork();
		if (network === null) return component(Empty, {
			title: "选择左侧的网络",
			hint: "选中后可以查看子网、已连接容器与标签，并删除这个网络。"
		});
		const name = str(network, "name");
		const id = str(network, "id");
		const info = detail();
		const builtin = isBuiltin(network);
		const labels = rowsOf(info?.Labels);
		const options = rowsOf(info?.Options);
		const ipam = info?.IPAM ?? null;
		const configs = arr(ipam, "Config");
		const containers = Object.entries(info?.Containers ?? {}).map(([key, value]) => ({
			id: key,
			entry: value && typeof value === "object" ? value : {}
		}));
		return component(Stack, {
			scroll: true,
			padding: 14,
			gap: 12,
			get children() {
				return [
					component(Row, {
						style: {
							justifyContent: "space-between",
							alignItems: "flex-start",
							gap: 12
						},
						get children() {
							return [(() => {
								const __nsh_hv3 = element("view");
								prop(__nsh_hv3, "style", {
									display: "flex",
									flexDirection: "column",
									gap: 3,
									flex: 1,
									minWidth: 0
								});
								const __nsh_hv5 = element("text");
								prop(__nsh_hv5, "numberOfLines", 1);
								bindProp(__nsh_hv5, "style", () => t.meta);
								insert(__nsh_hv5, () => `${str(network, "driver")} · ${str(network, "scope")} · ${id}`);
								append(__nsh_hv3, __nsh_hv5);
								insert(__nsh_hv3, component(Row, {
									gap: 6,
									get children() {
										return [
											(() => {
												const __nsh_hv4 = element("text");
												prop(__nsh_hv4, "numberOfLines", 1);
												bindProp(__nsh_hv4, "style", () => ({
													fontSize: 15,
													fontWeight: "600",
													color: c.text()
												}));
												insert(__nsh_hv4, name);
												return __nsh_hv4;
											})(),
											() => builtin ? component(Badge, { text: "内建" }) : null,
											() => isTrue(network, "internal") ? component(Badge, {
												text: "内部",
												tone: "info"
											}) : null
										];
									}
								}), __nsh_hv5);
								return __nsh_hv3;
							})(), component(Button, {
								label: builtin ? "内建网络不可删除" : "删除网络",
								tone: builtin ? void 0 : "danger",
								small: true,
								get disabled() {
									return builtin || busy();
								},
								onPress: () => {
									pendingPrune.set(false);
									pendingRemove.set(id);
								}
							})];
						}
					}),
					() => pendingRemove() === id ? component(ConfirmBar, {
						message: `删除网络 ${name}？已连接到它的容器会失去这个网络。`,
						confirmLabel: "删除",
						get busy() {
							return busy();
						},
						onConfirm: () => void remove(),
						onCancel: () => pendingRemove.set(null)
					}) : null,
					() => detailError() === null ? null : component(Row, {
						gap: 8,
						get children() {
							return [(() => {
								const __nsh_hv6 = element("view");
								prop(__nsh_hv6, "style", {
									flex: 1,
									minWidth: 0
								});
								insert(__nsh_hv6, component(Notice, {
									get message() {
										return `读取详情失败：${detailError()}`;
									},
									tone: "danger"
								}));
								return __nsh_hv6;
							})(), component(Button, {
								label: "重试",
								small: true,
								onPress: () => void loadDetail(id)
							})];
						}
					}),
					component(Card, {
						title: "概览",
						get hint() {
							return detailLoading() ? "读取中…" : void 0;
						},
						get children() {
							return component(KeyValue, {
								columns: 2,
								get rows() {
									return [
										["名称", name],
										["网络 ID", id],
										["驱动", str(info ?? network, "Driver", str(network, "driver"))],
										["Scope", str(info ?? network, "Scope", str(network, "scope"))],
										["内建", builtin ? "是" : "否"],
										["内部网络", flag(info ?? network, "Internal")],
										["可附加", flag(info ?? network, "Attachable")],
										["创建时间", shortTime(str(info, "Created", ""))]
									];
								}
							});
						}
					}),
					component(Card, {
						title: "IPAM 配置",
						get hint() {
							return str(ipam, "Driver", "");
						},
						get children() {
							return configs.length === 0 ? (() => {
								const __nsh_hv7 = element("text");
								bindProp(__nsh_hv7, "style", () => t.meta);
								const __nsh_hv8 = text("没有配置子网（host / none 这类内建网络通常如此）。");
								append(__nsh_hv7, __nsh_hv8);
								return __nsh_hv7;
							})() : (() => {
								const __nsh_hv9 = element("view");
								prop(__nsh_hv9, "style", {
									display: "flex",
									flexDirection: "column",
									gap: 10
								});
								insert(__nsh_hv9, () => configs.map((config, index) => (() => {
									const __nsh_hv10 = element("view");
									prop(__nsh_hv10, "style", {
										display: "flex",
										flexDirection: "column",
										gap: 4
									});
									insert(__nsh_hv10, [() => configs.length > 1 ? (() => {
										const __nsh_hv11 = element("text");
										bindProp(__nsh_hv11, "style", () => t.label);
										insert(__nsh_hv11, `子网 ${index + 1}`);
										return __nsh_hv11;
									})() : null, component(KeyValue, {
										columns: 2,
										get rows() {
											return [
												["子网", str(config, "Subnet", "-")],
												["网关", str(config, "Gateway", "-")],
												["IP 范围", str(config, "IPRange", "-")],
												["辅助地址", rowsOf(config?.AuxiliaryAddresses).map(([key, value]) => `${key}=${value}`).join(", ") || "-"]
											];
										}
									})]);
									return __nsh_hv10;
								})()));
								return __nsh_hv9;
							})();
						}
					}),
					component(Card, {
						title: "已连接容器",
						get hint() {
							return containers.length === 0 ? "无" : `${containers.length} 个`;
						},
						get children() {
							return containers.length === 0 ? (() => {
								const __nsh_hv12 = element("text");
								bindProp(__nsh_hv12, "style", () => t.meta);
								const __nsh_hv13 = text("暂无容器连接到这个网络。");
								append(__nsh_hv12, __nsh_hv13);
								return __nsh_hv12;
							})() : (() => {
								const __nsh_hv14 = element("view");
								prop(__nsh_hv14, "style", {
									display: "flex",
									flexDirection: "column"
								});
								insert(__nsh_hv14, () => containers.map(({ id: containerId, entry }) => component(Row, {
									gap: 10,
									style: { paddingVertical: 5 },
									get children() {
										return [(() => {
											const __nsh_hv15 = element("text");
											prop(__nsh_hv15, "numberOfLines", 1);
											bindProp(__nsh_hv15, "style", () => ({
												flex: 1,
												minWidth: 0,
												fontSize: 12,
												color: c.text()
											}));
											insert(__nsh_hv15, () => str(entry, "Name", containerId.slice(0, 12)));
											return __nsh_hv15;
										})(), (() => {
											const __nsh_hv16 = element("text");
											bindProp(__nsh_hv16, "style", () => ({
												...t.mono,
												color: c.muted()
											}));
											insert(__nsh_hv16, () => str(entry, "IPv4Address", "-"));
											return __nsh_hv16;
										})()];
									}
								})));
								return __nsh_hv14;
							})();
						}
					}),
					component(Card, {
						title: "标签",
						get hint() {
							return labels.length === 0 ? "无" : `${labels.length} 项`;
						},
						get children() {
							return labels.length === 0 ? (() => {
								const __nsh_hv17 = element("text");
								bindProp(__nsh_hv17, "style", () => t.meta);
								const __nsh_hv18 = text("这个网络没有设置标签。");
								append(__nsh_hv17, __nsh_hv18);
								return __nsh_hv17;
							})() : component(KeyValue, { rows: labels });
						}
					}),
					() => options.length === 0 ? null : component(Card, {
						title: "驱动选项",
						get children() {
							return component(KeyValue, { rows: options });
						}
					})
				];
			}
		});
	}
	return (() => {
		const __nsh_hv19 = element("view");
		bindProp(__nsh_hv19, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		insert(__nsh_hv19, [
			component(Row, {
				wrap: true,
				gap: 8,
				style: {
					paddingHorizontal: 14,
					paddingVertical: 10,
					justifyContent: "space-between"
				},
				get children() {
					return [component(Row, {
						gap: 8,
						get children() {
							return [
								(() => {
									const __nsh_hv20 = element("text");
									bindProp(__nsh_hv20, "style", () => t.h1);
									const __nsh_hv21 = text("网络");
									append(__nsh_hv20, __nsh_hv21);
									return __nsh_hv20;
								})(),
								component(Badge, { get text() {
									return `${networks().length} 个`;
								} }),
								component(SearchField, {
									get value() {
										return filter();
									},
									onChange: (value) => filter.set(value),
									placeholder: "按名称 / ID / 驱动过滤"
								})
							];
						}
					}), component(Row, {
						gap: 6,
						get children() {
							return [
								component(Button, {
									label: "刷新",
									small: true,
									onPress: () => void load()
								}),
								component(Button, {
									get label() {
										return createOpen() ? "取消新建" : "新建网络";
									},
									small: true,
									onPress: () => createOpen.set(!createOpen())
								}),
								component(Button, {
									label: "清理未使用",
									small: true,
									tone: "danger",
									onPress: () => {
										pendingRemove.set(null);
										pendingPrune.set(true);
									}
								})
							];
						}
					})];
				}
			}),
			() => error() === null || networks().length === 0 ? null : (() => {
				const __nsh_hv22 = element("view");
				prop(__nsh_hv22, "style", {
					paddingHorizontal: 14,
					paddingBottom: 8
				});
				insert(__nsh_hv22, component(Notice, {
					get message() {
						return `刷新失败：${error()}`;
					},
					tone: "danger"
				}));
				return __nsh_hv22;
			})(),
			() => notice() === null ? null : (() => {
				const __nsh_hv23 = element("view");
				prop(__nsh_hv23, "style", {
					paddingHorizontal: 14,
					paddingBottom: 8
				});
				insert(__nsh_hv23, component(Notice, { get message() {
					return notice() ?? "";
				} }));
				return __nsh_hv23;
			})(),
			() => !pendingPrune() ? null : (() => {
				const __nsh_hv24 = element("view");
				prop(__nsh_hv24, "style", {
					paddingHorizontal: 14,
					paddingBottom: 8
				});
				insert(__nsh_hv24, component(ConfirmBar, {
					message: "清理所有未被容器使用的网络？",
					confirmLabel: "清理",
					get busy() {
						return busy();
					},
					onConfirm: () => void prune(),
					onCancel: () => pendingPrune.set(false)
				}));
				return __nsh_hv24;
			})(),
			() => !createOpen() ? null : component(Row, {
				wrap: true,
				gap: 8,
				style: {
					paddingHorizontal: 14,
					paddingBottom: 10
				},
				get children() {
					return [
						component(Field$1, {
							get value() {
								return createName();
							},
							onChange: (text) => createName.set(text),
							placeholder: "网络名称，如 app-net",
							width: 220,
							onSubmit: () => void create()
						}),
						component(Field$1, {
							get value() {
								return createDriver();
							},
							onChange: (text) => createDriver.set(text),
							placeholder: "驱动，默认 bridge",
							width: 150,
							onSubmit: () => void create()
						}),
						component(Button, {
							get label() {
								return busy() ? "创建中…" : "创建";
							},
							tone: "primary",
							small: true,
							get disabled() {
								return busy();
							},
							onPress: () => void create()
						}),
						(() => {
							const __nsh_hv25 = element("text");
							bindProp(__nsh_hv25, "style", () => t.meta);
							const __nsh_hv26 = text("驱动留空按 bridge 处理。");
							append(__nsh_hv25, __nsh_hv26);
							return __nsh_hv25;
						})()
					];
				}
			}),
			() => firstLoad() ? component(Loading, { label: "正在读取网络列表…" }) : null,
			() => firstError() ? component(LoadError, {
				get message() {
					return error() ?? "";
				},
				onRetry: () => void load()
			}) : null,
			() => firstLoad() || firstError() ? null : component(SplitPane, {
				get left() {
					return listPane();
				},
				get right() {
					return detailPane();
				}
			})
		]);
		return __nsh_hv19;
	})();
}

//#endregion
//#region pages/overview/App.tsx
/** operationId → provider 方法名（清单里的工作台声明已不参与运行）。 */
const OPERATIONS = {
	containerCreate: "docker/container/create",
	containerDiff: "docker/container/diff",
	containerFilesDelete: "docker/container/files/delete",
	containerFilesList: "docker/container/files/list",
	containerKill: "docker/container/kill",
	containerLogs: "docker/container/logs",
	containerLogsWithTail: "docker/container/logs",
	containerMounts: "docker/container/mounts",
	containerPause: "docker/container/pause",
	containerRename: "docker/container/rename",
	containerStats: "docker/container/stats",
	containerTop: "docker/container/top",
	containerUnpause: "docker/container/unpause",
	containerUpdate: "docker/container/update",
	imageHistory: "docker/image/history",
	imageHistoryByRef: "docker/image/history",
	imageInspect: "docker/image/inspect",
	imageInspectByRef: "docker/image/inspect",
	imagePrune: "docker/image/prune",
	imageRemoveByRef: "docker/image/remove",
	imageTag: "docker/image/tag",
	imageTagByRef: "docker/image/tag",
	inspectContainer: "docker/container/inspect",
	inspectNetwork: "docker/network/inspect",
	inspectVolume: "docker/volume/inspect",
	listContainers: "docker/container/list",
	listImages: "docker/image/list",
	listNetworks: "docker/network/list",
	listVolumes: "docker/volume/list",
	networkConnect: "docker/network/connect",
	networkCreate: "docker/network/create",
	networkDisconnect: "docker/network/disconnect",
	networkInspectById: "docker/network/inspect",
	networkPrune: "docker/network/prune",
	networkRemoveById: "docker/network/remove",
	pullImage: "docker/image/pull",
	removeContainer: "docker/container/remove",
	removeImage: "docker/image/remove",
	removeNetwork: "docker/network/remove",
	removeVolume: "docker/volume/remove",
	restartContainer: "docker/container/restart",
	startContainer: "docker/container/start",
	stopContainer: "docker/container/stop",
	systemInfo: "docker/system/info",
	systemPrune: "docker/system/prune",
	systemUsage: "docker/system/usage",
	volumeCreate: "docker/volume/create",
	volumeInspectByName: "docker/volume/inspect",
	volumePrune: "docker/volume/prune",
	volumeRemoveByName: "docker/volume/remove"
};
/** 调一次 provider 方法。 */
async function invoke(operationId, params = {}) {
	const method = OPERATIONS[operationId];
	if (!method) throw new Error(`未知的操作：${operationId}`);
	return await invoke$1(method, params, { timeout: SLOW_TIMEOUT_MS });
}
function Overview() {
	const usage = signal(null);
	const loading = signal(true);
	const error = signal(null);
	const refreshed = signal(null);
	async function load() {
		loading.set(true);
		error.set(null);
		try {
			const result = await invoke("systemUsage", {});
			usage.set(result ?? {});
			refreshed.set((/* @__PURE__ */ new Date()).toLocaleTimeString());
		} catch (failure) {
			error.set(errorMessage(failure));
		} finally {
			loading.set(false);
		}
	}
	load();
	const body = () => {
		if (loading() && usage() === null && error() === null) return component(Loading, { label: "正在读取引擎用量…" });
		if (error() !== null && usage() === null) return component(LoadError, {
			get message() {
				return error() ?? "";
			},
			onRetry: () => void load()
		});
		const u = usage() ?? {};
		const running = Number(u.containers_running ?? 0);
		const total = Number(u.containers_total ?? 0);
		const diskUsed = Number(u.disk_used_bytes ?? 0);
		const reclaimable = Number(u.disk_reclaimable_bytes ?? 0);
		const diskTotal = diskUsed + reclaimable;
		const memory = Number(u.containers_memory_bytes ?? 0);
		const engineUp = u.engine === true || running > 0 || total > 0;
		return component(Stack, {
			scroll: true,
			padding: 16,
			gap: 14,
			get children() {
				return [
					component(Row, {
						style: { justifyContent: "space-between" },
						get children() {
							return [component(Row, {
								gap: 8,
								get children() {
									return [
										(() => {
											const __nsh_hv0 = element("text");
											bindProp(__nsh_hv0, "style", () => t.h1);
											const __nsh_hv1 = text("Docker 引擎");
											append(__nsh_hv0, __nsh_hv1);
											return __nsh_hv0;
										})(),
										component(Badge, {
											text: engineUp ? "运行中" : "不可用",
											tone: engineUp ? "ok" : "danger"
										}),
										(() => {
											const __nsh_hv2 = element("text");
											bindProp(__nsh_hv2, "style", () => t.meta);
											insert(__nsh_hv2, () => `Server ${str(u, "server_version", "未知")} · ${Number(u.cpu_count ?? 0)} CPU`);
											return __nsh_hv2;
										})()
									];
								}
							}), component(Row, {
								gap: 8,
								get children() {
									return [() => refreshed() === null ? null : (() => {
										const __nsh_hv3 = element("text");
										bindProp(__nsh_hv3, "style", () => t.meta);
										insert(__nsh_hv3, () => `${refreshed()} 更新`);
										return __nsh_hv3;
									})(), component(Button, {
										get label() {
											return loading() ? "刷新中…" : "刷新";
										},
										small: true,
										get disabled() {
											return loading();
										},
										onPress: () => void load()
									})];
								}
							})];
						}
					}),
					() => error() === null ? null : (() => {
						const __nsh_hv4 = element("text");
						bindProp(__nsh_hv4, "style", () => ({
							fontSize: 12,
							color: c.danger()
						}));
						insert(__nsh_hv4, () => error());
						return __nsh_hv4;
					})(),
					component(Row, {
						gap: 10,
						wrap: true,
						get children() {
							return [
								component(Stat, {
									label: "容器",
									value: `${running} / ${total}`,
									hint: "运行中 / 总数"
								}),
								component(Stat, {
									label: "镜像",
									get value() {
										return String(Number(u.images ?? 0));
									},
									hint: "本地镜像"
								}),
								component(Stat, {
									label: "数据卷",
									get value() {
										return String(Number(u.volumes ?? 0));
									},
									hint: "逻辑卷"
								}),
								component(Stat, {
									label: "网络",
									get value() {
										return String(Number(u.networks ?? 0));
									},
									hint: "网络数"
								})
							];
						}
					}),
					component(Card, {
						title: "磁盘占用",
						hint: "已用 + 可回收",
						get children() {
							return [
								component(Meter, {
									ratio: diskTotal > 0 ? diskUsed / diskTotal : 0,
									label: "已用空间",
									get caption() {
										return `${humanBytes(diskUsed)} / ${humanBytes(diskTotal)}`;
									}
								}),
								component(Row, {
									gap: 10,
									wrap: true,
									get children() {
										return [component(Badge, {
											get text() {
												return `已用 ${humanBytes(diskUsed)}`;
											},
											tone: "info"
										}), component(Badge, {
											get text() {
												return `可回收 ${humanBytes(reclaimable)}（${percent(reclaimable, diskTotal)}）`;
											},
											tone: reclaimable > 0 ? "warn" : "neutral"
										})];
									}
								}),
								() => reclaimable > 0 ? (() => {
									const __nsh_hv5 = element("text");
									bindProp(__nsh_hv5, "style", () => t.meta);
									const __nsh_hv6 = text("在「镜像」页可以清理悬空镜像来回收这部分空间。");
									append(__nsh_hv5, __nsh_hv6);
									return __nsh_hv5;
								})() : (() => {
									const __nsh_hv7 = element("text");
									bindProp(__nsh_hv7, "style", () => t.meta);
									const __nsh_hv8 = text("没有可回收空间。");
									append(__nsh_hv7, __nsh_hv8);
									return __nsh_hv7;
								})()
							];
						}
					}),
					component(Card, {
						title: "运行中容器的资源",
						hint: "所有运行中容器的合计",
						get children() {
							return component(Row, {
								gap: 10,
								wrap: true,
								get children() {
									return [
										component(Stat, {
											label: "内存合计",
											get value() {
												return humanBytes(memory);
											},
											hint: "cgroup 统计"
										}),
										component(Stat, {
											label: "CPU 估计",
											get value() {
												return `${Number(u.containers_cpu_percent ?? 0).toFixed(1)}%`;
											},
											hint: "相对全部核心"
										}),
										component(Stat, {
											label: "运行中容器",
											get value() {
												return String(running);
											},
											hint: `共 ${total} 个`
										})
									];
								}
							});
						}
					}),
					(() => {
						const __nsh_hv9 = element("text");
						bindProp(__nsh_hv9, "style", () => t.meta);
						const __nsh_hv10 = text("数据来自 docker system 统计：镜像与层的大小包含共享层，因此各项相加可能大于磁盘占用。");
						append(__nsh_hv9, __nsh_hv10);
						return __nsh_hv9;
					})()
				];
			}
		});
	};
	return (() => {
		const __nsh_hv11 = element("view");
		bindProp(__nsh_hv11, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		insert(__nsh_hv11, () => body());
		return __nsh_hv11;
	})();
}

//#endregion
//#region pages/log-viewer/App.tsx
/** 自动刷新间隔（旧页 FOLLOW_MS 同值）。 */
const FOLLOW_MS = 2e3;
/** 尾行档位。「全部」是 provider 的硬上限（MAX_LOG_TAIL = 5000）。 */
const TAILS = [
	{
		label: "100",
		value: 100
	},
	{
		label: "200",
		value: 200
	},
	{
		label: "500",
		value: 500
	},
	{
		label: "1000",
		value: 1e3
	},
	{
		label: "全部",
		value: 5e3
	}
];
/** 把 provider 拼好的日志切成行；去掉末尾换行带来的空行。 */
function toLines(text) {
	const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
	return trimmed.length === 0 ? [] : trimmed.split("\n");
}
/** 本地时钟（HH:MM:SS），用于「更新于」。 */
function nowClock() {
	const now = /* @__PURE__ */ new Date();
	const two = (value) => String(value).padStart(2, "0");
	return `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
}
/** 小按钮：`active` 用 accessor，样式读的是当前值（写在 style 绑定里才响应式）。 */
function chip$1(label, active, onPress, testLabel) {
	return (() => {
		const __nsh_hv0 = element("view");
		prop(__nsh_hv0, "onPress", onPress);
		prop(__nsh_hv0, "role", "button");
		prop(__nsh_hv0, "accessibilityLabel", testLabel ?? label);
		bindProp(__nsh_hv0, "style", () => ({
			flexDirection: "row",
			alignItems: "center",
			paddingHorizontal: 10,
			paddingVertical: 5,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: active() ? c.accent() : c.line(),
			backgroundColor: active() ? c.accent() : "transparent"
		}));
		const __nsh_hv1 = element("text");
		bindProp(__nsh_hv1, "style", () => ({
			...t.meta,
			color: active() ? c.accentText() : c.text()
		}));
		insert(__nsh_hv1, label);
		append(__nsh_hv0, __nsh_hv1);
		return __nsh_hv0;
	})();
}
const containerId$4 = (row) => str(row, "id", "");
const containerName$5 = (row) => str(row, "name", "");
const containerImage$4 = (row) => str(row, "image", "");
const containerState$4 = (row) => str(row, "state", "");
function stateTone$5(state) {
	if (state === "running") return "ok";
	if (state === "paused" || state === "restarting") return "warn";
	if (state === "exited" || state === "dead") return "danger";
	return "neutral";
}
function LogViewer() {
	const tail = signal(500);
	const raw = signal("");
	const loading = signal(true);
	const busy = signal(false);
	const error = signal(null);
	const updatedAt = signal("");
	const follow = signal(false);
	const cleared = signal(false);
	const containers = signal([]);
	const containerQuery = signal("");
	const containersLoading = signal(true);
	const containersError = signal(null);
	const selectedId = signal(null);
	const selectedName = signal("");
	const pickerOpen = signal(true);
	let seq = 0;
	function visibleContainers() {
		const needle = containerQuery().trim().toLowerCase();
		if (needle.length === 0) return containers();
		return containers().filter((row) => `${containerName$5(row)} ${containerImage$4(row)}`.toLowerCase().includes(needle));
	}
	function selectedSummary() {
		const id = selectedId();
		if (id === null) return "";
		const row = containers().find((item) => containerId$4(item) === id);
		return row === void 0 ? selectedName() : `${containerName$5(row)} · ${containerImage$4(row)}`;
	}
	function resetData() {
		raw.set("");
		error.set(null);
		updatedAt.set("");
		cleared.set(false);
	}
	function clearSelection() {
		selectedId.set(null);
		selectedName.set("");
		resetData();
		loading.set(false);
		follow.set(false);
		pickerOpen.set(true);
	}
	function selectContainer(row) {
		const id = containerId$4(row);
		if (id.length === 0) return;
		if (selectedId() === id) {
			pickerOpen.set(false);
			return;
		}
		selectedId.set(id);
		selectedName.set(containerName$5(row));
		pickerOpen.set(false);
		resetData();
		loading.set(true);
		load(true);
	}
	async function loadContainers() {
		containersLoading.set(true);
		try {
			const result = await invoke$1("docker/container/list", {}, { timeout: SLOW_TIMEOUT_MS });
			const list = Array.isArray(result) ? result : arr(result, "containers");
			containers.set(list);
			containersError.set(null);
			const current = selectedId();
			if (current !== null && !list.some((row) => containerId$4(row) === current)) clearSelection();
		} catch (failure) {
			containersError.set(errorMessage(failure));
		} finally {
			containersLoading.set(false);
		}
	}
	async function load(force = false) {
		const id = selectedId();
		if (id === null) return;
		if (busy() && !force) return;
		const mine = ++seq;
		busy.set(true);
		if (raw() === "") loading.set(true);
		try {
			const result = await invoke$1("docker/container/logs", {
				id,
				tail: String(tail())
			}, { timeout: SLOW_TIMEOUT_MS });
			if (mine !== seq) return;
			raw.set(str(result, "logs", ""));
			cleared.set(false);
			updatedAt.set(nowClock());
			error.set(null);
		} catch (failure) {
			if (mine !== seq) return;
			error.set(errorMessage(failure));
		} finally {
			if (mine === seq) {
				busy.set(false);
				loading.set(false);
			}
		}
	}
	function pickTail(value) {
		if (tail() === value) return;
		tail.set(value);
		load(true);
	}
	effect(() => {
		if (!follow() || selectedId() === null) return;
		const timer = setInterval(() => {
			load();
		}, FOLLOW_MS);
		cleanup(() => clearInterval(timer));
	});
	function view() {
		const all = toLines(raw());
		const shown = all.slice(-2e3);
		return {
			total: all.length,
			shown: shown.length,
			text: shown.join("\n"),
			truncated: all.length > shown.length
		};
	}
	function pickerList() {
		if (!pickerOpen()) return null;
		return (() => {
			const __nsh_hv2 = element("view");
			bindProp(__nsh_hv2, "style", () => ({
				display: "flex",
				flexDirection: "column",
				gap: 4,
				marginHorizontal: 14,
				marginBottom: 8,
				padding: 6,
				borderWidth: 1,
				borderColor: c.line(),
				borderRadius: r.card,
				backgroundColor: c.panel()
			}));
			insert(__nsh_hv2, () => containersLoading() && containers().length === 0 ? (() => {
				const __nsh_hv3 = element("text");
				bindProp(__nsh_hv3, "style", () => t.meta);
				const __nsh_hv4 = text("正在读取容器列表…");
				append(__nsh_hv3, __nsh_hv4);
				return __nsh_hv3;
			})() : containersError() !== null && containers().length === 0 ? component(Row, {
				gap: 8,
				get children() {
					return [(() => {
						const __nsh_hv5 = element("text");
						bindProp(__nsh_hv5, "style", () => ({
							...t.meta,
							color: c.danger()
						}));
						insert(__nsh_hv5, () => `容器列表读取失败：${containersError()}`);
						return __nsh_hv5;
					})(), component(Button, {
						label: "重试",
						small: true,
						onPress: () => void loadContainers()
					})];
				}
			}) : visibleContainers().length === 0 ? (() => {
				const __nsh_hv6 = element("text");
				bindProp(__nsh_hv6, "style", () => t.meta);
				insert(__nsh_hv6, () => containers().length === 0 ? "这个连接里没有容器。" : "没有匹配的容器，换个关键词试试。");
				return __nsh_hv6;
			})() : (() => {
				const __nsh_hv7 = element("scroll");
				prop(__nsh_hv7, "style", { maxHeight: 168 });
				const __nsh_hv8 = element("view");
				prop(__nsh_hv8, "style", {
					display: "flex",
					flexDirection: "column"
				});
				insert(__nsh_hv8, () => visibleContainers().map((row) => containerOption(row)));
				append(__nsh_hv7, __nsh_hv8);
				return __nsh_hv7;
			})());
			return __nsh_hv2;
		})();
	}
	function containerOption(row) {
		const id = containerId$4(row);
		const state = containerState$4(row);
		return (() => {
			const __nsh_hv9 = element("view");
			prop(__nsh_hv9, "onPress", () => selectContainer(row));
			prop(__nsh_hv9, "role", "button");
			bindProp(__nsh_hv9, "accessibilityLabel", () => `容器 ${containerName$5(row)}`);
			bindProp(__nsh_hv9, "style", () => ({
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				gap: 8,
				paddingHorizontal: 8,
				paddingVertical: 6,
				borderRadius: r.control,
				backgroundColor: selectedId() === id ? c.hover() : "transparent"
			}));
			const __nsh_hv10 = element("text");
			prop(__nsh_hv10, "numberOfLines", 1);
			bindProp(__nsh_hv10, "style", () => ({
				fontSize: 12,
				fontWeight: "500",
				color: c.text(),
				width: 180
			}));
			insert(__nsh_hv10, () => containerName$5(row));
			const __nsh_hv11 = element("text");
			prop(__nsh_hv11, "numberOfLines", 1);
			bindProp(__nsh_hv11, "style", () => ({
				...t.mono,
				fontSize: 11,
				color: c.muted(),
				flex: 1,
				minWidth: 0
			}));
			insert(__nsh_hv11, () => containerImage$4(row));
			append(__nsh_hv9, __nsh_hv10);
			append(__nsh_hv9, __nsh_hv11);
			insert(__nsh_hv9, component(Badge, {
				get text() {
					return state.length === 0 ? "unknown" : state;
				},
				get tone() {
					return stateTone$5(state);
				}
			}));
			return __nsh_hv9;
		})();
	}
	function pickerToggle() {
		return component(Button, {
			get label() {
				return pickerOpen() ? "收起列表" : selectedId() === null ? "选择容器" : "切换容器";
			},
			small: true,
			onPress: () => pickerOpen.set(!pickerOpen())
		});
	}
	function containerBar() {
		return (() => {
			const __nsh_hv12 = element("view");
			prop(__nsh_hv12, "style", {
				display: "flex",
				flexDirection: "column",
				flexShrink: 0
			});
			insert(__nsh_hv12, [component(Row, {
				wrap: true,
				gap: 8,
				get style() {
					return {
						paddingHorizontal: 14,
						paddingBottom: pickerOpen() ? 6 : 10
					};
				},
				get children() {
					return [
						component(SearchField, {
							get value() {
								return containerQuery();
							},
							onChange: (text) => {
								containerQuery.set(text);
								if (!pickerOpen()) pickerOpen.set(true);
							},
							placeholder: "按名称 / 镜像过滤容器",
							width: 280
						}),
						(() => {
							const __nsh_hv13 = element("text");
							bindProp(__nsh_hv13, "style", () => t.meta);
							insert(__nsh_hv13, () => `${visibleContainers().length} / ${containers().length} 个容器`);
							return __nsh_hv13;
						})(),
						() => selectedId() === null ? (() => {
							const __nsh_hv14 = element("text");
							bindProp(__nsh_hv14, "style", () => t.meta);
							const __nsh_hv15 = text("未选择容器");
							append(__nsh_hv14, __nsh_hv15);
							return __nsh_hv14;
						})() : (() => {
							const __nsh_hv16 = element("text");
							prop(__nsh_hv16, "numberOfLines", 1);
							bindProp(__nsh_hv16, "style", () => ({
								...t.meta,
								color: c.text(),
								maxWidth: 360
							}));
							insert(__nsh_hv16, () => selectedSummary());
							return __nsh_hv16;
						})(),
						(() => {
							const __nsh_hv17 = element("view");
							prop(__nsh_hv17, "style", { flex: 1 });
							return __nsh_hv17;
						})(),
						component(Button, {
							label: "刷新列表",
							small: true,
							onPress: () => void loadContainers()
						}),
						() => pickerToggle()
					];
				}
			}), () => pickerList()]);
			return __nsh_hv12;
		})();
	}
	function toolbar() {
		return (() => {
			const __nsh_hv18 = element("view");
			prop(__nsh_hv18, "style", {
				flexDirection: "row",
				alignItems: "center",
				flexWrap: "wrap",
				gap: 8,
				paddingHorizontal: 14,
				paddingVertical: 10,
				flexShrink: 0
			});
			const __nsh_hv19 = element("text");
			bindProp(__nsh_hv19, "style", () => ({
				...t.h1,
				color: c.text()
			}));
			const __nsh_hv20 = text("容器日志");
			append(__nsh_hv19, __nsh_hv20);
			const __nsh_hv24 = element("view");
			prop(__nsh_hv24, "style", { flex: 1 });
			append(__nsh_hv18, __nsh_hv19);
			append(__nsh_hv18, __nsh_hv24);
			insert(__nsh_hv18, () => selectedId() === null ? (() => {
				const __nsh_hv21 = element("text");
				bindProp(__nsh_hv21, "style", () => ({
					...t.meta,
					color: c.muted()
				}));
				const __nsh_hv22 = text("未选择容器");
				append(__nsh_hv21, __nsh_hv22);
				return __nsh_hv21;
			})() : updatedAt() === "" ? null : (() => {
				const __nsh_hv23 = element("text");
				bindProp(__nsh_hv23, "style", () => ({
					...t.meta,
					color: c.muted()
				}));
				insert(__nsh_hv23, () => `更新于 ${updatedAt()}`);
				return __nsh_hv23;
			})(), __nsh_hv24);
			insert(__nsh_hv18, () => selectedId() === null ? null : [
				(() => {
					const __nsh_hv25 = element("text");
					bindProp(__nsh_hv25, "style", () => ({
						...t.label,
						color: c.muted()
					}));
					const __nsh_hv26 = text("显示行数");
					append(__nsh_hv25, __nsh_hv26);
					return __nsh_hv25;
				})(),
				() => TAILS.map((option) => chip$1(option.label, () => tail() === option.value, () => pickTail(option.value), `行数 ${option.label}`)),
				() => chip$1(follow() ? "自动刷新 · 开" : "自动刷新 · 关", follow, () => follow.set(!follow()), "自动刷新"),
				() => chip$1("清屏", () => cleared(), () => cleared.set(true), "清屏"),
				component(Button, {
					label: "刷新",
					small: true,
					onPress: () => void load(true)
				})
			]);
			return __nsh_hv18;
		})();
	}
	function selectionGate() {
		if (containersError() !== null && containers().length === 0) return component(LoadError, {
			get message() {
				return containersError() ?? "";
			},
			onRetry: () => void loadContainers()
		});
		if (containersLoading() && containers().length === 0) return component(Loading, { label: "正在读取容器列表…" });
		if (containers().length === 0) return component(Empty, {
			title: "这个连接里没有容器",
			hint: "docker/container/list 返回了空列表（包含已停止的容器）：先在 Docker 里创建或启动一个容器。",
			get action() {
				return component(Button, {
					label: "重新读取容器列表",
					small: true,
					onPress: () => void loadContainers()
				});
			}
		});
		return component(Empty, {
			title: "先选择一个容器",
			get hint() {
				return `连接里有 ${containers().length} 个容器：在上方列表里点一个，页面会读取它的日志。`;
			}
		});
	}
	function body() {
		if (selectedId() === null) return selectionGate();
		return (() => {
			const __nsh_hv27 = element("view");
			prop(__nsh_hv27, "style", {
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "column"
			});
			insert(__nsh_hv27, [() => error() !== null && raw() !== "" ? component(Row, {
				gap: 8,
				style: {
					alignItems: "center",
					paddingHorizontal: 14,
					paddingTop: 8,
					flexWrap: "wrap"
				},
				get children() {
					return [component(Notice, { get message() {
						return `刷新失败：${error()}`;
					} }), component(Button, {
						label: "重试",
						small: true,
						onPress: () => void load(true)
					})];
				}
			}) : null, () => error() !== null && raw() === "" ? component(LoadError, {
				get message() {
					return error() ?? "";
				},
				onRetry: () => void load(true)
			}) : loading() && raw() === "" ? component(Loading, { label: "正在读取容器日志…" }) : cleared() || toLines(raw()).length === 0 ? component(Empty, {
				get title() {
					return cleared() ? "已清屏" : "暂无日志";
				},
				get hint() {
					return cleared() ? "点「刷新」重新读取；自动刷新开着时 2 秒后自动恢复。" : "这个容器在所选行数内没有输出日志，试试更大的行数。";
				}
			}) : (() => {
				const __nsh_hv28 = element("scroll");
				prop(__nsh_hv28, "style", {
					flex: 1,
					minHeight: 0
				});
				const __nsh_hv29 = element("view");
				prop(__nsh_hv29, "style", { padding: 12 });
				const __nsh_hv30 = element("text");
				prop(__nsh_hv30, "selectable", true);
				bindProp(__nsh_hv30, "style", () => ({
					...t.mono,
					color: c.text(),
					lineHeight: 18
				}));
				insert(__nsh_hv30, () => view().text);
				append(__nsh_hv29, __nsh_hv30);
				append(__nsh_hv28, __nsh_hv29);
				return __nsh_hv28;
			})()]);
			return __nsh_hv27;
		})();
	}
	function footer() {
		return (() => {
			const __nsh_hv31 = element("view");
			bindProp(__nsh_hv31, "style", () => ({
				flexDirection: "row",
				alignItems: "center",
				flexWrap: "wrap",
				gap: 8,
				paddingHorizontal: 14,
				paddingVertical: 6,
				borderTopWidth: 1,
				borderColor: c.line(),
				flexShrink: 0
			}));
			const __nsh_hv32 = element("text");
			bindProp(__nsh_hv32, "style", () => ({
				...t.meta,
				color: c.muted()
			}));
			insert(__nsh_hv32, () => selectedId() === null ? "选择容器后显示日志行数" : view().total === 0 ? "没有可显示的行" : view().truncated ? `显示最后 ${view().shown} 行（共 ${view().total} 行，已省略前 ${view().total - view().shown} 行）` : `显示最后 ${view().shown} 行`);
			const __nsh_hv33 = element("view");
			prop(__nsh_hv33, "style", { flex: 1 });
			const __nsh_hv34 = element("text");
			bindProp(__nsh_hv34, "style", () => ({
				...t.meta,
				color: c.muted()
			}));
			insert(__nsh_hv34, () => tail() === 5e3 ? "tail 全部（provider 上限 5000）" : `tail ${tail()}`);
			const __nsh_hv35 = element("text");
			bindProp(__nsh_hv35, "style", () => ({
				...t.meta,
				color: c.muted()
			}));
			const __nsh_hv36 = text("长行自动折行 · 可选中复制");
			append(__nsh_hv35, __nsh_hv36);
			append(__nsh_hv31, __nsh_hv32);
			append(__nsh_hv31, __nsh_hv33);
			append(__nsh_hv31, __nsh_hv34);
			append(__nsh_hv31, __nsh_hv35);
			return __nsh_hv31;
		})();
	}
	loadContainers();
	return (() => {
		const __nsh_hv37 = element("view");
		bindProp(__nsh_hv37, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		const __nsh_hv38 = element("view");
		bindProp(__nsh_hv38, "style", () => hairline());
		append(__nsh_hv37, __nsh_hv38);
		insert(__nsh_hv37, () => toolbar(), __nsh_hv38);
		insert(__nsh_hv37, [
			() => containerBar(),
			() => body(),
			() => footer()
		]);
		return __nsh_hv37;
	})();
}

//#endregion
//#region pages/processes/App.tsx
/** 列宽与对齐；没有登记的列平分剩余宽度，COMMAND / CMD 吃满剩余。 */
const COLUMNS = {
	UID: { width: 76 },
	USER: { width: 80 },
	PID: {
		width: 64,
		align: "right"
	},
	PPID: {
		width: 64,
		align: "right"
	},
	C: {
		width: 38,
		align: "right"
	},
	"%CPU": {
		width: 58,
		align: "right"
	},
	"%MEM": {
		width: 58,
		align: "right"
	},
	VSZ: {
		width: 84,
		align: "right"
	},
	RSS: {
		width: 84,
		align: "right"
	},
	NI: {
		width: 42,
		align: "right"
	},
	STAT: { width: 54 },
	STIME: { width: 84 },
	START: { width: 86 },
	TIME: {
		width: 86,
		align: "right"
	},
	TTY: { width: 58 },
	COMMAND: {},
	CMD: {}
};
/** 数字列走 t.mono；只有“命令行”用正文排版。 */
const NUMERIC = [
	"PID",
	"PPID",
	"C",
	"%CPU",
	"%MEM",
	"VSZ",
	"RSS",
	"NI",
	"TIME",
	"UID",
	"TTY",
	"STIME",
	"START"
];
function alignOf(title) {
	return COLUMNS[title]?.align ?? "left";
}
function cellStyle(title) {
	const meta = COLUMNS[title];
	if (meta === void 0 || meta.width === void 0) return {
		flex: 1,
		minWidth: 0,
		textAlign: alignOf(title)
	};
	return {
		width: meta.width,
		flexShrink: 0,
		textAlign: alignOf(title)
	};
}
/** ps 的单元格可能来自对象（titles 作键）或数组（与 titles 同序）。 */
function cell(row, titles, title) {
	if (Array.isArray(row)) {
		const index = titles.indexOf(title);
		return index < 0 ? "" : String(row[index] ?? "");
	}
	const record = row;
	const direct = record[title];
	if (typeof direct === "string") return direct;
	if (typeof direct === "number") return String(direct);
	const key = Object.keys(record).find((name) => name.toLowerCase() === title.toLowerCase());
	if (key === void 0) return "";
	return str(record, key, "");
}
function inferTitles(rows) {
	const first = rows[0];
	if (first === void 0) return [];
	if (Array.isArray(first)) return first.map((_, index) => String(index));
	return Object.keys(first);
}
const containerId$3 = (row) => str(row, "id", "");
const containerName$4 = (row) => str(row, "name", "");
const containerImage$3 = (row) => str(row, "image", "");
const containerState$3 = (row) => str(row, "state", "");
function stateTone$4(state) {
	if (state === "running") return "ok";
	if (state === "paused" || state === "restarting") return "warn";
	if (state === "exited" || state === "dead") return "danger";
	return "neutral";
}
function Processes() {
	const rows = signal([]);
	const titles = signal([]);
	const stats = signal(null);
	const loading = signal(true);
	const error = signal(null);
	const busy = signal(false);
	const selected = signal(null);
	const containers = signal([]);
	const containerQuery = signal("");
	const containersLoading = signal(true);
	const containersError = signal(null);
	const selectedId = signal(null);
	const selectedName = signal("");
	const pickerOpen = signal(true);
	let seq = 0;
	function visibleContainers() {
		const needle = containerQuery().trim().toLowerCase();
		if (needle.length === 0) return containers();
		return containers().filter((row) => `${containerName$4(row)} ${containerImage$3(row)}`.toLowerCase().includes(needle));
	}
	function selectedSummary() {
		const id = selectedId();
		if (id === null) return "";
		const row = containers().find((item) => containerId$3(item) === id);
		return row === void 0 ? selectedName() : `${containerName$4(row)} · ${containerImage$3(row)}`;
	}
	async function loadContainers() {
		containersLoading.set(true);
		try {
			const result = await invoke$1("docker/container/list", {}, { timeout: SLOW_TIMEOUT_MS });
			const list = Array.isArray(result) ? result : arr(result, "containers");
			containers.set(list);
			containersError.set(null);
			const current = selectedId();
			if (current !== null && !list.some((row) => containerId$3(row) === current)) clearSelection();
		} catch (failure) {
			containersError.set(errorMessage(failure));
		} finally {
			containersLoading.set(false);
		}
	}
	function resetData() {
		rows.set([]);
		titles.set([]);
		stats.set(null);
		selected.set(null);
		error.set(null);
	}
	function clearSelection() {
		selectedId.set(null);
		selectedName.set("");
		resetData();
		loading.set(false);
		pickerOpen.set(true);
	}
	function selectContainer(row) {
		const id = containerId$3(row);
		if (id.length === 0) return;
		if (selectedId() === id) {
			pickerOpen.set(false);
			return;
		}
		selectedId.set(id);
		selectedName.set(containerName$4(row));
		pickerOpen.set(false);
		resetData();
		loading.set(true);
		load();
	}
	function refresh() {
		if (selectedId() === null) loadContainers();
		else load();
	}
	async function load() {
		const id = selectedId();
		if (id === null) return;
		const mine = ++seq;
		busy.set(true);
		if (rows().length === 0) loading.set(true);
		try {
			const result = await invoke$1("docker/container/top", { id }, { timeout: SLOW_TIMEOUT_MS });
			if (mine !== seq) return;
			const list = Array.isArray(result) ? result : arr(result, "processes");
			const names = Array.isArray(result) ? [] : arr(result, "titles").map(String);
			rows.set(list);
			titles.set(names.length > 0 ? names : inferTitles(list));
			error.set(null);
			if (selected() !== null && selected() >= list.length) selected.set(null);
		} catch (failure) {
			if (mine !== seq) return;
			error.set(errorMessage(failure));
		} finally {
			if (mine === seq) {
				loading.set(false);
				busy.set(false);
			}
		}
		loadStats(id, mine);
	}
	/** 顺带取一次容器整体占用，失败不影响进程表。 */
	async function loadStats(id, mine) {
		try {
			const result = await invoke$1("docker/container/stats", { id }, { timeout: SLOW_TIMEOUT_MS });
			if (mine !== seq) return;
			stats.set(result ?? null);
		} catch {
			if (mine === seq) stats.set(null);
		}
	}
	function statsLine() {
		const sample = stats();
		if (sample === null) return "";
		const cpu = Number(sample.cpu_percent);
		return `容器 CPU ${Number.isFinite(cpu) ? `${cpu.toFixed(1)}%` : "-"} · 内存 ${humanBytes(sample.memory_usage_bytes)} / ${humanBytes(sample.memory_limit_bytes)}`;
	}
	function selectedCommand() {
		const index = selected();
		if (index === null) return null;
		const row = rows()[index];
		if (row === void 0) return null;
		const names = titles();
		for (const title of names) if (title === "CMD" || title === "COMMAND") {
			const value = cell(row, names, title);
			if (value.length > 0) return value;
		}
		return null;
	}
	function pickerList() {
		if (!pickerOpen()) return null;
		return (() => {
			const __nsh_hv0 = element("view");
			bindProp(__nsh_hv0, "style", () => ({
				display: "flex",
				flexDirection: "column",
				gap: 4,
				marginHorizontal: 14,
				marginBottom: 8,
				padding: 6,
				borderWidth: 1,
				borderColor: c.line(),
				borderRadius: r.card,
				backgroundColor: c.panel()
			}));
			insert(__nsh_hv0, () => containersLoading() && containers().length === 0 ? (() => {
				const __nsh_hv1 = element("text");
				bindProp(__nsh_hv1, "style", () => t.meta);
				const __nsh_hv2 = text("正在读取容器列表…");
				append(__nsh_hv1, __nsh_hv2);
				return __nsh_hv1;
			})() : containersError() !== null && containers().length === 0 ? component(Row, {
				gap: 8,
				get children() {
					return [(() => {
						const __nsh_hv3 = element("text");
						bindProp(__nsh_hv3, "style", () => ({
							...t.meta,
							color: c.danger()
						}));
						insert(__nsh_hv3, () => `容器列表读取失败：${containersError()}`);
						return __nsh_hv3;
					})(), component(Button, {
						label: "重试",
						small: true,
						onPress: () => void loadContainers()
					})];
				}
			}) : visibleContainers().length === 0 ? (() => {
				const __nsh_hv4 = element("text");
				bindProp(__nsh_hv4, "style", () => t.meta);
				insert(__nsh_hv4, () => containers().length === 0 ? "这个连接里没有容器。" : "没有匹配的容器，换个关键词试试。");
				return __nsh_hv4;
			})() : (() => {
				const __nsh_hv5 = element("scroll");
				prop(__nsh_hv5, "style", { maxHeight: 168 });
				const __nsh_hv6 = element("view");
				prop(__nsh_hv6, "style", {
					display: "flex",
					flexDirection: "column"
				});
				insert(__nsh_hv6, () => visibleContainers().map((row) => containerOption(row)));
				append(__nsh_hv5, __nsh_hv6);
				return __nsh_hv5;
			})());
			return __nsh_hv0;
		})();
	}
	function containerOption(row) {
		const id = containerId$3(row);
		const state = containerState$3(row);
		return (() => {
			const __nsh_hv7 = element("view");
			prop(__nsh_hv7, "onPress", () => selectContainer(row));
			prop(__nsh_hv7, "role", "button");
			bindProp(__nsh_hv7, "accessibilityLabel", () => `容器 ${containerName$4(row)}`);
			bindProp(__nsh_hv7, "style", () => ({
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				gap: 8,
				paddingHorizontal: 8,
				paddingVertical: 6,
				borderRadius: r.control,
				backgroundColor: selectedId() === id ? c.hover() : "transparent"
			}));
			const __nsh_hv8 = element("text");
			prop(__nsh_hv8, "numberOfLines", 1);
			bindProp(__nsh_hv8, "style", () => ({
				fontSize: 12,
				fontWeight: "500",
				color: c.text(),
				width: 180
			}));
			insert(__nsh_hv8, () => containerName$4(row));
			const __nsh_hv9 = element("text");
			prop(__nsh_hv9, "numberOfLines", 1);
			bindProp(__nsh_hv9, "style", () => ({
				...t.mono,
				fontSize: 11,
				color: c.muted(),
				flex: 1,
				minWidth: 0
			}));
			insert(__nsh_hv9, () => containerImage$3(row));
			append(__nsh_hv7, __nsh_hv8);
			append(__nsh_hv7, __nsh_hv9);
			insert(__nsh_hv7, component(Badge, {
				get text() {
					return state.length === 0 ? "unknown" : state;
				},
				get tone() {
					return stateTone$4(state);
				}
			}));
			return __nsh_hv7;
		})();
	}
	function pickerToggle() {
		return component(Button, {
			get label() {
				return pickerOpen() ? "收起列表" : selectedId() === null ? "选择容器" : "切换容器";
			},
			small: true,
			onPress: () => pickerOpen.set(!pickerOpen())
		});
	}
	function containerBar() {
		return (() => {
			const __nsh_hv10 = element("view");
			prop(__nsh_hv10, "style", {
				display: "flex",
				flexDirection: "column",
				flexShrink: 0
			});
			insert(__nsh_hv10, [component(Row, {
				wrap: true,
				gap: 8,
				get style() {
					return {
						paddingHorizontal: 14,
						paddingBottom: pickerOpen() ? 6 : 10
					};
				},
				get children() {
					return [
						component(SearchField, {
							get value() {
								return containerQuery();
							},
							onChange: (text) => {
								containerQuery.set(text);
								if (!pickerOpen()) pickerOpen.set(true);
							},
							placeholder: "按名称 / 镜像过滤容器",
							width: 280
						}),
						(() => {
							const __nsh_hv11 = element("text");
							bindProp(__nsh_hv11, "style", () => t.meta);
							insert(__nsh_hv11, () => `${visibleContainers().length} / ${containers().length} 个容器`);
							return __nsh_hv11;
						})(),
						() => selectedId() === null ? (() => {
							const __nsh_hv12 = element("text");
							bindProp(__nsh_hv12, "style", () => t.meta);
							const __nsh_hv13 = text("未选择容器");
							append(__nsh_hv12, __nsh_hv13);
							return __nsh_hv12;
						})() : (() => {
							const __nsh_hv14 = element("text");
							prop(__nsh_hv14, "numberOfLines", 1);
							bindProp(__nsh_hv14, "style", () => ({
								...t.meta,
								color: c.text(),
								maxWidth: 360
							}));
							insert(__nsh_hv14, () => selectedSummary());
							return __nsh_hv14;
						})(),
						(() => {
							const __nsh_hv15 = element("view");
							prop(__nsh_hv15, "style", { flex: 1 });
							return __nsh_hv15;
						})(),
						component(Button, {
							label: "刷新列表",
							small: true,
							onPress: () => void loadContainers()
						}),
						() => pickerToggle()
					];
				}
			}), () => pickerList()]);
			return __nsh_hv10;
		})();
	}
	function tableHeader() {
		const names = titles();
		return component(Row, {
			gap: 0,
			get style() {
				return {
					paddingHorizontal: 12,
					paddingVertical: 7,
					backgroundColor: c.panel(),
					borderBottomWidth: 1,
					borderBottomColor: c.line(),
					flexShrink: 0
				};
			},
			get children() {
				return names.map((title) => (() => {
					const __nsh_hv16 = element("text");
					prop(__nsh_hv16, "numberOfLines", 1);
					bindProp(__nsh_hv16, "style", () => ({
						...t.label,
						...cellStyle(title)
					}));
					insert(__nsh_hv16, title);
					return __nsh_hv16;
				})());
			}
		});
	}
	function tableRow(row, names, index) {
		return (() => {
			const __nsh_hv17 = element("view");
			prop(__nsh_hv17, "onPress", () => selected.set(selected() === index ? null : index));
			bindProp(__nsh_hv17, "style", () => ({
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				gap: 0,
				paddingHorizontal: 12,
				paddingVertical: 5,
				backgroundColor: selected() === index ? c.hover() : "transparent",
				borderBottomWidth: 1,
				borderBottomColor: c.line()
			}));
			insert(__nsh_hv17, () => names.map((title) => {
				const style = NUMERIC.includes(title) ? {
					...t.mono,
					...cellStyle(title)
				} : {
					fontSize: 12,
					color: c.text(),
					...cellStyle(title)
				};
				return (() => {
					const __nsh_hv18 = element("text");
					prop(__nsh_hv18, "numberOfLines", 1);
					prop(__nsh_hv18, "style", style);
					insert(__nsh_hv18, () => cell(row, names, title));
					return __nsh_hv18;
				})();
			}));
			return __nsh_hv17;
		})();
	}
	function footer() {
		const command = selectedCommand();
		return (() => {
			const __nsh_hv19 = element("view");
			bindProp(__nsh_hv19, "style", () => ({
				paddingHorizontal: 12,
				paddingVertical: 7,
				borderTopWidth: 1,
				borderTopColor: c.line(),
				backgroundColor: c.panel(),
				flexShrink: 0
			}));
			insert(__nsh_hv19, () => command === null ? (() => {
				const __nsh_hv20 = element("text");
				prop(__nsh_hv20, "numberOfLines", 1);
				bindProp(__nsh_hv20, "style", () => t.meta);
				insert(__nsh_hv20, () => `${titles().length} 列来自 ps -ef；单进程 CPU / 内存不在 ps -ef 输出里，工具条显示的是容器整体占用。`);
				return __nsh_hv20;
			})() : (() => {
				const __nsh_hv21 = element("text");
				prop(__nsh_hv21, "numberOfLines", 2);
				bindProp(__nsh_hv21, "style", () => t.mono);
				insert(__nsh_hv21, command);
				return __nsh_hv21;
			})());
			return __nsh_hv19;
		})();
	}
	function selectionGate() {
		if (containersError() !== null && containers().length === 0) return component(LoadError, {
			get message() {
				return containersError() ?? "";
			},
			onRetry: () => void loadContainers()
		});
		if (containersLoading() && containers().length === 0) return component(Loading, { label: "正在读取容器列表…" });
		if (containers().length === 0) return component(Empty, {
			title: "这个连接里没有容器",
			hint: "docker/container/list 返回了空列表（包含已停止的容器）：先在 Docker 里创建或启动一个容器。",
			get action() {
				return component(Button, {
					label: "重新读取容器列表",
					small: true,
					onPress: () => void loadContainers()
				});
			}
		});
		return component(Empty, {
			title: "先选择一个容器",
			get hint() {
				return `连接里有 ${containers().length} 个容器：在上方列表里点一个，页面会读取它的进程表。`;
			}
		});
	}
	function body() {
		if (selectedId() === null) return selectionGate();
		if (loading() && rows().length === 0) return component(Loading, { label: "正在读取容器进程…" });
		if (error() !== null && rows().length === 0) return component(LoadError, {
			get message() {
				return error() ?? "";
			},
			onRetry: () => void load()
		});
		if (rows().length === 0) return component(Empty, {
			title: "容器里没有可见的进程",
			hint: "ps -ef 返回了空列表：容器可能已停止，或者 PID 1 已经退出。可以刷新重试。",
			get action() {
				return component(Button, {
					label: "重新读取",
					small: true,
					onPress: () => void load()
				});
			}
		});
		return (() => {
			const __nsh_hv22 = element("view");
			prop(__nsh_hv22, "style", {
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "column"
			});
			const __nsh_hv24 = element("scroll");
			prop(__nsh_hv24, "style", {
				flex: 1,
				minHeight: 0
			});
			insert(__nsh_hv24, () => rows().map((row, index) => tableRow(row, titles(), index)));
			append(__nsh_hv22, __nsh_hv24);
			insert(__nsh_hv22, [() => error() === null ? null : (() => {
				const __nsh_hv23 = element("view");
				prop(__nsh_hv23, "style", {
					paddingHorizontal: 12,
					paddingTop: 8
				});
				insert(__nsh_hv23, component(Notice, { get message() {
					return `刷新失败：${error() ?? ""}`;
				} }));
				return __nsh_hv23;
			})(), () => tableHeader()], __nsh_hv24);
			insert(__nsh_hv22, () => footer());
			return __nsh_hv22;
		})();
	}
	function toolbar() {
		const id = selectedId();
		return component(Row, {
			gap: 8,
			style: {
				paddingHorizontal: 14,
				paddingVertical: 10,
				justifyContent: "space-between",
				flexShrink: 0
			},
			get children() {
				return [component(Row, {
					gap: 8,
					get children() {
						return [
							(() => {
								const __nsh_hv25 = element("text");
								bindProp(__nsh_hv25, "style", () => t.h1);
								const __nsh_hv26 = text("进程");
								append(__nsh_hv25, __nsh_hv26);
								return __nsh_hv25;
							})(),
							() => id === null ? (() => {
								const __nsh_hv27 = element("text");
								bindProp(__nsh_hv27, "style", () => t.meta);
								const __nsh_hv28 = text("未选择容器");
								append(__nsh_hv27, __nsh_hv28);
								return __nsh_hv27;
							})() : (() => {
								const __nsh_hv29 = element("text");
								bindProp(__nsh_hv29, "style", () => t.meta);
								insert(__nsh_hv29, () => `${rows().length} 个进程`);
								return __nsh_hv29;
							})(),
							(() => {
								const __nsh_hv30 = element("text");
								bindProp(__nsh_hv30, "style", () => t.meta);
								insert(__nsh_hv30, () => statsLine());
								return __nsh_hv30;
							})()
						];
					}
				}), component(Row, {
					gap: 6,
					get children() {
						return [() => busy() ? (() => {
							const __nsh_hv31 = element("text");
							bindProp(__nsh_hv31, "style", () => t.meta);
							const __nsh_hv32 = text("正在读取…");
							append(__nsh_hv31, __nsh_hv32);
							return __nsh_hv31;
						})() : null, component(Button, {
							label: "刷新",
							small: true,
							onPress: () => refresh()
						})];
					}
				})];
			}
		});
	}
	loadContainers();
	return (() => {
		const __nsh_hv33 = element("view");
		bindProp(__nsh_hv33, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		const __nsh_hv34 = element("view");
		bindProp(__nsh_hv34, "style", () => hairline());
		append(__nsh_hv33, __nsh_hv34);
		insert(__nsh_hv33, () => toolbar(), __nsh_hv34);
		insert(__nsh_hv33, [() => containerBar(), () => body()]);
		return __nsh_hv33;
	})();
}

//#endregion
//#region pages/changes/App.tsx
const KIND_LABEL = {
	A: "新增",
	C: "修改",
	D: "删除"
};
const KIND_LONG = {
	A: "新增（Added）",
	C: "修改（Modified）",
	D: "删除（Deleted）"
};
/** 变色标记：新增绿、修改黄、删除红。 */
function kindColor(kind) {
	if (kind === "A") return c.chart(1);
	if (kind === "D") return c.danger();
	return c.chart(4);
}
/** 变更类型归一化：数字枚举、单字母、英文长名都能认。 */
function kindOf(change) {
	const raw = change.Kind ?? change.kind;
	if (typeof raw === "number") {
		if (raw === 1) return "A";
		if (raw === 2) return "D";
		return "C";
	}
	const text = String(raw ?? "").trim().toUpperCase();
	if (text === "A" || text.startsWith("ADD")) return "A";
	if (text === "D" || text.startsWith("DEL") || text.startsWith("REM")) return "D";
	if (text === "C" || text.startsWith("MOD") || text.startsWith("CHA")) return "C";
	return "C";
}
function pathOf(change) {
	const value = change.Path ?? change.path;
	return typeof value === "string" && value.length > 0 ? value : str(change, "Path", "-");
}
/** `/usr/lib/x.so` → 末段 + 目录，长路径靠 numberOfLines 省略。 */
function splitPath(path) {
	const trimmed = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
	const index = trimmed.lastIndexOf("/");
	if (index < 0) return {
		name: trimmed,
		dir: ""
	};
	const name = trimmed.slice(index + 1);
	const dir = trimmed.slice(0, index);
	return {
		name: name.length > 0 ? name : "/",
		dir: dir.length > 0 ? dir : "/"
	};
}
const containerId$2 = (row) => str(row, "id", "");
const containerName$3 = (row) => str(row, "name", "");
const containerImage$2 = (row) => str(row, "image", "");
const containerState$2 = (row) => str(row, "state", "");
function stateTone$3(state) {
	if (state === "running") return "ok";
	if (state === "paused" || state === "restarting") return "warn";
	if (state === "exited" || state === "dead") return "danger";
	return "neutral";
}
function Changes() {
	const changes = signal([]);
	const loading = signal(true);
	const error = signal(null);
	const busy = signal(false);
	const selected = signal(null);
	const containers = signal([]);
	const containerQuery = signal("");
	const containersLoading = signal(true);
	const containersError = signal(null);
	const selectedId = signal(null);
	const selectedName = signal("");
	const pickerOpen = signal(true);
	let seq = 0;
	function countOf(kind) {
		return changes().filter((change) => kindOf(change) === kind).length;
	}
	function visibleContainers() {
		const needle = containerQuery().trim().toLowerCase();
		if (needle.length === 0) return containers();
		return containers().filter((row) => `${containerName$3(row)} ${containerImage$2(row)}`.toLowerCase().includes(needle));
	}
	function selectedSummary() {
		const id = selectedId();
		if (id === null) return "";
		const row = containers().find((item) => containerId$2(item) === id);
		return row === void 0 ? selectedName() : `${containerName$3(row)} · ${containerImage$2(row)}`;
	}
	function resetData() {
		changes.set([]);
		selected.set(null);
		error.set(null);
	}
	function clearSelection() {
		selectedId.set(null);
		selectedName.set("");
		resetData();
		loading.set(false);
		pickerOpen.set(true);
	}
	function selectContainer(row) {
		const id = containerId$2(row);
		if (id.length === 0) return;
		if (selectedId() === id) {
			pickerOpen.set(false);
			return;
		}
		selectedId.set(id);
		selectedName.set(containerName$3(row));
		pickerOpen.set(false);
		resetData();
		loading.set(true);
		load();
	}
	function refresh() {
		if (selectedId() === null) loadContainers();
		else load();
	}
	async function loadContainers() {
		containersLoading.set(true);
		try {
			const result = await invoke$1("docker/container/list", {}, { timeout: SLOW_TIMEOUT_MS });
			const list = Array.isArray(result) ? result : arr(result, "containers");
			containers.set(list);
			containersError.set(null);
			const current = selectedId();
			if (current !== null && !list.some((row) => containerId$2(row) === current)) clearSelection();
		} catch (failure) {
			containersError.set(errorMessage(failure));
		} finally {
			containersLoading.set(false);
		}
	}
	async function load() {
		const id = selectedId();
		if (id === null) return;
		const mine = ++seq;
		busy.set(true);
		if (changes().length === 0) loading.set(true);
		try {
			const result = await invoke$1("docker/container/diff", { id }, { timeout: SLOW_TIMEOUT_MS });
			if (mine !== seq) return;
			const list = Array.isArray(result) ? result : arr(result, "changes");
			changes.set(list);
			error.set(null);
			if (selected() !== null && selected() >= list.length) selected.set(null);
		} catch (failure) {
			if (mine !== seq) return;
			error.set(errorMessage(failure));
		} finally {
			if (mine === seq) {
				loading.set(false);
				busy.set(false);
			}
		}
	}
	function selectedChange() {
		const index = selected();
		if (index === null) return null;
		const change = changes()[index];
		if (change === void 0) return null;
		return {
			change,
			kind: kindOf(change)
		};
	}
	function pickerList() {
		if (!pickerOpen()) return null;
		return (() => {
			const __nsh_hv0 = element("view");
			bindProp(__nsh_hv0, "style", () => ({
				display: "flex",
				flexDirection: "column",
				gap: 4,
				marginHorizontal: 14,
				marginBottom: 8,
				padding: 6,
				borderWidth: 1,
				borderColor: c.line(),
				borderRadius: r.card,
				backgroundColor: c.panel()
			}));
			insert(__nsh_hv0, () => containersLoading() && containers().length === 0 ? (() => {
				const __nsh_hv1 = element("text");
				bindProp(__nsh_hv1, "style", () => t.meta);
				const __nsh_hv2 = text("正在读取容器列表…");
				append(__nsh_hv1, __nsh_hv2);
				return __nsh_hv1;
			})() : containersError() !== null && containers().length === 0 ? component(Row, {
				gap: 8,
				get children() {
					return [(() => {
						const __nsh_hv3 = element("text");
						bindProp(__nsh_hv3, "style", () => ({
							...t.meta,
							color: c.danger()
						}));
						insert(__nsh_hv3, () => `容器列表读取失败：${containersError()}`);
						return __nsh_hv3;
					})(), component(Button, {
						label: "重试",
						small: true,
						onPress: () => void loadContainers()
					})];
				}
			}) : visibleContainers().length === 0 ? (() => {
				const __nsh_hv4 = element("text");
				bindProp(__nsh_hv4, "style", () => t.meta);
				insert(__nsh_hv4, () => containers().length === 0 ? "这个连接里没有容器。" : "没有匹配的容器，换个关键词试试。");
				return __nsh_hv4;
			})() : (() => {
				const __nsh_hv5 = element("scroll");
				prop(__nsh_hv5, "style", { maxHeight: 168 });
				const __nsh_hv6 = element("view");
				prop(__nsh_hv6, "style", {
					display: "flex",
					flexDirection: "column"
				});
				insert(__nsh_hv6, () => visibleContainers().map((row) => containerOption(row)));
				append(__nsh_hv5, __nsh_hv6);
				return __nsh_hv5;
			})());
			return __nsh_hv0;
		})();
	}
	function containerOption(row) {
		const id = containerId$2(row);
		const state = containerState$2(row);
		return (() => {
			const __nsh_hv7 = element("view");
			prop(__nsh_hv7, "onPress", () => selectContainer(row));
			prop(__nsh_hv7, "role", "button");
			bindProp(__nsh_hv7, "accessibilityLabel", () => `容器 ${containerName$3(row)}`);
			bindProp(__nsh_hv7, "style", () => ({
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				gap: 8,
				paddingHorizontal: 8,
				paddingVertical: 6,
				borderRadius: r.control,
				backgroundColor: selectedId() === id ? c.hover() : "transparent"
			}));
			const __nsh_hv8 = element("text");
			prop(__nsh_hv8, "numberOfLines", 1);
			bindProp(__nsh_hv8, "style", () => ({
				fontSize: 12,
				fontWeight: "500",
				color: c.text(),
				width: 180
			}));
			insert(__nsh_hv8, () => containerName$3(row));
			const __nsh_hv9 = element("text");
			prop(__nsh_hv9, "numberOfLines", 1);
			bindProp(__nsh_hv9, "style", () => ({
				...t.mono,
				fontSize: 11,
				color: c.muted(),
				flex: 1,
				minWidth: 0
			}));
			insert(__nsh_hv9, () => containerImage$2(row));
			append(__nsh_hv7, __nsh_hv8);
			append(__nsh_hv7, __nsh_hv9);
			insert(__nsh_hv7, component(Badge, {
				get text() {
					return state.length === 0 ? "unknown" : state;
				},
				get tone() {
					return stateTone$3(state);
				}
			}));
			return __nsh_hv7;
		})();
	}
	function pickerToggle() {
		return component(Button, {
			get label() {
				return pickerOpen() ? "收起列表" : selectedId() === null ? "选择容器" : "切换容器";
			},
			small: true,
			onPress: () => pickerOpen.set(!pickerOpen())
		});
	}
	function containerBar() {
		return (() => {
			const __nsh_hv10 = element("view");
			prop(__nsh_hv10, "style", {
				display: "flex",
				flexDirection: "column",
				flexShrink: 0
			});
			insert(__nsh_hv10, [component(Row, {
				wrap: true,
				gap: 8,
				get style() {
					return {
						paddingHorizontal: 14,
						paddingBottom: pickerOpen() ? 6 : 10
					};
				},
				get children() {
					return [
						component(SearchField, {
							get value() {
								return containerQuery();
							},
							onChange: (text) => {
								containerQuery.set(text);
								if (!pickerOpen()) pickerOpen.set(true);
							},
							placeholder: "按名称 / 镜像过滤容器",
							width: 280
						}),
						(() => {
							const __nsh_hv11 = element("text");
							bindProp(__nsh_hv11, "style", () => t.meta);
							insert(__nsh_hv11, () => `${visibleContainers().length} / ${containers().length} 个容器`);
							return __nsh_hv11;
						})(),
						() => selectedId() === null ? (() => {
							const __nsh_hv12 = element("text");
							bindProp(__nsh_hv12, "style", () => t.meta);
							const __nsh_hv13 = text("未选择容器");
							append(__nsh_hv12, __nsh_hv13);
							return __nsh_hv12;
						})() : (() => {
							const __nsh_hv14 = element("text");
							prop(__nsh_hv14, "numberOfLines", 1);
							bindProp(__nsh_hv14, "style", () => ({
								...t.meta,
								color: c.text(),
								maxWidth: 360
							}));
							insert(__nsh_hv14, () => selectedSummary());
							return __nsh_hv14;
						})(),
						(() => {
							const __nsh_hv15 = element("view");
							prop(__nsh_hv15, "style", { flex: 1 });
							return __nsh_hv15;
						})(),
						component(Button, {
							label: "刷新列表",
							small: true,
							onPress: () => void loadContainers()
						}),
						() => pickerToggle()
					];
				}
			}), () => pickerList()]);
			return __nsh_hv10;
		})();
	}
	function changeRow(change, index) {
		const kind = kindOf(change);
		const parts = splitPath(pathOf(change));
		const color = kindColor(kind);
		return (() => {
			const __nsh_hv16 = element("view");
			prop(__nsh_hv16, "onPress", () => selected.set(selected() === index ? null : index));
			bindProp(__nsh_hv16, "style", () => ({
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				gap: 10,
				paddingHorizontal: 12,
				paddingVertical: 7,
				backgroundColor: selected() === index ? c.hover() : "transparent",
				borderBottomWidth: 1,
				borderBottomColor: c.line()
			}));
			const __nsh_hv17 = element("view");
			bindProp(__nsh_hv17, "style", () => ({
				width: 20,
				height: 20,
				flexShrink: 0,
				borderRadius: r.chip,
				borderWidth: 1,
				borderColor: color,
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				justifyContent: "center"
			}));
			const __nsh_hv18 = element("text");
			prop(__nsh_hv18, "style", {
				fontSize: 11,
				fontWeight: "600",
				color
			});
			insert(__nsh_hv18, kind);
			append(__nsh_hv17, __nsh_hv18);
			const __nsh_hv19 = element("view");
			prop(__nsh_hv19, "style", {
				display: "flex",
				flexDirection: "column",
				gap: 2,
				flex: 1,
				minWidth: 0
			});
			const __nsh_hv20 = element("text");
			prop(__nsh_hv20, "numberOfLines", 1);
			bindProp(__nsh_hv20, "style", () => t.mono);
			insert(__nsh_hv20, () => parts.name);
			append(__nsh_hv19, __nsh_hv20);
			insert(__nsh_hv19, () => parts.dir.length === 0 ? null : (() => {
				const __nsh_hv21 = element("text");
				prop(__nsh_hv21, "numberOfLines", 1);
				bindProp(__nsh_hv21, "style", () => ({
					fontSize: 11,
					color: c.muted()
				}));
				insert(__nsh_hv21, () => parts.dir);
				return __nsh_hv21;
			})());
			const __nsh_hv22 = element("text");
			bindProp(__nsh_hv22, "style", () => ({
				...t.meta,
				width: 36,
				textAlign: "right",
				flexShrink: 0
			}));
			insert(__nsh_hv22, () => KIND_LABEL[kind]);
			append(__nsh_hv16, __nsh_hv17);
			append(__nsh_hv16, __nsh_hv19);
			append(__nsh_hv16, __nsh_hv22);
			return __nsh_hv16;
		})();
	}
	function detailBar() {
		const picked = selectedChange();
		if (picked === null) return (() => {
			const __nsh_hv23 = element("view");
			bindProp(__nsh_hv23, "style", () => ({
				paddingHorizontal: 12,
				paddingVertical: 7,
				borderTopWidth: 1,
				borderTopColor: c.line(),
				backgroundColor: c.panel(),
				flexShrink: 0
			}));
			const __nsh_hv24 = element("text");
			prop(__nsh_hv24, "numberOfLines", 1);
			bindProp(__nsh_hv24, "style", () => t.meta);
			const __nsh_hv25 = text("点击任意一行查看完整路径；docker diff 只比较容器可写层。");
			append(__nsh_hv24, __nsh_hv25);
			append(__nsh_hv23, __nsh_hv24);
			return __nsh_hv23;
		})();
		return (() => {
			const __nsh_hv26 = element("view");
			bindProp(__nsh_hv26, "style", () => ({
				paddingHorizontal: 12,
				paddingVertical: 8,
				borderTopWidth: 1,
				borderTopColor: c.line(),
				backgroundColor: c.panel(),
				display: "flex",
				flexDirection: "column",
				gap: 4,
				flexShrink: 0
			}));
			const __nsh_hv30 = element("text");
			prop(__nsh_hv30, "numberOfLines", 3);
			bindProp(__nsh_hv30, "style", () => t.mono);
			insert(__nsh_hv30, () => pathOf(picked.change));
			append(__nsh_hv26, __nsh_hv30);
			insert(__nsh_hv26, component(Row, {
				gap: 8,
				style: { justifyContent: "space-between" },
				get children() {
					return [(() => {
						const __nsh_hv27 = element("text");
						bindProp(__nsh_hv27, "style", () => t.label);
						const __nsh_hv28 = text("完整路径");
						append(__nsh_hv27, __nsh_hv28);
						return __nsh_hv27;
					})(), (() => {
						const __nsh_hv29 = element("text");
						bindProp(__nsh_hv29, "style", () => ({
							...t.meta,
							color: kindColor(picked.kind)
						}));
						insert(__nsh_hv29, () => KIND_LONG[picked.kind]);
						return __nsh_hv29;
					})()];
				}
			}), __nsh_hv30);
			return __nsh_hv26;
		})();
	}
	function selectionGate() {
		if (containersError() !== null && containers().length === 0) return component(LoadError, {
			get message() {
				return containersError() ?? "";
			},
			onRetry: () => void loadContainers()
		});
		if (containersLoading() && containers().length === 0) return component(Loading, { label: "正在读取容器列表…" });
		if (containers().length === 0) return component(Empty, {
			title: "这个连接里没有容器",
			hint: "docker/container/list 返回了空列表（包含已停止的容器）：先在 Docker 里创建或启动一个容器。",
			get action() {
				return component(Button, {
					label: "重新读取容器列表",
					small: true,
					onPress: () => void loadContainers()
				});
			}
		});
		return component(Empty, {
			title: "先选择一个容器",
			get hint() {
				return `连接里有 ${containers().length} 个容器：在上方列表里点一个，页面会读取它的文件变更。`;
			}
		});
	}
	function body() {
		if (selectedId() === null) return selectionGate();
		if (loading() && changes().length === 0) return component(Loading, { label: "正在读取容器文件变更…" });
		if (error() !== null && changes().length === 0) return component(LoadError, {
			get message() {
				return error() ?? "";
			},
			onRetry: () => void load()
		});
		if (changes().length === 0) return component(Empty, {
			title: "可写层没有文件变更",
			hint: "容器启动后没有新增、修改或删除文件；docker diff 只比较容器可写层，不包含镜像层。",
			get action() {
				return component(Button, {
					label: "重新读取",
					small: true,
					onPress: () => void load()
				});
			}
		});
		return (() => {
			const __nsh_hv31 = element("view");
			prop(__nsh_hv31, "style", {
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "column"
			});
			const __nsh_hv33 = element("scroll");
			prop(__nsh_hv33, "style", {
				flex: 1,
				minHeight: 0
			});
			const __nsh_hv34 = element("view");
			prop(__nsh_hv34, "style", {
				display: "flex",
				flexDirection: "column"
			});
			insert(__nsh_hv34, () => changes().map((change, index) => changeRow(change, index)));
			append(__nsh_hv33, __nsh_hv34);
			append(__nsh_hv31, __nsh_hv33);
			insert(__nsh_hv31, () => error() === null ? null : (() => {
				const __nsh_hv32 = element("view");
				prop(__nsh_hv32, "style", {
					paddingHorizontal: 12,
					paddingTop: 8
				});
				insert(__nsh_hv32, component(Notice, { get message() {
					return `刷新失败：${error() ?? ""}`;
				} }));
				return __nsh_hv32;
			})(), __nsh_hv33);
			insert(__nsh_hv31, () => detailBar());
			return __nsh_hv31;
		})();
	}
	function toolbar() {
		return component(Row, {
			gap: 8,
			style: {
				paddingHorizontal: 14,
				paddingVertical: 10,
				justifyContent: "space-between",
				flexShrink: 0
			},
			get children() {
				return [component(Row, {
					gap: 8,
					get children() {
						return [(() => {
							const __nsh_hv35 = element("text");
							bindProp(__nsh_hv35, "style", () => t.h1);
							const __nsh_hv36 = text("文件变更");
							append(__nsh_hv35, __nsh_hv36);
							return __nsh_hv35;
						})(), () => selectedId() === null ? (() => {
							const __nsh_hv37 = element("text");
							bindProp(__nsh_hv37, "style", () => t.meta);
							const __nsh_hv38 = text("未选择容器");
							append(__nsh_hv37, __nsh_hv38);
							return __nsh_hv37;
						})() : [
							(() => {
								const __nsh_hv39 = element("text");
								bindProp(__nsh_hv39, "style", () => t.meta);
								insert(__nsh_hv39, () => `${changes().length} 项`);
								return __nsh_hv39;
							})(),
							component(Badge, {
								get text() {
									return `新增 ${countOf("A")}`;
								},
								tone: "ok"
							}),
							component(Badge, {
								get text() {
									return `修改 ${countOf("C")}`;
								},
								tone: "warn"
							}),
							component(Badge, {
								get text() {
									return `删除 ${countOf("D")}`;
								},
								tone: "danger"
							})
						]];
					}
				}), component(Row, {
					gap: 6,
					get children() {
						return [() => busy() ? (() => {
							const __nsh_hv40 = element("text");
							bindProp(__nsh_hv40, "style", () => t.meta);
							const __nsh_hv41 = text("正在读取…");
							append(__nsh_hv40, __nsh_hv41);
							return __nsh_hv40;
						})() : null, component(Button, {
							label: "刷新",
							small: true,
							onPress: () => refresh()
						})];
					}
				})];
			}
		});
	}
	loadContainers();
	return (() => {
		const __nsh_hv42 = element("view");
		bindProp(__nsh_hv42, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		const __nsh_hv43 = element("view");
		bindProp(__nsh_hv43, "style", () => hairline());
		append(__nsh_hv42, __nsh_hv43);
		insert(__nsh_hv42, () => toolbar(), __nsh_hv43);
		insert(__nsh_hv42, [() => containerBar(), () => body()]);
		return __nsh_hv42;
	})();
}

//#endregion
//#region pages/container-inspect/App.tsx
/** 原始 JSON 最多渲染的行数（超出部分不交给布局）。 */
const RAW_MAX_LINES = 800;
/** 按路径取字段；中途不是对象就给 undefined。 */
function pick(source, ...path) {
	let node = source;
	for (const key of path) {
		if (!node || typeof node !== "object" || Array.isArray(node)) return void 0;
		node = node[key];
	}
	return node;
}
/** 按路径取对象；不是对象就给空对象。 */
function objOf(source, ...path) {
	const value = pick(source, ...path);
	return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
/** 按路径取数组；不是数组就给空数组。 */
function listOf(source, ...path) {
	const value = pick(source, ...path);
	return Array.isArray(value) ? value : [];
}
/** 任意 JSON 值 → 一行可读文本。 */
function text$1(value, fallback = "-") {
	if (typeof value === "string") return value.length > 0 ? value : fallback;
	if (typeof value === "number") return Number.isFinite(value) ? String(value) : fallback;
	if (typeof value === "boolean") return value ? "是" : "否";
	return fallback;
}
/** docker 的 Name 带前导 `/`。 */
function containerName$2(doc) {
	const name = text$1(pick(doc, "Name"), "");
	return name.startsWith("/") ? name.slice(1) : name === "" ? "-" : name;
}
/** `NetworkSettings.Ports` → 行：`0.0.0.0:8080 → 80/tcp`，无绑定写「仅暴露」。 */
function portLines(ports) {
	if (!ports || typeof ports !== "object" || Array.isArray(ports)) return [];
	const lines = [];
	for (const [containerPort, bindings] of Object.entries(ports)) {
		if (!Array.isArray(bindings) || bindings.length === 0) {
			lines.push(`${containerPort}（仅暴露）`);
			continue;
		}
		for (const binding of bindings) {
			const hostIp = text$1(pick(binding, "HostIp"), "") || "0.0.0.0";
			const hostPort = text$1(pick(binding, "HostPort"), "-");
			lines.push(`${hostIp}:${hostPort} → ${containerPort}`);
		}
	}
	return lines.sort();
}
/** 内存类限额：0 / 缺失 = 不限。 */
function limitText(value) {
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? humanBytes(number) : "不限";
}
/** Swap：-1 表示显式不限，0 表示没单独设置。 */
function swapText(value) {
	const number = Number(value);
	if (!Number.isFinite(number) || number === 0) return "未单独设置";
	if (number < 0) return "不限";
	return humanBytes(number);
}
/** CPU 配额：优先 NanoCpus，回退 CpuQuota / CpuPeriod；0 = 不限。 */
function cpuText(hostConfig) {
	const nano = Number(pick(hostConfig, "NanoCpus"));
	if (Number.isFinite(nano) && nano > 0) return `${(nano / 1e9).toFixed(2)} 核`;
	const quota = Number(pick(hostConfig, "CpuQuota"));
	const period = Number(pick(hostConfig, "CpuPeriod"));
	if (Number.isFinite(quota) && quota > 0 && Number.isFinite(period) && period > 0) return `${(quota / period).toFixed(2)} 核`;
	return "不限";
}
/** 重启策略：`no` / `always` / `unless-stopped` / `on-failure[:n]`。 */
function restartText(policy) {
	const name = text$1(pick(policy, "Name"), "");
	if (name === "" || name === "no") return "no（不自动重启）";
	const retries = Number(pick(policy, "MaximumRetryCount"));
	if (name === "on-failure" && Number.isFinite(retries) && retries > 0) return `on-failure（最多 ${retries} 次）`;
	return name;
}
/** 状态 → Badge 语气。 */
function statusTone(status) {
	if (status === "running") return "ok";
	if (status === "paused" || status === "restarting" || status === "removing") return "warn";
	if (status === "exited" || status === "dead") return "danger";
	if (status === "created") return "info";
	return "neutral";
}
/** 小按钮：`active` 用 accessor，样式读的是当前值（写在 style 绑定里才响应式）。 */
function chip(label, active, onPress, testLabel) {
	return (() => {
		const __nsh_hv0 = element("view");
		prop(__nsh_hv0, "onPress", onPress);
		prop(__nsh_hv0, "role", "button");
		prop(__nsh_hv0, "accessibilityLabel", testLabel ?? label);
		bindProp(__nsh_hv0, "style", () => ({
			flexDirection: "row",
			alignItems: "center",
			paddingHorizontal: 10,
			paddingVertical: 5,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: active() ? c.accent() : c.line(),
			backgroundColor: active() ? c.accent() : "transparent"
		}));
		const __nsh_hv1 = element("text");
		bindProp(__nsh_hv1, "style", () => ({
			...t.meta,
			color: active() ? c.accentText() : c.text()
		}));
		insert(__nsh_hv1, label);
		append(__nsh_hv0, __nsh_hv1);
		return __nsh_hv0;
	})();
}
/** 一行「标签 / 值」；`truncate` 的值单行省略但可选中复制完整内容。 */
function Field(props) {
	return (() => {
		const __nsh_hv2 = element("view");
		prop(__nsh_hv2, "style", {
			flexDirection: "row",
			alignItems: "flex-start",
			gap: 16,
			paddingVertical: 4
		});
		const __nsh_hv3 = element("text");
		bindProp(__nsh_hv3, "style", () => ({
			...t.meta,
			color: c.muted(),
			width: 88,
			flexShrink: 0
		}));
		insert(__nsh_hv3, () => props.label);
		const __nsh_hv4 = element("text");
		bindProp(__nsh_hv4, "selectable", () => props.truncate === true);
		bindProp(__nsh_hv4, "numberOfLines", () => props.truncate === true ? 1 : 0);
		prop(__nsh_hv4, "ellipsizeMode", "middle");
		bindProp(__nsh_hv4, "style", () => ({
			flex: 1,
			minWidth: 0,
			textAlign: "right",
			...props.mono === true ? t.mono : t.body,
			color: c.text()
		}));
		insert(__nsh_hv4, () => props.value);
		append(__nsh_hv2, __nsh_hv3);
		append(__nsh_hv2, __nsh_hv4);
		return __nsh_hv2;
	})();
}
/** 分组的折叠区：标题行可点，内容只在展开时构建（数据变化会重建）。 */
function Section(props) {
	return (() => {
		const __nsh_hv5 = element("view");
		bindProp(__nsh_hv5, "style", () => ({
			...panel(0),
			padding: 0,
			overflow: "hidden"
		}));
		const __nsh_hv6 = element("view");
		bindProp(__nsh_hv6, "onPress", () => props.onToggle);
		prop(__nsh_hv6, "role", "button");
		bindProp(__nsh_hv6, "accessibilityLabel", () => `${props.title}分组`);
		prop(__nsh_hv6, "style", {
			flexDirection: "row",
			alignItems: "center",
			gap: 8,
			paddingHorizontal: 14,
			paddingVertical: 10
		});
		const __nsh_hv7 = element("text");
		bindProp(__nsh_hv7, "style", () => ({
			...t.h2,
			color: props.open() ? c.text() : c.muted()
		}));
		insert(__nsh_hv7, () => props.open() ? "▾" : "▸");
		const __nsh_hv8 = element("text");
		bindProp(__nsh_hv8, "style", () => ({
			...t.h2,
			color: c.text()
		}));
		insert(__nsh_hv8, () => props.title);
		const __nsh_hv10 = element("view");
		prop(__nsh_hv10, "style", { flex: 1 });
		const __nsh_hv11 = element("text");
		bindProp(__nsh_hv11, "style", () => ({
			...t.meta,
			color: c.muted()
		}));
		insert(__nsh_hv11, () => props.open() ? "收起" : "展开");
		append(__nsh_hv6, __nsh_hv7);
		append(__nsh_hv6, __nsh_hv8);
		append(__nsh_hv6, __nsh_hv10);
		append(__nsh_hv6, __nsh_hv11);
		insert(__nsh_hv6, () => props.hint === void 0 ? null : (() => {
			const __nsh_hv9 = element("text");
			bindProp(__nsh_hv9, "style", () => ({
				...t.meta,
				color: c.muted()
			}));
			insert(__nsh_hv9, () => props.hint);
			return __nsh_hv9;
		})(), __nsh_hv10);
		append(__nsh_hv5, __nsh_hv6);
		insert(__nsh_hv5, () => props.open() ? (() => {
			const __nsh_hv12 = element("view");
			prop(__nsh_hv12, "style", {
				paddingHorizontal: 14,
				paddingBottom: 12,
				paddingTop: 2,
				display: "flex",
				flexDirection: "column",
				gap: 6
			});
			insert(__nsh_hv12, () => props.body());
			return __nsh_hv12;
		})() : null);
		return __nsh_hv5;
	})();
}
/** 端口映射块：每行一个绑定。 */
function PortLines(props) {
	const lines = portLines(props.ports);
	if (lines.length === 0) return (() => {
		const __nsh_hv13 = element("text");
		bindProp(__nsh_hv13, "style", () => ({
			...t.meta,
			color: c.muted()
		}));
		const __nsh_hv14 = text("没有端口映射");
		append(__nsh_hv13, __nsh_hv14);
		return __nsh_hv13;
	})();
	return (() => {
		const __nsh_hv15 = element("view");
		prop(__nsh_hv15, "style", {
			display: "flex",
			flexDirection: "column",
			gap: 2
		});
		insert(__nsh_hv15, () => lines.map((line) => (() => {
			const __nsh_hv16 = element("text");
			prop(__nsh_hv16, "selectable", true);
			bindProp(__nsh_hv16, "style", () => ({
				...t.mono,
				color: c.text()
			}));
			insert(__nsh_hv16, line);
			return __nsh_hv16;
		})()));
		return __nsh_hv15;
	})();
}
function ContainerInspect() {
	const data = signal(null);
	const loading = signal(true);
	const busy = signal(false);
	const error = signal(null);
	const updatedAt = signal("");
	const showRaw = signal(false);
	const openBasic = signal(true);
	const openNetwork = signal(true);
	const openMounts = signal(false);
	const openEnv = signal(false);
	const openLimits = signal(false);
	const containers = signal([]);
	const containerQuery = signal("");
	const containersLoading = signal(true);
	const containersError = signal(null);
	const selectedId = signal(null);
	const selectedName = signal("");
	const pickerOpen = signal(true);
	let seq = 0;
	const status = () => text$1(pick(data() ?? {}, "State", "Status"), "unknown");
	const health = () => text$1(pick(data() ?? {}, "State", "Health", "Status"), "");
	function rowId(row) {
		return str(row, "id", "");
	}
	function rowName(row) {
		return str(row, "name", "");
	}
	function rowImage(row) {
		return str(row, "image", "");
	}
	function rowState(row) {
		return str(row, "state", "");
	}
	function containerTone(state) {
		if (state === "running") return "ok";
		if (state === "paused" || state === "restarting") return "warn";
		if (state === "exited" || state === "dead") return "danger";
		return "neutral";
	}
	function visibleContainers() {
		const needle = containerQuery().trim().toLowerCase();
		if (needle.length === 0) return containers();
		return containers().filter((row) => `${rowName(row)} ${rowImage(row)}`.toLowerCase().includes(needle));
	}
	function selectedSummary() {
		const id = selectedId();
		if (id === null) return "";
		const row = containers().find((item) => rowId(item) === id);
		return row === void 0 ? selectedName() : `${rowName(row)} · ${rowImage(row)}`;
	}
	function resetData() {
		data.set(null);
		error.set(null);
		updatedAt.set("");
		showRaw.set(false);
	}
	function clearSelection() {
		selectedId.set(null);
		selectedName.set("");
		resetData();
		loading.set(false);
		pickerOpen.set(true);
	}
	function selectContainer(row) {
		const id = rowId(row);
		if (id.length === 0) return;
		if (selectedId() === id) {
			pickerOpen.set(false);
			return;
		}
		selectedId.set(id);
		selectedName.set(rowName(row));
		pickerOpen.set(false);
		resetData();
		loading.set(true);
		load();
	}
	function refresh() {
		if (selectedId() === null) loadContainers();
		else load();
	}
	async function loadContainers() {
		containersLoading.set(true);
		try {
			const result = await invoke$1("docker/container/list", {}, { timeout: SLOW_TIMEOUT_MS });
			const list = Array.isArray(result) ? result : arr(result, "containers");
			containers.set(list);
			containersError.set(null);
			const current = selectedId();
			if (current !== null && !list.some((row) => rowId(row) === current)) clearSelection();
		} catch (failure) {
			containersError.set(errorMessage(failure));
		} finally {
			containersLoading.set(false);
		}
	}
	async function load() {
		const id = selectedId();
		if (id === null) return;
		const mine = ++seq;
		busy.set(true);
		if (data() === null) loading.set(true);
		try {
			const result = await invoke$1("docker/container/inspect", { id }, { timeout: SLOW_TIMEOUT_MS });
			if (mine !== seq) return;
			data.set(result && typeof result === "object" && !Array.isArray(result) ? result : null);
			updatedAt.set(clock());
			error.set(null);
		} catch (failure) {
			if (mine !== seq) return;
			error.set(errorMessage(failure));
		} finally {
			if (mine === seq) {
				busy.set(false);
				loading.set(false);
			}
		}
	}
	function basicBody() {
		const doc = data() ?? {};
		const state = objOf(doc, "State");
		const config = objOf(doc, "Config");
		const hostConfig = objOf(doc, "HostConfig");
		const startedAt = text$1(pick(state, "StartedAt"), "");
		return (() => {
			const __nsh_hv17 = element("view");
			prop(__nsh_hv17, "style", {
				display: "flex",
				flexDirection: "column"
			});
			const __nsh_hv18 = element("text");
			bindProp(__nsh_hv18, "style", () => ({
				...t.meta,
				color: c.muted(),
				marginTop: 6
			}));
			const __nsh_hv19 = text("长值单行省略；选中文本即可复制完整内容。");
			append(__nsh_hv18, __nsh_hv19);
			append(__nsh_hv17, __nsh_hv18);
			insert(__nsh_hv17, [
				component(Field, {
					label: "容器 ID",
					get value() {
						return text$1(pick(doc, "Id"));
					},
					mono: true,
					truncate: true
				}),
				component(Field, {
					label: "名称",
					get value() {
						return containerName$2(doc);
					}
				}),
				component(Field, {
					label: "镜像",
					get value() {
						return text$1(pick(doc, "Image"));
					},
					mono: true,
					truncate: true
				}),
				component(Field, {
					label: "状态",
					get value() {
						return health() === "" ? status() : `${status()}（健康检查 ${health()}）`;
					}
				}),
				component(Field, {
					label: "启动时间",
					get value() {
						return startedAt === "" || startedAt.startsWith("0001-") ? "未启动" : shortTime(startedAt);
					}
				}),
				component(Field, {
					label: "重启策略",
					get value() {
						return restartText(pick(hostConfig, "RestartPolicy"));
					}
				}),
				component(Field, {
					label: "启动命令",
					get value() {
						return joinCommand(pick(config, "Cmd"));
					},
					mono: true
				})
			], __nsh_hv18);
			return __nsh_hv17;
		})();
	}
	function networkBody() {
		const settings = objOf(data() ?? {}, "NetworkSettings");
		const networks = objOf(settings, "Networks");
		const names = Object.keys(networks);
		if (names.length === 0) return (() => {
			const __nsh_hv20 = element("view");
			prop(__nsh_hv20, "style", {
				display: "flex",
				flexDirection: "column",
				gap: 4
			});
			const __nsh_hv21 = element("view");
			prop(__nsh_hv21, "style", {
				display: "flex",
				flexDirection: "column",
				gap: 2,
				marginTop: 4
			});
			const __nsh_hv22 = element("text");
			bindProp(__nsh_hv22, "style", () => ({
				...t.meta,
				color: c.muted()
			}));
			const __nsh_hv23 = text("端口映射");
			append(__nsh_hv22, __nsh_hv23);
			append(__nsh_hv21, __nsh_hv22);
			insert(__nsh_hv21, component(PortLines, { get ports() {
				return pick(settings, "Ports");
			} }));
			append(__nsh_hv20, __nsh_hv21);
			insert(__nsh_hv20, [
				component(Field, {
					label: "IP 地址",
					get value() {
						return text$1(pick(settings, "IPAddress"), "未分配");
					},
					mono: true
				}),
				component(Field, {
					label: "网关",
					get value() {
						return text$1(pick(settings, "Gateway"), "未分配");
					},
					mono: true
				}),
				component(Field, {
					label: "MAC",
					get value() {
						return text$1(pick(settings, "MacAddress"), "未分配");
					},
					mono: true
				})
			], __nsh_hv21);
			return __nsh_hv20;
		})();
		return (() => {
			const __nsh_hv24 = element("view");
			prop(__nsh_hv24, "style", {
				display: "flex",
				flexDirection: "column",
				gap: 10
			});
			const __nsh_hv30 = element("view");
			prop(__nsh_hv30, "style", {
				display: "flex",
				flexDirection: "column",
				gap: 2
			});
			const __nsh_hv31 = element("text");
			bindProp(__nsh_hv31, "style", () => ({
				...t.meta,
				color: c.muted()
			}));
			const __nsh_hv32 = text("端口映射");
			append(__nsh_hv31, __nsh_hv32);
			append(__nsh_hv30, __nsh_hv31);
			insert(__nsh_hv30, component(PortLines, { get ports() {
				return pick(settings, "Ports");
			} }));
			append(__nsh_hv24, __nsh_hv30);
			insert(__nsh_hv24, () => names.map((name) => {
				const network = objOf(networks, name);
				const bindings = pick(network, "Ports");
				return (() => {
					const __nsh_hv25 = element("view");
					prop(__nsh_hv25, "style", {
						display: "flex",
						flexDirection: "column",
						gap: 2
					});
					const __nsh_hv26 = element("text");
					bindProp(__nsh_hv26, "style", () => ({
						...t.h2,
						color: c.text()
					}));
					insert(__nsh_hv26, name);
					append(__nsh_hv25, __nsh_hv26);
					insert(__nsh_hv25, [
						component(Field, {
							label: "IP 地址",
							get value() {
								return text$1(pick(network, "IPAddress"), "未分配");
							},
							mono: true
						}),
						component(Field, {
							label: "网关",
							get value() {
								return text$1(pick(network, "Gateway"), "未分配");
							},
							mono: true
						}),
						component(Field, {
							label: "MAC",
							get value() {
								return text$1(pick(network, "MacAddress"), "未分配");
							},
							mono: true
						}),
						() => Array.isArray(bindings) && bindings.length > 0 ? (() => {
							const __nsh_hv27 = element("view");
							prop(__nsh_hv27, "style", {
								display: "flex",
								flexDirection: "column",
								gap: 2
							});
							const __nsh_hv28 = element("text");
							bindProp(__nsh_hv28, "style", () => ({
								...t.meta,
								color: c.muted()
							}));
							const __nsh_hv29 = text("端口映射");
							append(__nsh_hv28, __nsh_hv29);
							append(__nsh_hv27, __nsh_hv28);
							insert(__nsh_hv27, component(PortLines, { ports: bindings }));
							return __nsh_hv27;
						})() : null
					]);
					return __nsh_hv25;
				})();
			}), __nsh_hv30);
			return __nsh_hv24;
		})();
	}
	function mountsBody() {
		const mounts = listOf(data() ?? {}, "Mounts");
		if (mounts.length === 0) return (() => {
			const __nsh_hv33 = element("text");
			bindProp(__nsh_hv33, "style", () => ({
				...t.meta,
				color: c.muted()
			}));
			const __nsh_hv34 = text("没有挂载");
			append(__nsh_hv33, __nsh_hv34);
			return __nsh_hv33;
		})();
		return (() => {
			const __nsh_hv35 = element("view");
			prop(__nsh_hv35, "style", {
				display: "flex",
				flexDirection: "column"
			});
			insert(__nsh_hv35, () => mounts.map((mount, index) => {
				const readOnly = pick(mount, "RW") === false;
				const mode = text$1(pick(mount, "Mode"), "");
				return (() => {
					const __nsh_hv36 = element("view");
					bindProp(__nsh_hv36, "style", () => ({
						display: "flex",
						flexDirection: "column",
						gap: 3,
						paddingVertical: 6,
						borderTopWidth: index === 0 ? 0 : 1,
						borderColor: c.line()
					}));
					const __nsh_hv37 = element("view");
					prop(__nsh_hv37, "style", {
						flexDirection: "row",
						alignItems: "center",
						gap: 6
					});
					const __nsh_hv38 = element("text");
					bindProp(__nsh_hv38, "style", () => ({
						...t.meta,
						color: c.muted()
					}));
					insert(__nsh_hv38, () => `${index + 1}. ${text$1(pick(mount, "Type"), "bind")}`);
					append(__nsh_hv37, __nsh_hv38);
					insert(__nsh_hv37, [component(Badge, {
						text: readOnly ? "只读 (ro)" : "读写 (rw)",
						tone: readOnly ? "warn" : "ok"
					}), () => mode === "" ? null : (() => {
						const __nsh_hv39 = element("text");
						bindProp(__nsh_hv39, "style", () => ({
							...t.meta,
							color: c.muted()
						}));
						insert(__nsh_hv39, `模式 ${mode}`);
						return __nsh_hv39;
					})()]);
					const __nsh_hv40 = element("text");
					prop(__nsh_hv40, "selectable", true);
					bindProp(__nsh_hv40, "style", () => ({
						...t.mono,
						color: c.text()
					}));
					insert(__nsh_hv40, () => `${text$1(pick(mount, "Source"))} → ${text$1(pick(mount, "Destination"))}`);
					append(__nsh_hv36, __nsh_hv37);
					append(__nsh_hv36, __nsh_hv40);
					return __nsh_hv36;
				})();
			}));
			return __nsh_hv35;
		})();
	}
	function envBody() {
		const env = listOf(data() ?? {}, "Config", "Env").map((entry) => String(entry));
		if (env.length === 0) return (() => {
			const __nsh_hv41 = element("text");
			bindProp(__nsh_hv41, "style", () => ({
				...t.meta,
				color: c.muted()
			}));
			const __nsh_hv42 = text("没有环境变量");
			append(__nsh_hv41, __nsh_hv42);
			return __nsh_hv41;
		})();
		return (() => {
			const __nsh_hv43 = element("view");
			prop(__nsh_hv43, "style", {
				display: "flex",
				flexDirection: "column"
			});
			const __nsh_hv47 = element("text");
			bindProp(__nsh_hv47, "style", () => ({
				...t.meta,
				color: c.muted(),
				marginTop: 6
			}));
			const __nsh_hv48 = text("两列：变量名 / 值。值过长会省略；选中文本即可复制完整值。");
			append(__nsh_hv47, __nsh_hv48);
			append(__nsh_hv43, __nsh_hv47);
			insert(__nsh_hv43, () => env.map((entry) => {
				const index = entry.indexOf("=");
				const key = index < 0 ? entry : entry.slice(0, index);
				const value = index < 0 ? "" : entry.slice(index + 1);
				return (() => {
					const __nsh_hv44 = element("view");
					bindProp(__nsh_hv44, "style", () => ({
						flexDirection: "row",
						alignItems: "center",
						gap: 12,
						paddingVertical: 4,
						borderBottomWidth: 1,
						borderColor: c.line()
					}));
					const __nsh_hv45 = element("text");
					prop(__nsh_hv45, "numberOfLines", 1);
					prop(__nsh_hv45, "ellipsizeMode", "tail");
					bindProp(__nsh_hv45, "style", () => ({
						width: 200,
						flexShrink: 0,
						...t.mono,
						color: c.muted()
					}));
					insert(__nsh_hv45, key);
					const __nsh_hv46 = element("text");
					prop(__nsh_hv46, "selectable", true);
					prop(__nsh_hv46, "numberOfLines", 1);
					prop(__nsh_hv46, "ellipsizeMode", "middle");
					bindProp(__nsh_hv46, "style", () => ({
						flex: 1,
						minWidth: 0,
						...t.mono,
						color: c.text()
					}));
					insert(__nsh_hv46, value === "" ? "（空）" : value);
					append(__nsh_hv44, __nsh_hv45);
					append(__nsh_hv44, __nsh_hv46);
					return __nsh_hv44;
				})();
			}), __nsh_hv47);
			return __nsh_hv43;
		})();
	}
	function limitsBody() {
		const hostConfig = objOf(data() ?? {}, "HostConfig");
		const pids = Number(pick(hostConfig, "PidsLimit"));
		return (() => {
			const __nsh_hv49 = element("view");
			prop(__nsh_hv49, "style", {
				display: "flex",
				flexDirection: "column"
			});
			insert(__nsh_hv49, [
				component(Field, {
					label: "CPU 配额",
					get value() {
						return cpuText(hostConfig);
					},
					mono: true
				}),
				component(Field, {
					label: "CPU 权重",
					get value() {
						return Number(pick(hostConfig, "CpuShares")) > 0 ? text$1(pick(hostConfig, "CpuShares")) : "不限（默认权重）";
					},
					mono: true
				}),
				component(Field, {
					label: "内存限制",
					get value() {
						return limitText(pick(hostConfig, "Memory"));
					},
					mono: true
				}),
				component(Field, {
					label: "Swap",
					get value() {
						return swapText(pick(hostConfig, "MemorySwap"));
					},
					mono: true
				}),
				component(Field, {
					label: "进程数上限",
					get value() {
						return Number.isFinite(pids) && pids > 0 ? String(pids) : "不限";
					},
					mono: true
				}),
				component(Field, {
					label: "只读根文件系统",
					get value() {
						return pick(hostConfig, "ReadonlyRootfs") === true ? "是" : "否";
					}
				})
			]);
			return __nsh_hv49;
		})();
	}
	function rawBlock() {
		const lines = JSON.stringify(data() ?? {}, null, 2).split("\n");
		const shown = lines.slice(0, RAW_MAX_LINES);
		return (() => {
			const __nsh_hv50 = element("view");
			bindProp(__nsh_hv50, "style", () => ({
				...panel(12),
				gap: 6,
				display: "flex",
				flexDirection: "column"
			}));
			const __nsh_hv51 = element("text");
			bindProp(__nsh_hv51, "style", () => ({
				...t.meta,
				color: c.muted()
			}));
			insert(__nsh_hv51, () => lines.length > RAW_MAX_LINES ? `原始 JSON · 共 ${lines.length} 行，仅渲染前 ${RAW_MAX_LINES} 行` : `原始 JSON · ${lines.length} 行`);
			const __nsh_hv52 = element("text");
			prop(__nsh_hv52, "selectable", true);
			bindProp(__nsh_hv52, "style", () => ({
				...t.mono,
				color: c.text(),
				lineHeight: 17
			}));
			insert(__nsh_hv52, () => shown.join("\n"));
			const __nsh_hv53 = element("text");
			bindProp(__nsh_hv53, "style", () => ({
				...t.meta,
				color: c.muted()
			}));
			const __nsh_hv54 = text("长行自动折行 · 可选中复制");
			append(__nsh_hv53, __nsh_hv54);
			append(__nsh_hv50, __nsh_hv51);
			append(__nsh_hv50, __nsh_hv52);
			append(__nsh_hv50, __nsh_hv53);
			return __nsh_hv50;
		})();
	}
	function sectionsBlock() {
		const doc = data() ?? {};
		const mountCount = listOf(doc, "Mounts").length;
		const envCount = listOf(doc, "Config", "Env").length;
		const networkCount = Object.keys(objOf(doc, "NetworkSettings", "Networks")).length;
		return (() => {
			const __nsh_hv55 = element("view");
			prop(__nsh_hv55, "style", {
				display: "flex",
				flexDirection: "column",
				gap: 10
			});
			insert(__nsh_hv55, [
				component(Section, {
					title: "基础",
					get hint() {
						return containerName$2(doc);
					},
					open: openBasic,
					onToggle: () => openBasic.set(!openBasic()),
					body: basicBody
				}),
				component(Section, {
					title: "网络",
					hint: networkCount === 0 ? "无网络信息" : `${networkCount} 个网络`,
					open: openNetwork,
					onToggle: () => openNetwork.set(!openNetwork()),
					body: networkBody
				}),
				component(Section, {
					title: "挂载",
					hint: `${mountCount} 项`,
					open: openMounts,
					onToggle: () => openMounts.set(!openMounts()),
					body: mountsBody
				}),
				component(Section, {
					title: "环境变量",
					hint: `${envCount} 项`,
					open: openEnv,
					onToggle: () => openEnv.set(!openEnv()),
					body: envBody
				}),
				component(Section, {
					title: "资源限制",
					hint: "CPU / 内存",
					open: openLimits,
					onToggle: () => openLimits.set(!openLimits()),
					body: limitsBody
				})
			]);
			return __nsh_hv55;
		})();
	}
	function pickerList() {
		if (!pickerOpen()) return null;
		return (() => {
			const __nsh_hv56 = element("view");
			bindProp(__nsh_hv56, "style", () => ({
				display: "flex",
				flexDirection: "column",
				gap: 4,
				marginHorizontal: 14,
				marginBottom: 8,
				padding: 6,
				borderWidth: 1,
				borderColor: c.line(),
				borderRadius: r.card,
				backgroundColor: c.panel()
			}));
			insert(__nsh_hv56, () => containersLoading() && containers().length === 0 ? (() => {
				const __nsh_hv57 = element("text");
				bindProp(__nsh_hv57, "style", () => t.meta);
				const __nsh_hv58 = text("正在读取容器列表…");
				append(__nsh_hv57, __nsh_hv58);
				return __nsh_hv57;
			})() : containersError() !== null && containers().length === 0 ? component(Row, {
				gap: 8,
				get children() {
					return [(() => {
						const __nsh_hv59 = element("text");
						bindProp(__nsh_hv59, "style", () => ({
							...t.meta,
							color: c.danger()
						}));
						insert(__nsh_hv59, () => `容器列表读取失败：${containersError()}`);
						return __nsh_hv59;
					})(), component(Button, {
						label: "重试",
						small: true,
						onPress: () => void loadContainers()
					})];
				}
			}) : visibleContainers().length === 0 ? (() => {
				const __nsh_hv60 = element("text");
				bindProp(__nsh_hv60, "style", () => t.meta);
				insert(__nsh_hv60, () => containers().length === 0 ? "这个连接里没有容器。" : "没有匹配的容器，换个关键词试试。");
				return __nsh_hv60;
			})() : (() => {
				const __nsh_hv61 = element("scroll");
				prop(__nsh_hv61, "style", { maxHeight: 168 });
				const __nsh_hv62 = element("view");
				prop(__nsh_hv62, "style", {
					display: "flex",
					flexDirection: "column"
				});
				insert(__nsh_hv62, () => visibleContainers().map((row) => containerOption(row)));
				append(__nsh_hv61, __nsh_hv62);
				return __nsh_hv61;
			})());
			return __nsh_hv56;
		})();
	}
	function containerOption(row) {
		const id = rowId(row);
		const state = rowState(row);
		return (() => {
			const __nsh_hv63 = element("view");
			prop(__nsh_hv63, "onPress", () => selectContainer(row));
			prop(__nsh_hv63, "role", "button");
			bindProp(__nsh_hv63, "accessibilityLabel", () => `容器 ${rowName(row)}`);
			bindProp(__nsh_hv63, "style", () => ({
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				gap: 8,
				paddingHorizontal: 8,
				paddingVertical: 6,
				borderRadius: r.control,
				backgroundColor: selectedId() === id ? c.hover() : "transparent"
			}));
			const __nsh_hv64 = element("text");
			prop(__nsh_hv64, "numberOfLines", 1);
			bindProp(__nsh_hv64, "style", () => ({
				fontSize: 12,
				fontWeight: "500",
				color: c.text(),
				width: 180
			}));
			insert(__nsh_hv64, () => rowName(row));
			const __nsh_hv65 = element("text");
			prop(__nsh_hv65, "numberOfLines", 1);
			bindProp(__nsh_hv65, "style", () => ({
				...t.mono,
				fontSize: 11,
				color: c.muted(),
				flex: 1,
				minWidth: 0
			}));
			insert(__nsh_hv65, () => rowImage(row));
			append(__nsh_hv63, __nsh_hv64);
			append(__nsh_hv63, __nsh_hv65);
			insert(__nsh_hv63, component(Badge, {
				get text() {
					return state.length === 0 ? "unknown" : state;
				},
				get tone() {
					return containerTone(state);
				}
			}));
			return __nsh_hv63;
		})();
	}
	function pickerToggle() {
		return component(Button, {
			get label() {
				return pickerOpen() ? "收起列表" : selectedId() === null ? "选择容器" : "切换容器";
			},
			small: true,
			onPress: () => pickerOpen.set(!pickerOpen())
		});
	}
	function containerBar() {
		return (() => {
			const __nsh_hv66 = element("view");
			prop(__nsh_hv66, "style", {
				display: "flex",
				flexDirection: "column",
				flexShrink: 0
			});
			insert(__nsh_hv66, [component(Row, {
				wrap: true,
				gap: 8,
				get style() {
					return {
						paddingHorizontal: 14,
						paddingBottom: pickerOpen() ? 6 : 10
					};
				},
				get children() {
					return [
						component(SearchField, {
							get value() {
								return containerQuery();
							},
							onChange: (text) => {
								containerQuery.set(text);
								if (!pickerOpen()) pickerOpen.set(true);
							},
							placeholder: "按名称 / 镜像过滤容器",
							width: 280
						}),
						(() => {
							const __nsh_hv67 = element("text");
							bindProp(__nsh_hv67, "style", () => t.meta);
							insert(__nsh_hv67, () => `${visibleContainers().length} / ${containers().length} 个容器`);
							return __nsh_hv67;
						})(),
						() => selectedId() === null ? (() => {
							const __nsh_hv68 = element("text");
							bindProp(__nsh_hv68, "style", () => t.meta);
							const __nsh_hv69 = text("未选择容器");
							append(__nsh_hv68, __nsh_hv69);
							return __nsh_hv68;
						})() : (() => {
							const __nsh_hv70 = element("text");
							prop(__nsh_hv70, "numberOfLines", 1);
							bindProp(__nsh_hv70, "style", () => ({
								...t.meta,
								color: c.text(),
								maxWidth: 360
							}));
							insert(__nsh_hv70, () => selectedSummary());
							return __nsh_hv70;
						})(),
						(() => {
							const __nsh_hv71 = element("view");
							prop(__nsh_hv71, "style", { flex: 1 });
							return __nsh_hv71;
						})(),
						component(Button, {
							label: "刷新列表",
							small: true,
							onPress: () => void loadContainers()
						}),
						() => pickerToggle()
					];
				}
			}), () => pickerList()]);
			return __nsh_hv66;
		})();
	}
	function toolbar() {
		return (() => {
			const __nsh_hv72 = element("view");
			prop(__nsh_hv72, "style", {
				flexDirection: "row",
				alignItems: "center",
				flexWrap: "wrap",
				gap: 8,
				paddingHorizontal: 14,
				paddingVertical: 10,
				flexShrink: 0
			});
			const __nsh_hv73 = element("text");
			bindProp(__nsh_hv73, "style", () => ({
				...t.h1,
				color: c.text()
			}));
			const __nsh_hv74 = text("容器详情");
			append(__nsh_hv73, __nsh_hv74);
			const __nsh_hv78 = element("view");
			prop(__nsh_hv78, "style", { flex: 1 });
			append(__nsh_hv72, __nsh_hv73);
			append(__nsh_hv72, __nsh_hv78);
			insert(__nsh_hv72, () => selectedId() === null ? (() => {
				const __nsh_hv75 = element("text");
				bindProp(__nsh_hv75, "style", () => ({
					...t.meta,
					color: c.muted()
				}));
				const __nsh_hv76 = text("未选择容器");
				append(__nsh_hv75, __nsh_hv76);
				return __nsh_hv75;
			})() : data() === null ? null : [component(Badge, {
				get text() {
					return status();
				},
				get tone() {
					return statusTone(status());
				}
			}), (() => {
				const __nsh_hv77 = element("text");
				bindProp(__nsh_hv77, "style", () => ({
					...t.meta,
					color: c.muted()
				}));
				insert(__nsh_hv77, () => containerName$2(data() ?? {}));
				return __nsh_hv77;
			})()], __nsh_hv78);
			insert(__nsh_hv72, [
				() => selectedId() === null ? null : (() => {
					const __nsh_hv79 = element("text");
					bindProp(__nsh_hv79, "style", () => ({
						...t.meta,
						color: c.muted()
					}));
					insert(__nsh_hv79, () => loading() ? "读取中…" : busy() ? "刷新中…" : updatedAt() === "" ? "" : `更新于 ${updatedAt()}`);
					return __nsh_hv79;
				})(),
				component(Button, {
					label: "刷新",
					small: true,
					onPress: () => refresh()
				}),
				() => selectedId() === null ? null : chip(showRaw() ? "查看分组" : "查看原始 JSON", showRaw, () => showRaw.set(!showRaw()), "原始 JSON")
			]);
			return __nsh_hv72;
		})();
	}
	function selectionGate() {
		if (containersError() !== null && containers().length === 0) return component(LoadError, {
			get message() {
				return containersError() ?? "";
			},
			onRetry: () => void loadContainers()
		});
		if (containersLoading() && containers().length === 0) return component(Loading, { label: "正在读取容器列表…" });
		if (containers().length === 0) return component(Empty, {
			title: "这个连接里没有容器",
			hint: "docker/container/list 返回了空列表（包含已停止的容器）：先在 Docker 里创建或启动一个容器。",
			get action() {
				return component(Button, {
					label: "重新读取容器列表",
					small: true,
					onPress: () => void loadContainers()
				});
			}
		});
		return component(Empty, {
			title: "先选择一个容器",
			get hint() {
				return `连接里有 ${containers().length} 个容器：在上方列表里点一个，页面会读取它的 inspect 详情。`;
			}
		});
	}
	function body() {
		if (selectedId() === null) return selectionGate();
		if (data() === null && error() !== null) return component(LoadError, {
			get message() {
				return error() ?? "";
			},
			onRetry: () => void load()
		});
		if (data() === null && loading()) return component(Loading, { label: "正在读取容器详情…" });
		if (data() === null) return component(Empty, {
			title: "没有容器数据",
			hint: "docker/container/inspect 没有返回文档：容器可能刚被删除，或者这次采样的结果为空。",
			get action() {
				return component(Button, {
					label: "重新读取",
					small: true,
					onPress: () => void load()
				});
			}
		});
		return (() => {
			const __nsh_hv80 = element("scroll");
			prop(__nsh_hv80, "style", {
				flex: 1,
				minHeight: 0
			});
			const __nsh_hv81 = element("view");
			prop(__nsh_hv81, "style", {
				padding: 14,
				display: "flex",
				flexDirection: "column",
				gap: 10
			});
			insert(__nsh_hv81, [() => error() === null ? null : component(Notice, {
				get message() {
					return `刷新失败：${error()}`;
				},
				tone: "danger"
			}), () => showRaw() ? rawBlock() : sectionsBlock()]);
			append(__nsh_hv80, __nsh_hv81);
			return __nsh_hv80;
		})();
	}
	loadContainers();
	return (() => {
		const __nsh_hv82 = element("view");
		bindProp(__nsh_hv82, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		const __nsh_hv83 = element("view");
		bindProp(__nsh_hv83, "style", () => hairline());
		append(__nsh_hv82, __nsh_hv83);
		insert(__nsh_hv82, () => toolbar(), __nsh_hv83);
		insert(__nsh_hv82, [() => containerBar(), () => body()]);
		return __nsh_hv82;
	})();
}
/** 本地时钟（HH:MM:SS）。 */
function clock() {
	const now = /* @__PURE__ */ new Date();
	const two = (value) => String(value).padStart(2, "0");
	return `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
}

//#endregion
//#region pages/container-mounts/App.tsx
/** 挂载类型 → 胶囊配色；未知类型保持中性。 */
function typeTone(type) {
	const text = type.toLowerCase();
	if (text === "bind") return "info";
	if (text === "volume") return "ok";
	if (text === "tmpfs") return "warn";
	return "neutral";
}
function typeOf(entry) {
	const type = str(entry, "Type", "").toLowerCase();
	return type.length > 0 ? type : "bind";
}
function modeOf(entry) {
	return str(entry, "Mode", "默认");
}
function isReadOnly(entry) {
	if (entry.RW === false) return true;
	return /^ro\b/.test(str(entry, "Mode", ""));
}
const containerId$1 = (row) => str(row, "id", "");
const containerName$1 = (row) => str(row, "name", "");
const containerImage$1 = (row) => str(row, "image", "");
const containerState$1 = (row) => str(row, "state", "");
function stateTone$2(state) {
	if (state === "running") return "ok";
	if (state === "paused" || state === "restarting") return "warn";
	if (state === "exited" || state === "dead") return "danger";
	return "neutral";
}
function ContainerMounts() {
	const mounts = signal([]);
	const loading = signal(true);
	const error = signal(null);
	const busy = signal(false);
	const containers = signal([]);
	const containerQuery = signal("");
	const containersLoading = signal(true);
	const containersError = signal(null);
	const selectedId = signal(null);
	const selectedName = signal("");
	const pickerOpen = signal(true);
	let seq = 0;
	function readOnlyCount() {
		return mounts().filter((entry) => isReadOnly(entry)).length;
	}
	function visibleContainers() {
		const needle = containerQuery().trim().toLowerCase();
		if (needle.length === 0) return containers();
		return containers().filter((row) => `${containerName$1(row)} ${containerImage$1(row)}`.toLowerCase().includes(needle));
	}
	function selectedSummary() {
		const id = selectedId();
		if (id === null) return "";
		const row = containers().find((item) => containerId$1(item) === id);
		return row === void 0 ? selectedName() : `${containerName$1(row)} · ${containerImage$1(row)}`;
	}
	function resetData() {
		mounts.set([]);
		error.set(null);
	}
	function clearSelection() {
		selectedId.set(null);
		selectedName.set("");
		resetData();
		loading.set(false);
		pickerOpen.set(true);
	}
	function selectContainer(row) {
		const id = containerId$1(row);
		if (id.length === 0) return;
		if (selectedId() === id) {
			pickerOpen.set(false);
			return;
		}
		selectedId.set(id);
		selectedName.set(containerName$1(row));
		pickerOpen.set(false);
		resetData();
		loading.set(true);
		load();
	}
	function refresh() {
		if (selectedId() === null) loadContainers();
		else load();
	}
	async function loadContainers() {
		containersLoading.set(true);
		try {
			const result = await invoke$1("docker/container/list", {}, { timeout: SLOW_TIMEOUT_MS });
			const list = Array.isArray(result) ? result : arr(result, "containers");
			containers.set(list);
			containersError.set(null);
			const current = selectedId();
			if (current !== null && !list.some((row) => containerId$1(row) === current)) clearSelection();
		} catch (failure) {
			containersError.set(errorMessage(failure));
		} finally {
			containersLoading.set(false);
		}
	}
	async function load() {
		const id = selectedId();
		if (id === null) return;
		const mine = ++seq;
		busy.set(true);
		if (mounts().length === 0) loading.set(true);
		try {
			const result = await invoke$1("docker/container/mounts", { id }, { timeout: SLOW_TIMEOUT_MS });
			if (mine !== seq) return;
			const list = Array.isArray(result) ? result : arr(result, "mounts");
			mounts.set(list);
			error.set(null);
		} catch (failure) {
			if (mine !== seq) return;
			error.set(errorMessage(failure));
		} finally {
			if (mine === seq) {
				loading.set(false);
				busy.set(false);
			}
		}
	}
	function pickerList() {
		if (!pickerOpen()) return null;
		return (() => {
			const __nsh_hv0 = element("view");
			bindProp(__nsh_hv0, "style", () => ({
				display: "flex",
				flexDirection: "column",
				gap: 4,
				marginHorizontal: 14,
				marginBottom: 8,
				padding: 6,
				borderWidth: 1,
				borderColor: c.line(),
				borderRadius: r.card,
				backgroundColor: c.panel()
			}));
			insert(__nsh_hv0, () => containersLoading() && containers().length === 0 ? (() => {
				const __nsh_hv1 = element("text");
				bindProp(__nsh_hv1, "style", () => t.meta);
				const __nsh_hv2 = text("正在读取容器列表…");
				append(__nsh_hv1, __nsh_hv2);
				return __nsh_hv1;
			})() : containersError() !== null && containers().length === 0 ? component(Row, {
				gap: 8,
				get children() {
					return [(() => {
						const __nsh_hv3 = element("text");
						bindProp(__nsh_hv3, "style", () => ({
							...t.meta,
							color: c.danger()
						}));
						insert(__nsh_hv3, () => `容器列表读取失败：${containersError()}`);
						return __nsh_hv3;
					})(), component(Button, {
						label: "重试",
						small: true,
						onPress: () => void loadContainers()
					})];
				}
			}) : visibleContainers().length === 0 ? (() => {
				const __nsh_hv4 = element("text");
				bindProp(__nsh_hv4, "style", () => t.meta);
				insert(__nsh_hv4, () => containers().length === 0 ? "这个连接里没有容器。" : "没有匹配的容器，换个关键词试试。");
				return __nsh_hv4;
			})() : (() => {
				const __nsh_hv5 = element("scroll");
				prop(__nsh_hv5, "style", { maxHeight: 168 });
				const __nsh_hv6 = element("view");
				prop(__nsh_hv6, "style", {
					display: "flex",
					flexDirection: "column"
				});
				insert(__nsh_hv6, () => visibleContainers().map((row) => containerOption(row)));
				append(__nsh_hv5, __nsh_hv6);
				return __nsh_hv5;
			})());
			return __nsh_hv0;
		})();
	}
	function containerOption(row) {
		const id = containerId$1(row);
		const state = containerState$1(row);
		return (() => {
			const __nsh_hv7 = element("view");
			prop(__nsh_hv7, "onPress", () => selectContainer(row));
			prop(__nsh_hv7, "role", "button");
			bindProp(__nsh_hv7, "accessibilityLabel", () => `容器 ${containerName$1(row)}`);
			bindProp(__nsh_hv7, "style", () => ({
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				gap: 8,
				paddingHorizontal: 8,
				paddingVertical: 6,
				borderRadius: r.control,
				backgroundColor: selectedId() === id ? c.hover() : "transparent"
			}));
			const __nsh_hv8 = element("text");
			prop(__nsh_hv8, "numberOfLines", 1);
			bindProp(__nsh_hv8, "style", () => ({
				fontSize: 12,
				fontWeight: "500",
				color: c.text(),
				width: 180
			}));
			insert(__nsh_hv8, () => containerName$1(row));
			const __nsh_hv9 = element("text");
			prop(__nsh_hv9, "numberOfLines", 1);
			bindProp(__nsh_hv9, "style", () => ({
				...t.mono,
				fontSize: 11,
				color: c.muted(),
				flex: 1,
				minWidth: 0
			}));
			insert(__nsh_hv9, () => containerImage$1(row));
			append(__nsh_hv7, __nsh_hv8);
			append(__nsh_hv7, __nsh_hv9);
			insert(__nsh_hv7, component(Badge, {
				get text() {
					return state.length === 0 ? "unknown" : state;
				},
				get tone() {
					return stateTone$2(state);
				}
			}));
			return __nsh_hv7;
		})();
	}
	function pickerToggle() {
		return component(Button, {
			get label() {
				return pickerOpen() ? "收起列表" : selectedId() === null ? "选择容器" : "切换容器";
			},
			small: true,
			onPress: () => pickerOpen.set(!pickerOpen())
		});
	}
	function containerBar() {
		return (() => {
			const __nsh_hv10 = element("view");
			prop(__nsh_hv10, "style", {
				display: "flex",
				flexDirection: "column",
				flexShrink: 0
			});
			insert(__nsh_hv10, [component(Row, {
				wrap: true,
				gap: 8,
				get style() {
					return {
						paddingHorizontal: 14,
						paddingBottom: pickerOpen() ? 6 : 10
					};
				},
				get children() {
					return [
						component(SearchField, {
							get value() {
								return containerQuery();
							},
							onChange: (text) => {
								containerQuery.set(text);
								if (!pickerOpen()) pickerOpen.set(true);
							},
							placeholder: "按名称 / 镜像过滤容器",
							width: 280
						}),
						(() => {
							const __nsh_hv11 = element("text");
							bindProp(__nsh_hv11, "style", () => t.meta);
							insert(__nsh_hv11, () => `${visibleContainers().length} / ${containers().length} 个容器`);
							return __nsh_hv11;
						})(),
						() => selectedId() === null ? (() => {
							const __nsh_hv12 = element("text");
							bindProp(__nsh_hv12, "style", () => t.meta);
							const __nsh_hv13 = text("未选择容器");
							append(__nsh_hv12, __nsh_hv13);
							return __nsh_hv12;
						})() : (() => {
							const __nsh_hv14 = element("text");
							prop(__nsh_hv14, "numberOfLines", 1);
							bindProp(__nsh_hv14, "style", () => ({
								...t.meta,
								color: c.text(),
								maxWidth: 360
							}));
							insert(__nsh_hv14, () => selectedSummary());
							return __nsh_hv14;
						})(),
						(() => {
							const __nsh_hv15 = element("view");
							prop(__nsh_hv15, "style", { flex: 1 });
							return __nsh_hv15;
						})(),
						component(Button, {
							label: "刷新列表",
							small: true,
							onPress: () => void loadContainers()
						}),
						() => pickerToggle()
					];
				}
			}), () => pickerList()]);
			return __nsh_hv10;
		})();
	}
	function mountRow(entry) {
		const type = typeOf(entry);
		const readOnly = isReadOnly(entry);
		const name = str(entry, "Name", "");
		return (() => {
			const __nsh_hv16 = element("view");
			bindProp(__nsh_hv16, "style", () => ({
				display: "flex",
				flexDirection: "column",
				gap: 5,
				paddingHorizontal: 12,
				paddingVertical: 9,
				borderBottomWidth: 1,
				borderBottomColor: c.line()
			}));
			insert(__nsh_hv16, [
				component(Row, {
					gap: 8,
					get children() {
						return [
							component(Badge, {
								text: type,
								get tone() {
									return typeTone(type);
								}
							}),
							() => readOnly ? component(Badge, {
								text: "只读",
								tone: "warn"
							}) : component(Badge, {
								text: "可写",
								tone: "neutral"
							}),
							(() => {
								const __nsh_hv17 = element("text");
								prop(__nsh_hv17, "numberOfLines", 1);
								bindProp(__nsh_hv17, "style", () => t.meta);
								insert(__nsh_hv17, () => `模式 ${modeOf(entry)}`);
								return __nsh_hv17;
							})(),
							(() => {
								const __nsh_hv18 = element("text");
								prop(__nsh_hv18, "numberOfLines", 1);
								bindProp(__nsh_hv18, "style", () => ({
									...t.meta,
									flex: 1,
									minWidth: 0,
									textAlign: "right"
								}));
								insert(__nsh_hv18, () => name.length > 0 ? `名称 ${name}` : "");
								return __nsh_hv18;
							})()
						];
					}
				}),
				component(Row, {
					gap: 6,
					align: "flex-start",
					get children() {
						return [(() => {
							const __nsh_hv19 = element("text");
							bindProp(__nsh_hv19, "style", () => ({
								...t.label,
								width: 26,
								flexShrink: 0
							}));
							const __nsh_hv20 = text("源");
							append(__nsh_hv19, __nsh_hv20);
							return __nsh_hv19;
						})(), (() => {
							const __nsh_hv21 = element("text");
							bindProp(__nsh_hv21, "style", () => ({
								...t.mono,
								flex: 1,
								minWidth: 0
							}));
							insert(__nsh_hv21, () => str(entry, "Source", "-"));
							return __nsh_hv21;
						})()];
					}
				}),
				component(Row, {
					gap: 6,
					align: "flex-start",
					get children() {
						return [(() => {
							const __nsh_hv22 = element("text");
							bindProp(__nsh_hv22, "style", () => ({
								...t.label,
								width: 26,
								flexShrink: 0
							}));
							const __nsh_hv23 = text("目标");
							append(__nsh_hv22, __nsh_hv23);
							return __nsh_hv22;
						})(), (() => {
							const __nsh_hv24 = element("text");
							bindProp(__nsh_hv24, "style", () => ({
								...t.mono,
								flex: 1,
								minWidth: 0
							}));
							insert(__nsh_hv24, () => str(entry, "Destination", "-"));
							return __nsh_hv24;
						})()];
					}
				})
			]);
			return __nsh_hv16;
		})();
	}
	function selectionGate() {
		if (containersError() !== null && containers().length === 0) return component(LoadError, {
			get message() {
				return containersError() ?? "";
			},
			onRetry: () => void loadContainers()
		});
		if (containersLoading() && containers().length === 0) return component(Loading, { label: "正在读取容器列表…" });
		if (containers().length === 0) return component(Empty, {
			title: "这个连接里没有容器",
			hint: "docker/container/list 返回了空列表（包含已停止的容器）：先在 Docker 里创建或启动一个容器。",
			get action() {
				return component(Button, {
					label: "重新读取容器列表",
					small: true,
					onPress: () => void loadContainers()
				});
			}
		});
		return component(Empty, {
			title: "先选择一个容器",
			get hint() {
				return `连接里有 ${containers().length} 个容器：在上方列表里点一个，页面会读取它的挂载。`;
			}
		});
	}
	function body() {
		if (selectedId() === null) return selectionGate();
		if (loading() && mounts().length === 0) return component(Loading, { label: "正在读取容器挂载…" });
		if (error() !== null && mounts().length === 0) return component(LoadError, {
			get message() {
				return error() ?? "";
			},
			onRetry: () => void load()
		});
		if (mounts().length === 0) return component(Empty, {
			title: "容器没有挂载",
			hint: "容器启动时没有声明 bind / volume / tmpfs 挂载，因此没有宿主机路径映射进来。",
			get action() {
				return component(Button, {
					label: "重新读取",
					small: true,
					onPress: () => void load()
				});
			}
		});
		return (() => {
			const __nsh_hv25 = element("view");
			prop(__nsh_hv25, "style", {
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "column"
			});
			const __nsh_hv27 = element("scroll");
			prop(__nsh_hv27, "style", {
				flex: 1,
				minHeight: 0
			});
			const __nsh_hv28 = element("view");
			prop(__nsh_hv28, "style", {
				display: "flex",
				flexDirection: "column"
			});
			insert(__nsh_hv28, () => mounts().map((entry) => mountRow(entry)));
			append(__nsh_hv27, __nsh_hv28);
			const __nsh_hv29 = element("view");
			bindProp(__nsh_hv29, "style", () => ({
				paddingHorizontal: 12,
				paddingVertical: 7,
				borderTopWidth: 1,
				borderTopColor: c.line(),
				backgroundColor: c.panel(),
				flexShrink: 0
			}));
			const __nsh_hv30 = element("text");
			prop(__nsh_hv30, "numberOfLines", 1);
			bindProp(__nsh_hv30, "style", () => t.meta);
			const __nsh_hv31 = text("数据来自容器 Mounts 字段；RW=false 或 Mode 以 ro 开头的挂载按只读显示。");
			append(__nsh_hv30, __nsh_hv31);
			append(__nsh_hv29, __nsh_hv30);
			append(__nsh_hv25, __nsh_hv27);
			append(__nsh_hv25, __nsh_hv29);
			insert(__nsh_hv25, () => error() === null ? null : (() => {
				const __nsh_hv26 = element("view");
				prop(__nsh_hv26, "style", {
					paddingHorizontal: 12,
					paddingTop: 8
				});
				insert(__nsh_hv26, component(Notice, { get message() {
					return `刷新失败：${error() ?? ""}`;
				} }));
				return __nsh_hv26;
			})(), __nsh_hv27);
			return __nsh_hv25;
		})();
	}
	function toolbar() {
		return component(Row, {
			gap: 8,
			style: {
				paddingHorizontal: 14,
				paddingVertical: 10,
				justifyContent: "space-between",
				flexShrink: 0
			},
			get children() {
				return [component(Row, {
					gap: 8,
					get children() {
						return [(() => {
							const __nsh_hv32 = element("text");
							bindProp(__nsh_hv32, "style", () => t.h1);
							const __nsh_hv33 = text("挂载");
							append(__nsh_hv32, __nsh_hv33);
							return __nsh_hv32;
						})(), () => selectedId() === null ? (() => {
							const __nsh_hv34 = element("text");
							bindProp(__nsh_hv34, "style", () => t.meta);
							const __nsh_hv35 = text("未选择容器");
							append(__nsh_hv34, __nsh_hv35);
							return __nsh_hv34;
						})() : [(() => {
							const __nsh_hv36 = element("text");
							bindProp(__nsh_hv36, "style", () => t.meta);
							insert(__nsh_hv36, () => `${mounts().length} 个挂载`);
							return __nsh_hv36;
						})(), component(Badge, {
							get text() {
								return `只读 ${readOnlyCount()}`;
							},
							tone: "warn"
						})]];
					}
				}), component(Row, {
					gap: 6,
					get children() {
						return [() => busy() ? (() => {
							const __nsh_hv37 = element("text");
							bindProp(__nsh_hv37, "style", () => t.meta);
							const __nsh_hv38 = text("正在读取…");
							append(__nsh_hv37, __nsh_hv38);
							return __nsh_hv37;
						})() : null, component(Button, {
							label: "刷新",
							small: true,
							onPress: () => refresh()
						})];
					}
				})];
			}
		});
	}
	loadContainers();
	return (() => {
		const __nsh_hv39 = element("view");
		bindProp(__nsh_hv39, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		const __nsh_hv40 = element("view");
		bindProp(__nsh_hv40, "style", () => hairline());
		append(__nsh_hv39, __nsh_hv40);
		insert(__nsh_hv39, () => toolbar(), __nsh_hv40);
		insert(__nsh_hv39, [() => containerBar(), () => body()]);
		return __nsh_hv39;
	})();
}

//#endregion
//#region pages/container-stats/App.tsx
function numberField(source, key) {
	if (source === null) return null;
	const value = source[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function clockText(date) {
	const two = (value) => String(value).padStart(2, "0");
	return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}
const containerId = (row) => str(row, "id", "");
const containerName = (row) => str(row, "name", "");
const containerImage = (row) => str(row, "image", "");
const containerState = (row) => str(row, "state", "");
function stateTone$1(state) {
	if (state === "running") return "ok";
	if (state === "paused" || state === "restarting") return "warn";
	if (state === "exited" || state === "dead") return "danger";
	return "neutral";
}
const AUTO_REFRESH_MS = 2e3;
function ContainerStats() {
	const sample = signal(null);
	const sampledAt = signal("-");
	const loading = signal(true);
	const error = signal(null);
	const busy = signal(false);
	const autoRefresh = signal(false);
	const containers = signal([]);
	const containerQuery = signal("");
	const containersLoading = signal(true);
	const containersError = signal(null);
	const selectedId = signal(null);
	const selectedName = signal("");
	const pickerOpen = signal(true);
	let seq = 0;
	let timer = null;
	const cpu = () => numberField(sample(), "cpu_percent");
	const cores = () => numberField(sample(), "online_cpus");
	const usage = () => numberField(sample(), "memory_usage_bytes");
	const limit = () => numberField(sample(), "memory_limit_bytes");
	function hasSample() {
		return sample() !== null && (cpu() !== null || usage() !== null);
	}
	function cpuText() {
		const value = cpu();
		return value === null ? "-" : `${value.toFixed(1)}%`;
	}
	function coresHint() {
		const value = cores();
		if (value === null) return "核数未知";
		return `${value} 个核 · 100% ≈ 1 核满载`;
	}
	function memoryCaption() {
		return `${humanBytes(usage())} / ${humanBytes(limit())}`;
	}
	function memoryLeft() {
		const used = usage();
		const total = limit();
		if (used === null || total === null) return "-";
		return humanBytes(Math.max(0, total - used));
	}
	function visibleContainers() {
		const needle = containerQuery().trim().toLowerCase();
		if (needle.length === 0) return containers();
		return containers().filter((row) => `${containerName(row)} ${containerImage(row)}`.toLowerCase().includes(needle));
	}
	function selectedSummary() {
		const id = selectedId();
		if (id === null) return "";
		const row = containers().find((item) => containerId(item) === id);
		return row === void 0 ? selectedName() : `${containerName(row)} · ${containerImage(row)}`;
	}
	function resetData() {
		sample.set(null);
		sampledAt.set("-");
		error.set(null);
	}
	function stopTimer() {
		if (timer !== null) {
			clearInterval(timer);
			timer = null;
		}
	}
	function setAutoRefresh(on) {
		autoRefresh.set(on);
		stopTimer();
		if (on) timer = setInterval(() => {
			if (selectedId() !== null) load();
		}, AUTO_REFRESH_MS);
	}
	function clearSelection() {
		selectedId.set(null);
		selectedName.set("");
		resetData();
		loading.set(false);
		pickerOpen.set(true);
	}
	function selectContainer(row) {
		const id = containerId(row);
		if (id.length === 0) return;
		if (selectedId() === id) {
			pickerOpen.set(false);
			return;
		}
		selectedId.set(id);
		selectedName.set(containerName(row));
		pickerOpen.set(false);
		resetData();
		loading.set(true);
		load();
	}
	function refresh() {
		if (selectedId() === null) loadContainers();
		else load();
	}
	async function loadContainers() {
		containersLoading.set(true);
		try {
			const result = await invoke$1("docker/container/list", {}, { timeout: SLOW_TIMEOUT_MS });
			const list = Array.isArray(result) ? result : arr(result, "containers");
			containers.set(list);
			containersError.set(null);
			const current = selectedId();
			if (current !== null && !list.some((row) => containerId(row) === current)) clearSelection();
		} catch (failure) {
			containersError.set(errorMessage(failure));
		} finally {
			containersLoading.set(false);
		}
	}
	async function load() {
		const id = selectedId();
		if (id === null) return;
		if (busy()) return;
		const mine = ++seq;
		busy.set(true);
		if (sample() === null) loading.set(true);
		try {
			const result = await invoke$1("docker/container/stats", { id }, { timeout: SLOW_TIMEOUT_MS });
			if (mine !== seq) return;
			sample.set(result ?? null);
			sampledAt.set(clockText(/* @__PURE__ */ new Date()));
			error.set(null);
		} catch (failure) {
			if (mine !== seq) return;
			error.set(errorMessage(failure));
		} finally {
			if (mine === seq) {
				loading.set(false);
				busy.set(false);
			}
		}
	}
	function pickerList() {
		if (!pickerOpen()) return null;
		return (() => {
			const __nsh_hv0 = element("view");
			bindProp(__nsh_hv0, "style", () => ({
				display: "flex",
				flexDirection: "column",
				gap: 4,
				marginHorizontal: 14,
				marginBottom: 8,
				padding: 6,
				borderWidth: 1,
				borderColor: c.line(),
				borderRadius: r.card,
				backgroundColor: c.panel()
			}));
			insert(__nsh_hv0, () => containersLoading() && containers().length === 0 ? (() => {
				const __nsh_hv1 = element("text");
				bindProp(__nsh_hv1, "style", () => t.meta);
				const __nsh_hv2 = text("正在读取容器列表…");
				append(__nsh_hv1, __nsh_hv2);
				return __nsh_hv1;
			})() : containersError() !== null && containers().length === 0 ? component(Row, {
				gap: 8,
				get children() {
					return [(() => {
						const __nsh_hv3 = element("text");
						bindProp(__nsh_hv3, "style", () => ({
							...t.meta,
							color: c.danger()
						}));
						insert(__nsh_hv3, () => `容器列表读取失败：${containersError()}`);
						return __nsh_hv3;
					})(), component(Button, {
						label: "重试",
						small: true,
						onPress: () => void loadContainers()
					})];
				}
			}) : visibleContainers().length === 0 ? (() => {
				const __nsh_hv4 = element("text");
				bindProp(__nsh_hv4, "style", () => t.meta);
				insert(__nsh_hv4, () => containers().length === 0 ? "这个连接里没有容器。" : "没有匹配的容器，换个关键词试试。");
				return __nsh_hv4;
			})() : (() => {
				const __nsh_hv5 = element("scroll");
				prop(__nsh_hv5, "style", { maxHeight: 168 });
				const __nsh_hv6 = element("view");
				prop(__nsh_hv6, "style", {
					display: "flex",
					flexDirection: "column"
				});
				insert(__nsh_hv6, () => visibleContainers().map((row) => containerOption(row)));
				append(__nsh_hv5, __nsh_hv6);
				return __nsh_hv5;
			})());
			return __nsh_hv0;
		})();
	}
	function containerOption(row) {
		const id = containerId(row);
		const state = containerState(row);
		return (() => {
			const __nsh_hv7 = element("view");
			prop(__nsh_hv7, "onPress", () => selectContainer(row));
			prop(__nsh_hv7, "role", "button");
			bindProp(__nsh_hv7, "accessibilityLabel", () => `容器 ${containerName(row)}`);
			bindProp(__nsh_hv7, "style", () => ({
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				gap: 8,
				paddingHorizontal: 8,
				paddingVertical: 6,
				borderRadius: r.control,
				backgroundColor: selectedId() === id ? c.hover() : "transparent"
			}));
			const __nsh_hv8 = element("text");
			prop(__nsh_hv8, "numberOfLines", 1);
			bindProp(__nsh_hv8, "style", () => ({
				fontSize: 12,
				fontWeight: "500",
				color: c.text(),
				width: 180
			}));
			insert(__nsh_hv8, () => containerName(row));
			const __nsh_hv9 = element("text");
			prop(__nsh_hv9, "numberOfLines", 1);
			bindProp(__nsh_hv9, "style", () => ({
				...t.mono,
				fontSize: 11,
				color: c.muted(),
				flex: 1,
				minWidth: 0
			}));
			insert(__nsh_hv9, () => containerImage(row));
			append(__nsh_hv7, __nsh_hv8);
			append(__nsh_hv7, __nsh_hv9);
			insert(__nsh_hv7, component(Badge, {
				get text() {
					return state.length === 0 ? "unknown" : state;
				},
				get tone() {
					return stateTone$1(state);
				}
			}));
			return __nsh_hv7;
		})();
	}
	function pickerToggle() {
		return component(Button, {
			get label() {
				return pickerOpen() ? "收起列表" : selectedId() === null ? "选择容器" : "切换容器";
			},
			small: true,
			onPress: () => pickerOpen.set(!pickerOpen())
		});
	}
	function autoRefreshToggle() {
		return component(Button, {
			get label() {
				return autoRefresh() ? `自动刷新 · ${AUTO_REFRESH_MS / 1e3}s` : "自动刷新";
			},
			small: true,
			get tone() {
				return autoRefresh() ? "primary" : "ghost";
			},
			onPress: () => setAutoRefresh(!autoRefresh())
		});
	}
	function containerBar() {
		return (() => {
			const __nsh_hv10 = element("view");
			prop(__nsh_hv10, "style", {
				display: "flex",
				flexDirection: "column",
				flexShrink: 0
			});
			insert(__nsh_hv10, [component(Row, {
				wrap: true,
				gap: 8,
				get style() {
					return {
						paddingHorizontal: 14,
						paddingBottom: pickerOpen() ? 6 : 10
					};
				},
				get children() {
					return [
						component(SearchField, {
							get value() {
								return containerQuery();
							},
							onChange: (text) => {
								containerQuery.set(text);
								if (!pickerOpen()) pickerOpen.set(true);
							},
							placeholder: "按名称 / 镜像过滤容器",
							width: 280
						}),
						(() => {
							const __nsh_hv11 = element("text");
							bindProp(__nsh_hv11, "style", () => t.meta);
							insert(__nsh_hv11, () => `${visibleContainers().length} / ${containers().length} 个容器`);
							return __nsh_hv11;
						})(),
						() => selectedId() === null ? (() => {
							const __nsh_hv12 = element("text");
							bindProp(__nsh_hv12, "style", () => t.meta);
							const __nsh_hv13 = text("未选择容器");
							append(__nsh_hv12, __nsh_hv13);
							return __nsh_hv12;
						})() : (() => {
							const __nsh_hv14 = element("text");
							prop(__nsh_hv14, "numberOfLines", 1);
							bindProp(__nsh_hv14, "style", () => ({
								...t.meta,
								color: c.text(),
								maxWidth: 360
							}));
							insert(__nsh_hv14, () => selectedSummary());
							return __nsh_hv14;
						})(),
						(() => {
							const __nsh_hv15 = element("view");
							prop(__nsh_hv15, "style", { flex: 1 });
							return __nsh_hv15;
						})(),
						component(Button, {
							label: "刷新列表",
							small: true,
							onPress: () => void loadContainers()
						}),
						() => pickerToggle()
					];
				}
			}), () => pickerList()]);
			return __nsh_hv10;
		})();
	}
	function selectionGate() {
		if (containersError() !== null && containers().length === 0) return component(LoadError, {
			get message() {
				return containersError() ?? "";
			},
			onRetry: () => void loadContainers()
		});
		if (containersLoading() && containers().length === 0) return component(Loading, { label: "正在读取容器列表…" });
		if (containers().length === 0) return component(Empty, {
			title: "这个连接里没有容器",
			hint: "docker/container/list 返回了空列表（包含已停止的容器）：先在 Docker 里创建或启动一个容器。",
			get action() {
				return component(Button, {
					label: "重新读取容器列表",
					small: true,
					onPress: () => void loadContainers()
				});
			}
		});
		return component(Empty, {
			title: "先选择一个容器",
			get hint() {
				return `连接里有 ${containers().length} 个容器：在上方列表里点一个，页面会采样它的资源占用。`;
			}
		});
	}
	function content() {
		if (selectedId() === null) return selectionGate();
		if (loading() && sample() === null) return component(Loading, { label: "正在采样容器资源占用…" });
		if (error() !== null && sample() === null) return component(LoadError, {
			get message() {
				return error() ?? "";
			},
			onRetry: () => void load()
		});
		if (!hasSample()) return component(Empty, {
			title: "没有可用的采样",
			hint: "containerStats 没有返回 CPU / 内存数据：容器可能已经停止，或这次一次性采样失败。刷新会重新取一次。",
			get action() {
				return component(Button, {
					label: "重新采样",
					small: true,
					onPress: () => void load()
				});
			}
		});
		return (() => {
			const __nsh_hv16 = element("scroll");
			prop(__nsh_hv16, "style", {
				flex: 1,
				minHeight: 0
			});
			const __nsh_hv17 = element("view");
			prop(__nsh_hv17, "style", {
				padding: 14,
				display: "flex",
				flexDirection: "column",
				gap: 12
			});
			insert(__nsh_hv17, [
				() => error() === null ? null : component(Notice, { get message() {
					return `刷新失败：${error() ?? ""}`;
				} }),
				component(Row, {
					gap: 12,
					wrap: true,
					get children() {
						return [
							component(Stat, {
								label: "CPU 使用率",
								get value() {
									return cpuText();
								},
								get hint() {
									return coresHint();
								}
							}),
							component(Stat, {
								label: "内存用量",
								get value() {
									return humanBytes(usage());
								},
								get hint() {
									return `上限 ${humanBytes(limit())}`;
								}
							}),
							component(Stat, {
								label: "内存使用率",
								get value() {
									return percent(usage(), limit());
								},
								get hint() {
									return `剩余 ${memoryLeft()}`;
								},
								get tone() {
									return ratio(usage(), limit()) > .9 ? "danger" : "neutral";
								}
							})
						];
					}
				}),
				component(Card, {
					title: "内存",
					hint: "用量 / 上限",
					get children() {
						return [
							component(Meter, {
								get ratio() {
									return ratio(usage(), limit());
								},
								label: "内存占用",
								get caption() {
									return memoryCaption();
								}
							}),
							component(Row, {
								style: { justifyContent: "space-between" },
								get children() {
									return [(() => {
										const __nsh_hv18 = element("text");
										bindProp(__nsh_hv18, "style", () => t.label);
										const __nsh_hv19 = text("采样时间");
										append(__nsh_hv18, __nsh_hv19);
										return __nsh_hv18;
									})(), (() => {
										const __nsh_hv20 = element("text");
										bindProp(__nsh_hv20, "style", () => ({
											...t.mono,
											color: c.muted()
										}));
										insert(__nsh_hv20, () => sampledAt());
										return __nsh_hv20;
									})()];
								}
							}),
							(() => {
								const __nsh_hv21 = element("text");
								bindProp(__nsh_hv21, "style", () => t.meta);
								insert(__nsh_hv21, () => autoRefresh() ? `采样时间取本次请求返回时的本地时间；自动刷新每 ${AUTO_REFRESH_MS / 1e3} 秒采样一次。` : "采样时间取本次请求返回时的本地时间；默认只手动刷新，可以打开自动刷新。");
								return __nsh_hv21;
							})()
						];
					}
				}),
				component(Card, {
					title: "网络收发",
					hint: "宿主未提供",
					get children() {
						return [component(Row, {
							gap: 12,
							wrap: true,
							get children() {
								return [component(Stat, {
									label: "收到",
									value: "—",
									hint: "containerStats 未返回网络字段"
								}), component(Stat, {
									label: "发出",
									value: "—",
									hint: "containerStats 未返回网络字段"
								})];
							}
						}), (() => {
							const __nsh_hv22 = element("text");
							bindProp(__nsh_hv22, "style", () => t.meta);
							const __nsh_hv23 = text("provider 的 summarize_stats 只汇总 CPU 与内存，Docker 的 networks（rx / tx 字节与包数）没有被解析。");
							append(__nsh_hv22, __nsh_hv23);
							return __nsh_hv22;
						})()];
					}
				}),
				component(Card, {
					title: "块 IO",
					hint: "宿主未提供",
					get children() {
						return [component(Row, {
							gap: 12,
							wrap: true,
							get children() {
								return [component(Stat, {
									label: "读取",
									value: "—",
									hint: "containerStats 未返回块 IO 字段"
								}), component(Stat, {
									label: "写入",
									value: "—",
									hint: "containerStats 未返回块 IO 字段"
								})];
							}
						}), (() => {
							const __nsh_hv24 = element("text");
							bindProp(__nsh_hv24, "style", () => t.meta);
							const __nsh_hv25 = text("同样，blkio_stats（read / write 字节数）不在 operation 的返回结构里；补上后这两组指标可以直接填进来。");
							append(__nsh_hv24, __nsh_hv25);
							return __nsh_hv24;
						})()];
					}
				})
			]);
			append(__nsh_hv16, __nsh_hv17);
			return __nsh_hv16;
		})();
	}
	function toolbar() {
		return component(Row, {
			gap: 8,
			style: {
				paddingHorizontal: 14,
				paddingVertical: 10,
				justifyContent: "space-between",
				flexShrink: 0
			},
			get children() {
				return [component(Row, {
					gap: 8,
					get children() {
						return [(() => {
							const __nsh_hv26 = element("text");
							bindProp(__nsh_hv26, "style", () => t.h1);
							const __nsh_hv27 = text("资源占用");
							append(__nsh_hv26, __nsh_hv27);
							return __nsh_hv26;
						})(), () => selectedId() === null ? (() => {
							const __nsh_hv28 = element("text");
							bindProp(__nsh_hv28, "style", () => t.meta);
							const __nsh_hv29 = text("未选择容器");
							append(__nsh_hv28, __nsh_hv29);
							return __nsh_hv28;
						})() : [component(Badge, {
							get text() {
								return `采样 ${sampledAt()}`;
							},
							tone: "info"
						}), (() => {
							const __nsh_hv30 = element("text");
							bindProp(__nsh_hv30, "style", () => t.meta);
							insert(__nsh_hv30, () => cores() === null ? "" : `${cores()} 个核`);
							return __nsh_hv30;
						})()]];
					}
				}), component(Row, {
					gap: 6,
					get children() {
						return [
							() => busy() ? (() => {
								const __nsh_hv31 = element("text");
								bindProp(__nsh_hv31, "style", () => t.meta);
								const __nsh_hv32 = text("正在采样…");
								append(__nsh_hv31, __nsh_hv32);
								return __nsh_hv31;
							})() : null,
							() => selectedId() === null ? null : autoRefreshToggle(),
							component(Button, {
								label: "刷新",
								small: true,
								onPress: () => refresh()
							})
						];
					}
				})];
			}
		});
	}
	loadContainers();
	return (() => {
		const __nsh_hv33 = element("view");
		bindProp(__nsh_hv33, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		const __nsh_hv34 = element("view");
		bindProp(__nsh_hv34, "style", () => hairline());
		append(__nsh_hv33, __nsh_hv34);
		insert(__nsh_hv33, () => toolbar(), __nsh_hv34);
		insert(__nsh_hv33, [() => containerBar(), () => content()]);
		return __nsh_hv33;
	})();
}

//#endregion
//#region pages/container-terminal/App.tsx
/** 宿主注册的原生终端：`command` + `args` 起一个本地进程。 */
const Terminal = nativeComponent("navop.terminal", { props: [
	"command",
	"args",
	"env",
	"title"
] });
const STATE_LABEL = {
	running: "运行中",
	exited: "已停止",
	paused: "已暂停",
	created: "已创建",
	restarting: "重启中"
};
function stateLabel(state) {
	const label = STATE_LABEL[state];
	return label === void 0 ? state.length === 0 ? "未知" : state : label;
}
function stateTone(state) {
	if (state === "running") return "ok";
	if (state === "paused" || state === "restarting") return "warn";
	if (state === "dead") return "danger";
	return "neutral";
}
function toContainers(payload) {
	const source = payload;
	return (Array.isArray(source?.containers) ? source.containers : []).filter((item) => typeof item?.id === "string" && item.id.length > 0);
}
function App$1() {
	const loading = signal(true);
	const error = signal("");
	const containers = signal([]);
	const filter = signal("");
	const selected = signal(null);
	/** 每次点「重新连接」+1：进 env，宿主看到参数变化就重开一个 pty。 */
	const attempt = signal(0);
	/** 首屏之后就失败时不打断已有内容，只在顶部提示。 */
	const notice = signal("");
	async function load() {
		loading.set(true);
		error.set("");
		try {
			const payload = await invoke$1("docker/container/list", {}, { timeout: SLOW_TIMEOUT_MS });
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
	load();
	const visible = () => {
		const keyword = filter().trim().toLowerCase();
		const all = containers();
		if (keyword.length === 0) return all;
		return all.filter((item) => `${item.name} ${item.image} ${item.state}`.toLowerCase().includes(keyword));
	};
	const row = (item) => (() => {
		const __nsh_hv0 = element("view");
		prop(__nsh_hv0, "onPress", () => {
			selected.set(item);
			notice.set("");
		});
		bindProp(__nsh_hv0, "style", () => ({
			flexDirection: "column",
			gap: 3,
			paddingVertical: 7,
			paddingHorizontal: 10,
			borderRadius: r.control,
			backgroundColor: selected()?.id === item.id ? c.hover() : c.bg(),
			borderWidth: 1,
			borderColor: selected()?.id === item.id ? c.line() : "transparent"
		}));
		const __nsh_hv1 = element("view");
		prop(__nsh_hv1, "style", {
			flexDirection: "row",
			alignItems: "center",
			gap: 6
		});
		const __nsh_hv2 = element("text");
		prop(__nsh_hv2, "numberOfLines", 1);
		bindProp(__nsh_hv2, "style", () => ({
			...t.body,
			color: c.text(),
			flexGrow: 1
		}));
		insert(__nsh_hv2, () => item.name);
		append(__nsh_hv1, __nsh_hv2);
		insert(__nsh_hv1, component(Badge, {
			get text() {
				return stateLabel(item.state);
			},
			get tone() {
				return stateTone(item.state);
			}
		}));
		const __nsh_hv3 = element("text");
		prop(__nsh_hv3, "numberOfLines", 1);
		bindProp(__nsh_hv3, "style", () => ({
			...t.meta,
			color: c.muted()
		}));
		insert(__nsh_hv3, () => item.image);
		append(__nsh_hv0, __nsh_hv1);
		append(__nsh_hv0, __nsh_hv3);
		return __nsh_hv0;
	})();
	const picker = () => (() => {
		const __nsh_hv4 = element("view");
		prop(__nsh_hv4, "style", {
			flexDirection: "column",
			gap: 8,
			height: "100%",
			minWidth: 0
		});
		const __nsh_hv5 = element("view");
		prop(__nsh_hv5, "style", {
			flexDirection: "row",
			alignItems: "center",
			gap: 6
		});
		const __nsh_hv6 = element("view");
		prop(__nsh_hv6, "onPress", () => void load());
		bindProp(__nsh_hv6, "style", () => ({
			paddingHorizontal: 8,
			paddingVertical: 4,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: c.line()
		}));
		const __nsh_hv7 = element("text");
		bindProp(__nsh_hv7, "style", () => ({
			...t.label,
			color: c.text()
		}));
		const __nsh_hv8 = text("刷新列表");
		append(__nsh_hv7, __nsh_hv8);
		append(__nsh_hv6, __nsh_hv7);
		const __nsh_hv9 = element("text");
		bindProp(__nsh_hv9, "style", () => ({
			...t.meta,
			color: c.muted()
		}));
		const __nsh_hv10 = text("共 ");
		const __nsh_hv11 = text(" 个容器");
		append(__nsh_hv9, __nsh_hv10);
		append(__nsh_hv9, __nsh_hv11);
		insert(__nsh_hv9, () => containers().length, __nsh_hv11);
		append(__nsh_hv5, __nsh_hv6);
		append(__nsh_hv5, __nsh_hv9);
		append(__nsh_hv4, __nsh_hv5);
		insert(__nsh_hv4, [component(SearchField, {
			get value() {
				return filter();
			},
			onChange: (next) => filter.set(next),
			placeholder: "过滤容器",
			width: 220
		}), component(List, {
			get items() {
				return visible();
			},
			keyOf: (item) => item.id,
			get selected() {
				return selected()?.id ?? null;
			},
			onSelect: (id) => {
				selected.set(containers().find((item) => item.id === id) ?? null);
				notice.set("");
			},
			render: (item) => row(item),
			get empty() {
				return component(Empty, {
					title: "没有匹配的容器",
					hint: "换个关键字，或刷新列表"
				});
			}
		})], __nsh_hv5);
		return __nsh_hv4;
	})();
	const terminal = (item) => (() => {
		const __nsh_hv12 = element("view");
		prop(__nsh_hv12, "style", {
			flexDirection: "column",
			gap: 8,
			height: "100%",
			minWidth: 0
		});
		const __nsh_hv13 = element("view");
		prop(__nsh_hv13, "style", {
			flexDirection: "row",
			alignItems: "center",
			gap: 8
		});
		const __nsh_hv14 = element("text");
		prop(__nsh_hv14, "numberOfLines", 1);
		bindProp(__nsh_hv14, "style", () => ({
			...t.h2,
			color: c.text(),
			flexGrow: 1
		}));
		insert(__nsh_hv14, () => item.name);
		const __nsh_hv15 = element("view");
		prop(__nsh_hv15, "onPress", () => attempt.set(attempt() + 1));
		bindProp(__nsh_hv15, "style", () => ({
			paddingHorizontal: 8,
			paddingVertical: 4,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: c.line()
		}));
		const __nsh_hv16 = element("text");
		bindProp(__nsh_hv16, "style", () => ({
			...t.label,
			color: c.text()
		}));
		const __nsh_hv17 = text("重新连接");
		append(__nsh_hv16, __nsh_hv17);
		append(__nsh_hv15, __nsh_hv16);
		append(__nsh_hv13, __nsh_hv14);
		append(__nsh_hv13, __nsh_hv15);
		insert(__nsh_hv13, component(Badge, {
			get text() {
				return stateLabel(item.state);
			},
			get tone() {
				return stateTone(item.state);
			}
		}), __nsh_hv15);
		const __nsh_hv18 = element("text");
		bindProp(__nsh_hv18, "style", () => ({
			...t.meta,
			color: c.muted()
		}));
		insert(__nsh_hv18, () => item.state === "running" ? `在本机开一个 docker exec -it ${item.name} /bin/sh` : "容器没在运行：先启动它，再回到这里连接。");
		const __nsh_hv19 = element("view");
		bindProp(__nsh_hv19, "style", () => ({
			flex: 1,
			minHeight: 240,
			borderRadius: r.card,
			borderWidth: 1,
			borderColor: c.line(),
			backgroundColor: c.panel(),
			overflow: "hidden"
		}));
		insert(__nsh_hv19, () => item.state === "running" ? component(Terminal, {
			command: "docker",
			get args() {
				return [
					"exec",
					"-it",
					item.name,
					"/bin/sh"
				];
			},
			get env() {
				return {
					NAVOP_SESSION: String(attempt()),
					NAVOP_TERM: "xterm-256color"
				};
			},
			get title() {
				return item.name;
			}
		}) : component(Empty, {
			title: "容器未运行",
			hint: "启动容器后点上面的「重新连接」"
		}));
		append(__nsh_hv12, __nsh_hv13);
		append(__nsh_hv12, __nsh_hv18);
		append(__nsh_hv12, __nsh_hv19);
		return __nsh_hv12;
	})();
	const body = () => {
		if (loading() && containers().length === 0) return component(Loading, { label: "正在读取容器列表…" });
		if (error().length > 0 && containers().length === 0) return component(LoadError, {
			get message() {
				return error();
			},
			onRetry: () => void load()
		});
		const current = selected();
		return (() => {
			const __nsh_hv20 = element("view");
			prop(__nsh_hv20, "style", {
				flexDirection: "column",
				gap: 8,
				flex: 1,
				minHeight: 0
			});
			insert(__nsh_hv20, [() => notice().length > 0 ? (() => {
				const __nsh_hv21 = element("view");
				bindProp(__nsh_hv21, "style", () => ({
					paddingHorizontal: 10,
					paddingVertical: 6,
					borderRadius: r.control,
					backgroundColor: c.panel(),
					borderWidth: 1,
					borderColor: c.danger()
				}));
				const __nsh_hv22 = element("text");
				bindProp(__nsh_hv22, "style", () => ({
					...t.meta,
					color: c.danger()
				}));
				insert(__nsh_hv22, () => notice());
				append(__nsh_hv21, __nsh_hv22);
				return __nsh_hv21;
			})() : null, component(SplitPane, {
				width: 260,
				get left() {
					return picker();
				},
				get right() {
					return current !== null ? terminal(current) : component(Empty, {
						title: "选一个容器",
						hint: "左边点一个容器，右边就会开一个 shell"
					});
				}
			})]);
			return __nsh_hv20;
		})();
	};
	return (() => {
		const __nsh_hv23 = element("view");
		bindProp(__nsh_hv23, "style", () => ({
			flex: 1,
			minHeight: 0,
			padding: 12,
			backgroundColor: c.bg()
		}));
		insert(__nsh_hv23, () => body());
		return __nsh_hv23;
	})();
}

//#endregion
//#region App.tsx
/** 默认路由：也是连接清单里 `route` 的值。 */
const DEFAULT_ROUTE = "containers";
/** 路由表。顺序就是侧栏顺序：先资源（容器/镜像/卷/网络），再引擎与容器单点视图。 */
const ROUTES = [
	{
		id: "containers",
		title: "容器",
		glyph: "C",
		component: Containers
	},
	{
		id: "images",
		title: "Docker Images",
		glyph: "I",
		component: Images
	},
	{
		id: "volumes",
		title: "Docker Volumes",
		glyph: "V",
		component: Volumes
	},
	{
		id: "networks",
		title: "Docker Networks",
		glyph: "N",
		component: Networks
	},
	{
		id: "overview",
		title: "Docker Engine Overview",
		glyph: "O",
		component: Overview
	},
	{
		id: "log-viewer",
		title: "Docker Log Viewer",
		glyph: "L",
		component: LogViewer
	},
	{
		id: "processes",
		title: "Container Processes",
		glyph: "P",
		component: Processes
	},
	{
		id: "changes",
		title: "Container Filesystem Changes",
		glyph: "D",
		component: Changes
	},
	{
		id: "container-inspect",
		title: "Docker Container Inspect",
		glyph: "i",
		component: ContainerInspect
	},
	{
		id: "container-mounts",
		title: "Docker Container Mounts",
		glyph: "M",
		component: ContainerMounts
	},
	{
		id: "container-stats",
		title: "Docker Container Stats",
		glyph: "S",
		component: ContainerStats
	},
	{
		id: "container-terminal",
		title: "Container Terminal",
		glyph: ">",
		component: App$1
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
	const title = params.extension?.title ?? "Docker";
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
				title: "请先打开一个 Docker 连接",
				hint: "在工具箱或连接列表里打开 Docker，连接成功后会显示容器与资源视图。"
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