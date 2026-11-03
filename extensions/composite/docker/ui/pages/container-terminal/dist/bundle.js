import { append, bindProp, component, cond, element, insert, prop, text } from "nsh:rt";
import { host, mount, nativeComponent, signal, token } from "nsh";

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

//#endregion
//#region App.tsx
/** 宿主注册的原生终端：`command` + `args` 起一个本地进程。 */
const Terminal = nativeComponent("navop.terminal", { props: [
	"command",
	"args",
	"env",
	"title"
] });
const STATE_LABEL = {
	running: "运行中",
	exited: "已停止",
	paused: "已暂停",
	created: "已创建",
	restarting: "重启中"
};
function stateLabel(state) {
	const label = STATE_LABEL[state];
	return label === void 0 ? state.length === 0 ? "未知" : state : label;
}
function stateTone(state) {
	if (state === "running") return "ok";
	if (state === "paused" || state === "restarting") return "warn";
	if (state === "dead") return "danger";
	return "neutral";
}
function toContainers(payload) {
	const source = payload;
	return (Array.isArray(source?.containers) ? source.containers : []).filter((item) => typeof item?.id === "string" && item.id.length > 0);
}
function App() {
	const loading = signal(true);
	const error = signal("");
	const containers = signal([]);
	const filter = signal("");
	const selected = signal(null);
	/** 每次点「重新连接」+1：进 env，宿主看到参数变化就重开一个 pty。 */
	const attempt = signal(0);
	/** 首屏之后就失败时不打断已有内容，只在顶部提示。 */
	const notice = signal("");
	async function load() {
		loading.set(true);
		error.set("");
		try {
			const payload = await call("docker/container/list", {});
			containers.set(toContainers(payload));
			const current = selected();
			if (current !== null) {
				const fresh = containers().find((item) => item.id === current.id);
				selected.set(fresh ?? null);
			}
		} catch (cause) {
			const message = errorMessage(cause);
			error.set(message);
			notice.set(message);
		} finally {
			loading.set(false);
		}
	}
	load();
	const visible = () => {
		const keyword = filter().trim().toLowerCase();
		const all = containers();
		if (keyword.length === 0) return all;
		return all.filter((item) => `${item.name} ${item.image} ${item.state}`.toLowerCase().includes(keyword));
	};
	const row = (item) => (() => {
		const __nsh_hv0 = element("view");
		prop(__nsh_hv0, "onPress", () => {
			selected.set(item);
			notice.set("");
		});
		bindProp(__nsh_hv0, "style", () => ({
			flexDirection: "column",
			gap: 3,
			paddingVertical: 7,
			paddingHorizontal: 10,
			borderRadius: r.control,
			backgroundColor: selected()?.id === item.id ? c.hover() : c.bg(),
			borderWidth: 1,
			borderColor: selected()?.id === item.id ? c.line() : "transparent"
		}));
		const __nsh_hv1 = element("view");
		prop(__nsh_hv1, "style", {
			flexDirection: "row",
			alignItems: "center",
			gap: 6
		});
		const __nsh_hv2 = element("text");
		prop(__nsh_hv2, "numberOfLines", 1);
		bindProp(__nsh_hv2, "style", () => ({
			...t.body,
			color: c.text(),
			flexGrow: 1
		}));
		insert(__nsh_hv2, () => item.name);
		append(__nsh_hv1, __nsh_hv2);
		insert(__nsh_hv1, component(Badge, {
			get text() {
				return stateLabel(item.state);
			},
			get tone() {
				return stateTone(item.state);
			}
		}));
		const __nsh_hv3 = element("text");
		prop(__nsh_hv3, "numberOfLines", 1);
		bindProp(__nsh_hv3, "style", () => ({
			...t.meta,
			color: c.muted()
		}));
		insert(__nsh_hv3, () => item.image);
		append(__nsh_hv0, __nsh_hv1);
		append(__nsh_hv0, __nsh_hv3);
		return __nsh_hv0;
	})();
	const picker = () => (() => {
		const __nsh_hv4 = element("view");
		prop(__nsh_hv4, "style", {
			flexDirection: "column",
			gap: 8,
			height: "100%",
			minWidth: 0
		});
		const __nsh_hv5 = element("view");
		prop(__nsh_hv5, "style", {
			flexDirection: "row",
			alignItems: "center",
			gap: 6
		});
		const __nsh_hv6 = element("view");
		prop(__nsh_hv6, "onPress", () => void load());
		bindProp(__nsh_hv6, "style", () => ({
			paddingHorizontal: 8,
			paddingVertical: 4,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: c.line()
		}));
		const __nsh_hv7 = element("text");
		bindProp(__nsh_hv7, "style", () => ({
			...t.label,
			color: c.text()
		}));
		const __nsh_hv8 = text("刷新列表");
		append(__nsh_hv7, __nsh_hv8);
		append(__nsh_hv6, __nsh_hv7);
		const __nsh_hv9 = element("text");
		bindProp(__nsh_hv9, "style", () => ({
			...t.meta,
			color: c.muted()
		}));
		const __nsh_hv10 = text("共 ");
		const __nsh_hv11 = text(" 个容器");
		append(__nsh_hv9, __nsh_hv10);
		append(__nsh_hv9, __nsh_hv11);
		insert(__nsh_hv9, () => containers().length, __nsh_hv11);
		append(__nsh_hv5, __nsh_hv6);
		append(__nsh_hv5, __nsh_hv9);
		append(__nsh_hv4, __nsh_hv5);
		insert(__nsh_hv4, [component(SearchField, {
			get value() {
				return filter();
			},
			onChange: (next) => filter.set(next),
			placeholder: "过滤容器",
			width: 220
		}), component(List, {
			get items() {
				return visible();
			},
			keyOf: (item) => item.id,
			get selected() {
				return selected()?.id ?? null;
			},
			onSelect: (id) => {
				selected.set(containers().find((item) => item.id === id) ?? null);
				notice.set("");
			},
			render: (item) => row(item),
			get empty() {
				return component(Empty, {
					title: "没有匹配的容器",
					hint: "换个关键字，或刷新列表"
				});
			}
		})], __nsh_hv5);
		return __nsh_hv4;
	})();
	const terminal = (item) => (() => {
		const __nsh_hv12 = element("view");
		prop(__nsh_hv12, "style", {
			flexDirection: "column",
			gap: 8,
			height: "100%",
			minWidth: 0
		});
		const __nsh_hv13 = element("view");
		prop(__nsh_hv13, "style", {
			flexDirection: "row",
			alignItems: "center",
			gap: 8
		});
		const __nsh_hv14 = element("text");
		prop(__nsh_hv14, "numberOfLines", 1);
		bindProp(__nsh_hv14, "style", () => ({
			...t.h2,
			color: c.text(),
			flexGrow: 1
		}));
		insert(__nsh_hv14, () => item.name);
		const __nsh_hv15 = element("view");
		prop(__nsh_hv15, "onPress", () => attempt.set(attempt() + 1));
		bindProp(__nsh_hv15, "style", () => ({
			paddingHorizontal: 8,
			paddingVertical: 4,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: c.line()
		}));
		const __nsh_hv16 = element("text");
		bindProp(__nsh_hv16, "style", () => ({
			...t.label,
			color: c.text()
		}));
		const __nsh_hv17 = text("重新连接");
		append(__nsh_hv16, __nsh_hv17);
		append(__nsh_hv15, __nsh_hv16);
		append(__nsh_hv13, __nsh_hv14);
		append(__nsh_hv13, __nsh_hv15);
		insert(__nsh_hv13, component(Badge, {
			get text() {
				return stateLabel(item.state);
			},
			get tone() {
				return stateTone(item.state);
			}
		}), __nsh_hv15);
		const __nsh_hv18 = element("text");
		bindProp(__nsh_hv18, "style", () => ({
			...t.meta,
			color: c.muted()
		}));
		insert(__nsh_hv18, () => item.state === "running" ? `在本机开一个 docker exec -it ${item.name} /bin/sh` : "容器没在运行：先启动它，再回到这里连接。");
		const __nsh_hv19 = element("view");
		bindProp(__nsh_hv19, "style", () => ({
			flex: 1,
			minHeight: 240,
			borderRadius: r.card,
			borderWidth: 1,
			borderColor: c.line(),
			backgroundColor: c.panel(),
			overflow: "hidden"
		}));
		insert(__nsh_hv19, () => item.state === "running" ? component(Terminal, {
			command: "docker",
			get args() {
				return [
					"exec",
					"-it",
					item.name,
					"/bin/sh"
				];
			},
			get env() {
				return {
					NAVOP_SESSION: String(attempt()),
					NAVOP_TERM: "xterm-256color"
				};
			},
			get title() {
				return item.name;
			}
		}) : component(Empty, {
			title: "容器未运行",
			hint: "启动容器后点上面的「重新连接」"
		}));
		append(__nsh_hv12, __nsh_hv13);
		append(__nsh_hv12, __nsh_hv18);
		append(__nsh_hv12, __nsh_hv19);
		return __nsh_hv12;
	})();
	const body = () => {
		if (loading() && containers().length === 0) return component(Loading, { label: "正在读取容器列表…" });
		if (error().length > 0 && containers().length === 0) return component(LoadError, {
			get message() {
				return error();
			},
			onRetry: () => void load()
		});
		const current = selected();
		return (() => {
			const __nsh_hv20 = element("view");
			prop(__nsh_hv20, "style", {
				flexDirection: "column",
				gap: 8,
				flex: 1,
				minHeight: 0
			});
			insert(__nsh_hv20, [() => notice().length > 0 ? (() => {
				const __nsh_hv21 = element("view");
				bindProp(__nsh_hv21, "style", () => ({
					paddingHorizontal: 10,
					paddingVertical: 6,
					borderRadius: r.control,
					backgroundColor: c.panel(),
					borderWidth: 1,
					borderColor: c.danger()
				}));
				const __nsh_hv22 = element("text");
				bindProp(__nsh_hv22, "style", () => ({
					...t.meta,
					color: c.danger()
				}));
				insert(__nsh_hv22, () => notice());
				append(__nsh_hv21, __nsh_hv22);
				return __nsh_hv21;
			})() : null, component(SplitPane, {
				width: 260,
				get left() {
					return picker();
				},
				get right() {
					return current !== null ? terminal(current) : component(Empty, {
						title: "选一个容器",
						hint: "左边点一个容器，右边就会开一个 shell"
					});
				}
			})]);
			return __nsh_hv20;
		})();
	};
	return (() => {
		const __nsh_hv23 = element("view");
		bindProp(__nsh_hv23, "style", () => ({
			flex: 1,
			minHeight: 0,
			padding: 12,
			backgroundColor: c.bg()
		}));
		insert(__nsh_hv23, () => body());
		return __nsh_hv23;
	})();
}
mount(App);

//#endregion