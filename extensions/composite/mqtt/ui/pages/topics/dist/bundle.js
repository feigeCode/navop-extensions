import { append, bindProp, component, cond, element, insert, prop, text } from "nsh:rt";
import { host, mount, signal, token } from "nsh";

//#region ../../../../docker/ui/lib/format.ts
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
//#region ../../../../docker/ui/lib/theme.ts
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
//#region ../../../../docker/ui/lib/ui.tsx
const toneColor = (tone) => {
	switch (tone) {
		case "ok": return c.chart(1);
		case "warn": return c.chart(4);
		case "danger": return c.danger();
		case "info": return c.chart(0);
		default: return c.muted();
	}
};
/** 纵向堆叠；`scroll` 打开纵向滚动（页面根节点用）。 */
function Stack(props) {
	const style = {
		display: "flex",
		flexDirection: "column",
		gap: props.gap ?? 12,
		...props.padding === void 0 ? {} : { padding: props.padding },
		...props.scroll ? {
			flex: 1,
			minHeight: 0
		} : {},
		...props.style
	};
	if (props.scroll) return (() => {
		const __nsh_hv0 = element("scroll");
		prop(__nsh_hv0, "style", {
			flex: 1,
			minHeight: 0
		});
		const __nsh_hv1 = element("view");
		prop(__nsh_hv1, "style", style);
		insert(__nsh_hv1, () => props.children);
		append(__nsh_hv0, __nsh_hv1);
		return __nsh_hv0;
	})();
	return (() => {
		const __nsh_hv2 = element("view");
		prop(__nsh_hv2, "style", style);
		insert(__nsh_hv2, () => props.children);
		return __nsh_hv2;
	})();
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
	const color = toneColor(props.tone ?? "neutral");
	return (() => {
		const __nsh_hv9 = element("view");
		bindProp(__nsh_hv9, "style", () => ({
			paddingHorizontal: 8,
			paddingVertical: 2,
			borderRadius: r.pill,
			borderWidth: 1,
			borderColor: color,
			display: "flex",
			flexDirection: "row",
			alignItems: "center"
		}));
		const __nsh_hv10 = element("text");
		prop(__nsh_hv10, "style", {
			fontSize: 11,
			fontWeight: "600",
			color
		});
		insert(__nsh_hv10, () => props.text);
		append(__nsh_hv9, __nsh_hv10);
		return __nsh_hv9;
	})();
}
/** 按钮：三种语气，外观自己画（nsh/base 的 Button 只管无障碍语义）。 */
function Button(props) {
	const tone = props.tone ?? "ghost";
	const disabled = props.disabled === true;
	const fill = tone === "primary" ? c.accent() : tone === "danger" ? "transparent" : "transparent";
	const border = tone === "primary" ? c.accent() : tone === "danger" ? c.danger() : c.line();
	const label = disabled ? c.muted() : tone === "primary" ? c.accentText() : tone === "danger" ? c.danger() : c.text();
	return (() => {
		const __nsh_hv11 = element("view");
		bindProp(__nsh_hv11, "onPress", () => disabled ? void 0 : props.onPress);
		prop(__nsh_hv11, "role", "button");
		bindProp(__nsh_hv11, "accessibilityLabel", () => props.label);
		bindProp(__nsh_hv11, "style", () => ({
			height: props.small ? 24 : 28,
			paddingHorizontal: props.small ? 9 : 12,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: border,
			backgroundColor: fill,
			opacity: disabled ? .5 : 1,
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center"
		}));
		const __nsh_hv12 = element("text");
		bindProp(__nsh_hv12, "style", () => ({
			fontSize: props.small ? 12 : 13,
			fontWeight: "500",
			color: label
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
	if (props.items.length === 0 && props.empty !== void 0) return props.empty;
	return (() => {
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
		insert(__nsh_hv18, () => props.items.map((item, index) => {
			const key = props.keyOf(item);
			const active = props.selected === key;
			return (() => {
				const __nsh_hv19 = element("view");
				bindProp(__nsh_hv19, "onPress", () => props.onSelect === void 0 ? void 0 : () => props.onSelect?.(key));
				bindProp(__nsh_hv19, "style", () => ({
					backgroundColor: active ? c.hover() : "transparent",
					borderBottomWidth: index === props.items.length - 1 ? 0 : 1,
					borderBottomColor: c.line()
				}));
				insert(__nsh_hv19, () => props.render(item, index));
				return __nsh_hv19;
			})();
		}));
		append(__nsh_hv17, __nsh_hv18);
		return __nsh_hv17;
	})();
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
/** 键值对表：inspect 类页面的主体。 */
function KeyValue(props) {
	const columns = props.columns ?? 1;
	return (() => {
		const __nsh_hv39 = element("view");
		prop(__nsh_hv39, "style", {
			display: "flex",
			flexDirection: columns === 2 ? "row" : "column",
			flexWrap: "wrap",
			gap: columns === 2 ? 12 : 0
		});
		insert(__nsh_hv39, () => props.rows.map(([key, value]) => component(Row, {
			style: {
				justifyContent: "space-between",
				paddingVertical: 5,
				width: columns === 2 ? "48%" : "100%",
				gap: 12
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
			color: props.tone === void 0 ? c.muted() : toneColor(props.tone)
		}));
		insert(__nsh_hv48, () => props.message);
		return __nsh_hv48;
	})();
}

//#endregion
//#region App.tsx
/** 本地环形缓冲的容量，一次读满就够数了（admin.rs: MQTT_ADMIN_BUFFER_CAPACITY）。 */
const SNAPSHOT_LIMIT = 1e3;
/** 右侧每个过滤器最多展示多少条最近消息。 */
const DETAIL_ROWS = 20;
/** 消息正文预览截断长度。 */
const PREVIEW_CHARS = 200;
/** 调一次工作台操作；把 provider 的失败折成一句人话。 */
async function dispatch(operationId, input, confirmed) {
	try {
		return await host.call("navop.workbench.dispatch", {
			operationId,
			input: input ?? {},
			...confirmed === true ? { options: { confirmed: true } } : {}
		});
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
mount(Topics);

//#endregion
export { Topics as default };