import { append, bindProp, component, cond, element, insert, prop, text } from "nsh:rt";
import { computed, host, mount, signal, token } from "nsh";

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
			color: props.tone === void 0 ? c.muted() : toneColor(pick(props.tone))
		}));
		insert(__nsh_hv48, () => props.message);
		return __nsh_hv48;
	})();
}

//#endregion
//#region App.tsx
/** operationId → provider 方法名。
*
* 清单里的 `resourceWorkbenches` 已经不参与运行，这一层映射留在页面里：
* 页面自己决定"要哪份数据"，宿主只负责把方法名和参数发给 provider。
*/
const OPERATIONS = {
	containerCreate: "docker/container/create",
	containerDiff: "docker/container/diff",
	containerFilesDelete: "docker/container/files/delete",
	containerFilesList: "docker/container/files/list",
	containerKill: "docker/container/kill",
	containerLogs: "docker/container/logs",
	containerLogsWithTail: "docker/container/logs",
	containerMounts: "docker/container/mounts",
	containerPause: "docker/container/pause",
	containerRename: "docker/container/rename",
	containerStats: "docker/container/stats",
	containerTop: "docker/container/top",
	containerUnpause: "docker/container/unpause",
	containerUpdate: "docker/container/update",
	imageHistory: "docker/image/history",
	imageHistoryByRef: "docker/image/history",
	imageInspect: "docker/image/inspect",
	imageInspectByRef: "docker/image/inspect",
	imagePrune: "docker/image/prune",
	imageRemoveByRef: "docker/image/remove",
	imageTag: "docker/image/tag",
	imageTagByRef: "docker/image/tag",
	inspectContainer: "docker/container/inspect",
	inspectNetwork: "docker/network/inspect",
	inspectVolume: "docker/volume/inspect",
	listContainers: "docker/container/list",
	listImages: "docker/image/list",
	listNetworks: "docker/network/list",
	listVolumes: "docker/volume/list",
	networkConnect: "docker/network/connect",
	networkCreate: "docker/network/create",
	networkDisconnect: "docker/network/disconnect",
	networkInspectById: "docker/network/inspect",
	networkPrune: "docker/network/prune",
	networkRemoveById: "docker/network/remove",
	pullImage: "docker/image/pull",
	removeContainer: "docker/container/remove",
	removeImage: "docker/image/remove",
	removeNetwork: "docker/network/remove",
	removeVolume: "docker/volume/remove",
	restartContainer: "docker/container/restart",
	startContainer: "docker/container/start",
	stopContainer: "docker/container/stop",
	systemInfo: "docker/system/info",
	systemPrune: "docker/system/prune",
	systemUsage: "docker/system/usage",
	volumeCreate: "docker/volume/create",
	volumeInspectByName: "docker/volume/inspect",
	volumePrune: "docker/volume/prune",
	volumeRemoveByName: "docker/volume/remove"
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
/** 键值对象 → KeyValue 的行；数组也展开成一行一项。 */
function rowsOf(source) {
	if (!source || typeof source !== "object") return [];
	return Object.entries(source).filter(([, value]) => value !== null && value !== void 0).map(([key, value]) => {
		return [key, (typeof value === "string" ? value : Array.isArray(value) ? value.map(String).join(", ") : JSON.stringify(value)) ?? String(value)];
	});
}
/** 单行输入框。SearchField 带放大镜，名称 / 驱动字段用它不合适。 */
function Field(props) {
	return (() => {
		const __nsh_hv0 = element("view");
		bindProp(__nsh_hv0, "style", () => ({
			flexDirection: "row",
			alignItems: "center",
			height: 28,
			width: props.width ?? 200,
			paddingHorizontal: 9,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: c.line(),
			backgroundColor: c.bg()
		}));
		const __nsh_hv1 = element("input");
		bindProp(__nsh_hv1, "value", () => props.value);
		bindProp(__nsh_hv1, "placeholder", () => props.placeholder ?? "");
		prop(__nsh_hv1, "onChange", (text) => props.onChange(text));
		prop(__nsh_hv1, "onSubmit", () => props.onSubmit?.());
		prop(__nsh_hv1, "style", {
			flex: 1,
			fontSize: 12,
			paddingHorizontal: 0,
			borderWidth: 0,
			backgroundColor: "transparent"
		});
		append(__nsh_hv0, __nsh_hv1);
		return __nsh_hv0;
	})();
}
function Volumes() {
	const volumes = signal([]);
	const loading = signal(true);
	const error = signal(null);
	const notice = signal(null);
	const filter = signal("");
	const selected = signal(null);
	const detail = signal(null);
	const detailLoading = signal(false);
	const detailError = signal(null);
	const createOpen = signal(false);
	const createName = signal("");
	const createDriver = signal("local");
	const busy = signal(false);
	const pendingRemove = signal(null);
	const pendingPrune = signal(false);
	const firstLoad = computed(() => loading() && volumes().length === 0 && error() === null);
	const firstError = computed(() => error() !== null && volumes().length === 0);
	const selectedVolume = () => volumes().find((volume) => str(volume, "name") === selected()) ?? null;
	const visible = () => {
		const needle = filter().trim().toLowerCase();
		if (needle.length === 0) return volumes();
		return volumes().filter((volume) => {
			return [
				str(volume, "name", ""),
				str(volume, "driver", ""),
				str(volume, "mountpoint", "")
			].join(" ").toLowerCase().includes(needle);
		});
	};
	async function loadDetail(target) {
		detailLoading.set(true);
		detailError.set(null);
		try {
			const info = await dispatch("volumeInspectByName", { name: target });
			if (selected() !== target) return;
			detail.set(info ?? null);
		} catch (failure) {
			if (selected() !== target) return;
			detail.set(null);
			detailError.set(errorMessage(failure));
		} finally {
			if (selected() === target) detailLoading.set(false);
		}
	}
	async function load() {
		loading.set(true);
		try {
			const result = await dispatch("listVolumes");
			const list = Array.isArray(result) ? result : arr(result, "volumes");
			volumes.set(list);
			error.set(null);
			const target = selected();
			if (!list.some((volume) => str(volume, "name") === target)) {
				const first = list.length > 0 ? str(list[0], "name", "") : "";
				selected.set(first.length > 0 ? first : null);
				detail.set(null);
			}
		} catch (failure) {
			error.set(errorMessage(failure));
		} finally {
			loading.set(false);
		}
		const target = selected();
		if (target !== null) loadDetail(target);
	}
	function select(target) {
		if (selected() === target) return;
		selected.set(target);
		detail.set(null);
		detailError.set(null);
		pendingRemove.set(null);
		loadDetail(target);
	}
	async function create() {
		const name = createName().trim();
		const driver = createDriver().trim() || "local";
		if (name.length === 0) {
			notice.set("请先填存储卷名称");
			return;
		}
		busy.set(true);
		try {
			const created = await dispatch("volumeCreate", {
				name,
				driver
			}, true);
			createOpen.set(false);
			createName.set("");
			createDriver.set("local");
			selected.set(str(created, "Name", name));
			await load();
			notice.set(`已创建存储卷 ${name}`);
		} catch (failure) {
			notice.set(errorMessage(failure));
		} finally {
			busy.set(false);
		}
	}
	async function remove() {
		const target = pendingRemove();
		if (target === null || target.length === 0) return;
		busy.set(true);
		try {
			await dispatch("volumeRemoveByName", { name: target }, true);
			pendingRemove.set(null);
			if (selected() === target) selected.set(null);
			await load();
			notice.set(`已删除存储卷 ${target}`);
		} catch (failure) {
			notice.set(errorMessage(failure));
		} finally {
			busy.set(false);
		}
	}
	async function prune() {
		busy.set(true);
		try {
			const result = await dispatch("volumePrune", {}, true);
			const deleted = arr(result, "deleted").length;
			const reclaimed = Number(result?.space_reclaimed_bytes ?? 0);
			pendingPrune.set(false);
			await load();
			notice.set(deleted === 0 ? "没有可清理的未使用存储卷" : `已清理 ${deleted} 个未使用存储卷${Number.isFinite(reclaimed) && reclaimed > 0 ? `，回收 ${humanBytes(reclaimed)}` : ""}`);
		} catch (failure) {
			notice.set(errorMessage(failure));
		} finally {
			busy.set(false);
		}
	}
	load();
	function listPane() {
		return (() => {
			const __nsh_hv2 = element("view");
			bindProp(__nsh_hv2, "style", () => ({
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "column",
				backgroundColor: c.panel()
			}));
			insert(__nsh_hv2, () => visible().length === 0 ? component(Empty, {
				get title() {
					return filter().trim().length === 0 ? "还没有存储卷" : "没有匹配的存储卷";
				},
				get hint() {
					return filter().trim().length === 0 ? "点右上角「新建存储卷」创建一个；容器挂载匿名卷后刷新也能看到。" : "清空搜索词，或换一个名称 / 驱动 / 挂载点再试。";
				}
			}) : component(List, {
				get items() {
					return visible();
				},
				keyOf: (volume) => str(volume, "name", ""),
				get selected() {
					return selected();
				},
				onSelect: select,
				render: (volume) => component(ListRow, {
					get title() {
						return str(volume, "name");
					},
					get subtitle() {
						return str(volume, "mountpoint", "-");
					},
					get trailing() {
						return (() => {
							const __nsh_hv3 = element("view");
							prop(__nsh_hv3, "style", {
								display: "flex",
								flexDirection: "column",
								alignItems: "flex-end",
								gap: 2
							});
							const __nsh_hv4 = element("text");
							bindProp(__nsh_hv4, "style", () => ({
								...t.mono,
								fontSize: 11
							}));
							insert(__nsh_hv4, () => str(volume, "size"));
							const __nsh_hv5 = element("text");
							bindProp(__nsh_hv5, "style", () => t.meta);
							insert(__nsh_hv5, () => str(volume, "driver"));
							append(__nsh_hv3, __nsh_hv4);
							append(__nsh_hv3, __nsh_hv5);
							return __nsh_hv3;
						})();
					}
				})
			}));
			return __nsh_hv2;
		})();
	}
	function detailPane() {
		const volume = selectedVolume();
		if (volume === null) return component(Empty, {
			title: "选择左侧的存储卷",
			hint: "选中后可以查看驱动、挂载点与标签，并删除这个卷。"
		});
		const name = str(volume, "name");
		const info = detail();
		const labels = rowsOf(info?.Labels);
		const options = rowsOf(info?.Options);
		const status = arr(info, "Status").map(String);
		const refs = Number(volume.ref_count);
		const scope = str(info ?? volume, "Scope", str(volume, "scope"));
		const driver = str(info ?? volume, "Driver", str(volume, "driver"));
		const mountpoint = str(info ?? volume, "Mountpoint", str(volume, "mountpoint", "-"));
		return component(Stack, {
			scroll: true,
			padding: 14,
			gap: 12,
			get children() {
				return [
					component(Row, {
						style: {
							justifyContent: "space-between",
							alignItems: "flex-start",
							gap: 12
						},
						get children() {
							return [(() => {
								const __nsh_hv6 = element("view");
								prop(__nsh_hv6, "style", {
									display: "flex",
									flexDirection: "column",
									gap: 3,
									flex: 1,
									minWidth: 0
								});
								const __nsh_hv7 = element("text");
								prop(__nsh_hv7, "numberOfLines", 1);
								bindProp(__nsh_hv7, "style", () => ({
									fontSize: 15,
									fontWeight: "600",
									color: c.text()
								}));
								insert(__nsh_hv7, name);
								const __nsh_hv8 = element("text");
								prop(__nsh_hv8, "numberOfLines", 1);
								bindProp(__nsh_hv8, "style", () => t.meta);
								insert(__nsh_hv8, () => `${driver} · ${scope} · ${str(volume, "size")}`);
								append(__nsh_hv6, __nsh_hv7);
								append(__nsh_hv6, __nsh_hv8);
								return __nsh_hv6;
							})(), component(Button, {
								label: "删除存储卷",
								tone: "danger",
								small: true,
								get disabled() {
									return busy();
								},
								onPress: () => {
									pendingPrune.set(false);
									pendingRemove.set(name);
								}
							})];
						}
					}),
					() => pendingRemove() === name ? component(ConfirmBar, {
						message: `删除存储卷 ${name}？卷里的数据会一并删除，无法恢复。`,
						confirmLabel: "删除",
						get busy() {
							return busy();
						},
						onConfirm: () => void remove(),
						onCancel: () => pendingRemove.set(null)
					}) : null,
					() => detailError() === null ? null : component(Row, {
						gap: 8,
						get children() {
							return [(() => {
								const __nsh_hv9 = element("view");
								prop(__nsh_hv9, "style", {
									flex: 1,
									minWidth: 0
								});
								insert(__nsh_hv9, component(Notice, {
									get message() {
										return `读取详情失败：${detailError()}`;
									},
									tone: "danger"
								}));
								return __nsh_hv9;
							})(), component(Button, {
								label: "重试",
								small: true,
								onPress: () => void loadDetail(name)
							})];
						}
					}),
					component(Card, {
						title: "概览",
						get hint() {
							return detailLoading() ? "读取中…" : void 0;
						},
						get children() {
							return component(KeyValue, { get rows() {
								return [
									["名称", name],
									["驱动", driver],
									["Scope", scope],
									["大小", str(volume, "size")],
									["引用容器", Number.isFinite(refs) && refs >= 0 ? String(refs) : "-"],
									["创建时间", shortTime(str(info, "CreatedAt", ""))],
									["挂载点", mountpoint]
								];
							} });
						}
					}),
					component(Card, {
						title: "标签",
						get hint() {
							return labels.length === 0 ? "无" : `${labels.length} 项`;
						},
						get children() {
							return labels.length === 0 ? (() => {
								const __nsh_hv10 = element("text");
								bindProp(__nsh_hv10, "style", () => t.meta);
								const __nsh_hv11 = text("这个存储卷没有设置标签。");
								append(__nsh_hv10, __nsh_hv11);
								return __nsh_hv10;
							})() : component(KeyValue, { rows: labels });
						}
					}),
					() => options.length === 0 ? null : component(Card, {
						title: "驱动选项",
						get children() {
							return component(KeyValue, { rows: options });
						}
					}),
					() => status.length === 0 ? null : component(Card, {
						title: "状态",
						get children() {
							return (() => {
								const __nsh_hv12 = element("text");
								bindProp(__nsh_hv12, "style", () => t.meta);
								insert(__nsh_hv12, () => status.join(" · "));
								return __nsh_hv12;
							})();
						}
					})
				];
			}
		});
	}
	return (() => {
		const __nsh_hv13 = element("view");
		bindProp(__nsh_hv13, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		insert(__nsh_hv13, [
			component(Row, {
				wrap: true,
				gap: 8,
				style: {
					paddingHorizontal: 14,
					paddingVertical: 10,
					justifyContent: "space-between"
				},
				get children() {
					return [component(Row, {
						gap: 8,
						get children() {
							return [
								(() => {
									const __nsh_hv14 = element("text");
									bindProp(__nsh_hv14, "style", () => t.h1);
									const __nsh_hv15 = text("存储卷");
									append(__nsh_hv14, __nsh_hv15);
									return __nsh_hv14;
								})(),
								component(Badge, { get text() {
									return `${volumes().length} 个`;
								} }),
								component(SearchField, {
									get value() {
										return filter();
									},
									onChange: (value) => filter.set(value),
									placeholder: "按名称 / 驱动 / 挂载点过滤"
								})
							];
						}
					}), component(Row, {
						gap: 6,
						get children() {
							return [
								component(Button, {
									label: "刷新",
									small: true,
									onPress: () => void load()
								}),
								component(Button, {
									get label() {
										return createOpen() ? "取消新建" : "新建存储卷";
									},
									small: true,
									onPress: () => createOpen.set(!createOpen())
								}),
								component(Button, {
									label: "清理未使用",
									small: true,
									tone: "danger",
									onPress: () => {
										pendingRemove.set(null);
										pendingPrune.set(true);
									}
								})
							];
						}
					})];
				}
			}),
			() => error() === null || volumes().length === 0 ? null : (() => {
				const __nsh_hv16 = element("view");
				prop(__nsh_hv16, "style", {
					paddingHorizontal: 14,
					paddingBottom: 8
				});
				insert(__nsh_hv16, component(Notice, {
					get message() {
						return `刷新失败：${error()}`;
					},
					tone: "danger"
				}));
				return __nsh_hv16;
			})(),
			() => notice() === null ? null : (() => {
				const __nsh_hv17 = element("view");
				prop(__nsh_hv17, "style", {
					paddingHorizontal: 14,
					paddingBottom: 8
				});
				insert(__nsh_hv17, component(Notice, { get message() {
					return notice() ?? "";
				} }));
				return __nsh_hv17;
			})(),
			() => !pendingPrune() ? null : (() => {
				const __nsh_hv18 = element("view");
				prop(__nsh_hv18, "style", {
					paddingHorizontal: 14,
					paddingBottom: 8
				});
				insert(__nsh_hv18, component(ConfirmBar, {
					message: "清理所有未被容器使用的存储卷？卷里的数据会一并删除。",
					confirmLabel: "清理",
					get busy() {
						return busy();
					},
					onConfirm: () => void prune(),
					onCancel: () => pendingPrune.set(false)
				}));
				return __nsh_hv18;
			})(),
			() => !createOpen() ? null : component(Row, {
				wrap: true,
				gap: 8,
				style: {
					paddingHorizontal: 14,
					paddingBottom: 10
				},
				get children() {
					return [
						component(Field, {
							get value() {
								return createName();
							},
							onChange: (text) => createName.set(text),
							placeholder: "存储卷名称，如 app-data",
							width: 220,
							onSubmit: () => void create()
						}),
						component(Field, {
							get value() {
								return createDriver();
							},
							onChange: (text) => createDriver.set(text),
							placeholder: "驱动，默认 local",
							width: 150,
							onSubmit: () => void create()
						}),
						component(Button, {
							get label() {
								return busy() ? "创建中…" : "创建";
							},
							tone: "primary",
							small: true,
							get disabled() {
								return busy();
							},
							onPress: () => void create()
						}),
						(() => {
							const __nsh_hv19 = element("text");
							bindProp(__nsh_hv19, "style", () => t.meta);
							const __nsh_hv20 = text("驱动留空按 local 处理。");
							append(__nsh_hv19, __nsh_hv20);
							return __nsh_hv19;
						})()
					];
				}
			}),
			() => firstLoad() ? component(Loading, { label: "正在读取存储卷列表…" }) : null,
			() => firstError() ? component(LoadError, {
				get message() {
					return error() ?? "";
				},
				onRetry: () => void load()
			}) : null,
			() => firstLoad() || firstError() ? null : component(SplitPane, {
				get left() {
					return listPane();
				},
				get right() {
					return detailPane();
				}
			})
		]);
		return __nsh_hv13;
	})();
}
mount(Volumes);

//#endregion
export { Volumes as default };