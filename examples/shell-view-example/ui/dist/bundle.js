import { append, bindProp, component, cond, element, insert, prop, text } from "nsh:rt";
import { host, mount, signal, token } from "nsh";

//#region ../../../packages/extension-kit/src/theme.ts
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
/** 卡片容器样式（描边 + 圆角 + 内边距）。 */
const panel = (padding = 14) => ({
	backgroundColor: c.panel(),
	borderWidth: 1,
	borderColor: c.line(),
	borderRadius: r.card,
	padding
});

//#endregion
//#region ../../../packages/extension-kit/src/format.ts
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
//#region ../../../packages/extension-kit/src/ui.tsx
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
/** 纵向堆叠；`scroll` 打开纵向滚动（页面根节点用）。 */
function Stack(props) {
	return cond(() => pick(props.scroll ?? false), () => (() => {
		const __nsh_hv1 = element("scroll");
		prop(__nsh_hv1, "style", {
			flex: 1,
			minHeight: 0
		});
		const __nsh_hv2 = element("view");
		bindProp(__nsh_hv2, "style", () => ({
			display: "flex",
			flexDirection: "column",
			gap: props.gap ?? 12,
			...props.padding === void 0 ? {} : { padding: props.padding },
			flex: 1,
			minHeight: 0,
			...props.style
		}));
		insert(__nsh_hv2, () => props.children);
		append(__nsh_hv1, __nsh_hv2);
		return __nsh_hv1;
	})(), () => (() => {
		const __nsh_hv0 = element("view");
		bindProp(__nsh_hv0, "style", () => ({
			display: "flex",
			flexDirection: "column",
			gap: props.gap ?? 12,
			...props.padding === void 0 ? {} : { padding: props.padding },
			...props.style
		}));
		insert(__nsh_hv0, () => props.children);
		return __nsh_hv0;
	})());
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
/** 键值对表：inspect 类页面的主体。 */
function KeyValue(props) {
	return (() => {
		const __nsh_hv41 = element("view");
		bindProp(__nsh_hv41, "style", () => ({
			display: "flex",
			flexDirection: pick(props.columns ?? 1) === 2 ? "row" : "column",
			flexWrap: "wrap",
			gap: pick(props.columns ?? 1) === 2 ? 12 : 0
		}));
		insert(__nsh_hv41, () => pick(props.rows).map(([key, value]) => component(Row, {
			get style() {
				return {
					justifyContent: "space-between",
					paddingVertical: 5,
					width: pick(props.columns ?? 1) === 2 ? "48%" : "100%",
					gap: 12
				};
			},
			get children() {
				return [(() => {
					const __nsh_hv42 = element("text");
					bindProp(__nsh_hv42, "style", () => ({
						fontSize: 12,
						color: c.muted()
					}));
					insert(__nsh_hv42, key);
					return __nsh_hv42;
				})(), (() => {
					const __nsh_hv43 = element("text");
					bindProp(__nsh_hv43, "style", () => ({
						fontSize: 12,
						color: c.text(),
						fontVariant: ["tabular-nums"]
					}));
					insert(__nsh_hv43, value);
					return __nsh_hv43;
				})()];
			}
		})));
		return __nsh_hv41;
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
//#region pages/tool/App.tsx
/** 页面侧超时（毫秒）：查询类 30 秒够用，open 可能带建连，放宽到 60 秒。 */
const CALL_TIMEOUT_MS = 3e4;
const OPEN_TIMEOUT_MS = 6e4;
/** 模块加载时读一次即可：页面不 await，也没有重新取上下文的接口。 */
const startup = host.params;
const extensionInfo = startup.extension ?? {};
const backendAliases = Array.isArray(startup.backends) ? startup.backends.filter((item) => typeof item === "string") : [];
const borrowedConnection = startup.connection ?? null;
host.post("navop.log", {
	level: "info",
	message: `tool 页面已加载（${backendAliases.length} 个后端别名）`
});
function textOf(value, fallback = "—") {
	if (typeof value === "string") return value.length > 0 ? value : fallback;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return fallback;
}
/** 宿主错误直接带 `code` / `message`；页面自己的错误没有 code，落 PAGE_ERROR。 */
function decodeHostFailure(failure) {
	const record = failure ?? null;
	const raw = record === null ? void 0 : record.code;
	return {
		code: typeof raw === "string" && raw.length > 0 ? raw : "PAGE_ERROR",
		message: errorMessage(failure)
	};
}
/** 结果可能是 inline 值，也可能是 `{ blob: handle }` 引用；后者原样展示句柄。 */
function describeResult(result) {
	const record = result ?? null;
	if (record !== null && typeof record === "object" && typeof record.blob === "string") return JSON.stringify({ blob: record.blob }, null, 2);
	return JSON.stringify(result, null, 2);
}
/** 带标签的输入框；多行时给一个等宽区域。 */
function Field(props) {
	const multiline = props.multiline === true;
	return (() => {
		const __nsh_hv0 = element("view");
		prop(__nsh_hv0, "style", {
			display: "flex",
			flexDirection: "column",
			gap: 4,
			flex: 1,
			minWidth: 160
		});
		const __nsh_hv3 = element("view");
		bindProp(__nsh_hv3, "style", () => ({
			minHeight: multiline ? props.height ?? 84 : void 0,
			paddingHorizontal: 9,
			paddingVertical: multiline ? 7 : 0,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: c.line(),
			backgroundColor: c.bg()
		}));
		const __nsh_hv4 = element("input");
		bindProp(__nsh_hv4, "value", () => props.value);
		prop(__nsh_hv4, "multiline", multiline);
		bindProp(__nsh_hv4, "placeholder", () => props.placeholder ?? "");
		prop(__nsh_hv4, "onChange", (text) => props.onChange(text));
		prop(__nsh_hv4, "style", {
			fontSize: 12,
			paddingHorizontal: 0,
			borderWidth: 0,
			backgroundColor: "transparent"
		});
		append(__nsh_hv3, __nsh_hv4);
		append(__nsh_hv0, __nsh_hv3);
		insert(__nsh_hv0, component(Row, {
			gap: 6,
			align: "center",
			get children() {
				return [(() => {
					const __nsh_hv1 = element("text");
					bindProp(__nsh_hv1, "style", () => t.label);
					insert(__nsh_hv1, () => props.label);
					return __nsh_hv1;
				})(), () => props.hint === void 0 ? null : (() => {
					const __nsh_hv2 = element("text");
					bindProp(__nsh_hv2, "style", () => t.meta);
					insert(__nsh_hv2, () => props.hint);
					return __nsh_hv2;
				})()];
			}
		}), __nsh_hv3);
		return __nsh_hv0;
	})();
}
function Tool() {
	const alias = signal(backendAliases.length > 0 ? backendAliases[0] : "");
	const resourceType = signal("demo-item");
	const config = signal("{}");
	const handle = signal(null);
	const method = signal("demo/list");
	const params = signal("{}");
	const result = signal(null);
	const failure = signal(null);
	const notice = signal(null);
	const busy = signal(false);
	/** 宿主借给这个页面的连接：只有连接型 shell view 才有。 */
	const connection = () => borrowedConnection;
	/** 清单声明的后端别名（`backends` 的 key，顺序同 extension.json）。 */
	const backends = () => backendAliases;
	function parseJson(source, label) {
		if (source.trim().length === 0) return void 0;
		try {
			return JSON.parse(source);
		} catch (error) {
			failure.set({
				code: "INVALID_JSON",
				message: `${label}不是合法 JSON：${errorMessage(error)}`
			});
			return;
		}
	}
	async function openResource(backend) {
		if (busy()) return;
		const configValue = parseJson(config(), "config ");
		if (configValue === void 0) return;
		busy.set(true);
		failure.set(null);
		notice.set(null);
		try {
			const opened = await host.call("navop.resource.open", {
				backend,
				resourceType: resourceType(),
				config: configValue
			}, { timeout: OPEN_TIMEOUT_MS });
			const next = typeof opened?.handle === "string" ? opened.handle : "";
			if (next.length === 0) {
				failure.set({
					code: "PROTOCOL_ERROR",
					message: "open 返回里没有 handle 字段。"
				});
				return;
			}
			handle.set(next);
			notice.set(`已打开资源 ${resourceType()}（句柄 ${next}）。`);
		} catch (error) {
			failure.set(decodeHostFailure(error));
		} finally {
			busy.set(false);
		}
	}
	async function invoke(resourceHandle, callMethod, rawParams, label) {
		if (busy()) return;
		const paramsValue = parseJson(rawParams, "params ");
		if (paramsValue === void 0) return;
		busy.set(true);
		failure.set(null);
		notice.set(null);
		try {
			const response = await host.call("navop.resource.invoke", {
				handle: resourceHandle,
				method: callMethod,
				params: paramsValue
			}, { timeout: CALL_TIMEOUT_MS });
			result.set(describeResult(response));
			notice.set(`${label}调用成功（${callMethod}）。`);
		} catch (error) {
			failure.set(decodeHostFailure(error));
			result.set(null);
		} finally {
			busy.set(false);
		}
	}
	async function ping() {
		const current = handle();
		if (current === null || busy()) return;
		busy.set(true);
		failure.set(null);
		try {
			await host.call("navop.resource.ping", { handle: current }, { timeout: CALL_TIMEOUT_MS });
			notice.set("ping 成功，句柄仍然有效。");
		} catch (error) {
			failure.set(decodeHostFailure(error));
		} finally {
			busy.set(false);
		}
	}
	async function close() {
		const current = handle();
		if (current === null || busy()) return;
		busy.set(true);
		failure.set(null);
		try {
			await host.call("navop.resource.close", { handle: current }, { timeout: CALL_TIMEOUT_MS });
			handle.set(null);
			notice.set("已关闭资源，句柄作废；再次 invoke 会得到 INVALID_HANDLE。");
		} catch (error) {
			failure.set(decodeHostFailure(error));
		} finally {
			busy.set(false);
		}
	}
	function contextRows() {
		const rows = [
			["扩展 ID", textOf(extensionInfo.id)],
			["启动路由", textOf(startup.route)],
			["后端别名", backends().length === 0 ? "（未声明）" : backends().join("、")]
		];
		const borrowed = connection();
		rows.push(["借来的连接", borrowed === null ? "没有（当前不是连接型页面）" : textOf(borrowed.name)]);
		if (borrowed !== null) {
			rows.push(["连接别名", textOf(borrowed.alias)]);
			rows.push(["资源类型", textOf(borrowed.resourceType)]);
			rows.push(["资源句柄", textOf(borrowed.resourceHandle)]);
		}
		return rows;
	}
	function failureBox() {
		const current = failure();
		if (current === null) return null;
		return component(Notice, {
			get message() {
				return `${current.code}：${current.message}`;
			},
			tone: "danger"
		});
	}
	return (() => {
		const __nsh_hv5 = element("view");
		bindProp(__nsh_hv5, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		insert(__nsh_hv5, [component(Row, {
			wrap: true,
			gap: 8,
			align: "center",
			style: {
				paddingHorizontal: 14,
				paddingVertical: 10
			},
			get children() {
				return [
					(() => {
						const __nsh_hv6 = element("text");
						bindProp(__nsh_hv6, "style", () => t.h1);
						const __nsh_hv7 = text("资源调用示例");
						append(__nsh_hv6, __nsh_hv7);
						return __nsh_hv6;
					})(),
					component(Badge, {
						text: "能力平面",
						tone: "info"
					}),
					component(Badge, {
						get text() {
							return busy() ? "调用中…" : "空闲";
						},
						get tone() {
							return busy() ? "warn" : "ok";
						}
					})
				];
			}
		}), component(Stack, {
			scroll: true,
			padding: 14,
			gap: 12,
			get children() {
				return [
					() => notice() === null ? null : component(Notice, { get message() {
						return notice() ?? "";
					} }),
					() => failureBox(),
					component(Card, {
						title: "页面上下文",
						hint: "host.params",
						get children() {
							return component(KeyValue, {
								get rows() {
									return contextRows();
								},
								columns: 2
							});
						}
					}),
					component(Card, {
						title: "借用连接",
						hint: "宿主把连接资源打开后借给页面，句柄可以直接 invoke",
						get right() {
							return component(Badge, {
								get text() {
									return connection() === null ? "无连接" : "已借到";
								},
								get tone() {
									return connection() === null ? "neutral" : "ok";
								}
							});
						},
						get children() {
							return () => {
								const borrowed = connection();
								if (borrowed === null) return (() => {
									const __nsh_hv8 = element("text");
									bindProp(__nsh_hv8, "style", () => t.meta);
									const __nsh_hv9 = text("当前页面不是连接型 shell view，没有借来的连接。可以在下面的「打开资源」里用后端别名自己打开一个资源。");
									append(__nsh_hv8, __nsh_hv9);
									return __nsh_hv8;
								})();
								return (() => {
									const __nsh_hv10 = element("view");
									prop(__nsh_hv10, "style", {
										display: "flex",
										flexDirection: "column",
										gap: 8
									});
									insert(__nsh_hv10, [component(KeyValue, {
										get rows() {
											return [
												["连接", textOf(borrowed.name)],
												["别名", textOf(borrowed.alias)],
												["资源类型", textOf(borrowed.resourceType)],
												["句柄", textOf(borrowed.resourceHandle)]
											];
										},
										columns: 2
									}), component(Row, {
										gap: 6,
										get children() {
											return component(Button, {
												small: true,
												tone: "primary",
												label: "用借用资源调用",
												onPress: () => void invoke(textOf(borrowed.resourceHandle, ""), method(), params(), "借用资源")
											});
										}
									})]);
									return __nsh_hv10;
								})();
							};
						}
					}),
					component(Card, {
						title: "打开资源",
						hint: "navop.resource.open / ping / close",
						get children() {
							return (() => {
								const __nsh_hv11 = element("view");
								prop(__nsh_hv11, "style", {
									display: "flex",
									flexDirection: "column",
									gap: 8
								});
								insert(__nsh_hv11, [
									component(Row, {
										gap: 10,
										wrap: true,
										get children() {
											return [component(Field, {
												label: "后端别名",
												get hint() {
													return backends().length === 0 ? "shellView 没有声明 backends" : `可选：${backends().join(" / ")}`;
												},
												get value() {
													return alias();
												},
												onChange: (value) => alias.set(value),
												placeholder: "例如 demo"
											}), component(Field, {
												label: "资源类型",
												get value() {
													return resourceType();
												},
												onChange: (value) => resourceType.set(value),
												placeholder: "例如 demo-item"
											})];
										}
									}),
									component(Field, {
										label: "配置",
										multiline: true,
										height: 84,
										get value() {
											return config();
										},
										onChange: (value) => config.set(value),
										placeholder: "{}"
									}),
									component(Row, {
										gap: 6,
										align: "center",
										wrap: true,
										get children() {
											return [
												component(Button, {
													label: "打开资源",
													tone: "primary",
													small: true,
													onPress: () => void openResource(alias())
												}),
												component(Button, {
													label: "ping",
													small: true,
													onPress: () => void ping()
												}),
												component(Button, {
													label: "关闭资源",
													small: true,
													onPress: () => void close()
												}),
												(() => {
													const __nsh_hv12 = element("text");
													bindProp(__nsh_hv12, "style", () => t.meta);
													const __nsh_hv13 = text("当前句柄：");
													append(__nsh_hv12, __nsh_hv13);
													insert(__nsh_hv12, () => handle() ?? "无");
													return __nsh_hv12;
												})()
											];
										}
									})
								]);
								return __nsh_hv11;
							})();
						}
					}),
					component(Card, {
						title: "调用方法",
						hint: "navop.resource.invoke",
						get children() {
							return (() => {
								const __nsh_hv14 = element("view");
								prop(__nsh_hv14, "style", {
									display: "flex",
									flexDirection: "column",
									gap: 8
								});
								insert(__nsh_hv14, [
									component(Row, {
										gap: 10,
										wrap: true,
										get children() {
											return component(Field, {
												label: "方法",
												get value() {
													return method();
												},
												onChange: (value) => method.set(value),
												placeholder: "namespace/method"
											});
										}
									}),
									component(Field, {
										label: "params",
										multiline: true,
										height: 96,
										get value() {
											return params();
										},
										onChange: (value) => params.set(value),
										placeholder: "{}"
									}),
									component(Row, {
										gap: 6,
										align: "center",
										get children() {
											return [component(Button, {
												label: "调用当前句柄",
												tone: "primary",
												small: true,
												onPress: () => {
													const current = handle();
													if (current === null) {
														failure.set({
															code: "NO_HANDLE",
															message: "还没有打开的句柄：先在上面「打开资源」，或使用借来的连接。"
														});
														return;
													}
													invoke(current, method(), params(), "资源");
												}
											}), (() => {
												const __nsh_hv15 = element("text");
												bindProp(__nsh_hv15, "style", () => t.meta);
												const __nsh_hv16 = text("失败时会显示宿主返回的稳定错误码。");
												append(__nsh_hv15, __nsh_hv16);
												return __nsh_hv15;
											})()];
										}
									})
								]);
								return __nsh_hv14;
							})();
						}
					}),
					component(Card, {
						title: "调用结果",
						get right() {
							return component(Badge, {
								get text() {
									return result() === null ? "空" : "有结果";
								},
								get tone() {
									return result() === null ? "neutral" : "ok";
								}
							});
						},
						get children() {
							return () => {
								const current = result();
								if (current === null) return component(Empty, {
									title: "还没有调用结果",
									hint: "打开资源（或使用借来的连接）后，在「调用方法」里点一次调用，结果会显示在这里。"
								});
								return (() => {
									const __nsh_hv17 = element("view");
									bindProp(__nsh_hv17, "style", () => ({
										padding: 10,
										borderRadius: r.control,
										borderWidth: 1,
										borderColor: c.line(),
										backgroundColor: c.panel(),
										maxHeight: 320
									}));
									insert(__nsh_hv17, component(Stack, {
										scroll: true,
										padding: 0,
										gap: 0,
										get children() {
											return (() => {
												const __nsh_hv18 = element("text");
												prop(__nsh_hv18, "selectable", true);
												bindProp(__nsh_hv18, "style", () => ({
													...t.mono,
													lineHeight: 18
												}));
												insert(__nsh_hv18, current);
												return __nsh_hv18;
											})();
										}
									}));
									return __nsh_hv17;
								})();
							};
						}
					}),
					(() => {
						const __nsh_hv19 = element("text");
						bindProp(__nsh_hv19, "style", () => t.meta);
						const __nsh_hv20 = text("常见错误码：BACKEND_NOT_FOUND（别名没在 backends 里注册）、INVALID_HANDLE / STALE_HANDLE（句柄作废或来自其它会话）、 PERMISSION_DENIED（extension.json 的 modules 没声明对应模块）、RUNTIME_UNAVAILABLE（后端运行时没起来）。");
						append(__nsh_hv19, __nsh_hv20);
						return __nsh_hv19;
					})()
				];
			}
		})]);
		return __nsh_hv5;
	})();
}

//#endregion
//#region App.tsx
const params = host.params;
/** 路由表：单路由 app，表里的第一条就是唯一首屏。 */
const ROUTES = [{
	id: "tool",
	title: "Tool",
	component: Tool
}];
const DEFAULT_ROUTE = "tool";
/** 未知 route 回落默认路由（拼写错误、老 view id 都走这里）。 */
function resolveRoute(value) {
	if (typeof value === "string" && ROUTES.some((item) => item.id === value)) return value;
	return DEFAULT_ROUTE;
}
function App() {
	const route = resolveRoute(params.route);
	const Page = (ROUTES.find((item) => item.id === route) ?? ROUTES[0]).component;
	return (() => {
		const __nsh_hv0 = element("view");
		bindProp(__nsh_hv0, "style", () => ({
			flex: 1,
			minWidth: 0,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		insert(__nsh_hv0, component(Page, {}));
		return __nsh_hv0;
	})();
}
mount(App);

//#endregion
export { App as default };