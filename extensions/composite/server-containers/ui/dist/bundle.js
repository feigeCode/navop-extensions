import { append, bindProp, component, element, insert, prop, setup, text } from "nsh:rt";
import { cleanup, effect, host, mount, nativeModule, signal, token } from "nsh";

//#region \0nsh-app
setup(null, null, null, null, "{\"id\":\"com.navop.server-containers\",\"name\":\"服务器容器\",\"version\":\"0.3.4\",\"build\":7,\"development\":true}");

//#endregion
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
/** 列表里的两行一行式条目：主标题 + 次要信息 + 右侧自由内容。 */
function ListRow(props) {
	return component(Row, {
		gap: 9,
		style: {
			paddingVertical: 7,
			paddingHorizontal: 8,
			minHeight: 42,
			width: "100%"
		},
		get children() {
			return [
				() => props.leading,
				(() => {
					const __nsh_hv22 = element("view");
					prop(__nsh_hv22, "style", {
						display: "flex",
						flexDirection: "column",
						gap: 1,
						flex: 1,
						minWidth: 0
					});
					const __nsh_hv23 = element("text");
					prop(__nsh_hv23, "numberOfLines", 1);
					bindProp(__nsh_hv23, "style", () => ({
						fontSize: 13,
						fontWeight: "500",
						color: c.text()
					}));
					insert(__nsh_hv23, () => props.title);
					append(__nsh_hv22, __nsh_hv23);
					insert(__nsh_hv22, () => props.subtitle === void 0 ? null : (() => {
						const __nsh_hv24 = element("text");
						prop(__nsh_hv24, "numberOfLines", 1);
						bindProp(__nsh_hv24, "style", () => t.meta);
						insert(__nsh_hv24, () => props.subtitle);
						return __nsh_hv24;
					})());
					return __nsh_hv22;
				})(),
				() => props.trailing
			];
		}
	});
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
/** 分段控件：一组互斥的小选项（全部/运行中/已停止）。 */
function Segmented(props) {
	const small = props.size === "small";
	return component(Row, {
		gap: 2,
		get style() {
			return {
				padding: 2,
				borderRadius: r.control,
				backgroundColor: c.hover(),
				flexShrink: 0,
				alignSelf: "flex-start"
			};
		},
		get children() {
			return props.options.map((option) => (() => {
				const __nsh_hv51 = element("view");
				prop(__nsh_hv51, "role", "button");
				prop(__nsh_hv51, "onPress", () => props.onChange(option.value));
				bindProp(__nsh_hv51, "accessibilityLabel", () => option.testLabel ?? option.label);
				bindProp(__nsh_hv51, "accessibilityState", () => ({ selected: pick(props.value) === option.value }));
				bindProp(__nsh_hv51, "hoverStyle", () => ({ backgroundColor: pick(props.value) === option.value ? c.panel() : c.field() }));
				bindProp(__nsh_hv51, "style", () => ({
					height: small ? 20 : 22,
					paddingHorizontal: small ? 7 : 9,
					alignItems: "center",
					justifyContent: "center",
					borderRadius: r.chip,
					cursor: "default",
					backgroundColor: pick(props.value) === option.value ? c.panel() : "transparent",
					boxShadow: pick(props.value) === option.value ? "0 1px 2px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.06)" : void 0
				}));
				const __nsh_hv52 = element("text");
				bindProp(__nsh_hv52, "style", () => ({
					fontSize: small ? 10.5 : 11,
					fontWeight: pick(props.value) === option.value ? "600" : "400",
					color: pick(props.value) === option.value ? c.text() : c.muted()
				}));
				insert(__nsh_hv52, () => option.label);
				append(__nsh_hv51, __nsh_hv52);
				return __nsh_hv51;
			})());
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
//#region lib/panel.tsx
function TargetBar(props) {
	if (props.targets.length <= 1) return null;
	return (() => {
		const __nsh_hv0 = element("scroll");
		prop(__nsh_hv0, "horizontal", true);
		prop(__nsh_hv0, "style", {
			flexShrink: 0,
			maxHeight: 40
		});
		insert(__nsh_hv0, component(Row, {
			gap: 6,
			style: {
				paddingHorizontal: 12,
				paddingVertical: 6
			},
			get children() {
				return props.targets.map((item) => component(Button, {
					get label() {
						return item.label;
					},
					small: true,
					get tone() {
						return item.sessionId === props.currentId ? "primary" : "ghost";
					},
					onPress: () => props.onSelect(item.sessionId)
				}));
			}
		}));
		return __nsh_hv0;
	})();
}
function NoTarget(props) {
	return component(Empty, {
		title: "没有已连接的终端会话",
		get hint() {
			return props.hint;
		},
		get action() {
			return component(Button, {
				label: "重试",
				small: true,
				get onPress() {
					return props.onRetry;
				}
			});
		}
	});
}
function PanelFooter(props) {
	return component(Row, {
		get style() {
			return {
				paddingHorizontal: 12,
				paddingVertical: 6,
				flexShrink: 0,
				justifyContent: "space-between",
				borderTopWidth: 1,
				borderTopColor: c.line()
			};
		},
		get children() {
			return [(() => {
				const __nsh_hv1 = element("text");
				bindProp(__nsh_hv1, "style", () => t.meta);
				insert(__nsh_hv1, () => props.left);
				return __nsh_hv1;
			})(), (() => {
				const __nsh_hv2 = element("text");
				bindProp(__nsh_hv2, "style", () => t.meta);
				insert(__nsh_hv2, () => props.right);
				return __nsh_hv2;
			})()];
		}
	});
}
/** 面板根容器：统一背景与纵向布局边界。 */
function PanelBody(props) {
	return (() => {
		const __nsh_hv3 = element("view");
		bindProp(__nsh_hv3, "style", () => ({
			flex: 1,
			minHeight: 0,
			minWidth: 0,
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		insert(__nsh_hv3, () => props.children);
		return __nsh_hv3;
	})();
}

//#endregion
//#region pages/docker/App.tsx
const REFRESH_MS$1 = 5e3;
const LOG_TAIL$1 = 200;
/** `docker ps --format '{{json .}}'` 每行一个 JSON 对象；坏行跳过而不是整页失败。 */
function parseContainers(stdout) {
	const rows = [];
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) continue;
		try {
			const value = JSON.parse(trimmed);
			const read = (key) => typeof value[key] === "string" ? value[key] : "";
			rows.push({
				id: read("ID"),
				name: read("Names") || read("Name") || read("ID"),
				image: read("Image"),
				state: read("State").toLowerCase(),
				status: read("Status"),
				ports: read("Ports")
			});
		} catch {}
	}
	return rows;
}
function containerStateTone(state) {
	if (state === "running") return "ok";
	if (state === "paused" || state === "restarting") return "warn";
	if (state === "exited" || state === "dead") return "danger";
	return "neutral";
}
function dockerListCommand(all) {
	return `docker ps${all ? " -a" : ""} --format '{{json .}}'`;
}
function dockerActionCommand(action, id) {
	return `docker ${action} ${shellQuote(id)}`;
}
function dockerLogsCommand(id) {
	return `docker logs --tail ${LOG_TAIL$1} ${shellQuote(id)} 2>&1`;
}
function DockerPanel() {
	const targets = signal([]);
	const targetId = signal(null);
	const rows = signal([]);
	const showAll = signal("all");
	const query = signal("");
	const loading = signal(true);
	const busy = signal(false);
	const error = signal(null);
	const updatedAt = signal("");
	const autoRefresh = signal(false);
	const selectedId = signal(null);
	const logs = signal("");
	const logsLoading = signal(false);
	const pendingAction = signal(null);
	const actionBusy = signal(false);
	let seq = 0;
	function currentTarget() {
		return targets().find((item) => item.sessionId === targetId()) ?? targets()[0] ?? null;
	}
	function visibleRows() {
		const needle = query().trim().toLowerCase();
		if (needle.length === 0) return rows();
		return rows().filter((row) => `${row.name} ${row.image} ${row.id}`.toLowerCase().includes(needle));
	}
	async function load(force = false) {
		const target = currentTarget();
		if (!target) return;
		if (busy() && !force) return;
		const mine = ++seq;
		busy.set(true);
		if (rows().length === 0) loading.set(true);
		try {
			const result = await runServerCommand(target, dockerListCommand(showAll() === "all"));
			if (mine !== seq) return;
			const failure = commandFailure(result, "docker ps 失败");
			if (failure !== null) error.set(failure);
			else {
				rows.set(parseContainers(result.stdout));
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
	async function loadTargets() {
		loading.set(true);
		try {
			const list = await listServerTargets();
			targets.set(list);
			if (list.length > 0 && targetId() === null) targetId.set(list[0].sessionId);
			if (list.length === 0) {
				loading.set(false);
				return;
			}
			await load(true);
		} catch (failure) {
			error.set(errorMessage(failure));
			loading.set(false);
		}
	}
	async function openLogs(row) {
		const target = currentTarget();
		if (!target) return;
		selectedId.set(row.id);
		logs.set("");
		logsLoading.set(true);
		try {
			const result = await runServerCommand(target, dockerLogsCommand(row.id));
			logs.set(result.stdout || result.stderr || "（这个容器还没有日志输出）");
		} catch (failure) {
			logs.set(errorMessage(failure));
		} finally {
			logsLoading.set(false);
		}
	}
	async function runAction() {
		const pending = pendingAction();
		const target = currentTarget();
		if (!pending || !target) return;
		actionBusy.set(true);
		try {
			const result = await runServerCommand(target, dockerActionCommand(pending.action, pending.id));
			const failure = commandFailure(result, `docker ${pending.action} 失败`);
			if (failure !== null) error.set(failure);
			else {
				error.set(null);
				pendingAction.set(null);
			}
			await load(true);
		} catch (failure) {
			error.set(errorMessage(failure));
		} finally {
			actionBusy.set(false);
		}
	}
	effect(() => {
		if (!autoRefresh()) return;
		const timer = setInterval(() => void load(), REFRESH_MS$1);
		cleanup(() => clearInterval(timer));
	});
	loadTargets();
	return component(PanelBody, { get children() {
		return [
			component(Row, {
				gap: 8,
				get style() {
					return {
						paddingHorizontal: 12,
						paddingVertical: 8,
						borderBottomWidth: 1,
						borderBottomColor: c.line(),
						flexShrink: 0
					};
				},
				get children() {
					return [
						(() => {
							const __nsh_hv0 = element("text");
							bindProp(__nsh_hv0, "style", () => ({
								...t.h2,
								flex: 1
							}));
							insert(__nsh_hv0, () => `服务器容器${currentTarget() ? ` · ${currentTarget()?.label}` : ""}`);
							return __nsh_hv0;
						})(),
						component(Button, {
							get label() {
								return autoRefresh() ? "停止刷新" : "自动刷新";
							},
							small: true,
							get tone() {
								return autoRefresh() ? "primary" : "ghost";
							},
							onPress: () => autoRefresh.set(!autoRefresh())
						}),
						component(IconButton, {
							glyph: "⟳",
							label: "刷新容器",
							onPress: () => void load(true),
							get disabled() {
								return busy();
							}
						})
					];
				}
			}),
			component(TargetBar, {
				get targets() {
					return targets();
				},
				get currentId() {
					return currentTarget()?.sessionId ?? null;
				},
				onSelect: (id) => {
					targetId.set(id);
					rows.set([]);
					logs.set("");
					selectedId.set(null);
					load(true);
				}
			}),
			component(Row, {
				gap: 8,
				style: {
					paddingHorizontal: 12,
					paddingVertical: 8,
					flexShrink: 0
				},
				get children() {
					return [component(Segmented, {
						options: [{
							value: "running",
							label: "运行中"
						}, {
							value: "all",
							label: "全部"
						}],
						get value() {
							return showAll();
						},
						size: "small",
						onChange: (value) => {
							showAll.set(value);
							load(true);
						}
					}), (() => {
						const __nsh_hv1 = element("view");
						bindProp(__nsh_hv1, "style", () => ({
							flex: 1,
							minWidth: 0,
							height: 26,
							paddingHorizontal: 8,
							borderRadius: 6,
							backgroundColor: c.hover(),
							justifyContent: "center"
						}));
						const __nsh_hv2 = element("input");
						bindProp(__nsh_hv2, "value", () => query());
						prop(__nsh_hv2, "placeholder", "按名称 / 镜像 / id 过滤");
						prop(__nsh_hv2, "accessibilityLabel", "过滤容器");
						prop(__nsh_hv2, "onChange", (event) => query.set(event.value));
						bindProp(__nsh_hv2, "style", () => ({
							fontSize: 11.5,
							color: c.text(),
							placeholderColor: c.muted(),
							caretColor: c.text(),
							borderWidth: 0,
							backgroundColor: "transparent"
						}));
						append(__nsh_hv1, __nsh_hv2);
						return __nsh_hv1;
					})()];
				}
			}),
			() => pendingAction() !== null ? (() => {
				const __nsh_hv3 = element("view");
				prop(__nsh_hv3, "style", {
					paddingHorizontal: 12,
					paddingBottom: 8
				});
				insert(__nsh_hv3, component(ConfirmBar, {
					get message() {
						return `确认在 ${currentTarget()?.label ?? "当前服务器"} 上 ${pendingAction()?.action} 容器 ${pendingAction()?.name}？`;
					},
					get confirmLabel() {
						return pendingAction()?.action ?? "";
					},
					get busy() {
						return actionBusy();
					},
					onConfirm: () => void runAction(),
					onCancel: () => pendingAction.set(null)
				}));
				return __nsh_hv3;
			})() : null,
			() => error() !== null ? (() => {
				const __nsh_hv4 = element("view");
				prop(__nsh_hv4, "style", {
					paddingHorizontal: 12,
					paddingBottom: 6
				});
				insert(__nsh_hv4, component(Notice, {
					get message() {
						return error() ?? "";
					},
					tone: "danger"
				}));
				return __nsh_hv4;
			})() : null,
			() => targets().length === 0 && !loading() ? component(NoTarget, {
				hint: "打开一个 SSH 或本地终端后，这里会直接列出那台机器上的 Docker 容器。",
				onRetry: () => void loadTargets()
			}) : loading() && rows().length === 0 ? component(Loading, { label: "正在执行 docker ps…" }) : error() !== null && rows().length === 0 ? component(LoadError, {
				get message() {
					return error() ?? "";
				},
				onRetry: () => void load(true)
			}) : (() => {
				const __nsh_hv5 = element("scroll");
				prop(__nsh_hv5, "style", {
					flex: 1,
					minHeight: 0
				});
				const __nsh_hv6 = element("view");
				prop(__nsh_hv6, "style", {
					flexDirection: "column",
					paddingHorizontal: 6,
					paddingVertical: 4
				});
				insert(__nsh_hv6, () => visibleRows().length === 0 ? (() => {
					const __nsh_hv7 = element("text");
					bindProp(__nsh_hv7, "style", () => ({
						...t.meta,
						padding: 12
					}));
					insert(__nsh_hv7, () => rows().length === 0 ? "这个服务器上没有匹配的容器。" : "没有匹配过滤条件的容器。");
					return __nsh_hv7;
				})() : visibleRows().map((row) => (() => {
					const __nsh_hv8 = element("view");
					bindProp(__nsh_hv8, "style", () => ({
						borderBottomWidth: 1,
						borderBottomColor: c.line()
					}));
					insert(__nsh_hv8, [
						component(ListRow, {
							get title() {
								return row.name;
							},
							get subtitle() {
								return `${row.image} · ${row.status || row.state} · ${row.id}`;
							},
							get leading() {
								return component(Badge, {
									get text() {
										return row.state || "unknown";
									},
									get tone() {
										return containerStateTone(row.state);
									},
									dot: true
								});
							}
						}),
						() => row.ports ? (() => {
							const __nsh_hv9 = element("text");
							bindProp(__nsh_hv9, "style", () => ({
								...t.mono,
								fontSize: 10.5,
								color: c.muted(),
								paddingHorizontal: 8,
								paddingBottom: 4
							}));
							insert(__nsh_hv9, () => `端口  ${row.ports}`);
							return __nsh_hv9;
						})() : null,
						component(Row, {
							gap: 6,
							style: {
								paddingHorizontal: 8,
								paddingBottom: 6
							},
							wrap: true,
							get children() {
								return [
									component(Button, {
										label: "日志",
										small: true,
										onPress: () => void openLogs(row)
									}),
									() => row.state === "running" ? component(Button, {
										label: "重启",
										small: true,
										onPress: () => pendingAction.set({
											action: "restart",
											id: row.id,
											name: row.name
										})
									}) : null,
									() => row.state === "running" ? component(Button, {
										label: "停止",
										small: true,
										tone: "danger",
										onPress: () => pendingAction.set({
											action: "stop",
											id: row.id,
											name: row.name
										})
									}) : component(Button, {
										label: "启动",
										small: true,
										onPress: () => pendingAction.set({
											action: "start",
											id: row.id,
											name: row.name
										})
									})
								];
							}
						})
					]);
					return __nsh_hv8;
				})()));
				append(__nsh_hv5, __nsh_hv6);
				return __nsh_hv5;
			})(),
			() => selectedId() !== null ? (() => {
				const __nsh_hv10 = element("view");
				bindProp(__nsh_hv10, "style", () => ({
					flexShrink: 0,
					maxHeight: 180,
					borderTopWidth: 1,
					borderTopColor: c.line(),
					flexDirection: "column"
				}));
				insert(__nsh_hv10, [component(Row, {
					style: {
						paddingHorizontal: 12,
						paddingTop: 6,
						justifyContent: "space-between"
					},
					get children() {
						return [(() => {
							const __nsh_hv11 = element("text");
							bindProp(__nsh_hv11, "style", () => t.label);
							insert(__nsh_hv11, `容器日志（末尾 ${LOG_TAIL$1} 行）`);
							return __nsh_hv11;
						})(), component(IconButton, {
							glyph: "×",
							label: "关闭日志",
							onPress: () => selectedId.set(null)
						})];
					}
				}), () => logsLoading() ? component(Loading, { label: "正在读取容器日志…" }) : (() => {
					const __nsh_hv12 = element("scroll");
					prop(__nsh_hv12, "style", {
						flex: 1,
						minHeight: 0
					});
					const __nsh_hv13 = element("text");
					bindProp(__nsh_hv13, "style", () => ({
						...t.mono,
						fontSize: 11,
						color: c.text(),
						paddingHorizontal: 12
					}));
					insert(__nsh_hv13, () => logs());
					append(__nsh_hv12, __nsh_hv13);
					return __nsh_hv12;
				})()]);
				return __nsh_hv10;
			})() : null,
			component(PanelFooter, {
				get left() {
					return `${visibleRows().length} / ${rows().length} 个容器`;
				},
				get right() {
					return updatedAt() ? `更新于 ${updatedAt()}` : "";
				}
			})
		];
	} });
}

//#endregion
//#region pages/kubernetes/App.tsx
const REFRESH_MS = 5e3;
const LOG_TAIL = 200;
function kubectlPodsCommand(namespace) {
	return `kubectl get pods ${namespace.trim().length === 0 ? "--all-namespaces" : `-n ${shellQuote(namespace.trim())}`} -o json`;
}
function kubectlLogsCommand(namespace, pod) {
	return `kubectl logs -n ${shellQuote(namespace)} ${shellQuote(pod)} --tail=${LOG_TAIL} 2>&1`;
}
function podPhaseTone(phase) {
	if (phase === "Running" || phase === "Succeeded") return "ok";
	if (phase === "Pending") return "warn";
	if (phase === "Failed") return "danger";
	return "neutral";
}
/** `kubectl get pods -o json` 的 items → 面板行；字段缺失给占位而不是抛错。 */
function parsePods(stdout) {
	const trimmed = stdout.trim();
	if (!trimmed.startsWith("{")) return [];
	const document = JSON.parse(trimmed);
	return (Array.isArray(document.items) ? document.items : []).map((item) => {
		const pod = item;
		const statuses = pod.status?.containerStatuses ?? [];
		const ready = statuses.filter((status) => status.ready === true).length;
		const restarts = statuses.reduce((total, status) => total + (status.restartCount ?? 0), 0);
		return {
			name: pod.metadata?.name ?? "<unknown>",
			namespace: pod.metadata?.namespace ?? "default",
			phase: pod.status?.phase ?? "Unknown",
			restarts: String(restarts),
			age: formatAge(pod.metadata?.creationTimestamp),
			node: pod.spec?.nodeName ?? "",
			ready: `${ready}/${statuses.length}`
		};
	});
}
/** kubectl 的 AGE 列是服务端算的；这里用创建时间换算成同形的短文案。 */
function formatAge(creationTimestamp, now = Date.now()) {
	if (!creationTimestamp) return "";
	const created = Date.parse(creationTimestamp);
	if (Number.isNaN(created)) return "";
	const seconds = Math.max(0, Math.floor((now - created) / 1e3));
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
	return `${Math.floor(seconds / 86400)}d`;
}
function KubernetesPanel() {
	const targets = signal([]);
	const targetId = signal(null);
	const pods = signal([]);
	const namespace = signal("");
	const scope = signal("pods");
	const query = signal("");
	const loading = signal(true);
	const busy = signal(false);
	const error = signal(null);
	const updatedAt = signal("");
	const autoRefresh = signal(false);
	const selected = signal(null);
	const logs = signal("");
	const logsLoading = signal(false);
	let seq = 0;
	function currentTarget() {
		return targets().find((item) => item.sessionId === targetId()) ?? targets()[0] ?? null;
	}
	function visiblePods() {
		const needle = query().trim().toLowerCase();
		if (needle.length === 0) return pods();
		return pods().filter((pod) => `${pod.namespace} ${pod.name} ${pod.node}`.toLowerCase().includes(needle));
	}
	async function load(force = false) {
		const target = currentTarget();
		if (!target) return;
		if (busy() && !force) return;
		const mine = ++seq;
		busy.set(true);
		if (pods().length === 0) loading.set(true);
		try {
			const result = await runServerCommand(target, kubectlPodsCommand(namespace()), 2e4);
			if (mine !== seq) return;
			const failure = commandFailure(result, "kubectl get pods 失败");
			if (failure !== null) error.set(failure);
			else {
				pods.set(parsePods(result.stdout));
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
	async function loadTargets() {
		loading.set(true);
		try {
			const list = await listServerTargets();
			targets.set(list);
			if (list.length > 0 && targetId() === null) targetId.set(list[0].sessionId);
			if (list.length === 0) {
				loading.set(false);
				return;
			}
			await load(true);
		} catch (failure) {
			error.set(errorMessage(failure));
			loading.set(false);
		}
	}
	async function openLogs(pod) {
		const target = currentTarget();
		if (!target) return;
		selected.set(pod);
		logs.set("");
		logsLoading.set(true);
		try {
			const result = await runServerCommand(target, kubectlLogsCommand(pod.namespace, pod.name));
			logs.set(result.stdout || result.stderr || "（这个 Pod 还没有日志输出）");
		} catch (failure) {
			logs.set(errorMessage(failure));
		} finally {
			logsLoading.set(false);
		}
	}
	effect(() => {
		if (!autoRefresh()) return;
		const timer = setInterval(() => void load(), REFRESH_MS);
		cleanup(() => clearInterval(timer));
	});
	loadTargets();
	return component(PanelBody, { get children() {
		return [
			component(Row, {
				gap: 8,
				get style() {
					return {
						paddingHorizontal: 12,
						paddingVertical: 8,
						borderBottomWidth: 1,
						borderBottomColor: c.line(),
						flexShrink: 0
					};
				},
				get children() {
					return [
						(() => {
							const __nsh_hv0 = element("text");
							bindProp(__nsh_hv0, "style", () => ({
								...t.h2,
								flex: 1
							}));
							insert(__nsh_hv0, () => `Kubernetes${currentTarget() ? ` · ${currentTarget()?.label}` : ""}`);
							return __nsh_hv0;
						})(),
						component(Button, {
							get label() {
								return autoRefresh() ? "停止刷新" : "自动刷新";
							},
							small: true,
							get tone() {
								return autoRefresh() ? "primary" : "ghost";
							},
							onPress: () => autoRefresh.set(!autoRefresh())
						}),
						component(IconButton, {
							glyph: "⟳",
							label: "刷新 Pod",
							onPress: () => void load(true),
							get disabled() {
								return busy();
							}
						})
					];
				}
			}),
			component(TargetBar, {
				get targets() {
					return targets();
				},
				get currentId() {
					return currentTarget()?.sessionId ?? null;
				},
				onSelect: (id) => {
					targetId.set(id);
					pods.set([]);
					selected.set(null);
					load(true);
				}
			}),
			component(Row, {
				gap: 8,
				style: {
					paddingHorizontal: 12,
					paddingVertical: 8,
					flexShrink: 0
				},
				get children() {
					return [component(Segmented, {
						options: [{
							value: "pods",
							label: "Pods"
						}, {
							value: "errors",
							label: "只看异常"
						}],
						get value() {
							return scope();
						},
						size: "small",
						onChange: (value) => scope.set(value)
					}), (() => {
						const __nsh_hv1 = element("view");
						bindProp(__nsh_hv1, "style", () => ({
							flex: 1,
							minWidth: 0,
							height: 26,
							paddingHorizontal: 8,
							borderRadius: 6,
							backgroundColor: c.hover(),
							justifyContent: "center"
						}));
						const __nsh_hv2 = element("input");
						bindProp(__nsh_hv2, "value", () => namespace());
						prop(__nsh_hv2, "placeholder", "命名空间（空 = 全部）");
						prop(__nsh_hv2, "accessibilityLabel", "Kubernetes 命名空间");
						prop(__nsh_hv2, "onChange", (event) => namespace.set(event.value));
						prop(__nsh_hv2, "onSubmit", () => void load(true));
						bindProp(__nsh_hv2, "style", () => ({
							fontSize: 11.5,
							color: c.text(),
							placeholderColor: c.muted(),
							caretColor: c.text(),
							borderWidth: 0,
							backgroundColor: "transparent"
						}));
						append(__nsh_hv1, __nsh_hv2);
						return __nsh_hv1;
					})()];
				}
			}),
			component(Row, {
				gap: 8,
				style: {
					paddingHorizontal: 12,
					paddingBottom: 8,
					flexShrink: 0
				},
				get children() {
					return [(() => {
						const __nsh_hv3 = element("view");
						bindProp(__nsh_hv3, "style", () => ({
							flex: 1,
							minWidth: 0,
							height: 26,
							paddingHorizontal: 8,
							borderRadius: 6,
							backgroundColor: c.hover(),
							justifyContent: "center"
						}));
						const __nsh_hv4 = element("input");
						bindProp(__nsh_hv4, "value", () => query());
						prop(__nsh_hv4, "placeholder", "按名称 / 命名空间 / 节点过滤");
						prop(__nsh_hv4, "accessibilityLabel", "过滤 Pod");
						prop(__nsh_hv4, "onChange", (event) => query.set(event.value));
						bindProp(__nsh_hv4, "style", () => ({
							fontSize: 11.5,
							color: c.text(),
							placeholderColor: c.muted(),
							caretColor: c.text(),
							borderWidth: 0,
							backgroundColor: "transparent"
						}));
						append(__nsh_hv3, __nsh_hv4);
						return __nsh_hv3;
					})(), component(Button, {
						label: "应用",
						small: true,
						onPress: () => void load(true)
					})];
				}
			}),
			() => error() !== null ? (() => {
				const __nsh_hv5 = element("view");
				prop(__nsh_hv5, "style", {
					paddingHorizontal: 12,
					paddingBottom: 6
				});
				insert(__nsh_hv5, component(Notice, {
					get message() {
						return error() ?? "";
					},
					tone: "danger"
				}));
				return __nsh_hv5;
			})() : null,
			() => targets().length === 0 && !loading() ? component(NoTarget, {
				hint: "打开一个装有 kubectl 的 SSH 或本地终端后，这里会列出它当前上下文里的 Pod。",
				onRetry: () => void loadTargets()
			}) : loading() && pods().length === 0 ? component(Loading, { label: "正在执行 kubectl get pods…" }) : error() !== null && pods().length === 0 ? component(LoadError, {
				get message() {
					return error() ?? "";
				},
				onRetry: () => void load(true)
			}) : (() => {
				const __nsh_hv6 = element("scroll");
				prop(__nsh_hv6, "style", {
					flex: 1,
					minHeight: 0
				});
				const __nsh_hv7 = element("view");
				prop(__nsh_hv7, "style", {
					flexDirection: "column",
					paddingHorizontal: 6,
					paddingVertical: 4
				});
				insert(__nsh_hv7, [() => (scope() === "errors" ? visiblePods().filter((pod) => podPhaseTone(pod.phase) !== "ok") : visiblePods()).map((pod) => (() => {
					const __nsh_hv8 = element("view");
					bindProp(__nsh_hv8, "style", () => ({
						borderBottomWidth: 1,
						borderBottomColor: c.line()
					}));
					insert(__nsh_hv8, [component(ListRow, {
						get title() {
							return pod.name;
						},
						get subtitle() {
							return `${pod.namespace} · ready ${pod.ready} · 重启 ${pod.restarts} · ${pod.age}`;
						},
						get leading() {
							return component(Badge, {
								get text() {
									return pod.phase;
								},
								get tone() {
									return podPhaseTone(pod.phase);
								},
								dot: true
							});
						}
					}), component(Row, {
						gap: 6,
						style: {
							paddingHorizontal: 8,
							paddingBottom: 6
						},
						get children() {
							return component(Button, {
								label: "日志",
								small: true,
								onPress: () => void openLogs(pod)
							});
						}
					})]);
					return __nsh_hv8;
				})()), () => visiblePods().length === 0 ? (() => {
					const __nsh_hv9 = element("text");
					bindProp(__nsh_hv9, "style", () => ({
						...t.meta,
						padding: 12
					}));
					const __nsh_hv10 = text("当前命名空间下没有 Pod。");
					append(__nsh_hv9, __nsh_hv10);
					return __nsh_hv9;
				})() : null]);
				append(__nsh_hv6, __nsh_hv7);
				return __nsh_hv6;
			})(),
			() => selected() !== null ? (() => {
				const __nsh_hv11 = element("view");
				bindProp(__nsh_hv11, "style", () => ({
					flexShrink: 0,
					maxHeight: 180,
					borderTopWidth: 1,
					borderTopColor: c.line(),
					flexDirection: "column"
				}));
				insert(__nsh_hv11, [component(Row, {
					style: {
						paddingHorizontal: 12,
						paddingTop: 6,
						justifyContent: "space-between"
					},
					get children() {
						return [(() => {
							const __nsh_hv12 = element("text");
							bindProp(__nsh_hv12, "style", () => t.label);
							insert(__nsh_hv12, () => `${selected()?.namespace}/${selected()?.name} 日志`);
							return __nsh_hv12;
						})(), component(IconButton, {
							glyph: "×",
							label: "关闭日志",
							onPress: () => selected.set(null)
						})];
					}
				}), () => logsLoading() ? component(Loading, { label: "正在读取 Pod 日志…" }) : (() => {
					const __nsh_hv13 = element("scroll");
					prop(__nsh_hv13, "style", {
						flex: 1,
						minHeight: 0
					});
					const __nsh_hv14 = element("text");
					bindProp(__nsh_hv14, "style", () => ({
						...t.mono,
						fontSize: 11,
						color: c.text(),
						paddingHorizontal: 12
					}));
					insert(__nsh_hv14, () => logs());
					append(__nsh_hv13, __nsh_hv14);
					return __nsh_hv13;
				})()]);
				return __nsh_hv11;
			})() : null,
			component(PanelFooter, {
				get left() {
					return `${visiblePods().length} 个 Pod${namespace().trim() ? ` · ${namespace().trim()}` : " · 全部命名空间"}`;
				},
				get right() {
					return updatedAt() ? `更新于 ${updatedAt()}` : "";
				}
			})
		];
	} });
}

//#endregion
//#region pages/resources/App.tsx
function resourceCommand(kind) {
	switch (kind) {
		case "processes": return "ps -eo pid=,user=,pcpu=,pmem=,etime=,args= --sort=-pcpu 2>&1 | head -n 61";
		case "images": return "docker images --format '{{json .}}' 2>&1";
		case "volumes": return "docker volume ls --format '{{json .}}' 2>&1";
		case "networks": return "docker network ls --format '{{json .}}' 2>&1";
		case "compose": return "docker compose ls --format json 2>&1";
	}
}
function resourceTitle(kind) {
	return {
		processes: "服务器进程",
		images: "镜像",
		volumes: "卷",
		networks: "网络",
		compose: "Compose 项目"
	}[kind];
}
function jsonLines(stdout) {
	return stdout.split("\n").flatMap((line) => {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) return [];
		try {
			return [JSON.parse(trimmed)];
		} catch {
			return [];
		}
	});
}
function text$1(row, key) {
	return typeof row[key] === "string" ? row[key] : "";
}
function parseProcesses(stdout) {
	return stdout.split("\n").flatMap((line) => {
		const fields = line.trim().split(/\s+/);
		if (fields.length < 6 || !/^\d+$/.test(fields[0])) return [];
		const [pid, user, cpu, memory, elapsed, ...command] = fields;
		return [{
			id: pid,
			title: `${pid} · ${user}`,
			subtitle: `CPU ${cpu}% · 内存 ${memory}% · ${elapsed} · ${command.join(" ")}`,
			status: `${cpu}%`
		}];
	});
}
function parseResources(kind, stdout) {
	if (kind === "compose") try {
		const document = JSON.parse(stdout.trim());
		return (Array.isArray(document) ? document : [document]).flatMap((item) => {
			const row = item;
			const name = text$1(row, "Name");
			if (!name) return [];
			return [{
				id: name,
				title: name,
				subtitle: text$1(row, "ConfigFiles"),
				status: text$1(row, "Status")
			}];
		});
	} catch {
		return [];
	}
	return jsonLines(stdout).flatMap((row) => {
		if (kind === "images") {
			const name = `${text$1(row, "Repository")}:${text$1(row, "Tag")}`;
			return [{
				id: text$1(row, "ID") || name,
				title: name,
				subtitle: `${text$1(row, "ID")} · ${text$1(row, "CreatedSince")}`,
				status: text$1(row, "Size")
			}];
		}
		if (kind === "volumes") {
			const name = text$1(row, "Name");
			return [{
				id: name,
				title: name,
				subtitle: text$1(row, "Mountpoint"),
				status: text$1(row, "Driver")
			}];
		}
		const name = text$1(row, "Name");
		return [{
			id: text$1(row, "ID") || name,
			title: name,
			subtitle: text$1(row, "ID"),
			status: `${text$1(row, "Driver")} · ${text$1(row, "Scope")}`
		}];
	}).filter((row) => row.title.length > 0);
}
function ResourcePanel(props) {
	const targets = signal([]);
	const targetId = signal(null);
	const rows = signal([]);
	const query = signal("");
	const loading = signal(true);
	const error = signal(null);
	const updatedAt = signal("");
	let seq = 0;
	function currentTarget() {
		return targets().find((item) => item.sessionId === targetId()) ?? targets()[0] ?? null;
	}
	function visibleRows() {
		const needle = query().trim().toLowerCase();
		if (!needle) return rows();
		return rows().filter((row) => `${row.title} ${row.subtitle} ${row.status}`.toLowerCase().includes(needle));
	}
	async function load() {
		const target = currentTarget();
		if (!target) return;
		const mine = ++seq;
		if (rows().length === 0) loading.set(true);
		try {
			const result = await runServerCommand(target, resourceCommand(props.kind), 2e4);
			if (mine !== seq) return;
			const failure = commandFailure(result, `${resourceTitle(props.kind)}读取失败`);
			if (failure !== null) error.set(failure);
			else {
				rows.set(props.kind === "processes" ? parseProcesses(result.stdout) : parseResources(props.kind, result.stdout));
				error.set(null);
				updatedAt.set(nowClock());
			}
		} catch (failure) {
			if (mine !== seq) return;
			error.set(errorMessage(failure));
		} finally {
			if (mine === seq) loading.set(false);
		}
	}
	async function init() {
		try {
			const list = await listServerTargets();
			targets.set(list);
			if (list.length > 0) targetId.set(list[0].sessionId);
		} catch (failure) {
			error.set(errorMessage(failure));
		}
		if (targets().length === 0) {
			loading.set(false);
			return;
		}
		await load();
	}
	init();
	return component(PanelBody, { get children() {
		return [
			component(Row, {
				gap: 8,
				get style() {
					return {
						paddingHorizontal: 12,
						paddingVertical: 8,
						borderBottomWidth: 1,
						borderBottomColor: c.line(),
						flexShrink: 0
					};
				},
				get children() {
					return [(() => {
						const __nsh_hv0 = element("text");
						bindProp(__nsh_hv0, "style", () => ({
							...t.h2,
							flex: 1
						}));
						insert(__nsh_hv0, () => resourceTitle(props.kind));
						return __nsh_hv0;
					})(), component(IconButton, {
						glyph: "⟳",
						get label() {
							return `刷新${resourceTitle(props.kind)}`;
						},
						onPress: () => void load()
					})];
				}
			}),
			component(TargetBar, {
				get targets() {
					return targets();
				},
				get currentId() {
					return currentTarget()?.sessionId ?? null;
				},
				onSelect: (id) => {
					targetId.set(id);
					rows.set([]);
					load();
				}
			}),
			component(Row, {
				gap: 8,
				style: {
					paddingHorizontal: 12,
					paddingVertical: 8,
					flexShrink: 0
				},
				get children() {
					return [(() => {
						const __nsh_hv1 = element("view");
						bindProp(__nsh_hv1, "style", () => ({
							flex: 1,
							height: 26,
							paddingHorizontal: 8,
							borderRadius: r.control,
							backgroundColor: c.hover(),
							justifyContent: "center"
						}));
						const __nsh_hv2 = element("input");
						bindProp(__nsh_hv2, "value", () => query());
						prop(__nsh_hv2, "placeholder", "过滤当前列表");
						bindProp(__nsh_hv2, "accessibilityLabel", () => `过滤${resourceTitle(props.kind)}`);
						prop(__nsh_hv2, "onChange", (event) => query.set(event.value));
						bindProp(__nsh_hv2, "style", () => ({
							fontSize: 11.5,
							color: c.text(),
							placeholderColor: c.muted(),
							caretColor: c.text(),
							borderWidth: 0,
							backgroundColor: "transparent"
						}));
						append(__nsh_hv1, __nsh_hv2);
						return __nsh_hv1;
					})(), component(Button, {
						label: "刷新",
						small: true,
						onPress: () => void load()
					})];
				}
			}),
			() => error() !== null ? (() => {
				const __nsh_hv3 = element("view");
				prop(__nsh_hv3, "style", {
					paddingHorizontal: 12,
					paddingBottom: 6
				});
				insert(__nsh_hv3, component(Notice, {
					get message() {
						return error() ?? "";
					},
					tone: "danger"
				}));
				return __nsh_hv3;
			})() : null,
			() => targets().length === 0 && !loading() ? component(NoTarget, {
				hint: "打开 SSH 或本地终端后即可读取。",
				onRetry: () => void init()
			}) : loading() && rows().length === 0 ? component(Loading, { get label() {
				return `正在读取${resourceTitle(props.kind)}…`;
			} }) : error() !== null && rows().length === 0 ? component(LoadError, {
				get message() {
					return error() ?? "";
				},
				onRetry: () => void load()
			}) : visibleRows().length === 0 ? component(Empty, { title: "没有匹配的记录" }) : (() => {
				const __nsh_hv4 = element("scroll");
				prop(__nsh_hv4, "style", {
					flex: 1,
					minHeight: 0
				});
				const __nsh_hv5 = element("view");
				prop(__nsh_hv5, "style", {
					flexDirection: "column",
					paddingHorizontal: 6,
					paddingVertical: 4
				});
				insert(__nsh_hv5, () => visibleRows().map((row) => component(ListRow, {
					get title() {
						return row.title;
					},
					get subtitle() {
						return row.subtitle;
					},
					get trailing() {
						return (() => {
							const __nsh_hv6 = element("text");
							bindProp(__nsh_hv6, "style", () => t.meta);
							insert(__nsh_hv6, () => row.status);
							return __nsh_hv6;
						})();
					}
				})));
				append(__nsh_hv4, __nsh_hv5);
				return __nsh_hv4;
			})(),
			component(PanelFooter, {
				get left() {
					return `${visibleRows().length} / ${rows().length} 条`;
				},
				get right() {
					return updatedAt() ? `更新于 ${updatedAt()}` : "";
				}
			})
		];
	} });
}

//#endregion
//#region App.tsx
const ROUTES = [
	{
		id: "processes",
		title: "进程"
	},
	{
		id: "containers",
		title: "容器"
	},
	{
		id: "images",
		title: "镜像"
	},
	{
		id: "volumes",
		title: "卷"
	},
	{
		id: "networks",
		title: "网络"
	},
	{
		id: "compose",
		title: "Compose"
	},
	{
		id: "kubernetes",
		title: "Kubernetes"
	}
];
function resolveRoute(value) {
	if (value === "docker") return "containers";
	return ROUTES.some((item) => item.id === value) ? value : "containers";
}
const ProcessesPage = () => component(ResourcePanel, { kind: "processes" });
const ImagesPage = () => component(ResourcePanel, { kind: "images" });
const VolumesPage = () => component(ResourcePanel, { kind: "volumes" });
const NetworksPage = () => component(ResourcePanel, { kind: "networks" });
const ComposePage = () => component(ResourcePanel, { kind: "compose" });
function App() {
	const route = signal(resolveRoute(params.surface === "panel" ? params.panel : params.route));
	return (() => {
		const __nsh_hv0 = element("view");
		bindProp(__nsh_hv0, "style", () => ({
			flex: 1,
			minWidth: 0,
			minHeight: 0,
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		const __nsh_hv1 = element("scroll");
		prop(__nsh_hv1, "horizontal", true);
		bindProp(__nsh_hv1, "style", () => ({
			flexShrink: 0,
			maxHeight: 46,
			borderBottomWidth: 1,
			borderBottomColor: c.line()
		}));
		insert(__nsh_hv1, component(Row, {
			gap: 4,
			style: { padding: 8 },
			get children() {
				return ROUTES.map((item) => (() => {
					const __nsh_hv2 = element("view");
					prop(__nsh_hv2, "role", "button");
					bindProp(__nsh_hv2, "accessibilityLabel", () => `页签 ${item.title}`);
					prop(__nsh_hv2, "onPress", () => route.set(item.id));
					bindProp(__nsh_hv2, "style", () => ({
						paddingHorizontal: 10,
						paddingVertical: 6,
						borderRadius: 6,
						backgroundColor: route() === item.id ? c.hover() : "transparent"
					}));
					const __nsh_hv3 = element("text");
					bindProp(__nsh_hv3, "style", () => ({
						...t.label,
						color: route() === item.id ? c.text() : c.muted()
					}));
					insert(__nsh_hv3, () => item.title);
					append(__nsh_hv2, __nsh_hv3);
					return __nsh_hv2;
				})());
			}
		}));
		const __nsh_hv4 = element("view");
		prop(__nsh_hv4, "style", {
			flex: 1,
			minHeight: 0,
			flexDirection: "column"
		});
		insert(__nsh_hv4, () => (() => {
			switch (route()) {
				case "processes": return component(ProcessesPage, {});
				case "images": return component(ImagesPage, {});
				case "volumes": return component(VolumesPage, {});
				case "networks": return component(NetworksPage, {});
				case "compose": return component(ComposePage, {});
				case "kubernetes": return component(KubernetesPanel, {});
				default: return component(DockerPanel, {});
			}
		})());
		append(__nsh_hv0, __nsh_hv1);
		append(__nsh_hv0, __nsh_hv4);
		return __nsh_hv0;
	})();
}
mount(App);

//#endregion
export { App as default };