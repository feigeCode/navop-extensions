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
const toneColor = (tone) => {
	switch (tone) {
		case "ok": return c.chart(1);
		case "warn": return c.chart(4);
		case "danger": return c.danger();
		case "info": return c.chart(0);
		default: return c.muted();
	}
};
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
			color: props.tone === void 0 ? c.muted() : toneColor(props.tone)
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
/** 调一次工作台操作；把 provider 的失败折成一句人话。 */
async function dispatch(operationId, input) {
	try {
		return await host.call("navop.workbench.dispatch", {
			operationId,
			input: input ?? {}
		});
	} catch (error) {
		throw new Error(errorMessage(error));
	}
}
function Processes() {
	const rows = signal([]);
	const titles = signal([]);
	const stats = signal(null);
	const loading = signal(true);
	const error = signal(null);
	const busy = signal(false);
	const selected = signal(null);
	async function load() {
		if (busy()) return;
		busy.set(true);
		if (rows().length === 0) loading.set(true);
		try {
			const result = await dispatch("containerTop");
			const list = Array.isArray(result) ? result : arr(result, "processes");
			const names = Array.isArray(result) ? [] : arr(result, "titles").map(String);
			rows.set(list);
			titles.set(names.length > 0 ? names : inferTitles(list));
			error.set(null);
			if (selected() !== null && selected() >= list.length) selected.set(null);
		} catch (failure) {
			error.set(errorMessage(failure));
		} finally {
			loading.set(false);
			busy.set(false);
		}
		loadStats();
	}
	/** 顺带取一次容器整体占用，失败不影响进程表。 */
	async function loadStats() {
		try {
			const result = await dispatch("containerStats");
			stats.set(result ?? null);
		} catch {
			stats.set(null);
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
					const __nsh_hv0 = element("text");
					prop(__nsh_hv0, "numberOfLines", 1);
					bindProp(__nsh_hv0, "style", () => ({
						...t.label,
						...cellStyle(title)
					}));
					insert(__nsh_hv0, title);
					return __nsh_hv0;
				})());
			}
		});
	}
	function tableRow(row, names, index) {
		return (() => {
			const __nsh_hv1 = element("view");
			prop(__nsh_hv1, "onPress", () => selected.set(selected() === index ? null : index));
			bindProp(__nsh_hv1, "style", () => ({
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
			insert(__nsh_hv1, () => names.map((title) => {
				const style = NUMERIC.includes(title) ? {
					...t.mono,
					...cellStyle(title)
				} : {
					fontSize: 12,
					color: c.text(),
					...cellStyle(title)
				};
				return (() => {
					const __nsh_hv2 = element("text");
					prop(__nsh_hv2, "numberOfLines", 1);
					prop(__nsh_hv2, "style", style);
					insert(__nsh_hv2, () => cell(row, names, title));
					return __nsh_hv2;
				})();
			}));
			return __nsh_hv1;
		})();
	}
	function footer() {
		const command = selectedCommand();
		return (() => {
			const __nsh_hv3 = element("view");
			bindProp(__nsh_hv3, "style", () => ({
				paddingHorizontal: 12,
				paddingVertical: 7,
				borderTopWidth: 1,
				borderTopColor: c.line(),
				backgroundColor: c.panel(),
				flexShrink: 0
			}));
			insert(__nsh_hv3, () => command === null ? (() => {
				const __nsh_hv4 = element("text");
				prop(__nsh_hv4, "numberOfLines", 1);
				bindProp(__nsh_hv4, "style", () => t.meta);
				insert(__nsh_hv4, () => `${titles().length} 列来自 ps -ef；单进程 CPU / 内存不在 ps -ef 输出里，工具条显示的是容器整体占用。`);
				return __nsh_hv4;
			})() : (() => {
				const __nsh_hv5 = element("text");
				prop(__nsh_hv5, "numberOfLines", 2);
				bindProp(__nsh_hv5, "style", () => t.mono);
				insert(__nsh_hv5, command);
				return __nsh_hv5;
			})());
			return __nsh_hv3;
		})();
	}
	function body() {
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
			const __nsh_hv6 = element("view");
			prop(__nsh_hv6, "style", {
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "column"
			});
			const __nsh_hv8 = element("scroll");
			prop(__nsh_hv8, "style", {
				flex: 1,
				minHeight: 0
			});
			insert(__nsh_hv8, () => rows().map((row, index) => tableRow(row, titles(), index)));
			append(__nsh_hv6, __nsh_hv8);
			insert(__nsh_hv6, [() => error() === null ? null : (() => {
				const __nsh_hv7 = element("view");
				prop(__nsh_hv7, "style", {
					paddingHorizontal: 12,
					paddingTop: 8
				});
				insert(__nsh_hv7, component(Notice, { get message() {
					return `刷新失败：${error() ?? ""}`;
				} }));
				return __nsh_hv7;
			})(), () => tableHeader()], __nsh_hv8);
			insert(__nsh_hv6, () => footer());
			return __nsh_hv6;
		})();
	}
	load();
	return (() => {
		const __nsh_hv9 = element("view");
		bindProp(__nsh_hv9, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		const __nsh_hv16 = element("view");
		bindProp(__nsh_hv16, "style", () => hairline());
		append(__nsh_hv9, __nsh_hv16);
		insert(__nsh_hv9, component(Row, {
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
								const __nsh_hv10 = element("text");
								bindProp(__nsh_hv10, "style", () => t.h1);
								const __nsh_hv11 = text("进程");
								append(__nsh_hv10, __nsh_hv11);
								return __nsh_hv10;
							})(),
							(() => {
								const __nsh_hv12 = element("text");
								bindProp(__nsh_hv12, "style", () => t.meta);
								insert(__nsh_hv12, () => `${rows().length} 个进程`);
								return __nsh_hv12;
							})(),
							(() => {
								const __nsh_hv13 = element("text");
								bindProp(__nsh_hv13, "style", () => t.meta);
								insert(__nsh_hv13, () => statsLine());
								return __nsh_hv13;
							})()
						];
					}
				}), component(Row, {
					gap: 6,
					get children() {
						return [() => busy() ? (() => {
							const __nsh_hv14 = element("text");
							bindProp(__nsh_hv14, "style", () => t.meta);
							const __nsh_hv15 = text("正在读取…");
							append(__nsh_hv14, __nsh_hv15);
							return __nsh_hv14;
						})() : null, component(Button, {
							label: "刷新",
							small: true,
							onPress: () => void load()
						})];
					}
				})];
			}
		}), __nsh_hv16);
		insert(__nsh_hv9, () => body());
		return __nsh_hv9;
	})();
}
mount(Processes);

//#endregion
export { Processes as default };