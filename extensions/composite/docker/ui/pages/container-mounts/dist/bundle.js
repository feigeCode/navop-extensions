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
/** 挂载类型 → 胶囊配色；未知类型保持中性。 */
function typeTone(type) {
	const text = type.toLowerCase();
	if (text === "bind") return "info";
	if (text === "volume") return "ok";
	if (text === "tmpfs") return "warn";
	return "neutral";
}
function typeOf(entry) {
	const type = str(entry, "Type", "").toLowerCase();
	return type.length > 0 ? type : "bind";
}
function modeOf(entry) {
	return str(entry, "Mode", "默认");
}
function isReadOnly(entry) {
	if (entry.RW === false) return true;
	return /^ro\b/.test(str(entry, "Mode", ""));
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
function ContainerMounts() {
	const mounts = signal([]);
	const loading = signal(true);
	const error = signal(null);
	const busy = signal(false);
	function readOnlyCount() {
		return mounts().filter((entry) => isReadOnly(entry)).length;
	}
	async function load() {
		if (busy()) return;
		busy.set(true);
		if (mounts().length === 0) loading.set(true);
		try {
			const result = await dispatch("containerMounts");
			const list = Array.isArray(result) ? result : arr(result, "mounts");
			mounts.set(list);
			error.set(null);
		} catch (failure) {
			error.set(errorMessage(failure));
		} finally {
			loading.set(false);
			busy.set(false);
		}
	}
	function mountRow(entry) {
		const type = typeOf(entry);
		const readOnly = isReadOnly(entry);
		const name = str(entry, "Name", "");
		return (() => {
			const __nsh_hv0 = element("view");
			bindProp(__nsh_hv0, "style", () => ({
				display: "flex",
				flexDirection: "column",
				gap: 5,
				paddingHorizontal: 12,
				paddingVertical: 9,
				borderBottomWidth: 1,
				borderBottomColor: c.line()
			}));
			insert(__nsh_hv0, [
				component(Row, {
					gap: 8,
					get children() {
						return [
							component(Badge, {
								text: type,
								get tone() {
									return typeTone(type);
								}
							}),
							() => readOnly ? component(Badge, {
								text: "只读",
								tone: "warn"
							}) : component(Badge, {
								text: "可写",
								tone: "neutral"
							}),
							(() => {
								const __nsh_hv1 = element("text");
								prop(__nsh_hv1, "numberOfLines", 1);
								bindProp(__nsh_hv1, "style", () => t.meta);
								insert(__nsh_hv1, () => `模式 ${modeOf(entry)}`);
								return __nsh_hv1;
							})(),
							(() => {
								const __nsh_hv2 = element("text");
								prop(__nsh_hv2, "numberOfLines", 1);
								bindProp(__nsh_hv2, "style", () => ({
									...t.meta,
									flex: 1,
									minWidth: 0,
									textAlign: "right"
								}));
								insert(__nsh_hv2, () => name.length > 0 ? `名称 ${name}` : "");
								return __nsh_hv2;
							})()
						];
					}
				}),
				component(Row, {
					gap: 6,
					align: "flex-start",
					get children() {
						return [(() => {
							const __nsh_hv3 = element("text");
							bindProp(__nsh_hv3, "style", () => ({
								...t.label,
								width: 26,
								flexShrink: 0
							}));
							const __nsh_hv4 = text("源");
							append(__nsh_hv3, __nsh_hv4);
							return __nsh_hv3;
						})(), (() => {
							const __nsh_hv5 = element("text");
							bindProp(__nsh_hv5, "style", () => ({
								...t.mono,
								flex: 1,
								minWidth: 0
							}));
							insert(__nsh_hv5, () => str(entry, "Source", "-"));
							return __nsh_hv5;
						})()];
					}
				}),
				component(Row, {
					gap: 6,
					align: "flex-start",
					get children() {
						return [(() => {
							const __nsh_hv6 = element("text");
							bindProp(__nsh_hv6, "style", () => ({
								...t.label,
								width: 26,
								flexShrink: 0
							}));
							const __nsh_hv7 = text("目标");
							append(__nsh_hv6, __nsh_hv7);
							return __nsh_hv6;
						})(), (() => {
							const __nsh_hv8 = element("text");
							bindProp(__nsh_hv8, "style", () => ({
								...t.mono,
								flex: 1,
								minWidth: 0
							}));
							insert(__nsh_hv8, () => str(entry, "Destination", "-"));
							return __nsh_hv8;
						})()];
					}
				})
			]);
			return __nsh_hv0;
		})();
	}
	function body() {
		if (loading() && mounts().length === 0) return component(Loading, { label: "正在读取容器挂载…" });
		if (error() !== null && mounts().length === 0) return component(LoadError, {
			get message() {
				return error() ?? "";
			},
			onRetry: () => void load()
		});
		if (mounts().length === 0) return component(Empty, {
			title: "容器没有挂载",
			hint: "容器启动时没有声明 bind / volume / tmpfs 挂载，因此没有宿主机路径映射进来。",
			get action() {
				return component(Button, {
					label: "重新读取",
					small: true,
					onPress: () => void load()
				});
			}
		});
		return (() => {
			const __nsh_hv9 = element("view");
			prop(__nsh_hv9, "style", {
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "column"
			});
			const __nsh_hv11 = element("scroll");
			prop(__nsh_hv11, "style", {
				flex: 1,
				minHeight: 0
			});
			const __nsh_hv12 = element("view");
			prop(__nsh_hv12, "style", {
				display: "flex",
				flexDirection: "column"
			});
			insert(__nsh_hv12, () => mounts().map((entry) => mountRow(entry)));
			append(__nsh_hv11, __nsh_hv12);
			const __nsh_hv13 = element("view");
			bindProp(__nsh_hv13, "style", () => ({
				paddingHorizontal: 12,
				paddingVertical: 7,
				borderTopWidth: 1,
				borderTopColor: c.line(),
				backgroundColor: c.panel(),
				flexShrink: 0
			}));
			const __nsh_hv14 = element("text");
			prop(__nsh_hv14, "numberOfLines", 1);
			bindProp(__nsh_hv14, "style", () => t.meta);
			const __nsh_hv15 = text("数据来自容器 Mounts 字段；RW=false 或 Mode 以 ro 开头的挂载按只读显示。");
			append(__nsh_hv14, __nsh_hv15);
			append(__nsh_hv13, __nsh_hv14);
			append(__nsh_hv9, __nsh_hv11);
			append(__nsh_hv9, __nsh_hv13);
			insert(__nsh_hv9, () => error() === null ? null : (() => {
				const __nsh_hv10 = element("view");
				prop(__nsh_hv10, "style", {
					paddingHorizontal: 12,
					paddingTop: 8
				});
				insert(__nsh_hv10, component(Notice, { get message() {
					return `刷新失败：${error() ?? ""}`;
				} }));
				return __nsh_hv10;
			})(), __nsh_hv11);
			return __nsh_hv9;
		})();
	}
	load();
	return (() => {
		const __nsh_hv16 = element("view");
		bindProp(__nsh_hv16, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		const __nsh_hv22 = element("view");
		bindProp(__nsh_hv22, "style", () => hairline());
		append(__nsh_hv16, __nsh_hv22);
		insert(__nsh_hv16, component(Row, {
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
								const __nsh_hv17 = element("text");
								bindProp(__nsh_hv17, "style", () => t.h1);
								const __nsh_hv18 = text("挂载");
								append(__nsh_hv17, __nsh_hv18);
								return __nsh_hv17;
							})(),
							(() => {
								const __nsh_hv19 = element("text");
								bindProp(__nsh_hv19, "style", () => t.meta);
								insert(__nsh_hv19, () => `${mounts().length} 个挂载`);
								return __nsh_hv19;
							})(),
							component(Badge, {
								get text() {
									return `只读 ${readOnlyCount()}`;
								},
								tone: "warn"
							})
						];
					}
				}), component(Row, {
					gap: 6,
					get children() {
						return [() => busy() ? (() => {
							const __nsh_hv20 = element("text");
							bindProp(__nsh_hv20, "style", () => t.meta);
							const __nsh_hv21 = text("正在读取…");
							append(__nsh_hv20, __nsh_hv21);
							return __nsh_hv20;
						})() : null, component(Button, {
							label: "刷新",
							small: true,
							onPress: () => void load()
						})];
					}
				})];
			}
		}), __nsh_hv22);
		insert(__nsh_hv16, () => body());
		return __nsh_hv16;
	})();
}
mount(ContainerMounts);

//#endregion
export { ContainerMounts as default };