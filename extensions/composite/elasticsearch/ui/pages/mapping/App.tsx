// Elasticsearch Mapping 页：左侧索引列表，右侧选中索引的字段定义。
//
// 数据分两层：`navop.context.current` 拿到宿主借给这个页面的资源句柄，
// 再用 `navop.resource.invoke` 按方法名调 provider。页面拿不到连接，
// 索引也完全由页面自己选：默认选中列表第一个，用户点列表切换。
import { Clipboard, computed, host, mount, signal, Scroll, Text, View } from "nsh";
import type { Accessor, JSX } from "nsh";
import { Input } from "nsh/base";
import { errorMessage, humanBytes, str } from "../../lib/format";
import { Empty, List, ListRow, LoadError, Loading, Notice, Row, SplitPane } from "../../lib/ui";
import { c, r, t } from "../../lib/theme";

/** 一次最多渲染多少行字段：mapping 可以有几万个字段，全量上屏会卡。 */
const RENDER_LIMIT = 500;

/** 最多解析多少字段：动态 mapping 的索引能有十万级字段，先截断再展示。 */
const MAX_FIELDS = 20_000;

type Json = Record<string, unknown>;

type IndexRow = {
  name: string;
  health: string;
  status: string;
  docs: number | null;
  size: number | null;
};

type FieldSource = "property" | "multi-field" | "runtime";

type FieldRow = {
  path: string;
  type: string;
  displayType: string;
  indexed: boolean | null;
  docValues: boolean | null;
  analyzer: string;
  nested: string;
  source: FieldSource;
  aggregatable: boolean;
};

type MappingSnapshot = { index: string; fields: FieldRow[]; truncated: boolean };

// ---- 数据 -----------------------------------------------------------

/** operationId → provider 方法名。
 *
 * 清单里的 `resourceWorkbenches` 已经不参与运行，这一层映射留在页面里：
 * 页面自己决定"要哪份数据"，宿主只负责把方法名和参数发给 provider。
 */
const OPERATIONS: Record<string, string> = {
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
  search: "elasticsearch/search/async",
};

let resourceHandle: string | null = null;

/** 借来的资源句柄：页面所属连接的那一个。 */
async function handle(): Promise<string> {
  if (resourceHandle) return resourceHandle;
  const context = (await host.call("navop.context.current", {})) as {
    connection?: { resourceHandle?: string } | null;
  };
  const found = context?.connection?.resourceHandle;
  if (!found) throw new Error("这个页面需要一个扩展连接（当前上下文里没有资源句柄）");
  resourceHandle = found;
  return found;
}

/** 调一次 provider 方法；把失败折成一句人话。`confirmed` 仅为兼容旧调用点。 */
async function dispatch(
  operationId: string,
  input?: unknown,
  _confirmed?: boolean,
): Promise<unknown> {
  const method = OPERATIONS[operationId];
  if (!method) throw new Error(`未知的操作：${operationId}`);
  try {
    return await host.call("navop.resource.invoke", {
      handle: await handle(),
      method,
      params: (input as Record<string, unknown>) ?? {},
    });
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function toIndexRow(value: unknown): IndexRow {
  return {
    name: str(value, "name", ""),
    health: str(value, "health", ""),
    status: str(value, "status", ""),
    docs: numberOrNull(isObject(value) ? value.docs : undefined),
    size: numberOrNull(isObject(value) ? value.size_bytes : undefined),
  };
}

/**
 * `GET /<index>/_mapping` 的信封是 `{"<具体索引名>": {"mappings": …}}`。
 * 索引可能是别名或通配，返回的键不一定等于请求的名字，所以先按请求名找，
 * 找不到就退回第一个真正带了 `mappings` 的条目。
 */
function mappingOf(response: unknown, index: string): Json | null {
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
const NON_AGGREGATABLE_TYPES = new Set(["", "object", "nested", "alias", "join", "flattened"]);

/** 全文类型：默认不建 doc_values，可聚合性取决于 fielddata。 */
const TEXT_TYPES = new Set(["text", "annotated_text", "match_only_text"]);

function indexedOf(type: string, def: Json): boolean | null {
  if (NON_AGGREGATABLE_TYPES.has(type)) return null;
  if (boolOrNull(def.enabled) === false) return false;
  return boolOrNull(def.index) === false ? false : true;
}

function docValuesOf(type: string, def: Json): boolean | null {
  if (NON_AGGREGATABLE_TYPES.has(type) || TEXT_TYPES.has(type)) return null;
  return boolOrNull(def.doc_values) === false ? false : true;
}

function aggregatableOf(type: string, def: Json, source: FieldSource): boolean {
  if (NON_AGGREGATABLE_TYPES.has(type)) return false;
  if (boolOrNull(def.enabled) === false) return false;
  // runtime 字段的 doc_values 由脚本现算，类型支持就能聚合。
  if (source === "runtime") return true;
  if (TEXT_TYPES.has(type)) return boolOrNull(def.fielddata) === true;
  return boolOrNull(def.doc_values) === false ? false : true;
}

function analyzerOf(type: string, def: Json): string {
  const analyzer = str(def, "analyzer", "");
  if (analyzer !== "") return analyzer;
  const searchAnalyzer = str(def, "search_analyzer", "");
  if (searchAnalyzer !== "") return `${searchAnalyzer}（检索）`;
  return TEXT_TYPES.has(type) ? "standard" : "";
}

/** 把一处 `properties`（或 `fields`）里的字段展开成扁平行。 */
function collectFields(
  properties: Json,
  prefix: string,
  nested: string[],
  source: FieldSource,
  depth: number,
  out: FieldRow[],
): void {
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
      aggregatable: aggregatableOf(type, def, source),
    });
    const inner = type === "nested" ? [...nested, path] : nested;
    if (children !== null) collectFields(children, path, inner, source, depth + 1, out);
    if (multiFields !== null) collectFields(multiFields, path, inner, "multi-field", depth + 1, out);
  }
}

function fieldsOf(mappings: Json): FieldRow[] {
  const out: FieldRow[] = [];
  if (isObject(mappings.properties)) collectFields(mappings.properties, "", [], "property", 0, out);
  // runtime 字段是另一套来源，路径就是它自己的名字。
  if (isObject(mappings.runtime)) collectFields(mappings.runtime, "", [], "runtime", 0, out);
  return out;
}

/** 字段过滤：不含 `*` 时按大小写不敏感子串；含 `*` 时按顺序分段匹配。 */
function matchesQuery(path: string, query: string): boolean {
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

function numberText(value: number | null): string {
  if (value === null) return "-";
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function healthText(health: string): string {
  switch (health) {
    case "green":
      return "健康";
    case "yellow":
      return "副本未分配";
    case "red":
      return "不可用";
    case "":
      return "未知";
    default:
      return health;
  }
}

/** 与 lib 的 toneColor 同一套语义：ok→chart-1、warn→chart-4、danger→destructive。 */
function healthColor(health: string): string {
  switch (health) {
    case "green":
      return c.chart(1);
    case "yellow":
      return c.chart(4);
    case "red":
      return c.danger();
    default:
      return c.muted();
  }
}

function yesNo(value: boolean | null): string {
  if (value === null) return "—";
  return value ? "是" : "否";
}

function stateColor(value: boolean | null): string {
  if (value === null) return c.muted();
  return value ? c.text() : c.danger();
}

function clockText(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function dash(text: string): string {
  return text === "" ? "—" : text;
}

// ---- 本地组件 -------------------------------------------------------
// lib 的 Button/Badge 在函数体里把 props 读成了常量，只适合静态文案；
// 这里要跟着信号变的按钮和 chip 都自己画，让样式落在 JSX 绑定上。

function ToolButton(props: {
  label: Accessor<string>;
  testLabel: string;
  disabled?: Accessor<boolean>;
  primary?: boolean;
  onPress: () => void;
}) {
  return (
    <View
      role="button"
      accessibilityLabel={props.testLabel}
      onPress={props.disabled?.() === true ? undefined : props.onPress}
      style={{
        height: 26,
        paddingHorizontal: 10,
        borderRadius: r.control,
        borderWidth: 1,
        borderColor: props.primary === true ? c.accent() : c.line(),
        backgroundColor: props.primary === true ? c.accent() : "transparent",
        opacity: props.disabled?.() === true ? 0.45 : 1,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          fontSize: 12,
          fontWeight: "500",
          color: props.primary === true ? c.accentText() : c.text(),
        }}
      >
        {props.label()}
      </Text>
    </View>
  );
}

/** 带 testID 的搜索框：lib 的 SearchField 不暴露 testID，测试里不好定位。 */
function Field(props: {
  testID: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  width: number;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 28,
        width: props.width,
        paddingHorizontal: 9,
        borderRadius: r.control,
        borderWidth: 1,
        borderColor: c.line(),
        backgroundColor: c.bg(),
      }}
    >
      <Text style={{ fontSize: 12, color: c.muted() }}>⌕</Text>
      <Input
        testID={props.testID}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(text) => props.onChange(text)}
        style={{ flex: 1, fontSize: 12, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent" }}
      />
    </View>
  );
}

function Chip(props: { label: string; active: Accessor<boolean>; onPress: () => void }) {
  return (
    <View
      role="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      style={{
        height: 24,
        paddingHorizontal: 9,
        borderRadius: r.control,
        borderWidth: 1,
        borderColor: props.active() ? c.accent() : c.line(),
        backgroundColor: props.active() ? c.accent() : "transparent",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
      }}
    >
      <Text style={{ fontSize: 12, color: props.active() ? c.accentText() : c.text() }}>
        {props.label}
      </Text>
    </View>
  );
}

// ---- 页面 -----------------------------------------------------------

export default function MappingPage() {
  const indices = signal<IndexRow[]>([]);
  const indicesLoading = signal(true);
  const indicesError = signal<string | null>(null);

  const selected = signal<string | null>(null);
  const mapping = signal<MappingSnapshot | null>(null);
  const mappingLoading = signal(false);
  const mappingError = signal<string | null>(null);

  const indexFilter = signal("");
  const fieldQuery = signal("");
  const onlyAggregatable = signal(false);

  const updatedAt = signal<string | null>(null);
  const notice = signal<string | null>(null);

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
    if (snapshot === null) return [] as FieldRow[];
    const query = fieldQuery();
    const aggregatableOnly = onlyAggregatable();
    return snapshot.fields.filter(
      (field) => (!aggregatableOnly || field.aggregatable) && matchesQuery(field.path, query),
    );
  });

  const fieldSummary = computed(() => {
    const snapshot = mapping();
    if (snapshot === null) return "";
    const shown = visibleFields().length;
    const suffix = snapshot.truncated ? "（已截断）" : "";
    return shown === snapshot.fields.length
      ? `共 ${snapshot.fields.length} 个字段${suffix}`
      : `${shown} / ${snapshot.fields.length} 个字段${suffix}`;
  });

  const selectedIndex = computed(() => {
    const name = selected();
    if (name === null) return null;
    return indices().find((row) => row.name === name) ?? null;
  });

  // 切换索引时旧请求作废：用递增的序号做「只认最后一次」。
  let listSeq = 0;
  let mappingSeq = 0;

  async function loadMapping(index: string, refresh: boolean): Promise<void> {
    const mine = (mappingSeq += 1);
    mappingLoading.set(true);
    try {
      const response = await dispatch("indexMapping", { name: index });
      if (mine !== mappingSeq || selected() !== index) return;
      const mappings = mappingOf(response, index);
      const fields = mappings === null ? [] : fieldsOf(mappings);
      mapping.set({ index, fields, truncated: fields.length >= MAX_FIELDS });
      mappingError.set(null);
      updatedAt.set(clockText());
    } catch (error) {
      if (mine !== mappingSeq) return;
      mappingError.set(errorMessage(error));
      // 自动刷新失败要留住旧内容，只有首次读取失败才把表格清空。
      if (!refresh) mapping.set(null);
    } finally {
      if (mine === mappingSeq) mappingLoading.set(false);
    }
  }

  async function loadIndices(keep: string | null, reloadMapping: boolean): Promise<void> {
    const mine = (listSeq += 1);
    const previous = selected();
    indicesLoading.set(true);
    try {
      const response = await dispatch("listIndices");
      if (mine !== listSeq) return;
      const rows = (isObject(response) && Array.isArray(response.indices) ? response.indices : [])
        .map(toIndexRow)
        .filter((row) => row.name !== "");
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
      if (switched || reloadMapping || mapping() === null) void loadMapping(next, !switched);
    } catch (error) {
      if (mine !== listSeq) return;
      indicesError.set(errorMessage(error));
    } finally {
      if (mine === listSeq) indicesLoading.set(false);
    }
  }

  function selectIndex(name: string): void {
    if (selected() === name && mapping() !== null) return;
    selected.set(name);
    mapping.set(null);
    mappingError.set(null);
    void loadMapping(name, false);
  }

  async function copyField(path: string): Promise<void> {
    try {
      await Clipboard.writeText(path);
      notice.set(`已复制字段名：${path}`);
    } catch (error) {
      notice.set(`复制失败：${errorMessage(error)}`);
    }
  }

  // ---- 左列 ---------------------------------------------------------

  function indexRows(): JSX.Element {
    const rows = visibleIndices();
    if (rows.length === 0) {
      return indices().length === 0 ? (
        <Empty title="还没有索引" hint="当前集群没有可读取的索引；创建索引后会出现在这里。" />
      ) : (
        <Empty title="没有匹配的索引" hint={`没有名称包含「${indexFilter().trim()}」的索引。`} />
      );
    }
    return (
      <List
        items={rows}
        keyOf={(row) => row.name}
        selected={selected()}
        onSelect={(name) => selectIndex(name)}
        render={(row) => (
          <ListRow
            title={row.name}
            subtitle={`${healthText(row.health)} · ${dash(row.status)} · ${numberText(row.docs)} 文档`}
            leading={
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: healthColor(row.health),
                }}
              />
            }
            trailing={<Text style={{ ...t.mono, fontSize: 11, color: c.muted() }}>{row.size === null ? "-" : humanBytes(row.size)}</Text>}
          />
        )}
      />
    );
  }

  // ---- 右列 ---------------------------------------------------------

  function tableHeader(): JSX.Element {
    return (
      <Row gap={10} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.line() }}>
        <Text style={{ ...t.label, flex: 1, minWidth: 0 }}>字段名</Text>
        <Text style={{ ...t.label, width: 110 }}>类型</Text>
        <Text style={{ ...t.label, width: 52 }}>index</Text>
        <Text style={{ ...t.label, width: 82 }}>doc_values</Text>
        <Text style={{ ...t.label, width: 104 }}>analyzer</Text>
        <Text style={{ ...t.label, width: 136 }}>嵌套路径</Text>
        <View style={{ width: 34 }} />
      </Row>
    );
  }

  function fieldLine(field: FieldRow): JSX.Element {
    return (
      <Row gap={10} style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.line() }}>
        <Text
          numberOfLines={1}
          ellipsizeMode="middle"
          selectable
          style={{ ...t.mono, flex: 1, minWidth: 0, color: c.text() }}
        >
          {field.path}
        </Text>
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{ width: 110, fontSize: 11, color: c.text() }}
        >
          {field.source === "property" ? field.displayType : `${field.displayType} · ${field.source}`}
        </Text>
        <Text numberOfLines={1} style={{ width: 52, fontSize: 11, color: stateColor(field.indexed) }}>
          {yesNo(field.indexed)}
        </Text>
        <Text numberOfLines={1} style={{ width: 82, fontSize: 11, color: stateColor(field.docValues) }}>
          {yesNo(field.docValues)}
        </Text>
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{ width: 104, fontSize: 11, color: c.muted() }}
        >
          {dash(field.analyzer)}
        </Text>
        <Text
          numberOfLines={1}
          ellipsizeMode="middle"
          style={{ width: 136, fontSize: 11, color: c.muted() }}
        >
          {dash(field.nested)}
        </Text>
        <ToolButton
          label={() => "复制"}
          testLabel={`复制字段 ${field.path}`}
          onPress={() => void copyField(field.path)}
        />
      </Row>
    );
  }

  function fieldsBody(): JSX.Element {
    const rows = visibleFields();
    if (rows.length === 0) {
      const filtered = fieldQuery().trim() !== "" || onlyAggregatable();
      return (
        <Empty
          title={filtered ? "没有匹配的字段" : "该索引没有显式字段定义"}
          hint={
            filtered
              ? "清空字段过滤，或关掉「只看可聚合字段」再看。"
              : "字段可能全靠 dynamic mapping 自动生成，写入一条文档后再刷新。"
          }
        />
      );
    }
    const shown = rows.slice(0, RENDER_LIMIT);
    return (
      <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <View style={{ paddingHorizontal: 14 }}>{tableHeader()}</View>
        <Scroll style={{ flex: 1, minHeight: 0 }}>
          <View style={{ display: "flex", flexDirection: "column", paddingHorizontal: 14, paddingBottom: 8 }}>
            {shown.map((field) => fieldLine(field))}
          </View>
        </Scroll>
        <Row
          style={{
            justifyContent: "space-between",
            paddingHorizontal: 14,
            paddingVertical: 6,
            borderTopWidth: 1,
            borderTopColor: c.line(),
          }}
        >
          <Text style={t.meta}>
            {rows.length > shown.length
              ? `已渲染前 ${shown.length} 行（共 ${rows.length} 行），用搜索缩小范围`
              : `显示 ${shown.length} 行`}
            {` · 来源：property / multi-field / runtime`}
            {mapping()?.truncated === true ? ` · 字段超过 ${MAX_FIELDS} 个，只解析了前 ${MAX_FIELDS} 个` : ""}
          </Text>
          <Text style={t.meta}>点「复制」把完整字段名放进剪贴板</Text>
        </Row>
      </View>
    );
  }

  function detailBody(): JSX.Element {
    const snapshot = mapping();
    if (snapshot !== null) return fieldsBody();
    if (mappingError() !== null) {
      return (
        <LoadError
          message={mappingError() ?? ""}
          onRetry={() => void loadMapping(selected() ?? "", true)}
        />
      );
    }
    if (mappingLoading()) return <Loading label="正在读取 index mapping…" />;
    return <Empty title="等待读取" hint="选择左侧索引后会自动读取它的 mapping。" />;
  }

  function detailPane(): JSX.Element {
    return (
      <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {selected() === null ? (
          <Empty title="选择一个索引" hint="左侧点一个索引，这里会显示它的字段定义。" />
        ) : null}
        {selected() === null ? null : (
          <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <Row wrap gap={8} style={{ paddingHorizontal: 14, paddingVertical: 10, alignItems: "center" }}>
              <Field
                testID="field-filter"
                value={fieldQuery()}
                onChange={(value) => fieldQuery.set(value)}
                placeholder="按字段名 / 路径过滤，支持 *"
                width={260}
              />
              <Chip
                label="只看可聚合字段"
                active={onlyAggregatable}
                onPress={() => onlyAggregatable.set(!onlyAggregatable())}
              />
              <View style={{ flex: 1 }} />
              <Text style={t.meta}>{selectedIndex() === null ? "" : `${healthText(selectedIndex()?.health ?? "")} · ${numberText(selectedIndex()?.docs ?? null)} 文档`}</Text>
              <Text style={t.meta}>{fieldSummary()}</Text>
            </Row>
            {() =>
              mappingError() === null || mapping() === null ? null : (
                <Row gap={8} style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Notice
                      message={`刷新失败，下面仍是 ${updatedAt() ?? "上次"} 的快照：${mappingError() ?? ""}`}
                      tone="danger"
                    />
                  </View>
                  <ToolButton
                    label={() => "重试"}
                    testLabel="重试读取 mapping"
                    onPress={() => void loadMapping(selected() ?? "", true)}
                  />
                </Row>
              )
            }
            {() => detailBody()}
          </View>
        )}
      </View>
    );
  }

  function listPane(): JSX.Element {
    return (
      <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <View style={{ paddingHorizontal: 10, paddingVertical: 8 }}>
          <Field
            testID="index-filter"
            value={indexFilter()}
            onChange={(value) => indexFilter.set(value)}
            placeholder="过滤索引名"
            width={278}
          />
        </View>
        {() => indexRows()}
      </View>
    );
  }

  // ---- 页面 ---------------------------------------------------------

  // 不依赖任何路由注入：keep 传 null，loadIndices 自己回退到列表第一个索引。
  void loadIndices(null, false);

  return (
    <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", backgroundColor: c.bg() }}>
      <Row wrap gap={8} style={{ paddingHorizontal: 14, paddingVertical: 10, justifyContent: "space-between" }}>
        <Row gap={8} style={{ alignItems: "center" }}>
          <Text style={t.h1}>Mapping</Text>
          {() => (selected() === null ? null : <Text style={t.meta}>{selected() ?? ""}</Text>)}
          <Text style={t.meta}>索引字段定义</Text>
        </Row>
        <Row gap={10} style={{ alignItems: "center" }}>
          <Text style={t.meta}>{updatedAt() === null ? "尚未更新" : `上次更新 ${updatedAt() ?? ""}`}</Text>
          <ToolButton
            label={() => (busy() ? "刷新中…" : "刷新")}
            testLabel="刷新"
            disabled={busy}
            primary
            onPress={() => void loadIndices(selected(), true)}
          />
        </Row>
      </Row>

      {indicesError() === null || indices().length === 0 ? null : (
        <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
          <Notice message={`刷新索引列表失败：${indicesError() ?? ""}`} tone="danger" />
        </View>
      )}

      {notice() === null ? null : (
        <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
          <Notice message={notice() ?? ""} />
        </View>
      )}

      {() => (firstLoad() ? <Loading label="正在读取索引列表…" /> : null)}
      {() => (firstError() ? <LoadError message={indicesError() ?? ""} onRetry={() => void loadIndices(selected(), true)} /> : null)}
      {() => (firstLoad() || firstError() ? null : <SplitPane width={300} left={listPane()} right={detailPane()} />)}
    </View>
  );
}

mount(MappingPage);
