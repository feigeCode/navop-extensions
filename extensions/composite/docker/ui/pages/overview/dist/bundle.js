import { append, bindProp, component, element, insert, prop, text } from "nsh:rt";
import { host, mount, signal, token } from "nsh";

//#region design.ts
/** 颜色角色。 */
const c = {
	get bg() {
		return token("background");
	},
	get fg() {
		return token("foreground");
	},
	get card() {
		return token("card");
	},
	get cardFg() {
		return token("card-foreground");
	},
	get muted() {
		return token("muted-foreground");
	},
	get line() {
		return token("border");
	},
	get accent() {
		return token("primary");
	},
	get onAccent() {
		return token("primary-foreground");
	},
	get danger() {
		return token("destructive");
	},
	get warn() {
		return token("chart-3");
	},
	get ok() {
		return token("chart-1");
	},
	get inset() {
		return token("muted");
	}
};
/** 圆角（点）。 */
const r = {
	get card() {
		return 10;
	},
	get pill() {
		return 999;
	}
};
/** 字号与排版：数字一律等宽，避免刷新时抖动。 */
const t = {
	h1: {
		fontSize: 17,
		fontWeight: "600"
	},
	label: {
		fontSize: 10.5,
		letterSpacing: .6,
		textTransform: "uppercase"
	},
	num: {
		fontSize: 22,
		fontWeight: "600",
		fontVariant: ["tabular-nums"]
	},
	meta: {
		fontSize: 11.5,
		fontVariant: ["tabular-nums"]
	}
};
/** 一张卡片：底、边、圆角、内边距。 */
const card = (extra) => ({
	backgroundColor: c.card,
	borderWidth: 1,
	borderColor: c.line,
	borderRadius: r.card,
	padding: 14,
	gap: 10,
	...extra
});
/** 小圆角标签（状态/计数）。 */
const pill = (color, textColor) => ({
	flexDirection: "row",
	alignItems: "center",
	gap: 5,
	paddingHorizontal: 8,
	paddingVertical: 3,
	borderRadius: r.pill,
	backgroundColor: color
});
/** 圆点。 */
const dot = (color) => ({
	width: 6,
	height: 6,
	borderRadius: 3,
	backgroundColor: color
});

//#endregion
//#region App.tsx
/** 字节 → 人类可读；非数字给 `-`，避免出现 NaN。 */
function human(bytes) {
	const n = Number(bytes);
	if (!Number.isFinite(n) || n < 0) return "-";
	const units = [
		"B",
		"KB",
		"MB",
		"GB",
		"TB"
	];
	let value = n;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}
function share(part, whole) {
	if (!whole || whole <= 0) return 0;
	return Math.min(100, Math.max(0, (part ?? 0) / whole * 100));
}
/** 一个计数块：大数字 + 小标题 + 补充说明。 */
function Tile(props) {
	return (() => {
		const __nsh_hv0 = element("view");
		bindProp(__nsh_hv0, "style", () => card({
			flex: 1,
			minWidth: 150,
			gap: 6
		}));
		const __nsh_hv1 = element("text");
		bindProp(__nsh_hv1, "style", () => ({
			...t.label,
			color: c.muted
		}));
		insert(__nsh_hv1, () => props.label);
		const __nsh_hv2 = element("view");
		prop(__nsh_hv2, "style", {
			flexDirection: "row",
			alignItems: "baseline",
			gap: 6
		});
		const __nsh_hv3 = element("text");
		bindProp(__nsh_hv3, "style", () => ({
			...t.num,
			color: c.cardFg
		}));
		insert(__nsh_hv3, () => props.value);
		append(__nsh_hv2, __nsh_hv3);
		insert(__nsh_hv2, () => props.latest ? (() => {
			const __nsh_hv4 = element("text");
			bindProp(__nsh_hv4, "style", () => ({
				...t.meta,
				color: c.muted
			}));
			insert(__nsh_hv4, () => props.latest);
			return __nsh_hv4;
		})() : null);
		const __nsh_hv5 = element("text");
		bindProp(__nsh_hv5, "style", () => ({
			...t.meta,
			color: c.muted
		}));
		insert(__nsh_hv5, () => props.hint);
		append(__nsh_hv0, __nsh_hv1);
		append(__nsh_hv0, __nsh_hv2);
		append(__nsh_hv0, __nsh_hv5);
		return __nsh_hv0;
	})();
}
/** 横向占用条。 */
function Meter(props) {
	return (() => {
		const __nsh_hv6 = element("view");
		bindProp(__nsh_hv6, "style", () => ({
			height: 8,
			borderRadius: 999,
			backgroundColor: c.inset,
			overflow: "hidden"
		}));
		const __nsh_hv7 = element("view");
		bindProp(__nsh_hv7, "style", () => ({
			width: `${props.value}%`,
			height: 8,
			borderRadius: 999,
			backgroundColor: props.tone
		}));
		append(__nsh_hv6, __nsh_hv7);
		return __nsh_hv6;
	})();
}
/** 图例里的一行：色块 + 名称 + 数值。 */
function Legend(props) {
	return (() => {
		const __nsh_hv8 = element("view");
		prop(__nsh_hv8, "style", {
			flexDirection: "row",
			alignItems: "center",
			gap: 8
		});
		const __nsh_hv9 = element("view");
		bindProp(__nsh_hv9, "style", () => ({
			width: 8,
			height: 8,
			borderRadius: 2,
			backgroundColor: props.color
		}));
		const __nsh_hv10 = element("text");
		bindProp(__nsh_hv10, "style", () => ({
			...t.meta,
			color: c.muted
		}));
		insert(__nsh_hv10, () => props.label);
		const __nsh_hv11 = element("text");
		bindProp(__nsh_hv11, "style", () => ({
			...t.meta,
			color: c.cardFg,
			marginLeft: "auto"
		}));
		insert(__nsh_hv11, () => props.value);
		append(__nsh_hv8, __nsh_hv9);
		append(__nsh_hv8, __nsh_hv10);
		append(__nsh_hv8, __nsh_hv11);
		return __nsh_hv8;
	})();
}
/** 一个自绘按钮：nsh/base 的 Button 只提供按下语义，外观由页面拥有。 */
function Action(props) {
	return (() => {
		const __nsh_hv12 = element("view");
		bindProp(__nsh_hv12, "onPress", () => props.onPress);
		bindProp(__nsh_hv12, "style", () => ({
			flexDirection: "row",
			alignItems: "center",
			gap: 6,
			paddingHorizontal: 11,
			paddingVertical: 6,
			borderRadius: 8,
			borderWidth: 1,
			borderColor: c.line,
			backgroundColor: c.card,
			opacity: props.busy ? .55 : 1
		}));
		const __nsh_hv13 = element("text");
		bindProp(__nsh_hv13, "style", () => ({
			fontSize: 12,
			color: c.cardFg
		}));
		insert(__nsh_hv13, () => props.busy ? "刷新中…" : props.label);
		append(__nsh_hv12, __nsh_hv13);
		return __nsh_hv12;
	})();
}
function App() {
	const usage = signal(null);
	const error = signal(null);
	const loading = signal(true);
	const refreshed = signal("");
	const load = async () => {
		loading.set(true);
		error.set(null);
		try {
			const result = await host.call("navop.workbench.dispatch", { operationId: "systemUsage" });
			usage.set(result ?? {});
			refreshed.set((/* @__PURE__ */ new Date()).toLocaleTimeString());
		} catch (failure) {
			error.set(String(failure?.message ?? failure));
		} finally {
			loading.set(false);
		}
	};
	load();
	const u = usage() ?? {};
	const running = u.containers_running ?? 0;
	const total = u.containers_total ?? 0;
	const diskUsed = u.disk_used_bytes ?? 0;
	const reclaimable = u.disk_reclaimable_bytes ?? 0;
	const diskTotal = diskUsed + reclaimable;
	return (() => {
		const __nsh_hv14 = element("view");
		bindProp(__nsh_hv14, "style", () => ({
			flex: 1,
			backgroundColor: c.bg
		}));
		const __nsh_hv15 = element("view");
		bindProp(__nsh_hv15, "style", () => ({
			flexDirection: "row",
			alignItems: "center",
			gap: 10,
			paddingHorizontal: 18,
			paddingVertical: 12,
			borderBottomWidth: 1,
			borderColor: c.line
		}));
		const __nsh_hv16 = element("text");
		bindProp(__nsh_hv16, "style", () => ({
			...t.h1,
			color: c.fg
		}));
		const __nsh_hv17 = text("Docker Engine");
		append(__nsh_hv16, __nsh_hv17);
		const __nsh_hv18 = element("view");
		bindProp(__nsh_hv18, "style", () => pill(u.engine ? "transparent" : "transparent", c.fg));
		const __nsh_hv19 = element("view");
		bindProp(__nsh_hv19, "style", () => dot(u.engine ? c.ok : c.danger));
		const __nsh_hv20 = element("text");
		bindProp(__nsh_hv20, "style", () => ({
			...t.meta,
			color: u.engine ? c.ok : c.danger
		}));
		insert(__nsh_hv20, () => u.engine ? "运行中" : "不可用");
		append(__nsh_hv18, __nsh_hv19);
		append(__nsh_hv18, __nsh_hv20);
		const __nsh_hv21 = element("text");
		bindProp(__nsh_hv21, "style", () => ({
			...t.meta,
			color: c.muted
		}));
		const __nsh_hv22 = text(" · ");
		const __nsh_hv23 = text(" CPUs");
		append(__nsh_hv21, __nsh_hv22);
		append(__nsh_hv21, __nsh_hv23);
		insert(__nsh_hv21, () => u.server_version ? `Server ${u.server_version}` : "版本未知", __nsh_hv22);
		insert(__nsh_hv21, () => u.cpu_count ?? 0, __nsh_hv23);
		const __nsh_hv24 = element("view");
		prop(__nsh_hv24, "style", { flex: 1 });
		append(__nsh_hv15, __nsh_hv16);
		append(__nsh_hv15, __nsh_hv18);
		append(__nsh_hv15, __nsh_hv21);
		append(__nsh_hv15, __nsh_hv24);
		insert(__nsh_hv15, [() => refreshed() ? (() => {
			const __nsh_hv25 = element("text");
			bindProp(__nsh_hv25, "style", () => ({
				...t.meta,
				color: c.muted
			}));
			const __nsh_hv26 = text(" 更新");
			append(__nsh_hv25, __nsh_hv26);
			insert(__nsh_hv25, () => refreshed(), __nsh_hv26);
			return __nsh_hv25;
		})() : null, component(Action, {
			label: "刷新",
			get busy() {
				return loading();
			},
			onPress: () => void load()
		})]);
		const __nsh_hv27 = element("scroll");
		prop(__nsh_hv27, "style", { flex: 1 });
		const __nsh_hv28 = element("view");
		prop(__nsh_hv28, "style", {
			padding: 18,
			gap: 14
		});
		const __nsh_hv34 = element("view");
		prop(__nsh_hv34, "style", {
			flexDirection: "row",
			gap: 12,
			flexWrap: "wrap"
		});
		insert(__nsh_hv34, [
			component(Tile, {
				label: "容器",
				get value() {
					return String(running);
				},
				latest: `/ ${total}`,
				hint: "运行中 / 总数"
			}),
			component(Tile, {
				label: "镜像",
				get value() {
					return String(u.images ?? 0);
				},
				hint: "本地镜像"
			}),
			component(Tile, {
				label: "卷",
				get value() {
					return String(u.volumes ?? 0);
				},
				hint: "逻辑卷"
			}),
			component(Tile, {
				label: "网络",
				get value() {
					return String(u.networks ?? 0);
				},
				hint: "网络"
			})
		]);
		const __nsh_hv35 = element("view");
		bindProp(__nsh_hv35, "style", () => card());
		const __nsh_hv36 = element("view");
		prop(__nsh_hv36, "style", {
			flexDirection: "row",
			alignItems: "center",
			gap: 8
		});
		const __nsh_hv37 = element("text");
		bindProp(__nsh_hv37, "style", () => ({
			fontSize: 13,
			fontWeight: "600",
			color: c.cardFg
		}));
		const __nsh_hv38 = text("磁盘占用");
		append(__nsh_hv37, __nsh_hv38);
		const __nsh_hv39 = element("text");
		bindProp(__nsh_hv39, "style", () => ({
			...t.meta,
			color: c.muted
		}));
		const __nsh_hv40 = text("共 ");
		append(__nsh_hv39, __nsh_hv40);
		insert(__nsh_hv39, () => human(diskTotal));
		const __nsh_hv41 = element("view");
		prop(__nsh_hv41, "style", { flex: 1 });
		const __nsh_hv42 = element("text");
		bindProp(__nsh_hv42, "style", () => ({
			...t.meta,
			color: c.warn
		}));
		const __nsh_hv43 = text("可回收 ");
		const __nsh_hv44 = text("%");
		append(__nsh_hv42, __nsh_hv43);
		append(__nsh_hv42, __nsh_hv44);
		insert(__nsh_hv42, () => share(reclaimable, diskTotal).toFixed(0), __nsh_hv44);
		append(__nsh_hv36, __nsh_hv37);
		append(__nsh_hv36, __nsh_hv39);
		append(__nsh_hv36, __nsh_hv41);
		append(__nsh_hv36, __nsh_hv42);
		const __nsh_hv45 = element("view");
		prop(__nsh_hv45, "style", {
			gap: 6,
			marginTop: 2
		});
		insert(__nsh_hv45, [component(Legend, {
			get color() {
				return c.accent;
			},
			label: "已使用",
			get value() {
				return human(diskUsed);
			}
		}), component(Legend, {
			get color() {
				return c.warn;
			},
			label: "可回收",
			get value() {
				return human(reclaimable);
			}
		})]);
		append(__nsh_hv35, __nsh_hv36);
		append(__nsh_hv35, __nsh_hv45);
		insert(__nsh_hv35, component(Meter, {
			get value() {
				return share(diskUsed, diskTotal);
			},
			get tone() {
				return c.accent;
			}
		}), __nsh_hv45);
		const __nsh_hv46 = element("view");
		bindProp(__nsh_hv46, "style", () => card());
		const __nsh_hv47 = element("text");
		bindProp(__nsh_hv47, "style", () => ({
			fontSize: 13,
			fontWeight: "600",
			color: c.cardFg
		}));
		const __nsh_hv48 = text("运行中容器资源");
		append(__nsh_hv47, __nsh_hv48);
		const __nsh_hv49 = element("view");
		prop(__nsh_hv49, "style", {
			flexDirection: "row",
			gap: 24,
			marginTop: 2
		});
		insert(__nsh_hv49, [
			component(Legend, {
				get color() {
					return c.ok;
				},
				label: "内存合计",
				get value() {
					return human(u.containers_memory_bytes);
				}
			}),
			component(Legend, {
				get color() {
					return c.accent;
				},
				label: "CPU 估计",
				get value() {
					return `${(u.containers_cpu_percent ?? 0).toFixed(1)}%`;
				}
			}),
			component(Legend, {
				get color() {
					return c.muted;
				},
				label: "容器",
				value: `${running} / ${total}`
			})
		]);
		append(__nsh_hv46, __nsh_hv47);
		append(__nsh_hv46, __nsh_hv49);
		const __nsh_hv50 = element("text");
		bindProp(__nsh_hv50, "style", () => ({
			...t.meta,
			color: c.muted,
			marginTop: 2
		}));
		const __nsh_hv51 = text("数据来自 docker-provider 的 systemUsage 汇总；刷新只重取这一条。");
		append(__nsh_hv50, __nsh_hv51);
		append(__nsh_hv28, __nsh_hv34);
		append(__nsh_hv28, __nsh_hv35);
		append(__nsh_hv28, __nsh_hv46);
		append(__nsh_hv28, __nsh_hv50);
		insert(__nsh_hv28, () => error() ? (() => {
			const __nsh_hv29 = element("view");
			bindProp(__nsh_hv29, "style", () => card({ borderColor: c.danger }));
			const __nsh_hv30 = element("text");
			bindProp(__nsh_hv30, "style", () => ({
				fontSize: 13,
				color: c.danger
			}));
			const __nsh_hv31 = text("读取引擎用量失败");
			append(__nsh_hv30, __nsh_hv31);
			const __nsh_hv32 = element("text");
			bindProp(__nsh_hv32, "style", () => ({
				...t.meta,
				color: c.muted
			}));
			insert(__nsh_hv32, () => error());
			const __nsh_hv33 = element("view");
			prop(__nsh_hv33, "style", {
				flexDirection: "row",
				marginTop: 4
			});
			insert(__nsh_hv33, component(Action, {
				label: "重试",
				onPress: () => void load()
			}));
			append(__nsh_hv29, __nsh_hv30);
			append(__nsh_hv29, __nsh_hv32);
			append(__nsh_hv29, __nsh_hv33);
			return __nsh_hv29;
		})() : null, __nsh_hv34);
		append(__nsh_hv27, __nsh_hv28);
		append(__nsh_hv14, __nsh_hv15);
		append(__nsh_hv14, __nsh_hv27);
		return __nsh_hv14;
	})();
}
mount(App);

//#endregion
export { App as default };