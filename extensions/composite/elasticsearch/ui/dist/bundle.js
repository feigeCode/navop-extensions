import { append, bindProp, component, cond, element, insert, prop, text } from "nsh:rt";
import { Clipboard, computed, host, mount, signal, token } from "nsh";

//#region ../../../../packages/extension-kit/src/navop.ts
/** 常规命令的默认超时。nsh 自己的缺省也是 30 秒，写出来省得调用点猜。 */
const DEFAULT_TIMEOUT_MS = 3e4;
/** 慢命令（列表、日志、大查询）用的超时。 */
const SLOW_TIMEOUT_MS = 6e4;
/** 启动事实：模块顶层读一次即可。 */
const params = host.params;
/** 当前页面的 view 身份。 */
const extension = params.extension ?? {
	id: "",
	title: ""
};
/** 可用的 runtime alias。 */
const backends = params.backends ?? [];
/**
* 当前页面所属的连接。没有连接（例如工具箱里单独打开的页面）时抛错；
* 连接失效由宿主处理（remount 或提示重开），页面没有重取接口。
*/
function connection() {
	const current = params.connection;
	if (!current || !current.resourceHandle) throw new Error("这个页面需要一个扩展连接（当前上下文里没有资源句柄）");
	return current;
}
/**
* 调 provider 的方法。`method` 是真的方法名（如 `docker/container/list`），
* `payload` 是它的参数；默认 30 秒超时，慢方法传 `{ timeout: SLOW_TIMEOUT_MS }`
* 或 `0`（完全交给 provider 自己的超时）。
*/
async function invoke(method, payload = {}, options = {}) {
	const current = connection();
	return await host.call("navop.resource.invoke", {
		handle: current.resourceHandle,
		method,
		params: payload
	}, { timeout: options.timeout ?? 3e4 });
}

//#endregion
//#region ../../../../packages/extension-kit/src/format.ts
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
/** 取对象上的字符串字段（provider 的 JSON 不保证形状）。 */
function str(source, key, fallback = "-") {
	if (!source || typeof source !== "object") return fallback;
	const value = source[key];
	if (typeof value === "string" && value.length > 0) return value;
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	if (typeof value === "boolean") return value ? "yes" : "no";
	return fallback;
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
/** 可滚动的行列表：单选、悬停底色、按 key 高亮。 */
function List(props) {
	return cond(() => pick(props.items).length === 0 && props.empty !== void 0, () => () => props.empty, () => (() => {
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
		insert(__nsh_hv18, () => pick(props.items).map((item, index) => {
			const key = props.keyOf(item);
			const active = pick(props.selected ?? null) === key;
			return (() => {
				const __nsh_hv19 = element("view");
				bindProp(__nsh_hv19, "onPress", () => props.onSelect === void 0 ? void 0 : () => props.onSelect?.(key));
				bindProp(__nsh_hv19, "style", () => ({
					backgroundColor: active ? c.hover() : "transparent",
					borderBottomWidth: index === pick(props.items).length - 1 ? 0 : 1,
					borderBottomColor: c.line()
				}));
				insert(__nsh_hv19, () => props.render(item, index));
				return __nsh_hv19;
			})();
		}));
		append(__nsh_hv17, __nsh_hv18);
		return __nsh_hv17;
	})());
}
/** 列表里的两行一行式条目：主标题 + 次要信息 + 右侧自由内容。 */
function ListRow(props) {
	return component(Row, {
		gap: 10,
		style: {
			paddingVertical: 9,
			paddingHorizontal: 4,
			minHeight: 40
		},
		get children() {
			return [
				() => props.leading,
				(() => {
					const __nsh_hv20 = element("view");
					prop(__nsh_hv20, "style", {
						display: "flex",
						flexDirection: "column",
						gap: 2,
						flex: 1,
						minWidth: 0
					});
					const __nsh_hv21 = element("text");
					prop(__nsh_hv21, "numberOfLines", 1);
					bindProp(__nsh_hv21, "style", () => ({
						fontSize: 13,
						fontWeight: "500",
						color: c.text()
					}));
					insert(__nsh_hv21, () => props.title);
					append(__nsh_hv20, __nsh_hv21);
					insert(__nsh_hv20, () => props.subtitle === void 0 ? null : (() => {
						const __nsh_hv22 = element("text");
						prop(__nsh_hv22, "numberOfLines", 1);
						bindProp(__nsh_hv22, "style", () => ({
							fontSize: 11,
							color: c.muted()
						}));
						insert(__nsh_hv22, () => props.subtitle);
						return __nsh_hv22;
					})());
					return __nsh_hv20;
				})(),
				() => props.trailing
			];
		}
	});
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
			color: props.tone === void 0 ? c.muted() : toneColor(pick(props.tone))
		}));
		insert(__nsh_hv48, () => props.message);
		return __nsh_hv48;
	})();
}

//#endregion
//#region pages/mapping/App.tsx
/** 一次最多渲染多少行字段：mapping 可以有几万个字段，全量上屏会卡。 */
const RENDER_LIMIT = 500;
/** 最多解析多少字段：动态 mapping 的索引能有十万级字段，先截断再展示。 */
const MAX_FIELDS = 2e4;
/** operationId → provider 方法名。
*
* 清单里的 `resourceWorkbenches` 已经不参与运行，这一层映射留在页面里：
* 页面自己决定"要哪份数据"，宿主只负责把方法名和参数发给 provider。
*/
const OPERATIONS = {
	clusterHealth: "elasticsearch/cluster/health",
	clusterInfo: "elasticsearch/cluster/info",
	clusterStats: "elasticsearch/cluster/stats",
	count: "elasticsearch/count",
	documentDelete: "elasticsearch/document/delete",
	documentGet: "elasticsearch/document/get",
	documentIndex: "elasticsearch/document/index",
	indexAliasUpdate: "elasticsearch/index/alias/update",
	indexAliases: "elasticsearch/index/aliases",
	indexClose: "elasticsearch/index/close",
	indexCreate: "elasticsearch/index/create",
	indexDelete: "elasticsearch/index/delete",
	indexDocuments: "elasticsearch/search",
	indexGet: "elasticsearch/index/get",
	indexMapping: "elasticsearch/index/mapping",
	indexOpen: "elasticsearch/index/open",
	indexRefresh: "elasticsearch/index/refresh",
	indexSearch: "elasticsearch/search",
	indexSettings: "elasticsearch/index/settings",
	indexShards: "elasticsearch/index/shards",
	indexStats: "elasticsearch/index/stats",
	listIndices: "elasticsearch/index/list",
	listNodes: "elasticsearch/nodes/list",
	search: "elasticsearch/search/async"
};
/** 调一次 provider 方法；把失败折成一句人话。`confirmed` 仅为兼容旧调用点。 */
async function dispatch(operationId, input, _confirmed) {
	const method = OPERATIONS[operationId];
	if (!method) throw new Error(`未知的操作：${operationId}`);
	try {
		return await invoke(method, input ?? {}, { timeout: SLOW_TIMEOUT_MS });
	} catch (error) {
		throw new Error(errorMessage(error));
	}
}
function isObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function numberOrNull(value) {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function boolOrNull(value) {
	return typeof value === "boolean" ? value : null;
}
function toIndexRow(value) {
	return {
		name: str(value, "name", ""),
		health: str(value, "health", ""),
		status: str(value, "status", ""),
		docs: numberOrNull(isObject(value) ? value.docs : void 0),
		size: numberOrNull(isObject(value) ? value.size_bytes : void 0)
	};
}
/**
* `GET /<index>/_mapping` 的信封是 `{"<具体索引名>": {"mappings": …}}`。
* 索引可能是别名或通配，返回的键不一定等于请求的名字，所以先按请求名找，
* 找不到就退回第一个真正带了 `mappings` 的条目。
*/
function mappingOf(response, index) {
	if (!isObject(response)) return null;
	const direct = response[index];
	if (isObject(direct) && isObject(direct.mappings)) return direct.mappings;
	for (const key of Object.keys(response)) {
		const entry = response[key];
		if (isObject(entry) && isObject(entry.mappings)) return entry.mappings;
	}
	return null;
}
/** 没有独立值的类型：对象容器、别名、父子关联，本身都没有可聚合的值。 */
const NON_AGGREGATABLE_TYPES = /* @__PURE__ */ new Set([
	"",
	"object",
	"nested",
	"alias",
	"join",
	"flattened"
]);
/** 全文类型：默认不建 doc_values，可聚合性取决于 fielddata。 */
const TEXT_TYPES = /* @__PURE__ */ new Set([
	"text",
	"annotated_text",
	"match_only_text"
]);
function indexedOf(type, def) {
	if (NON_AGGREGATABLE_TYPES.has(type)) return null;
	if (boolOrNull(def.enabled) === false) return false;
	return boolOrNull(def.index) === false ? false : true;
}
function docValuesOf(type, def) {
	if (NON_AGGREGATABLE_TYPES.has(type) || TEXT_TYPES.has(type)) return null;
	return boolOrNull(def.doc_values) === false ? false : true;
}
function aggregatableOf(type, def, source) {
	if (NON_AGGREGATABLE_TYPES.has(type)) return false;
	if (boolOrNull(def.enabled) === false) return false;
	if (source === "runtime") return true;
	if (TEXT_TYPES.has(type)) return boolOrNull(def.fielddata) === true;
	return boolOrNull(def.doc_values) === false ? false : true;
}
function analyzerOf(type, def) {
	const analyzer = str(def, "analyzer", "");
	if (analyzer !== "") return analyzer;
	const searchAnalyzer = str(def, "search_analyzer", "");
	if (searchAnalyzer !== "") return `${searchAnalyzer}（检索）`;
	return TEXT_TYPES.has(type) ? "standard" : "";
}
/** 把一处 `properties`（或 `fields`）里的字段展开成扁平行。 */
function collectFields(properties, prefix, nested, source, depth, out) {
	if (depth > 64) return;
	for (const name of Object.keys(properties)) {
		if (out.length >= MAX_FIELDS) return;
		const def = properties[name];
		if (!isObject(def)) continue;
		const path = prefix === "" ? name : `${prefix}.${name}`;
		const type = str(def, "type", "");
		const children = isObject(def.properties) ? def.properties : null;
		const multiFields = isObject(def.fields) ? def.fields : null;
		const displayType = type !== "" ? type : children !== null ? "object（隐式）" : "未声明";
		out.push({
			path,
			type,
			displayType,
			indexed: indexedOf(type, def),
			docValues: docValuesOf(type, def),
			analyzer: analyzerOf(type, def),
			nested: nested.join(" > "),
			source,
			aggregatable: aggregatableOf(type, def, source)
		});
		const inner = type === "nested" ? [...nested, path] : nested;
		if (children !== null) collectFields(children, path, inner, source, depth + 1, out);
		if (multiFields !== null) collectFields(multiFields, path, inner, "multi-field", depth + 1, out);
	}
}
function fieldsOf(mappings) {
	const out = [];
	if (isObject(mappings.properties)) collectFields(mappings.properties, "", [], "property", 0, out);
	if (isObject(mappings.runtime)) collectFields(mappings.runtime, "", [], "runtime", 0, out);
	return out;
}
/** 字段过滤：不含 `*` 时按大小写不敏感子串；含 `*` 时按顺序分段匹配。 */
function matchesQuery(path, query) {
	const needle = query.trim().toLowerCase();
	if (needle === "") return true;
	const haystack = path.toLowerCase();
	if (!needle.includes("*")) return haystack.includes(needle);
	let from = 0;
	for (const part of needle.split("*")) {
		if (part === "") continue;
		const found = haystack.indexOf(part, from);
		if (found < 0) return false;
		from = found + part.length;
	}
	return true;
}
function numberText(value) {
	if (value === null) return "-";
	return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function healthText(health) {
	switch (health) {
		case "green": return "健康";
		case "yellow": return "副本未分配";
		case "red": return "不可用";
		case "": return "未知";
		default: return health;
	}
}
/** 与 lib 的 toneColor 同一套语义：ok→chart-1、warn→chart-4、danger→destructive。 */
function healthColor(health) {
	switch (health) {
		case "green": return c.chart(1);
		case "yellow": return c.chart(4);
		case "red": return c.danger();
		default: return c.muted();
	}
}
function yesNo(value) {
	if (value === null) return "—";
	return value ? "是" : "否";
}
function stateColor(value) {
	if (value === null) return c.muted();
	return value ? c.text() : c.danger();
}
function clockText() {
	const now = /* @__PURE__ */ new Date();
	return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}
function dash(text) {
	return text === "" ? "—" : text;
}
function ToolButton(props) {
	return (() => {
		const __nsh_hv0 = element("view");
		prop(__nsh_hv0, "role", "button");
		bindProp(__nsh_hv0, "accessibilityLabel", () => props.testLabel);
		bindProp(__nsh_hv0, "onPress", () => props.disabled?.() === true ? void 0 : props.onPress);
		bindProp(__nsh_hv0, "style", () => ({
			height: 26,
			paddingHorizontal: 10,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: props.primary === true ? c.accent() : c.line(),
			backgroundColor: props.primary === true ? c.accent() : "transparent",
			opacity: props.disabled?.() === true ? .45 : 1,
			display: "flex",
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "center"
		}));
		const __nsh_hv1 = element("text");
		bindProp(__nsh_hv1, "style", () => ({
			fontSize: 12,
			fontWeight: "500",
			color: props.primary === true ? c.accentText() : c.text()
		}));
		insert(__nsh_hv1, () => props.label());
		append(__nsh_hv0, __nsh_hv1);
		return __nsh_hv0;
	})();
}
/** 带 testID 的搜索框：lib 的 SearchField 不暴露 testID，测试里不好定位。 */
function Field(props) {
	return (() => {
		const __nsh_hv2 = element("view");
		bindProp(__nsh_hv2, "style", () => ({
			flexDirection: "row",
			alignItems: "center",
			gap: 6,
			height: 28,
			width: props.width,
			paddingHorizontal: 9,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: c.line(),
			backgroundColor: c.bg()
		}));
		const __nsh_hv3 = element("text");
		bindProp(__nsh_hv3, "style", () => ({
			fontSize: 12,
			color: c.muted()
		}));
		const __nsh_hv4 = text("⌕");
		append(__nsh_hv3, __nsh_hv4);
		const __nsh_hv5 = element("input");
		bindProp(__nsh_hv5, "testID", () => props.testID);
		bindProp(__nsh_hv5, "value", () => props.value);
		bindProp(__nsh_hv5, "placeholder", () => props.placeholder);
		prop(__nsh_hv5, "onChange", (text) => props.onChange(text));
		prop(__nsh_hv5, "style", {
			flex: 1,
			fontSize: 12,
			paddingHorizontal: 0,
			borderWidth: 0,
			backgroundColor: "transparent"
		});
		append(__nsh_hv2, __nsh_hv3);
		append(__nsh_hv2, __nsh_hv5);
		return __nsh_hv2;
	})();
}
function Chip(props) {
	return (() => {
		const __nsh_hv6 = element("view");
		prop(__nsh_hv6, "role", "button");
		bindProp(__nsh_hv6, "accessibilityLabel", () => props.label);
		bindProp(__nsh_hv6, "onPress", () => props.onPress);
		bindProp(__nsh_hv6, "style", () => ({
			height: 24,
			paddingHorizontal: 9,
			borderRadius: r.control,
			borderWidth: 1,
			borderColor: props.active() ? c.accent() : c.line(),
			backgroundColor: props.active() ? c.accent() : "transparent",
			display: "flex",
			flexDirection: "row",
			alignItems: "center"
		}));
		const __nsh_hv7 = element("text");
		bindProp(__nsh_hv7, "style", () => ({
			fontSize: 12,
			color: props.active() ? c.accentText() : c.text()
		}));
		insert(__nsh_hv7, () => props.label);
		append(__nsh_hv6, __nsh_hv7);
		return __nsh_hv6;
	})();
}
function MappingPage() {
	const indices = signal([]);
	const indicesLoading = signal(true);
	const indicesError = signal(null);
	const selected = signal(null);
	const mapping = signal(null);
	const mappingLoading = signal(false);
	const mappingError = signal(null);
	const indexFilter = signal("");
	const fieldQuery = signal("");
	const onlyAggregatable = signal(false);
	const updatedAt = signal(null);
	const notice = signal(null);
	const busy = computed(() => indicesLoading() || mappingLoading());
	const firstLoad = computed(() => indicesLoading() && indices().length === 0 && indicesError() === null);
	const firstError = computed(() => indicesError() !== null && indices().length === 0);
	const visibleIndices = computed(() => {
		const needle = indexFilter().trim().toLowerCase();
		if (needle === "") return indices();
		return indices().filter((row) => row.name.toLowerCase().includes(needle));
	});
	const visibleFields = computed(() => {
		const snapshot = mapping();
		if (snapshot === null) return [];
		const query = fieldQuery();
		const aggregatableOnly = onlyAggregatable();
		return snapshot.fields.filter((field) => (!aggregatableOnly || field.aggregatable) && matchesQuery(field.path, query));
	});
	const fieldSummary = computed(() => {
		const snapshot = mapping();
		if (snapshot === null) return "";
		const shown = visibleFields().length;
		const suffix = snapshot.truncated ? "（已截断）" : "";
		return shown === snapshot.fields.length ? `共 ${snapshot.fields.length} 个字段${suffix}` : `${shown} / ${snapshot.fields.length} 个字段${suffix}`;
	});
	const selectedIndex = computed(() => {
		const name = selected();
		if (name === null) return null;
		return indices().find((row) => row.name === name) ?? null;
	});
	let listSeq = 0;
	let mappingSeq = 0;
	async function loadMapping(index, refresh) {
		const mine = mappingSeq += 1;
		mappingLoading.set(true);
		try {
			const response = await dispatch("indexMapping", { name: index });
			if (mine !== mappingSeq || selected() !== index) return;
			const mappings = mappingOf(response, index);
			const fields = mappings === null ? [] : fieldsOf(mappings);
			mapping.set({
				index,
				fields,
				truncated: fields.length >= MAX_FIELDS
			});
			mappingError.set(null);
			updatedAt.set(clockText());
		} catch (error) {
			if (mine !== mappingSeq) return;
			mappingError.set(errorMessage(error));
			if (!refresh) mapping.set(null);
		} finally {
			if (mine === mappingSeq) mappingLoading.set(false);
		}
	}
	async function loadIndices(keep, reloadMapping) {
		const mine = listSeq += 1;
		const previous = selected();
		indicesLoading.set(true);
		try {
			const response = await dispatch("listIndices");
			if (mine !== listSeq) return;
			const rows = (isObject(response) && Array.isArray(response.indices) ? response.indices : []).map(toIndexRow).filter((row) => row.name !== "");
			indices.set(rows);
			indicesError.set(null);
			const wanted = keep ?? previous;
			const next = rows.some((row) => row.name === wanted) ? wanted : rows.length === 0 ? null : rows[0].name;
			if (next === null) {
				selected.set(null);
				mapping.set(null);
				mappingError.set(null);
				return;
			}
			const switched = next !== previous;
			selected.set(next);
			if (switched) {
				mapping.set(null);
				mappingError.set(null);
			}
			if (switched || reloadMapping || mapping() === null) loadMapping(next, !switched);
		} catch (error) {
			if (mine !== listSeq) return;
			indicesError.set(errorMessage(error));
		} finally {
			if (mine === listSeq) indicesLoading.set(false);
		}
	}
	function selectIndex(name) {
		if (selected() === name && mapping() !== null) return;
		selected.set(name);
		mapping.set(null);
		mappingError.set(null);
		loadMapping(name, false);
	}
	async function copyField(path) {
		try {
			await Clipboard.writeText(path);
			notice.set(`已复制字段名：${path}`);
		} catch (error) {
			notice.set(`复制失败：${errorMessage(error)}`);
		}
	}
	function indexRows() {
		const rows = visibleIndices();
		if (rows.length === 0) return indices().length === 0 ? component(Empty, {
			title: "还没有索引",
			hint: "当前集群没有可读取的索引；创建索引后会出现在这里。"
		}) : component(Empty, {
			title: "没有匹配的索引",
			get hint() {
				return `没有名称包含「${indexFilter().trim()}」的索引。`;
			}
		});
		return component(List, {
			items: rows,
			keyOf: (row) => row.name,
			get selected() {
				return selected();
			},
			onSelect: (name) => selectIndex(name),
			render: (row) => component(ListRow, {
				get title() {
					return row.name;
				},
				get subtitle() {
					return `${healthText(row.health)} · ${dash(row.status)} · ${numberText(row.docs)} 文档`;
				},
				get leading() {
					return (() => {
						const __nsh_hv8 = element("view");
						bindProp(__nsh_hv8, "style", () => ({
							width: 8,
							height: 8,
							borderRadius: 4,
							backgroundColor: healthColor(row.health)
						}));
						return __nsh_hv8;
					})();
				},
				get trailing() {
					return (() => {
						const __nsh_hv9 = element("text");
						bindProp(__nsh_hv9, "style", () => ({
							...t.mono,
							fontSize: 11,
							color: c.muted()
						}));
						insert(__nsh_hv9, () => row.size === null ? "-" : humanBytes(row.size));
						return __nsh_hv9;
					})();
				}
			})
		});
	}
	function tableHeader() {
		return component(Row, {
			gap: 10,
			get style() {
				return {
					paddingVertical: 6,
					borderBottomWidth: 1,
					borderBottomColor: c.line()
				};
			},
			get children() {
				return [
					(() => {
						const __nsh_hv10 = element("text");
						bindProp(__nsh_hv10, "style", () => ({
							...t.label,
							flex: 1,
							minWidth: 0
						}));
						const __nsh_hv11 = text("字段名");
						append(__nsh_hv10, __nsh_hv11);
						return __nsh_hv10;
					})(),
					(() => {
						const __nsh_hv12 = element("text");
						bindProp(__nsh_hv12, "style", () => ({
							...t.label,
							width: 110
						}));
						const __nsh_hv13 = text("类型");
						append(__nsh_hv12, __nsh_hv13);
						return __nsh_hv12;
					})(),
					(() => {
						const __nsh_hv14 = element("text");
						bindProp(__nsh_hv14, "style", () => ({
							...t.label,
							width: 52
						}));
						const __nsh_hv15 = text("index");
						append(__nsh_hv14, __nsh_hv15);
						return __nsh_hv14;
					})(),
					(() => {
						const __nsh_hv16 = element("text");
						bindProp(__nsh_hv16, "style", () => ({
							...t.label,
							width: 82
						}));
						const __nsh_hv17 = text("doc_values");
						append(__nsh_hv16, __nsh_hv17);
						return __nsh_hv16;
					})(),
					(() => {
						const __nsh_hv18 = element("text");
						bindProp(__nsh_hv18, "style", () => ({
							...t.label,
							width: 104
						}));
						const __nsh_hv19 = text("analyzer");
						append(__nsh_hv18, __nsh_hv19);
						return __nsh_hv18;
					})(),
					(() => {
						const __nsh_hv20 = element("text");
						bindProp(__nsh_hv20, "style", () => ({
							...t.label,
							width: 136
						}));
						const __nsh_hv21 = text("嵌套路径");
						append(__nsh_hv20, __nsh_hv21);
						return __nsh_hv20;
					})(),
					(() => {
						const __nsh_hv22 = element("view");
						prop(__nsh_hv22, "style", { width: 34 });
						return __nsh_hv22;
					})()
				];
			}
		});
	}
	function fieldLine(field) {
		return component(Row, {
			gap: 10,
			get style() {
				return {
					paddingVertical: 6,
					borderBottomWidth: 1,
					borderBottomColor: c.line()
				};
			},
			get children() {
				return [
					(() => {
						const __nsh_hv23 = element("text");
						prop(__nsh_hv23, "numberOfLines", 1);
						prop(__nsh_hv23, "ellipsizeMode", "middle");
						prop(__nsh_hv23, "selectable", true);
						bindProp(__nsh_hv23, "style", () => ({
							...t.mono,
							flex: 1,
							minWidth: 0,
							color: c.text()
						}));
						insert(__nsh_hv23, () => field.path);
						return __nsh_hv23;
					})(),
					(() => {
						const __nsh_hv24 = element("text");
						prop(__nsh_hv24, "numberOfLines", 1);
						prop(__nsh_hv24, "ellipsizeMode", "tail");
						bindProp(__nsh_hv24, "style", () => ({
							width: 110,
							fontSize: 11,
							color: c.text()
						}));
						insert(__nsh_hv24, () => field.source === "property" ? field.displayType : `${field.displayType} · ${field.source}`);
						return __nsh_hv24;
					})(),
					(() => {
						const __nsh_hv25 = element("text");
						prop(__nsh_hv25, "numberOfLines", 1);
						bindProp(__nsh_hv25, "style", () => ({
							width: 52,
							fontSize: 11,
							color: stateColor(field.indexed)
						}));
						insert(__nsh_hv25, () => yesNo(field.indexed));
						return __nsh_hv25;
					})(),
					(() => {
						const __nsh_hv26 = element("text");
						prop(__nsh_hv26, "numberOfLines", 1);
						bindProp(__nsh_hv26, "style", () => ({
							width: 82,
							fontSize: 11,
							color: stateColor(field.docValues)
						}));
						insert(__nsh_hv26, () => yesNo(field.docValues));
						return __nsh_hv26;
					})(),
					(() => {
						const __nsh_hv27 = element("text");
						prop(__nsh_hv27, "numberOfLines", 1);
						prop(__nsh_hv27, "ellipsizeMode", "tail");
						bindProp(__nsh_hv27, "style", () => ({
							width: 104,
							fontSize: 11,
							color: c.muted()
						}));
						insert(__nsh_hv27, () => dash(field.analyzer));
						return __nsh_hv27;
					})(),
					(() => {
						const __nsh_hv28 = element("text");
						prop(__nsh_hv28, "numberOfLines", 1);
						prop(__nsh_hv28, "ellipsizeMode", "middle");
						bindProp(__nsh_hv28, "style", () => ({
							width: 136,
							fontSize: 11,
							color: c.muted()
						}));
						insert(__nsh_hv28, () => dash(field.nested));
						return __nsh_hv28;
					})(),
					component(ToolButton, {
						label: () => "复制",
						get testLabel() {
							return `复制字段 ${field.path}`;
						},
						onPress: () => void copyField(field.path)
					})
				];
			}
		});
	}
	function fieldsBody() {
		const rows = visibleFields();
		if (rows.length === 0) {
			const filtered = fieldQuery().trim() !== "" || onlyAggregatable();
			return component(Empty, {
				title: filtered ? "没有匹配的字段" : "该索引没有显式字段定义",
				hint: filtered ? "清空字段过滤，或关掉「只看可聚合字段」再看。" : "字段可能全靠 dynamic mapping 自动生成，写入一条文档后再刷新。"
			});
		}
		const shown = rows.slice(0, RENDER_LIMIT);
		return (() => {
			const __nsh_hv29 = element("view");
			prop(__nsh_hv29, "style", {
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "column"
			});
			const __nsh_hv30 = element("view");
			prop(__nsh_hv30, "style", { paddingHorizontal: 14 });
			insert(__nsh_hv30, () => tableHeader());
			const __nsh_hv31 = element("scroll");
			prop(__nsh_hv31, "style", {
				flex: 1,
				minHeight: 0
			});
			const __nsh_hv32 = element("view");
			prop(__nsh_hv32, "style", {
				display: "flex",
				flexDirection: "column",
				paddingHorizontal: 14,
				paddingBottom: 8
			});
			insert(__nsh_hv32, () => shown.map((field) => fieldLine(field)));
			append(__nsh_hv31, __nsh_hv32);
			append(__nsh_hv29, __nsh_hv30);
			append(__nsh_hv29, __nsh_hv31);
			insert(__nsh_hv29, component(Row, {
				get style() {
					return {
						justifyContent: "space-between",
						paddingHorizontal: 14,
						paddingVertical: 6,
						borderTopWidth: 1,
						borderTopColor: c.line()
					};
				},
				get children() {
					return [(() => {
						const __nsh_hv33 = element("text");
						bindProp(__nsh_hv33, "style", () => t.meta);
						insert(__nsh_hv33, [
							() => rows.length > shown.length ? `已渲染前 ${shown.length} 行（共 ${rows.length} 行），用搜索缩小范围` : `显示 ${shown.length} 行`,
							` · 来源：property / multi-field / runtime`,
							() => mapping()?.truncated === true ? ` · 字段超过 ${MAX_FIELDS} 个，只解析了前 ${MAX_FIELDS} 个` : ""
						]);
						return __nsh_hv33;
					})(), (() => {
						const __nsh_hv34 = element("text");
						bindProp(__nsh_hv34, "style", () => t.meta);
						const __nsh_hv35 = text("点「复制」把完整字段名放进剪贴板");
						append(__nsh_hv34, __nsh_hv35);
						return __nsh_hv34;
					})()];
				}
			}));
			return __nsh_hv29;
		})();
	}
	function detailBody() {
		if (mapping() !== null) return fieldsBody();
		if (mappingError() !== null) return component(LoadError, {
			get message() {
				return mappingError() ?? "";
			},
			onRetry: () => void loadMapping(selected() ?? "", true)
		});
		if (mappingLoading()) return component(Loading, { label: "正在读取 index mapping…" });
		return component(Empty, {
			title: "等待读取",
			hint: "选择左侧索引后会自动读取它的 mapping。"
		});
	}
	function detailPane() {
		return (() => {
			const __nsh_hv36 = element("view");
			prop(__nsh_hv36, "style", {
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "column"
			});
			insert(__nsh_hv36, [() => selected() === null ? component(Empty, {
				title: "选择一个索引",
				hint: "左侧点一个索引，这里会显示它的字段定义。"
			}) : null, () => selected() === null ? null : (() => {
				const __nsh_hv37 = element("view");
				prop(__nsh_hv37, "style", {
					flex: 1,
					minHeight: 0,
					display: "flex",
					flexDirection: "column"
				});
				insert(__nsh_hv37, [
					component(Row, {
						wrap: true,
						gap: 8,
						style: {
							paddingHorizontal: 14,
							paddingVertical: 10,
							alignItems: "center"
						},
						get children() {
							return [
								component(Field, {
									testID: "field-filter",
									get value() {
										return fieldQuery();
									},
									onChange: (value) => fieldQuery.set(value),
									placeholder: "按字段名 / 路径过滤，支持 *",
									width: 260
								}),
								component(Chip, {
									label: "只看可聚合字段",
									active: onlyAggregatable,
									onPress: () => onlyAggregatable.set(!onlyAggregatable())
								}),
								(() => {
									const __nsh_hv38 = element("view");
									prop(__nsh_hv38, "style", { flex: 1 });
									return __nsh_hv38;
								})(),
								(() => {
									const __nsh_hv39 = element("text");
									bindProp(__nsh_hv39, "style", () => t.meta);
									insert(__nsh_hv39, () => selectedIndex() === null ? "" : `${healthText(selectedIndex()?.health ?? "")} · ${numberText(selectedIndex()?.docs ?? null)} 文档`);
									return __nsh_hv39;
								})(),
								(() => {
									const __nsh_hv40 = element("text");
									bindProp(__nsh_hv40, "style", () => t.meta);
									insert(__nsh_hv40, () => fieldSummary());
									return __nsh_hv40;
								})()
							];
						}
					}),
					() => mappingError() === null || mapping() === null ? null : component(Row, {
						gap: 8,
						style: {
							paddingHorizontal: 14,
							paddingBottom: 8
						},
						get children() {
							return [(() => {
								const __nsh_hv41 = element("view");
								prop(__nsh_hv41, "style", {
									flex: 1,
									minWidth: 0
								});
								insert(__nsh_hv41, component(Notice, {
									get message() {
										return `刷新失败，下面仍是 ${updatedAt() ?? "上次"} 的快照：${mappingError() ?? ""}`;
									},
									tone: "danger"
								}));
								return __nsh_hv41;
							})(), component(ToolButton, {
								label: () => "重试",
								testLabel: "重试读取 mapping",
								onPress: () => void loadMapping(selected() ?? "", true)
							})];
						}
					}),
					() => detailBody()
				]);
				return __nsh_hv37;
			})()]);
			return __nsh_hv36;
		})();
	}
	function listPane() {
		return (() => {
			const __nsh_hv42 = element("view");
			prop(__nsh_hv42, "style", {
				flex: 1,
				minHeight: 0,
				display: "flex",
				flexDirection: "column"
			});
			const __nsh_hv43 = element("view");
			prop(__nsh_hv43, "style", {
				paddingHorizontal: 10,
				paddingVertical: 8
			});
			insert(__nsh_hv43, component(Field, {
				testID: "index-filter",
				get value() {
					return indexFilter();
				},
				onChange: (value) => indexFilter.set(value),
				placeholder: "过滤索引名",
				width: 278
			}));
			append(__nsh_hv42, __nsh_hv43);
			insert(__nsh_hv42, () => indexRows());
			return __nsh_hv42;
		})();
	}
	loadIndices(null, false);
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
						style: { alignItems: "center" },
						get children() {
							return [
								(() => {
									const __nsh_hv45 = element("text");
									bindProp(__nsh_hv45, "style", () => t.h1);
									const __nsh_hv46 = text("Mapping");
									append(__nsh_hv45, __nsh_hv46);
									return __nsh_hv45;
								})(),
								() => selected() === null ? null : (() => {
									const __nsh_hv47 = element("text");
									bindProp(__nsh_hv47, "style", () => t.meta);
									insert(__nsh_hv47, () => selected() ?? "");
									return __nsh_hv47;
								})(),
								(() => {
									const __nsh_hv48 = element("text");
									bindProp(__nsh_hv48, "style", () => t.meta);
									const __nsh_hv49 = text("索引字段定义");
									append(__nsh_hv48, __nsh_hv49);
									return __nsh_hv48;
								})()
							];
						}
					}), component(Row, {
						gap: 10,
						style: { alignItems: "center" },
						get children() {
							return [(() => {
								const __nsh_hv50 = element("text");
								bindProp(__nsh_hv50, "style", () => t.meta);
								insert(__nsh_hv50, () => updatedAt() === null ? "尚未更新" : `上次更新 ${updatedAt() ?? ""}`);
								return __nsh_hv50;
							})(), component(ToolButton, {
								label: () => busy() ? "刷新中…" : "刷新",
								testLabel: "刷新",
								disabled: busy,
								primary: true,
								onPress: () => void loadIndices(selected(), true)
							})];
						}
					})];
				}
			}),
			() => indicesError() === null || indices().length === 0 ? null : (() => {
				const __nsh_hv51 = element("view");
				prop(__nsh_hv51, "style", {
					paddingHorizontal: 14,
					paddingBottom: 8
				});
				insert(__nsh_hv51, component(Notice, {
					get message() {
						return `刷新索引列表失败：${indicesError() ?? ""}`;
					},
					tone: "danger"
				}));
				return __nsh_hv51;
			})(),
			() => notice() === null ? null : (() => {
				const __nsh_hv52 = element("view");
				prop(__nsh_hv52, "style", {
					paddingHorizontal: 14,
					paddingBottom: 8
				});
				insert(__nsh_hv52, component(Notice, { get message() {
					return notice() ?? "";
				} }));
				return __nsh_hv52;
			})(),
			() => firstLoad() ? component(Loading, { label: "正在读取索引列表…" }) : null,
			() => firstError() ? component(LoadError, {
				get message() {
					return indicesError() ?? "";
				},
				onRetry: () => void loadIndices(selected(), true)
			}) : null,
			() => firstLoad() || firstError() ? null : component(SplitPane, {
				width: 300,
				get left() {
					return listPane();
				},
				get right() {
					return detailPane();
				}
			})
		]);
		return __nsh_hv44;
	})();
}

//#endregion
//#region App.tsx
const startup = host.params;
/** 路由表：route id → 页面。仅一条路由时不需要外壳侧栏。 */
const DEFAULT_ROUTE = "mapping";
const ROUTES = { mapping: MappingPage };
const resolveRoute = (raw) => {
	const route = raw ?? "";
	return route.length > 0 && Object.prototype.hasOwnProperty.call(ROUTES, route) ? route : DEFAULT_ROUTE;
};
const hasConnection = () => startup.connection !== null && startup.connection !== void 0;
function ElasticsearchApp() {
	if (!hasConnection()) return (() => {
		const __nsh_hv0 = element("view");
		prop(__nsh_hv0, "style", {
			flex: 1,
			minWidth: 0,
			minHeight: 0
		});
		insert(__nsh_hv0, component(Empty, {
			title: "请先打开一个 Elasticsearch 9 连接",
			hint: "索引 mapping 需要通过连接访问集群：从左侧连接列表打开一个 Elasticsearch 连接即可。"
		}));
		return __nsh_hv0;
	})();
	const Page = ROUTES[resolveRoute(startup.route)];
	return (() => {
		const __nsh_hv1 = element("view");
		prop(__nsh_hv1, "style", {
			flex: 1,
			minWidth: 0,
			minHeight: 0,
			display: "flex",
			flexDirection: "column"
		});
		insert(__nsh_hv1, component(Page, {}));
		return __nsh_hv1;
	})();
}
mount(ElasticsearchApp);

//#endregion