import { append, bindProp, component, cond, element, insert, prop, text } from "nsh:rt";
import { Clipboard, mount, signal, token } from "nsh";
import { createHash, randomUUID } from "crypto";
import { Buffer } from "buffer";

//#region ../../../../../extensions/composite/docker/ui/lib/format.ts
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
//#region ../../../../../extensions/composite/docker/ui/lib/theme.ts
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
//#region ../../../../../extensions/composite/docker/ui/lib/ui.tsx
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
/** 状态胶囊。 */
function Badge(props) {
	return (() => {
		const __nsh_hv9 = element("view");
		bindProp(__nsh_hv9, "style", () => ({
			paddingHorizontal: 8,
			paddingVertical: 2,
			borderRadius: r.pill,
			borderWidth: 1,
			borderColor: toneColor(pick(props.tone ?? "neutral")),
			display: "flex",
			flexDirection: "row",
			alignItems: "center"
		}));
		const __nsh_hv10 = element("text");
		bindProp(__nsh_hv10, "style", () => ({
			fontSize: 11,
			fontWeight: "600",
			color: toneColor(pick(props.tone ?? "neutral"))
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
		bindProp(__nsh_hv11, "onPress", () => pick(props.disabled ?? false) ? void 0 : props.onPress);
		prop(__nsh_hv11, "role", "button");
		bindProp(__nsh_hv11, "accessibilityLabel", () => props.label);
		bindProp(__nsh_hv11, "style", () => ({
			height: props.small ? 24 : 28,
			paddingHorizontal: props.small ? 9 : 12,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: buttonBorder(pick(props.tone ?? "ghost")),
			backgroundColor: buttonFill(pick(props.tone ?? "ghost")),
			opacity: pick(props.disabled ?? false) ? .5 : 1,
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center"
		}));
		const __nsh_hv12 = element("text");
		bindProp(__nsh_hv12, "style", () => ({
			fontSize: props.small ? 12 : 13,
			fontWeight: "500",
			color: buttonLabel(pick(props.tone ?? "ghost"), pick(props.disabled ?? false))
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
/** 键值对表：inspect 类页面的主体。 */
function KeyValue(props) {
	return (() => {
		const __nsh_hv39 = element("view");
		bindProp(__nsh_hv39, "style", () => ({
			display: "flex",
			flexDirection: pick(props.columns ?? 1) === 2 ? "row" : "column",
			flexWrap: "wrap",
			gap: pick(props.columns ?? 1) === 2 ? 12 : 0
		}));
		insert(__nsh_hv39, () => pick(props.rows).map(([key, value]) => component(Row, {
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
					const __nsh_hv40 = element("text");
					bindProp(__nsh_hv40, "style", () => ({
						fontSize: 12,
						color: c.muted()
					}));
					insert(__nsh_hv40, key);
					return __nsh_hv40;
				})(), (() => {
					const __nsh_hv41 = element("text");
					bindProp(__nsh_hv41, "style", () => ({
						fontSize: 12,
						color: c.text(),
						fontVariant: ["tabular-nums"]
					}));
					insert(__nsh_hv41, value);
					return __nsh_hv41;
				})()];
			}
		})));
		return __nsh_hv39;
	})();
}
/** 一行提示（操作结果/错误），`tone` 决定颜色。 */
function Notice(props) {
	return (() => {
		const __nsh_hv48 = element("text");
		bindProp(__nsh_hv48, "style", () => ({
			fontSize: 12,
			color: props.tone === void 0 ? c.muted() : toneColor(pick(props.tone))
		}));
		insert(__nsh_hv48, () => props.message);
		return __nsh_hv48;
	})();
}

//#endregion
//#region App.tsx
const ALGORITHMS = [
	"md5",
	"sha1",
	"sha256",
	"sha512"
];
/** Base64 只认标准字母表与可选的 `=` 补位，空格换行先去掉。 */
function normalizeBase64(source) {
	const compact = source.replace(/\s+/g, "");
	if (compact.length === 0) return "";
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
	if (compact.length % 4 !== 0) return null;
	return compact;
}
function utf8Bytes(text) {
	return new TextEncoder().encode(text);
}
function decodeBase64(source) {
	const compact = normalizeBase64(source);
	if (compact === null) return null;
	const decoded = Buffer.from(compact, "base64").toString("utf8");
	if (Buffer.from(decoded, "utf8").toString("base64") !== compact) return null;
	return decoded;
}
/** 多行输入框：Input 的 multiline，外层给一个固定高度的边框。 */
function TextArea(props) {
	return (() => {
		const __nsh_hv0 = element("view");
		bindProp(__nsh_hv0, "style", () => ({
			height: props.height,
			paddingHorizontal: 9,
			paddingVertical: 7,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: c.line(),
			backgroundColor: c.bg()
		}));
		const __nsh_hv1 = element("input");
		bindProp(__nsh_hv1, "value", () => props.value);
		bindProp(__nsh_hv1, "placeholder", () => props.placeholder ?? "");
		prop(__nsh_hv1, "multiline", true);
		prop(__nsh_hv1, "onChange", (text) => props.onChange(text));
		prop(__nsh_hv1, "style", {
			flex: 1,
			fontSize: 12,
			paddingHorizontal: 0,
			borderWidth: 0,
			backgroundColor: "transparent"
		});
		append(__nsh_hv0, __nsh_hv1);
		return __nsh_hv0;
	})();
}
function Crypto() {
	const input = signal("");
	const algorithm = signal("sha256");
	const result = signal(null);
	const error = signal(null);
	const notice = signal(null);
	function digest() {
		const source = utf8Bytes(input());
		const bytes = createHash(algorithm()).update(source).digest("hex");
		result.set({
			text: bytes,
			label: `${algorithm().toUpperCase()} 摘要`
		});
		error.set(null);
		notice.set(null);
	}
	function base64Encode() {
		result.set({
			text: Buffer.from(input(), "utf8").toString("base64"),
			label: "Base64 编码结果"
		});
		error.set(null);
		notice.set(null);
	}
	function base64Decode() {
		const decoded = decodeBase64(input());
		if (decoded === null) {
			result.set(null);
			error.set("不是合法的 Base64 文本：只接受标准字母表（A-Z a-z 0-9 + /）与结尾的 = 补位。");
			notice.set(null);
			return;
		}
		result.set({
			text: decoded,
			label: "Base64 解码结果"
		});
		error.set(null);
		notice.set(null);
	}
	function uuid() {
		result.set({
			text: randomUUID(),
			label: "随机 UUID（v4）"
		});
		error.set(null);
		notice.set(null);
	}
	async function copy() {
		const current = result();
		if (current === null) return;
		try {
			await Clipboard.writeText(current.text);
			notice.set("已复制到剪贴板。");
		} catch (failure) {
			notice.set(`复制失败：${errorMessage(failure)}`);
		}
	}
	function clear() {
		input.set("");
		result.set(null);
		error.set(null);
		notice.set(null);
	}
	function resultPane() {
		const current = result();
		if (current === null) return component(Empty, {
			title: "还没有结果",
			hint: "在上方输入文本，再点一个操作（摘要 / Base64 / UUID）。"
		});
		return (() => {
			const __nsh_hv2 = element("view");
			prop(__nsh_hv2, "style", {
				display: "flex",
				flexDirection: "column",
				gap: 8
			});
			const __nsh_hv4 = element("view");
			bindProp(__nsh_hv4, "style", () => ({
				padding: 10,
				borderRadius: r.control,
				borderWidth: 1,
				borderColor: c.line(),
				backgroundColor: c.panel(),
				maxHeight: 240
			}));
			const __nsh_hv5 = element("text");
			prop(__nsh_hv5, "selectable", true);
			bindProp(__nsh_hv5, "style", () => ({
				...t.mono,
				lineHeight: 18
			}));
			insert(__nsh_hv5, () => current.text);
			append(__nsh_hv4, __nsh_hv5);
			append(__nsh_hv2, __nsh_hv4);
			insert(__nsh_hv2, component(Row, {
				gap: 8,
				align: "center",
				get children() {
					return [component(Badge, {
						get text() {
							return current.label;
						},
						tone: "info"
					}), (() => {
						const __nsh_hv3 = element("text");
						bindProp(__nsh_hv3, "style", () => t.meta);
						insert(__nsh_hv3, () => `${current.text.length} 字符`);
						return __nsh_hv3;
					})()];
				}
			}), __nsh_hv4);
			return __nsh_hv2;
		})();
	}
	return (() => {
		const __nsh_hv6 = element("view");
		bindProp(__nsh_hv6, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		insert(__nsh_hv6, [
			component(Row, {
				wrap: true,
				gap: 8,
				style: {
					paddingHorizontal: 14,
					paddingVertical: 10,
					justifyContent: "space-between"
				},
				get children() {
					return [component(Row, {
						gap: 8,
						align: "center",
						get children() {
							return [
								(() => {
									const __nsh_hv7 = element("text");
									bindProp(__nsh_hv7, "style", () => t.h1);
									const __nsh_hv8 = text("Crypto 工具箱");
									append(__nsh_hv7, __nsh_hv8);
									return __nsh_hv7;
								})(),
								component(Badge, {
									text: "本地计算",
									tone: "ok"
								}),
								(() => {
									const __nsh_hv9 = element("text");
									bindProp(__nsh_hv9, "style", () => t.meta);
									const __nsh_hv10 = text("不上传任何内容");
									append(__nsh_hv9, __nsh_hv10);
									return __nsh_hv9;
								})()
							];
						}
					}), component(Row, {
						gap: 6,
						get children() {
							return [component(Button, {
								label: "清空",
								small: true,
								onPress: clear
							}), component(Button, {
								label: "复制结果",
								small: true,
								tone: "primary",
								onPress: () => void copy()
							})];
						}
					})];
				}
			}),
			() => error() === null ? null : (() => {
				const __nsh_hv11 = element("view");
				prop(__nsh_hv11, "style", {
					paddingHorizontal: 14,
					paddingBottom: 8
				});
				insert(__nsh_hv11, component(Notice, {
					get message() {
						return error() ?? "";
					},
					tone: "danger"
				}));
				return __nsh_hv11;
			})(),
			() => notice() === null ? null : (() => {
				const __nsh_hv12 = element("view");
				prop(__nsh_hv12, "style", {
					paddingHorizontal: 14,
					paddingBottom: 8
				});
				insert(__nsh_hv12, component(Notice, { get message() {
					return notice() ?? "";
				} }));
				return __nsh_hv12;
			})(),
			component(Stack, {
				scroll: true,
				padding: 14,
				gap: 12,
				get children() {
					return [
						component(Card, {
							title: "输入",
							hint: "要处理的原文；解码时贴 Base64 文本",
							get children() {
								return component(TextArea, {
									get value() {
										return input();
									},
									onChange: (text) => input.set(text),
									placeholder: "例如 hello，或粘贴一段 Base64",
									height: 96
								});
							}
						}),
						component(Card, {
							title: "操作",
							hint: "摘要算法可切换",
							get children() {
								return (() => {
									const __nsh_hv13 = element("view");
									prop(__nsh_hv13, "style", {
										display: "flex",
										flexDirection: "column",
										gap: 10
									});
									insert(__nsh_hv13, [component(Row, {
										gap: 6,
										wrap: true,
										align: "center",
										get children() {
											return [(() => {
												const __nsh_hv14 = element("text");
												bindProp(__nsh_hv14, "style", () => t.label);
												const __nsh_hv15 = text("摘要算法");
												append(__nsh_hv14, __nsh_hv15);
												return __nsh_hv14;
											})(), () => ALGORITHMS.map((item) => component(Button, {
												label: item,
												small: true,
												get tone() {
													return algorithm() === item ? "primary" : "ghost";
												},
												onPress: () => algorithm.set(item)
											}))];
										}
									}), component(Row, {
										gap: 8,
										wrap: true,
										align: "center",
										get children() {
											return [
												component(Button, {
													label: "计算摘要",
													small: true,
													tone: "primary",
													onPress: digest
												}),
												component(Button, {
													label: "Base64 编码",
													small: true,
													onPress: base64Encode
												}),
												component(Button, {
													label: "Base64 解码",
													small: true,
													onPress: base64Decode
												}),
												component(Button, {
													label: "生成 UUID",
													small: true,
													onPress: uuid
												})
											];
										}
									})]);
									return __nsh_hv13;
								})();
							}
						}),
						component(Card, {
							title: "结果",
							hint: "可选中复制，或点右上角「复制结果」",
							get children() {
								return (() => {
									const __nsh_hv16 = element("view");
									prop(__nsh_hv16, "style", {
										display: "flex",
										flexDirection: "column"
									});
									insert(__nsh_hv16, () => resultPane());
									return __nsh_hv16;
								})();
							}
						}),
						component(Card, {
							title: "说明",
							hint: "全部在页面内计算",
							get children() {
								return component(KeyValue, {
									columns: 1,
									rows: [
										["MD5", "128 位摘要，仅用于校验，不用于安全场景"],
										["SHA-1", "160 位摘要，兼容旧系统"],
										["SHA-256", "256 位摘要，常用默认值"],
										["SHA-512", "512 位摘要，输出最长"],
										["Base64", "UTF-8 文本与 Base64 互转；非法输入会直接报错"],
										["UUID", "生成随机 v4 UUID"]
									]
								});
							}
						})
					];
				}
			})
		]);
		return __nsh_hv6;
	})();
}
mount(Crypto);

//#endregion
export { Crypto as default };