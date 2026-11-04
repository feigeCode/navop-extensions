import { append, bindProp, component, cond, element, insert, prop, text } from "nsh:rt";
import { cleanup, host, mount, signal, token } from "nsh";

//#region ../../docker/ui/lib/navop.ts
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
//#region ../../docker/ui/lib/theme.ts
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
//#region ../../docker/ui/lib/ui.tsx
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
/** 可滚动的行列表：单选、悬停底色、按 key 高亮。 */
function List(props) {
	return cond(() => pick(props.items).length === 0 && props.empty !== void 0, () => () => props.empty, () => (() => {
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
		insert(__nsh_hv18, () => pick(props.items).map((item, index) => {
			const key = props.keyOf(item);
			const active = pick(props.selected ?? null) === key;
			return (() => {
				const __nsh_hv19 = element("view");
				bindProp(__nsh_hv19, "onPress", () => props.onSelect === void 0 ? void 0 : () => props.onSelect?.(key));
				bindProp(__nsh_hv19, "style", () => ({
					backgroundColor: active ? c.hover() : "transparent",
					borderBottomWidth: index === pick(props.items).length - 1 ? 0 : 1,
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
//#region ../../docker/ui/lib/format.ts
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
//#region pages/messages/App.tsx
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
const OPERATIONS$2 = {
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
function asRecord$2(value) {
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
function Field$2(props) {
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
		if (query.mode === "id") raw = await dispatch$1("queryById", { ById: {
			topic: query.topic,
			message_id: query.messageId
		} });
		else if (query.mode === "key") raw = await dispatch$1("queryByKey", { ByKey: {
			topic: query.topic,
			key: query.key
		} });
		else raw = await dispatch$1("queryByTimeWindow", { ByTimeWindow: {
			topic: query.topic,
			begin_unix_ms: query.begin,
			end_unix_ms: query.end,
			page,
			page_size: PAGE_SIZE
		} });
		const record = asRecord$2(raw);
		return {
			messages: arr(raw, "messages").map((item) => asRecord$2(item)).filter((item) => item !== null),
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
										component(Field$2, {
											label: "Topic",
											get value() {
												return topic();
											},
											onChange: (text) => topic.set(text),
											placeholder: "例如 order-topic",
											grow: true,
											onSubmit: () => void search()
										}),
										component(Field$2, {
											label: "Message Key",
											get value() {
												return key();
											},
											onChange: (text) => key.set(text),
											placeholder: "可选，用于按 Key 查",
											width: 200,
											onSubmit: () => void search()
										}),
										component(Field$2, {
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

//#endregion
//#region pages/overview/App.tsx
/** 自动刷新间隔（与旧 shell 页保持一致）。 */
const REFRESH_MS = 5e3;
/** operationId → provider 方法名。
*
* 清单里的 `resourceWorkbenches` 已经不参与运行，这一层映射留在页面里：
* 页面自己决定"要哪份数据"，宿主只负责把方法名和参数发给 provider。
*/
const OPERATIONS$1 = {
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
function asRecord$1(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value;
}
/** 取数字字段（provider 的 JSON 不保证是 number，也可能是数字字符串）。 */
function num(source, key) {
	const record = asRecord$1(source);
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
	const record = asRecord$1(value);
	if (record === null) return null;
	return asRecord$1(record.metrics) ?? record;
}
function clustersOf(value) {
	const record = asRecord$1(value);
	const raw = record !== null && Array.isArray(record.clusters) ? record.clusters : [];
	return (raw.length > 0 ? raw : Array.isArray(value) ? value : []).map((item) => asRecord$1(item)).filter((item) => item !== null);
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
			const broker = asRecord$1(item);
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
function Field$1(props) {
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
										component(Field$1, {
											label: "连接状态",
											get value() {
												return statusLabel();
											}
										}),
										component(Field$1, {
											label: "Broker 数",
											get value() {
												return String(nodes().length);
											}
										}),
										component(Field$1, {
											label: "主从分布",
											get value() {
												return `主 ${masterCount()} · 从 ${slaveCount()}`;
											},
											get hint() {
												return slaveCount() === 0 ? "provider 只上报主节点地址" : void 0;
											}
										}),
										component(Field$1, {
											label: "版本",
											get value() {
												return versionText();
											}
										}),
										component(Field$1, {
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

//#endregion
//#region pages/send-message/App.tsx
/** operationId → provider 方法名（清单里的工作台声明已不参与运行）。 */
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
/** 调一次 provider 方法。 */
async function invoke(operationId, params = {}) {
	const method = OPERATIONS[operationId];
	if (!method) throw new Error(`未知的操作：${operationId}`);
	return await invoke$1(method, params, { timeout: SLOW_TIMEOUT_MS });
}
const HISTORY_LIMIT = 20;
function jsonState(text) {
	const trimmed = text.trim();
	if (trimmed.length === 0) return "empty";
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return "bad";
	try {
		JSON.parse(trimmed);
		return "ok";
	} catch {
		return "bad";
	}
}
function nowText() {
	const date = /* @__PURE__ */ new Date();
	const pad = (value) => String(value).padStart(2, "0");
	return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function byteLength(text) {
	return new TextEncoder().encode(text).length;
}
function oneLine(text, limit = 120) {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}
function asRecord(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value;
}
function textOf(source, key) {
	const value = source[key];
	if (typeof value === "string") return value;
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return "";
}
/** 带边框的输入框，标签在上；`mono` 用于消息体。 */
function Field(props) {
	return (() => {
		const __nsh_hv0 = element("view");
		prop(__nsh_hv0, "style", {
			display: "flex",
			flexDirection: "column",
			gap: 4,
			flex: 1,
			minWidth: 0
		});
		const __nsh_hv5 = element("view");
		bindProp(__nsh_hv5, "style", () => ({
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
		const __nsh_hv6 = element("input");
		bindProp(__nsh_hv6, "testID", () => props.testID);
		bindProp(__nsh_hv6, "value", () => props.value);
		bindProp(__nsh_hv6, "placeholder", () => props.placeholder);
		prop(__nsh_hv6, "onChange", (text) => props.onChange(text));
		bindProp(__nsh_hv6, "style", () => ({
			flex: 1,
			minWidth: 0,
			fontSize: 13,
			color: c.text(),
			paddingHorizontal: 0,
			borderWidth: 0,
			backgroundColor: "transparent"
		}));
		append(__nsh_hv5, __nsh_hv6);
		append(__nsh_hv0, __nsh_hv5);
		insert(__nsh_hv0, component(Row, {
			gap: 6,
			get children() {
				return [
					(() => {
						const __nsh_hv1 = element("text");
						bindProp(__nsh_hv1, "style", () => t.label);
						insert(__nsh_hv1, () => props.label);
						return __nsh_hv1;
					})(),
					() => props.required === true ? (() => {
						const __nsh_hv2 = element("text");
						bindProp(__nsh_hv2, "style", () => ({
							fontSize: 11,
							color: c.danger()
						}));
						const __nsh_hv3 = text("必填");
						append(__nsh_hv2, __nsh_hv3);
						return __nsh_hv2;
					})() : null,
					() => props.hint === void 0 ? null : (() => {
						const __nsh_hv4 = element("text");
						bindProp(__nsh_hv4, "style", () => t.meta);
						insert(__nsh_hv4, () => props.hint);
						return __nsh_hv4;
					})()
				];
			}
		}), __nsh_hv5);
		return __nsh_hv0;
	})();
}
function SendMessage() {
	const topic = signal("");
	const tag = signal("");
	const key = signal("");
	const body = signal("");
	const sending = signal(false);
	const formError = signal(null);
	const outcome = signal(null);
	const history = signal([]);
	const seq = signal(0);
	const state = () => jsonState(body());
	function applyHistory(entry) {
		topic.set(entry.topic);
		tag.set(entry.tag);
		key.set(entry.key);
		body.set(entry.body);
		formError.set(null);
		outcome.set(null);
	}
	function pushHistory(entry) {
		const next = seq() + 1;
		seq.set(next);
		const withId = {
			...entry,
			id: `h${next}`
		};
		history.set([withId].concat(history()).slice(0, HISTORY_LIMIT));
	}
	async function send() {
		if (sending()) return;
		const topicText = topic().trim();
		if (topicText.length === 0) {
			formError.set("请先填写 Topic。");
			return;
		}
		const tagText = tag().trim();
		const keyText = key().trim();
		const bodyText = body();
		formError.set(null);
		outcome.set(null);
		sending.set(true);
		try {
			const input = { topic: topicText };
			if (tagText.length > 0) input.tag = tagText;
			if (keyText.length > 0) input.key = keyText;
			input.body = Array.from(new TextEncoder().encode(bodyText));
			const record = asRecord(await invoke("sendMessage", input));
			const messageId = record === null ? "" : textOf(record, "message_id");
			const status = record === null ? "" : textOf(record, "status");
			outcome.set({
				ok: true,
				title: "发送成功",
				detail: status.length > 0 ? `状态：${status}` : "服务端已接收",
				messageId,
				status
			});
			pushHistory({
				topic: topicText,
				tag: tagText,
				key: keyText,
				body: bodyText,
				ok: true,
				detail: messageId.length > 0 ? messageId : status,
				at: nowText()
			});
		} catch (failure) {
			const reason = errorMessage(failure);
			outcome.set({
				ok: false,
				title: "发送失败",
				detail: reason,
				messageId: "",
				status: ""
			});
			pushHistory({
				topic: topicText,
				tag: tagText,
				key: keyText,
				body: bodyText,
				ok: false,
				detail: reason,
				at: nowText()
			});
		} finally {
			sending.set(false);
		}
	}
	const stateBadge = () => {
		const current = state();
		if (current === "ok") return component(Badge, {
			text: "JSON 合法",
			tone: "ok"
		});
		if (current === "bad") return component(Badge, {
			text: "JSON 不合法",
			tone: "warn"
		});
		return component(Badge, { text: "空消息体" });
	};
	const stateHint = () => {
		const current = state();
		if (current === "ok") return "将按原始文本发送（不会重新序列化）。";
		if (current === "bad") return "不是合法 JSON，仍会按原文发送。";
		return "纯文本也可以发送；消息体为空时发送空消息。";
	};
	const resultView = () => {
		const current = outcome();
		if (current === null) return null;
		if (current.ok) return component(Notice, {
			tone: "ok",
			get message() {
				return `${current.title}${current.messageId.length > 0 ? `：${current.messageId}` : ""}`;
			}
		});
		return component(Notice, {
			tone: "danger",
			get message() {
				return `${current.title}：${current.detail}`;
			}
		});
	};
	const form = () => component(Stack, {
		scroll: true,
		padding: 14,
		gap: 12,
		get children() {
			return [
				component(Card, {
					title: "消息目标",
					hint: "Topic 必填，Tag / Key 可选",
					get children() {
						return component(Row, {
							gap: 10,
							wrap: true,
							get children() {
								return [
									component(Field, {
										label: "Topic",
										required: true,
										get value() {
											return topic();
										},
										onChange: (text) => topic.set(text),
										placeholder: "例如 order-topic",
										testID: "topic"
									}),
									component(Field, {
										label: "Tag",
										get value() {
											return tag();
										},
										onChange: (text) => tag.set(text),
										placeholder: "可选，用于消费过滤",
										testID: "tag"
									}),
									component(Field, {
										label: "Key",
										get value() {
											return key();
										},
										onChange: (text) => key.set(text),
										placeholder: "可选，业务唯一键",
										testID: "key"
									})
								];
							}
						});
					}
				}),
				component(Card, {
					title: "消息体",
					get hint() {
						return `${humanBytes(byteLength(body()))} · UTF-8 编码`;
					},
					get right() {
						return stateBadge();
					},
					get children() {
						return [(() => {
							const __nsh_hv7 = element("view");
							bindProp(__nsh_hv7, "style", () => ({
								height: 260,
								padding: 10,
								borderRadius: r.control,
								borderWidth: 1,
								borderColor: c.line(),
								backgroundColor: c.bg(),
								display: "flex",
								flexDirection: "column"
							}));
							const __nsh_hv8 = element("input");
							prop(__nsh_hv8, "testID", "body");
							prop(__nsh_hv8, "multiline", true);
							bindProp(__nsh_hv8, "value", () => body());
							prop(__nsh_hv8, "placeholder", "例如 {\"orderId\":\"A1001\",\"amount\":99.5}");
							prop(__nsh_hv8, "onChange", (text) => body.set(text));
							bindProp(__nsh_hv8, "style", () => ({
								flex: 1,
								minHeight: 0,
								fontSize: 13,
								lineHeight: 19,
								fontFamily: "monospace",
								color: c.text(),
								paddingHorizontal: 0,
								borderWidth: 0,
								backgroundColor: "transparent"
							}));
							append(__nsh_hv7, __nsh_hv8);
							return __nsh_hv7;
						})(), component(Row, {
							gap: 8,
							wrap: true,
							get children() {
								return (() => {
									const __nsh_hv9 = element("text");
									bindProp(__nsh_hv9, "style", () => t.meta);
									insert(__nsh_hv9, () => stateHint());
									return __nsh_hv9;
								})();
							}
						})];
					}
				}),
				() => formError() === null ? null : component(Notice, {
					tone: "danger",
					get message() {
						return formError() ?? "";
					}
				}),
				() => resultView(),
				component(Row, {
					gap: 8,
					style: { justifyContent: "space-between" },
					get children() {
						return [(() => {
							const __nsh_hv10 = element("text");
							bindProp(__nsh_hv10, "style", () => t.meta);
							const __nsh_hv11 = text("发送为写操作，会先请求宿主确认；正文按原样编码，不做 JSON 重排。");
							append(__nsh_hv10, __nsh_hv11);
							return __nsh_hv10;
						})(), component(Row, {
							gap: 6,
							get children() {
								return [component(Button, {
									label: "清空",
									small: true,
									tone: "ghost",
									onPress: () => {
										body.set("");
										outcome.set(null);
										formError.set(null);
									}
								}), component(Button, {
									get label() {
										return sending() ? "发送中…" : "发送";
									},
									tone: "primary",
									small: true,
									onPress: () => void send()
								})];
							}
						})];
					}
				})
			];
		}
	});
	const historyPanel = () => (() => {
		const __nsh_hv12 = element("view");
		prop(__nsh_hv12, "style", {
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column"
		});
		const __nsh_hv13 = element("view");
		bindProp(__nsh_hv13, "style", () => ({
			paddingHorizontal: 10,
			paddingVertical: 8,
			borderBottomWidth: 1,
			borderBottomColor: c.line()
		}));
		insert(__nsh_hv13, component(SectionTitle, {
			title: "本页发送历史",
			hint: `最近 ${HISTORY_LIMIT} 条 · 点击回填`,
			get right() {
				return component(Button, {
					label: "清空",
					small: true,
					tone: "ghost",
					onPress: () => {
						if (history().length === 0) return;
						history.set([]);
					}
				});
			}
		}));
		append(__nsh_hv12, __nsh_hv13);
		insert(__nsh_hv12, () => history().length === 0 ? component(Empty, {
			title: "还没有发送记录",
			hint: "发送成功或失败的消息都会留在本页，方便回填重发。"
		}) : component(List, {
			get items() {
				return history();
			},
			keyOf: (entry) => entry.id,
			onSelect: (id) => {
				const entry = history().find((item) => item.id === id);
				if (entry !== void 0) applyHistory(entry);
			},
			render: (entry) => (() => {
				const __nsh_hv14 = element("view");
				prop(__nsh_hv14, "style", {
					display: "flex",
					flexDirection: "column",
					gap: 3,
					padding: 10
				});
				const __nsh_hv17 = element("text");
				prop(__nsh_hv17, "numberOfLines", 1);
				bindProp(__nsh_hv17, "style", () => t.meta);
				const __nsh_hv18 = text(" ·");
				append(__nsh_hv17, __nsh_hv18);
				insert(__nsh_hv17, () => entry.tag.length > 0 ? `tag=${entry.tag}` : "tag=-", __nsh_hv18);
				insert(__nsh_hv17, [" ", () => entry.key.length > 0 ? `key=${entry.key}` : "key=-"]);
				const __nsh_hv19 = element("text");
				prop(__nsh_hv19, "numberOfLines", 2);
				bindProp(__nsh_hv19, "style", () => ({
					fontSize: 11,
					color: c.muted(),
					lineHeight: 15
				}));
				insert(__nsh_hv19, () => entry.body.length === 0 ? "<空消息体>" : oneLine(entry.body));
				append(__nsh_hv14, __nsh_hv17);
				append(__nsh_hv14, __nsh_hv19);
				insert(__nsh_hv14, component(Row, {
					gap: 6,
					get children() {
						return [
							(() => {
								const __nsh_hv15 = element("text");
								prop(__nsh_hv15, "numberOfLines", 1);
								bindProp(__nsh_hv15, "style", () => [t.mono, {
									flex: 1,
									minWidth: 0,
									color: c.text()
								}]);
								insert(__nsh_hv15, () => entry.topic);
								return __nsh_hv15;
							})(),
							component(Badge, {
								get text() {
									return entry.ok ? "成功" : "失败";
								},
								get tone() {
									return entry.ok ? "ok" : "danger";
								}
							}),
							(() => {
								const __nsh_hv16 = element("text");
								bindProp(__nsh_hv16, "style", () => t.meta);
								insert(__nsh_hv16, () => entry.at);
								return __nsh_hv16;
							})()
						];
					}
				}), __nsh_hv17);
				insert(__nsh_hv14, () => entry.detail.length === 0 ? null : (() => {
					const __nsh_hv20 = element("text");
					prop(__nsh_hv20, "numberOfLines", 1);
					bindProp(__nsh_hv20, "style", () => ({
						fontSize: 11,
						color: entry.ok ? c.muted() : c.danger()
					}));
					insert(__nsh_hv20, () => entry.detail);
					return __nsh_hv20;
				})());
				return __nsh_hv14;
			})()
		}));
		return __nsh_hv12;
	})();
	return (() => {
		const __nsh_hv21 = element("view");
		bindProp(__nsh_hv21, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		const __nsh_hv29 = element("view");
		prop(__nsh_hv29, "style", {
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "row"
		});
		const __nsh_hv30 = element("view");
		prop(__nsh_hv30, "style", {
			flex: 1,
			minWidth: 0,
			minHeight: 0,
			display: "flex",
			flexDirection: "column"
		});
		insert(__nsh_hv30, () => form());
		const __nsh_hv31 = element("view");
		bindProp(__nsh_hv31, "style", () => ({
			width: 320,
			flexShrink: 0,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			borderLeftWidth: 1,
			borderLeftColor: c.line()
		}));
		insert(__nsh_hv31, () => historyPanel());
		append(__nsh_hv29, __nsh_hv30);
		append(__nsh_hv29, __nsh_hv31);
		append(__nsh_hv21, __nsh_hv29);
		insert(__nsh_hv21, component(Row, {
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
								const __nsh_hv22 = element("text");
								bindProp(__nsh_hv22, "style", () => t.h1);
								const __nsh_hv23 = text("发送消息");
								append(__nsh_hv22, __nsh_hv23);
								return __nsh_hv22;
							})(),
							component(Badge, {
								text: "写操作",
								tone: "info"
							}),
							(() => {
								const __nsh_hv24 = element("text");
								bindProp(__nsh_hv24, "style", () => t.meta);
								const __nsh_hv25 = text("发送前由宿主确认");
								append(__nsh_hv24, __nsh_hv25);
								return __nsh_hv24;
							})()
						];
					}
				}), (() => {
					const __nsh_hv26 = element("text");
					bindProp(__nsh_hv26, "style", () => t.meta);
					const __nsh_hv27 = text("本页历史 ");
					const __nsh_hv28 = text(" 条");
					append(__nsh_hv26, __nsh_hv27);
					append(__nsh_hv26, __nsh_hv28);
					insert(__nsh_hv26, () => history().length, __nsh_hv28);
					return __nsh_hv26;
				})()];
			}
		}), __nsh_hv29);
		return __nsh_hv21;
	})();
}

//#endregion
//#region App.tsx
/** 默认路由：也是连接清单里 `route` 的值（打开连接先进消息查询）。 */
const DEFAULT_ROUTE = "messages";
/** 路由表。顺序就是侧栏顺序：概览 → 消息查询 → 发送消息。 */
const ROUTES = [
	{
		id: "overview",
		title: "集群概览",
		glyph: "O",
		component: Overview
	},
	{
		id: "messages",
		title: "消息查询",
		glyph: "M",
		component: Messages
	},
	{
		id: "send-message",
		title: "发送消息",
		glyph: "S",
		component: SendMessage
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
	const title = params.extension?.title ?? "RocketMQ";
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
				title: "请先打开一个 RocketMQ 连接",
				hint: "在工具箱或连接列表里打开 RocketMQ，连接成功后会显示集群概览、消息查询与发送视图。"
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