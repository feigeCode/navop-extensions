import { append, bindProp, component, cond, each, element, insert, prop, text } from "nsh:rt";
import { cleanup, host, mount, signal, token } from "nsh";

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
/** 实时流轮询间隔。 */
const POLL_MS = 1e3;
/** 单页条数（provider 允许 1..）。 */
const PAGE_SIZE = 200;
/** 一次刷新最多读几页：200 × 5 = 1000，正好是 provider 的缓冲容量。 */
const MAX_PAGES = 5;
/** 页面最多渲染多少行（时间倒序）。 */
const MAX_RENDER = 500;
/** 列表摘要截断长度。 */
const PREVIEW_CHARS = 160;
/** 详情里允许尝试 JSON 解析的最大字符数。 */
const MAX_PARSE_CHARS = 2e5;
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
function pairsOf(raw) {
	const pairs = [];
	for (const pair of arr(raw, "properties")) if (Array.isArray(pair) && pair.length >= 2) pairs.push([String(pair[0]), String(pair[1])]);
	return pairs;
}
/** provider 的 JSON 形状不保证，统一折成页面用的消息对象。 */
function toMessage(raw) {
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
function property(message, key) {
	for (const [name, value] of message.properties) if (name === key) return value;
	return "";
}
/** 接收时间优先用 properties.received_at_ms，退回 store_time（本地时间）。 */
function receivedAt(message) {
	const millis = Number(property(message, "received_at_ms"));
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
	const declared = Number(property(message, "payload_size"));
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
	return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat;
}
function isRetained(message) {
	return property(message, "retain") === "true";
}
function qosOf(message) {
	const value = property(message, "qos");
	return value.length > 0 ? value : "?";
}
function directionOf(message) {
	return property(message, "direction") === "out" ? "发出" : "收到";
}
/** `11-02 23:14:25`，时间窗口精确到秒，shortTime 只到分钟不够用。 */
function clockOf(millis) {
	if (!Number.isFinite(millis) || millis <= 0) return "-";
	const date = new Date(millis);
	const two = (value) => String(value).padStart(2, "0");
	return `${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}
/** MQTT 通配符匹配：`+` 一层，`#` 末尾多层。 */
function topicMatches(filter, topic) {
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
	if (filter.includes("+") || filter.includes("#")) return topicMatches(filter, topic);
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
	const clipped = raw.length > MAX_PARSE_CHARS ? raw.slice(0, MAX_PARSE_CHARS) : raw;
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
		["接收时间", clockOf(receivedAt(message))],
		["QoS", qosOf(message)],
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
				const result = await dispatch("queryByWindow", { ByTimeWindow: {
					topic: "#",
					begin_unix_ms: begin,
					end_unix_ms: end,
					page,
					page_size: PAGE_SIZE
				} });
				const pageObject = result;
				const rows = arr(result, "messages").map(toMessage).filter((message) => message !== null);
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
			const result = await dispatch("queryById", { ById: {
				topic: message.topic,
				message_id: id
			} });
			if (selectedId() !== id) return;
			const full = arr(result, "messages").map(toMessage).find((row) => row !== null && row.message_id === id);
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
								insert(__nsh_hv10, () => clockOf(receivedAt(message())));
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
								insert(__nsh_hv12, () => qosOf(message()));
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
								insert(__nsh_hv36, () => `${clockOf(receivedAt(message))} · ${directionOf(message)} · QoS ${qosOf(message)}`);
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
mount(Messages);

//#endregion
export { Messages as default };