import { append, bindProp, component, element, insert, prop, text } from "nsh:rt";
import { host, mount, signal, token } from "nsh";
import { readFile, writeFile } from "fs/promises";

//#region ../../../../../extensions/composite/docker/ui/lib/format.ts
/** `2026-11-02T09:31:04Z` → `11-02 09:31`；解析不了就原样返回。 */
function shortTime(value) {
	if (typeof value !== "string" || value.length === 0) return "-";
	const date = new Date(value.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
	if (Number.isNaN(date.getTime())) return value;
	const two = (n) => String(n).padStart(2, "0");
	return `${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
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
/** 搜索框。`onChange` 拿到的是整串新值。 */
function SearchField(props) {
	return (() => {
		const __nsh_hv13 = element("view");
		bindProp(__nsh_hv13, "style", () => ({
			flexDirection: "row",
			alignItems: "center",
			gap: 6,
			height: 28,
			width: props.width ?? 220,
			paddingHorizontal: 9,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: c.line(),
			backgroundColor: c.bg()
		}));
		const __nsh_hv14 = element("text");
		bindProp(__nsh_hv14, "style", () => ({
			fontSize: 12,
			color: c.muted()
		}));
		const __nsh_hv15 = text("⌕");
		append(__nsh_hv14, __nsh_hv15);
		const __nsh_hv16 = element("input");
		bindProp(__nsh_hv16, "value", () => props.value);
		bindProp(__nsh_hv16, "placeholder", () => props.placeholder ?? "Filter…");
		prop(__nsh_hv16, "onChange", (text) => props.onChange(text));
		prop(__nsh_hv16, "style", {
			flex: 1,
			fontSize: 12,
			paddingHorizontal: 0,
			borderWidth: 0,
			backgroundColor: "transparent"
		});
		append(__nsh_hv13, __nsh_hv14);
		append(__nsh_hv13, __nsh_hv16);
		return __nsh_hv13;
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
const HOSTS_PATH = "/etc/hosts";
/** IPv4 / IPv6 的粗判：只要够区分注释即可，不做完整校验。 */
function looksLikeIp(token) {
	if (token.length === 0) return false;
	if (!/^[0-9a-fA-F:.]+$/.test(token)) return false;
	return token.includes(":") || token.split(".").length === 4;
}
function parseLine(raw) {
	const trimmed = raw.trim();
	if (trimmed.length === 0) return {
		kind: "blank",
		raw
	};
	if (trimmed.startsWith("#")) {
		const parts = trimmed.replace(/^#+\s*/, "").split(/\s+/).filter((part) => part.length > 0);
		if (parts.length >= 2 && looksLikeIp(parts[0])) return {
			kind: "entry",
			raw,
			enabled: false,
			ip: parts[0],
			names: parts.slice(1)
		};
		return {
			kind: "comment",
			raw
		};
	}
	const parts = trimmed.split(/\s+/).filter((part) => part.length > 0);
	return {
		kind: "entry",
		raw,
		enabled: true,
		ip: parts[0],
		names: parts.slice(1)
	};
}
/** 条目 → 写回文件的一行；停用靠行首 `# `。 */
function composeLine(line) {
	if (line.kind !== "entry") return line.raw;
	const body = [line.ip, ...line.names].join(" ");
	return line.enabled ? body : `# ${body}`;
}
/** 单行输入框（SearchField 带放大镜，这里不合适）。 */
function Field(props) {
	return (() => {
		const __nsh_hv0 = element("view");
		bindProp(__nsh_hv0, "style", () => ({
			flexDirection: "row",
			alignItems: "center",
			height: 28,
			width: props.width ?? 200,
			paddingHorizontal: 9,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: c.line(),
			backgroundColor: c.bg()
		}));
		const __nsh_hv1 = element("input");
		bindProp(__nsh_hv1, "value", () => props.value);
		bindProp(__nsh_hv1, "placeholder", () => props.placeholder ?? "");
		prop(__nsh_hv1, "onChange", (text) => props.onChange(text));
		prop(__nsh_hv1, "onSubmit", () => props.onSubmit?.());
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
/** 调一次宿主日志；失败不影响页面主流程。 */
function log(level, message) {
	host.call(`navop.log.${level}`, { message }).catch(() => void 0);
}
function Hosts() {
	const lines = signal([]);
	const loading = signal(true);
	const error = signal(null);
	const notice = signal(null);
	const saving = signal(false);
	const pendingSave = signal(false);
	const loadedAt = signal("");
	const filter = signal("");
	const dirty = signal(false);
	const addOpen = signal(false);
	const addIp = signal("");
	const addNames = signal("");
	const showComments = signal(false);
	const trailingNewline = signal(true);
	const entries = () => lines().filter((line) => line.kind === "entry");
	const comments = () => lines().filter((line) => line.kind !== "entry");
	const visible = () => {
		const needle = filter().trim().toLowerCase();
		const all = entries();
		if (needle.length === 0) return all;
		return all.filter((line) => [line.ip, ...line.names].join(" ").toLowerCase().includes(needle));
	};
	async function load() {
		loading.set(true);
		error.set(null);
		try {
			const text = String(await readFile(HOSTS_PATH, "utf8"));
			const endsWithNewline = text.endsWith("\n");
			trailingNewline.set(endsWithNewline);
			const parsed = text.split("\n").map(parseLine);
			if (endsWithNewline && parsed.length > 0) parsed.pop();
			lines.set(parsed);
			loadedAt.set(shortTime((/* @__PURE__ */ new Date()).toISOString()));
			dirty.set(false);
			notice.set(null);
		} catch (failure) {
			error.set(`读取 ${HOSTS_PATH} 失败：${errorMessage(failure)}`);
		} finally {
			loading.set(false);
		}
	}
	async function save() {
		saving.set(true);
		try {
			const body = lines().map(composeLine).join("\n") + (trailingNewline() ? "\n" : "");
			await writeFile(HOSTS_PATH, body);
			pendingSave.set(false);
			loadedAt.set(shortTime((/* @__PURE__ */ new Date()).toISOString()));
			notice.set(`已保存 ${HOSTS_PATH}（${entries().length} 条条目）`);
			dirty.set(false);
			log("info", "hosts saved");
		} catch (failure) {
			const message = `写入 ${HOSTS_PATH} 失败：${errorMessage(failure)}`;
			notice.set(message);
			log("error", `hosts save failed: ${message}`);
		} finally {
			saving.set(false);
		}
	}
	function toggle(target) {
		lines.set(lines().map((line) => {
			if (line !== target) return line;
			const enabled = !target.enabled;
			return {
				...target,
				enabled,
				raw: composeLine({
					...target,
					enabled
				})
			};
		}));
		dirty.set(true);
	}
	function remove(target) {
		lines.set(lines().filter((line) => line !== target));
		dirty.set(true);
	}
	function add() {
		const ip = addIp().trim();
		const names = addNames().trim().split(/\s+/).filter((name) => name.length > 0);
		if (ip.length === 0 || names.length === 0) {
			notice.set("新增条目需要 IP 地址和至少一个主机名。");
			return;
		}
		if (!looksLikeIp(ip)) {
			notice.set(`「${ip}」不像 IPv4 / IPv6 地址。`);
			return;
		}
		const line = {
			kind: "entry",
			raw: `${ip} ${names.join(" ")}`,
			enabled: true,
			ip,
			names
		};
		lines.set([...lines(), line]);
		addIp.set("");
		addNames.set("");
		addOpen.set(false);
		dirty.set(true);
		notice.set(`已添加 ${ip} ${names.join(" ")}，点「保存」写入文件。`);
	}
	load();
	function entryRow(line) {
		return component(Row, {
			gap: 10,
			align: "center",
			get style() {
				return {
					paddingVertical: 7,
					borderBottomWidth: 1,
					borderColor: c.line()
				};
			},
			get children() {
				return [
					component(Badge, {
						get text() {
							return line.enabled ? "启用" : "禁用";
						},
						get tone() {
							return line.enabled ? "ok" : "neutral";
						}
					}),
					(() => {
						const __nsh_hv2 = element("text");
						prop(__nsh_hv2, "numberOfLines", 1);
						bindProp(__nsh_hv2, "style", () => ({
							...t.mono,
							width: 140
						}));
						insert(__nsh_hv2, () => line.ip);
						return __nsh_hv2;
					})(),
					(() => {
						const __nsh_hv3 = element("text");
						prop(__nsh_hv3, "numberOfLines", 1);
						bindProp(__nsh_hv3, "style", () => ({
							...t.mono,
							flex: 1,
							color: line.enabled ? c.text() : c.muted()
						}));
						insert(__nsh_hv3, () => line.names.join(" ") || "-");
						return __nsh_hv3;
					})(),
					component(Button, {
						get label() {
							return line.enabled ? "禁用" : "启用";
						},
						small: true,
						onPress: () => toggle(line)
					}),
					component(Button, {
						label: "删除",
						small: true,
						tone: "danger",
						onPress: () => remove(line)
					})
				];
			}
		});
	}
	function content() {
		return component(Stack, {
			scroll: true,
			padding: 14,
			gap: 12,
			get children() {
				return [
					component(Card, {
						title: "主机条目",
						get hint() {
							return `${visible().length} 条`;
						},
						get right() {
							return component(SearchField, {
								get value() {
									return filter();
								},
								onChange: (value) => filter.set(value),
								placeholder: "按 IP / 主机名过滤",
								width: 220
							});
						},
						get children() {
							return (() => {
								const __nsh_hv4 = element("view");
								prop(__nsh_hv4, "style", {
									display: "flex",
									flexDirection: "column"
								});
								insert(__nsh_hv4, () => visible().length === 0 ? component(Empty, {
									get title() {
										return filter().trim().length === 0 ? "还没有主机条目" : "没有匹配的条目";
									},
									get hint() {
										return filter().trim().length === 0 ? "点上方「新增条目」加一行 IP 与主机名，保存后写入 /etc/hosts。" : "清空搜索词，或换一个 IP / 主机名再试。";
									}
								}) : visible().map((line) => entryRow(line)));
								return __nsh_hv4;
							})();
						}
					}),
					component(Card, {
						title: "注释与空行",
						get hint() {
							return `${comments().length} 行（原样保留）`;
						},
						get right() {
							return component(Button, {
								get label() {
									return showComments() ? "收起" : "展开";
								},
								small: true,
								onPress: () => showComments.set(!showComments())
							});
						},
						get children() {
							return (() => {
								const __nsh_hv5 = element("view");
								prop(__nsh_hv5, "style", {
									display: "flex",
									flexDirection: "column"
								});
								insert(__nsh_hv5, () => showComments() ? comments().length === 0 ? (() => {
									const __nsh_hv6 = element("text");
									bindProp(__nsh_hv6, "style", () => t.meta);
									const __nsh_hv7 = text("文件里没有注释或空行。");
									append(__nsh_hv6, __nsh_hv7);
									return __nsh_hv6;
								})() : comments().map((line) => (() => {
									const __nsh_hv8 = element("text");
									prop(__nsh_hv8, "numberOfLines", 1);
									bindProp(__nsh_hv8, "style", () => ({
										...t.mono,
										color: c.muted()
									}));
									insert(__nsh_hv8, () => line.raw.length === 0 ? "（空行）" : line.raw);
									return __nsh_hv8;
								})()) : (() => {
									const __nsh_hv9 = element("text");
									bindProp(__nsh_hv9, "style", () => t.meta);
									const __nsh_hv10 = text("注释不会丢：保存时按原位置写回。");
									append(__nsh_hv9, __nsh_hv10);
									return __nsh_hv9;
								})());
								return __nsh_hv5;
							})();
						}
					}),
					() => !addOpen() ? null : component(Card, {
						title: "新增条目",
						hint: "保存后才会写入文件",
						get children() {
							return component(Row, {
								wrap: true,
								gap: 8,
								align: "center",
								get children() {
									return [
										component(Field, {
											get value() {
												return addIp();
											},
											onChange: (text) => addIp.set(text),
											placeholder: "IP，如 127.0.0.1",
											width: 170
										}),
										component(Field, {
											get value() {
												return addNames();
											},
											onChange: (text) => addNames.set(text),
											placeholder: "主机名，多个用空格分隔",
											width: 280,
											onSubmit: () => add()
										}),
										component(Button, {
											label: "加入列表",
											small: true,
											tone: "primary",
											onPress: () => add()
										}),
										component(Button, {
											label: "取消",
											small: true,
											onPress: () => addOpen.set(false)
										})
									];
								}
							});
						}
					})
				];
			}
		});
	}
	return (() => {
		const __nsh_hv11 = element("view");
		bindProp(__nsh_hv11, "style", () => ({
			flex: 1,
			minHeight: 0,
			display: "flex",
			flexDirection: "column",
			backgroundColor: c.bg()
		}));
		insert(__nsh_hv11, [
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
									const __nsh_hv12 = element("text");
									bindProp(__nsh_hv12, "style", () => t.h1);
									const __nsh_hv13 = text("Hosts 编辑器");
									append(__nsh_hv12, __nsh_hv13);
									return __nsh_hv12;
								})(),
								component(Badge, { get text() {
									return `${entries().length} 条条目`;
								} }),
								(() => {
									const __nsh_hv14 = element("text");
									bindProp(__nsh_hv14, "style", () => t.mono);
									insert(__nsh_hv14, HOSTS_PATH);
									return __nsh_hv14;
								})(),
								() => dirty() ? component(Badge, {
									text: "有未保存修改",
									tone: "warn"
								}) : null
							];
						}
					}), component(Row, {
						gap: 6,
						get children() {
							return [
								component(Button, {
									label: "重新读取",
									small: true,
									onPress: () => void load(),
									get disabled() {
										return loading() || saving();
									}
								}),
								component(Button, {
									get label() {
										return addOpen() ? "取消新增" : "新增条目";
									},
									small: true,
									onPress: () => addOpen.set(!addOpen())
								}),
								component(Button, {
									get label() {
										return saving() ? "保存中…" : "保存";
									},
									tone: "primary",
									small: true,
									get disabled() {
										return saving() || loading() || error() !== null;
									},
									onPress: () => pendingSave.set(true)
								})
							];
						}
					})];
				}
			}),
			component(Row, {
				gap: 8,
				style: {
					paddingHorizontal: 14,
					paddingBottom: 6
				},
				get children() {
					return [
						(() => {
							const __nsh_hv15 = element("text");
							bindProp(__nsh_hv15, "style", () => t.meta);
							insert(__nsh_hv15, () => loadedAt().length === 0 ? "尚未读取" : `上次读取：${loadedAt()}`);
							return __nsh_hv15;
						})(),
						(() => {
							const __nsh_hv16 = element("text");
							bindProp(__nsh_hv16, "style", () => t.meta);
							const __nsh_hv17 = text("·");
							append(__nsh_hv16, __nsh_hv17);
							return __nsh_hv16;
						})(),
						(() => {
							const __nsh_hv18 = element("text");
							bindProp(__nsh_hv18, "style", () => t.meta);
							const __nsh_hv19 = text("保存前会二次确认");
							append(__nsh_hv18, __nsh_hv19);
							return __nsh_hv18;
						})()
					];
				}
			}),
			() => notice() === null ? null : (() => {
				const __nsh_hv20 = element("view");
				prop(__nsh_hv20, "style", {
					paddingHorizontal: 14,
					paddingBottom: 8
				});
				insert(__nsh_hv20, component(Notice, { get message() {
					return notice() ?? "";
				} }));
				return __nsh_hv20;
			})(),
			() => !pendingSave() ? null : (() => {
				const __nsh_hv21 = element("view");
				prop(__nsh_hv21, "style", {
					paddingHorizontal: 14,
					paddingBottom: 8
				});
				insert(__nsh_hv21, component(ConfirmBar, {
					get message() {
						return `把 ${entries().length} 条条目写回 ${HOSTS_PATH}？写错可能影响本机域名解析。`;
					},
					confirmLabel: "写入",
					get busy() {
						return saving();
					},
					onConfirm: () => void save(),
					onCancel: () => pendingSave.set(false)
				}));
				return __nsh_hv21;
			})(),
			() => loading() && lines().length === 0 && error() === null ? component(Loading, { label: "正在读取 /etc/hosts…" }) : null,
			() => error() !== null && lines().length === 0 ? component(LoadError, {
				get message() {
					return error() ?? "";
				},
				onRetry: () => void load()
			}) : null,
			() => loading() && lines().length === 0 && error() === null ? null : error() !== null && lines().length === 0 ? null : content()
		]);
		return __nsh_hv11;
	})();
}
mount(Hosts);

//#endregion
export { Hosts as default };