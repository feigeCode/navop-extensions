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
const toneColor = (tone) => {
	switch (tone) {
		case "ok": return c.chart(1);
		case "warn": return c.chart(4);
		case "danger": return c.danger();
		case "info": return c.chart(0);
		default: return c.muted();
	}
};
/** 纵向堆叠；`scroll` 打开纵向滚动（页面根节点用）。 */
function Stack(props) {
	const style = {
		display: "flex",
		flexDirection: "column",
		gap: props.gap ?? 12,
		...props.padding === void 0 ? {} : { padding: props.padding },
		...props.scroll ? {
			flex: 1,
			minHeight: 0
		} : {},
		...props.style
	};
	if (props.scroll) return (() => {
		const __nsh_hv0 = element("scroll");
		prop(__nsh_hv0, "style", {
			flex: 1,
			minHeight: 0
		});
		const __nsh_hv1 = element("view");
		prop(__nsh_hv1, "style", style);
		insert(__nsh_hv1, () => props.children);
		append(__nsh_hv0, __nsh_hv1);
		return __nsh_hv0;
	})();
	return (() => {
		const __nsh_hv2 = element("view");
		prop(__nsh_hv2, "style", style);
		insert(__nsh_hv2, () => props.children);
		return __nsh_hv2;
	})();
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

//#endregion
//#region App.tsx
function Overview() {
	const usage = signal(null);
	const loading = signal(true);
	const error = signal(null);
	const refreshed = signal(null);
	async function load() {
		loading.set(true);
		error.set(null);
		try {
			const result = await host.call("navop.workbench.dispatch", {
				operationId: "systemUsage",
				input: {}
			});
			usage.set(result ?? {});
			refreshed.set((/* @__PURE__ */ new Date()).toLocaleTimeString());
		} catch (failure) {
			error.set(errorMessage(failure));
		} finally {
			loading.set(false);
		}
	}
	load();
	const body = () => {
		if (loading() && usage() === null && error() === null) return component(Loading, { label: "正在读取引擎用量…" });
		if (error() !== null && usage() === null) return component(LoadError, {
			get message() {
				return error() ?? "";
			},
			onRetry: () => void load()
		});
		const u = usage() ?? {};
		const running = Number(u.containers_running ?? 0);
		const total = Number(u.containers_total ?? 0);
		const diskUsed = Number(u.disk_used_bytes ?? 0);
		const reclaimable = Number(u.disk_reclaimable_bytes ?? 0);
		const diskTotal = diskUsed + reclaimable;
		const memory = Number(u.containers_memory_bytes ?? 0);
		const engineUp = u.engine === true || running > 0 || total > 0;
		return component(Stack, {
			scroll: true,
			padding: 16,
			gap: 14,
			get children() {
				return [
					component(Row, {
						style: { justifyContent: "space-between" },
						get children() {
							return [component(Row, {
								gap: 8,
								get children() {
									return [
										(() => {
											const __nsh_hv0 = element("text");
											bindProp(__nsh_hv0, "style", () => t.h1);
											const __nsh_hv1 = text("Docker 引擎");
											append(__nsh_hv0, __nsh_hv1);
											return __nsh_hv0;
										})(),
										component(Badge, {
											text: engineUp ? "运行中" : "不可用",
											tone: engineUp ? "ok" : "danger"
										}),
										(() => {
											const __nsh_hv2 = element("text");
											bindProp(__nsh_hv2, "style", () => t.meta);
											insert(__nsh_hv2, () => `Server ${str(u, "server_version", "未知")} · ${Number(u.cpu_count ?? 0)} CPU`);
											return __nsh_hv2;
										})()
									];
								}
							}), component(Row, {
								gap: 8,
								get children() {
									return [() => refreshed() === null ? null : (() => {
										const __nsh_hv3 = element("text");
										bindProp(__nsh_hv3, "style", () => t.meta);
										insert(__nsh_hv3, () => `${refreshed()} 更新`);
										return __nsh_hv3;
									})(), component(Button, {
										get label() {
											return loading() ? "刷新中…" : "刷新";
										},
										small: true,
										get disabled() {
											return loading();
										},
										onPress: () => void load()
									})];
								}
							})];
						}
					}),
					() => error() === null ? null : (() => {
						const __nsh_hv4 = element("text");
						bindProp(__nsh_hv4, "style", () => ({
							fontSize: 12,
							color: c.danger()
						}));
						insert(__nsh_hv4, () => error());
						return __nsh_hv4;
					})(),
					component(Row, {
						gap: 10,
						wrap: true,
						get children() {
							return [
								component(Stat, {
									label: "容器",
									value: `${running} / ${total}`,
									hint: "运行中 / 总数"
								}),
								component(Stat, {
									label: "镜像",
									get value() {
										return String(Number(u.images ?? 0));
									},
									hint: "本地镜像"
								}),
								component(Stat, {
									label: "数据卷",
									get value() {
										return String(Number(u.volumes ?? 0));
									},
									hint: "逻辑卷"
								}),
								component(Stat, {
									label: "网络",
									get value() {
										return String(Number(u.networks ?? 0));
									},
									hint: "网络数"
								})
							];
						}
					}),
					component(Card, {
						title: "磁盘占用",
						hint: "已用 + 可回收",
						get children() {
							return [
								component(Meter, {
									ratio: diskTotal > 0 ? diskUsed / diskTotal : 0,
									label: "已用空间",
									get caption() {
										return `${humanBytes(diskUsed)} / ${humanBytes(diskTotal)}`;
									}
								}),
								component(Row, {
									gap: 10,
									wrap: true,
									get children() {
										return [component(Badge, {
											get text() {
												return `已用 ${humanBytes(diskUsed)}`;
											},
											tone: "info"
										}), component(Badge, {
											get text() {
												return `可回收 ${humanBytes(reclaimable)}（${percent(reclaimable, diskTotal)}）`;
											},
											tone: reclaimable > 0 ? "warn" : "neutral"
										})];
									}
								}),
								() => reclaimable > 0 ? (() => {
									const __nsh_hv5 = element("text");
									bindProp(__nsh_hv5, "style", () => t.meta);
									const __nsh_hv6 = text("在「镜像」页可以清理悬空镜像来回收这部分空间。");
									append(__nsh_hv5, __nsh_hv6);
									return __nsh_hv5;
								})() : (() => {
									const __nsh_hv7 = element("text");
									bindProp(__nsh_hv7, "style", () => t.meta);
									const __nsh_hv8 = text("没有可回收空间。");
									append(__nsh_hv7, __nsh_hv8);
									return __nsh_hv7;
								})()
							];
						}
					}),
					component(Card, {
						title: "运行中容器的资源",
						hint: "所有运行中容器的合计",
						get children() {
							return component(Row, {
								gap: 10,
								wrap: true,
								get children() {
									return [
										component(Stat, {
											label: "内存合计",
											get value() {
												return humanBytes(memory);
											},
											hint: "cgroup 统计"
										}),
										component(Stat, {
											label: "CPU 估计",
											get value() {
												return `${Number(u.containers_cpu_percent ?? 0).toFixed(1)}%`;
											},
											hint: "相对全部核心"
										}),
										component(Stat, {
											label: "运行中容器",
											get value() {
												return String(running);
											},
											hint: `共 ${total} 个`
										})
									];
								}
							});
						}
					}),
					(() => {
						const __nsh_hv9 = element("text");
						bindProp(__nsh_hv9, "style", () => t.meta);
						const __nsh_hv10 = text("数据来自 docker system 统计：镜像与层的大小包含共享层，因此各项相加可能大于磁盘占用。");
						append(__nsh_hv9, __nsh_hv10);
						return __nsh_hv9;
					})()
				];
			}
		});
	};
	return (() => {
		const __nsh_hv11 = element("view");
		bindProp(__nsh_hv11, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		insert(__nsh_hv11, () => body());
		return __nsh_hv11;
	})();
}
mount(Overview);

//#endregion
export { Overview as default };