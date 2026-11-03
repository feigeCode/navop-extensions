import { append, bindProp, component, cond, element, insert, prop, text } from "nsh:rt";
import { host, mount, signal, token } from "nsh";

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
/** 0..1 的比例，用于进度条宽度；越界会被夹紧。 */
function ratio(part, total) {
	const value = Number(part);
	const whole = Number(total);
	if (!Number.isFinite(value) || !Number.isFinite(whole) || whole <= 0) return 0;
	return Math.max(0, Math.min(1, value / whole));
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
//#region ../../lib/ui.tsx
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
function stateTone(state) {
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
			const result = await call("docker/container/list", {});
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
			const result = await call("docker/container/stats", { id });
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
					return stateTone(state);
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
mount(ContainerStats);

//#endregion
export { ContainerStats as default };