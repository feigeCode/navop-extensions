import { append, bindProp, component, element, insert, prop, text } from "nsh:rt";
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
		return containers().filter((row) => `${containerName(row)} ${containerImage(row)}`.toLowerCase().includes(needle));
	}
	function selectedSummary() {
		const id = selectedId();
		if (id === null) return "";
		const row = containers().find((item) => containerId(item) === id);
		return row === void 0 ? selectedName() : `${containerName(row)} · ${containerImage(row)}`;
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
	async function load() {
		const id = selectedId();
		if (id === null) return;
		const mine = ++seq;
		busy.set(true);
		if (rows().length === 0) loading.set(true);
		try {
			const result = await call("docker/container/top", { id });
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
			const result = await call("docker/container/stats", { id });
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
mount(Processes);

//#endregion
export { Processes as default };