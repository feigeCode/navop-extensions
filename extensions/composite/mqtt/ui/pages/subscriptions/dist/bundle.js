import { append, bindProp, component, cond, each, element, insert, prop, text } from "nsh:rt";
import { host, mount, signal, token } from "nsh";

//#region ../../../../docker/ui/lib/format.ts
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
//#region ../../../../docker/ui/lib/theme.ts
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
//#region ../../../../docker/ui/lib/ui.tsx
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
					const __nsh_hv47 = element("text");
					bindProp(__nsh_hv47, "style", () => ({
						flex: 1,
						minWidth: 0,
						fontSize: 12,
						color: c.text()
					}));
					insert(__nsh_hv47, () => props.message);
					return __nsh_hv47;
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
const QOS_OPTIONS = [
	0,
	1,
	2
];
const ACTIVE_WINDOW_MS = 3e5;
async function dispatch(operationId, input, confirmed) {
	try {
		return await host.call("navop.workbench.dispatch", {
			operationId,
			input: input ?? {},
			...confirmed === true ? { options: { confirmed: true } } : {}
		});
	} catch (error) {
		throw new Error(errorMessage(error));
	}
}
function toSubscription(raw) {
	if (raw === null || typeof raw !== "object") return null;
	const name = str(raw, "name", "");
	if (name.length === 0) return null;
	const queue = Number(raw.queue_count);
	return {
		name,
		qos: queue === 0 || queue === 1 || queue === 2 ? queue : null,
		topicType: str(raw, "topic_type", ""),
		description: str(raw, "description", "")
	};
}
function isAutomatic(subscription) {
	return subscription.topicType === "AUTO_SUBSCRIPTION";
}
function toSnapshotMessage(raw) {
	const topic = str(raw, "topic", "");
	if (topic.length === 0) return null;
	let receivedAt = 0;
	for (const pair of arr(raw, "properties")) if (Array.isArray(pair) && pair[0] === "received_at_ms") receivedAt = Number(pair[1]);
	return {
		topic,
		receivedAt: Number.isFinite(receivedAt) ? receivedAt : 0
	};
}
/** MQTT 过滤器合法性：`#` 只能是最后一层且独占，`+` 必须独占一层。 */
function filterProblem(filter) {
	if (filter.trim().length === 0) return "topic 不能为空。";
	if (filter !== filter.trim()) return "topic 首尾不能有空格。";
	const levels = filter.split("/");
	for (let index = 0; index < levels.length; index += 1) {
		const level = levels[index];
		if (level.includes("#") && (level !== "#" || index !== levels.length - 1)) return "「#」只能作为最后一层单独出现。";
		if (level.includes("+") && level !== "+") return "「+」必须独占一层。";
	}
	return null;
}
function topicMatches(filter, topic) {
	const parts = filter.split("/");
	const actual = topic.split("/");
	for (let index = 0; index < parts.length; index += 1) {
		if (parts[index] === "#") return true;
		if (index >= actual.length) return false;
		if (parts[index] !== "+" && parts[index] !== actual[index]) return false;
	}
	return parts.length === actual.length;
}
function qosLabel(qos) {
	return qos === null ? "自定义" : String(qos);
}
function statusOf(recent) {
	if (recent === null) return {
		text: "未知",
		tone: "neutral"
	};
	if (recent > 0) return {
		text: "活跃",
		tone: "ok"
	};
	return {
		text: "空闲",
		tone: "neutral"
	};
}
function Subscriptions() {
	const subscriptions = signal([]);
	const snapshot = signal(null);
	const loading = signal(true);
	const refreshing = signal(false);
	const error = signal(null);
	const snapshotError = signal(null);
	const notice = signal(null);
	const filterText = signal("");
	const adding = signal(false);
	const newTopic = signal("");
	const newQos = signal(1);
	const addBusy = signal(false);
	const addError = signal(null);
	const pendingUnsub = signal(null);
	const unsubBusy = signal(null);
	function visible() {
		const needle = filterText().trim().toLowerCase();
		if (needle.length === 0) return subscriptions();
		return subscriptions().filter((subscription) => subscription.name.toLowerCase().includes(needle) || subscription.description.toLowerCase().includes(needle));
	}
	function countMatching(filter, withinMs) {
		const messages = snapshot();
		if (messages === null) return null;
		const boundary = withinMs === null ? 0 : Date.now() - withinMs;
		let count = 0;
		for (const message of messages) {
			if (message.receivedAt < boundary) continue;
			if (topicMatches(filter, message.topic)) count += 1;
		}
		return count;
	}
	async function load(initial) {
		if (refreshing()) return;
		refreshing.set(true);
		if (initial) loading.set(true);
		try {
			const result = await dispatch("listTopics");
			const rows = arr(result, "topics").map(toSubscription).filter((row) => row !== null);
			subscriptions.set(rows);
			error.set(null);
		} catch (failure) {
			if (subscriptions().length === 0) error.set(errorMessage(failure));
			else notice.set(`刷新订阅失败：${errorMessage(failure)}`);
			loading.set(false);
			refreshing.set(false);
			return;
		}
		try {
			const result = await dispatch("queryByWindow", { ByTimeWindow: {
				topic: "#",
				begin_unix_ms: 0,
				end_unix_ms: Date.now(),
				page: 1,
				page_size: 1e3
			} });
			const rows = arr(result, "messages").map(toSnapshotMessage).filter((row) => row !== null);
			snapshot.set(rows);
			snapshotError.set(null);
		} catch (failure) {
			snapshot.set(null);
			snapshotError.set(errorMessage(failure));
		} finally {
			loading.set(false);
			refreshing.set(false);
		}
	}
	async function submit() {
		if (addBusy()) return;
		const topic = newTopic().trim();
		const problem = filterProblem(topic);
		if (problem !== null) {
			addError.set(problem);
			return;
		}
		if (subscriptions().some((subscription) => subscription.name === topic)) {
			addError.set("这个 topic 已经在订阅列表里了。");
			return;
		}
		addBusy.set(true);
		addError.set(null);
		try {
			await dispatch("subscribe", {
				topic,
				qos: newQos()
			}, true);
			notice.set(`已订阅 ${topic}（QoS ${newQos()}）。`);
			newTopic.set("");
			adding.set(false);
			await load(false);
		} catch (failure) {
			addError.set(errorMessage(failure));
		} finally {
			addBusy.set(false);
		}
	}
	async function remove(subscription) {
		if (unsubBusy() !== null) return;
		unsubBusy.set(subscription.name);
		try {
			await dispatch("unsubscribe", { topic: subscription.name }, true);
			pendingUnsub.set(null);
			notice.set(`已取消订阅 ${subscription.name}。`);
			await load(false);
		} catch (failure) {
			notice.set(`取消订阅失败：${errorMessage(failure)}`);
		} finally {
			unsubBusy.set(null);
		}
	}
	load(true);
	function headerRow() {
		return component(Row, {
			gap: 8,
			get style() {
				return {
					paddingHorizontal: 14,
					paddingVertical: 10,
					borderBottomWidth: 1,
					borderBottomColor: c.line()
				};
			},
			get children() {
				return [
					(() => {
						const __nsh_hv0 = element("text");
						bindProp(__nsh_hv0, "style", () => t.h1);
						const __nsh_hv1 = text("订阅");
						append(__nsh_hv0, __nsh_hv1);
						return __nsh_hv0;
					})(),
					component(Badge, { get text() {
						return `${subscriptions().length} 个`;
					} }),
					(() => {
						const __nsh_hv2 = element("view");
						prop(__nsh_hv2, "style", {
							flex: 1,
							minWidth: 8
						});
						return __nsh_hv2;
					})(),
					(() => {
						const __nsh_hv3 = element("view");
						bindProp(__nsh_hv3, "style", () => ({
							height: 28,
							width: 260,
							borderWidth: 1,
							borderColor: c.line(),
							borderRadius: r.control,
							backgroundColor: c.bg(),
							paddingHorizontal: 8,
							display: "flex",
							flexDirection: "row",
							alignItems: "center"
						}));
						const __nsh_hv4 = element("input");
						bindProp(__nsh_hv4, "value", () => filterText());
						prop(__nsh_hv4, "onChange", (text) => filterText.set(text));
						prop(__nsh_hv4, "placeholder", "搜索订阅模式或说明");
						bindProp(__nsh_hv4, "style", () => ({
							flex: 1,
							fontSize: 12,
							paddingHorizontal: 0,
							borderWidth: 0,
							backgroundColor: "transparent",
							color: c.text()
						}));
						append(__nsh_hv3, __nsh_hv4);
						return __nsh_hv3;
					})(),
					() => refreshing() ? component(Button, {
						label: "刷新中…",
						small: true,
						disabled: true
					}) : component(Button, {
						label: "刷新",
						small: true,
						onPress: () => void load(false)
					}),
					() => adding() ? component(Button, {
						label: "收起表单",
						small: true,
						onPress: () => adding.set(false)
					}) : component(Button, {
						label: "新增订阅",
						small: true,
						tone: "primary",
						onPress: () => {
							addError.set(null);
							adding.set(true);
						}
					})
				];
			}
		});
	}
	function addForm() {
		return component(Card, {
			title: "新增订阅",
			hint: "topic 支持 MQTT 通配符：+ 一层，# 末尾多层",
			get children() {
				return (() => {
					const __nsh_hv5 = element("view");
					prop(__nsh_hv5, "style", {
						display: "flex",
						flexDirection: "column",
						gap: 10
					});
					insert(__nsh_hv5, [component(Row, {
						gap: 10,
						align: "center",
						get children() {
							return [
								(() => {
									const __nsh_hv6 = element("input");
									bindProp(__nsh_hv6, "value", () => newTopic());
									prop(__nsh_hv6, "onChange", (text) => newTopic.set(text));
									prop(__nsh_hv6, "onSubmit", () => void submit());
									prop(__nsh_hv6, "placeholder", "例如 sensor/+/temperature 或 devices/#");
									bindProp(__nsh_hv6, "style", () => ({
										flex: 1,
										minWidth: 0,
										height: 30,
										fontSize: 13,
										borderWidth: 1,
										borderColor: c.line(),
										borderRadius: r.control,
										backgroundColor: c.bg(),
										color: c.text(),
										paddingHorizontal: 8
									}));
									return __nsh_hv6;
								})(),
								(() => {
									const __nsh_hv7 = element("text");
									bindProp(__nsh_hv7, "style", () => t.label);
									const __nsh_hv8 = text("QoS");
									append(__nsh_hv7, __nsh_hv8);
									return __nsh_hv7;
								})(),
								component(Row, {
									gap: 4,
									get children() {
										return QOS_OPTIONS.map((qos) => newQos() === qos ? component(Button, {
											get label() {
												return String(qos);
											},
											small: true,
											tone: "primary",
											onPress: () => newQos.set(qos)
										}) : component(Button, {
											get label() {
												return String(qos);
											},
											small: true,
											onPress: () => newQos.set(qos)
										}));
									}
								}),
								() => addBusy() ? component(Button, {
									label: "订阅中…",
									small: true,
									disabled: true
								}) : component(Button, {
									label: "确认订阅",
									small: true,
									tone: "primary",
									onPress: () => void submit()
								})
							];
						}
					}), () => addError() === null ? (() => {
						const __nsh_hv9 = element("text");
						bindProp(__nsh_hv9, "style", () => t.meta);
						const __nsh_hv10 = text("订阅会先校验过滤器格式，写操作会带二次确认。");
						append(__nsh_hv9, __nsh_hv10);
						return __nsh_hv9;
					})() : component(Notice, {
						get message() {
							return addError() ?? "";
						},
						tone: "danger"
					})]);
					return __nsh_hv5;
				})();
			}
		});
	}
	function tableHeader() {
		return component(Row, {
			gap: 8,
			get style() {
				return {
					paddingHorizontal: 12,
					paddingVertical: 6,
					borderBottomWidth: 1,
					borderBottomColor: c.line()
				};
			},
			get children() {
				return [
					(() => {
						const __nsh_hv11 = element("text");
						bindProp(__nsh_hv11, "style", () => ({
							...t.label,
							flex: 1,
							minWidth: 0
						}));
						const __nsh_hv12 = text("订阅模式");
						append(__nsh_hv11, __nsh_hv12);
						return __nsh_hv11;
					})(),
					(() => {
						const __nsh_hv13 = element("text");
						bindProp(__nsh_hv13, "style", () => ({
							...t.label,
							width: 64,
							textAlign: "center"
						}));
						const __nsh_hv14 = text("QoS");
						append(__nsh_hv13, __nsh_hv14);
						return __nsh_hv13;
					})(),
					(() => {
						const __nsh_hv15 = element("text");
						bindProp(__nsh_hv15, "style", () => ({
							...t.label,
							width: 88,
							textAlign: "right"
						}));
						const __nsh_hv16 = text("缓冲内消息");
						append(__nsh_hv15, __nsh_hv16);
						return __nsh_hv15;
					})(),
					(() => {
						const __nsh_hv17 = element("text");
						bindProp(__nsh_hv17, "style", () => ({
							...t.label,
							width: 88,
							textAlign: "right"
						}));
						const __nsh_hv18 = text("近 5 分钟");
						append(__nsh_hv17, __nsh_hv18);
						return __nsh_hv17;
					})(),
					(() => {
						const __nsh_hv19 = element("text");
						bindProp(__nsh_hv19, "style", () => ({
							...t.label,
							width: 92,
							textAlign: "center"
						}));
						const __nsh_hv20 = text("状态");
						append(__nsh_hv19, __nsh_hv20);
						return __nsh_hv19;
					})(),
					(() => {
						const __nsh_hv21 = element("text");
						bindProp(__nsh_hv21, "style", () => ({
							...t.label,
							width: 120,
							textAlign: "right"
						}));
						const __nsh_hv22 = text("操作");
						append(__nsh_hv21, __nsh_hv22);
						return __nsh_hv21;
					})()
				];
			}
		});
	}
	function statusBadge(subscription) {
		if (isAutomatic(subscription)) return component(Badge, {
			text: "自动订阅",
			tone: "info"
		});
		const status = statusOf(countMatching(subscription.name, ACTIVE_WINDOW_MS));
		return component(Badge, {
			get text() {
				return status.text;
			},
			get tone() {
				return status.tone;
			}
		});
	}
	function countText(subscription, withinMs) {
		const count = countMatching(subscription.name, withinMs);
		return count === null ? "—" : String(count);
	}
	function unsubscribeCell(subscription) {
		if (isAutomatic(subscription)) return (() => {
			const __nsh_hv23 = element("text");
			bindProp(__nsh_hv23, "style", () => t.meta);
			const __nsh_hv24 = text("只读");
			append(__nsh_hv23, __nsh_hv24);
			return __nsh_hv23;
		})();
		if (pendingUnsub() === subscription.name) return (() => {
			const __nsh_hv25 = element("text");
			bindProp(__nsh_hv25, "style", () => t.meta);
			const __nsh_hv26 = text("待确认");
			append(__nsh_hv25, __nsh_hv26);
			return __nsh_hv25;
		})();
		return component(Button, {
			label: "取消订阅",
			small: true,
			tone: "danger",
			onPress: () => pendingUnsub.set(subscription.name)
		});
	}
	function subscriptionRow(subscription) {
		return (() => {
			const __nsh_hv27 = element("view");
			bindProp(__nsh_hv27, "style", () => ({
				borderBottomWidth: 1,
				borderBottomColor: c.line(),
				display: "flex",
				flexDirection: "column"
			}));
			insert(__nsh_hv27, [component(Row, {
				gap: 8,
				style: {
					paddingHorizontal: 12,
					paddingVertical: 9
				},
				get children() {
					return [
						(() => {
							const __nsh_hv28 = element("view");
							prop(__nsh_hv28, "style", {
								flex: 1,
								minWidth: 0,
								display: "flex",
								flexDirection: "column",
								gap: 2
							});
							const __nsh_hv29 = element("text");
							prop(__nsh_hv29, "numberOfLines", 1);
							bindProp(__nsh_hv29, "style", () => ({
								...t.mono,
								fontSize: 12.5,
								color: c.text()
							}));
							insert(__nsh_hv29, () => subscription.name);
							append(__nsh_hv28, __nsh_hv29);
							insert(__nsh_hv28, () => subscription.description.length === 0 ? null : (() => {
								const __nsh_hv30 = element("text");
								prop(__nsh_hv30, "numberOfLines", 1);
								bindProp(__nsh_hv30, "style", () => t.meta);
								insert(__nsh_hv30, () => subscription.description);
								return __nsh_hv30;
							})());
							return __nsh_hv28;
						})(),
						(() => {
							const __nsh_hv31 = element("text");
							bindProp(__nsh_hv31, "style", () => ({
								...t.meta,
								width: 64,
								textAlign: "center"
							}));
							insert(__nsh_hv31, () => qosLabel(subscription.qos));
							return __nsh_hv31;
						})(),
						(() => {
							const __nsh_hv32 = element("text");
							bindProp(__nsh_hv32, "style", () => ({
								...t.meta,
								width: 88,
								textAlign: "right"
							}));
							insert(__nsh_hv32, () => countText(subscription, null));
							return __nsh_hv32;
						})(),
						(() => {
							const __nsh_hv33 = element("text");
							bindProp(__nsh_hv33, "style", () => ({
								...t.meta,
								width: 88,
								textAlign: "right"
							}));
							insert(__nsh_hv33, () => countText(subscription, ACTIVE_WINDOW_MS));
							return __nsh_hv33;
						})(),
						(() => {
							const __nsh_hv34 = element("view");
							prop(__nsh_hv34, "style", {
								width: 92,
								alignItems: "center"
							});
							insert(__nsh_hv34, () => statusBadge(subscription));
							return __nsh_hv34;
						})(),
						(() => {
							const __nsh_hv35 = element("view");
							prop(__nsh_hv35, "style", {
								width: 120,
								alignItems: "flex-end"
							});
							insert(__nsh_hv35, () => unsubscribeCell(subscription));
							return __nsh_hv35;
						})()
					];
				}
			}), cond(() => pendingUnsub() === subscription.name, () => (() => {
				const __nsh_hv36 = element("view");
				prop(__nsh_hv36, "style", {
					paddingHorizontal: 12,
					paddingBottom: 9
				});
				insert(__nsh_hv36, () => unsubBusy() === subscription.name ? component(ConfirmBar, {
					get message() {
						return `取消订阅 ${subscription.name}？对应 queue 会一并删除，之后不再收到匹配消息。`;
					},
					confirmLabel: "确认取消",
					busy: true,
					onConfirm: () => void remove(subscription),
					onCancel: () => pendingUnsub.set(null)
				}) : component(ConfirmBar, {
					get message() {
						return `取消订阅 ${subscription.name}？对应 queue 会一并删除，之后不再收到匹配消息。`;
					},
					confirmLabel: "确认取消",
					onConfirm: () => void remove(subscription),
					onCancel: () => pendingUnsub.set(null)
				}));
				return __nsh_hv36;
			})())]);
			return __nsh_hv27;
		})();
	}
	function table() {
		return (() => {
			const __nsh_hv37 = element("view");
			prop(__nsh_hv37, "style", {
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "column"
			});
			const __nsh_hv38 = element("scroll");
			prop(__nsh_hv38, "style", {
				flex: 1,
				minHeight: 0
			});
			const __nsh_hv39 = element("view");
			prop(__nsh_hv39, "style", {
				display: "flex",
				flexDirection: "column"
			});
			insert(__nsh_hv39, each(() => visible(), (subscription) => subscriptionRow(subscription()), (subscription) => subscription.name));
			append(__nsh_hv38, __nsh_hv39);
			append(__nsh_hv37, __nsh_hv38);
			insert(__nsh_hv37, () => tableHeader(), __nsh_hv38);
			insert(__nsh_hv37, component(Row, {
				gap: 8,
				get style() {
					return {
						paddingHorizontal: 12,
						paddingVertical: 6,
						borderTopWidth: 1,
						borderTopColor: c.line()
					};
				},
				get children() {
					return [
						(() => {
							const __nsh_hv40 = element("text");
							bindProp(__nsh_hv40, "style", () => t.meta);
							insert(__nsh_hv40, () => snapshot() === null ? "消息数：本地缓冲不可用" : `消息数基于 provider 本地缓冲（上限 1000 条），统计到 ${snapshot()?.length ?? 0} 条`);
							return __nsh_hv40;
						})(),
						(() => {
							const __nsh_hv41 = element("view");
							prop(__nsh_hv41, "style", { flex: 1 });
							return __nsh_hv41;
						})(),
						(() => {
							const __nsh_hv42 = element("text");
							bindProp(__nsh_hv42, "style", () => t.meta);
							const __nsh_hv43 = text("自动订阅由连接配置维护，不能在这里取消");
							append(__nsh_hv42, __nsh_hv43);
							return __nsh_hv42;
						})()
					];
				}
			}));
			return __nsh_hv37;
		})();
	}
	return (() => {
		const __nsh_hv44 = element("view");
		bindProp(__nsh_hv44, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		insert(__nsh_hv44, [
			() => headerRow(),
			cond(() => notice() !== null, () => (() => {
				const __nsh_hv45 = element("view");
				prop(__nsh_hv45, "style", {
					paddingHorizontal: 14,
					paddingTop: 8
				});
				insert(__nsh_hv45, component(Notice, {
					get message() {
						return notice() ?? "";
					},
					tone: "ok"
				}));
				return __nsh_hv45;
			})()),
			cond(() => snapshotError() !== null, () => (() => {
				const __nsh_hv46 = element("view");
				prop(__nsh_hv46, "style", {
					paddingHorizontal: 14,
					paddingTop: 8
				});
				insert(__nsh_hv46, component(Notice, {
					get message() {
						return `消息统计不可用：${snapshotError() ?? ""}`;
					},
					tone: "warn"
				}));
				return __nsh_hv46;
			})()),
			cond(() => adding(), () => (() => {
				const __nsh_hv47 = element("view");
				prop(__nsh_hv47, "style", {
					paddingHorizontal: 14,
					paddingTop: 10
				});
				insert(__nsh_hv47, () => addForm());
				return __nsh_hv47;
			})()),
			cond(() => loading() && subscriptions().length === 0, () => component(Loading, { label: "正在读取订阅…" })),
			cond(() => !loading() && error() !== null && subscriptions().length === 0, () => component(LoadError, {
				get message() {
					return error() ?? "";
				},
				onRetry: () => void load(true)
			})),
			cond(() => !loading() && error() === null && subscriptions().length === 0, () => component(Empty, {
				title: "还没有订阅",
				hint: "点右上角「新增订阅」创建第一条；连接配置里的自动订阅也会出现在这里。"
			})),
			cond(() => subscriptions().length > 0 && visible().length === 0, () => component(Empty, {
				title: "没有匹配的订阅",
				hint: "换个搜索词，或清空搜索框。"
			})),
			cond(() => visible().length > 0, () => () => table()),
			cond(() => subscriptions().length > 0 && visible().length > 0 && error() !== null, () => (() => {
				const __nsh_hv48 = element("view");
				prop(__nsh_hv48, "style", {
					paddingHorizontal: 14,
					paddingBottom: 8
				});
				insert(__nsh_hv48, component(Notice, {
					get message() {
						return `订阅列表可能不是最新：${error() ?? ""}`;
					},
					tone: "warn"
				}));
				return __nsh_hv48;
			})())
		]);
		return __nsh_hv44;
	})();
}
mount(Subscriptions);

//#endregion
export { Subscriptions as default };