import { append, bindProp, component, cond, element, insert, prop, text } from "nsh:rt";
import { computed, host, mount, signal, token } from "nsh";

//#region ../../lib/format.ts
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
//#region ../../lib/host.ts
let cached = null;
/** 当前页面所属的连接。没有连接（例如工具箱里单独打开的页面）时抛错。 */
async function connection() {
	if (cached) return cached;
	const found = (await host.call("navop.context.current", {}))?.connection;
	if (!found?.resourceHandle) throw new Error("这个页面需要一个扩展连接（当前上下文里没有资源句柄）");
	cached = found;
	return found;
}
/** 调 provider 的方法。等价于旧方言的 `dispatch(operationId, input)`，但方法名是真的。 */
async function call(method, params = {}) {
	const conn = await connection();
	return await host.call("navop.resource.invoke", {
		handle: conn.resourceHandle,
		method,
		params
	});
}

//#endregion
//#region ../../lib/theme.ts
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
/** 卡片容器样式（描边 + 圆角 + 内边距）。 */
const panel = (padding = 14) => ({
	backgroundColor: c.panel(),
	borderWidth: 1,
	borderColor: c.line(),
	borderRadius: r.card,
	padding
});

//#endregion
//#region ../../lib/ui.tsx
/** 取值：accessor 就调用，普通值原样返回。只在 JSX 表达式里调用。 */
const pick$1 = (value) => typeof value === "function" ? value() : value;
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
	return cond(() => pick$1(props.scroll ?? false), () => (() => {
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
			borderColor: toneColor(pick$1(props.tone ?? "neutral")),
			display: "flex",
			flexDirection: "row",
			alignItems: "center"
		}));
		const __nsh_hv10 = element("text");
		bindProp(__nsh_hv10, "style", () => ({
			fontSize: 11,
			fontWeight: "600",
			color: toneColor(pick$1(props.tone ?? "neutral"))
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
		bindProp(__nsh_hv11, "onPress", () => pick$1(props.disabled ?? false) ? void 0 : props.onPress);
		prop(__nsh_hv11, "role", "button");
		bindProp(__nsh_hv11, "accessibilityLabel", () => props.label);
		bindProp(__nsh_hv11, "style", () => ({
			height: props.small ? 24 : 28,
			paddingHorizontal: props.small ? 9 : 12,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: buttonBorder(pick$1(props.tone ?? "ghost")),
			backgroundColor: buttonFill(pick$1(props.tone ?? "ghost")),
			opacity: pick$1(props.disabled ?? false) ? .5 : 1,
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center"
		}));
		const __nsh_hv12 = element("text");
		bindProp(__nsh_hv12, "style", () => ({
			fontSize: props.small ? 12 : 13,
			fontWeight: "500",
			color: buttonLabel(pick$1(props.tone ?? "ghost"), pick$1(props.disabled ?? false))
		}));
		insert(__nsh_hv12, () => props.label);
		append(__nsh_hv11, __nsh_hv12);
		return __nsh_hv11;
	})();
}
/** 可滚动的行列表：单选、悬停底色、按 key 高亮。 */
function List(props) {
	return cond(() => pick$1(props.items).length === 0 && props.empty !== void 0, () => () => props.empty, () => (() => {
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
		insert(__nsh_hv18, () => pick$1(props.items).map((item, index) => {
			const key = props.keyOf(item);
			const active = pick$1(props.selected ?? null) === key;
			return (() => {
				const __nsh_hv19 = element("view");
				bindProp(__nsh_hv19, "onPress", () => props.onSelect === void 0 ? void 0 : () => props.onSelect?.(key));
				bindProp(__nsh_hv19, "style", () => ({
					backgroundColor: active ? c.hover() : "transparent",
					borderBottomWidth: index === pick$1(props.items).length - 1 ? 0 : 1,
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
			color: props.tone === void 0 ? c.text() : toneColor(pick$1(props.tone)),
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
			width: meterWidth(pick$1(props.ratio)),
			height: 8,
			borderRadius: r.pill,
			backgroundColor: props.tone === void 0 ? c.accent() : toneColor(pick$1(props.tone))
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
			flexDirection: pick$1(props.columns ?? 1) === 2 ? "row" : "column",
			flexWrap: "wrap",
			gap: pick$1(props.columns ?? 1) === 2 ? 12 : 0
		}));
		insert(__nsh_hv39, () => pick$1(props.rows).map(([key, value]) => component(Row, {
			get style() {
				return {
					justifyContent: "space-between",
					paddingVertical: 5,
					width: pick$1(props.columns ?? 1) === 2 ? "48%" : "100%",
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
			color: props.tone === void 0 ? c.muted() : toneColor(pick$1(props.tone))
		}));
		insert(__nsh_hv48, () => props.message);
		return __nsh_hv48;
	})();
}

//#endregion
//#region App.tsx
/** 一次最多显示多少条环境变量 / 标签，避免一屏几千行。 */
const ENV_LIMIT = 40;
const LABEL_LIMIT = 20;
const STATE_LABEL = {
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
function stateLabel(state) {
	const label = STATE_LABEL[state];
	return label === void 0 ? state.length === 0 ? "未知" : state : label;
}
function stateTone(state) {
	if (state === "running") return "ok";
	if (state === "paused" || state === "restarting" || state === "removing") return "warn";
	if (state === "dead") return "danger";
	return "neutral";
}
function stateColor(state) {
	const tone = stateTone(state);
	if (tone === "ok") return c.chart(1);
	if (tone === "warn") return c.chart(4);
	if (tone === "danger") return c.danger();
	return c.muted();
}
function isObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function pick(source, key) {
	return isObject(source) ? source[key] : void 0;
}
/** 把任意值读成一句可显示文本；缺失时给 fallback。 */
function text$1(value, fallback = "-") {
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
		cpuPercent: numberOr(pick(value, "cpu_percent"), 0),
		memoryUsage: numberOr(pick(value, "memory_usage_bytes"), 0),
		memoryLimit: numberOr(pick(value, "memory_limit_bytes"), 0),
		cpus: numberOr(pick(value, "online_cpus"), 0)
	};
}
function nowClock() {
	const now = /* @__PURE__ */ new Date();
	const two = (value) => String(value).padStart(2, "0");
	return `${two(now.getHours())}:${two(now.getMinutes())}`;
}
function restartText(policy) {
	const name = text$1(pick(policy, "Name"), "");
	if (name.length === 0 || name === "no") return "不自动重启";
	const retries = numberOr(pick(policy, "MaximumRetryCount"), 0);
	return retries > 0 ? `${name}（最多 ${retries} 次）` : name;
}
/** 状态 + 健康检查 + 暂停位（inspect 里这三处是分开的）。 */
function stateText(state) {
	const status = text$1(pick(state, "Status"), "");
	const health = text$1(pick(state, "Health"), "");
	const healthStatus = text$1(pick(pick(state, "Health"), "Status"), "");
	const parts = [status.length === 0 ? "未知" : stateLabel(status)];
	if (healthStatus.length > 0) parts.push(`健康检查 ${healthStatus}`);
	else if (health.length > 0) parts.push(`健康检查 ${health}`);
	if (pick(state, "Paused") === true) parts.push("已暂停");
	return parts.join(" · ");
}
/** `NetworkSettings.Ports` → `0.0.0.0:8080 → 80/tcp` 这样的行。 */
function portLines(info) {
	const ports = pick(pick(info, "NetworkSettings"), "Ports");
	if (!isObject(ports)) return [];
	const lines = [];
	for (const [containerPort, bindings] of Object.entries(ports)) {
		if (!Array.isArray(bindings) || bindings.length === 0) {
			lines.push(`${containerPort}（仅暴露，未发布）`);
			continue;
		}
		for (const binding of bindings) {
			const hostIp = text$1(pick(binding, "HostIp"), "0.0.0.0");
			const hostPort = text$1(pick(binding, "HostPort"), "");
			lines.push(hostPort.length === 0 ? `${containerPort}（仅暴露，未发布）` : `${hostIp}:${hostPort} → ${containerPort}`);
		}
	}
	return lines;
}
/** 各网络的名字 → IP / 网关 / MAC。 */
function networkRows(info) {
	const networks = pick(pick(info, "NetworkSettings"), "Networks");
	if (!isObject(networks)) return [];
	return Object.entries(networks).map(([name, value]) => {
		const parts = [];
		const ip = text$1(pick(value, "IPAddress"), "");
		const gateway = text$1(pick(value, "Gateway"), "");
		const mac = text$1(pick(value, "MacAddress"), "");
		if (ip.length > 0) parts.push(ip);
		if (gateway.length > 0) parts.push(`网关 ${gateway}`);
		if (mac.length > 0) parts.push(mac);
		return [name, parts.length === 0 ? "未分配地址" : parts.join(" · ")];
	});
}
/** 挂载：源 → 目标（读写位）。 */
function mountRows(info) {
	const mounts = pick(info, "Mounts");
	if (!Array.isArray(mounts)) return [];
	return mounts.map((mount) => {
		const source = text$1(pick(mount, "Source"), "-");
		const destination = text$1(pick(mount, "Destination"), "-");
		const mode = pick(mount, "RW") === false ? "只读" : "读写";
		const type = text$1(pick(mount, "Type"), "");
		return [source, `${destination}（${mode}${type.length === 0 ? "" : ` · ${type}`}）`];
	});
}
/** `Config.Env` 是 `KEY=VALUE` 字符串数组。 */
function envRows(info) {
	const env = pick(pick(info, "Config"), "Env");
	if (!Array.isArray(env)) return [];
	return env.map((entry) => {
		const line = typeof entry === "string" ? entry : String(entry);
		const at = line.indexOf("=");
		return at < 0 ? [line, ""] : [line.slice(0, at), line.slice(at + 1)];
	});
}
function labelRows(info) {
	const labels = pick(pick(info, "Config"), "Labels");
	if (!isObject(labels)) return [];
	return Object.entries(labels).map(([key, value]) => [key, text$1(value, "")]);
}
function overviewRows(info) {
	const state = pick(info, "State");
	const config = pick(info, "Config");
	const hostConfig = pick(info, "HostConfig");
	return [
		["容器 ID", text$1(pick(info, "Id")).slice(0, 12)],
		["名称", text$1(pick(info, "Name")).replace(/^\//, "")],
		["镜像", text$1(pick(config, "Image"), text$1(pick(info, "Image")))],
		["状态", stateText(state)],
		["启动时间", shortTime(text$1(pick(state, "StartedAt"), ""))],
		["创建时间", shortTime(text$1(pick(info, "Created"), ""))],
		["退出码", text$1(pick(state, "ExitCode"), "0")],
		["重启次数", text$1(pick(state, "RestartCount"), "0")],
		["重启策略", restartText(pick(hostConfig, "RestartPolicy"))],
		["启动命令", joinCommand(pick(config, "Cmd"))]
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
function chip(label, active, testLabel, onPress) {
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
			const result = await call("docker/container/list", {});
			if (mine !== listSeq) return;
			const list = arr(result, "containers").map(toContainer);
			rows.set(list);
			listError.set(null);
			updatedAt.set(nowClock());
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
			const raw = await call("docker/container/inspect", { id });
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
			const raw = await call("docker/container/stats", { id });
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
			await call(`docker/container/${action}`, { id: row.id });
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
			await call("docker/container/remove", { id: row.id });
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
					() => chip("全部", () => stateFilter() === "all", "过滤:全部", () => stateFilter.set("all")),
					() => chip("运行中", () => stateFilter() === "running", "过滤:运行中", () => stateFilter.set("running")),
					() => chip("已停止", () => stateFilter() === "stopped", "过滤:已停止", () => stateFilter.set("stopped"))
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
						return `${row.status.length > 0 ? row.status : stateLabel(row.state)} · ${row.image}`;
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
									return stateLabel(row.state);
								},
								get tone() {
									return stateTone(row.state);
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
		const ports = portLines(info);
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
										return stateLabel(row.state);
									},
									get tone() {
										return stateTone(row.state);
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
mount(Containers);

//#endregion
export { Containers as default };