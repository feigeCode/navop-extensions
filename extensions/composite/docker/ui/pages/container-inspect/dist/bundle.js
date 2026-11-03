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
const pick$1 = (value) => typeof value === "function" ? value() : value;
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
			borderColor: toneColor(pick$1(props.tone ?? "neutral")),
			display: "flex",
			flexDirection: "row",
			alignItems: "center"
		}));
		const __nsh_hv10 = element("text");
		bindProp(__nsh_hv10, "style", () => ({
			fontSize: 11,
			fontWeight: "600",
			color: toneColor(pick$1(props.tone ?? "neutral"))
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
		bindProp(__nsh_hv11, "onPress", () => pick$1(props.disabled ?? false) ? void 0 : props.onPress);
		prop(__nsh_hv11, "role", "button");
		bindProp(__nsh_hv11, "accessibilityLabel", () => props.label);
		bindProp(__nsh_hv11, "style", () => ({
			height: props.small ? 24 : 28,
			paddingHorizontal: props.small ? 9 : 12,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: buttonBorder(pick$1(props.tone ?? "ghost")),
			backgroundColor: buttonFill(pick$1(props.tone ?? "ghost")),
			opacity: pick$1(props.disabled ?? false) ? .5 : 1,
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center"
		}));
		const __nsh_hv12 = element("text");
		bindProp(__nsh_hv12, "style", () => ({
			fontSize: props.small ? 12 : 13,
			fontWeight: "500",
			color: buttonLabel(pick$1(props.tone ?? "ghost"), pick$1(props.disabled ?? false))
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
			color: props.tone === void 0 ? c.muted() : toneColor(pick$1(props.tone))
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
	const containers = signal([]);
	const containerQuery = signal("");
	const containersLoading = signal(true);
	const containersError = signal(null);
	const selectedId = signal(null);
	const selectedName = signal("");
	const pickerOpen = signal(true);
	let seq = 0;
	const status = () => text$1(pick(data() ?? {}, "State", "Status"), "unknown");
	const health = () => text$1(pick(data() ?? {}, "State", "Health", "Status"), "");
	function rowId(row) {
		return str(row, "id", "");
	}
	function rowName(row) {
		return str(row, "name", "");
	}
	function rowImage(row) {
		return str(row, "image", "");
	}
	function rowState(row) {
		return str(row, "state", "");
	}
	function containerTone(state) {
		if (state === "running") return "ok";
		if (state === "paused" || state === "restarting") return "warn";
		if (state === "exited" || state === "dead") return "danger";
		return "neutral";
	}
	function visibleContainers() {
		const needle = containerQuery().trim().toLowerCase();
		if (needle.length === 0) return containers();
		return containers().filter((row) => `${rowName(row)} ${rowImage(row)}`.toLowerCase().includes(needle));
	}
	function selectedSummary() {
		const id = selectedId();
		if (id === null) return "";
		const row = containers().find((item) => rowId(item) === id);
		return row === void 0 ? selectedName() : `${rowName(row)} · ${rowImage(row)}`;
	}
	function resetData() {
		data.set(null);
		error.set(null);
		updatedAt.set("");
		showRaw.set(false);
	}
	function clearSelection() {
		selectedId.set(null);
		selectedName.set("");
		resetData();
		loading.set(false);
		pickerOpen.set(true);
	}
	function selectContainer(row) {
		const id = rowId(row);
		if (id.length === 0) return;
		if (selectedId() === id) {
			pickerOpen.set(false);
			return;
		}
		selectedId.set(id);
		selectedName.set(rowName(row));
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
			if (current !== null && !list.some((row) => rowId(row) === current)) clearSelection();
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
		if (data() === null) loading.set(true);
		try {
			const result = await call("docker/container/inspect", { id });
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
	function pickerList() {
		if (!pickerOpen()) return null;
		return (() => {
			const __nsh_hv56 = element("view");
			bindProp(__nsh_hv56, "style", () => ({
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
			insert(__nsh_hv56, () => containersLoading() && containers().length === 0 ? (() => {
				const __nsh_hv57 = element("text");
				bindProp(__nsh_hv57, "style", () => t.meta);
				const __nsh_hv58 = text("正在读取容器列表…");
				append(__nsh_hv57, __nsh_hv58);
				return __nsh_hv57;
			})() : containersError() !== null && containers().length === 0 ? component(Row, {
				gap: 8,
				get children() {
					return [(() => {
						const __nsh_hv59 = element("text");
						bindProp(__nsh_hv59, "style", () => ({
							...t.meta,
							color: c.danger()
						}));
						insert(__nsh_hv59, () => `容器列表读取失败：${containersError()}`);
						return __nsh_hv59;
					})(), component(Button, {
						label: "重试",
						small: true,
						onPress: () => void loadContainers()
					})];
				}
			}) : visibleContainers().length === 0 ? (() => {
				const __nsh_hv60 = element("text");
				bindProp(__nsh_hv60, "style", () => t.meta);
				insert(__nsh_hv60, () => containers().length === 0 ? "这个连接里没有容器。" : "没有匹配的容器，换个关键词试试。");
				return __nsh_hv60;
			})() : (() => {
				const __nsh_hv61 = element("scroll");
				prop(__nsh_hv61, "style", { maxHeight: 168 });
				const __nsh_hv62 = element("view");
				prop(__nsh_hv62, "style", {
					display: "flex",
					flexDirection: "column"
				});
				insert(__nsh_hv62, () => visibleContainers().map((row) => containerOption(row)));
				append(__nsh_hv61, __nsh_hv62);
				return __nsh_hv61;
			})());
			return __nsh_hv56;
		})();
	}
	function containerOption(row) {
		const id = rowId(row);
		const state = rowState(row);
		return (() => {
			const __nsh_hv63 = element("view");
			prop(__nsh_hv63, "onPress", () => selectContainer(row));
			prop(__nsh_hv63, "role", "button");
			bindProp(__nsh_hv63, "accessibilityLabel", () => `容器 ${rowName(row)}`);
			bindProp(__nsh_hv63, "style", () => ({
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				gap: 8,
				paddingHorizontal: 8,
				paddingVertical: 6,
				borderRadius: r.control,
				backgroundColor: selectedId() === id ? c.hover() : "transparent"
			}));
			const __nsh_hv64 = element("text");
			prop(__nsh_hv64, "numberOfLines", 1);
			bindProp(__nsh_hv64, "style", () => ({
				fontSize: 12,
				fontWeight: "500",
				color: c.text(),
				width: 180
			}));
			insert(__nsh_hv64, () => rowName(row));
			const __nsh_hv65 = element("text");
			prop(__nsh_hv65, "numberOfLines", 1);
			bindProp(__nsh_hv65, "style", () => ({
				...t.mono,
				fontSize: 11,
				color: c.muted(),
				flex: 1,
				minWidth: 0
			}));
			insert(__nsh_hv65, () => rowImage(row));
			append(__nsh_hv63, __nsh_hv64);
			append(__nsh_hv63, __nsh_hv65);
			insert(__nsh_hv63, component(Badge, {
				get text() {
					return state.length === 0 ? "unknown" : state;
				},
				get tone() {
					return containerTone(state);
				}
			}));
			return __nsh_hv63;
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
			const __nsh_hv66 = element("view");
			prop(__nsh_hv66, "style", {
				display: "flex",
				flexDirection: "column",
				flexShrink: 0
			});
			insert(__nsh_hv66, [component(Row, {
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
							const __nsh_hv67 = element("text");
							bindProp(__nsh_hv67, "style", () => t.meta);
							insert(__nsh_hv67, () => `${visibleContainers().length} / ${containers().length} 个容器`);
							return __nsh_hv67;
						})(),
						() => selectedId() === null ? (() => {
							const __nsh_hv68 = element("text");
							bindProp(__nsh_hv68, "style", () => t.meta);
							const __nsh_hv69 = text("未选择容器");
							append(__nsh_hv68, __nsh_hv69);
							return __nsh_hv68;
						})() : (() => {
							const __nsh_hv70 = element("text");
							prop(__nsh_hv70, "numberOfLines", 1);
							bindProp(__nsh_hv70, "style", () => ({
								...t.meta,
								color: c.text(),
								maxWidth: 360
							}));
							insert(__nsh_hv70, () => selectedSummary());
							return __nsh_hv70;
						})(),
						(() => {
							const __nsh_hv71 = element("view");
							prop(__nsh_hv71, "style", { flex: 1 });
							return __nsh_hv71;
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
			return __nsh_hv66;
		})();
	}
	function toolbar() {
		return (() => {
			const __nsh_hv72 = element("view");
			prop(__nsh_hv72, "style", {
				flexDirection: "row",
				alignItems: "center",
				flexWrap: "wrap",
				gap: 8,
				paddingHorizontal: 14,
				paddingVertical: 10,
				flexShrink: 0
			});
			const __nsh_hv73 = element("text");
			bindProp(__nsh_hv73, "style", () => ({
				...t.h1,
				color: c.text()
			}));
			const __nsh_hv74 = text("容器详情");
			append(__nsh_hv73, __nsh_hv74);
			const __nsh_hv78 = element("view");
			prop(__nsh_hv78, "style", { flex: 1 });
			append(__nsh_hv72, __nsh_hv73);
			append(__nsh_hv72, __nsh_hv78);
			insert(__nsh_hv72, () => selectedId() === null ? (() => {
				const __nsh_hv75 = element("text");
				bindProp(__nsh_hv75, "style", () => ({
					...t.meta,
					color: c.muted()
				}));
				const __nsh_hv76 = text("未选择容器");
				append(__nsh_hv75, __nsh_hv76);
				return __nsh_hv75;
			})() : data() === null ? null : [component(Badge, {
				get text() {
					return status();
				},
				get tone() {
					return statusTone(status());
				}
			}), (() => {
				const __nsh_hv77 = element("text");
				bindProp(__nsh_hv77, "style", () => ({
					...t.meta,
					color: c.muted()
				}));
				insert(__nsh_hv77, () => containerName(data() ?? {}));
				return __nsh_hv77;
			})()], __nsh_hv78);
			insert(__nsh_hv72, [
				() => selectedId() === null ? null : (() => {
					const __nsh_hv79 = element("text");
					bindProp(__nsh_hv79, "style", () => ({
						...t.meta,
						color: c.muted()
					}));
					insert(__nsh_hv79, () => loading() ? "读取中…" : busy() ? "刷新中…" : updatedAt() === "" ? "" : `更新于 ${updatedAt()}`);
					return __nsh_hv79;
				})(),
				component(Button, {
					label: "刷新",
					small: true,
					onPress: () => refresh()
				}),
				() => selectedId() === null ? null : chip(showRaw() ? "查看分组" : "查看原始 JSON", showRaw, () => showRaw.set(!showRaw()), "原始 JSON")
			]);
			return __nsh_hv72;
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
				return `连接里有 ${containers().length} 个容器：在上方列表里点一个，页面会读取它的 inspect 详情。`;
			}
		});
	}
	function body() {
		if (selectedId() === null) return selectionGate();
		if (data() === null && error() !== null) return component(LoadError, {
			get message() {
				return error() ?? "";
			},
			onRetry: () => void load()
		});
		if (data() === null && loading()) return component(Loading, { label: "正在读取容器详情…" });
		if (data() === null) return component(Empty, {
			title: "没有容器数据",
			hint: "docker/container/inspect 没有返回文档：容器可能刚被删除，或者这次采样的结果为空。",
			get action() {
				return component(Button, {
					label: "重新读取",
					small: true,
					onPress: () => void load()
				});
			}
		});
		return (() => {
			const __nsh_hv80 = element("scroll");
			prop(__nsh_hv80, "style", {
				flex: 1,
				minHeight: 0
			});
			const __nsh_hv81 = element("view");
			prop(__nsh_hv81, "style", {
				padding: 14,
				display: "flex",
				flexDirection: "column",
				gap: 10
			});
			insert(__nsh_hv81, [() => error() === null ? null : component(Notice, {
				get message() {
					return `刷新失败：${error()}`;
				},
				tone: "danger"
			}), () => showRaw() ? rawBlock() : sectionsBlock()]);
			append(__nsh_hv80, __nsh_hv81);
			return __nsh_hv80;
		})();
	}
	loadContainers();
	return (() => {
		const __nsh_hv82 = element("view");
		bindProp(__nsh_hv82, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		const __nsh_hv83 = element("view");
		bindProp(__nsh_hv83, "style", () => hairline());
		append(__nsh_hv82, __nsh_hv83);
		insert(__nsh_hv82, () => toolbar(), __nsh_hv83);
		insert(__nsh_hv82, [() => containerBar(), () => body()]);
		return __nsh_hv82;
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