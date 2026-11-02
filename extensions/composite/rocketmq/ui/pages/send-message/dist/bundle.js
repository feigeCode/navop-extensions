import { append, bindProp, component, element, insert, prop, text } from "nsh:rt";
import { host, mount, signal, token } from "nsh";

//#region ../../../../docker/ui/lib/format.ts
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
/** 可滚动的行列表：单选、悬停底色、按 key 高亮。 */
function List(props) {
	if (props.items.length === 0 && props.empty !== void 0) return props.empty;
	return (() => {
		const __nsh_hv17 = element("scroll");
		prop(__nsh_hv17, "style", {
			flex: 1,
			minHeight: 0
		});
		const __nsh_hv18 = element("view");
		prop(__nsh_hv18, "style", {
			display: "flex",
			flexDirection: "column"
		});
		insert(__nsh_hv18, () => props.items.map((item, index) => {
			const key = props.keyOf(item);
			const active = props.selected === key;
			return (() => {
				const __nsh_hv19 = element("view");
				bindProp(__nsh_hv19, "onPress", () => props.onSelect === void 0 ? void 0 : () => props.onSelect?.(key));
				bindProp(__nsh_hv19, "style", () => ({
					backgroundColor: active ? c.hover() : "transparent",
					borderBottomWidth: index === props.items.length - 1 ? 0 : 1,
					borderBottomColor: c.line()
				}));
				insert(__nsh_hv19, () => props.render(item, index));
				return __nsh_hv19;
			})();
		}));
		append(__nsh_hv17, __nsh_hv18);
		return __nsh_hv17;
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
						const __nsh_hv42 = element("text");
						bindProp(__nsh_hv42, "style", () => t.label);
						insert(__nsh_hv42, () => props.title);
						return __nsh_hv42;
					})(), () => props.hint === void 0 ? null : (() => {
						const __nsh_hv43 = element("text");
						bindProp(__nsh_hv43, "style", () => t.meta);
						insert(__nsh_hv43, () => props.hint);
						return __nsh_hv43;
					})()];
				}
			}), () => props.right];
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
const HISTORY_LIMIT = 20;
function jsonState(text) {
	const trimmed = text.trim();
	if (trimmed.length === 0) return "empty";
	if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return "bad";
	try {
		JSON.parse(trimmed);
		return "ok";
	} catch {
		return "bad";
	}
}
function nowText() {
	const date = /* @__PURE__ */ new Date();
	const pad = (value) => String(value).padStart(2, "0");
	return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function byteLength(text) {
	return new TextEncoder().encode(text).length;
}
function oneLine(text, limit = 120) {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}
function asRecord(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value;
}
function textOf(source, key) {
	const value = source[key];
	if (typeof value === "string") return value;
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return "";
}
/** 带边框的输入框，标签在上；`mono` 用于消息体。 */
function Field(props) {
	return (() => {
		const __nsh_hv0 = element("view");
		prop(__nsh_hv0, "style", {
			display: "flex",
			flexDirection: "column",
			gap: 4,
			flex: 1,
			minWidth: 0
		});
		const __nsh_hv5 = element("view");
		bindProp(__nsh_hv5, "style", () => ({
			height: 30,
			paddingHorizontal: 9,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: c.line(),
			backgroundColor: c.bg(),
			display: "flex",
			flexDirection: "row",
			alignItems: "center"
		}));
		const __nsh_hv6 = element("input");
		bindProp(__nsh_hv6, "value", () => props.value);
		bindProp(__nsh_hv6, "placeholder", () => props.placeholder);
		prop(__nsh_hv6, "onChange", (text) => props.onChange(text));
		bindProp(__nsh_hv6, "style", () => ({
			flex: 1,
			minWidth: 0,
			fontSize: 13,
			color: c.text(),
			paddingHorizontal: 0,
			borderWidth: 0,
			backgroundColor: "transparent"
		}));
		append(__nsh_hv5, __nsh_hv6);
		append(__nsh_hv0, __nsh_hv5);
		insert(__nsh_hv0, component(Row, {
			gap: 6,
			get children() {
				return [
					(() => {
						const __nsh_hv1 = element("text");
						bindProp(__nsh_hv1, "style", () => t.label);
						insert(__nsh_hv1, () => props.label);
						return __nsh_hv1;
					})(),
					() => props.required === true ? (() => {
						const __nsh_hv2 = element("text");
						bindProp(__nsh_hv2, "style", () => ({
							fontSize: 11,
							color: c.danger()
						}));
						const __nsh_hv3 = text("必填");
						append(__nsh_hv2, __nsh_hv3);
						return __nsh_hv2;
					})() : null,
					() => props.hint === void 0 ? null : (() => {
						const __nsh_hv4 = element("text");
						bindProp(__nsh_hv4, "style", () => t.meta);
						insert(__nsh_hv4, () => props.hint);
						return __nsh_hv4;
					})()
				];
			}
		}), __nsh_hv5);
		return __nsh_hv0;
	})();
}
function SendMessage() {
	const topic = signal("");
	const tag = signal("");
	const key = signal("");
	const body = signal("");
	const sending = signal(false);
	const formError = signal(null);
	const outcome = signal(null);
	const history = signal([]);
	const seq = signal(0);
	const state = () => jsonState(body());
	function applyHistory(entry) {
		topic.set(entry.topic);
		tag.set(entry.tag);
		key.set(entry.key);
		body.set(entry.body);
		formError.set(null);
		outcome.set(null);
	}
	function pushHistory(entry) {
		const next = seq() + 1;
		seq.set(next);
		const withId = {
			...entry,
			id: `h${next}`
		};
		history.set([withId].concat(history()).slice(0, HISTORY_LIMIT));
	}
	async function send() {
		if (sending()) return;
		const topicText = topic().trim();
		if (topicText.length === 0) {
			formError.set("请先填写 Topic。");
			return;
		}
		const tagText = tag().trim();
		const keyText = key().trim();
		const bodyText = body();
		formError.set(null);
		outcome.set(null);
		sending.set(true);
		try {
			const input = { topic: topicText };
			if (tagText.length > 0) input.tag = tagText;
			if (keyText.length > 0) input.key = keyText;
			input.body = Array.from(new TextEncoder().encode(bodyText));
			const record = asRecord(await host.call("navop.workbench.dispatch", {
				operationId: "sendMessage",
				input,
				options: { confirmed: true }
			}));
			const messageId = record === null ? "" : textOf(record, "message_id");
			const status = record === null ? "" : textOf(record, "status");
			outcome.set({
				ok: true,
				title: "发送成功",
				detail: status.length > 0 ? `状态：${status}` : "服务端已接收",
				messageId,
				status
			});
			pushHistory({
				topic: topicText,
				tag: tagText,
				key: keyText,
				body: bodyText,
				ok: true,
				detail: messageId.length > 0 ? messageId : status,
				at: nowText()
			});
		} catch (failure) {
			const reason = errorMessage(failure);
			outcome.set({
				ok: false,
				title: "发送失败",
				detail: reason,
				messageId: "",
				status: ""
			});
			pushHistory({
				topic: topicText,
				tag: tagText,
				key: keyText,
				body: bodyText,
				ok: false,
				detail: reason,
				at: nowText()
			});
		} finally {
			sending.set(false);
		}
	}
	const stateBadge = () => {
		const current = state();
		if (current === "ok") return component(Badge, {
			text: "JSON 合法",
			tone: "ok"
		});
		if (current === "bad") return component(Badge, {
			text: "JSON 不合法",
			tone: "warn"
		});
		return component(Badge, { text: "空消息体" });
	};
	const stateHint = () => {
		const current = state();
		if (current === "ok") return "将按原始文本发送（不会重新序列化）。";
		if (current === "bad") return "不是合法 JSON，仍会按原文发送。";
		return "纯文本也可以发送；消息体为空时发送空消息。";
	};
	const resultView = () => {
		const current = outcome();
		if (current === null) return null;
		if (current.ok) return component(Notice, {
			tone: "ok",
			get message() {
				return `${current.title}${current.messageId.length > 0 ? `：${current.messageId}` : ""}`;
			}
		});
		return component(Notice, {
			tone: "danger",
			get message() {
				return `${current.title}：${current.detail}`;
			}
		});
	};
	const form = component(Stack, {
		scroll: true,
		padding: 14,
		gap: 12,
		get children() {
			return [
				component(Card, {
					title: "消息目标",
					hint: "Topic 必填，Tag / Key 可选",
					get children() {
						return component(Row, {
							gap: 10,
							wrap: true,
							get children() {
								return [
									component(Field, {
										label: "Topic",
										required: true,
										get value() {
											return topic();
										},
										onChange: (text) => topic.set(text),
										placeholder: "例如 order-topic"
									}),
									component(Field, {
										label: "Tag",
										get value() {
											return tag();
										},
										onChange: (text) => tag.set(text),
										placeholder: "可选，用于消费过滤"
									}),
									component(Field, {
										label: "Key",
										get value() {
											return key();
										},
										onChange: (text) => key.set(text),
										placeholder: "可选，业务唯一键"
									})
								];
							}
						});
					}
				}),
				component(Card, {
					title: "消息体",
					get hint() {
						return `${humanBytes(byteLength(body()))} · UTF-8 编码`;
					},
					get right() {
						return stateBadge();
					},
					get children() {
						return [(() => {
							const __nsh_hv7 = element("view");
							bindProp(__nsh_hv7, "style", () => ({
								height: 260,
								padding: 10,
								borderRadius: r.control,
								borderWidth: 1,
								borderColor: c.line(),
								backgroundColor: c.bg(),
								display: "flex",
								flexDirection: "column"
							}));
							const __nsh_hv8 = element("input");
							prop(__nsh_hv8, "multiline", true);
							bindProp(__nsh_hv8, "value", () => body());
							prop(__nsh_hv8, "placeholder", "例如 {\"orderId\":\"A1001\",\"amount\":99.5}");
							prop(__nsh_hv8, "onChange", (text) => body.set(text));
							bindProp(__nsh_hv8, "style", () => ({
								flex: 1,
								minHeight: 0,
								fontSize: 13,
								lineHeight: 19,
								fontFamily: "monospace",
								color: c.text(),
								paddingHorizontal: 0,
								borderWidth: 0,
								backgroundColor: "transparent"
							}));
							append(__nsh_hv7, __nsh_hv8);
							return __nsh_hv7;
						})(), component(Row, {
							gap: 8,
							wrap: true,
							get children() {
								return (() => {
									const __nsh_hv9 = element("text");
									bindProp(__nsh_hv9, "style", () => t.meta);
									insert(__nsh_hv9, () => stateHint());
									return __nsh_hv9;
								})();
							}
						})];
					}
				}),
				() => formError() === null ? null : component(Notice, {
					tone: "danger",
					get message() {
						return formError() ?? "";
					}
				}),
				() => resultView(),
				component(Row, {
					gap: 8,
					style: { justifyContent: "space-between" },
					get children() {
						return [(() => {
							const __nsh_hv10 = element("text");
							bindProp(__nsh_hv10, "style", () => t.meta);
							const __nsh_hv11 = text("发送为写操作，会先请求宿主确认；正文按原样编码，不做 JSON 重排。");
							append(__nsh_hv10, __nsh_hv11);
							return __nsh_hv10;
						})(), component(Row, {
							gap: 6,
							get children() {
								return [component(Button, {
									label: "清空",
									small: true,
									tone: "ghost",
									onPress: () => {
										body.set("");
										outcome.set(null);
										formError.set(null);
									}
								}), component(Button, {
									get label() {
										return sending() ? "发送中…" : "发送";
									},
									tone: "primary",
									small: true,
									get disabled() {
										return sending() || topic().trim().length === 0;
									},
									onPress: () => void send()
								})];
							}
						})];
					}
				})
			];
		}
	});
	const historyPanel = (() => {
		const __nsh_hv12 = element("view");
		prop(__nsh_hv12, "style", {
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column"
		});
		const __nsh_hv13 = element("view");
		bindProp(__nsh_hv13, "style", () => ({
			paddingHorizontal: 10,
			paddingVertical: 8,
			borderBottomWidth: 1,
			borderBottomColor: c.line()
		}));
		insert(__nsh_hv13, component(SectionTitle, {
			title: "本页发送历史",
			hint: `最近 ${HISTORY_LIMIT} 条 · 点击回填`,
			get right() {
				return component(Button, {
					label: "清空",
					small: true,
					tone: "ghost",
					get disabled() {
						return history().length === 0;
					},
					onPress: () => history.set([])
				});
			}
		}));
		append(__nsh_hv12, __nsh_hv13);
		insert(__nsh_hv12, component(List, {
			get items() {
				return history();
			},
			keyOf: (entry) => entry.id,
			onSelect: (id) => {
				const entry = history().find((item) => item.id === id);
				if (entry !== void 0) applyHistory(entry);
			},
			get empty() {
				return component(Empty, {
					title: "还没有发送记录",
					hint: "发送成功或失败的消息都会留在本页，方便回填重发。"
				});
			},
			render: (entry) => (() => {
				const __nsh_hv14 = element("view");
				prop(__nsh_hv14, "style", {
					display: "flex",
					flexDirection: "column",
					gap: 3,
					padding: 10
				});
				const __nsh_hv17 = element("text");
				prop(__nsh_hv17, "numberOfLines", 1);
				bindProp(__nsh_hv17, "style", () => t.meta);
				const __nsh_hv18 = text(" ·");
				append(__nsh_hv17, __nsh_hv18);
				insert(__nsh_hv17, () => entry.tag.length > 0 ? `tag=${entry.tag}` : "tag=-", __nsh_hv18);
				insert(__nsh_hv17, [" ", () => entry.key.length > 0 ? `key=${entry.key}` : "key=-"]);
				const __nsh_hv19 = element("text");
				prop(__nsh_hv19, "numberOfLines", 2);
				bindProp(__nsh_hv19, "style", () => ({
					fontSize: 11,
					color: c.muted(),
					lineHeight: 15
				}));
				insert(__nsh_hv19, () => entry.body.length === 0 ? "<空消息体>" : oneLine(entry.body));
				append(__nsh_hv14, __nsh_hv17);
				append(__nsh_hv14, __nsh_hv19);
				insert(__nsh_hv14, component(Row, {
					gap: 6,
					get children() {
						return [
							(() => {
								const __nsh_hv15 = element("text");
								prop(__nsh_hv15, "numberOfLines", 1);
								bindProp(__nsh_hv15, "style", () => [t.mono, {
									flex: 1,
									minWidth: 0,
									color: c.text()
								}]);
								insert(__nsh_hv15, () => entry.topic);
								return __nsh_hv15;
							})(),
							component(Badge, {
								get text() {
									return entry.ok ? "成功" : "失败";
								},
								get tone() {
									return entry.ok ? "ok" : "danger";
								}
							}),
							(() => {
								const __nsh_hv16 = element("text");
								bindProp(__nsh_hv16, "style", () => t.meta);
								insert(__nsh_hv16, () => entry.at);
								return __nsh_hv16;
							})()
						];
					}
				}), __nsh_hv17);
				insert(__nsh_hv14, () => entry.detail.length === 0 ? null : (() => {
					const __nsh_hv20 = element("text");
					prop(__nsh_hv20, "numberOfLines", 1);
					bindProp(__nsh_hv20, "style", () => ({
						fontSize: 11,
						color: entry.ok ? c.muted() : c.danger()
					}));
					insert(__nsh_hv20, () => entry.detail);
					return __nsh_hv20;
				})());
				return __nsh_hv14;
			})()
		}));
		return __nsh_hv12;
	})();
	return (() => {
		const __nsh_hv21 = element("view");
		bindProp(__nsh_hv21, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		const __nsh_hv29 = element("view");
		prop(__nsh_hv29, "style", {
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "row"
		});
		const __nsh_hv30 = element("view");
		prop(__nsh_hv30, "style", {
			flex: 1,
			minWidth: 0,
			minHeight: 0,
			display: "flex",
			flexDirection: "column"
		});
		insert(__nsh_hv30, form);
		const __nsh_hv31 = element("view");
		bindProp(__nsh_hv31, "style", () => ({
			width: 320,
			flexShrink: 0,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			borderLeftWidth: 1,
			borderLeftColor: c.line()
		}));
		insert(__nsh_hv31, historyPanel);
		append(__nsh_hv29, __nsh_hv30);
		append(__nsh_hv29, __nsh_hv31);
		append(__nsh_hv21, __nsh_hv29);
		insert(__nsh_hv21, component(Row, {
			gap: 8,
			get style() {
				return {
					paddingHorizontal: 14,
					paddingVertical: 10,
					justifyContent: "space-between",
					borderBottomWidth: 1,
					borderBottomColor: c.line()
				};
			},
			get children() {
				return [component(Row, {
					gap: 8,
					get children() {
						return [
							(() => {
								const __nsh_hv22 = element("text");
								bindProp(__nsh_hv22, "style", () => t.h1);
								const __nsh_hv23 = text("发送消息");
								append(__nsh_hv22, __nsh_hv23);
								return __nsh_hv22;
							})(),
							component(Badge, {
								text: "写操作",
								tone: "info"
							}),
							(() => {
								const __nsh_hv24 = element("text");
								bindProp(__nsh_hv24, "style", () => t.meta);
								const __nsh_hv25 = text("发送前由宿主确认");
								append(__nsh_hv24, __nsh_hv25);
								return __nsh_hv24;
							})()
						];
					}
				}), (() => {
					const __nsh_hv26 = element("text");
					bindProp(__nsh_hv26, "style", () => t.meta);
					const __nsh_hv27 = text("本页历史 ");
					const __nsh_hv28 = text(" 条");
					append(__nsh_hv26, __nsh_hv27);
					append(__nsh_hv26, __nsh_hv28);
					insert(__nsh_hv26, () => history().length, __nsh_hv28);
					return __nsh_hv26;
				})()];
			}
		}), __nsh_hv29);
		return __nsh_hv21;
	})();
}
mount(SendMessage);

//#endregion
export { SendMessage as default };