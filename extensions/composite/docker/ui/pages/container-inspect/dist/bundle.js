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
/** `2026-11-02T09:31:04Z` → `11-02 09:31`；解析不了就原样返回。 */
function shortTime(value) {
	if (typeof value !== "string" || value.length === 0) return "-";
	const date = new Date(value.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
	if (Number.isNaN(date.getTime())) return value;
	const two = (n) => String(n).padStart(2, "0");
	return `${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}
/** Docker 把 Cmd 交给页面时是数组；按 CLI 的样子拼起来。 */
function joinCommand(value) {
	if (Array.isArray(value)) return value.length > 0 ? value.join(" ") : "-";
	if (typeof value === "string" && value.length > 0) return value;
	return "-";
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
/** 原始 JSON 最多渲染的行数（超出部分不交给布局）。 */
const RAW_MAX_LINES = 800;
/** 按路径取字段；中途不是对象就给 undefined。 */
function pick(source, ...path) {
	let node = source;
	for (const key of path) {
		if (!node || typeof node !== "object" || Array.isArray(node)) return void 0;
		node = node[key];
	}
	return node;
}
/** 按路径取对象；不是对象就给空对象。 */
function objOf(source, ...path) {
	const value = pick(source, ...path);
	return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
/** 按路径取数组；不是数组就给空数组。 */
function listOf(source, ...path) {
	const value = pick(source, ...path);
	return Array.isArray(value) ? value : [];
}
/** 任意 JSON 值 → 一行可读文本。 */
function text$1(value, fallback = "-") {
	if (typeof value === "string") return value.length > 0 ? value : fallback;
	if (typeof value === "number") return Number.isFinite(value) ? String(value) : fallback;
	if (typeof value === "boolean") return value ? "是" : "否";
	return fallback;
}
/** docker 的 Name 带前导 `/`。 */
function containerName(doc) {
	const name = text$1(pick(doc, "Name"), "");
	return name.startsWith("/") ? name.slice(1) : name === "" ? "-" : name;
}
/** `NetworkSettings.Ports` → 行：`0.0.0.0:8080 → 80/tcp`，无绑定写「仅暴露」。 */
function portLines(ports) {
	if (!ports || typeof ports !== "object" || Array.isArray(ports)) return [];
	const lines = [];
	for (const [containerPort, bindings] of Object.entries(ports)) {
		if (!Array.isArray(bindings) || bindings.length === 0) {
			lines.push(`${containerPort}（仅暴露）`);
			continue;
		}
		for (const binding of bindings) {
			const hostIp = text$1(pick(binding, "HostIp"), "") || "0.0.0.0";
			const hostPort = text$1(pick(binding, "HostPort"), "-");
			lines.push(`${hostIp}:${hostPort} → ${containerPort}`);
		}
	}
	return lines.sort();
}
/** 内存类限额：0 / 缺失 = 不限。 */
function limitText(value) {
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? humanBytes(number) : "不限";
}
/** Swap：-1 表示显式不限，0 表示没单独设置。 */
function swapText(value) {
	const number = Number(value);
	if (!Number.isFinite(number) || number === 0) return "未单独设置";
	if (number < 0) return "不限";
	return humanBytes(number);
}
/** CPU 配额：优先 NanoCpus，回退 CpuQuota / CpuPeriod；0 = 不限。 */
function cpuText(hostConfig) {
	const nano = Number(pick(hostConfig, "NanoCpus"));
	if (Number.isFinite(nano) && nano > 0) return `${(nano / 1e9).toFixed(2)} 核`;
	const quota = Number(pick(hostConfig, "CpuQuota"));
	const period = Number(pick(hostConfig, "CpuPeriod"));
	if (Number.isFinite(quota) && quota > 0 && Number.isFinite(period) && period > 0) return `${(quota / period).toFixed(2)} 核`;
	return "不限";
}
/** 重启策略：`no` / `always` / `unless-stopped` / `on-failure[:n]`。 */
function restartText(policy) {
	const name = text$1(pick(policy, "Name"), "");
	if (name === "" || name === "no") return "no（不自动重启）";
	const retries = Number(pick(policy, "MaximumRetryCount"));
	if (name === "on-failure" && Number.isFinite(retries) && retries > 0) return `on-failure（最多 ${retries} 次）`;
	return name;
}
/** 状态 → Badge 语气。 */
function statusTone(status) {
	if (status === "running") return "ok";
	if (status === "paused" || status === "restarting" || status === "removing") return "warn";
	if (status === "exited" || status === "dead") return "danger";
	if (status === "created") return "info";
	return "neutral";
}
/** 小按钮：`active` 用 accessor，样式读的是当前值（写在 style 绑定里才响应式）。 */
function chip(label, active, onPress, testLabel) {
	return (() => {
		const __nsh_hv0 = element("view");
		prop(__nsh_hv0, "onPress", onPress);
		prop(__nsh_hv0, "role", "button");
		prop(__nsh_hv0, "accessibilityLabel", testLabel ?? label);
		bindProp(__nsh_hv0, "style", () => ({
			flexDirection: "row",
			alignItems: "center",
			paddingHorizontal: 10,
			paddingVertical: 5,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: active() ? c.accent() : c.line(),
			backgroundColor: active() ? c.accent() : "transparent"
		}));
		const __nsh_hv1 = element("text");
		bindProp(__nsh_hv1, "style", () => ({
			...t.meta,
			color: active() ? c.accentText() : c.text()
		}));
		insert(__nsh_hv1, label);
		append(__nsh_hv0, __nsh_hv1);
		return __nsh_hv0;
	})();
}
/** 一行「标签 / 值」；`truncate` 的值单行省略但可选中复制完整内容。 */
function Field(props) {
	return (() => {
		const __nsh_hv2 = element("view");
		prop(__nsh_hv2, "style", {
			flexDirection: "row",
			alignItems: "flex-start",
			gap: 16,
			paddingVertical: 4
		});
		const __nsh_hv3 = element("text");
		bindProp(__nsh_hv3, "style", () => ({
			...t.meta,
			color: c.muted(),
			width: 88,
			flexShrink: 0
		}));
		insert(__nsh_hv3, () => props.label);
		const __nsh_hv4 = element("text");
		bindProp(__nsh_hv4, "selectable", () => props.truncate === true);
		bindProp(__nsh_hv4, "numberOfLines", () => props.truncate === true ? 1 : 0);
		prop(__nsh_hv4, "ellipsizeMode", "middle");
		bindProp(__nsh_hv4, "style", () => ({
			flex: 1,
			minWidth: 0,
			textAlign: "right",
			...props.mono === true ? t.mono : t.body,
			color: c.text()
		}));
		insert(__nsh_hv4, () => props.value);
		append(__nsh_hv2, __nsh_hv3);
		append(__nsh_hv2, __nsh_hv4);
		return __nsh_hv2;
	})();
}
/** 分组的折叠区：标题行可点，内容只在展开时构建（数据变化会重建）。 */
function Section(props) {
	return (() => {
		const __nsh_hv5 = element("view");
		bindProp(__nsh_hv5, "style", () => ({
			...panel(0),
			padding: 0,
			overflow: "hidden"
		}));
		const __nsh_hv6 = element("view");
		bindProp(__nsh_hv6, "onPress", () => props.onToggle);
		prop(__nsh_hv6, "role", "button");
		bindProp(__nsh_hv6, "accessibilityLabel", () => `${props.title}分组`);
		prop(__nsh_hv6, "style", {
			flexDirection: "row",
			alignItems: "center",
			gap: 8,
			paddingHorizontal: 14,
			paddingVertical: 10
		});
		const __nsh_hv7 = element("text");
		bindProp(__nsh_hv7, "style", () => ({
			...t.h2,
			color: props.open() ? c.text() : c.muted()
		}));
		insert(__nsh_hv7, () => props.open() ? "▾" : "▸");
		const __nsh_hv8 = element("text");
		bindProp(__nsh_hv8, "style", () => ({
			...t.h2,
			color: c.text()
		}));
		insert(__nsh_hv8, () => props.title);
		const __nsh_hv10 = element("view");
		prop(__nsh_hv10, "style", { flex: 1 });
		const __nsh_hv11 = element("text");
		bindProp(__nsh_hv11, "style", () => ({
			...t.meta,
			color: c.muted()
		}));
		insert(__nsh_hv11, () => props.open() ? "收起" : "展开");
		append(__nsh_hv6, __nsh_hv7);
		append(__nsh_hv6, __nsh_hv8);
		append(__nsh_hv6, __nsh_hv10);
		append(__nsh_hv6, __nsh_hv11);
		insert(__nsh_hv6, () => props.hint === void 0 ? null : (() => {
			const __nsh_hv9 = element("text");
			bindProp(__nsh_hv9, "style", () => ({
				...t.meta,
				color: c.muted()
			}));
			insert(__nsh_hv9, () => props.hint);
			return __nsh_hv9;
		})(), __nsh_hv10);
		append(__nsh_hv5, __nsh_hv6);
		insert(__nsh_hv5, () => props.open() ? (() => {
			const __nsh_hv12 = element("view");
			prop(__nsh_hv12, "style", {
				paddingHorizontal: 14,
				paddingBottom: 12,
				paddingTop: 2,
				display: "flex",
				flexDirection: "column",
				gap: 6
			});
			insert(__nsh_hv12, () => props.body());
			return __nsh_hv12;
		})() : null);
		return __nsh_hv5;
	})();
}
/** 端口映射块：每行一个绑定。 */
function PortLines(props) {
	const lines = portLines(props.ports);
	if (lines.length === 0) return (() => {
		const __nsh_hv13 = element("text");
		bindProp(__nsh_hv13, "style", () => ({
			...t.meta,
			color: c.muted()
		}));
		const __nsh_hv14 = text("没有端口映射");
		append(__nsh_hv13, __nsh_hv14);
		return __nsh_hv13;
	})();
	return (() => {
		const __nsh_hv15 = element("view");
		prop(__nsh_hv15, "style", {
			display: "flex",
			flexDirection: "column",
			gap: 2
		});
		insert(__nsh_hv15, () => lines.map((line) => (() => {
			const __nsh_hv16 = element("text");
			prop(__nsh_hv16, "selectable", true);
			bindProp(__nsh_hv16, "style", () => ({
				...t.mono,
				color: c.text()
			}));
			insert(__nsh_hv16, line);
			return __nsh_hv16;
		})()));
		return __nsh_hv15;
	})();
}
function ContainerInspect() {
	const data = signal(null);
	const loading = signal(true);
	const busy = signal(false);
	const error = signal(null);
	const updatedAt = signal("");
	const showRaw = signal(false);
	const openBasic = signal(true);
	const openNetwork = signal(true);
	const openMounts = signal(false);
	const openEnv = signal(false);
	const openLimits = signal(false);
	let seq = 0;
	async function load() {
		const mine = ++seq;
		busy.set(true);
		if (data() === null) loading.set(true);
		try {
			const result = await host.call("navop.workbench.dispatch", {
				operationId: "inspectContainer",
				input: {}
			});
			if (mine !== seq) return;
			data.set(result && typeof result === "object" && !Array.isArray(result) ? result : null);
			updatedAt.set(clock());
			error.set(null);
		} catch (failure) {
			if (mine !== seq) return;
			error.set(errorMessage(failure));
		} finally {
			if (mine === seq) {
				busy.set(false);
				loading.set(false);
			}
		}
	}
	load();
	const status = () => text$1(pick(data() ?? {}, "State", "Status"), "unknown");
	const health = () => text$1(pick(data() ?? {}, "State", "Health", "Status"), "");
	function basicBody() {
		const doc = data() ?? {};
		const state = objOf(doc, "State");
		const config = objOf(doc, "Config");
		const hostConfig = objOf(doc, "HostConfig");
		const startedAt = text$1(pick(state, "StartedAt"), "");
		return (() => {
			const __nsh_hv17 = element("view");
			prop(__nsh_hv17, "style", {
				display: "flex",
				flexDirection: "column"
			});
			const __nsh_hv18 = element("text");
			bindProp(__nsh_hv18, "style", () => ({
				...t.meta,
				color: c.muted(),
				marginTop: 6
			}));
			const __nsh_hv19 = text("长值单行省略；选中文本即可复制完整内容。");
			append(__nsh_hv18, __nsh_hv19);
			append(__nsh_hv17, __nsh_hv18);
			insert(__nsh_hv17, [
				component(Field, {
					label: "容器 ID",
					get value() {
						return text$1(pick(doc, "Id"));
					},
					mono: true,
					truncate: true
				}),
				component(Field, {
					label: "名称",
					get value() {
						return containerName(doc);
					}
				}),
				component(Field, {
					label: "镜像",
					get value() {
						return text$1(pick(doc, "Image"));
					},
					mono: true,
					truncate: true
				}),
				component(Field, {
					label: "状态",
					get value() {
						return health() === "" ? status() : `${status()}（健康检查 ${health()}）`;
					}
				}),
				component(Field, {
					label: "启动时间",
					get value() {
						return startedAt === "" || startedAt.startsWith("0001-") ? "未启动" : shortTime(startedAt);
					}
				}),
				component(Field, {
					label: "重启策略",
					get value() {
						return restartText(pick(hostConfig, "RestartPolicy"));
					}
				}),
				component(Field, {
					label: "启动命令",
					get value() {
						return joinCommand(pick(config, "Cmd"));
					},
					mono: true
				})
			], __nsh_hv18);
			return __nsh_hv17;
		})();
	}
	function networkBody() {
		const settings = objOf(data() ?? {}, "NetworkSettings");
		const networks = objOf(settings, "Networks");
		const names = Object.keys(networks);
		if (names.length === 0) return (() => {
			const __nsh_hv20 = element("view");
			prop(__nsh_hv20, "style", {
				display: "flex",
				flexDirection: "column",
				gap: 4
			});
			const __nsh_hv21 = element("view");
			prop(__nsh_hv21, "style", {
				display: "flex",
				flexDirection: "column",
				gap: 2,
				marginTop: 4
			});
			const __nsh_hv22 = element("text");
			bindProp(__nsh_hv22, "style", () => ({
				...t.meta,
				color: c.muted()
			}));
			const __nsh_hv23 = text("端口映射");
			append(__nsh_hv22, __nsh_hv23);
			append(__nsh_hv21, __nsh_hv22);
			insert(__nsh_hv21, component(PortLines, { get ports() {
				return pick(settings, "Ports");
			} }));
			append(__nsh_hv20, __nsh_hv21);
			insert(__nsh_hv20, [
				component(Field, {
					label: "IP 地址",
					get value() {
						return text$1(pick(settings, "IPAddress"), "未分配");
					},
					mono: true
				}),
				component(Field, {
					label: "网关",
					get value() {
						return text$1(pick(settings, "Gateway"), "未分配");
					},
					mono: true
				}),
				component(Field, {
					label: "MAC",
					get value() {
						return text$1(pick(settings, "MacAddress"), "未分配");
					},
					mono: true
				})
			], __nsh_hv21);
			return __nsh_hv20;
		})();
		return (() => {
			const __nsh_hv24 = element("view");
			prop(__nsh_hv24, "style", {
				display: "flex",
				flexDirection: "column",
				gap: 10
			});
			const __nsh_hv30 = element("view");
			prop(__nsh_hv30, "style", {
				display: "flex",
				flexDirection: "column",
				gap: 2
			});
			const __nsh_hv31 = element("text");
			bindProp(__nsh_hv31, "style", () => ({
				...t.meta,
				color: c.muted()
			}));
			const __nsh_hv32 = text("端口映射");
			append(__nsh_hv31, __nsh_hv32);
			append(__nsh_hv30, __nsh_hv31);
			insert(__nsh_hv30, component(PortLines, { get ports() {
				return pick(settings, "Ports");
			} }));
			append(__nsh_hv24, __nsh_hv30);
			insert(__nsh_hv24, () => names.map((name) => {
				const network = objOf(networks, name);
				const bindings = pick(network, "Ports");
				return (() => {
					const __nsh_hv25 = element("view");
					prop(__nsh_hv25, "style", {
						display: "flex",
						flexDirection: "column",
						gap: 2
					});
					const __nsh_hv26 = element("text");
					bindProp(__nsh_hv26, "style", () => ({
						...t.h2,
						color: c.text()
					}));
					insert(__nsh_hv26, name);
					append(__nsh_hv25, __nsh_hv26);
					insert(__nsh_hv25, [
						component(Field, {
							label: "IP 地址",
							get value() {
								return text$1(pick(network, "IPAddress"), "未分配");
							},
							mono: true
						}),
						component(Field, {
							label: "网关",
							get value() {
								return text$1(pick(network, "Gateway"), "未分配");
							},
							mono: true
						}),
						component(Field, {
							label: "MAC",
							get value() {
								return text$1(pick(network, "MacAddress"), "未分配");
							},
							mono: true
						}),
						() => Array.isArray(bindings) && bindings.length > 0 ? (() => {
							const __nsh_hv27 = element("view");
							prop(__nsh_hv27, "style", {
								display: "flex",
								flexDirection: "column",
								gap: 2
							});
							const __nsh_hv28 = element("text");
							bindProp(__nsh_hv28, "style", () => ({
								...t.meta,
								color: c.muted()
							}));
							const __nsh_hv29 = text("端口映射");
							append(__nsh_hv28, __nsh_hv29);
							append(__nsh_hv27, __nsh_hv28);
							insert(__nsh_hv27, component(PortLines, { ports: bindings }));
							return __nsh_hv27;
						})() : null
					]);
					return __nsh_hv25;
				})();
			}), __nsh_hv30);
			return __nsh_hv24;
		})();
	}
	function mountsBody() {
		const mounts = listOf(data() ?? {}, "Mounts");
		if (mounts.length === 0) return (() => {
			const __nsh_hv33 = element("text");
			bindProp(__nsh_hv33, "style", () => ({
				...t.meta,
				color: c.muted()
			}));
			const __nsh_hv34 = text("没有挂载");
			append(__nsh_hv33, __nsh_hv34);
			return __nsh_hv33;
		})();
		return (() => {
			const __nsh_hv35 = element("view");
			prop(__nsh_hv35, "style", {
				display: "flex",
				flexDirection: "column"
			});
			insert(__nsh_hv35, () => mounts.map((mount, index) => {
				const readOnly = pick(mount, "RW") === false;
				const mode = text$1(pick(mount, "Mode"), "");
				return (() => {
					const __nsh_hv36 = element("view");
					bindProp(__nsh_hv36, "style", () => ({
						display: "flex",
						flexDirection: "column",
						gap: 3,
						paddingVertical: 6,
						borderTopWidth: index === 0 ? 0 : 1,
						borderColor: c.line()
					}));
					const __nsh_hv37 = element("view");
					prop(__nsh_hv37, "style", {
						flexDirection: "row",
						alignItems: "center",
						gap: 6
					});
					const __nsh_hv38 = element("text");
					bindProp(__nsh_hv38, "style", () => ({
						...t.meta,
						color: c.muted()
					}));
					insert(__nsh_hv38, () => `${index + 1}. ${text$1(pick(mount, "Type"), "bind")}`);
					append(__nsh_hv37, __nsh_hv38);
					insert(__nsh_hv37, [component(Badge, {
						text: readOnly ? "只读 (ro)" : "读写 (rw)",
						tone: readOnly ? "warn" : "ok"
					}), () => mode === "" ? null : (() => {
						const __nsh_hv39 = element("text");
						bindProp(__nsh_hv39, "style", () => ({
							...t.meta,
							color: c.muted()
						}));
						insert(__nsh_hv39, `模式 ${mode}`);
						return __nsh_hv39;
					})()]);
					const __nsh_hv40 = element("text");
					prop(__nsh_hv40, "selectable", true);
					bindProp(__nsh_hv40, "style", () => ({
						...t.mono,
						color: c.text()
					}));
					insert(__nsh_hv40, () => `${text$1(pick(mount, "Source"))} → ${text$1(pick(mount, "Destination"))}`);
					append(__nsh_hv36, __nsh_hv37);
					append(__nsh_hv36, __nsh_hv40);
					return __nsh_hv36;
				})();
			}));
			return __nsh_hv35;
		})();
	}
	function envBody() {
		const env = listOf(data() ?? {}, "Config", "Env").map((entry) => String(entry));
		if (env.length === 0) return (() => {
			const __nsh_hv41 = element("text");
			bindProp(__nsh_hv41, "style", () => ({
				...t.meta,
				color: c.muted()
			}));
			const __nsh_hv42 = text("没有环境变量");
			append(__nsh_hv41, __nsh_hv42);
			return __nsh_hv41;
		})();
		return (() => {
			const __nsh_hv43 = element("view");
			prop(__nsh_hv43, "style", {
				display: "flex",
				flexDirection: "column"
			});
			const __nsh_hv47 = element("text");
			bindProp(__nsh_hv47, "style", () => ({
				...t.meta,
				color: c.muted(),
				marginTop: 6
			}));
			const __nsh_hv48 = text("两列：变量名 / 值。值过长会省略；选中文本即可复制完整值。");
			append(__nsh_hv47, __nsh_hv48);
			append(__nsh_hv43, __nsh_hv47);
			insert(__nsh_hv43, () => env.map((entry) => {
				const index = entry.indexOf("=");
				const key = index < 0 ? entry : entry.slice(0, index);
				const value = index < 0 ? "" : entry.slice(index + 1);
				return (() => {
					const __nsh_hv44 = element("view");
					bindProp(__nsh_hv44, "style", () => ({
						flexDirection: "row",
						alignItems: "center",
						gap: 12,
						paddingVertical: 4,
						borderBottomWidth: 1,
						borderColor: c.line()
					}));
					const __nsh_hv45 = element("text");
					prop(__nsh_hv45, "numberOfLines", 1);
					prop(__nsh_hv45, "ellipsizeMode", "tail");
					bindProp(__nsh_hv45, "style", () => ({
						width: 200,
						flexShrink: 0,
						...t.mono,
						color: c.muted()
					}));
					insert(__nsh_hv45, key);
					const __nsh_hv46 = element("text");
					prop(__nsh_hv46, "selectable", true);
					prop(__nsh_hv46, "numberOfLines", 1);
					prop(__nsh_hv46, "ellipsizeMode", "middle");
					bindProp(__nsh_hv46, "style", () => ({
						flex: 1,
						minWidth: 0,
						...t.mono,
						color: c.text()
					}));
					insert(__nsh_hv46, value === "" ? "（空）" : value);
					append(__nsh_hv44, __nsh_hv45);
					append(__nsh_hv44, __nsh_hv46);
					return __nsh_hv44;
				})();
			}), __nsh_hv47);
			return __nsh_hv43;
		})();
	}
	function limitsBody() {
		const hostConfig = objOf(data() ?? {}, "HostConfig");
		const pids = Number(pick(hostConfig, "PidsLimit"));
		return (() => {
			const __nsh_hv49 = element("view");
			prop(__nsh_hv49, "style", {
				display: "flex",
				flexDirection: "column"
			});
			insert(__nsh_hv49, [
				component(Field, {
					label: "CPU 配额",
					get value() {
						return cpuText(hostConfig);
					},
					mono: true
				}),
				component(Field, {
					label: "CPU 权重",
					get value() {
						return Number(pick(hostConfig, "CpuShares")) > 0 ? text$1(pick(hostConfig, "CpuShares")) : "不限（默认权重）";
					},
					mono: true
				}),
				component(Field, {
					label: "内存限制",
					get value() {
						return limitText(pick(hostConfig, "Memory"));
					},
					mono: true
				}),
				component(Field, {
					label: "Swap",
					get value() {
						return swapText(pick(hostConfig, "MemorySwap"));
					},
					mono: true
				}),
				component(Field, {
					label: "进程数上限",
					get value() {
						return Number.isFinite(pids) && pids > 0 ? String(pids) : "不限";
					},
					mono: true
				}),
				component(Field, {
					label: "只读根文件系统",
					get value() {
						return pick(hostConfig, "ReadonlyRootfs") === true ? "是" : "否";
					}
				})
			]);
			return __nsh_hv49;
		})();
	}
	function rawBlock() {
		const lines = JSON.stringify(data() ?? {}, null, 2).split("\n");
		const shown = lines.slice(0, RAW_MAX_LINES);
		return (() => {
			const __nsh_hv50 = element("view");
			bindProp(__nsh_hv50, "style", () => ({
				...panel(12),
				gap: 6,
				display: "flex",
				flexDirection: "column"
			}));
			const __nsh_hv51 = element("text");
			bindProp(__nsh_hv51, "style", () => ({
				...t.meta,
				color: c.muted()
			}));
			insert(__nsh_hv51, () => lines.length > RAW_MAX_LINES ? `原始 JSON · 共 ${lines.length} 行，仅渲染前 ${RAW_MAX_LINES} 行` : `原始 JSON · ${lines.length} 行`);
			const __nsh_hv52 = element("text");
			prop(__nsh_hv52, "selectable", true);
			bindProp(__nsh_hv52, "style", () => ({
				...t.mono,
				color: c.text(),
				lineHeight: 17
			}));
			insert(__nsh_hv52, () => shown.join("\n"));
			const __nsh_hv53 = element("text");
			bindProp(__nsh_hv53, "style", () => ({
				...t.meta,
				color: c.muted()
			}));
			const __nsh_hv54 = text("长行自动折行 · 可选中复制");
			append(__nsh_hv53, __nsh_hv54);
			append(__nsh_hv50, __nsh_hv51);
			append(__nsh_hv50, __nsh_hv52);
			append(__nsh_hv50, __nsh_hv53);
			return __nsh_hv50;
		})();
	}
	function sectionsBlock() {
		const doc = data() ?? {};
		const mountCount = listOf(doc, "Mounts").length;
		const envCount = listOf(doc, "Config", "Env").length;
		const networkCount = Object.keys(objOf(doc, "NetworkSettings", "Networks")).length;
		return (() => {
			const __nsh_hv55 = element("view");
			prop(__nsh_hv55, "style", {
				display: "flex",
				flexDirection: "column",
				gap: 10
			});
			insert(__nsh_hv55, [
				component(Section, {
					title: "基础",
					get hint() {
						return containerName(doc);
					},
					open: openBasic,
					onToggle: () => openBasic.set(!openBasic()),
					body: basicBody
				}),
				component(Section, {
					title: "网络",
					hint: networkCount === 0 ? "无网络信息" : `${networkCount} 个网络`,
					open: openNetwork,
					onToggle: () => openNetwork.set(!openNetwork()),
					body: networkBody
				}),
				component(Section, {
					title: "挂载",
					hint: `${mountCount} 项`,
					open: openMounts,
					onToggle: () => openMounts.set(!openMounts()),
					body: mountsBody
				}),
				component(Section, {
					title: "环境变量",
					hint: `${envCount} 项`,
					open: openEnv,
					onToggle: () => openEnv.set(!openEnv()),
					body: envBody
				}),
				component(Section, {
					title: "资源限制",
					hint: "CPU / 内存",
					open: openLimits,
					onToggle: () => openLimits.set(!openLimits()),
					body: limitsBody
				})
			]);
			return __nsh_hv55;
		})();
	}
	return (() => {
		const __nsh_hv56 = element("view");
		bindProp(__nsh_hv56, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		const __nsh_hv57 = element("view");
		bindProp(__nsh_hv57, "style", () => ({
			flexDirection: "row",
			alignItems: "center",
			flexWrap: "wrap",
			gap: 8,
			paddingHorizontal: 14,
			paddingVertical: 10,
			borderBottomWidth: 1,
			borderColor: c.line()
		}));
		const __nsh_hv58 = element("text");
		bindProp(__nsh_hv58, "style", () => ({
			...t.h1,
			color: c.text()
		}));
		const __nsh_hv59 = text("容器详情");
		append(__nsh_hv58, __nsh_hv59);
		const __nsh_hv61 = element("view");
		prop(__nsh_hv61, "style", { flex: 1 });
		const __nsh_hv62 = element("text");
		bindProp(__nsh_hv62, "style", () => ({
			...t.meta,
			color: c.muted()
		}));
		insert(__nsh_hv62, () => loading() ? "读取中…" : busy() ? "刷新中…" : updatedAt() === "" ? "" : `更新于 ${updatedAt()}`);
		append(__nsh_hv57, __nsh_hv58);
		append(__nsh_hv57, __nsh_hv61);
		append(__nsh_hv57, __nsh_hv62);
		insert(__nsh_hv57, [() => data() === null ? null : component(Badge, {
			get text() {
				return status();
			},
			get tone() {
				return statusTone(status());
			}
		}), () => data() === null ? null : (() => {
			const __nsh_hv60 = element("text");
			bindProp(__nsh_hv60, "style", () => ({
				...t.meta,
				color: c.muted()
			}));
			insert(__nsh_hv60, () => containerName(data() ?? {}));
			return __nsh_hv60;
		})()], __nsh_hv61);
		insert(__nsh_hv57, [component(Button, {
			label: "刷新",
			small: true,
			onPress: () => void load()
		}), () => chip(showRaw() ? "查看分组" : "查看原始 JSON", showRaw, () => showRaw.set(!showRaw()), "原始 JSON")]);
		const __nsh_hv63 = element("view");
		prop(__nsh_hv63, "style", {
			flex: 1,
			minHeight: 0
		});
		insert(__nsh_hv63, () => data() === null && error() !== null ? component(LoadError, {
			get message() {
				return error() ?? "";
			},
			onRetry: () => void load()
		}) : data() === null && loading() ? component(Loading, { label: "正在读取容器详情…" }) : data() === null ? component(Empty, {
			title: "没有容器数据",
			hint: "宿主没有返回 inspect 文档，试试刷新。"
		}) : (() => {
			const __nsh_hv64 = element("scroll");
			prop(__nsh_hv64, "style", {
				flex: 1,
				minHeight: 0
			});
			const __nsh_hv65 = element("view");
			prop(__nsh_hv65, "style", {
				padding: 14,
				display: "flex",
				flexDirection: "column",
				gap: 10
			});
			insert(__nsh_hv65, [() => error() === null ? null : component(Notice, {
				get message() {
					return `刷新失败：${error()}`;
				},
				tone: "danger"
			}), () => showRaw() ? rawBlock() : sectionsBlock()]);
			append(__nsh_hv64, __nsh_hv65);
			return __nsh_hv64;
		})());
		append(__nsh_hv56, __nsh_hv57);
		append(__nsh_hv56, __nsh_hv63);
		return __nsh_hv56;
	})();
}
/** 本地时钟（HH:MM:SS）。 */
function clock() {
	const now = /* @__PURE__ */ new Date();
	const two = (value) => String(value).padStart(2, "0");
	return `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
}
mount(ContainerInspect);

//#endregion
export { ContainerInspect as default };