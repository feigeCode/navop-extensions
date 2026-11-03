import { append, bindProp, component, cond, element, insert, prop, text } from "nsh:rt";
import { host, mount, signal, token } from "nsh";

//#region ../../../../docker/ui/lib/format.ts
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
/** provider 抛出来的错误可能是 Error、字符串或 `{message}`；统一成一句话。 */
function errorMessage(error) {
	if (typeof error === "string") return error;
	if (error && typeof error === "object") {
		const message = error.message;
		if (typeof message === "string") return message;
	}
	return String(error);
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
/** 分区标题（列表上方的分组名）。 */
function SectionTitle(props) {
	return component(Row, {
		style: {
			justifyContent: "space-between",
			paddingBottom: 2
		},
		get children() {
			return [component(Row, {
				gap: 8,
				get children() {
					return [(() => {
						const __nsh_hv42 = element("text");
						bindProp(__nsh_hv42, "style", () => t.label);
						insert(__nsh_hv42, () => props.title);
						return __nsh_hv42;
					})(), () => props.hint === void 0 ? null : (() => {
						const __nsh_hv43 = element("text");
						bindProp(__nsh_hv43, "style", () => t.meta);
						insert(__nsh_hv43, () => props.hint);
						return __nsh_hv43;
					})()];
				}
			}), () => props.right];
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
//#region App.tsx
/** 时间窗口预设；`all` 从 0 开始，等价于「不限起始时间」。 */
const WINDOWS = [
	{
		id: "15m",
		label: "15 分钟",
		ms: 9e5
	},
	{
		id: "1h",
		label: "1 小时",
		ms: 36e5
	},
	{
		id: "1d",
		label: "1 天",
		ms: 864e5
	},
	{
		id: "all",
		label: "全部",
		ms: 0
	}
];
/** provider 单页硬上限（admin.rs 里 page_size 会 clamp 到 100）。 */
const PAGE_SIZE = 100;
/** 页面最多累计 500 条，够翻 5 页。 */
const MAX_ROWS = 500;
/** 单条消息体最多渲染这么多字符，超出的截断并提示。 */
const MAX_BODY_CHARS = 2e4;
/** operationId → provider 方法名。
*
* 清单里的 `resourceWorkbenches` 已经不参与运行，这一层映射留在页面里：
* 页面自己决定"要哪份数据"，宿主只负责把方法名和参数发给 provider。
*/
const OPERATIONS = {
	clusterOverview: "middleware/cluster/overview",
	createTopic: "middleware/topic/create",
	deleteTopic: "middleware/topic/delete",
	groupClients: "middleware/group/clients",
	groupDetail: "middleware/group/detail",
	listGroups: "middleware/group/list",
	listTopics: "middleware/topic/list",
	metrics: "middleware/metrics",
	queryById: "middleware/message/query",
	queryByKey: "middleware/message/query",
	queryByTimeWindow: "middleware/message/query",
	resetConsumerOffset: "rocketmq/consumer/reset-offset",
	sendMessage: "middleware/message/send",
	topicDetail: "middleware/topic/detail",
	updateTopic: "middleware/topic/update"
};
let resourceHandle = null;
/** 借来的资源句柄：页面所属连接的那一个。 */
async function handle() {
	if (resourceHandle) return resourceHandle;
	const found = (await host.call("navop.context.current", {}))?.connection?.resourceHandle;
	if (!found) throw new Error("这个页面需要一个扩展连接（当前上下文里没有资源句柄）");
	resourceHandle = found;
	return found;
}
/** 调一次 provider 方法；把失败折成一句人话。`confirmed` 仅为兼容旧调用点。 */
async function dispatch(operationId, input, _confirmed) {
	const method = OPERATIONS[operationId];
	if (!method) throw new Error(`未知的操作：${operationId}`);
	try {
		return await host.call("navop.resource.invoke", {
			handle: await handle(),
			method,
			params: input ?? {}
		});
	} catch (error) {
		throw new Error(errorMessage(error));
	}
}
function asRecord(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value;
}
/** 数字字段：非数字或非有限值都给 null（provider 各版本字段不一致）。 */
function asNumber(value) {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim().length > 0) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}
function strOf(source, key) {
	const value = source[key];
	if (typeof value === "string") return value;
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return "";
}
/** 展示用的时间：provider 给的是本地 `YYYY-MM-DD HH:mm:ss`，原样用，别二次解析。 */
function timeText(message) {
	const store = strOf(message, "store_time");
	if (store.length > 0) return store;
	const born = strOf(message, "born_time");
	return born.length > 0 ? born : "-";
}
function messageKey(message) {
	const id = strOf(message, "message_id");
	if (id.length > 0) return id;
	return `${timeText(message)}|${strOf(message, "topic")}|${strOf(message, "key")}`;
}
/** 消息体字节数：有原始字节就数字节，否则按 UTF-8 编码 body_text。 */
function bodySize(message) {
	const raw = message.body;
	if (Array.isArray(raw)) return raw.length;
	const text = typeof message.body_text === "string" ? message.body_text : "";
	return text.length === 0 ? 0 : new TextEncoder().encode(text).length;
}
/** 消息属性：provider 给的是 [[k, v], ...]，只保留成对的两项。 */
function propRows(message) {
	const raw = message["properties"];
	if (!Array.isArray(raw)) return [];
	const rows = [];
	for (const item of raw) {
		if (!Array.isArray(item) || item.length < 2) continue;
		rows.push([String(item[0] ?? ""), String(item[1] ?? "")]);
	}
	return rows;
}
/** 消息体：优先 body_text，否则把字节按严格 UTF-8 解码；解不出就是二进制。 */
function bodyOf(message) {
	let text = typeof message.body_text === "string" ? message.body_text : "";
	let binary = false;
	if (text.length === 0 && Array.isArray(message.body) && message.body.length > 0) try {
		const bytes = new Uint8Array(message.body);
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		binary = true;
	}
	if (text.includes("\0")) binary = true;
	const trimmed = text.trim();
	let json = false;
	if (!binary && (trimmed.startsWith("{") || trimmed.startsWith("["))) try {
		JSON.parse(trimmed);
		json = true;
	} catch {
		json = false;
	}
	return {
		text,
		json,
		binary
	};
}
function prettyJson(text) {
	try {
		return JSON.stringify(JSON.parse(text.trim()), null, 2);
	} catch {
		return text;
	}
}
function hexPreview(message, limit = 64) {
	if (!Array.isArray(message.body)) return "";
	const total = message.body.length;
	const head = message.body.slice(0, limit).map((byte) => (Number(byte) & 255).toString(16).padStart(2, "0")).join(" ");
	return total > limit ? `${head} …（共 ${total} B）` : head;
}
/** 倒序合并并按 message_id 去重（翻页时 offset 可能漂移）。 */
function mergeRows(base, extra) {
	const seen = /* @__PURE__ */ new Set();
	const merged = [];
	for (const message of base.concat(extra)) {
		const key = messageKey(message);
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(message);
	}
	merged.sort((left, right) => timeText(right).localeCompare(timeText(left)));
	return merged.slice(0, MAX_ROWS);
}
/** 带边框的输入框，标签在上。 */
function Field(props) {
	return (() => {
		const __nsh_hv0 = element("view");
		bindProp(__nsh_hv0, "style", () => ({
			display: "flex",
			flexDirection: "column",
			gap: 4,
			...props.grow === true ? {
				flex: 1,
				minWidth: 0
			} : { width: props.width ?? 200 }
		}));
		const __nsh_hv1 = element("text");
		bindProp(__nsh_hv1, "style", () => t.label);
		insert(__nsh_hv1, () => props.label);
		const __nsh_hv2 = element("view");
		bindProp(__nsh_hv2, "style", () => ({
			height: 30,
			paddingHorizontal: 9,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: c.line(),
			backgroundColor: c.bg(),
			display: "flex",
			flexDirection: "row",
			alignItems: "center"
		}));
		const __nsh_hv3 = element("input");
		bindProp(__nsh_hv3, "value", () => props.value);
		bindProp(__nsh_hv3, "placeholder", () => props.placeholder);
		prop(__nsh_hv3, "onChange", (text) => props.onChange(text));
		prop(__nsh_hv3, "onSubmit", () => props.onSubmit?.());
		bindProp(__nsh_hv3, "style", () => ({
			flex: 1,
			minWidth: 0,
			fontSize: 13,
			color: c.text(),
			paddingHorizontal: 0,
			borderWidth: 0,
			backgroundColor: "transparent"
		}));
		append(__nsh_hv2, __nsh_hv3);
		append(__nsh_hv0, __nsh_hv1);
		append(__nsh_hv0, __nsh_hv2);
		return __nsh_hv0;
	})();
}
function Messages() {
	const topic = signal("");
	const key = signal("");
	const messageId = signal("");
	const windowId = signal("1h");
	const querying = signal(false);
	const loadingMore = signal(false);
	const error = signal(null);
	const formError = signal(null);
	const rows = signal([]);
	const hasMore = signal(false);
	const pageNo = signal(1);
	const pageTotal = signal(null);
	const active = signal(null);
	const selected = signal(null);
	const bodyMode = signal("pretty");
	const loadedOnce = signal(false);
	const mode = () => {
		if (messageId().trim().length > 0) return "id";
		if (key().trim().length > 0) return "key";
		return "time";
	};
	const modeLabel = () => {
		const current = mode();
		if (current === "id") return "按 Message ID";
		if (current === "key") return "按 Key";
		return "按时间窗口";
	};
	function buildQuery() {
		const topicText = topic().trim();
		if (topicText.length === 0) {
			formError.set("Topic 必填：RocketMQ 按 Topic 路由查询，三种查询方式都需要它。");
			return null;
		}
		const current = mode();
		const window = WINDOWS.find((item) => item.id === windowId()) ?? WINDOWS[0];
		const end = Date.now();
		return {
			mode: current,
			topic: topicText,
			key: key().trim(),
			messageId: messageId().trim(),
			begin: window.ms === 0 ? 0 : end - window.ms,
			end
		};
	}
	async function fetchPage(query, page) {
		let raw;
		if (query.mode === "id") raw = await dispatch("queryById", { ById: {
			topic: query.topic,
			message_id: query.messageId
		} });
		else if (query.mode === "key") raw = await dispatch("queryByKey", { ByKey: {
			topic: query.topic,
			key: query.key
		} });
		else raw = await dispatch("queryByTimeWindow", { ByTimeWindow: {
			topic: query.topic,
			begin_unix_ms: query.begin,
			end_unix_ms: query.end,
			page,
			page_size: PAGE_SIZE
		} });
		const record = asRecord(raw);
		return {
			messages: arr(raw, "messages").map((item) => asRecord(item)).filter((item) => item !== null),
			more: query.mode === "time" && record !== null && record.has_more === true,
			reported: record === null ? null : asNumber(record["total"])
		};
	}
	async function search() {
		if (querying()) return;
		const query = buildQuery();
		if (query === null) return;
		formError.set(null);
		error.set(null);
		querying.set(true);
		try {
			const result = await fetchPage(query, 1);
			active.set(query);
			pageNo.set(1);
			hasMore.set(result.more && result.messages.length < MAX_ROWS);
			pageTotal.set(result.reported);
			rows.set(mergeRows([], result.messages));
			selected.set(null);
			bodyMode.set("pretty");
			loadedOnce.set(true);
		} catch (failure) {
			error.set(errorMessage(failure));
			rows.set([]);
			hasMore.set(false);
			selected.set(null);
		} finally {
			querying.set(false);
		}
	}
	async function loadMore() {
		const query = active();
		if (query === null || loadingMore() || querying()) return;
		if (!hasMore()) return;
		if (rows().length >= MAX_ROWS) return;
		loadingMore.set(true);
		error.set(null);
		try {
			const next = pageNo() + 1;
			const result = await fetchPage(query, next);
			pageNo.set(next);
			const merged = mergeRows(rows(), result.messages);
			rows.set(merged);
			hasMore.set(result.more && merged.length < MAX_ROWS);
			pageTotal.set(result.reported);
		} catch (failure) {
			error.set(errorMessage(failure));
		} finally {
			loadingMore.set(false);
		}
	}
	function toggle(message) {
		const key = messageKey(message);
		if (selected() === key) {
			selected.set(null);
			return;
		}
		selected.set(key);
		bodyMode.set("pretty");
	}
	const textStyle = {
		...t.mono,
		fontFamily: "monospace",
		lineHeight: 18
	};
	function bodyView(message) {
		const body = bodyOf(message);
		const tooLong = body.text.length > MAX_BODY_CHARS;
		const shown = tooLong ? body.text.slice(0, MAX_BODY_CHARS) : body.text;
		const display = body.binary ? hexPreview(message) : bodyMode() === "pretty" && body.json ? prettyJson(shown) : shown;
		const meta = [
			["Message ID", strOf(message, "message_id") || "-"],
			["Topic", strOf(message, "topic") || "-"],
			["Tag", strOf(message, "tag") || "<无>"],
			["Key", strOf(message, "key") || "<无>"],
			["存储时间", strOf(message, "store_time") || "-"],
			["生成时间", strOf(message, "born_time") || "-"],
			["存储 Broker", strOf(message, "store_host") || "-"],
			["生产者", strOf(message, "born_host") || "-"],
			["重试次数", strOf(message, "retry_times") || "0"],
			["消息体大小", humanBytes(bodySize(message))]
		];
		return (() => {
			const __nsh_hv4 = element("view");
			bindProp(__nsh_hv4, "style", () => ({
				display: "flex",
				flexDirection: "column",
				gap: 10,
				padding: 12,
				backgroundColor: c.bg(),
				borderTopWidth: 1,
				borderTopColor: c.line()
			}));
			const __nsh_hv11 = element("view");
			bindProp(__nsh_hv11, "style", () => ({
				padding: 10,
				borderRadius: r.control,
				borderWidth: 1,
				borderColor: c.line(),
				backgroundColor: c.panel()
			}));
			const __nsh_hv12 = element("text");
			prop(__nsh_hv12, "selectable", true);
			prop(__nsh_hv12, "style", textStyle);
			insert(__nsh_hv12, () => display.length > 0 ? display : "<空消息体>");
			append(__nsh_hv11, __nsh_hv12);
			append(__nsh_hv4, __nsh_hv11);
			insert(__nsh_hv4, [component(Row, {
				gap: 8,
				style: { justifyContent: "space-between" },
				get children() {
					return [component(Row, {
						gap: 8,
						get children() {
							return [
								(() => {
									const __nsh_hv5 = element("text");
									bindProp(__nsh_hv5, "style", () => t.label);
									const __nsh_hv6 = text("消息体");
									append(__nsh_hv5, __nsh_hv6);
									return __nsh_hv5;
								})(),
								(() => {
									const __nsh_hv7 = element("text");
									bindProp(__nsh_hv7, "style", () => t.meta);
									insert(__nsh_hv7, () => humanBytes(bodySize(message)));
									return __nsh_hv7;
								})(),
								() => body.binary ? component(Badge, {
									text: "二进制",
									tone: "warn"
								}) : body.json ? component(Badge, {
									text: "JSON",
									tone: "ok"
								}) : component(Badge, { text: "文本" }),
								() => tooLong ? (() => {
									const __nsh_hv8 = element("text");
									bindProp(__nsh_hv8, "style", () => t.meta);
									const __nsh_hv9 = text("已截断，仅显示前 ");
									const __nsh_hv10 = text(" 字符");
									append(__nsh_hv8, __nsh_hv9);
									append(__nsh_hv8, __nsh_hv10);
									insert(__nsh_hv8, MAX_BODY_CHARS, __nsh_hv10);
									return __nsh_hv8;
								})() : null
							];
						}
					}), () => body.json && !body.binary ? component(Button, {
						small: true,
						get label() {
							return bodyMode() === "pretty" ? "原文" : "格式化";
						},
						onPress: () => bodyMode.set(bodyMode() === "pretty" ? "raw" : "pretty")
					}) : null];
				}
			}), () => body.binary ? component(Notice, {
				message: "消息体不是合法 UTF-8 文本，按字节十六进制预览。",
				tone: "warn"
			}) : body.json ? null : component(Notice, { message: "内容不是合法 JSON，按原文显示。" })], __nsh_hv11);
			insert(__nsh_hv4, [component(KeyValue, {
				columns: 2,
				rows: meta
			}), () => propRows(message).length === 0 ? null : (() => {
				const __nsh_hv13 = element("view");
				prop(__nsh_hv13, "style", {
					display: "flex",
					flexDirection: "column",
					gap: 6
				});
				insert(__nsh_hv13, [component(SectionTitle, {
					title: "消息属性",
					get hint() {
						return `${propRows(message).length} 项`;
					}
				}), component(KeyValue, {
					columns: 2,
					get rows() {
						return propRows(message);
					}
				})]);
				return __nsh_hv13;
			})()]);
			return __nsh_hv4;
		})();
	}
	const headerCells = () => component(Row, {
		gap: 10,
		get style() {
			return {
				paddingVertical: 6,
				paddingHorizontal: 4,
				borderBottomWidth: 1,
				borderBottomColor: c.line()
			};
		},
		get children() {
			return [
				(() => {
					const __nsh_hv14 = element("text");
					prop(__nsh_hv14, "numberOfLines", 1);
					bindProp(__nsh_hv14, "style", () => [t.label, { width: 140 }]);
					const __nsh_hv15 = text("时间");
					append(__nsh_hv14, __nsh_hv15);
					return __nsh_hv14;
				})(),
				(() => {
					const __nsh_hv16 = element("text");
					prop(__nsh_hv16, "numberOfLines", 1);
					bindProp(__nsh_hv16, "style", () => [t.label, {
						flex: 1,
						minWidth: 0
					}]);
					const __nsh_hv17 = text("Topic");
					append(__nsh_hv16, __nsh_hv17);
					return __nsh_hv16;
				})(),
				(() => {
					const __nsh_hv18 = element("text");
					prop(__nsh_hv18, "numberOfLines", 1);
					bindProp(__nsh_hv18, "style", () => [t.label, { width: 130 }]);
					const __nsh_hv19 = text("Key");
					append(__nsh_hv18, __nsh_hv19);
					return __nsh_hv18;
				})(),
				(() => {
					const __nsh_hv20 = element("text");
					prop(__nsh_hv20, "numberOfLines", 1);
					bindProp(__nsh_hv20, "style", () => [t.label, { width: 100 }]);
					const __nsh_hv21 = text("Tag");
					append(__nsh_hv20, __nsh_hv21);
					return __nsh_hv20;
				})(),
				(() => {
					const __nsh_hv22 = element("text");
					prop(__nsh_hv22, "numberOfLines", 1);
					bindProp(__nsh_hv22, "style", () => [t.label, {
						width: 90,
						textAlign: "right"
					}]);
					const __nsh_hv23 = text("存储大小");
					append(__nsh_hv22, __nsh_hv23);
					return __nsh_hv22;
				})(),
				(() => {
					const __nsh_hv24 = element("text");
					prop(__nsh_hv24, "numberOfLines", 1);
					bindProp(__nsh_hv24, "style", () => [t.label, {
						width: 60,
						textAlign: "right"
					}]);
					const __nsh_hv25 = text("重试");
					append(__nsh_hv24, __nsh_hv25);
					return __nsh_hv24;
				})(),
				(() => {
					const __nsh_hv26 = element("view");
					prop(__nsh_hv26, "style", { width: 18 });
					return __nsh_hv26;
				})()
			];
		}
	});
	const resultBody = () => {
		if (querying() && rows().length === 0) return component(Loading, { label: "正在查询消息…" });
		if (error() !== null && rows().length === 0) return component(LoadError, {
			get message() {
				return error() ?? "";
			},
			onRetry: () => void search()
		});
		if (rows().length === 0) return component(Empty, {
			get title() {
				return loadedOnce() ? "没有查询到消息" : "还没有查询结果";
			},
			get hint() {
				return loadedOnce() ? "换个时间窗口，或确认 Topic / Key / Message ID 是否正确。" : "填写 Topic 后按时间窗口查询，或再填 Key / Message ID 精确查询。";
			}
		});
		return (() => {
			const __nsh_hv27 = element("view");
			prop(__nsh_hv27, "style", {
				display: "flex",
				flexDirection: "column"
			});
			insert(__nsh_hv27, [() => headerCells(), () => rows().map((message) => (() => {
				const __nsh_hv28 = element("view");
				prop(__nsh_hv28, "style", {
					display: "flex",
					flexDirection: "column"
				});
				const __nsh_hv29 = element("view");
				prop(__nsh_hv29, "onPress", () => toggle(message));
				bindProp(__nsh_hv29, "style", () => ({
					cursor: "pointer",
					backgroundColor: selected() === messageKey(message) ? c.hover() : "transparent",
					borderBottomWidth: 1,
					borderBottomColor: c.line()
				}));
				insert(__nsh_hv29, component(Row, {
					gap: 10,
					style: {
						paddingVertical: 8,
						paddingHorizontal: 4
					},
					get children() {
						return [
							(() => {
								const __nsh_hv30 = element("text");
								prop(__nsh_hv30, "numberOfLines", 1);
								bindProp(__nsh_hv30, "style", () => [t.mono, { width: 140 }]);
								insert(__nsh_hv30, () => timeText(message));
								return __nsh_hv30;
							})(),
							(() => {
								const __nsh_hv31 = element("text");
								prop(__nsh_hv31, "numberOfLines", 1);
								bindProp(__nsh_hv31, "style", () => [{
									flex: 1,
									minWidth: 0,
									fontSize: 12,
									color: c.text()
								}]);
								insert(__nsh_hv31, () => strOf(message, "topic") || "-");
								return __nsh_hv31;
							})(),
							(() => {
								const __nsh_hv32 = element("text");
								prop(__nsh_hv32, "numberOfLines", 1);
								bindProp(__nsh_hv32, "style", () => [t.mono, { width: 130 }]);
								insert(__nsh_hv32, () => strOf(message, "key") || "-");
								return __nsh_hv32;
							})(),
							(() => {
								const __nsh_hv33 = element("text");
								prop(__nsh_hv33, "numberOfLines", 1);
								bindProp(__nsh_hv33, "style", () => [t.mono, {
									width: 100,
									color: c.muted()
								}]);
								insert(__nsh_hv33, () => strOf(message, "tag") || "-");
								return __nsh_hv33;
							})(),
							(() => {
								const __nsh_hv34 = element("text");
								prop(__nsh_hv34, "numberOfLines", 1);
								bindProp(__nsh_hv34, "style", () => [t.mono, {
									width: 90,
									textAlign: "right"
								}]);
								insert(__nsh_hv34, () => humanBytes(bodySize(message)));
								return __nsh_hv34;
							})(),
							(() => {
								const __nsh_hv35 = element("text");
								prop(__nsh_hv35, "numberOfLines", 1);
								bindProp(__nsh_hv35, "style", () => [t.mono, {
									width: 60,
									textAlign: "right"
								}]);
								insert(__nsh_hv35, () => strOf(message, "retry_times") || "0");
								return __nsh_hv35;
							})(),
							(() => {
								const __nsh_hv36 = element("text");
								bindProp(__nsh_hv36, "style", () => ({
									width: 18,
									fontSize: 11,
									color: c.muted(),
									textAlign: "right"
								}));
								insert(__nsh_hv36, () => selected() === messageKey(message) ? "▾" : "▸");
								return __nsh_hv36;
							})()
						];
					}
				}));
				append(__nsh_hv28, __nsh_hv29);
				insert(__nsh_hv28, () => selected() === messageKey(message) ? bodyView(message) : null);
				return __nsh_hv28;
			})())]);
			return __nsh_hv27;
		})();
	};
	const windowButtons = WINDOWS.map((item) => component(Button, {
		small: true,
		get label() {
			return item.label;
		},
		get tone() {
			return windowId() === item.id ? "primary" : "ghost";
		},
		onPress: () => windowId.set(item.id)
	}));
	return (() => {
		const __nsh_hv37 = element("view");
		bindProp(__nsh_hv37, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		insert(__nsh_hv37, [component(Row, {
			gap: 8,
			get style() {
				return {
					paddingHorizontal: 14,
					paddingVertical: 10,
					justifyContent: "space-between",
					borderBottomWidth: 1,
					borderBottomColor: c.line()
				};
			},
			get children() {
				return [component(Row, {
					gap: 8,
					get children() {
						return [
							(() => {
								const __nsh_hv38 = element("text");
								bindProp(__nsh_hv38, "style", () => t.h1);
								const __nsh_hv39 = text("消息查询");
								append(__nsh_hv38, __nsh_hv39);
								return __nsh_hv38;
							})(),
							component(Badge, { get text() {
								return modeLabel();
							} }),
							(() => {
								const __nsh_hv40 = element("text");
								bindProp(__nsh_hv40, "style", () => t.meta);
								insert(__nsh_hv40, () => rows().length === 0 ? "按时间窗口或 Key / ID 检索" : `已显示 ${rows().length} 条`);
								return __nsh_hv40;
							})()
						];
					}
				}), component(Row, {
					gap: 8,
					get children() {
						return (() => {
							const __nsh_hv41 = element("text");
							bindProp(__nsh_hv41, "style", () => t.meta);
							insert(__nsh_hv41, () => querying() ? "查询中…" : rows().length > 0 ? `结果 ${rows().length} 条` : "未查询");
							return __nsh_hv41;
						})();
					}
				})];
			}
		}), component(Stack, {
			scroll: true,
			padding: 14,
			gap: 12,
			get children() {
				return [component(Card, {
					title: "查询条件",
					hint: "messageId 优先，其次 key，否则按时间窗口",
					get children() {
						return [
							component(Row, {
								gap: 10,
								wrap: true,
								align: "flex-end",
								get children() {
									return [
										component(Field, {
											label: "Topic",
											get value() {
												return topic();
											},
											onChange: (text) => topic.set(text),
											placeholder: "例如 order-topic",
											grow: true,
											onSubmit: () => void search()
										}),
										component(Field, {
											label: "Message Key",
											get value() {
												return key();
											},
											onChange: (text) => key.set(text),
											placeholder: "可选，用于按 Key 查",
											width: 200,
											onSubmit: () => void search()
										}),
										component(Field, {
											label: "Message ID",
											get value() {
												return messageId();
											},
											onChange: (text) => messageId.set(text),
											placeholder: "可选，例如 7F000001... 或 UNIQ_KEY",
											width: 260,
											onSubmit: () => void search()
										})
									];
								}
							}),
							component(Row, {
								gap: 8,
								wrap: true,
								get children() {
									return [
										(() => {
											const __nsh_hv42 = element("text");
											bindProp(__nsh_hv42, "style", () => t.label);
											const __nsh_hv43 = text("时间窗口");
											append(__nsh_hv42, __nsh_hv43);
											return __nsh_hv42;
										})(),
										windowButtons,
										(() => {
											const __nsh_hv44 = element("text");
											bindProp(__nsh_hv44, "style", () => t.meta);
											const __nsh_hv45 = text("仅按 Topic 的窗口查询生效；按 Key / ID 查询时忽略时间窗口。");
											append(__nsh_hv44, __nsh_hv45);
											return __nsh_hv44;
										})()
									];
								}
							}),
							component(Row, {
								gap: 8,
								style: { justifyContent: "space-between" },
								get children() {
									return [(() => {
										const __nsh_hv46 = element("text");
										bindProp(__nsh_hv46, "style", () => t.meta);
										const __nsh_hv47 = text("单页 ");
										const __nsh_hv48 = text(" 条，最多累计 ");
										const __nsh_hv49 = text(" 条，按存储时间倒序；provider 的 total 只是本页条数，不是全量总数，所以按「本页 total」标注。");
										append(__nsh_hv46, __nsh_hv47);
										append(__nsh_hv46, __nsh_hv48);
										append(__nsh_hv46, __nsh_hv49);
										insert(__nsh_hv46, PAGE_SIZE, __nsh_hv48);
										insert(__nsh_hv46, MAX_ROWS, __nsh_hv49);
										return __nsh_hv46;
									})(), component(Button, {
										get label() {
											return querying() ? "查询中…" : "查询";
										},
										tone: "primary",
										small: true,
										onPress: () => {
											if (!querying()) search();
										}
									})];
								}
							}),
							() => formError() === null ? null : component(Notice, {
								get message() {
									return formError() ?? "";
								},
								tone: "danger"
							})
						];
					}
				}), component(Card, {
					title: "查询结果",
					get hint() {
						return rows().length === 0 ? "尚未查询" : `已显示 ${rows().length} / 最多 ${MAX_ROWS} 条${pageTotal() === null ? "" : ` · 本页 total ${pageTotal() ?? 0}`}${hasMore() ? " · 还有更多" : ""}`;
					},
					get right() {
						return component(Row, {
							gap: 6,
							get children() {
								return [() => error() === null ? null : (() => {
									const __nsh_hv50 = element("text");
									bindProp(__nsh_hv50, "style", () => ({
										fontSize: 12,
										color: c.danger()
									}));
									insert(__nsh_hv50, () => error() ?? "");
									return __nsh_hv50;
								})(), () => hasMore() && rows().length < MAX_ROWS ? component(Button, {
									get label() {
										return loadingMore() ? "加载中…" : "加载更多";
									},
									small: true,
									onPress: () => {
										if (!loadingMore()) loadMore();
									}
								}) : null];
							}
						});
					},
					get children() {
						return resultBody();
					}
				})];
			}
		})]);
		return __nsh_hv37;
	})();
}
mount(Messages);

//#endregion
export { Messages as default };