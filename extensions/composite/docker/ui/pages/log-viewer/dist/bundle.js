import { append, bindProp, component, element, insert, prop, text } from "nsh:rt";
import { cleanup, effect, host, mount, signal, token } from "nsh";

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
/** 自动刷新间隔（旧页 FOLLOW_MS 同值）。 */
const FOLLOW_MS = 2e3;
/** 尾行档位。「全部」是 provider 的硬上限（MAX_LOG_TAIL = 5000）。 */
const TAILS = [
	{
		label: "100",
		value: 100
	},
	{
		label: "200",
		value: 200
	},
	{
		label: "500",
		value: 500
	},
	{
		label: "1000",
		value: 1e3
	},
	{
		label: "全部",
		value: 5e3
	}
];
/** 把 provider 拼好的日志切成行；去掉末尾换行带来的空行。 */
function toLines(text) {
	const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
	return trimmed.length === 0 ? [] : trimmed.split("\n");
}
/** 本地时钟（HH:MM:SS），用于「更新于」。 */
function nowClock() {
	const now = /* @__PURE__ */ new Date();
	const two = (value) => String(value).padStart(2, "0");
	return `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
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
function LogViewer() {
	const tail = signal(500);
	const raw = signal("");
	const loading = signal(true);
	const busy = signal(false);
	const error = signal(null);
	const updatedAt = signal("");
	const follow = signal(false);
	const cleared = signal(false);
	let seq = 0;
	async function load(force = false) {
		if (busy() && !force) return;
		const mine = ++seq;
		busy.set(true);
		if (raw() === "") loading.set(true);
		try {
			const result = await host.call("navop.workbench.dispatch", {
				operationId: "containerLogsWithTail",
				input: { tail: String(tail()) }
			});
			if (mine !== seq) return;
			raw.set(str(result, "logs", ""));
			cleared.set(false);
			updatedAt.set(nowClock());
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
	load(true);
	effect(() => {
		if (!follow()) return;
		const timer = setInterval(() => {
			load();
		}, FOLLOW_MS);
		cleanup(() => clearInterval(timer));
	});
	function pickTail(value) {
		if (tail() === value) return;
		tail.set(value);
		load(true);
	}
	function view() {
		const all = toLines(raw());
		const shown = all.slice(-2e3);
		return {
			total: all.length,
			shown: shown.length,
			text: shown.join("\n"),
			truncated: all.length > shown.length
		};
	}
	return (() => {
		const __nsh_hv2 = element("view");
		bindProp(__nsh_hv2, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		const __nsh_hv3 = element("view");
		bindProp(__nsh_hv3, "style", () => ({
			flexDirection: "row",
			alignItems: "center",
			flexWrap: "wrap",
			gap: 8,
			paddingHorizontal: 14,
			paddingVertical: 10,
			borderBottomWidth: 1,
			borderColor: c.line()
		}));
		const __nsh_hv4 = element("text");
		bindProp(__nsh_hv4, "style", () => ({
			...t.h1,
			color: c.text()
		}));
		const __nsh_hv5 = text("容器日志");
		append(__nsh_hv4, __nsh_hv5);
		const __nsh_hv7 = element("view");
		prop(__nsh_hv7, "style", { flex: 1 });
		const __nsh_hv8 = element("text");
		bindProp(__nsh_hv8, "style", () => ({
			...t.label,
			color: c.muted()
		}));
		const __nsh_hv9 = text("显示行数");
		append(__nsh_hv8, __nsh_hv9);
		append(__nsh_hv3, __nsh_hv4);
		append(__nsh_hv3, __nsh_hv7);
		append(__nsh_hv3, __nsh_hv8);
		insert(__nsh_hv3, () => updatedAt() === "" ? null : (() => {
			const __nsh_hv6 = element("text");
			bindProp(__nsh_hv6, "style", () => ({
				...t.meta,
				color: c.muted()
			}));
			insert(__nsh_hv6, () => `更新于 ${updatedAt()}`);
			return __nsh_hv6;
		})(), __nsh_hv7);
		insert(__nsh_hv3, [
			() => TAILS.map((option) => chip(option.label, () => tail() === option.value, () => pickTail(option.value), `行数 ${option.label}`)),
			() => chip(follow() ? "自动刷新 · 开" : "自动刷新 · 关", follow, () => follow.set(!follow()), "自动刷新"),
			() => chip("清屏", () => cleared(), () => cleared.set(true), "清屏"),
			component(Button, {
				label: "刷新",
				small: true,
				onPress: () => void load(true)
			})
		]);
		const __nsh_hv10 = element("view");
		prop(__nsh_hv10, "style", {
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column"
		});
		insert(__nsh_hv10, () => error() !== null && raw() === "" ? component(LoadError, {
			get message() {
				return error() ?? "";
			},
			onRetry: () => void load(true)
		}) : loading() && raw() === "" ? component(Loading, { label: "正在读取容器日志…" }) : cleared() || toLines(raw()).length === 0 ? component(Empty, {
			get title() {
				return cleared() ? "已清屏" : "暂无日志";
			},
			get hint() {
				return cleared() ? "点「刷新」重新读取；自动刷新开着时 2 秒后自动恢复。" : "这个容器在所选行数内没有输出日志，试试更大的行数。";
			}
		}) : (() => {
			const __nsh_hv11 = element("scroll");
			prop(__nsh_hv11, "style", {
				flex: 1,
				minHeight: 0
			});
			const __nsh_hv12 = element("view");
			prop(__nsh_hv12, "style", { padding: 12 });
			const __nsh_hv13 = element("text");
			prop(__nsh_hv13, "selectable", true);
			bindProp(__nsh_hv13, "style", () => ({
				...t.mono,
				color: c.text(),
				lineHeight: 18
			}));
			insert(__nsh_hv13, () => view().text);
			append(__nsh_hv12, __nsh_hv13);
			append(__nsh_hv11, __nsh_hv12);
			return __nsh_hv11;
		})());
		const __nsh_hv14 = element("view");
		bindProp(__nsh_hv14, "style", () => ({
			flexDirection: "row",
			alignItems: "center",
			flexWrap: "wrap",
			gap: 8,
			paddingHorizontal: 14,
			paddingVertical: 6,
			borderTopWidth: 1,
			borderColor: c.line()
		}));
		const __nsh_hv15 = element("text");
		bindProp(__nsh_hv15, "style", () => ({
			...t.meta,
			color: c.muted()
		}));
		insert(__nsh_hv15, () => view().total === 0 ? "没有可显示的行" : view().truncated ? `显示最后 ${view().shown} 行（共 ${view().total} 行，已省略前 ${view().total - view().shown} 行）` : `显示最后 ${view().shown} 行`);
		const __nsh_hv16 = element("view");
		prop(__nsh_hv16, "style", { flex: 1 });
		const __nsh_hv17 = element("text");
		bindProp(__nsh_hv17, "style", () => ({
			...t.meta,
			color: c.muted()
		}));
		insert(__nsh_hv17, () => tail() === 5e3 ? "tail 全部（provider 上限 5000）" : `tail ${tail()}`);
		const __nsh_hv18 = element("text");
		bindProp(__nsh_hv18, "style", () => ({
			...t.meta,
			color: c.muted()
		}));
		const __nsh_hv19 = text("长行自动折行 · 可选中复制");
		append(__nsh_hv18, __nsh_hv19);
		append(__nsh_hv14, __nsh_hv15);
		append(__nsh_hv14, __nsh_hv16);
		append(__nsh_hv14, __nsh_hv17);
		append(__nsh_hv14, __nsh_hv18);
		append(__nsh_hv2, __nsh_hv3);
		append(__nsh_hv2, __nsh_hv10);
		append(__nsh_hv2, __nsh_hv14);
		insert(__nsh_hv2, () => error() !== null && raw() !== "" ? component(Row, {
			gap: 8,
			style: {
				alignItems: "center",
				paddingHorizontal: 14,
				paddingTop: 8,
				flexWrap: "wrap"
			},
			get children() {
				return [component(Notice, {
					get message() {
						return `刷新失败：${error()}`;
					},
					tone: "danger"
				}), component(Button, {
					label: "重试",
					small: true,
					onPress: () => void load(true)
				})];
			}
		}) : null, __nsh_hv10);
		return __nsh_hv2;
	})();
}
mount(LogViewer);

//#endregion
export { LogViewer as default };