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
/** 状态胶囊。 */
function Badge(props) {
	const color = toneColor(props.tone ?? "neutral");
	return (() => {
		const __nsh_hv9 = element("view");
		bindProp(__nsh_hv9, "style", () => ({
			paddingHorizontal: 8,
			paddingVertical: 2,
			borderRadius: r.pill,
			borderWidth: 1,
			borderColor: color,
			display: "flex",
			flexDirection: "row",
			alignItems: "center"
		}));
		const __nsh_hv10 = element("text");
		prop(__nsh_hv10, "style", {
			fontSize: 11,
			fontWeight: "600",
			color
		});
		insert(__nsh_hv10, () => props.text);
		append(__nsh_hv9, __nsh_hv10);
		return __nsh_hv9;
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
function Changes() {
	const changes = signal([]);
	const loading = signal(true);
	const error = signal(null);
	const busy = signal(false);
	const selected = signal(null);
	function countOf(kind) {
		return changes().filter((change) => kindOf(change) === kind).length;
	}
	async function load() {
		if (busy()) return;
		busy.set(true);
		if (changes().length === 0) loading.set(true);
		try {
			const result = await dispatch("containerDiff");
			const list = Array.isArray(result) ? result : arr(result, "changes");
			changes.set(list);
			error.set(null);
			if (selected() !== null && selected() >= list.length) selected.set(null);
		} catch (failure) {
			error.set(errorMessage(failure));
		} finally {
			loading.set(false);
			busy.set(false);
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
	function changeRow(change, index) {
		const kind = kindOf(change);
		const parts = splitPath(pathOf(change));
		const color = kindColor(kind);
		return (() => {
			const __nsh_hv0 = element("view");
			prop(__nsh_hv0, "onPress", () => selected.set(selected() === index ? null : index));
			bindProp(__nsh_hv0, "style", () => ({
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
			const __nsh_hv1 = element("view");
			bindProp(__nsh_hv1, "style", () => ({
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
			const __nsh_hv2 = element("text");
			prop(__nsh_hv2, "style", {
				fontSize: 11,
				fontWeight: "600",
				color
			});
			insert(__nsh_hv2, kind);
			append(__nsh_hv1, __nsh_hv2);
			const __nsh_hv3 = element("view");
			prop(__nsh_hv3, "style", {
				display: "flex",
				flexDirection: "column",
				gap: 2,
				flex: 1,
				minWidth: 0
			});
			const __nsh_hv4 = element("text");
			prop(__nsh_hv4, "numberOfLines", 1);
			bindProp(__nsh_hv4, "style", () => t.mono);
			insert(__nsh_hv4, () => parts.name);
			append(__nsh_hv3, __nsh_hv4);
			insert(__nsh_hv3, () => parts.dir.length === 0 ? null : (() => {
				const __nsh_hv5 = element("text");
				prop(__nsh_hv5, "numberOfLines", 1);
				bindProp(__nsh_hv5, "style", () => ({
					fontSize: 11,
					color: c.muted()
				}));
				insert(__nsh_hv5, () => parts.dir);
				return __nsh_hv5;
			})());
			const __nsh_hv6 = element("text");
			bindProp(__nsh_hv6, "style", () => ({
				...t.meta,
				width: 36,
				textAlign: "right",
				flexShrink: 0
			}));
			insert(__nsh_hv6, () => KIND_LABEL[kind]);
			append(__nsh_hv0, __nsh_hv1);
			append(__nsh_hv0, __nsh_hv3);
			append(__nsh_hv0, __nsh_hv6);
			return __nsh_hv0;
		})();
	}
	function detailBar() {
		const picked = selectedChange();
		if (picked === null) return (() => {
			const __nsh_hv7 = element("view");
			bindProp(__nsh_hv7, "style", () => ({
				paddingHorizontal: 12,
				paddingVertical: 7,
				borderTopWidth: 1,
				borderTopColor: c.line(),
				backgroundColor: c.panel(),
				flexShrink: 0
			}));
			const __nsh_hv8 = element("text");
			prop(__nsh_hv8, "numberOfLines", 1);
			bindProp(__nsh_hv8, "style", () => t.meta);
			const __nsh_hv9 = text("点击任意一行查看完整路径；docker diff 只比较容器可写层。");
			append(__nsh_hv8, __nsh_hv9);
			append(__nsh_hv7, __nsh_hv8);
			return __nsh_hv7;
		})();
		return (() => {
			const __nsh_hv10 = element("view");
			bindProp(__nsh_hv10, "style", () => ({
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
			const __nsh_hv14 = element("text");
			prop(__nsh_hv14, "numberOfLines", 3);
			bindProp(__nsh_hv14, "style", () => t.mono);
			insert(__nsh_hv14, () => pathOf(picked.change));
			append(__nsh_hv10, __nsh_hv14);
			insert(__nsh_hv10, component(Row, {
				gap: 8,
				style: { justifyContent: "space-between" },
				get children() {
					return [(() => {
						const __nsh_hv11 = element("text");
						bindProp(__nsh_hv11, "style", () => t.label);
						const __nsh_hv12 = text("完整路径");
						append(__nsh_hv11, __nsh_hv12);
						return __nsh_hv11;
					})(), (() => {
						const __nsh_hv13 = element("text");
						bindProp(__nsh_hv13, "style", () => ({
							...t.meta,
							color: kindColor(picked.kind)
						}));
						insert(__nsh_hv13, () => KIND_LONG[picked.kind]);
						return __nsh_hv13;
					})()];
				}
			}), __nsh_hv14);
			return __nsh_hv10;
		})();
	}
	function body() {
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
			const __nsh_hv15 = element("view");
			prop(__nsh_hv15, "style", {
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "column"
			});
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
			insert(__nsh_hv18, () => changes().map((change, index) => changeRow(change, index)));
			append(__nsh_hv17, __nsh_hv18);
			append(__nsh_hv15, __nsh_hv17);
			insert(__nsh_hv15, () => error() === null ? null : (() => {
				const __nsh_hv16 = element("view");
				prop(__nsh_hv16, "style", {
					paddingHorizontal: 12,
					paddingTop: 8
				});
				insert(__nsh_hv16, component(Notice, { get message() {
					return `刷新失败：${error() ?? ""}`;
				} }));
				return __nsh_hv16;
			})(), __nsh_hv17);
			insert(__nsh_hv15, () => detailBar());
			return __nsh_hv15;
		})();
	}
	load();
	return (() => {
		const __nsh_hv19 = element("view");
		bindProp(__nsh_hv19, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		const __nsh_hv25 = element("view");
		bindProp(__nsh_hv25, "style", () => hairline());
		append(__nsh_hv19, __nsh_hv25);
		insert(__nsh_hv19, component(Row, {
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
								const __nsh_hv20 = element("text");
								bindProp(__nsh_hv20, "style", () => t.h1);
								const __nsh_hv21 = text("文件变更");
								append(__nsh_hv20, __nsh_hv21);
								return __nsh_hv20;
							})(),
							(() => {
								const __nsh_hv22 = element("text");
								bindProp(__nsh_hv22, "style", () => t.meta);
								insert(__nsh_hv22, () => `${changes().length} 项`);
								return __nsh_hv22;
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
						];
					}
				}), component(Row, {
					gap: 6,
					get children() {
						return [() => busy() ? (() => {
							const __nsh_hv23 = element("text");
							bindProp(__nsh_hv23, "style", () => t.meta);
							const __nsh_hv24 = text("正在读取…");
							append(__nsh_hv23, __nsh_hv24);
							return __nsh_hv23;
						})() : null, component(Button, {
							label: "刷新",
							small: true,
							onPress: () => void load()
						})];
					}
				})];
			}
		}), __nsh_hv25);
		insert(__nsh_hv19, () => body());
		return __nsh_hv19;
	})();
}
mount(Changes);

//#endregion
export { Changes as default };