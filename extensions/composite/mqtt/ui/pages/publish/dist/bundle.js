import { append, bindProp, component, cond, each, element, insert, prop, text } from "nsh:rt";
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
const HISTORY_LIMIT = 20;
const MAX_PARSE_CHARS = 2e5;
const MAX_PREVIEW_CHARS = 4e3;
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
/** 只做提示用的 JSON 校验；非法时返回解析器的原始错误。 */
function jsonInfo(text) {
	if (text.trim().length === 0) return { kind: "empty" };
	if (text.length > MAX_PARSE_CHARS) return {
		kind: "large",
		length: text.length
	};
	try {
		const pretty = JSON.stringify(JSON.parse(text), null, 2);
		return {
			kind: "json",
			pretty: pretty.length > MAX_PREVIEW_CHARS ? `${pretty.slice(0, MAX_PREVIEW_CHARS)}\n…` : pretty,
			truncated: pretty.length > MAX_PREVIEW_CHARS
		};
	} catch (failure) {
		return {
			kind: "invalid",
			error: errorMessage(failure)
		};
	}
}
function topicProblem(topic) {
	const value = topic.trim();
	if (value.length === 0) return "topic 不能为空。";
	if (value.includes("+") || value.includes("#")) return "发布主题不能包含 + 或 #；通配符只用于订阅。";
	return null;
}
function clockOf(millis) {
	const date = new Date(millis);
	const two = (value) => String(value).padStart(2, "0");
	return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}
function Publish() {
	const topic = signal("");
	const payloadText = signal("");
	const qos = signal(1);
	const retain = signal(false);
	const sending = signal(false);
	const result = signal(null);
	const history = signal([]);
	let historySeq = 0;
	async function send() {
		if (sending()) return;
		const value = topic().trim();
		const problem = topicProblem(value);
		if (problem !== null) {
			result.set({
				ok: false,
				text: problem
			});
			return;
		}
		const text = payloadText();
		const bytes = Array.from(Buffer.from(text, "utf8"));
		sending.set(true);
		result.set(null);
		try {
			const response = await dispatch("publish", {
				topic: value,
				body: bytes,
				properties: [["qos", String(qos())], ["retain", retain() ? "true" : "false"]]
			}, true);
			const messageId = response !== null && typeof response === "object" ? String(response.message_id ?? "") : "";
			result.set({
				ok: true,
				text: `已发布到 ${value} · ${humanBytes(bytes.length)}${messageId.length > 0 ? ` · ${messageId}` : ""}`
			});
			historySeq += 1;
			const entry = {
				seq: historySeq,
				topic: value,
				text,
				qos: qos(),
				retain: retain(),
				at: Date.now()
			};
			history.set([entry, ...history().filter((item) => !(item.topic === entry.topic && item.text === entry.text && item.qos === entry.qos && item.retain === entry.retain))].slice(0, HISTORY_LIMIT));
		} catch (failure) {
			result.set({
				ok: false,
				text: errorMessage(failure)
			});
		} finally {
			sending.set(false);
		}
	}
	function refill(entry) {
		topic.set(entry.topic);
		payloadText.set(entry.text);
		qos.set(entry.qos);
		retain.set(entry.retain);
		result.set(null);
	}
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
						const __nsh_hv1 = text("发布");
						append(__nsh_hv0, __nsh_hv1);
						return __nsh_hv0;
					})(),
					component(Badge, {
						text: "写操作需确认",
						tone: "warn"
					}),
					(() => {
						const __nsh_hv2 = element("view");
						prop(__nsh_hv2, "style", {
							flex: 1,
							minWidth: 8
						});
						return __nsh_hv2;
					})(),
					(() => {
						const __nsh_hv3 = element("text");
						bindProp(__nsh_hv3, "style", () => t.meta);
						insert(__nsh_hv3, () => `payload ${humanBytes(Buffer.byteLength(payloadText(), "utf8"))} · QoS ${qos()}${retain() ? " · retain" : ""}`);
						return __nsh_hv3;
					})()
				];
			}
		});
	}
	function jsonNotice() {
		const info = jsonInfo(payloadText());
		if (info.kind === "empty") return null;
		if (info.kind === "json") return component(Notice, {
			message: "JSON 合法，已生成格式化预览。",
			tone: "ok"
		});
		if (info.kind === "large") return component(Notice, {
			message: `内容超过 ${MAX_PARSE_CHARS} 字符，跳过 JSON 校验；仍按原文发送。`,
			tone: "warn"
		});
		return component(Notice, {
			get message() {
				return `JSON 解析失败：${info.error}。不会阻止发送，payload 将按原文 UTF-8 发送。`;
			},
			tone: "danger"
		});
	}
	function jsonPreview() {
		const info = jsonInfo(payloadText());
		if (info.kind !== "json") return null;
		return (() => {
			const __nsh_hv4 = element("view");
			bindProp(__nsh_hv4, "style", () => ({
				maxHeight: 180,
				borderWidth: 1,
				borderColor: c.line(),
				borderRadius: r.control,
				backgroundColor: c.bg(),
				padding: 8
			}));
			const __nsh_hv5 = element("scroll");
			prop(__nsh_hv5, "style", { maxHeight: 164 });
			const __nsh_hv6 = element("text");
			prop(__nsh_hv6, "selectable", true);
			bindProp(__nsh_hv6, "style", () => ({
				...t.mono,
				fontSize: 12,
				lineHeight: 17,
				color: c.text()
			}));
			insert(__nsh_hv6, () => info.pretty);
			append(__nsh_hv5, __nsh_hv6);
			append(__nsh_hv4, __nsh_hv5);
			insert(__nsh_hv4, () => info.truncated ? (() => {
				const __nsh_hv7 = element("text");
				bindProp(__nsh_hv7, "style", () => ({
					...t.meta,
					marginTop: 4
				}));
				insert(__nsh_hv7, `预览最多显示 ${MAX_PREVIEW_CHARS} 字符。`);
				return __nsh_hv7;
			})() : null);
			return __nsh_hv4;
		})();
	}
	function sendResult() {
		const value = result();
		if (value === null) return null;
		return component(Notice, {
			get message() {
				return value.text;
			},
			get tone() {
				return value.ok ? "ok" : "danger";
			}
		});
	}
	function sendButton() {
		const problem = topicProblem(topic());
		if (sending()) return component(Row, {
			gap: 8,
			get children() {
				return [component(Button, {
					label: "发送中…",
					small: true,
					disabled: true
				}), (() => {
					const __nsh_hv8 = element("text");
					bindProp(__nsh_hv8, "style", () => t.meta);
					const __nsh_hv9 = text("等待 provider 返回结果。");
					append(__nsh_hv8, __nsh_hv9);
					return __nsh_hv8;
				})()];
			}
		});
		if (problem !== null) return component(Row, {
			gap: 8,
			get children() {
				return [component(Button, {
					label: "发送",
					small: true,
					disabled: true
				}), (() => {
					const __nsh_hv10 = element("text");
					bindProp(__nsh_hv10, "style", () => ({
						...t.meta,
						color: c.danger()
					}));
					insert(__nsh_hv10, problem);
					return __nsh_hv10;
				})()];
			}
		});
		return component(Row, {
			gap: 8,
			get children() {
				return [component(Button, {
					label: "发送",
					small: true,
					tone: "primary",
					onPress: () => void send()
				}), (() => {
					const __nsh_hv11 = element("text");
					bindProp(__nsh_hv11, "style", () => t.meta);
					const __nsh_hv12 = text("会带二次确认；成功后写入本页发送历史。");
					append(__nsh_hv11, __nsh_hv12);
					return __nsh_hv11;
				})()];
			}
		});
	}
	function qosButtons() {
		return component(Row, {
			gap: 4,
			get children() {
				return QOS_OPTIONS.map((value) => qos() === value ? component(Button, {
					get label() {
						return String(value);
					},
					small: true,
					tone: "primary",
					onPress: () => qos.set(value)
				}) : component(Button, {
					get label() {
						return String(value);
					},
					small: true,
					onPress: () => qos.set(value)
				}));
			}
		});
	}
	function retainToggle() {
		return retain() ? component(Button, {
			label: "retain：开",
			small: true,
			tone: "primary",
			onPress: () => retain.set(false)
		}) : component(Button, {
			label: "retain：关",
			small: true,
			onPress: () => retain.set(true)
		});
	}
	function form() {
		return (() => {
			const __nsh_hv13 = element("view");
			prop(__nsh_hv13, "style", {
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "column"
			});
			const __nsh_hv14 = element("scroll");
			prop(__nsh_hv14, "style", {
				flex: 1,
				minHeight: 0
			});
			const __nsh_hv15 = element("view");
			prop(__nsh_hv15, "style", {
				padding: 14,
				display: "flex",
				flexDirection: "column",
				gap: 12
			});
			insert(__nsh_hv15, [
				component(Card, {
					title: "目标主题",
					hint: "发布到具体 topic；不支持 + / # 通配符",
					get children() {
						return (() => {
							const __nsh_hv16 = element("input");
							prop(__nsh_hv16, "testID", "topic-input");
							bindProp(__nsh_hv16, "value", () => topic());
							prop(__nsh_hv16, "onChange", (text) => topic.set(text));
							prop(__nsh_hv16, "placeholder", "例如 devices/kitchen/light/set");
							bindProp(__nsh_hv16, "style", () => ({
								width: "100%",
								height: 30,
								fontSize: 13,
								borderWidth: 1,
								borderColor: c.line(),
								borderRadius: r.control,
								backgroundColor: c.bg(),
								color: c.text(),
								paddingHorizontal: 8
							}));
							return __nsh_hv16;
						})();
					}
				}),
				component(Card, {
					title: "消息内容",
					hint: "按 UTF-8 编码为字节数组发送；多行文本原样保留",
					get right() {
						return (() => {
							const __nsh_hv17 = element("text");
							bindProp(__nsh_hv17, "style", () => t.meta);
							insert(__nsh_hv17, () => `${payloadText().length} 字符 · ${humanBytes(Buffer.byteLength(payloadText(), "utf8"))}`);
							return __nsh_hv17;
						})();
					},
					get children() {
						return (() => {
							const __nsh_hv18 = element("view");
							prop(__nsh_hv18, "style", {
								display: "flex",
								flexDirection: "column",
								gap: 8
							});
							const __nsh_hv19 = element("input");
							prop(__nsh_hv19, "testID", "payload-input");
							prop(__nsh_hv19, "multiline", true);
							bindProp(__nsh_hv19, "value", () => payloadText());
							prop(__nsh_hv19, "onChange", (text) => payloadText.set(text));
							prop(__nsh_hv19, "placeholder", "{\"temperature\": 23.5, \"unit\": \"C\"}");
							bindProp(__nsh_hv19, "style", () => ({
								width: "100%",
								minHeight: 180,
								height: 180,
								...t.mono,
								fontSize: 12,
								lineHeight: 18,
								borderWidth: 1,
								borderColor: c.line(),
								borderRadius: r.control,
								backgroundColor: c.bg(),
								color: c.text(),
								paddingHorizontal: 8,
								paddingVertical: 8
							}));
							append(__nsh_hv18, __nsh_hv19);
							insert(__nsh_hv18, [() => jsonNotice(), () => jsonPreview()]);
							return __nsh_hv18;
						})();
					}
				}),
				component(Card, {
					title: "发送选项",
					get children() {
						return (() => {
							const __nsh_hv20 = element("view");
							prop(__nsh_hv20, "style", {
								display: "flex",
								flexDirection: "column",
								gap: 10
							});
							insert(__nsh_hv20, [
								component(Row, {
									gap: 10,
									get children() {
										return [
											(() => {
												const __nsh_hv21 = element("text");
												bindProp(__nsh_hv21, "style", () => t.label);
												const __nsh_hv22 = text("QoS");
												append(__nsh_hv21, __nsh_hv22);
												return __nsh_hv21;
											})(),
											() => qosButtons(),
											(() => {
												const __nsh_hv23 = element("view");
												prop(__nsh_hv23, "style", { flex: 1 });
												return __nsh_hv23;
											})(),
											(() => {
												const __nsh_hv24 = element("text");
												bindProp(__nsh_hv24, "style", () => t.label);
												const __nsh_hv25 = text("Retain");
												append(__nsh_hv24, __nsh_hv25);
												return __nsh_hv24;
											})(),
											() => retainToggle()
										];
									}
								}),
								component(Row, {
									gap: 10,
									align: "center",
									wrap: true,
									get children() {
										return sendButton();
									}
								}),
								() => sendResult()
							]);
							return __nsh_hv20;
						})();
					}
				})
			]);
			append(__nsh_hv14, __nsh_hv15);
			append(__nsh_hv13, __nsh_hv14);
			return __nsh_hv13;
		})();
	}
	function historyPane() {
		return (() => {
			const __nsh_hv26 = element("view");
			bindProp(__nsh_hv26, "style", () => ({
				width: 320,
				flexShrink: 0,
				borderLeftWidth: 1,
				borderLeftColor: c.line(),
				display: "flex",
				flexDirection: "column",
				backgroundColor: c.panel()
			}));
			const __nsh_hv36 = element("scroll");
			prop(__nsh_hv36, "style", {
				flex: 1,
				minHeight: 0
			});
			const __nsh_hv37 = element("view");
			prop(__nsh_hv37, "style", {
				display: "flex",
				flexDirection: "column"
			});
			insert(__nsh_hv37, each(() => history(), (entry, index) => (() => {
				const __nsh_hv38 = element("view");
				bindProp(__nsh_hv38, "testID", () => `history-entry-${index()}`);
				prop(__nsh_hv38, "onPress", () => refill(entry()));
				bindProp(__nsh_hv38, "style", () => ({
					paddingHorizontal: 12,
					paddingVertical: 9,
					borderBottomWidth: 1,
					borderBottomColor: c.line()
				}));
				const __nsh_hv44 = element("text");
				prop(__nsh_hv44, "numberOfLines", 2);
				bindProp(__nsh_hv44, "style", () => ({
					...t.meta,
					marginTop: 4,
					color: c.muted()
				}));
				insert(__nsh_hv44, () => entry().text.length > 0 ? entry().text.replace(/\s+/g, " ").slice(0, 160) : "（空 payload）");
				append(__nsh_hv38, __nsh_hv44);
				insert(__nsh_hv38, [component(Row, {
					gap: 6,
					get children() {
						return [(() => {
							const __nsh_hv39 = element("text");
							prop(__nsh_hv39, "numberOfLines", 1);
							bindProp(__nsh_hv39, "style", () => ({
								...t.mono,
								flex: 1,
								minWidth: 0
							}));
							insert(__nsh_hv39, () => entry().topic);
							return __nsh_hv39;
						})(), (() => {
							const __nsh_hv40 = element("text");
							bindProp(__nsh_hv40, "style", () => t.meta);
							insert(__nsh_hv40, () => clockOf(entry().at));
							return __nsh_hv40;
						})()];
					}
				}), component(Row, {
					gap: 6,
					style: { marginTop: 3 },
					get children() {
						return [
							(() => {
								const __nsh_hv41 = element("text");
								bindProp(__nsh_hv41, "style", () => t.meta);
								const __nsh_hv42 = text("QoS ");
								append(__nsh_hv41, __nsh_hv42);
								insert(__nsh_hv41, () => entry().qos);
								return __nsh_hv41;
							})(),
							() => entry().retain ? component(Badge, {
								text: "retain",
								tone: "warn"
							}) : null,
							(() => {
								const __nsh_hv43 = element("text");
								bindProp(__nsh_hv43, "style", () => t.meta);
								insert(__nsh_hv43, () => humanBytes(Buffer.byteLength(entry().text, "utf8")));
								return __nsh_hv43;
							})()
						];
					}
				})], __nsh_hv44);
				return __nsh_hv38;
			})(), (entry) => String(entry.seq)));
			append(__nsh_hv36, __nsh_hv37);
			const __nsh_hv45 = element("view");
			bindProp(__nsh_hv45, "style", () => ({
				paddingHorizontal: 12,
				paddingVertical: 8,
				borderTopWidth: 1,
				borderTopColor: c.line()
			}));
			const __nsh_hv46 = element("text");
			bindProp(__nsh_hv46, "style", () => t.meta);
			const __nsh_hv47 = text("历史只保存在本页内存，不写入 provider，刷新页面即清空。");
			append(__nsh_hv46, __nsh_hv47);
			append(__nsh_hv45, __nsh_hv46);
			append(__nsh_hv26, __nsh_hv36);
			append(__nsh_hv26, __nsh_hv45);
			insert(__nsh_hv26, [component(Row, {
				gap: 6,
				get style() {
					return {
						paddingHorizontal: 12,
						paddingVertical: 10,
						borderBottomWidth: 1,
						borderBottomColor: c.line()
					};
				},
				get children() {
					return [
						(() => {
							const __nsh_hv27 = element("text");
							bindProp(__nsh_hv27, "style", () => t.h2);
							const __nsh_hv28 = text("发送历史");
							append(__nsh_hv27, __nsh_hv28);
							return __nsh_hv27;
						})(),
						component(Badge, { get text() {
							return `${history().length}/${HISTORY_LIMIT}`;
						} }),
						(() => {
							const __nsh_hv29 = element("view");
							prop(__nsh_hv29, "style", { flex: 1 });
							return __nsh_hv29;
						})(),
						(() => {
							const __nsh_hv30 = element("text");
							bindProp(__nsh_hv30, "style", () => t.meta);
							const __nsh_hv31 = text("点击回填");
							append(__nsh_hv30, __nsh_hv31);
							return __nsh_hv30;
						})()
					];
				}
			}), cond(() => history().length === 0, () => (() => {
				const __nsh_hv32 = element("view");
				prop(__nsh_hv32, "style", { padding: 14 });
				const __nsh_hv33 = element("text");
				bindProp(__nsh_hv33, "style", () => t.meta);
				const __nsh_hv34 = text("发送成功后，最近 ");
				const __nsh_hv35 = text(" 条会出现在这里；点击任意一条可回填主题、payload、QoS 与 retain。");
				append(__nsh_hv33, __nsh_hv34);
				append(__nsh_hv33, __nsh_hv35);
				insert(__nsh_hv33, HISTORY_LIMIT, __nsh_hv35);
				append(__nsh_hv32, __nsh_hv33);
				return __nsh_hv32;
			})())], __nsh_hv36);
			return __nsh_hv26;
		})();
	}
	return (() => {
		const __nsh_hv48 = element("view");
		bindProp(__nsh_hv48, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		insert(__nsh_hv48, [() => headerRow(), component(Row, {
			gap: 0,
			style: {
				flex: 1,
				minHeight: 0,
				alignItems: "stretch"
			},
			get children() {
				return [() => form(), () => historyPane()];
			}
		})]);
		return __nsh_hv48;
	})();
}
mount(Publish);

//#endregion
export { Publish as default };