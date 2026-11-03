import { append, bindProp, component, cond, element, insert, prop, text } from "nsh:rt";
import { cleanup, host, mount, signal, token } from "nsh";

//#region ../../../../docker/ui/lib/format.ts
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
/** 采样间隔：provider 只给累计值，速率只能靠两次采样的差值算。 */
const REFRESH_MS = 2e3;
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
			const [metricsResult, clientsResult] = await Promise.all([dispatch("metrics"), dispatch("listClients")]);
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
mount(Overview);

//#endregion
export { Overview as default };