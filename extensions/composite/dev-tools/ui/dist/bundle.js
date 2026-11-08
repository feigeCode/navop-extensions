import { append, bindProp, component, element, insert, prop, text } from "nsh:rt";
import { host, mount, signal, token } from "nsh";

//#region ../../../../packages/extension-kit/src/navop.ts
/** 启动事实：模块顶层读一次即可。 */
const params = host.params;
/** 当前页面的 view 身份。 */
const extension = params.extension ?? {
	id: "",
	title: ""
};
/** 可用的 runtime alias。 */
const backends = params.backends ?? [];
/** 写一条宿主日志：单向通知，不等应答。 */
function log(level, message, fields) {
	const payload = {
		level,
		message
	};
	if (fields) payload.fields = fields;
	host.post("navop.log", payload);
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
/** 状态胶囊：底色填充，不描边（描边胶囊一多就成"盒子汤"）。 */
function Badge(props) {
	return (() => {
		const __nsh_hv9 = element("view");
		bindProp(__nsh_hv9, "style", () => ({
			height: 18,
			paddingHorizontal: 7,
			borderRadius: r.pill,
			backgroundColor: c.hover(),
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			gap: 4
		}));
		const __nsh_hv10 = element("text");
		bindProp(__nsh_hv10, "style", () => ({
			fontSize: 10.5,
			fontWeight: "600",
			color: pick(props.tone ?? "neutral") === "neutral" ? c.muted() : toneColor(pick(props.tone ?? "neutral"))
		}));
		insert(__nsh_hv10, () => props.text);
		append(__nsh_hv9, __nsh_hv10);
		insert(__nsh_hv9, () => props.dot ? component(Dot, { get color() {
			return toneColor(pick(props.tone ?? "neutral"));
		} }) : null, __nsh_hv10);
		return __nsh_hv9;
	})();
}
/** 小圆点：状态色。 */
function Dot(props) {
	return (() => {
		const __nsh_hv11 = element("view");
		bindProp(__nsh_hv11, "style", () => ({
			width: props.size ?? 6,
			height: props.size ?? 6,
			flexShrink: 0,
			borderRadius: 999,
			backgroundColor: pick(props.color)
		}));
		return __nsh_hv11;
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
/** 搜索框。`onChange` 拿到的是整串新值。 */
function SearchField(props) {
	return (() => {
		const __nsh_hv14 = element("view");
		bindProp(__nsh_hv14, "style", () => ({
			flexDirection: "row",
			alignItems: "center",
			gap: 5,
			height: 26,
			width: props.width ?? 180,
			paddingHorizontal: 8,
			borderRadius: r.control,
			backgroundColor: c.hover()
		}));
		const __nsh_hv15 = element("text");
		bindProp(__nsh_hv15, "style", () => ({
			fontSize: 11,
			color: c.muted()
		}));
		const __nsh_hv16 = text("⌕");
		append(__nsh_hv15, __nsh_hv16);
		const __nsh_hv17 = element("input");
		bindProp(__nsh_hv17, "value", () => props.value);
		bindProp(__nsh_hv17, "placeholder", () => props.placeholder ?? "Filter…");
		prop(__nsh_hv17, "onChange", (text) => props.onChange(text));
		prop(__nsh_hv17, "style", {
			flex: 1,
			fontSize: 11.5,
			paddingHorizontal: 0,
			borderWidth: 0,
			backgroundColor: "transparent"
		});
		append(__nsh_hv14, __nsh_hv15);
		append(__nsh_hv14, __nsh_hv17);
		return __nsh_hv14;
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
/** 失败态：原因 + 重试。错误文案保留原文，便于用户搜索。 */
function LoadError(props) {
	return (() => {
		const __nsh_hv30 = element("view");
		prop(__nsh_hv30, "style", {
			display: "flex",
			flexDirection: "column",
			gap: 8,
			padding: 16
		});
		const __nsh_hv31 = element("text");
		bindProp(__nsh_hv31, "style", () => ({
			fontSize: 12.5,
			color: c.danger()
		}));
		insert(__nsh_hv31, () => `加载失败：${props.message}`);
		append(__nsh_hv30, __nsh_hv31);
		insert(__nsh_hv30, () => props.onRetry === void 0 ? null : component(Row, { get children() {
			return component(Button, {
				label: "重试",
				get onPress() {
					return props.onRetry;
				}
			});
		} }));
		return __nsh_hv30;
	})();
}
/** 分区标题（列表上方的分组名）。 */
function SectionTitle(props) {
	return component(Row, {
		style: {
			justifyContent: "space-between",
			paddingBottom: 2
		},
		get children() {
			return [component(Row, {
				gap: 8,
				get children() {
					return [(() => {
						const __nsh_hv44 = element("text");
						bindProp(__nsh_hv44, "style", () => t.label);
						insert(__nsh_hv44, () => props.title);
						return __nsh_hv44;
					})(), () => props.hint === void 0 ? null : (() => {
						const __nsh_hv45 = element("text");
						bindProp(__nsh_hv45, "style", () => t.meta);
						insert(__nsh_hv45, () => props.hint);
						return __nsh_hv45;
					})()];
				}
			}), () => props.right];
		}
	});
}
/** 确认条：危险操作执行前的内联二次确认（不用弹出对话框）。 */
function ConfirmBar(props) {
	return component(Row, {
		gap: 8,
		get style() {
			return {
				paddingHorizontal: 10,
				paddingVertical: 8,
				borderWidth: 1,
				borderColor: c.danger(),
				borderRadius: r.control
			};
		},
		get children() {
			return [
				(() => {
					const __nsh_hv70 = element("text");
					bindProp(__nsh_hv70, "style", () => ({
						flex: 1,
						minWidth: 0,
						fontSize: 12,
						color: c.text()
					}));
					insert(__nsh_hv70, () => props.message);
					return __nsh_hv70;
				})(),
				component(Button, {
					label: "取消",
					get onPress() {
						return props.onCancel;
					},
					small: true
				}),
				component(Button, {
					get label() {
						return props.busy ? "执行中…" : props.confirmLabel;
					},
					tone: "danger",
					get onPress() {
						return props.onConfirm;
					},
					get disabled() {
						return props.busy;
					},
					small: true
				})
			];
		}
	});
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
//#region pages/workbench/App.tsx
/** 日志面板的行数档位。 */
const LOG_TAILS = [
	100,
	200,
	500
];
const projectRoot = (project) => str(project, "root", "");
const projectName = (project) => {
	const name = str(project, "name", "");
	return name.length > 0 ? name : "未命名工程";
};
/** `navop.dev.list` 的一项里 app 的面貌；`null` 表示这个工程的 extension.json 没有 shellApp。 */
const projectApp = (project) => {
	const app = project["app"];
	if (app === null || app === void 0 || typeof app !== "object" || Array.isArray(app)) return null;
	const title = str(app, "title", "");
	return { title: title.length > 0 ? title : "未命名应用" };
};
const projectWatching = (project) => project.watching === true;
/** `{error: string | null}` 里的失败信息；没有失败就是 null。 */
function failureOf(result) {
	const text = str(result, "error", "");
	return text.length > 0 && text !== "null" ? text : null;
}
/** 宿主超时/拒绝都要能变成一句人话。 */
async function callHost(name, payload) {
	try {
		return await host.call(name, payload ?? {});
	} catch (error) {
		throw new Error(errorMessage(error));
	}
}
/** 宿主日志通道是单向通知：不等应答，也不会因为写不进去而拖住页面。 */
function logInfo(message) {
	log("info", message);
}
function delay(ms) {
	return new Promise((resolve) => {
		setTimeout(() => resolve(), ms);
	});
}
function DevWorkbench() {
	const projects = signal([]);
	const selectedRoot = signal(null);
	const query = signal("");
	const loading = signal(true);
	const refreshing = signal(false);
	const error = signal(null);
	const status = signal(null);
	const picking = signal(false);
	const busy = signal(false);
	const confirmRemove = signal(false);
	const openingApp = signal(null);
	const logRoot = signal(null);
	const logLines = signal([]);
	const logTail = signal(200);
	const logAuto = signal(false);
	const logLoading = signal(false);
	/** 自动刷新的 interval；组件只挂载一次，闭包变量就够了。 */
	let logTimer = null;
	/** 上一次「取列表」失败的信息：只有它还挂在 error 上时才由成功的刷新清除，
	*  避免把「打开工程失败」这类操作错误的提示顺手抹掉。 */
	let listError = null;
	async function refresh() {
		if (refreshing()) return;
		refreshing.set(true);
		try {
			const result = await callHost("navop.dev.list");
			const list = Array.isArray(result) ? result : arr(result, "projects");
			projects.set(list);
			if (listError !== null && error() === listError) error.set(null);
			listError = null;
			const roots = list.map(projectRoot).filter((root) => root.length > 0);
			const current = selectedRoot();
			if (current === null || !roots.includes(current)) selectedRoot.set(roots.length > 0 ? roots[0] : null);
			const openLog = logRoot();
			if (openLog !== null && !roots.includes(openLog)) closeLogs();
		} catch (failure) {
			listError = errorMessage(failure);
			error.set(listError);
		} finally {
			loading.set(false);
			refreshing.set(false);
		}
	}
	function visibleProjects() {
		const needle = query().trim().toLowerCase();
		if (needle.length === 0) return projects();
		return projects().filter((project) => `${projectName(project)} ${projectRoot(project)}`.toLowerCase().includes(needle));
	}
	function currentProject() {
		const root = selectedRoot();
		if (root === null) return null;
		return projects().find((project) => projectRoot(project) === root) ?? null;
	}
	function summaryLine() {
		const list = projects();
		const watching = list.filter(projectWatching).length;
		return `${list.length} 个工程 · ${watching} 个监听中`;
	}
	/** 添加工程：宿主先开系统目录选择器（立刻返回 pending），再轮询取结果。 */
	async function addProject() {
		if (picking()) return;
		picking.set(true);
		status.set(null);
		try {
			await callHost("navop.dev.pickDirectory");
			const picked = await waitForPick();
			if (picked === null) {
				status.set("等待目录选择超时，可以再点一次「添加工程…」。");
				return;
			}
			if (picked.trim().length === 0) return;
			await openProjectPath(picked);
		} catch (failure) {
			error.set(errorMessage(failure));
		} finally {
			picking.set(false);
		}
	}
	/** 每 250ms 问一次 pickResult（最多约两分钟）；取消时宿主给的是空字符串。 */
	async function waitForPick() {
		for (let attempt = 0; attempt < 480; attempt += 1) {
			if (attempt > 0) await delay(250);
			const picked = await callHost("navop.dev.pickResult");
			if (picked === null || picked === void 0) continue;
			return typeof picked === "string" ? picked : String(picked);
		}
		return null;
	}
	async function openProjectPath(root) {
		status.set(null);
		try {
			const reason = failureOf(await callHost("navop.dev.open", { root }));
			if (reason !== null) error.set(reason);
			else {
				error.set(null);
				selectedRoot.set(root);
				status.set(`已加载工程 ${root}`);
				logInfo(`dev project loaded: ${root}`);
			}
		} catch (failure) {
			error.set(errorMessage(failure));
		}
		await refresh();
	}
	async function reloadProject(project) {
		const root = projectRoot(project);
		if (root.length === 0 || busy()) return;
		busy.set(true);
		status.set(null);
		try {
			const reason = failureOf(await callHost("navop.dev.reload", { root }));
			if (reason !== null) error.set(reason);
			else {
				error.set(null);
				status.set(`已重新加载 ${projectName(project)}`);
				logInfo(`dev project reloaded: ${root}`);
			}
		} catch (failure) {
			error.set(errorMessage(failure));
		} finally {
			busy.set(false);
		}
		await refresh();
	}
	async function toggleWatch(project) {
		const root = projectRoot(project);
		if (root.length === 0 || busy()) return;
		busy.set(true);
		status.set(null);
		try {
			const result = await callHost("navop.dev.watch", { root });
			const reason = failureOf(result);
			if (reason !== null) error.set(reason);
			else {
				const watching = result !== null && typeof result === "object" && result.watching === true;
				error.set(null);
				status.set(watching ? `已开始监听 ${projectName(project)} 的文件变化` : `已停止监听 ${projectName(project)}`);
				logInfo(`dev watch ${watching ? "started" : "stopped"}: ${root}`);
			}
		} catch (failure) {
			error.set(errorMessage(failure));
		} finally {
			busy.set(false);
		}
		await refresh();
	}
	async function removeProject(project) {
		const root = projectRoot(project);
		if (root.length === 0 || busy()) return;
		busy.set(true);
		try {
			const reason = failureOf(await callHost("navop.dev.remove", { root }));
			if (reason !== null) error.set(reason);
			else {
				error.set(null);
				status.set(`已移除工程 ${root}`);
				if (selectedRoot() === root) selectedRoot.set(null);
				if (logRoot() === root) closeLogs();
				logInfo(`dev project removed: ${root}`);
			}
		} catch (failure) {
			error.set(errorMessage(failure));
		} finally {
			busy.set(false);
			confirmRemove.set(false);
		}
		await refresh();
	}
	/**
	* 打开工程的 nsh app。新契约里一个工程只有一个 app，没有视图 id：
	* `navop.dev.openApp` 只收 extensionId（route 由 app 自己解释，这里不指定）。
	* 注意 ABI 的坑：宿主把 `root` 优先当第一个参数，但 dev::open_app 要的是
	* **extensionId**（它会自己补 dev 前缀），所以必须按字段名传 extensionId。
	*/
	async function openAppOf(project) {
		const extensionId = str(project, "id", "");
		if (extensionId.length === 0) {
			error.set("这个工程还没有加载成功，先点「重新加载」再打开应用。");
			return;
		}
		const app = projectApp(project);
		const title = app === null ? extensionId : app.title;
		openingApp.set(extensionId);
		status.set(null);
		try {
			await callHost("navop.dev.openApp", { extensionId });
			error.set(null);
			status.set(`已请求打开应用 ${title}`);
			logInfo(`dev app opened: ${extensionId}`);
		} catch (failure) {
			error.set(errorMessage(failure));
		} finally {
			openingApp.set(null);
		}
	}
	async function loadLogs(root, tail) {
		logLoading.set(true);
		try {
			const result = await callHost("navop.dev.logs", {
				root,
				tail
			});
			logLines.set(Array.isArray(result) ? result.map((line) => String(line)) : []);
		} catch (failure) {
			error.set(errorMessage(failure));
		} finally {
			logLoading.set(false);
		}
	}
	function showLogs(root) {
		logRoot.set(root);
		loadLogs(root, logTail());
	}
	function closeLogs() {
		logRoot.set(null);
		logLines.set([]);
		logAuto.set(false);
		stopLogTimer();
	}
	function stopLogTimer() {
		if (logTimer !== null) {
			clearInterval(logTimer);
			logTimer = null;
		}
	}
	function setAutoRefresh(root, value) {
		logAuto.set(value);
		stopLogTimer();
		if (!value) return;
		loadLogs(root, logTail());
		logTimer = setInterval(() => {
			const current = logRoot();
			if (current !== null) loadLogs(current, logTail());
		}, 1e3);
	}
	function selectProject(root) {
		if (selectedRoot() === root) return;
		const openLog = logRoot();
		if (openLog !== null && openLog !== root) closeLogs();
		selectedRoot.set(root);
	}
	function feedback() {
		if (error() !== null && projects().length > 0) return (() => {
			const __nsh_hv0 = element("view");
			prop(__nsh_hv0, "style", {
				paddingHorizontal: 14,
				paddingBottom: 8
			});
			insert(__nsh_hv0, component(Notice, {
				tone: "danger",
				get message() {
					return `操作失败：${error() ?? ""}`;
				}
			}));
			return __nsh_hv0;
		})();
		if (status() !== null) return (() => {
			const __nsh_hv1 = element("view");
			prop(__nsh_hv1, "style", {
				paddingHorizontal: 14,
				paddingBottom: 8
			});
			insert(__nsh_hv1, component(Notice, {
				tone: "ok",
				get message() {
					return status() ?? "";
				}
			}));
			return __nsh_hv1;
		})();
		return null;
	}
	function headerBar() {
		return component(Row, {
			wrap: true,
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
								const __nsh_hv2 = element("text");
								bindProp(__nsh_hv2, "style", () => t.h1);
								const __nsh_hv3 = text("开发者工具");
								append(__nsh_hv2, __nsh_hv3);
								return __nsh_hv2;
							})(),
							(() => {
								const __nsh_hv4 = element("text");
								bindProp(__nsh_hv4, "style", () => t.meta);
								const __nsh_hv5 = text("本地扩展工程调试");
								append(__nsh_hv4, __nsh_hv5);
								return __nsh_hv4;
							})(),
							(() => {
								const __nsh_hv6 = element("text");
								bindProp(__nsh_hv6, "style", () => t.meta);
								insert(__nsh_hv6, () => summaryLine());
								return __nsh_hv6;
							})()
						];
					}
				}), component(Row, {
					gap: 6,
					get children() {
						return [
							() => refreshing() ? (() => {
								const __nsh_hv7 = element("text");
								bindProp(__nsh_hv7, "style", () => t.meta);
								const __nsh_hv8 = text("正在读取…");
								append(__nsh_hv7, __nsh_hv8);
								return __nsh_hv7;
							})() : null,
							component(Button, {
								get label() {
									return picking() ? "选择目录中…" : "添加工程…";
								},
								tone: "primary",
								small: true,
								get disabled() {
									return picking();
								},
								onPress: () => void addProject()
							}),
							component(Button, {
								label: "刷新",
								small: true,
								onPress: () => void refresh()
							})
						];
					}
				})];
			}
		});
	}
	/**
	* 工程搜索框单独放这里：它不读 query()，只有 Input 的 value 属性自己
	* 跟随 query——这样每次输入不会重挂输入框（不会丢焦点/光标）。
	*/
	function searchSlot() {
		return (() => {
			const __nsh_hv9 = element("view");
			prop(__nsh_hv9, "style", {
				paddingHorizontal: 10,
				paddingTop: 10,
				paddingBottom: 6,
				display: "flex",
				flexDirection: "column",
				gap: 6
			});
			const __nsh_hv10 = element("text");
			bindProp(__nsh_hv10, "style", () => t.meta);
			insert(__nsh_hv10, () => countLine());
			append(__nsh_hv9, __nsh_hv10);
			insert(__nsh_hv9, component(SearchField, {
				get value() {
					return query();
				},
				onChange: (value) => query.set(value),
				placeholder: "按名称 / 路径过滤工程"
			}), __nsh_hv10);
			return __nsh_hv9;
		})();
	}
	function countLine() {
		const list = visibleProjects().length;
		const total = projects().length;
		return list === total ? `共 ${total} 个工程` : `${list} / ${total} 个工程`;
	}
	function projectList() {
		const list = visibleProjects();
		if (list.length === 0) {
			const filtering = query().trim().length > 0;
			return component(Empty, {
				title: filtering ? "没有匹配的工程" : "还没有加载开发工程",
				hint: filtering ? "清空搜索词，或换一段名称 / 路径再试。" : "点右上角「添加工程…」，选一个包含 extension.json 的本地目录。",
				get action() {
					return filtering ? void 0 : component(Button, {
						label: "添加工程…",
						small: true,
						onPress: () => void addProject()
					});
				}
			});
		}
		return (() => {
			const __nsh_hv11 = element("scroll");
			prop(__nsh_hv11, "style", {
				flex: 1,
				minHeight: 0,
				paddingHorizontal: 6,
				paddingBottom: 8
			});
			const __nsh_hv12 = element("view");
			prop(__nsh_hv12, "style", {
				display: "flex",
				flexDirection: "column",
				gap: 2
			});
			insert(__nsh_hv12, () => list.map((project) => projectRow(project)));
			append(__nsh_hv11, __nsh_hv12);
			return __nsh_hv11;
		})();
	}
	function projectRow(project) {
		const root = projectRoot(project);
		const failed = failureOf(project) !== null;
		const app = projectApp(project);
		return (() => {
			const __nsh_hv13 = element("view");
			prop(__nsh_hv13, "onPress", () => selectProject(root));
			bindProp(__nsh_hv13, "style", () => ({
				display: "flex",
				flexDirection: "column",
				gap: 3,
				paddingHorizontal: 9,
				paddingVertical: 7,
				borderRadius: r.control,
				backgroundColor: selectedRoot() === root ? c.hover() : "transparent"
			}));
			const __nsh_hv15 = element("text");
			prop(__nsh_hv15, "numberOfLines", 1);
			prop(__nsh_hv15, "ellipsizeMode", "middle");
			bindProp(__nsh_hv15, "style", () => ({
				...t.mono,
				fontSize: 11,
				color: c.muted()
			}));
			insert(__nsh_hv15, () => root.length > 0 ? root : "（未加载）");
			append(__nsh_hv13, __nsh_hv15);
			insert(__nsh_hv13, component(Row, {
				gap: 6,
				get children() {
					return [
						(() => {
							const __nsh_hv14 = element("text");
							prop(__nsh_hv14, "numberOfLines", 1);
							bindProp(__nsh_hv14, "style", () => ({
								flex: 1,
								minWidth: 0,
								fontSize: 13,
								fontWeight: "500",
								color: failed ? c.danger() : c.text()
							}));
							insert(__nsh_hv14, () => projectName(project));
							return __nsh_hv14;
						})(),
						() => failed ? component(Badge, {
							text: "加载失败",
							tone: "danger"
						}) : null,
						() => projectWatching(project) ? component(Badge, {
							text: "监听中",
							tone: "ok"
						}) : null,
						() => app === null ? component(Badge, { text: "无 nsh app" }) : component(Badge, { text: "nsh app" })
					];
				}
			}), __nsh_hv15);
			return __nsh_hv13;
		})();
	}
	function actions(project) {
		const root = projectRoot(project);
		const watching = projectWatching(project);
		const logsOpen = logRoot() === root;
		return component(Row, {
			wrap: true,
			gap: 6,
			get children() {
				return [
					component(Button, {
						label: "重新加载",
						small: true,
						get disabled() {
							return busy();
						},
						onPress: () => void reloadProject(project)
					}),
					component(Button, {
						label: watching ? "停止监听" : "开始监听",
						small: true,
						get disabled() {
							return busy();
						},
						onPress: () => void toggleWatch(project)
					}),
					component(Button, {
						label: logsOpen ? "隐藏日志" : "查看日志",
						small: true,
						onPress: () => {
							if (logsOpen) closeLogs();
							else showLogs(root);
						}
					}),
					(() => {
						const __nsh_hv16 = element("view");
						prop(__nsh_hv16, "style", { flex: 1 });
						return __nsh_hv16;
					})(),
					component(Button, {
						label: "移除工程",
						small: true,
						tone: "danger",
						get disabled() {
							return busy();
						},
						onPress: () => confirmRemove.set(true)
					})
				];
			}
		});
	}
	function appSection(project) {
		const app = projectApp(project);
		return (() => {
			const __nsh_hv17 = element("view");
			prop(__nsh_hv17, "style", {
				display: "flex",
				flexDirection: "column",
				gap: 8
			});
			insert(__nsh_hv17, [component(SectionTitle, {
				title: "nsh 应用",
				hint: app === null ? "未声明" : "1 个"
			}), () => app === null ? (() => {
				const __nsh_hv18 = element("text");
				bindProp(__nsh_hv18, "style", () => t.meta);
				insert(__nsh_hv18, () => failureOf(project) === null ? "这个工程的 extension.json 里没有声明 shellApp。" : "工程还没加载成功：先点「重新加载」，再打开应用。");
				return __nsh_hv18;
			})() : appRow(project, app)]);
			return __nsh_hv17;
		})();
	}
	function appRow(project, app) {
		const extensionId = str(project, "id", "");
		const opening = openingApp() === extensionId;
		return component(Row, {
			gap: 10,
			get style() {
				return {
					paddingHorizontal: 12,
					paddingVertical: 9,
					borderWidth: 1,
					borderColor: c.line(),
					borderRadius: r.control
				};
			},
			get children() {
				return [(() => {
					const __nsh_hv19 = element("view");
					prop(__nsh_hv19, "style", {
						flex: 1,
						minWidth: 0,
						display: "flex",
						flexDirection: "column",
						gap: 2
					});
					const __nsh_hv20 = element("text");
					prop(__nsh_hv20, "numberOfLines", 1);
					bindProp(__nsh_hv20, "style", () => ({
						fontSize: 13,
						fontWeight: "500",
						color: c.text()
					}));
					insert(__nsh_hv20, () => app.title);
					const __nsh_hv21 = element("text");
					prop(__nsh_hv21, "numberOfLines", 1);
					bindProp(__nsh_hv21, "style", () => ({
						...t.mono,
						fontSize: 11,
						color: c.muted()
					}));
					insert(__nsh_hv21, `${extensionId} · 单应用，route 由 app 自己解释`);
					append(__nsh_hv19, __nsh_hv20);
					append(__nsh_hv19, __nsh_hv21);
					return __nsh_hv19;
				})(), component(Button, {
					label: opening ? "打开中…" : "打开",
					tone: "primary",
					small: true,
					get disabled() {
						return opening || extensionId.length === 0;
					},
					onPress: () => void openAppOf(project)
				})];
			}
		});
	}
	function detailPane() {
		const project = currentProject();
		if (project === null) return component(Empty, {
			title: "从左侧选择一个开发工程",
			hint: "选中后可以查看 nsh 应用、重新加载、监听文件变化，并查看宿主的操作日志。"
		});
		const root = projectRoot(project);
		const failed = failureOf(project);
		const version = str(project, "version", "");
		return (() => {
			const __nsh_hv22 = element("scroll");
			prop(__nsh_hv22, "style", {
				flex: 1,
				minHeight: 0
			});
			const __nsh_hv23 = element("view");
			prop(__nsh_hv23, "style", {
				padding: 16,
				display: "flex",
				flexDirection: "column",
				gap: 12
			});
			const __nsh_hv25 = element("text");
			prop(__nsh_hv25, "selectable", true);
			prop(__nsh_hv25, "numberOfLines", 2);
			bindProp(__nsh_hv25, "style", () => ({
				...t.mono,
				fontSize: 12,
				color: c.muted()
			}));
			insert(__nsh_hv25, root);
			const __nsh_hv26 = element("view");
			bindProp(__nsh_hv26, "style", () => hairline());
			append(__nsh_hv23, __nsh_hv25);
			append(__nsh_hv23, __nsh_hv26);
			insert(__nsh_hv23, component(Row, {
				wrap: true,
				gap: 8,
				get children() {
					return [
						(() => {
							const __nsh_hv24 = element("text");
							bindProp(__nsh_hv24, "style", () => t.h2);
							insert(__nsh_hv24, () => projectName(project));
							return __nsh_hv24;
						})(),
						() => version.length > 0 ? component(Badge, { text: `v${version}` }) : null,
						() => failed !== null ? component(Badge, {
							text: "加载失败",
							tone: "danger"
						}) : projectWatching(project) ? component(Badge, {
							text: "监听中",
							tone: "ok"
						}) : component(Badge, { text: "就绪" })
					];
				}
			}), __nsh_hv25);
			insert(__nsh_hv23, [
				() => failed === null ? null : component(Notice, {
					tone: "danger",
					message: failed
				}),
				() => actions(project),
				() => confirmRemove() ? component(ConfirmBar, {
					message: `移除开发工程 ${root}？只从工作台卸载，不会删除磁盘上的文件。`,
					confirmLabel: "确认移除",
					get busy() {
						return busy();
					},
					onConfirm: () => void removeProject(project),
					onCancel: () => confirmRemove.set(false)
				}) : null
			], __nsh_hv26);
			insert(__nsh_hv23, [() => appSection(project), () => logRoot() === root ? logSection(project) : null]);
			append(__nsh_hv22, __nsh_hv23);
			return __nsh_hv22;
		})();
	}
	function logSection(project) {
		const root = projectRoot(project);
		const lines = logLines();
		return (() => {
			const __nsh_hv27 = element("view");
			prop(__nsh_hv27, "style", {
				display: "flex",
				flexDirection: "column",
				gap: 8
			});
			const __nsh_hv28 = element("view");
			bindProp(__nsh_hv28, "style", () => ({
				height: 240,
				borderRadius: r.control,
				backgroundColor: c.panel(),
				borderWidth: 1,
				borderColor: c.line(),
				padding: 8
			}));
			const __nsh_hv29 = element("scroll");
			prop(__nsh_hv29, "style", {
				flex: 1,
				minHeight: 0
			});
			insert(__nsh_hv29, () => lines.length === 0 ? (() => {
				const __nsh_hv30 = element("text");
				bindProp(__nsh_hv30, "style", () => t.meta);
				insert(__nsh_hv30, () => logLoading() ? "正在读取日志…" : "（暂无日志：打开或重新加载工程后这里会有记录）");
				return __nsh_hv30;
			})() : lines.map((line) => (() => {
				const __nsh_hv31 = element("text");
				prop(__nsh_hv31, "selectable", true);
				prop(__nsh_hv31, "numberOfLines", 1);
				bindProp(__nsh_hv31, "style", () => ({
					...t.mono,
					fontSize: 11,
					color: c.text()
				}));
				insert(__nsh_hv31, line);
				return __nsh_hv31;
			})()));
			append(__nsh_hv28, __nsh_hv29);
			const __nsh_hv32 = element("text");
			bindProp(__nsh_hv32, "style", () => t.meta);
			const __nsh_hv33 = text("日志来自宿主的 DevLogRing；「自动刷新」每秒按当前档位拉一次，只保留最近 tail 行。");
			append(__nsh_hv32, __nsh_hv33);
			append(__nsh_hv27, __nsh_hv28);
			append(__nsh_hv27, __nsh_hv32);
			insert(__nsh_hv27, component(SectionTitle, {
				title: "操作日志",
				get hint() {
					return `${lines.length} 行`;
				},
				get right() {
					return logControls(root);
				}
			}), __nsh_hv28);
			return __nsh_hv27;
		})();
	}
	function logControls(root) {
		return component(Row, {
			wrap: true,
			gap: 4,
			get children() {
				return [
					() => LOG_TAILS.map((size) => component(Button, {
						get label() {
							return String(size);
						},
						small: true,
						get tone() {
							return logTail() === size ? "primary" : "ghost";
						},
						onPress: () => {
							logTail.set(size);
							loadLogs(root, size);
						}
					})),
					component(Button, {
						label: "刷新日志",
						small: true,
						onPress: () => void loadLogs(root, logTail())
					}),
					() => autoRefreshToggle(root),
					component(Button, {
						label: "关闭",
						small: true,
						onPress: () => closeLogs()
					})
				];
			}
		});
	}
	/** 开关形状的胶囊；函数调用（不是组件），这样 on 变化会重建、标签才跟得上。 */
	function autoRefreshToggle(root) {
		const on = logAuto();
		return (() => {
			const __nsh_hv34 = element("view");
			prop(__nsh_hv34, "onPress", () => setAutoRefresh(root, !on));
			bindProp(__nsh_hv34, "style", () => ({
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				gap: 6,
				paddingHorizontal: 8,
				paddingVertical: 4,
				borderRadius: r.pill,
				borderWidth: 1,
				borderColor: on ? c.accent() : c.line()
			}));
			const __nsh_hv35 = element("view");
			bindProp(__nsh_hv35, "style", () => ({
				width: 22,
				height: 12,
				borderRadius: r.pill,
				backgroundColor: on ? c.accent() : c.line(),
				display: "flex",
				flexDirection: "row",
				alignItems: "center",
				justifyContent: on ? "flex-end" : "flex-start",
				padding: 2
			}));
			const __nsh_hv36 = element("view");
			bindProp(__nsh_hv36, "style", () => ({
				width: 8,
				height: 8,
				borderRadius: r.pill,
				backgroundColor: on ? c.accentText() : c.panel()
			}));
			append(__nsh_hv35, __nsh_hv36);
			const __nsh_hv37 = element("text");
			bindProp(__nsh_hv37, "style", () => ({
				fontSize: 11,
				color: on ? c.text() : c.muted()
			}));
			insert(__nsh_hv37, `自动刷新${on ? "开" : "关"}`);
			append(__nsh_hv34, __nsh_hv35);
			append(__nsh_hv34, __nsh_hv37);
			return __nsh_hv34;
		})();
	}
	function body() {
		if (loading() && error() === null) return component(Loading, { label: "正在读取开发工程…" });
		if (error() !== null && projects().length === 0) return (() => {
			const __nsh_hv38 = element("view");
			prop(__nsh_hv38, "style", {
				flex: 1,
				minHeight: 0,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				padding: 24
			});
			insert(__nsh_hv38, component(LoadError, {
				get message() {
					return error() ?? "";
				},
				onRetry: () => void refresh()
			}));
			return __nsh_hv38;
		})();
		return (() => {
			const __nsh_hv39 = element("view");
			prop(__nsh_hv39, "style", {
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "row"
			});
			const __nsh_hv40 = element("view");
			bindProp(__nsh_hv40, "style", () => ({
				width: 300,
				flexShrink: 0,
				minHeight: 0,
				display: "flex",
				flexDirection: "column",
				borderRightWidth: 1,
				borderRightColor: c.line()
			}));
			insert(__nsh_hv40, [() => searchSlot(), () => projectList()]);
			const __nsh_hv41 = element("view");
			prop(__nsh_hv41, "style", {
				flex: 1,
				minWidth: 0,
				minHeight: 0,
				display: "flex",
				flexDirection: "column"
			});
			insert(__nsh_hv41, () => detailPane());
			append(__nsh_hv39, __nsh_hv40);
			append(__nsh_hv39, __nsh_hv41);
			return __nsh_hv39;
		})();
	}
	refresh();
	return (() => {
		const __nsh_hv42 = element("view");
		bindProp(__nsh_hv42, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		const __nsh_hv43 = element("view");
		bindProp(__nsh_hv43, "style", () => hairline());
		append(__nsh_hv42, __nsh_hv43);
		insert(__nsh_hv42, () => headerBar(), __nsh_hv43);
		insert(__nsh_hv42, [() => feedback(), () => body()]);
		return __nsh_hv42;
	})();
}

//#endregion
//#region App.tsx
const startup = host.params;
/** 路由表：route id → 页面。 */
const DEFAULT_ROUTE = "workbench";
const ROUTES = { workbench: DevWorkbench };
const resolveRoute = (raw) => {
	const route = raw ?? "";
	return route.length > 0 && Object.prototype.hasOwnProperty.call(ROUTES, route) ? route : DEFAULT_ROUTE;
};
function DevToolsApp() {
	const Page = ROUTES[resolveRoute(startup.route)];
	return (() => {
		const __nsh_hv0 = element("view");
		prop(__nsh_hv0, "style", {
			flex: 1,
			minWidth: 0,
			minHeight: 0,
			display: "flex",
			flexDirection: "column"
		});
		insert(__nsh_hv0, component(Page, {}));
		return __nsh_hv0;
	})();
}
mount(DevToolsApp);

//#endregion