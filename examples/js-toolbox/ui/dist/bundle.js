import { append, bindProp, component, cond, element, insert, prop, text } from "nsh:rt";
import { Clipboard, host, mount, signal, token } from "nsh";
import { createHash, randomUUID } from "crypto";
import { Buffer } from "buffer";
import { readFile, writeFile } from "fs/promises";

//#region ../../../packages/extension-kit/src/theme.ts
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
//#region ../../../packages/extension-kit/src/format.ts
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

//#endregion
//#region ../../../packages/extension-kit/src/ui.tsx
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
/** 状态胶囊。 */
function Badge(props) {
	return (() => {
		const __nsh_hv9 = element("view");
		bindProp(__nsh_hv9, "style", () => ({
			paddingHorizontal: 8,
			paddingVertical: 2,
			borderRadius: r.pill,
			borderWidth: 1,
			borderColor: toneColor(pick(props.tone ?? "neutral")),
			display: "flex",
			flexDirection: "row",
			alignItems: "center"
		}));
		const __nsh_hv10 = element("text");
		bindProp(__nsh_hv10, "style", () => ({
			fontSize: 11,
			fontWeight: "600",
			color: toneColor(pick(props.tone ?? "neutral"))
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
		bindProp(__nsh_hv11, "onPress", () => pick(props.disabled ?? false) ? void 0 : props.onPress);
		prop(__nsh_hv11, "role", "button");
		bindProp(__nsh_hv11, "accessibilityLabel", () => props.label);
		bindProp(__nsh_hv11, "style", () => ({
			height: props.small ? 24 : 28,
			paddingHorizontal: props.small ? 9 : 12,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: buttonBorder(pick(props.tone ?? "ghost")),
			backgroundColor: buttonFill(pick(props.tone ?? "ghost")),
			opacity: pick(props.disabled ?? false) ? .5 : 1,
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center"
		}));
		const __nsh_hv12 = element("text");
		bindProp(__nsh_hv12, "style", () => ({
			fontSize: props.small ? 12 : 13,
			fontWeight: "500",
			color: buttonLabel(pick(props.tone ?? "ghost"), pick(props.disabled ?? false))
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
/** 键值对表：inspect 类页面的主体。 */
function KeyValue(props) {
	return (() => {
		const __nsh_hv39 = element("view");
		bindProp(__nsh_hv39, "style", () => ({
			display: "flex",
			flexDirection: pick(props.columns ?? 1) === 2 ? "row" : "column",
			flexWrap: "wrap",
			gap: pick(props.columns ?? 1) === 2 ? 12 : 0
		}));
		insert(__nsh_hv39, () => pick(props.rows).map(([key, value]) => component(Row, {
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
			color: props.tone === void 0 ? c.muted() : toneColor(pick(props.tone))
		}));
		insert(__nsh_hv48, () => props.message);
		return __nsh_hv48;
	})();
}

//#endregion
//#region pages/crypto/App.tsx
const ALGORITHMS = [
	"md5",
	"sha1",
	"sha256",
	"sha512"
];
/** Base64 只认标准字母表与可选的 `=` 补位，空格换行先去掉。 */
function normalizeBase64(source) {
	const compact = source.replace(/\s+/g, "");
	if (compact.length === 0) return "";
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
	if (compact.length % 4 !== 0) return null;
	return compact;
}
function utf8Bytes(text) {
	return new TextEncoder().encode(text);
}
function decodeBase64(source) {
	const compact = normalizeBase64(source);
	if (compact === null) return null;
	const decoded = Buffer.from(compact, "base64").toString("utf8");
	if (Buffer.from(decoded, "utf8").toString("base64") !== compact) return null;
	return decoded;
}
/** 多行输入框：Input 的 multiline，外层给一个固定高度的边框。 */
function TextArea(props) {
	return (() => {
		const __nsh_hv0 = element("view");
		bindProp(__nsh_hv0, "style", () => ({
			height: props.height,
			paddingHorizontal: 9,
			paddingVertical: 7,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: c.line(),
			backgroundColor: c.bg()
		}));
		const __nsh_hv1 = element("input");
		bindProp(__nsh_hv1, "value", () => props.value);
		bindProp(__nsh_hv1, "placeholder", () => props.placeholder ?? "");
		prop(__nsh_hv1, "multiline", true);
		prop(__nsh_hv1, "onChange", (text) => props.onChange(text));
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
function Crypto() {
	const input = signal("");
	const algorithm = signal("sha256");
	const result = signal(null);
	const error = signal(null);
	const notice = signal(null);
	function digest() {
		const source = utf8Bytes(input());
		const bytes = createHash(algorithm()).update(source).digest("hex");
		result.set({
			text: bytes,
			label: `${algorithm().toUpperCase()} 摘要`
		});
		error.set(null);
		notice.set(null);
	}
	function base64Encode() {
		result.set({
			text: Buffer.from(input(), "utf8").toString("base64"),
			label: "Base64 编码结果"
		});
		error.set(null);
		notice.set(null);
	}
	function base64Decode() {
		const decoded = decodeBase64(input());
		if (decoded === null) {
			result.set(null);
			error.set("不是合法的 Base64 文本：只接受标准字母表（A-Z a-z 0-9 + /）与结尾的 = 补位。");
			notice.set(null);
			return;
		}
		result.set({
			text: decoded,
			label: "Base64 解码结果"
		});
		error.set(null);
		notice.set(null);
	}
	function uuid() {
		result.set({
			text: randomUUID(),
			label: "随机 UUID（v4）"
		});
		error.set(null);
		notice.set(null);
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
	function clear() {
		input.set("");
		result.set(null);
		error.set(null);
		notice.set(null);
	}
	function resultPane() {
		const current = result();
		if (current === null) return component(Empty, {
			title: "还没有结果",
			hint: "在上方输入文本，再点一个操作（摘要 / Base64 / UUID）。"
		});
		return (() => {
			const __nsh_hv2 = element("view");
			prop(__nsh_hv2, "style", {
				display: "flex",
				flexDirection: "column",
				gap: 8
			});
			const __nsh_hv4 = element("view");
			bindProp(__nsh_hv4, "style", () => ({
				padding: 10,
				borderRadius: r.control,
				borderWidth: 1,
				borderColor: c.line(),
				backgroundColor: c.panel(),
				maxHeight: 240
			}));
			const __nsh_hv5 = element("text");
			prop(__nsh_hv5, "selectable", true);
			bindProp(__nsh_hv5, "style", () => ({
				...t.mono,
				lineHeight: 18
			}));
			insert(__nsh_hv5, () => current.text);
			append(__nsh_hv4, __nsh_hv5);
			append(__nsh_hv2, __nsh_hv4);
			insert(__nsh_hv2, component(Row, {
				gap: 8,
				align: "center",
				get children() {
					return [component(Badge, {
						get text() {
							return current.label;
						},
						tone: "info"
					}), (() => {
						const __nsh_hv3 = element("text");
						bindProp(__nsh_hv3, "style", () => t.meta);
						insert(__nsh_hv3, () => `${current.text.length} 字符`);
						return __nsh_hv3;
					})()];
				}
			}), __nsh_hv4);
			return __nsh_hv2;
		})();
	}
	return (() => {
		const __nsh_hv6 = element("view");
		bindProp(__nsh_hv6, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		insert(__nsh_hv6, [
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
						align: "center",
						get children() {
							return [
								(() => {
									const __nsh_hv7 = element("text");
									bindProp(__nsh_hv7, "style", () => t.h1);
									const __nsh_hv8 = text("Crypto 工具箱");
									append(__nsh_hv7, __nsh_hv8);
									return __nsh_hv7;
								})(),
								component(Badge, {
									text: "本地计算",
									tone: "ok"
								}),
								(() => {
									const __nsh_hv9 = element("text");
									bindProp(__nsh_hv9, "style", () => t.meta);
									const __nsh_hv10 = text("不上传任何内容");
									append(__nsh_hv9, __nsh_hv10);
									return __nsh_hv9;
								})()
							];
						}
					}), component(Row, {
						gap: 6,
						get children() {
							return [component(Button, {
								label: "清空",
								small: true,
								onPress: clear
							}), component(Button, {
								label: "复制结果",
								small: true,
								tone: "primary",
								onPress: () => void copy()
							})];
						}
					})];
				}
			}),
			() => error() === null ? null : (() => {
				const __nsh_hv11 = element("view");
				prop(__nsh_hv11, "style", {
					paddingHorizontal: 14,
					paddingBottom: 8
				});
				insert(__nsh_hv11, component(Notice, {
					get message() {
						return error() ?? "";
					},
					tone: "danger"
				}));
				return __nsh_hv11;
			})(),
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
			component(Stack, {
				scroll: true,
				padding: 14,
				gap: 12,
				get children() {
					return [
						component(Card, {
							title: "输入",
							hint: "要处理的原文；解码时贴 Base64 文本",
							get children() {
								return component(TextArea, {
									get value() {
										return input();
									},
									onChange: (text) => input.set(text),
									placeholder: "例如 hello，或粘贴一段 Base64",
									height: 96
								});
							}
						}),
						component(Card, {
							title: "操作",
							hint: "摘要算法可切换",
							get children() {
								return (() => {
									const __nsh_hv13 = element("view");
									prop(__nsh_hv13, "style", {
										display: "flex",
										flexDirection: "column",
										gap: 10
									});
									insert(__nsh_hv13, [component(Row, {
										gap: 6,
										wrap: true,
										align: "center",
										get children() {
											return [(() => {
												const __nsh_hv14 = element("text");
												bindProp(__nsh_hv14, "style", () => t.label);
												const __nsh_hv15 = text("摘要算法");
												append(__nsh_hv14, __nsh_hv15);
												return __nsh_hv14;
											})(), () => ALGORITHMS.map((item) => component(Button, {
												label: item,
												small: true,
												get tone() {
													return algorithm() === item ? "primary" : "ghost";
												},
												onPress: () => algorithm.set(item)
											}))];
										}
									}), component(Row, {
										gap: 8,
										wrap: true,
										align: "center",
										get children() {
											return [
												component(Button, {
													label: "计算摘要",
													small: true,
													tone: "primary",
													onPress: digest
												}),
												component(Button, {
													label: "Base64 编码",
													small: true,
													onPress: base64Encode
												}),
												component(Button, {
													label: "Base64 解码",
													small: true,
													onPress: base64Decode
												}),
												component(Button, {
													label: "生成 UUID",
													small: true,
													onPress: uuid
												})
											];
										}
									})]);
									return __nsh_hv13;
								})();
							}
						}),
						component(Card, {
							title: "结果",
							hint: "可选中复制，或点右上角「复制结果」",
							get children() {
								return (() => {
									const __nsh_hv16 = element("view");
									prop(__nsh_hv16, "style", {
										display: "flex",
										flexDirection: "column"
									});
									insert(__nsh_hv16, () => resultPane());
									return __nsh_hv16;
								})();
							}
						}),
						component(Card, {
							title: "说明",
							hint: "全部在页面内计算",
							get children() {
								return component(KeyValue, {
									columns: 1,
									rows: [
										["MD5", "128 位摘要，仅用于校验，不用于安全场景"],
										["SHA-1", "160 位摘要，兼容旧系统"],
										["SHA-256", "256 位摘要，常用默认值"],
										["SHA-512", "512 位摘要，输出最长"],
										["Base64", "UTF-8 文本与 Base64 互转；非法输入会直接报错"],
										["UUID", "生成随机 v4 UUID"]
									]
								});
							}
						})
					];
				}
			})
		]);
		return __nsh_hv6;
	})();
}

//#endregion
//#region pages/hosts/App.tsx
const HOSTS_PATH = "/etc/hosts";
/** IPv4 / IPv6 的粗判：只要够区分注释即可，不做完整校验。 */
function looksLikeIp(token) {
	if (token.length === 0) return false;
	if (!/^[0-9a-fA-F:.]+$/.test(token)) return false;
	return token.includes(":") || token.split(".").length === 4;
}
function parseLine(raw) {
	const trimmed = raw.trim();
	if (trimmed.length === 0) return {
		kind: "blank",
		raw
	};
	if (trimmed.startsWith("#")) {
		const parts = trimmed.replace(/^#+\s*/, "").split(/\s+/).filter((part) => part.length > 0);
		if (parts.length >= 2 && looksLikeIp(parts[0])) return {
			kind: "entry",
			raw,
			enabled: false,
			ip: parts[0],
			names: parts.slice(1)
		};
		return {
			kind: "comment",
			raw
		};
	}
	const parts = trimmed.split(/\s+/).filter((part) => part.length > 0);
	return {
		kind: "entry",
		raw,
		enabled: true,
		ip: parts[0],
		names: parts.slice(1)
	};
}
/** 条目 → 写回文件的一行；停用靠行首 `# `。 */
function composeLine(line) {
	if (line.kind !== "entry") return line.raw;
	const body = [line.ip, ...line.names].join(" ");
	return line.enabled ? body : `# ${body}`;
}
/** 单行输入框（SearchField 带放大镜，这里不合适）。 */
function Field(props) {
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
/** 上报一条宿主日志：`navop.log` 是无应答的 post，不会影响页面主流程。 */
function log(level, message) {
	host.post("navop.log", {
		level,
		message
	});
}
function Hosts() {
	const lines = signal([]);
	const loading = signal(true);
	const error = signal(null);
	const notice = signal(null);
	const saving = signal(false);
	const pendingSave = signal(false);
	const loadedAt = signal("");
	const filter = signal("");
	const dirty = signal(false);
	const addOpen = signal(false);
	const addIp = signal("");
	const addNames = signal("");
	const showComments = signal(false);
	const trailingNewline = signal(true);
	const entries = () => lines().filter((line) => line.kind === "entry");
	const comments = () => lines().filter((line) => line.kind !== "entry");
	const visible = () => {
		const needle = filter().trim().toLowerCase();
		const all = entries();
		if (needle.length === 0) return all;
		return all.filter((line) => [line.ip, ...line.names].join(" ").toLowerCase().includes(needle));
	};
	async function load() {
		loading.set(true);
		error.set(null);
		try {
			const text = String(await readFile(HOSTS_PATH, "utf8"));
			const endsWithNewline = text.endsWith("\n");
			trailingNewline.set(endsWithNewline);
			const parsed = text.split("\n").map(parseLine);
			if (endsWithNewline && parsed.length > 0) parsed.pop();
			lines.set(parsed);
			loadedAt.set(shortTime((/* @__PURE__ */ new Date()).toISOString()));
			dirty.set(false);
			notice.set(null);
		} catch (failure) {
			error.set(`读取 ${HOSTS_PATH} 失败：${errorMessage(failure)}`);
		} finally {
			loading.set(false);
		}
	}
	async function save() {
		saving.set(true);
		try {
			const body = lines().map(composeLine).join("\n") + (trailingNewline() ? "\n" : "");
			await writeFile(HOSTS_PATH, body);
			pendingSave.set(false);
			loadedAt.set(shortTime((/* @__PURE__ */ new Date()).toISOString()));
			notice.set(`已保存 ${HOSTS_PATH}（${entries().length} 条条目）`);
			dirty.set(false);
			log("info", "hosts saved");
		} catch (failure) {
			const message = `写入 ${HOSTS_PATH} 失败：${errorMessage(failure)}`;
			notice.set(message);
			log("error", `hosts save failed: ${message}`);
		} finally {
			saving.set(false);
		}
	}
	function toggle(target) {
		lines.set(lines().map((line) => {
			if (line !== target) return line;
			const enabled = !target.enabled;
			return {
				...target,
				enabled,
				raw: composeLine({
					...target,
					enabled
				})
			};
		}));
		dirty.set(true);
	}
	function remove(target) {
		lines.set(lines().filter((line) => line !== target));
		dirty.set(true);
	}
	function add() {
		const ip = addIp().trim();
		const names = addNames().trim().split(/\s+/).filter((name) => name.length > 0);
		if (ip.length === 0 || names.length === 0) {
			notice.set("新增条目需要 IP 地址和至少一个主机名。");
			return;
		}
		if (!looksLikeIp(ip)) {
			notice.set(`「${ip}」不像 IPv4 / IPv6 地址。`);
			return;
		}
		const line = {
			kind: "entry",
			raw: `${ip} ${names.join(" ")}`,
			enabled: true,
			ip,
			names
		};
		lines.set([...lines(), line]);
		addIp.set("");
		addNames.set("");
		addOpen.set(false);
		dirty.set(true);
		notice.set(`已添加 ${ip} ${names.join(" ")}，点「保存」写入文件。`);
	}
	load();
	function entryRow(line) {
		return component(Row, {
			gap: 10,
			align: "center",
			get style() {
				return {
					paddingVertical: 7,
					borderBottomWidth: 1,
					borderColor: c.line()
				};
			},
			get children() {
				return [
					component(Badge, {
						get text() {
							return line.enabled ? "启用" : "禁用";
						},
						get tone() {
							return line.enabled ? "ok" : "neutral";
						}
					}),
					(() => {
						const __nsh_hv2 = element("text");
						prop(__nsh_hv2, "numberOfLines", 1);
						bindProp(__nsh_hv2, "style", () => ({
							...t.mono,
							width: 140
						}));
						insert(__nsh_hv2, () => line.ip);
						return __nsh_hv2;
					})(),
					(() => {
						const __nsh_hv3 = element("text");
						prop(__nsh_hv3, "numberOfLines", 1);
						bindProp(__nsh_hv3, "style", () => ({
							...t.mono,
							flex: 1,
							color: line.enabled ? c.text() : c.muted()
						}));
						insert(__nsh_hv3, () => line.names.join(" ") || "-");
						return __nsh_hv3;
					})(),
					component(Button, {
						get label() {
							return line.enabled ? "禁用" : "启用";
						},
						small: true,
						onPress: () => toggle(line)
					}),
					component(Button, {
						label: "删除",
						small: true,
						tone: "danger",
						onPress: () => remove(line)
					})
				];
			}
		});
	}
	function content() {
		return component(Stack, {
			scroll: true,
			padding: 14,
			gap: 12,
			get children() {
				return [
					component(Card, {
						title: "主机条目",
						hint: "启用 / 禁用 / 删除后点保存写回文件",
						get children() {
							return (() => {
								const __nsh_hv4 = element("view");
								prop(__nsh_hv4, "style", {
									display: "flex",
									flexDirection: "column"
								});
								insert(__nsh_hv4, [() => component(Row, {
									gap: 8,
									align: "center",
									style: { paddingBottom: 6 },
									get children() {
										return [component(Badge, { get text() {
											return `${visible().length} / ${entries().length} 条`;
										} }), (() => {
											const __nsh_hv5 = element("text");
											bindProp(__nsh_hv5, "style", () => t.meta);
											insert(__nsh_hv5, () => filter().trim().length === 0 ? "整份文件里的主机条目" : `过滤词：${filter()}`);
											return __nsh_hv5;
										})()];
									}
								}), () => visible().length === 0 ? component(Empty, {
									get title() {
										return filter().trim().length === 0 ? "还没有主机条目" : "没有匹配的条目";
									},
									get hint() {
										return filter().trim().length === 0 ? "点上方「新增条目」加一行 IP 与主机名，保存后写入 /etc/hosts。" : "清空搜索词，或换一个 IP / 主机名再试。";
									}
								}) : visible().map((line) => entryRow(line))]);
								return __nsh_hv4;
							})();
						}
					}),
					component(Card, {
						title: "注释与空行",
						hint: "原样保留，保存时按原位置写回",
						get right() {
							return component(Button, {
								get label() {
									return showComments() ? "收起" : "展开";
								},
								small: true,
								onPress: () => showComments.set(!showComments())
							});
						},
						get children() {
							return (() => {
								const __nsh_hv6 = element("view");
								prop(__nsh_hv6, "style", {
									display: "flex",
									flexDirection: "column"
								});
								insert(__nsh_hv6, () => showComments() ? comments().length === 0 ? (() => {
									const __nsh_hv7 = element("text");
									bindProp(__nsh_hv7, "style", () => t.meta);
									const __nsh_hv8 = text("文件里没有注释或空行。");
									append(__nsh_hv7, __nsh_hv8);
									return __nsh_hv7;
								})() : comments().map((line) => (() => {
									const __nsh_hv9 = element("text");
									prop(__nsh_hv9, "numberOfLines", 1);
									bindProp(__nsh_hv9, "style", () => ({
										...t.mono,
										color: c.muted()
									}));
									insert(__nsh_hv9, () => line.raw.length === 0 ? "（空行）" : line.raw);
									return __nsh_hv9;
								})()) : (() => {
									const __nsh_hv10 = element("text");
									bindProp(__nsh_hv10, "style", () => t.meta);
									const __nsh_hv11 = text("注释不会丢：保存时按原位置写回。");
									append(__nsh_hv10, __nsh_hv11);
									return __nsh_hv10;
								})());
								return __nsh_hv6;
							})();
						}
					}),
					() => !addOpen() ? null : component(Card, {
						title: "新增条目",
						hint: "保存后才会写入文件",
						get children() {
							return component(Row, {
								wrap: true,
								gap: 8,
								align: "center",
								get children() {
									return [
										component(Field, {
											get value() {
												return addIp();
											},
											onChange: (text) => addIp.set(text),
											placeholder: "IP，如 127.0.0.1",
											width: 170
										}),
										component(Field, {
											get value() {
												return addNames();
											},
											onChange: (text) => addNames.set(text),
											placeholder: "主机名，多个用空格分隔",
											width: 280,
											onSubmit: () => add()
										}),
										component(Button, {
											label: "加入列表",
											small: true,
											tone: "primary",
											onPress: () => add()
										}),
										component(Button, {
											label: "取消",
											small: true,
											onPress: () => addOpen.set(false)
										})
									];
								}
							});
						}
					})
				];
			}
		});
	}
	return (() => {
		const __nsh_hv12 = element("view");
		bindProp(__nsh_hv12, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		insert(__nsh_hv12, [
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
						align: "center",
						get children() {
							return [
								(() => {
									const __nsh_hv13 = element("text");
									bindProp(__nsh_hv13, "style", () => t.h1);
									const __nsh_hv14 = text("Hosts 编辑器");
									append(__nsh_hv13, __nsh_hv14);
									return __nsh_hv13;
								})(),
								component(Badge, { get text() {
									return `${entries().length} 条条目`;
								} }),
								(() => {
									const __nsh_hv15 = element("text");
									bindProp(__nsh_hv15, "style", () => t.mono);
									insert(__nsh_hv15, HOSTS_PATH);
									return __nsh_hv15;
								})(),
								() => dirty() ? component(Badge, {
									text: "有未保存修改",
									tone: "warn"
								}) : null,
								component(SearchField, {
									get value() {
										return filter();
									},
									onChange: (value) => filter.set(value),
									placeholder: "按 IP / 主机名过滤",
									width: 220
								})
							];
						}
					}), () => loading() || error() !== null ? component(Row, {
						gap: 6,
						get children() {
							return [component(Button, {
								label: "重新读取",
								small: true,
								disabled: true
							}), component(Button, {
								label: "保存",
								small: true,
								disabled: true
							})];
						}
					}) : component(Row, {
						gap: 6,
						get children() {
							return [
								component(Button, {
									label: "重新读取",
									small: true,
									onPress: () => void load()
								}),
								component(Button, {
									get label() {
										return addOpen() ? "取消新增" : "新增条目";
									},
									small: true,
									onPress: () => addOpen.set(!addOpen())
								}),
								component(Button, {
									get label() {
										return saving() ? "保存中…" : "保存";
									},
									tone: "primary",
									small: true,
									onPress: () => {
										if (saving()) return;
										pendingSave.set(true);
									}
								})
							];
						}
					})];
				}
			}),
			component(Row, {
				gap: 8,
				style: {
					paddingHorizontal: 14,
					paddingBottom: 6
				},
				get children() {
					return [
						(() => {
							const __nsh_hv16 = element("text");
							bindProp(__nsh_hv16, "style", () => t.meta);
							insert(__nsh_hv16, () => loadedAt().length === 0 ? "尚未读取" : `上次读取：${loadedAt()}`);
							return __nsh_hv16;
						})(),
						(() => {
							const __nsh_hv17 = element("text");
							bindProp(__nsh_hv17, "style", () => t.meta);
							const __nsh_hv18 = text("·");
							append(__nsh_hv17, __nsh_hv18);
							return __nsh_hv17;
						})(),
						(() => {
							const __nsh_hv19 = element("text");
							bindProp(__nsh_hv19, "style", () => t.meta);
							const __nsh_hv20 = text("保存前会二次确认");
							append(__nsh_hv19, __nsh_hv20);
							return __nsh_hv19;
						})()
					];
				}
			}),
			() => notice() === null ? null : (() => {
				const __nsh_hv21 = element("view");
				prop(__nsh_hv21, "style", {
					paddingHorizontal: 14,
					paddingBottom: 8
				});
				insert(__nsh_hv21, component(Notice, { get message() {
					return notice() ?? "";
				} }));
				return __nsh_hv21;
			})(),
			() => !pendingSave() ? null : (() => {
				const __nsh_hv22 = element("view");
				prop(__nsh_hv22, "style", {
					paddingHorizontal: 14,
					paddingBottom: 8
				});
				insert(__nsh_hv22, component(ConfirmBar, {
					get message() {
						return `把 ${entries().length} 条条目写回 ${HOSTS_PATH}？写错可能影响本机域名解析。`;
					},
					confirmLabel: "写入",
					get busy() {
						return saving();
					},
					onConfirm: () => void save(),
					onCancel: () => pendingSave.set(false)
				}));
				return __nsh_hv22;
			})(),
			() => loading() && lines().length === 0 && error() === null ? component(Loading, { label: "正在读取 /etc/hosts…" }) : null,
			() => error() !== null && lines().length === 0 ? component(LoadError, {
				get message() {
					return error() ?? "";
				},
				onRetry: () => void load()
			}) : null,
			() => loading() && lines().length === 0 && error() === null ? null : error() !== null && lines().length === 0 ? null : content()
		]);
		return __nsh_hv12;
	})();
}

//#endregion
//#region pages/json/App.tsx
/** 把 `position N`（0 起的字符下标）换算成行与列（1 起）。 */
function describePosition(source, position) {
	const before = source.slice(0, Math.max(0, Math.min(position, source.length)));
	return `第 ${before.split("\n").length} 行第 ${before.length - before.lastIndexOf("\n")} 列（第 ${position + 1} 个字符）`;
}
/** JSON 解析错误 → 中文说明；带位置时补上行列。 */
function describeParseError(source, failure) {
	const message = errorMessage(failure).trim();
	if (message.length === 0) return "JSON 解析失败：内容不合法。";
	const withPosition = /position\s+(\d+)/i.exec(message);
	if (withPosition !== null) {
		const position = Number(withPosition[1]);
		if (Number.isFinite(position) && position >= 0) return `JSON 解析失败：${message}（${describePosition(source, position)}）`;
	}
	if (/unexpected end of json/i.test(message)) return "JSON 解析失败：内容不完整，括号或引号没有闭合。";
	if (/unexpected token/i.test(message)) {
		const matched = /unexpected token:\s*'(.*)'/i.exec(message);
		const token = matched === null ? null : matched[1];
		const at = token === null ? -1 : source.indexOf(token);
		if (token !== null && at >= 0) return `JSON 解析失败：意外字符「${token}」（${describePosition(source, at)}），检查逗号、括号与引号是否配对。`;
		return "JSON 解析失败：出现了意外字符，检查逗号、括号与引号是否配对。";
	}
	return `JSON 解析失败：${message}`;
}
/** 多行等宽输入框。 */
function CodeArea(props) {
	return (() => {
		const __nsh_hv0 = element("view");
		bindProp(__nsh_hv0, "style", () => ({
			flex: props.grow === true ? 1 : void 0,
			minHeight: props.height ?? 200,
			paddingHorizontal: 9,
			paddingVertical: 7,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: c.line(),
			backgroundColor: c.bg()
		}));
		const __nsh_hv1 = element("input");
		bindProp(__nsh_hv1, "value", () => props.value);
		bindProp(__nsh_hv1, "placeholder", () => props.placeholder ?? "");
		prop(__nsh_hv1, "multiline", true);
		prop(__nsh_hv1, "onChange", (text) => props.onChange(text));
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
/** 左侧输入区：输入框本身只建一次，字符数等文字走响应式子节点。 */
function SourcePane(props) {
	return (() => {
		const __nsh_hv2 = element("view");
		prop(__nsh_hv2, "style", {
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			padding: 12,
			gap: 8
		});
		insert(__nsh_hv2, [
			component(Row, {
				gap: 8,
				align: "center",
				get children() {
					return [
						(() => {
							const __nsh_hv3 = element("text");
							bindProp(__nsh_hv3, "style", () => t.h2);
							const __nsh_hv4 = text("输入");
							append(__nsh_hv3, __nsh_hv4);
							return __nsh_hv3;
						})(),
						component(Badge, { get text() {
							return `${props.read().length} 字符`;
						} }),
						(() => {
							const __nsh_hv5 = element("text");
							bindProp(__nsh_hv5, "style", () => t.meta);
							insert(__nsh_hv5, () => `${props.read().split("\n").length} 行`);
							return __nsh_hv5;
						})()
					];
				}
			}),
			component(CodeArea, {
				get value() {
					return props.read();
				},
				get onChange() {
					return props.write;
				},
				placeholder: "例如 {\"name\":\"navop\",\"tags\":[\"nsh\",\"tsx\"]}",
				grow: true,
				height: 260
			}),
			() => props.problem() === null ? null : component(Notice, {
				get message() {
					return props.problem() ?? "";
				},
				tone: "danger"
			})
		]);
		return __nsh_hv2;
	})();
}
/** 右侧输出区：结果变化时整体重画，这里没有输入框，不会影响焦点。 */
function ResultPane(props) {
	return (() => {
		const __nsh_hv6 = element("view");
		prop(__nsh_hv6, "style", {
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			padding: 12,
			gap: 8
		});
		const __nsh_hv9 = element("view");
		prop(__nsh_hv9, "style", {
			flex: 1,
			minHeight: 0
		});
		insert(__nsh_hv9, () => body());
		append(__nsh_hv6, __nsh_hv9);
		insert(__nsh_hv6, component(Row, {
			gap: 8,
			align: "center",
			get children() {
				return [(() => {
					const __nsh_hv7 = element("text");
					bindProp(__nsh_hv7, "style", () => t.h2);
					const __nsh_hv8 = text("输出");
					append(__nsh_hv7, __nsh_hv8);
					return __nsh_hv7;
				})(), component(Badge, { text: "格式化 / 压缩 / 转义 / 反转义" })];
			}
		}), __nsh_hv9);
		return __nsh_hv6;
	})();
	function body() {
		const current = props.result();
		if (current === null) return component(Empty, {
			title: "还没有结果",
			hint: "在左侧输入 JSON，再选一个操作（格式化 / 压缩 / 转义 / 反转义）。"
		});
		return (() => {
			const __nsh_hv10 = element("view");
			prop(__nsh_hv10, "style", {
				display: "flex",
				flexDirection: "column",
				gap: 8,
				flex: 1,
				minHeight: 0
			});
			const __nsh_hv12 = element("view");
			bindProp(__nsh_hv12, "style", () => ({
				flex: 1,
				minHeight: 0,
				padding: 10,
				borderRadius: r.control,
				borderWidth: 1,
				borderColor: c.line(),
				backgroundColor: c.panel()
			}));
			insert(__nsh_hv12, component(Stack, {
				scroll: true,
				padding: 0,
				gap: 0,
				get children() {
					return (() => {
						const __nsh_hv13 = element("text");
						prop(__nsh_hv13, "selectable", true);
						bindProp(__nsh_hv13, "style", () => ({
							...t.mono,
							lineHeight: 18
						}));
						insert(__nsh_hv13, () => current.text);
						return __nsh_hv13;
					})();
				}
			}));
			append(__nsh_hv10, __nsh_hv12);
			insert(__nsh_hv10, component(Row, {
				gap: 8,
				align: "center",
				get children() {
					return [component(Badge, {
						get text() {
							return current.label;
						},
						tone: "info"
					}), (() => {
						const __nsh_hv11 = element("text");
						bindProp(__nsh_hv11, "style", () => t.meta);
						insert(__nsh_hv11, () => `${current.text.length} 字符`);
						return __nsh_hv11;
					})()];
				}
			}), __nsh_hv12);
			return __nsh_hv10;
		})();
	}
}
function Json() {
	const source = signal("");
	const indent = signal(2);
	const result = signal(null);
	const error = signal(null);
	const notice = signal(null);
	function run(kind) {
		if (source().trim().length === 0) {
			result.set(null);
			error.set("先在上方输入 JSON 文本。");
			return;
		}
		try {
			switch (kind) {
				case "format":
					result.set({
						text: JSON.stringify(JSON.parse(source()), null, indent()),
						label: `格式化结果（缩进 ${indent()} 空格）`
					});
					break;
				case "minify":
					result.set({
						text: JSON.stringify(JSON.parse(source())),
						label: "压缩结果"
					});
					break;
				case "escape":
					result.set({
						text: JSON.stringify(source()),
						label: "转义结果"
					});
					break;
				case "unescape": {
					const value = JSON.parse(source());
					if (typeof value !== "string") {
						result.set(null);
						error.set("反转义需要一个 JSON 字符串字面量（以引号开头和结尾的文本）。");
						return;
					}
					result.set({
						text: value,
						label: "反转义结果"
					});
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
	return (() => {
		const __nsh_hv14 = element("view");
		bindProp(__nsh_hv14, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		const __nsh_hv20 = element("view");
		prop(__nsh_hv20, "style", {
			flex: 1,
			minHeight: 0
		});
		insert(__nsh_hv20, component(SplitPane, {
			width: 540,
			get left() {
				return component(SourcePane, {
					read: source,
					write: (value) => source.set(value),
					problem: error
				});
			},
			get right() {
				return component(ResultPane, { result });
			}
		}));
		append(__nsh_hv14, __nsh_hv20);
		insert(__nsh_hv14, [component(Row, {
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
					align: "center",
					get children() {
						return [(() => {
							const __nsh_hv15 = element("text");
							bindProp(__nsh_hv15, "style", () => t.h1);
							const __nsh_hv16 = text("JSON 工具");
							append(__nsh_hv15, __nsh_hv16);
							return __nsh_hv15;
						})(), component(Badge, {
							text: "本地计算",
							tone: "ok"
						})];
					}
				}), component(Row, {
					wrap: true,
					gap: 6,
					align: "center",
					get children() {
						return [
							(() => {
								const __nsh_hv17 = element("text");
								bindProp(__nsh_hv17, "style", () => t.label);
								const __nsh_hv18 = text("缩进");
								append(__nsh_hv17, __nsh_hv18);
								return __nsh_hv17;
							})(),
							() => component(Row, {
								gap: 6,
								get children() {
									return [component(Button, {
										label: "2 空格",
										small: true,
										get tone() {
											return indent() === 2 ? "primary" : "ghost";
										},
										onPress: () => indent.set(2)
									}), component(Button, {
										label: "4 空格",
										small: true,
										get tone() {
											return indent() === 4 ? "primary" : "ghost";
										},
										onPress: () => indent.set(4)
									})];
								}
							}),
							component(Button, {
								label: "格式化",
								small: true,
								tone: "primary",
								onPress: () => run("format")
							}),
							component(Button, {
								label: "压缩",
								small: true,
								onPress: () => run("minify")
							}),
							component(Button, {
								label: "转义",
								small: true,
								onPress: () => run("escape")
							}),
							component(Button, {
								label: "反转义",
								small: true,
								onPress: () => run("unescape")
							}),
							component(Button, {
								label: "复制结果",
								small: true,
								onPress: () => void copy()
							}),
							component(Button, {
								label: "清空",
								small: true,
								onPress: reset
							})
						];
					}
				})];
			}
		}), () => notice() === null ? null : (() => {
			const __nsh_hv19 = element("view");
			prop(__nsh_hv19, "style", {
				paddingHorizontal: 14,
				paddingBottom: 8
			});
			insert(__nsh_hv19, component(Notice, { get message() {
				return notice() ?? "";
			} }));
			return __nsh_hv19;
		})()], __nsh_hv20);
		return __nsh_hv14;
	})();
}

//#endregion
//#region App.tsx
/** 默认路由：工具箱打开时先看 JSON 工具。 */
const DEFAULT_ROUTE = "json";
const params = host.params;
/** 路由表。顺序就是侧栏顺序：JSON → Crypto → Hosts。 */
const ROUTES = [
	{
		id: "json",
		title: "JSON 工具",
		glyph: "J",
		component: Json
	},
	{
		id: "crypto",
		title: "Crypto 工具箱",
		glyph: "C",
		component: Crypto
	},
	{
		id: "hosts",
		title: "Hosts 编辑器",
		glyph: "H",
		component: Hosts
	}
];
/** 未知 route 回落默认路由（拼写错误、老 view id 都走这里）。 */
function resolveRoute(value) {
	if (typeof value === "string" && ROUTES.some((item) => item.id === value)) return value;
	return DEFAULT_ROUTE;
}
function routeById(id) {
	return ROUTES.find((item) => item.id === id) ?? ROUTES[0];
}
function App() {
	const route = signal(resolveRoute(params.route));
	const title = params.extension?.title ?? "JS Toolbox";
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
		insert(__nsh_hv4, () => `共 ${ROUTES.length} 个工具`);
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
		append(__nsh_hv1, __nsh_hv2);
		append(__nsh_hv1, __nsh_hv5);
		append(__nsh_hv1, __nsh_hv6);
		const __nsh_hv13 = element("view");
		prop(__nsh_hv13, "style", {
			flex: 1,
			minWidth: 0,
			minHeight: 0,
			display: "flex",
			flexDirection: "column"
		});
		insert(__nsh_hv13, () => {
			const Page = routeById(route()).component;
			return component(Page, {});
		});
		append(__nsh_hv0, __nsh_hv1);
		append(__nsh_hv0, __nsh_hv13);
		return __nsh_hv0;
	})();
}
mount(App);

//#endregion
export { App as default };