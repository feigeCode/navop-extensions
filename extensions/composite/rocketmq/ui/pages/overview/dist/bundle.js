import { append, bindProp, component, cond, element, insert, prop, text } from "nsh:rt";
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
/** 0..1 → 百分比宽度（Meter 用）。返回类型要写成模板字面量，否则 ViewStyle 的
* `width` 不接受宽化后的 `string`。 */
const meterWidth = (ratio) => `${Math.max(0, Math.round(Math.max(0, Math.min(1, ratio)) * 1e3) / 10)}%`;
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
			color: props.tone === void 0 ? c.text() : toneColor(pick(props.tone)),
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
			width: meterWidth(pick(props.ratio)),
			height: 8,
			borderRadius: r.pill,
			backgroundColor: props.tone === void 0 ? c.accent() : toneColor(pick(props.tone))
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
/** 自动刷新间隔（与旧 shell 页保持一致）。 */
const REFRESH_MS = 5e3;
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
/** 取数字字段（provider 的 JSON 不保证是 number，也可能是数字字符串）。 */
function num(source, key) {
	const record = asRecord(source);
	if (record === null) return null;
	const raw = record[key];
	if (typeof raw === "number" && Number.isFinite(raw)) return raw;
	if (typeof raw === "string" && raw.trim().length > 0) {
		const parsed = Number(raw);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}
function firstNum(source, keys) {
	for (const key of keys) {
		const value = num(source, key);
		if (value !== null) return value;
	}
	return null;
}
/** `extras` 是 `[[k, v], ...]`。 */
function extrasOf(metrics) {
	const map = /* @__PURE__ */ new Map();
	const raw = metrics === null ? null : metrics.extras;
	if (!Array.isArray(raw)) return map;
	for (const item of raw) if (Array.isArray(item) && item.length >= 2) map.set(String(item[0]), String(item[1]));
	return map;
}
/** 有的宿主把指标包在 `{ metrics: … }` 里，两种形状都吃。 */
function unwrapMetrics(value) {
	const record = asRecord(value);
	if (record === null) return null;
	return asRecord(record.metrics) ?? record;
}
function clustersOf(value) {
	const record = asRecord(value);
	const raw = record !== null && Array.isArray(record.clusters) ? record.clusters : [];
	return (raw.length > 0 ? raw : Array.isArray(value) ? value : []).map((item) => asRecord(item)).filter((item) => item !== null);
}
/**
* 节点角色。契约目前只有主节点地址（clusterOverview 逐 brokerName 取主节点），
* 所以没有 role 字段时按 Master 处理；将来 provider 补了 role / broker_id 就按字段走。
*/
function roleOf(broker) {
	const text = `${str(broker, "role", "")} ${str(broker, "broker_role", "")}`.toLowerCase();
	if (text.includes("slave") || text.includes("从")) return "slave";
	if (text.includes("master") || text.includes("主")) return "master";
	const id = firstNum(broker, ["broker_id", "brokerId"]);
	if (id !== null) return id === 0 ? "master" : "slave";
	return "master";
}
/** 磁盘使用率：优先直接字段（0..1 或百分数），其次 used/total 字节。 */
function diskOf(broker) {
	const direct = firstNum(broker, [
		"disk_usage",
		"disk_usage_ratio",
		"disk_used_ratio",
		"disk_percent",
		"diskUsage"
	]);
	if (direct !== null && direct >= 0) {
		const ratio = direct > 1 ? direct / 100 : direct;
		if (ratio <= 1) return {
			ratio,
			text: `${Math.round(ratio * 100)}%`
		};
	}
	const used = firstNum(broker, ["disk_used_bytes", "disk_used"]);
	const total = firstNum(broker, [
		"disk_total_bytes",
		"disk_total",
		"disk_capacity_bytes"
	]);
	if (used !== null && total !== null && total > 0) return {
		ratio: Math.max(0, Math.min(1, used / total)),
		text: `${humanBytes(used)} / ${humanBytes(total)}`
	};
	return null;
}
function nodesOf(clusters) {
	const nodes = [];
	for (const cluster of clusters) {
		const name = str(cluster, "name", "");
		const brokers = Array.isArray(cluster.brokers) ? cluster.brokers : [];
		for (const item of brokers) {
			const broker = asRecord(item);
			if (broker === null) continue;
			const disk = diskOf(broker);
			nodes.push({
				cluster: name.length > 0 ? name : "-",
				name: str(broker, "name", ""),
				address: str(broker, "address", "-"),
				role: roleOf(broker),
				version: str(broker, "version", ""),
				diskRatio: disk === null ? null : disk.ratio,
				diskText: disk === null ? "" : disk.text
			});
		}
	}
	return nodes;
}
/** 千分位（不依赖 Intl，llrt 上不一定有完整 locale）。 */
function count(value) {
	return Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function rate(value) {
	return value.toFixed(1);
}
/** 指标卡：provider 有哪些字段就做哪些卡。 */
function metricCards(metrics) {
	const cards = [];
	const extra = extrasOf(metrics);
	const extraNum = (keys) => {
		for (const key of keys) {
			const raw = extra.get(key);
			if (raw === void 0) continue;
			const parsed = Number(raw);
			if (Number.isFinite(parsed)) return parsed;
		}
		return null;
	};
	const topics = firstNum(metrics, ["topic_count", "topicCount"]);
	if (topics !== null) cards.push({
		label: "Topic 数",
		value: count(topics),
		hint: "NameServer 已注册"
	});
	const groups = firstNum(metrics, [
		"group_count",
		"consumer_group_count",
		"groupCount"
	]) ?? extraNum(["group_count", "consumer_group_count"]);
	if (groups !== null) cards.push({
		label: "消费组数",
		value: count(groups),
		hint: "全部订阅组"
	});
	const today = firstNum(metrics, ["message_count_today", "messageCountToday"]);
	if (today !== null) cards.push({
		label: "今日消息量",
		value: count(today),
		hint: "Broker 今日写入"
	});
	const total = firstNum(metrics, ["message_count_total", "total_message_count"]) ?? extraNum(["msg_put_total", "message_count_total"]);
	if (total !== null) cards.push({
		label: "消息总量",
		value: count(total),
		hint: "累计写入"
	});
	const connections = firstNum(metrics, ["connection_count", "connectionCount"]);
	if (connections !== null) cards.push({
		label: "连接数",
		value: count(connections),
		hint: "生产者 + 消费者"
	});
	const tpsIn = firstNum(metrics, ["tps_in", "tpsIn"]);
	if (tpsIn !== null) cards.push({
		label: "入 TPS",
		value: rate(tpsIn),
		hint: "每秒写入"
	});
	const tpsOut = firstNum(metrics, ["tps_out", "tpsOut"]);
	if (tpsOut !== null) cards.push({
		label: "出 TPS",
		value: rate(tpsOut),
		hint: "每秒投递"
	});
	const lag = firstNum(metrics, [
		"lag",
		"backlog",
		"diff_total",
		"consume_lag"
	]) ?? extraNum([
		"lag",
		"backlog",
		"diff_total"
	]);
	if (lag !== null) cards.push({
		label: "堆积量",
		value: count(lag),
		hint: "消费位点落后"
	});
	return cards;
}
/** 本地时钟 `HH:mm:ss`（历史记录/更新时间用）。 */
function clock() {
	const now = /* @__PURE__ */ new Date();
	const two = (value) => String(value).padStart(2, "0");
	return `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
}
/** 状态条里的一个字段：小标题 + 值 + 可选说明。 */
function Field(props) {
	return (() => {
		const __nsh_hv0 = element("view");
		prop(__nsh_hv0, "style", {
			display: "flex",
			flexDirection: "column",
			gap: 3,
			flex: 1,
			minWidth: 120
		});
		const __nsh_hv1 = element("text");
		prop(__nsh_hv1, "numberOfLines", 1);
		bindProp(__nsh_hv1, "style", () => t.label);
		insert(__nsh_hv1, () => props.label);
		const __nsh_hv2 = element("text");
		prop(__nsh_hv2, "numberOfLines", 1);
		bindProp(__nsh_hv2, "style", () => ({
			fontSize: 14,
			fontWeight: "600",
			color: c.text(),
			fontVariant: ["tabular-nums"]
		}));
		insert(__nsh_hv2, () => props.value);
		append(__nsh_hv0, __nsh_hv1);
		append(__nsh_hv0, __nsh_hv2);
		insert(__nsh_hv0, () => props.hint === void 0 ? null : (() => {
			const __nsh_hv3 = element("text");
			prop(__nsh_hv3, "numberOfLines", 1);
			bindProp(__nsh_hv3, "style", () => t.meta);
			insert(__nsh_hv3, () => props.hint);
			return __nsh_hv3;
		})());
		return __nsh_hv0;
	})();
}
function Overview() {
	const loading = signal(true);
	const busy = signal(false);
	const error = signal(null);
	const metrics = signal(null);
	const clusters = signal([]);
	const updatedAt = signal(null);
	const auto = signal(true);
	/** 只认最后一次请求的结果，避免自动刷新与手刷互相盖掉。 */
	let sequence = 0;
	const nodes = () => nodesOf(clusters());
	const hasData = () => metrics() !== null || clusters().length > 0;
	const masterCount = () => nodes().filter((node) => node.role === "master").length;
	const slaveCount = () => nodes().filter((node) => node.role === "slave").length;
	const versions = () => {
		const unique = [];
		for (const node of nodes()) {
			if (node.version.length === 0 || unique.includes(node.version)) continue;
			unique.push(node.version);
		}
		return unique;
	};
	function load() {
		const ticket = ++sequence;
		if (!hasData()) loading.set(true);
		busy.set(true);
		error.set(null);
		return (async () => {
			try {
				const [rawMetrics, rawClusters] = await Promise.all([dispatch("metrics"), dispatch("clusterOverview")]);
				if (ticket !== sequence) return;
				metrics.set(unwrapMetrics(rawMetrics));
				clusters.set(clustersOf(rawClusters));
				updatedAt.set(clock());
			} catch (failure) {
				if (ticket !== sequence) return;
				error.set(errorMessage(failure));
			} finally {
				if (ticket === sequence) {
					loading.set(false);
					busy.set(false);
				}
			}
		})();
	}
	const timer = setInterval(() => {
		if (auto() && !busy()) load();
	}, REFRESH_MS);
	cleanup(() => clearInterval(timer));
	load();
	const statusTone = () => nodes().length > 0 ? "ok" : "warn";
	const statusLabel = () => nodes().length > 0 ? "已连接" : "无可用节点";
	const versionText = () => {
		const list = versions();
		return list.length === 0 ? "未知" : list.join(" · ");
	};
	return (() => {
		const __nsh_hv4 = element("view");
		bindProp(__nsh_hv4, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		insert(__nsh_hv4, [component(Row, {
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
								const __nsh_hv5 = element("text");
								bindProp(__nsh_hv5, "style", () => t.h1);
								const __nsh_hv6 = text("RocketMQ 概览");
								append(__nsh_hv5, __nsh_hv6);
								return __nsh_hv5;
							})(),
							component(Badge, {
								get text() {
									return statusLabel();
								},
								get tone() {
									return statusTone();
								}
							}),
							(() => {
								const __nsh_hv7 = element("text");
								bindProp(__nsh_hv7, "style", () => t.meta);
								insert(__nsh_hv7, () => updatedAt() === null ? "尚未刷新" : `更新于 ${updatedAt() ?? ""}`);
								return __nsh_hv7;
							})(),
							() => auto() ? (() => {
								const __nsh_hv8 = element("text");
								bindProp(__nsh_hv8, "style", () => t.meta);
								const __nsh_hv9 = text("· 每 5 秒自动刷新");
								append(__nsh_hv8, __nsh_hv9);
								return __nsh_hv8;
							})() : null
						];
					}
				}), component(Row, {
					gap: 6,
					get children() {
						return [component(Button, {
							get label() {
								return busy() ? "刷新中…" : "刷新";
							},
							small: true,
							onPress: () => {
								if (!busy()) load();
							}
						}), component(Button, {
							get label() {
								return auto() ? "自动刷新：开" : "自动刷新：关";
							},
							small: true,
							get tone() {
								return auto() ? "primary" : "ghost";
							},
							onPress: () => auto.set(!auto())
						})];
					}
				})];
			}
		}), () => loading() && !hasData() ? component(Loading, { label: "正在读取集群信息…" }) : error() !== null && !hasData() ? component(LoadError, {
			get message() {
				return error() ?? "";
			},
			onRetry: () => void load()
		}) : component(Stack, {
			scroll: true,
			padding: 14,
			gap: 12,
			get children() {
				return [
					() => error() === null ? null : component(Notice, {
						get message() {
							return `刷新失败：${error() ?? ""}`;
						},
						tone: "danger"
					}),
					component(Card, {
						title: "集群状态",
						get hint() {
							return `${clusters().length} 个集群 · ${nodes().length} 个 Broker`;
						},
						get children() {
							return component(Row, {
								gap: 16,
								wrap: true,
								get children() {
									return [
										component(Field, {
											label: "连接状态",
											get value() {
												return statusLabel();
											}
										}),
										component(Field, {
											label: "Broker 数",
											get value() {
												return String(nodes().length);
											}
										}),
										component(Field, {
											label: "主从分布",
											get value() {
												return `主 ${masterCount()} · 从 ${slaveCount()}`;
											},
											get hint() {
												return slaveCount() === 0 ? "provider 只上报主节点地址" : void 0;
											}
										}),
										component(Field, {
											label: "版本",
											get value() {
												return versionText();
											}
										}),
										component(Field, {
											label: "集群数",
											get value() {
												return String(clusters().length);
											}
										})
									];
								}
							});
						}
					}),
					() => metricCards(metrics()).length === 0 ? component(Notice, { message: "provider 没有返回任何指标字段。" }) : (() => {
						const __nsh_hv10 = element("view");
						prop(__nsh_hv10, "style", {
							display: "flex",
							flexDirection: "column",
							gap: 10
						});
						insert(__nsh_hv10, [component(Row, {
							gap: 10,
							style: { justifyContent: "space-between" },
							get children() {
								return [(() => {
									const __nsh_hv11 = element("text");
									bindProp(__nsh_hv11, "style", () => t.label);
									const __nsh_hv12 = text("关键指标");
									append(__nsh_hv11, __nsh_hv12);
									return __nsh_hv11;
								})(), (() => {
									const __nsh_hv13 = element("text");
									bindProp(__nsh_hv13, "style", () => t.meta);
									const __nsh_hv14 = text("按 provider 上报的字段生成");
									append(__nsh_hv13, __nsh_hv14);
									return __nsh_hv13;
								})()];
							}
						}), component(Row, {
							gap: 10,
							wrap: true,
							get children() {
								return metricCards(metrics()).map((card) => component(Stat, {
									get label() {
										return card.label;
									},
									get value() {
										return card.value;
									},
									get hint() {
										return card.hint;
									}
								}));
							}
						})]);
						return __nsh_hv10;
					})(),
					component(Card, {
						title: "集群节点",
						hint: "地址取自 NameServer 路由，磁盘使用率视 provider 上报而定",
						get children() {
							return nodes().length === 0 ? component(Empty, {
								title: "NameServer 未返回集群拓扑",
								hint: "请确认 nameserver 地址与网络可达。"
							}) : (() => {
								const __nsh_hv15 = element("view");
								prop(__nsh_hv15, "style", {
									display: "flex",
									flexDirection: "column"
								});
								insert(__nsh_hv15, [component(Row, {
									gap: 10,
									get style() {
										return {
											paddingVertical: 6,
											paddingHorizontal: 2,
											borderBottomWidth: 1,
											borderBottomColor: c.line()
										};
									},
									get children() {
										return [
											(() => {
												const __nsh_hv16 = element("text");
												prop(__nsh_hv16, "numberOfLines", 1);
												bindProp(__nsh_hv16, "style", () => [t.label, { width: 120 }]);
												const __nsh_hv17 = text("集群");
												append(__nsh_hv16, __nsh_hv17);
												return __nsh_hv16;
											})(),
											(() => {
												const __nsh_hv18 = element("text");
												prop(__nsh_hv18, "numberOfLines", 1);
												bindProp(__nsh_hv18, "style", () => [t.label, {
													flex: 1,
													minWidth: 0
												}]);
												const __nsh_hv19 = text("Broker");
												append(__nsh_hv18, __nsh_hv19);
												return __nsh_hv18;
											})(),
											(() => {
												const __nsh_hv20 = element("text");
												prop(__nsh_hv20, "numberOfLines", 1);
												bindProp(__nsh_hv20, "style", () => [t.label, { width: 180 }]);
												const __nsh_hv21 = text("地址");
												append(__nsh_hv20, __nsh_hv21);
												return __nsh_hv20;
											})(),
											(() => {
												const __nsh_hv22 = element("text");
												prop(__nsh_hv22, "numberOfLines", 1);
												bindProp(__nsh_hv22, "style", () => [t.label, { width: 76 }]);
												const __nsh_hv23 = text("角色");
												append(__nsh_hv22, __nsh_hv23);
												return __nsh_hv22;
											})(),
											(() => {
												const __nsh_hv24 = element("text");
												prop(__nsh_hv24, "numberOfLines", 1);
												bindProp(__nsh_hv24, "style", () => [t.label, { width: 110 }]);
												const __nsh_hv25 = text("版本");
												append(__nsh_hv24, __nsh_hv25);
												return __nsh_hv24;
											})(),
											(() => {
												const __nsh_hv26 = element("text");
												prop(__nsh_hv26, "numberOfLines", 1);
												bindProp(__nsh_hv26, "style", () => [t.label, { width: 180 }]);
												const __nsh_hv27 = text("磁盘使用率");
												append(__nsh_hv26, __nsh_hv27);
												return __nsh_hv26;
											})()
										];
									}
								}), () => nodes().map((node) => component(Row, {
									gap: 10,
									get style() {
										return {
											paddingVertical: 8,
											paddingHorizontal: 2,
											borderBottomWidth: 1,
											borderBottomColor: c.line()
										};
									},
									get children() {
										return [
											(() => {
												const __nsh_hv28 = element("text");
												prop(__nsh_hv28, "numberOfLines", 1);
												bindProp(__nsh_hv28, "style", () => [t.meta, { width: 120 }]);
												insert(__nsh_hv28, () => node.cluster);
												return __nsh_hv28;
											})(),
											(() => {
												const __nsh_hv29 = element("text");
												prop(__nsh_hv29, "numberOfLines", 1);
												bindProp(__nsh_hv29, "style", () => [{
													flex: 1,
													minWidth: 0,
													fontSize: 13,
													color: c.text()
												}]);
												insert(__nsh_hv29, () => node.name.length > 0 ? node.name : "<未命名>");
												return __nsh_hv29;
											})(),
											(() => {
												const __nsh_hv30 = element("text");
												prop(__nsh_hv30, "numberOfLines", 1);
												bindProp(__nsh_hv30, "style", () => [t.mono, { width: 180 }]);
												insert(__nsh_hv30, () => node.address);
												return __nsh_hv30;
											})(),
											(() => {
												const __nsh_hv31 = element("view");
												prop(__nsh_hv31, "style", { width: 76 });
												insert(__nsh_hv31, component(Badge, {
													get text() {
														return node.role === "master" ? "Master" : "Slave";
													},
													get tone() {
														return node.role === "master" ? "ok" : "info";
													}
												}));
												return __nsh_hv31;
											})(),
											(() => {
												const __nsh_hv32 = element("text");
												prop(__nsh_hv32, "numberOfLines", 1);
												bindProp(__nsh_hv32, "style", () => [t.mono, { width: 110 }]);
												insert(__nsh_hv32, () => node.version.length > 0 ? node.version : "未知");
												return __nsh_hv32;
											})(),
											(() => {
												const __nsh_hv33 = element("view");
												prop(__nsh_hv33, "style", {
													width: 180,
													display: "flex",
													flexDirection: "row",
													alignItems: "center",
													gap: 8
												});
												insert(__nsh_hv33, [() => node.diskRatio === null ? null : (() => {
													const __nsh_hv34 = element("view");
													prop(__nsh_hv34, "style", {
														flex: 1,
														minWidth: 0
													});
													insert(__nsh_hv34, component(Meter, {
														get ratio() {
															return node.diskRatio;
														},
														get tone() {
															return node.diskRatio > .9 ? "danger" : node.diskRatio > .75 ? "warn" : void 0;
														}
													}));
													return __nsh_hv34;
												})(), () => node.diskRatio === null ? (() => {
													const __nsh_hv35 = element("text");
													bindProp(__nsh_hv35, "style", () => t.meta);
													const __nsh_hv36 = text("未上报");
													append(__nsh_hv35, __nsh_hv36);
													return __nsh_hv35;
												})() : (() => {
													const __nsh_hv37 = element("text");
													prop(__nsh_hv37, "numberOfLines", 1);
													bindProp(__nsh_hv37, "style", () => [t.mono, {
														width: 56,
														textAlign: "right"
													}]);
													insert(__nsh_hv37, () => node.diskText);
													return __nsh_hv37;
												})()]);
												return __nsh_hv33;
											})()
										];
									}
								}))]);
								return __nsh_hv15;
							})();
						}
					})
				];
			}
		})]);
		return __nsh_hv4;
	})();
}
mount(Overview);

//#endregion
export { Overview as default };