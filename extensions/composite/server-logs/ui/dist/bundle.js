import { append, bindProp, component, element, insert, prop, setup, text } from "nsh:rt";
import { Storage, cleanup, effect, mount, nativeModule, signal, token } from "nsh";
import { Editor } from "nsh/base";

//#region \0nsh-app
setup(null, null, null, null, "{\"id\":\"com.navop.server-logs\",\"name\":\"服务器日志\",\"version\":\"0.4.3\",\"build\":9,\"development\":true}");

//#endregion
//#region ../../../../packages/extension-kit/src/theme.ts
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
	/** 侧栏专用的一组（shadcn 的 sidebar token：侧栏底色比页面稍深一点） */
	sidebar: () => token("sidebar"),
	sidebarText: () => token("sidebar-foreground"),
	sidebarActive: () => token("sidebar-accent"),
	sidebarActiveText: () => token("sidebar-accent-foreground"),
	sidebarLine: () => token("sidebar-border"),
	/** 输入框描边（比分割线深一档） */
	field: () => token("input"),
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
*
* 尺子：桌面应用的正文比网页小一档（13 是上限），层级靠字重和灰度拉开，
* 不靠字号跳变 —— 一屏里同时出现 22 / 17 / 14 / 11 会像后台管理面板。
*/
const t = {
	/** 页面标题：14/600，和 macOS 侧栏标题一个量级 */
	get h1() {
		return {
			fontSize: 14,
			fontWeight: "600",
			color: c.text()
		};
	},
	/** 分区标题：12/600 */
	get h2() {
		return {
			fontSize: 12,
			fontWeight: "600",
			color: c.text()
		};
	},
	/** 正文 */
	get body() {
		return {
			fontSize: 12.5,
			color: c.text()
		};
	},
	/** 列表主行 */
	get row() {
		return {
			fontSize: 13,
			fontWeight: "500",
			color: c.text()
		};
	},
	/** 分区标签 / 指标名：10/600 宽字距，靠灰度退到背景里 */
	get label() {
		return {
			fontSize: 10,
			fontWeight: "600",
			color: c.muted(),
			letterSpacing: .6
		};
	},
	/** 次要信息（时间、说明、计数） */
	get meta() {
		return {
			fontSize: 11,
			color: c.muted()
		};
	},
	/** 等宽数字：ID、端口、路径。正文色，保证别的扩展里当主内容用时不吃亏 */
	get mono() {
		return {
			fontSize: 11.5,
			color: c.text(),
			fontVariant: ["tabular-nums"]
		};
	},
	/** 等宽 + 退一档灰度：只作辅助信息（短 ID、镜像、路径、IP） */
	get monoDim() {
		return {
			fontSize: 11,
			color: c.muted(),
			fontVariant: ["tabular-nums"]
		};
	}
};

//#endregion
//#region ../../../../packages/extension-kit/src/ui.tsx
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
/** 按钮：三种语气，外观自己画（nsh/base 的 Button 只管无障碍语义）。 */
function Button(props) {
	return (() => {
		const __nsh_hv12 = element("view");
		bindProp(__nsh_hv12, "onPress", () => pick(props.disabled ?? false) ? void 0 : props.onPress);
		prop(__nsh_hv12, "role", "button");
		bindProp(__nsh_hv12, "accessibilityLabel", () => props.label);
		bindProp(__nsh_hv12, "hoverStyle", () => pick(props.tone ?? "ghost") === "primary" ? void 0 : { backgroundColor: pick(props.disabled ?? false) ? "transparent" : c.hover() });
		bindProp(__nsh_hv12, "style", () => ({
			height: props.small ? 22 : 26,
			paddingHorizontal: props.small ? 8 : 11,
			borderRadius: r.control,
			borderWidth: pick(props.tone ?? "ghost") === "ghost" ? 0 : 1,
			borderColor: buttonBorder(pick(props.tone ?? "ghost")),
			backgroundColor: buttonFill(pick(props.tone ?? "ghost")),
			opacity: pick(props.disabled ?? false) ? .45 : 1,
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			cursor: "default"
		}));
		const __nsh_hv13 = element("text");
		bindProp(__nsh_hv13, "style", () => ({
			fontSize: 12,
			fontWeight: "500",
			color: buttonLabel(pick(props.tone ?? "ghost"), pick(props.disabled ?? false))
		}));
		insert(__nsh_hv13, () => props.label);
		append(__nsh_hv12, __nsh_hv13);
		return __nsh_hv12;
	})();
}
/** 空状态：一句解释 + 可选的下一步提示。 */
function Empty(props) {
	return (() => {
		const __nsh_hv25 = element("view");
		prop(__nsh_hv25, "style", {
			flex: 1,
			display: "flex",
			flexDirection: "column",
			alignItems: "center",
			justifyContent: "center",
			gap: 6,
			padding: 24
		});
		const __nsh_hv26 = element("text");
		bindProp(__nsh_hv26, "style", () => ({
			fontSize: 13,
			fontWeight: "500",
			color: c.text()
		}));
		insert(__nsh_hv26, () => props.title);
		append(__nsh_hv25, __nsh_hv26);
		insert(__nsh_hv25, [() => props.hint === void 0 ? null : (() => {
			const __nsh_hv27 = element("text");
			bindProp(__nsh_hv27, "style", () => ({
				fontSize: 11.5,
				color: c.muted(),
				textAlign: "center",
				maxWidth: 320
			}));
			insert(__nsh_hv27, () => props.hint);
			return __nsh_hv27;
		})(), () => props.action]);
		return __nsh_hv25;
	})();
}
/** 加载中：一行说明（列表为空时占满可用高度）。 */
function Loading(props) {
	return (() => {
		const __nsh_hv28 = element("view");
		prop(__nsh_hv28, "style", {
			flex: 1,
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center",
			gap: 8,
			padding: 24
		});
		const __nsh_hv29 = element("text");
		bindProp(__nsh_hv29, "style", () => ({
			fontSize: 11.5,
			color: c.muted()
		}));
		insert(__nsh_hv29, () => props.label ?? "Loading…");
		append(__nsh_hv28, __nsh_hv29);
		return __nsh_hv28;
	})();
}
/** 图标按钮：单字形，无描边，hover 出底色。用于刷新/关闭这类高频小操作。 */
function IconButton(props) {
	const danger = props.tone === "danger";
	return (() => {
		const __nsh_hv49 = element("view");
		prop(__nsh_hv49, "role", "button");
		bindProp(__nsh_hv49, "onPress", () => pick(props.disabled ?? false) ? void 0 : props.onPress);
		bindProp(__nsh_hv49, "accessibilityLabel", () => props.label ?? props.glyph);
		bindProp(__nsh_hv49, "hoverStyle", () => ({ backgroundColor: c.hover() }));
		bindProp(__nsh_hv49, "activeStyle", () => ({ backgroundColor: c.sidebarActive() }));
		bindProp(__nsh_hv49, "style", () => ({
			width: props.size ?? 26,
			height: props.size ?? 26,
			flexShrink: 0,
			alignItems: "center",
			justifyContent: "center",
			borderRadius: r.control,
			backgroundColor: "transparent",
			cursor: "default",
			opacity: pick(props.disabled ?? false) ? .4 : 1
		}));
		const __nsh_hv50 = element("text");
		bindProp(__nsh_hv50, "style", () => ({
			fontSize: 13,
			fontWeight: "500",
			color: danger ? c.danger() : c.text()
		}));
		insert(__nsh_hv50, () => props.glyph);
		append(__nsh_hv49, __nsh_hv50);
		return __nsh_hv49;
	})();
}
/** 一行提示（操作结果/错误），`tone` 决定颜色。 */
function Notice(props) {
	return (() => {
		const __nsh_hv71 = element("text");
		bindProp(__nsh_hv71, "style", () => ({
			fontSize: 11.5,
			color: props.tone === void 0 ? c.muted() : toneColor(pick(props.tone))
		}));
		insert(__nsh_hv71, () => props.message);
		return __nsh_hv71;
	})();
}

//#endregion
//#region ../../../../packages/extension-kit/src/format.ts
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
//#region ../../../../packages/extension-kit/src/native.ts
/** UI set 的名字；宿主侧 `native_api::UI_SET` 与之对应。 */
const NATIVE_SPECIFIER = "navop";
let cached = null;
/**
* 取 navop 的能力面。首次调用时向 nsh 解析（未装 UI set 会抛
* `ReferenceError`）；之后复用同一个对象。
*/
function navopNative() {
	if (cached === null) cached = nativeModule(NATIVE_SPECIFIER);
	return cached;
}

//#endregion
//#region ../../../../packages/extension-kit/src/api.ts
/** 列出宿主里的终端会话。 */
async function listTerminals() {
	return (await navopNative().Terminal.list())?.sessions ?? [];
}
/**
* 在一个已经开着的终端里执行命令并等输出。
*
* 这条命令走用户的 shell（复用它的 cwd、环境、代理与别名），本地终端和
* SSH 终端都可以。`submit: false` 只写入不回车；`waitForOutput: false`
* 只提交不等输出。
*
* 要拿结构化 stdout/stderr、或要在远端跑后台任务，用 {@link sshExec}。
*/
async function execInTerminal(options) {
	return await navopNative().Terminal.exec(options);
}
/**
* 在 SSH 会话上执行一条命令（独立调用，stdout / stderr 分开）。
*
* `mode: "background"` 会立刻返回并带上 `commandId`，之后用
* {@link pollSshCommand} / {@link readSshCommand} / {@link cancelSshCommand}
* 跟进——这几个方法还没接到扩展能力面，需要的话先在宿主侧补。
*/
async function sshExec(options) {
	return await navopNative().Terminal.sshExec(options);
}

//#endregion
//#region lib/server.ts
const COMMAND_TIMEOUT_MS = 15e3;
function toTarget(session) {
	return {
		sessionId: session.sessionId,
		label: session.host ?? session.title ?? session.sessionId,
		ssh: session.kind === "Ssh"
	};
}
/** 已连接的会话就是可选的服务器；缺省取第一个。 */
async function listServerTargets() {
	return (await listTerminals()).filter((session) => session.connected).map(toTarget);
}
/** 单引号包裹 + 内部转义：路径/关键字不会被 shell 当成命令注入。 */
function shellQuote(value) {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
async function runServerCommand(target, command, timeoutMs = COMMAND_TIMEOUT_MS) {
	if (target.ssh) {
		const result = await sshExec({
			sessionId: target.sessionId,
			command,
			timeoutMs
		});
		if (result.timedOut) throw new Error(`命令超时（${timeoutMs}ms）：${command}`);
		return {
			stdout: result.stdout,
			stderr: result.stderr,
			exitCode: result.exitCode,
			status: result.status
		};
	}
	const result = await execInTerminal({
		sessionId: target.sessionId,
		command,
		timeoutMs
	});
	return {
		stdout: result.output,
		stderr: "",
		exitCode: result.exitCode
	};
}
/** 命令失败时给出可读原因。宿主的 SSH 通道正常结束时 exitCode 也可能
* 是 null（远端未上报退出码），不能把 stdout 当成错误展示。 */
function commandFailure(result, fallback) {
	if (result.status === "failed" || result.status === "cancelled") return result.stderr.trim() || result.stdout.trim() || fallback;
	if (result.exitCode === null || result.exitCode === 0) return null;
	const detail = result.stderr.trim() || result.stdout.trim();
	return detail.length > 0 ? detail : `${fallback}（exit ${result.exitCode}）`;
}
function nowClock() {
	const now = /* @__PURE__ */ new Date();
	const two = (value) => String(value).padStart(2, "0");
	return `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
}

//#endregion
//#region pages/logs/App.tsx
const FOLLOW_MS = 2e3;
const MAX_RECORDS = 64;
const STORAGE_PREFIX = "records:";
/** 行数只接受 1..=5000 的整数，解析失败回退 200。
*
* 存储里的记录是用户可改的（也来自旧版本），读回时必须和输入时一样收敛，
* 否则这个值会被拼进 `tail -n` 命令。
*/
function clampLines(value) {
	const parsed = parseInt(value, 10);
	return String(isNaN(parsed) ? 200 : Math.min(5e3, Math.max(1, parsed)));
}
function parseRecords(json) {
	if (!json) return [];
	try {
		const value = JSON.parse(json);
		if (!Array.isArray(value)) return [];
		return value.flatMap((item) => {
			const record = item;
			if (typeof record.id !== "string" || typeof record.path !== "string") return [];
			if (!record.path.startsWith("/")) return [];
			return [{
				id: record.id,
				name: typeof record.name === "string" && record.name ? record.name : record.path,
				path: record.path,
				lines: clampLines(typeof record.lines === "string" ? record.lines : "200"),
				filter: typeof record.filter === "string" ? record.filter : ""
			}];
		});
	} catch {
		return [];
	}
}
function serializeRecords(records) {
	return JSON.stringify(records);
}
function normalizeRecord(record) {
	return {
		name: record.name.trim() || record.path.trim(),
		path: record.path.trim(),
		lines: clampLines(record.lines),
		filter: record.filter
	};
}
function recordValidationError(draft, records, editingId) {
	if (!draft.path.startsWith("/")) return "日志文件必须使用以 / 开头的绝对路径";
	if (records.length >= MAX_RECORDS && editingId === "new") return `最多保存 ${MAX_RECORDS} 条记录`;
	return records.some((record) => record.path === draft.path && record.id !== editingId) ? "这个日志文件已经有记录了" : null;
}
function logCommand(path, lines, filter) {
	let command = `tail -n ${clampLines(lines)} ${shellQuote(path)}`;
	const needle = filter.trim();
	if (needle.length > 0) command += ` | grep -i -F -- ${shellQuote(needle)}`;
	return command;
}
function Field(props) {
	return (() => {
		const __nsh_hv0 = element("view");
		bindProp(__nsh_hv0, "style", () => ({
			height: 28,
			paddingHorizontal: 8,
			borderRadius: r.control,
			backgroundColor: c.hover(),
			justifyContent: "center"
		}));
		const __nsh_hv1 = element("input");
		bindProp(__nsh_hv1, "value", () => props.value);
		bindProp(__nsh_hv1, "placeholder", () => props.placeholder);
		bindProp(__nsh_hv1, "accessibilityLabel", () => props.label);
		prop(__nsh_hv1, "onChange", (event) => props.onChange(event.value));
		bindProp(__nsh_hv1, "style", () => ({
			fontSize: 12,
			color: c.text(),
			placeholderColor: c.muted(),
			caretColor: c.text(),
			borderWidth: 0,
			backgroundColor: "transparent"
		}));
		append(__nsh_hv0, __nsh_hv1);
		return __nsh_hv0;
	})();
}
function ServerLogs() {
	const targets = signal([]);
	const targetId = signal(null);
	const records = signal([]);
	const selectedId = signal(null);
	const editing = signal(null);
	const formName = signal("");
	const formPath = signal("");
	const formLines = signal("200");
	const formFilter = signal("");
	const formError = signal(null);
	const content = signal("");
	const query = signal("");
	const caseSensitive = signal(false);
	const wholeWord = signal(false);
	const regex = signal(false);
	const searchResult = signal({ count: 0 });
	let editor;
	const loading = signal(false);
	const busy = signal(false);
	const error = signal(null);
	const follow = signal(true);
	const updatedAt = signal("");
	let seq = 0;
	function currentTarget() {
		return targets().find((item) => item.sessionId === targetId()) ?? targets()[0] ?? null;
	}
	function storageKey() {
		return STORAGE_PREFIX + (currentTarget()?.label ?? "default");
	}
	function selected() {
		return records().find((record) => record.id === selectedId()) ?? null;
	}
	async function persist(next) {
		records.set(next);
		await Storage.setItem(storageKey(), serializeRecords(next));
	}
	async function loadRecords() {
		const stored = parseRecords(await Storage.getItem(storageKey()));
		records.set(stored);
		selectedId.set(stored[0]?.id ?? null);
		content.set("");
		error.set(null);
		if (stored.length > 0) await load(true);
	}
	async function load(force = false) {
		const target = currentTarget();
		const record = selected();
		if (!target || !record) return;
		if (busy() && !force) return;
		const mine = ++seq;
		busy.set(true);
		try {
			const result = await runServerCommand(target, logCommand(record.path, record.lines, record.filter));
			if (mine !== seq) return;
			const failure = commandFailure(result, "读取日志失败");
			if (failure !== null) error.set(failure);
			else {
				content.set(result.stdout);
				error.set(null);
				updatedAt.set(nowClock());
			}
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
	async function init() {
		loading.set(true);
		try {
			const list = await listServerTargets();
			targets.set(list);
			if (list.length > 0 && targetId() === null) targetId.set(list[0].sessionId);
		} catch (failure) {
			error.set(errorMessage(failure));
		}
		try {
			await loadRecords();
		} catch (failure) {
			error.set(errorMessage(failure));
		} finally {
			loading.set(false);
		}
	}
	async function selectTarget(id) {
		if (targetId() === id) return;
		targetId.set(id);
		seq += 1;
		busy.set(false);
		await loadRecords();
	}
	function selectRecord(id) {
		if (selectedId() === id) return;
		selectedId.set(id);
		editing.set(null);
		content.set("");
		error.set(null);
		load(true);
	}
	function openEditor(mode) {
		const record = selected();
		formError.set(null);
		if (mode === "edit" && record) {
			formName.set(record.name);
			formPath.set(record.path);
			formLines.set(record.lines);
			formFilter.set(record.filter);
			editing.set(record.id);
			return;
		}
		formName.set("");
		formPath.set("");
		formLines.set("200");
		formFilter.set("");
		editing.set("new");
	}
	async function saveRecord() {
		const draft = normalizeRecord({
			name: formName(),
			path: formPath(),
			lines: formLines(),
			filter: formFilter()
		});
		const invalid = recordValidationError(draft, records(), editing());
		if (invalid !== null) {
			formError.set(invalid);
			return;
		}
		const mode = editing();
		const next = mode === "new" ? [...records(), {
			...draft,
			id: `log-${Date.now()}`
		}] : records().map((record) => record.id === mode ? {
			...draft,
			id: record.id
		} : record);
		await persist(next);
		editing.set(null);
		const saved = mode === "new" ? next[next.length - 1] : next.find((record) => record.id === mode);
		if (saved) {
			selectedId.set(saved.id);
			content.set("");
			load(true);
		}
	}
	async function removeSelected() {
		const record = selected();
		if (!record) return;
		const next = records().filter((item) => item.id !== record.id);
		await persist(next);
		selectedId.set(next[0]?.id ?? null);
		content.set("");
		error.set(null);
		if (next.length > 0) load(true);
	}
	effect(() => {
		if (!follow()) return;
		const timer = setInterval(() => void load(), FOLLOW_MS);
		cleanup(() => clearInterval(timer));
	});
	init();
	const shownLines = () => {
		const text = content();
		if (text.length === 0) return [];
		return (text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n")).slice(-1e3);
	};
	const shownText = () => shownLines().join("\n");
	const searchSummary = () => {
		if (!query()) return "";
		const result = searchResult();
		if (result.error) return "正则表达式无效";
		if (result.count === 0) return "没有匹配";
		return result.current === void 0 || result.current === null ? `${result.count} 处匹配` : `${result.current + 1} / ${result.count}`;
	};
	return (() => {
		const __nsh_hv2 = element("view");
		bindProp(__nsh_hv2, "style", () => ({
			flex: 1,
			minHeight: 0,
			minWidth: 0,
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		insert(__nsh_hv2, [
			component(Row, {
				gap: 8,
				get style() {
					return {
						height: 40,
						paddingHorizontal: 12,
						borderBottomWidth: 1,
						borderBottomColor: c.line(),
						flexShrink: 0
					};
				},
				get children() {
					return [
						(() => {
							const __nsh_hv3 = element("text");
							bindProp(__nsh_hv3, "style", () => ({
								...t.h2,
								flexShrink: 0
							}));
							const __nsh_hv4 = text("服务器日志");
							append(__nsh_hv3, __nsh_hv4);
							return __nsh_hv3;
						})(),
						(() => {
							const __nsh_hv5 = element("text");
							bindProp(__nsh_hv5, "style", () => ({
								...t.meta,
								flex: 1,
								minWidth: 0
							}));
							insert(__nsh_hv5, () => currentTarget()?.label ?? "未连接");
							return __nsh_hv5;
						})(),
						component(Button, {
							get label() {
								return follow() ? "停止跟随" : "跟随";
							},
							small: true,
							get tone() {
								return follow() ? "primary" : "ghost";
							},
							onPress: () => follow.set(!follow())
						}),
						component(IconButton, {
							glyph: "⟳",
							label: "刷新日志",
							onPress: () => void load(true),
							get disabled() {
								return busy();
							}
						})
					];
				}
			}),
			() => targets().length > 1 ? (() => {
				const __nsh_hv6 = element("scroll");
				prop(__nsh_hv6, "horizontal", true);
				prop(__nsh_hv6, "style", {
					flexShrink: 0,
					maxHeight: 38
				});
				insert(__nsh_hv6, component(Row, {
					gap: 6,
					style: {
						paddingHorizontal: 12,
						paddingVertical: 5
					},
					get children() {
						return targets().map((item) => component(Button, {
							get label() {
								return item.label;
							},
							small: true,
							get tone() {
								return item.sessionId === currentTarget()?.sessionId ? "primary" : "ghost";
							},
							onPress: () => void selectTarget(item.sessionId)
						}));
					}
				}));
				return __nsh_hv6;
			})() : null,
			component(Row, {
				align: "stretch",
				style: {
					flex: 1,
					minHeight: 0,
					minWidth: 0,
					gap: 0
				},
				get children() {
					return [(() => {
						const __nsh_hv7 = element("view");
						bindProp(__nsh_hv7, "style", () => ({
							width: 230,
							flexShrink: 0,
							minHeight: 0,
							borderRightWidth: 1,
							borderRightColor: c.line(),
							flexDirection: "column"
						}));
						const __nsh_hv10 = element("scroll");
						prop(__nsh_hv10, "style", {
							flex: 1,
							minHeight: 0
						});
						const __nsh_hv11 = element("view");
						prop(__nsh_hv11, "style", {
							paddingHorizontal: 6,
							paddingBottom: 6,
							flexDirection: "column",
							gap: 3
						});
						insert(__nsh_hv11, [() => records().map((record) => (() => {
							const __nsh_hv12 = element("view");
							prop(__nsh_hv12, "role", "button");
							bindProp(__nsh_hv12, "accessibilityLabel", () => record.name);
							prop(__nsh_hv12, "onPress", () => selectRecord(record.id));
							bindProp(__nsh_hv12, "style", () => ({
								paddingHorizontal: 8,
								paddingVertical: 7,
								borderRadius: r.control,
								backgroundColor: record.id === selectedId() ? c.hover() : "transparent",
								flexDirection: "column",
								gap: 2
							}));
							const __nsh_hv13 = element("text");
							bindProp(__nsh_hv13, "style", () => ({
								fontSize: 12,
								fontWeight: "500",
								color: c.text()
							}));
							insert(__nsh_hv13, () => record.name);
							const __nsh_hv14 = element("text");
							bindProp(__nsh_hv14, "style", () => ({
								...t.mono,
								fontSize: 10,
								color: c.muted()
							}));
							insert(__nsh_hv14, () => record.path);
							append(__nsh_hv12, __nsh_hv13);
							append(__nsh_hv12, __nsh_hv14);
							return __nsh_hv12;
						})()), () => records().length === 0 && !loading() ? (() => {
							const __nsh_hv15 = element("text");
							bindProp(__nsh_hv15, "style", () => ({
								...t.meta,
								padding: 8
							}));
							const __nsh_hv16 = text("还没有记录，点右上角 + 新建。");
							append(__nsh_hv15, __nsh_hv16);
							return __nsh_hv15;
						})() : null]);
						append(__nsh_hv10, __nsh_hv11);
						append(__nsh_hv7, __nsh_hv10);
						insert(__nsh_hv7, component(Row, {
							style: {
								height: 38,
								paddingHorizontal: 8,
								justifyContent: "space-between",
								flexShrink: 0
							},
							get children() {
								return [(() => {
									const __nsh_hv8 = element("text");
									bindProp(__nsh_hv8, "style", () => t.label);
									const __nsh_hv9 = text("日志文件");
									append(__nsh_hv8, __nsh_hv9);
									return __nsh_hv8;
								})(), component(IconButton, {
									glyph: "+",
									label: "新建记录",
									onPress: () => openEditor("new")
								})];
							}
						}), __nsh_hv10);
						return __nsh_hv7;
					})(), (() => {
						const __nsh_hv17 = element("view");
						prop(__nsh_hv17, "style", {
							flex: 1,
							minWidth: 0,
							minHeight: 0,
							flexDirection: "column"
						});
						insert(__nsh_hv17, [
							() => selected() !== null && editing() === null ? component(Row, {
								gap: 6,
								style: {
									paddingHorizontal: 10,
									paddingVertical: 7,
									flexShrink: 0
								},
								get children() {
									return [
										(() => {
											const __nsh_hv18 = element("text");
											bindProp(__nsh_hv18, "style", () => ({
												...t.meta,
												flex: 1,
												minWidth: 0
											}));
											insert(__nsh_hv18, () => `${selected()?.path} · ${selected()?.lines} 行${selected()?.filter ? ` · 过滤 ${selected()?.filter}` : ""}`);
											return __nsh_hv18;
										})(),
										component(Button, {
											label: "编辑",
											small: true,
											onPress: () => openEditor("edit")
										}),
										component(Button, {
											label: "删除",
											small: true,
											tone: "danger",
											onPress: () => void removeSelected()
										})
									];
								}
							}) : null,
							() => editing() !== null ? (() => {
								const __nsh_hv19 = element("view");
								bindProp(__nsh_hv19, "style", () => ({
									margin: 10,
									padding: 10,
									borderWidth: 1,
									borderColor: c.line(),
									borderRadius: r.card,
									flexDirection: "column",
									gap: 7,
									flexShrink: 0
								}));
								const __nsh_hv20 = element("text");
								bindProp(__nsh_hv20, "style", () => t.label);
								insert(__nsh_hv20, () => editing() === "new" ? "新建日志记录" : "编辑日志记录");
								append(__nsh_hv19, __nsh_hv20);
								insert(__nsh_hv19, [
									component(Field, {
										get value() {
											return formName();
										},
										placeholder: "名称（如 nginx 错误日志）",
										label: "日志记录名称",
										get onChange() {
											return formName.set;
										}
									}),
									component(Field, {
										get value() {
											return formPath();
										},
										placeholder: "绝对路径（如 /var/log/nginx/error.log）",
										label: "日志文件路径",
										get onChange() {
											return formPath.set;
										}
									}),
									component(Field, {
										get value() {
											return formLines();
										},
										placeholder: "读取行数（默认 200）",
										label: "日志读取行数",
										get onChange() {
											return formLines.set;
										}
									}),
									component(Field, {
										get value() {
											return formFilter();
										},
										placeholder: "远端过滤关键字（可空）",
										label: "日志过滤关键字",
										get onChange() {
											return formFilter.set;
										}
									}),
									() => formError() !== null ? component(Notice, {
										get message() {
											return formError() ?? "";
										},
										tone: "danger"
									}) : null,
									component(Row, {
										gap: 8,
										get children() {
											return [component(Button, {
												label: "保存记录",
												small: true,
												tone: "primary",
												onPress: () => void saveRecord()
											}), component(Button, {
												label: "取消",
												small: true,
												onPress: () => editing.set(null)
											})];
										}
									})
								]);
								return __nsh_hv19;
							})() : null,
							() => records().length > 0 ? (() => {
								const __nsh_hv21 = element("view");
								prop(__nsh_hv21, "style", {
									marginHorizontal: 10,
									marginBottom: 6,
									flexShrink: 0,
									gap: 5
								});
								insert(__nsh_hv21, component(Row, {
									gap: 5,
									get children() {
										return [
											(() => {
												const __nsh_hv22 = element("view");
												prop(__nsh_hv22, "style", {
													flex: 1,
													minWidth: 0
												});
												insert(__nsh_hv22, component(Field, {
													get value() {
														return query();
													},
													placeholder: "搜索日志（支持正则）",
													label: "搜索日志输出",
													get onChange() {
														return query.set;
													}
												}));
												return __nsh_hv22;
											})(),
											component(Button, {
												label: "Aa",
												small: true,
												get tone() {
													return caseSensitive() ? "primary" : "ghost";
												},
												onPress: () => caseSensitive.set(!caseSensitive())
											}),
											component(Button, {
												label: "W",
												small: true,
												get tone() {
													return wholeWord() && !regex() ? "primary" : "ghost";
												},
												get disabled() {
													return regex();
												},
												onPress: () => wholeWord.set(!wholeWord())
											}),
											component(Button, {
												label: ".*",
												small: true,
												get tone() {
													return regex() ? "primary" : "ghost";
												},
												onPress: () => regex.set(!regex())
											}),
											component(IconButton, {
												glyph: "↑",
												label: "上一个匹配",
												get disabled() {
													return !query() || searchResult().count === 0;
												},
												onPress: () => editor?.run("findPrevious")
											}),
											component(IconButton, {
												glyph: "↓",
												label: "下一个匹配",
												get disabled() {
													return !query() || searchResult().count === 0;
												},
												onPress: () => editor?.run("findNext")
											}),
											(() => {
												const __nsh_hv23 = element("text");
												bindProp(__nsh_hv23, "style", () => t.meta);
												insert(__nsh_hv23, () => searchSummary());
												return __nsh_hv23;
											})()
										];
									}
								}));
								return __nsh_hv21;
							})() : null,
							() => error() !== null ? (() => {
								const __nsh_hv24 = element("view");
								prop(__nsh_hv24, "style", {
									paddingHorizontal: 10,
									paddingBottom: 6
								});
								insert(__nsh_hv24, component(Notice, {
									get message() {
										return error() ?? "";
									},
									tone: "danger"
								}));
								return __nsh_hv24;
							})() : null,
							() => records().length === 0 && !loading() ? component(Empty, {
								title: "为这台服务器添加日志文件",
								hint: "记录按服务器分别保存。名称用于识别，路径必须是服务器上的绝对路径。",
								get action() {
									return component(Button, {
										label: "新建一条记录",
										small: true,
										tone: "primary",
										onPress: () => openEditor("new")
									});
								}
							}) : selected() === null ? component(Empty, { title: "选择左侧的日志文件" }) : loading() && content() === "" ? component(Loading, { label: "正在读取日志…" }) : (() => {
								const __nsh_hv25 = element("view");
								prop(__nsh_hv25, "style", {
									flex: 1,
									minHeight: 0
								});
								insert(__nsh_hv25, component(Editor, {
									style: {
										flex: 1,
										minHeight: 0
									},
									ref: (ref) => editor = ref,
									get value() {
										return shownText();
									},
									readOnly: true,
									lineNumbers: true,
									softWrap: false,
									folding: false,
									activeLine: false,
									completion: false,
									highlighting: false,
									fontSize: 11,
									lineHeight: 18,
									scrollBeyondLastLine: false,
									placeholder: "（当前日志为空）",
									accessibilityLabel: "服务器日志正文编辑器",
									get search() {
										return {
											query: query(),
											caseSensitive: caseSensitive(),
											wholeWord: wholeWord(),
											regex: regex()
										};
									},
									onSearchChange: ({ result }) => searchResult.set(result),
									onFindWithSelection: ({ query: value }) => query.set(value),
									get styles() {
										return {
											content: {
												backgroundColor: c.bg(),
												padding: 6
											},
											line: { color: c.text() },
											gutter: {
												backgroundColor: c.bg(),
												paddingRight: 6
											},
											lineNumber: {
												color: c.muted(),
												fontSize: 10
											}
										};
									}
								}));
								return __nsh_hv25;
							})(),
							component(Row, {
								style: {
									paddingHorizontal: 10,
									paddingVertical: 5,
									flexShrink: 0,
									justifyContent: "space-between"
								},
								get children() {
									return [(() => {
										const __nsh_hv26 = element("text");
										bindProp(__nsh_hv26, "style", () => t.meta);
										insert(__nsh_hv26, () => `${shownLines().length} 行`);
										return __nsh_hv26;
									})(), (() => {
										const __nsh_hv27 = element("text");
										bindProp(__nsh_hv27, "style", () => t.meta);
										insert(__nsh_hv27, () => updatedAt() ? `更新于 ${updatedAt()}` : "");
										return __nsh_hv27;
									})()];
								}
							})
						]);
						return __nsh_hv17;
					})()];
				}
			})
		]);
		return __nsh_hv2;
	})();
}

//#endregion
//#region App.tsx
function App() {
	return component(ServerLogs, {});
}
mount(App);

//#endregion
export { App as default };