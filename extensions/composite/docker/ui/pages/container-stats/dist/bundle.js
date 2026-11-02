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
			color: props.tone === void 0 ? c.text() : toneColor(props.tone),
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
	const clamped = Math.max(0, Math.min(1, props.ratio));
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
			width: `${Math.max(0, Math.round(clamped * 1e3) / 10)}%`,
			height: 8,
			borderRadius: r.pill,
			backgroundColor: props.tone === void 0 ? c.accent() : toneColor(props.tone)
		}));
		append(__nsh_hv37, __nsh_hv38);
		append(__nsh_hv34, __nsh_hv37);
		insert(__nsh_hv34, () => props.label === void 0 && props.caption === void 0 ? null : component(Row, {
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
		}), __nsh_hv37);
		return __nsh_hv34;
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
function numberField(source, key) {
	if (source === null) return null;
	const value = source[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function clockText(date) {
	const two = (value) => String(value).padStart(2, "0");
	return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
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
function ContainerStats() {
	const sample = signal(null);
	const sampledAt = signal("-");
	const loading = signal(true);
	const error = signal(null);
	const busy = signal(false);
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
	async function load() {
		if (busy()) return;
		busy.set(true);
		if (sample() === null) loading.set(true);
		try {
			const next = await dispatch("containerStats") ?? null;
			sample.set(next);
			sampledAt.set(clockText(/* @__PURE__ */ new Date()));
			error.set(null);
		} catch (failure) {
			error.set(errorMessage(failure));
		} finally {
			loading.set(false);
			busy.set(false);
		}
	}
	function content() {
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
			const __nsh_hv0 = element("scroll");
			prop(__nsh_hv0, "style", {
				flex: 1,
				minHeight: 0
			});
			const __nsh_hv1 = element("view");
			prop(__nsh_hv1, "style", {
				padding: 14,
				display: "flex",
				flexDirection: "column",
				gap: 12
			});
			insert(__nsh_hv1, [
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
										const __nsh_hv2 = element("text");
										bindProp(__nsh_hv2, "style", () => t.label);
										const __nsh_hv3 = text("采样时间");
										append(__nsh_hv2, __nsh_hv3);
										return __nsh_hv2;
									})(), (() => {
										const __nsh_hv4 = element("text");
										bindProp(__nsh_hv4, "style", () => ({
											...t.mono,
											color: c.muted()
										}));
										insert(__nsh_hv4, () => sampledAt());
										return __nsh_hv4;
									})()];
								}
							}),
							(() => {
								const __nsh_hv5 = element("text");
								bindProp(__nsh_hv5, "style", () => t.meta);
								const __nsh_hv6 = text("采样时间取本次请求返回时的本地时间；页面不会自动轮询，需要手动刷新。");
								append(__nsh_hv5, __nsh_hv6);
								return __nsh_hv5;
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
							const __nsh_hv7 = element("text");
							bindProp(__nsh_hv7, "style", () => t.meta);
							const __nsh_hv8 = text("provider 的 summarize_stats 只汇总 CPU 与内存，Docker 的 networks（rx / tx 字节与包数）没有被解析。");
							append(__nsh_hv7, __nsh_hv8);
							return __nsh_hv7;
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
							const __nsh_hv9 = element("text");
							bindProp(__nsh_hv9, "style", () => t.meta);
							const __nsh_hv10 = text("同样，blkio_stats（read / write 字节数）不在 operation 的返回结构里；补上后这两组指标可以直接填进来。");
							append(__nsh_hv9, __nsh_hv10);
							return __nsh_hv9;
						})()];
					}
				})
			]);
			append(__nsh_hv0, __nsh_hv1);
			return __nsh_hv0;
		})();
	}
	load();
	return (() => {
		const __nsh_hv11 = element("view");
		bindProp(__nsh_hv11, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		const __nsh_hv17 = element("view");
		bindProp(__nsh_hv17, "style", () => hairline());
		append(__nsh_hv11, __nsh_hv17);
		insert(__nsh_hv11, component(Row, {
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
								const __nsh_hv12 = element("text");
								bindProp(__nsh_hv12, "style", () => t.h1);
								const __nsh_hv13 = text("资源占用");
								append(__nsh_hv12, __nsh_hv13);
								return __nsh_hv12;
							})(),
							component(Badge, {
								get text() {
									return `采样 ${sampledAt()}`;
								},
								tone: "info"
							}),
							(() => {
								const __nsh_hv14 = element("text");
								bindProp(__nsh_hv14, "style", () => t.meta);
								insert(__nsh_hv14, () => cores() === null ? "" : `${cores()} 个核`);
								return __nsh_hv14;
							})()
						];
					}
				}), component(Row, {
					gap: 6,
					get children() {
						return [() => busy() ? (() => {
							const __nsh_hv15 = element("text");
							bindProp(__nsh_hv15, "style", () => t.meta);
							const __nsh_hv16 = text("正在采样…");
							append(__nsh_hv15, __nsh_hv16);
							return __nsh_hv15;
						})() : null, component(Button, {
							label: "刷新",
							small: true,
							onPress: () => void load()
						})];
					}
				})];
			}
		}), __nsh_hv17);
		insert(__nsh_hv11, () => content());
		return __nsh_hv11;
	})();
}
mount(ContainerStats);

//#endregion
export { ContainerStats as default };