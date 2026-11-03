import { append, bindProp, component, element, insert, prop, text } from "nsh:rt";
import { host, mount, signal, token } from "nsh";

//#region ../../lib/format.ts
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
const KIND_LABEL = {
	A: "新增",
	C: "修改",
	D: "删除"
};
const KIND_LONG = {
	A: "新增（Added）",
	C: "修改（Modified）",
	D: "删除（Deleted）"
};
/** 变色标记：新增绿、修改黄、删除红。 */
function kindColor(kind) {
	if (kind === "A") return c.chart(1);
	if (kind === "D") return c.danger();
	return c.chart(4);
}
/** 变更类型归一化：数字枚举、单字母、英文长名都能认。 */
function kindOf(change) {
	const raw = change.Kind ?? change.kind;
	if (typeof raw === "number") {
		if (raw === 1) return "A";
		if (raw === 2) return "D";
		return "C";
	}
	const text = String(raw ?? "").trim().toUpperCase();
	if (text === "A" || text.startsWith("ADD")) return "A";
	if (text === "D" || text.startsWith("DEL") || text.startsWith("REM")) return "D";
	if (text === "C" || text.startsWith("MOD") || text.startsWith("CHA")) return "C";
	return "C";
}
function pathOf(change) {
	const value = change.Path ?? change.path;
	return typeof value === "string" && value.length > 0 ? value : str(change, "Path", "-");
}
/** `/usr/lib/x.so` → 末段 + 目录，长路径靠 numberOfLines 省略。 */
function splitPath(path) {
	const trimmed = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
	const index = trimmed.lastIndexOf("/");
	if (index < 0) return {
		name: trimmed,
		dir: ""
	};
	const name = trimmed.slice(index + 1);
	const dir = trimmed.slice(0, index);
	return {
		name: name.length > 0 ? name : "/",
		dir: dir.length > 0 ? dir : "/"
	};
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
function Changes() {
	const changes = signal([]);
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
	function countOf(kind) {
		return changes().filter((change) => kindOf(change) === kind).length;
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
		changes.set([]);
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
		const mine = ++seq;
		busy.set(true);
		if (changes().length === 0) loading.set(true);
		try {
			const result = await call("docker/container/diff", { id });
			if (mine !== seq) return;
			const list = Array.isArray(result) ? result : arr(result, "changes");
			changes.set(list);
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
	}
	function selectedChange() {
		const index = selected();
		if (index === null) return null;
		const change = changes()[index];
		if (change === void 0) return null;
		return {
			change,
			kind: kindOf(change)
		};
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
	function changeRow(change, index) {
		const kind = kindOf(change);
		const parts = splitPath(pathOf(change));
		const color = kindColor(kind);
		return (() => {
			const __nsh_hv16 = element("view");
			prop(__nsh_hv16, "onPress", () => selected.set(selected() === index ? null : index));
			bindProp(__nsh_hv16, "style", () => ({
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				gap: 10,
				paddingHorizontal: 12,
				paddingVertical: 7,
				backgroundColor: selected() === index ? c.hover() : "transparent",
				borderBottomWidth: 1,
				borderBottomColor: c.line()
			}));
			const __nsh_hv17 = element("view");
			bindProp(__nsh_hv17, "style", () => ({
				width: 20,
				height: 20,
				flexShrink: 0,
				borderRadius: r.chip,
				borderWidth: 1,
				borderColor: color,
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				justifyContent: "center"
			}));
			const __nsh_hv18 = element("text");
			prop(__nsh_hv18, "style", {
				fontSize: 11,
				fontWeight: "600",
				color
			});
			insert(__nsh_hv18, kind);
			append(__nsh_hv17, __nsh_hv18);
			const __nsh_hv19 = element("view");
			prop(__nsh_hv19, "style", {
				display: "flex",
				flexDirection: "column",
				gap: 2,
				flex: 1,
				minWidth: 0
			});
			const __nsh_hv20 = element("text");
			prop(__nsh_hv20, "numberOfLines", 1);
			bindProp(__nsh_hv20, "style", () => t.mono);
			insert(__nsh_hv20, () => parts.name);
			append(__nsh_hv19, __nsh_hv20);
			insert(__nsh_hv19, () => parts.dir.length === 0 ? null : (() => {
				const __nsh_hv21 = element("text");
				prop(__nsh_hv21, "numberOfLines", 1);
				bindProp(__nsh_hv21, "style", () => ({
					fontSize: 11,
					color: c.muted()
				}));
				insert(__nsh_hv21, () => parts.dir);
				return __nsh_hv21;
			})());
			const __nsh_hv22 = element("text");
			bindProp(__nsh_hv22, "style", () => ({
				...t.meta,
				width: 36,
				textAlign: "right",
				flexShrink: 0
			}));
			insert(__nsh_hv22, () => KIND_LABEL[kind]);
			append(__nsh_hv16, __nsh_hv17);
			append(__nsh_hv16, __nsh_hv19);
			append(__nsh_hv16, __nsh_hv22);
			return __nsh_hv16;
		})();
	}
	function detailBar() {
		const picked = selectedChange();
		if (picked === null) return (() => {
			const __nsh_hv23 = element("view");
			bindProp(__nsh_hv23, "style", () => ({
				paddingHorizontal: 12,
				paddingVertical: 7,
				borderTopWidth: 1,
				borderTopColor: c.line(),
				backgroundColor: c.panel(),
				flexShrink: 0
			}));
			const __nsh_hv24 = element("text");
			prop(__nsh_hv24, "numberOfLines", 1);
			bindProp(__nsh_hv24, "style", () => t.meta);
			const __nsh_hv25 = text("点击任意一行查看完整路径；docker diff 只比较容器可写层。");
			append(__nsh_hv24, __nsh_hv25);
			append(__nsh_hv23, __nsh_hv24);
			return __nsh_hv23;
		})();
		return (() => {
			const __nsh_hv26 = element("view");
			bindProp(__nsh_hv26, "style", () => ({
				paddingHorizontal: 12,
				paddingVertical: 8,
				borderTopWidth: 1,
				borderTopColor: c.line(),
				backgroundColor: c.panel(),
				display: "flex",
				flexDirection: "column",
				gap: 4,
				flexShrink: 0
			}));
			const __nsh_hv30 = element("text");
			prop(__nsh_hv30, "numberOfLines", 3);
			bindProp(__nsh_hv30, "style", () => t.mono);
			insert(__nsh_hv30, () => pathOf(picked.change));
			append(__nsh_hv26, __nsh_hv30);
			insert(__nsh_hv26, component(Row, {
				gap: 8,
				style: { justifyContent: "space-between" },
				get children() {
					return [(() => {
						const __nsh_hv27 = element("text");
						bindProp(__nsh_hv27, "style", () => t.label);
						const __nsh_hv28 = text("完整路径");
						append(__nsh_hv27, __nsh_hv28);
						return __nsh_hv27;
					})(), (() => {
						const __nsh_hv29 = element("text");
						bindProp(__nsh_hv29, "style", () => ({
							...t.meta,
							color: kindColor(picked.kind)
						}));
						insert(__nsh_hv29, () => KIND_LONG[picked.kind]);
						return __nsh_hv29;
					})()];
				}
			}), __nsh_hv30);
			return __nsh_hv26;
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
				return `连接里有 ${containers().length} 个容器：在上方列表里点一个，页面会读取它的文件变更。`;
			}
		});
	}
	function body() {
		if (selectedId() === null) return selectionGate();
		if (loading() && changes().length === 0) return component(Loading, { label: "正在读取容器文件变更…" });
		if (error() !== null && changes().length === 0) return component(LoadError, {
			get message() {
				return error() ?? "";
			},
			onRetry: () => void load()
		});
		if (changes().length === 0) return component(Empty, {
			title: "可写层没有文件变更",
			hint: "容器启动后没有新增、修改或删除文件；docker diff 只比较容器可写层，不包含镜像层。",
			get action() {
				return component(Button, {
					label: "重新读取",
					small: true,
					onPress: () => void load()
				});
			}
		});
		return (() => {
			const __nsh_hv31 = element("view");
			prop(__nsh_hv31, "style", {
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "column"
			});
			const __nsh_hv33 = element("scroll");
			prop(__nsh_hv33, "style", {
				flex: 1,
				minHeight: 0
			});
			const __nsh_hv34 = element("view");
			prop(__nsh_hv34, "style", {
				display: "flex",
				flexDirection: "column"
			});
			insert(__nsh_hv34, () => changes().map((change, index) => changeRow(change, index)));
			append(__nsh_hv33, __nsh_hv34);
			append(__nsh_hv31, __nsh_hv33);
			insert(__nsh_hv31, () => error() === null ? null : (() => {
				const __nsh_hv32 = element("view");
				prop(__nsh_hv32, "style", {
					paddingHorizontal: 12,
					paddingTop: 8
				});
				insert(__nsh_hv32, component(Notice, { get message() {
					return `刷新失败：${error() ?? ""}`;
				} }));
				return __nsh_hv32;
			})(), __nsh_hv33);
			insert(__nsh_hv31, () => detailBar());
			return __nsh_hv31;
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
							const __nsh_hv35 = element("text");
							bindProp(__nsh_hv35, "style", () => t.h1);
							const __nsh_hv36 = text("文件变更");
							append(__nsh_hv35, __nsh_hv36);
							return __nsh_hv35;
						})(), () => selectedId() === null ? (() => {
							const __nsh_hv37 = element("text");
							bindProp(__nsh_hv37, "style", () => t.meta);
							const __nsh_hv38 = text("未选择容器");
							append(__nsh_hv37, __nsh_hv38);
							return __nsh_hv37;
						})() : [
							(() => {
								const __nsh_hv39 = element("text");
								bindProp(__nsh_hv39, "style", () => t.meta);
								insert(__nsh_hv39, () => `${changes().length} 项`);
								return __nsh_hv39;
							})(),
							component(Badge, {
								get text() {
									return `新增 ${countOf("A")}`;
								},
								tone: "ok"
							}),
							component(Badge, {
								get text() {
									return `修改 ${countOf("C")}`;
								},
								tone: "warn"
							}),
							component(Badge, {
								get text() {
									return `删除 ${countOf("D")}`;
								},
								tone: "danger"
							})
						]];
					}
				}), component(Row, {
					gap: 6,
					get children() {
						return [() => busy() ? (() => {
							const __nsh_hv40 = element("text");
							bindProp(__nsh_hv40, "style", () => t.meta);
							const __nsh_hv41 = text("正在读取…");
							append(__nsh_hv40, __nsh_hv41);
							return __nsh_hv40;
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
		const __nsh_hv42 = element("view");
		bindProp(__nsh_hv42, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		const __nsh_hv43 = element("view");
		bindProp(__nsh_hv43, "style", () => hairline());
		append(__nsh_hv42, __nsh_hv43);
		insert(__nsh_hv42, () => toolbar(), __nsh_hv43);
		insert(__nsh_hv42, [() => containerBar(), () => body()]);
		return __nsh_hv42;
	})();
}
mount(Changes);

//#endregion
export { Changes as default };