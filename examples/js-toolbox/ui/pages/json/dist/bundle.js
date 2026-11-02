import { append, bindProp, component, element, insert, prop, text } from "nsh:rt";
import { Clipboard, mount, signal, token } from "nsh";

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

//#endregion
//#region ../../../../../extensions/composite/docker/ui/lib/ui.tsx
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
/** 主从布局：左侧列表固定宽度，右侧详情自适应。 */
function SplitPane(props) {
	return (() => {
		const __nsh_hv44 = element("view");
		prop(__nsh_hv44, "style", {
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "row"
		});
		const __nsh_hv45 = element("view");
		bindProp(__nsh_hv45, "style", () => ({
			width: props.width ?? 300,
			flexShrink: 0,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			borderRightWidth: 1,
			borderRightColor: c.line()
		}));
		insert(__nsh_hv45, () => props.left);
		const __nsh_hv46 = element("view");
		prop(__nsh_hv46, "style", {
			flex: 1,
			minWidth: 0,
			minHeight: 0,
			display: "flex",
			flexDirection: "column"
		});
		insert(__nsh_hv46, () => props.right);
		append(__nsh_hv44, __nsh_hv45);
		append(__nsh_hv44, __nsh_hv46);
		return __nsh_hv44;
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
/** 把 `position N`（0 起的字符下标）换算成行与列（1 起）。 */
function describePosition(source, position) {
	const before = source.slice(0, Math.max(0, Math.min(position, source.length)));
	return `第 ${before.split("\n").length} 行第 ${before.length - before.lastIndexOf("\n")} 列（第 ${position + 1} 个字符）`;
}
/** JSON 解析错误 → 中文说明；带位置时补上行列。 */
function describeParseError(source, failure) {
	const message = errorMessage(failure).trim();
	if (message.length === 0) return "JSON 解析失败：内容不合法。";
	const withPosition = /position\s+(\d+)/i.exec(message);
	if (withPosition !== null) {
		const position = Number(withPosition[1]);
		if (Number.isFinite(position) && position >= 0) return `JSON 解析失败：${message}（${describePosition(source, position)}）`;
	}
	if (/unexpected end of json/i.test(message)) return "JSON 解析失败：内容不完整，括号或引号没有闭合。";
	if (/unexpected token/i.test(message)) {
		const matched = /unexpected token:\s*'(.*)'/i.exec(message);
		const token = matched === null ? null : matched[1];
		const at = token === null ? -1 : source.indexOf(token);
		if (token !== null && at >= 0) return `JSON 解析失败：意外字符「${token}」（${describePosition(source, at)}），检查逗号、括号与引号是否配对。`;
		return "JSON 解析失败：出现了意外字符，检查逗号、括号与引号是否配对。";
	}
	return `JSON 解析失败：${message}`;
}
/** 多行等宽输入框。 */
function CodeArea(props) {
	return (() => {
		const __nsh_hv0 = element("view");
		bindProp(__nsh_hv0, "style", () => ({
			flex: props.grow === true ? 1 : void 0,
			minHeight: props.height ?? 200,
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
/** 左侧输入区：输入框本身只建一次，字符数等文字走响应式子节点。 */
function SourcePane(props) {
	return (() => {
		const __nsh_hv2 = element("view");
		prop(__nsh_hv2, "style", {
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			padding: 12,
			gap: 8
		});
		insert(__nsh_hv2, [
			component(Row, {
				gap: 8,
				align: "center",
				get children() {
					return [
						(() => {
							const __nsh_hv3 = element("text");
							bindProp(__nsh_hv3, "style", () => t.h2);
							const __nsh_hv4 = text("输入");
							append(__nsh_hv3, __nsh_hv4);
							return __nsh_hv3;
						})(),
						component(Badge, { get text() {
							return `${props.read().length} 字符`;
						} }),
						(() => {
							const __nsh_hv5 = element("text");
							bindProp(__nsh_hv5, "style", () => t.meta);
							insert(__nsh_hv5, () => `${props.read().split("\n").length} 行`);
							return __nsh_hv5;
						})()
					];
				}
			}),
			component(CodeArea, {
				get value() {
					return props.read();
				},
				get onChange() {
					return props.write;
				},
				placeholder: "例如 {\"name\":\"navop\",\"tags\":[\"nsh\",\"tsx\"]}",
				grow: true,
				height: 260
			}),
			() => props.problem() === null ? null : component(Notice, {
				get message() {
					return props.problem() ?? "";
				},
				tone: "danger"
			})
		]);
		return __nsh_hv2;
	})();
}
/** 右侧输出区：结果变化时整体重画，这里没有输入框，不会影响焦点。 */
function ResultPane(props) {
	return (() => {
		const __nsh_hv6 = element("view");
		prop(__nsh_hv6, "style", {
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			padding: 12,
			gap: 8
		});
		const __nsh_hv9 = element("view");
		prop(__nsh_hv9, "style", {
			flex: 1,
			minHeight: 0
		});
		insert(__nsh_hv9, () => body());
		append(__nsh_hv6, __nsh_hv9);
		insert(__nsh_hv6, component(Row, {
			gap: 8,
			align: "center",
			get children() {
				return [(() => {
					const __nsh_hv7 = element("text");
					bindProp(__nsh_hv7, "style", () => t.h2);
					const __nsh_hv8 = text("输出");
					append(__nsh_hv7, __nsh_hv8);
					return __nsh_hv7;
				})(), component(Badge, { text: "格式化 / 压缩 / 转义 / 反转义" })];
			}
		}), __nsh_hv9);
		return __nsh_hv6;
	})();
	function body() {
		const current = props.result();
		if (current === null) return component(Empty, {
			title: "还没有结果",
			hint: "在左侧输入 JSON，再选一个操作（格式化 / 压缩 / 转义 / 反转义）。"
		});
		return (() => {
			const __nsh_hv10 = element("view");
			prop(__nsh_hv10, "style", {
				display: "flex",
				flexDirection: "column",
				gap: 8,
				flex: 1,
				minHeight: 0
			});
			const __nsh_hv12 = element("view");
			bindProp(__nsh_hv12, "style", () => ({
				flex: 1,
				minHeight: 0,
				padding: 10,
				borderRadius: r.control,
				borderWidth: 1,
				borderColor: c.line(),
				backgroundColor: c.panel()
			}));
			insert(__nsh_hv12, component(Stack, {
				scroll: true,
				padding: 0,
				gap: 0,
				get children() {
					return (() => {
						const __nsh_hv13 = element("text");
						prop(__nsh_hv13, "selectable", true);
						bindProp(__nsh_hv13, "style", () => ({
							...t.mono,
							lineHeight: 18
						}));
						insert(__nsh_hv13, () => current.text);
						return __nsh_hv13;
					})();
				}
			}));
			append(__nsh_hv10, __nsh_hv12);
			insert(__nsh_hv10, component(Row, {
				gap: 8,
				align: "center",
				get children() {
					return [component(Badge, {
						get text() {
							return current.label;
						},
						tone: "info"
					}), (() => {
						const __nsh_hv11 = element("text");
						bindProp(__nsh_hv11, "style", () => t.meta);
						insert(__nsh_hv11, () => `${current.text.length} 字符`);
						return __nsh_hv11;
					})()];
				}
			}), __nsh_hv12);
			return __nsh_hv10;
		})();
	}
}
function Json() {
	const source = signal("");
	const indent = signal(2);
	const result = signal(null);
	const error = signal(null);
	const notice = signal(null);
	function run(kind) {
		if (source().trim().length === 0) {
			result.set(null);
			error.set("先在上方输入 JSON 文本。");
			return;
		}
		try {
			switch (kind) {
				case "format":
					result.set({
						text: JSON.stringify(JSON.parse(source()), null, indent()),
						label: `格式化结果（缩进 ${indent()} 空格）`
					});
					break;
				case "minify":
					result.set({
						text: JSON.stringify(JSON.parse(source())),
						label: "压缩结果"
					});
					break;
				case "escape":
					result.set({
						text: JSON.stringify(source()),
						label: "转义结果"
					});
					break;
				case "unescape": {
					const value = JSON.parse(source());
					if (typeof value !== "string") {
						result.set(null);
						error.set("反转义需要一个 JSON 字符串字面量（以引号开头和结尾的文本）。");
						return;
					}
					result.set({
						text: value,
						label: "反转义结果"
					});
					break;
				}
			}
			error.set(null);
			notice.set(null);
		} catch (failure) {
			result.set(null);
			error.set(describeParseError(source(), failure));
		}
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
	function reset() {
		source.set("");
		result.set(null);
		error.set(null);
		notice.set(null);
	}
	return (() => {
		const __nsh_hv14 = element("view");
		bindProp(__nsh_hv14, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		const __nsh_hv20 = element("view");
		prop(__nsh_hv20, "style", {
			flex: 1,
			minHeight: 0
		});
		insert(__nsh_hv20, component(SplitPane, {
			width: 540,
			get left() {
				return component(SourcePane, {
					read: source,
					write: (value) => source.set(value),
					problem: error
				});
			},
			get right() {
				return component(ResultPane, { result });
			}
		}));
		append(__nsh_hv14, __nsh_hv20);
		insert(__nsh_hv14, [component(Row, {
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
						return [(() => {
							const __nsh_hv15 = element("text");
							bindProp(__nsh_hv15, "style", () => t.h1);
							const __nsh_hv16 = text("JSON 工具");
							append(__nsh_hv15, __nsh_hv16);
							return __nsh_hv15;
						})(), component(Badge, {
							text: "本地计算",
							tone: "ok"
						})];
					}
				}), component(Row, {
					wrap: true,
					gap: 6,
					align: "center",
					get children() {
						return [
							(() => {
								const __nsh_hv17 = element("text");
								bindProp(__nsh_hv17, "style", () => t.label);
								const __nsh_hv18 = text("缩进");
								append(__nsh_hv17, __nsh_hv18);
								return __nsh_hv17;
							})(),
							() => component(Row, {
								gap: 6,
								get children() {
									return [component(Button, {
										label: "2 空格",
										small: true,
										get tone() {
											return indent() === 2 ? "primary" : "ghost";
										},
										onPress: () => indent.set(2)
									}), component(Button, {
										label: "4 空格",
										small: true,
										get tone() {
											return indent() === 4 ? "primary" : "ghost";
										},
										onPress: () => indent.set(4)
									})];
								}
							}),
							component(Button, {
								label: "格式化",
								small: true,
								tone: "primary",
								onPress: () => run("format")
							}),
							component(Button, {
								label: "压缩",
								small: true,
								onPress: () => run("minify")
							}),
							component(Button, {
								label: "转义",
								small: true,
								onPress: () => run("escape")
							}),
							component(Button, {
								label: "反转义",
								small: true,
								onPress: () => run("unescape")
							}),
							component(Button, {
								label: "复制结果",
								small: true,
								onPress: () => void copy()
							}),
							component(Button, {
								label: "清空",
								small: true,
								onPress: reset
							})
						];
					}
				})];
			}
		}), () => notice() === null ? null : (() => {
			const __nsh_hv19 = element("view");
			prop(__nsh_hv19, "style", {
				paddingHorizontal: 14,
				paddingBottom: 8
			});
			insert(__nsh_hv19, component(Notice, { get message() {
				return notice() ?? "";
			} }));
			return __nsh_hv19;
		})()], __nsh_hv20);
		return __nsh_hv14;
	})();
}
mount(Json);

//#endregion
export { Json as default };