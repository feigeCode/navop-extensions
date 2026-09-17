// Elasticsearch Mapping 的纯数据模型:解析、稳定 ID、路径、过滤。
//
// 这一层刻意**不 import 任何 shell 模块**(`gpui` / `gpui-base` / `navop.*`):
// 同一个文件既被 shell 页面 `mapping.js` 加载,也被 `tests/ui/mapping-model.test.mjs`
// 在 node 下直接 import。多一行 shell 依赖就会让纯函数测试跑不起来。
//
// 几条来自 ES 协议本身、不能凭 JSON 结构直觉改写的事实:
//
// 1. `GET /<index>/_mapping` 的顶层键是**具体索引名**(concrete index),
//    `mappings` 在它下面。顶层不是 `properties`;也不能假定只有一个键。
// 2. `fields` 是 multi-fields —— 同一份数据的多种索引方式,不是文档里的子对象。
// 3. `runtime` 是运行时字段,不存在于 `_source`,必须与文档字段分开标识。
// 4. 类型 `alias` 指向另一条字段路径,与索引级 alias(别名)是两回事。
// 5. `subobjects: false` 的 object 允许键里带 `.`,那是**一个**字段名本身,
//    按点号拆层级会把它拆错。所以内部身份用 JSON Pointer,不用点号路径。
// 6. `flattened` 之类的类型不会在 Mapping 里声明子字段,我们也不替它编。

/** 递归深度上限:病态 Mapping 不该把页面拖进爆栈。 */
export const MAX_FIELDS_DEPTH = 64;

/** 一次解析的字段节点预算;超限时标记 `truncated`,而不是假装完整。 */
export const MAX_FIELDS = 20000;

/** 字段来源。`property` = 文档字段,`multi-field` = 同一字段的其它索引方式,`runtime` = 运行时字段。 */
export const SOURCE_PROPERTY = "property";
export const SOURCE_MULTI_FIELD = "multi-field";
export const SOURCE_RUNTIME = "runtime";

/** 没有显式 `type`、但有 `properties` 的 object。 */
export const IMPLICIT_OBJECT_LABEL = "object(隐式)";
/** 既没有 `type` 也没有 `properties` 的声明。 */
export const UNDECLARED_TYPE_LABEL = "未声明";

/** JSON Pointer 转义(`~` 先于 `/`,顺序不能反)。 */
export function escapePointer(token) {
  return String(token).replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * 取出响应里出现过的具体索引名。
 *
 * 只认「值是对象且**声明了 `mappings` 键**」的顶层键 —— 这样 `{ "index": {...} }`
 * 形状与意外的错误信封不会被误当成索引。
 *
 * 判据是「键在不在」而不是「值真不真」:`{ "idx": { "mappings": null } }` 里的
 * 索引是**存在**的,只是没有 Mapping 内容。两种情况对用户是不同的事(「响应里没有
 * 这个索引」vs「这个索引没有 Mapping」),不能因为值恰好为 null 就并成前者。
 */
export function concreteIndices(response) {
  if (!response || typeof response !== "object") return [];
  const out = [];
  for (const key of Object.keys(response)) {
    const entry = response[key];
    if (entry && typeof entry === "object" && !Array.isArray(entry) && entry.mappings !== undefined) {
      out.push(key);
    }
  }
  return out;
}

function mappingsFor(response, index) {
  if (!response || typeof response !== "object") return null;
  if (index && response[index] && typeof response[index] === "object") {
    const entry = response[index];
    if (entry.mappings && typeof entry.mappings === "object") return entry.mappings;
  }
  return null;
}

function emptyModel(extra) {
  return Object.assign(
    {
      index: null,
      candidates: [],
      ambiguous: false,
      reason: null,
      fields: [],
      byId: new Map(),
      types: [],
      runtime: [],
      config: { dynamicTemplates: null, source: null, meta: null, metaFields: {} },
      counts: { fields: 0, runtime: 0, properties: 0, multiFields: 0, skipped: 0 },
      truncated: false,
      hasProperties: false,
    },
    extra || {},
  );
}

function makeField(parts) {
  const raw = parts.raw;
  const declared = typeof raw.type === "string" && raw.type ? raw.type : "";
  const hasProperties =
    raw.properties && typeof raw.properties === "object" && !Array.isArray(raw.properties);
  const childNames = hasProperties ? Object.keys(raw.properties) : [];
  const multiNames =
    raw.fields && typeof raw.fields === "object" && !Array.isArray(raw.fields)
      ? Object.keys(raw.fields)
      : [];
  return {
    id: parts.id,
    parentId: parts.parentId,
    name: parts.name,
    fullPath: parts.fullPath,
    pointer: parts.pointer,
    type: declared,
    displayType: declared || (hasProperties ? IMPLICIT_OBJECT_LABEL : UNDECLARED_TYPE_LABEL),
    sourceKind: parts.sourceKind,
    // `nested` 祖先保留下来:生成查询时 nested 字段必须包在同样的 nested 里,
    // 但 P0 只做展示与复制,不据此自动构造查询。
    nestedAncestors: parts.nestedAncestors,
    aliasPath: declared === "alias" && typeof raw.path === "string" ? raw.path : null,
    depth: parts.depth,
    hasChildren: childNames.length + multiNames.length > 0,
    childCount: childNames.length + multiNames.length,
    raw,
  };
}

/**
 * 把一次 `indexMapping` 响应解析成页面用的模型。
 *
 * @param response provider 原始返回(GET _mapping 的信封)。
 * @param options.index 期望的具体索引名;不传时按候选数量决定。
 *
 * 多个候选索引且没有显式指定时**不猜**:返回 `ambiguous`,由页面要求用户先选。
 * 静默取第一个会把 A 索引的字段显示成 B 索引的,比空页面更糟。
 */
export function buildMappingModel(response, options) {
  const opts = options || {};
  const candidates = concreteIndices(response);
  const requested = typeof opts.index === "string" && opts.index ? opts.index : null;

  let index = requested;
  if (!index) {
    if (candidates.length > 1) {
      return emptyModel({ candidates, ambiguous: true, reason: "multiple-indices" });
    }
    index = candidates.length === 1 ? candidates[0] : null;
  }
  if (!index) {
    return emptyModel({ candidates, reason: "no-index" });
  }

  const mappings = mappingsFor(response, index);
  if (!mappings) {
    return emptyModel({ candidates, index, reason: "no-mapping" });
  }

  const fields = [];
  const byId = new Map();
  const runtime = [];
  const metaFields = {};
  let skipped = 0;
  let truncated = false;
  let propertiesCount = 0;
  let multiFieldCount = 0;

  // 深度与预算都在**入栈处**判定:递归改成显式栈是为了让上限可执行,
  // 也为了不让「字段很深」变成整页渲染失败。
  const stack = [];
  const pushProperties = (entries, parent) => {
    // 逆序入栈 = 正序出栈,保持 Mapping 里的原始顺序(设计要求顺序稳定)。
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const [name, raw] = entries[i];
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      stack.push({ name, raw, parent });
    }
  };

  const rootProperties = Object.entries(
    mappings.properties && typeof mappings.properties === "object" && !Array.isArray(mappings.properties)
      ? mappings.properties
      : {},
  );
  pushProperties(rootProperties, null);

  while (stack.length > 0) {
    if (fields.length >= MAX_FIELDS) {
      truncated = true;
      skipped += stack.length;
      break;
    }
    const entry = stack.pop();
    const parent = entry.parent;
    const depth = parent ? parent.depth + 1 : 0;
    if (depth > MAX_FIELDS_DEPTH) {
      truncated = true;
      skipped += 1;
      continue;
    }

    // pointer 的根是**原始 mapping 对象**,不是 `properties` 那一层:runtime 字段
    // 本来就走 `/runtime/<name>`,若 properties 少一层前缀,同一份模型里就存在两套
    // 根,pointer 也无法对回它自己是从哪读出来的(方案 §5.2「指向原始 Mapping」)。
    const pointer = parent
      ? `${parent.pointer}/properties/${escapePointer(entry.name)}`
      : `/properties/${escapePointer(entry.name)}`;
    const fullPath = parent ? `${parent.fullPath}.${entry.name}` : entry.name;
    const nestedAncestors =
      parent && parent.type === "nested"
        ? parent.nestedAncestors.concat([parent.fullPath])
        : parent
          ? parent.nestedAncestors
          : [];
    const parts = {
      id: `${index} ${pointer}`,
      parentId: parent ? parent.id : null,
      name: entry.name,
      fullPath,
      pointer,
      raw: entry.raw,
      sourceKind: SOURCE_PROPERTY,
      nestedAncestors,
      depth,
    };
    const field = makeField(parts);
    propertiesCount += 1;
    fields.push(field);
    byId.set(field.id, field);

    // multi-fields 与 properties 不是同一层语义,但都是这个字段的子节点;
    // 它们的 pointer 落在 `<该字段 pointer>/fields/<名字>`,不会与 properties 撞。
    const multiEntries = Object.entries(
      entry.raw.fields && typeof entry.raw.fields === "object" && !Array.isArray(entry.raw.fields)
        ? entry.raw.fields
        : {},
    );
    for (let i = multiEntries.length - 1; i >= 0; i -= 1) {
      const [name, raw] = multiEntries[i];
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const declared = typeof raw.type === "string" && raw.type ? raw.type : "";
      const subPointer = `${pointer}/fields/${escapePointer(name)}`;
      const sub = {
        id: `${index} ${subPointer}`,
        parentId: field.id,
        name,
        fullPath: `${fullPath}.${name}`,
        pointer: subPointer,
        type: declared,
        displayType: declared || UNDECLARED_TYPE_LABEL,
        sourceKind: SOURCE_MULTI_FIELD,
        nestedAncestors: field.nestedAncestors,
        aliasPath: declared === "alias" && typeof raw.path === "string" ? raw.path : null,
        depth: depth + 1,
        hasChildren: false,
        childCount: 0,
        raw,
      };
      multiFieldCount += 1;
      fields.push(sub);
      byId.set(sub.id, sub);
    }

    // 只读 Mapping 里**声明过**的 properties。不为 flattened 之类杜撰子字段。
    const children = Object.entries(
      entry.raw.properties && typeof entry.raw.properties === "object" && !Array.isArray(entry.raw.properties)
        ? entry.raw.properties
        : {},
    );
    if (children.length > 0) {
      pushProperties(children, field);
    }
  }

  // runtime 字段是独立来源:它们没有 properties 层级,身份是名字本身。
  const runtimeDefs =
    mappings.runtime && typeof mappings.runtime === "object" && !Array.isArray(mappings.runtime)
      ? mappings.runtime
      : {};
  for (const name of Object.keys(runtimeDefs)) {
    const raw = runtimeDefs[name];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const pointer = `/runtime/${escapePointer(name)}`;
    const declared = typeof raw.type === "string" && raw.type ? raw.type : "";
    const field = {
      id: `${index} ${pointer}`,
      parentId: null,
      name,
      fullPath: name,
      pointer,
      type: declared,
      displayType: declared || UNDECLARED_TYPE_LABEL,
      sourceKind: SOURCE_RUNTIME,
      nestedAncestors: [],
      aliasPath: null,
      depth: 0,
      hasChildren: false,
      childCount: 0,
      raw,
    };
    runtime.push(field);
    fields.push(field);
    byId.set(field.id, field);
  }

  // 其余下划线开头的顶层键(`_source` / `_meta` / `_routing` / `_field_names`…)
  // 是**索引级配置**,不是文档字段,页面把它们放在「配置」区而不是字段树里。
  for (const key of Object.keys(mappings)) {
    if (key === "properties" || key === "runtime" || key === "dynamic_templates") continue;
    if (key.startsWith("_")) metaFields[key] = mappings[key];
  }

  const types = [];
  const seenTypes = new Set();
  for (const field of fields) {
    if (field.type && !seenTypes.has(field.type)) {
      seenTypes.add(field.type);
      types.push(field.type);
    }
  }
  types.sort();

  return {
    index,
    candidates,
    ambiguous: false,
    reason: null,
    fields,
    byId,
    types,
    runtime,
    config: {
      dynamicTemplates: Array.isArray(mappings.dynamic_templates)
        ? mappings.dynamic_templates
        : null,
      source: mappings._source || null,
      meta: mappings._meta || null,
      metaFields,
    },
    counts: {
      fields: fields.length,
      properties: propertiesCount,
      multiFields: multiFieldCount,
      runtime: runtime.length,
      skipped,
    },
    truncated,
    hasProperties: rootProperties.length > 0,
  };
}

/**
 * 按路径关键字 / 类型 / 来源筛选字段。
 *
 * 路径匹配是**不分大小写的子串**匹配(设计要求按完整字段路径匹配)。
 * 返回命中的 id 集合与计数;`visibleFieldIds` 再补上祖先。
 */
export function matchFields(model, filter) {
  const opts = filter || {};
  const query = String(opts.query || "").trim().toLowerCase();
  const type = opts.type || "";
  const sourceKind = opts.sourceKind || "";
  const matched = new Set();
  for (const field of model.fields) {
    if (type && field.type !== type) continue;
    if (sourceKind && field.sourceKind !== sourceKind) continue;
    if (query && !field.fullPath.toLowerCase().includes(query)) continue;
    matched.add(field.id);
  }
  return { matched, count: matched.size, total: model.fields.length };
}

/**
 * 树模式实际要渲染的 id:命中项 + 它们的祖先。
 *
 * 只留命中项会让列表里出现一堆没有路径上下文的裸字段名 —— 「命中」在树里
 * 必须看得见它属于谁。
 */
export function visibleFieldIds(model, matched) {
  const visible = new Set();
  for (const id of matched) {
    let current = model.byId.get(id);
    while (current) {
      if (visible.has(current.id)) break;
      visible.add(current.id);
      current = current.parentId ? model.byId.get(current.parentId) : null;
    }
  }
  return visible;
}

/**
 * 生成可复制的查询片段。
 *
 * 刻意只给 `simple_query_string` + 该字段:**不按类型猜** term/match/aggregation
 * ——ES 的可查询/可聚合能力要由 field caps 决定(P1),凭类型推断出来的片段
 * 看起来像能力声明,实际会在服务端报错。
 */
export function fieldQuerySnippet(field) {
  return JSON.stringify(
    {
      query: {
        simple_query_string: {
          query: "",
          fields: [field.fullPath],
        },
      },
    },
    null,
    2,
  );
}

/** 字段定义原文(只读,不重新序列化语义)。 */
export function fieldDefinitionText(field) {
  try {
    return JSON.stringify(field.raw, null, 2);
  } catch {
    return String(field.raw);
  }
}

/** 可复制的多字段摘要,用于详情区头部。 */
export function fieldSummary(field) {
  const bits = [`路径 ${field.fullPath}`, `类型 ${field.displayType}`];
  if (field.sourceKind === SOURCE_MULTI_FIELD) bits.push("来源 multi-field");
  if (field.sourceKind === SOURCE_RUNTIME) bits.push("来源 runtime");
  if (field.aliasPath) bits.push(`指向 ${field.aliasPath}`);
  if (field.nestedAncestors.length > 0) bits.push(`nested ${field.nestedAncestors.join(" > ")}`);
  return bits.join(" · ");
}

/** 字段来源的可读标签。 */
export function fieldSourceLabel(field) {
  if (field.sourceKind === SOURCE_RUNTIME) return "runtime";
  if (field.sourceKind === SOURCE_MULTI_FIELD) return "multi-field";
  return "property";
}

/**
 * 把 provider 的错误文本归类成页面能直说的状态。
 *
 * 刻意**只做文本级分类**:provider 目前把所有 SDK 错误压成同一个 IO 码
 * (`map_client_error`),HTTP 状态没有单独字段传给页面。所以这里的关键字
 * 判定是"能给出更有用的提示",不是权威判据 —— 认不出来就老老实实归到
 * `unknown` 并原样展示服务端文本,不硬猜成 403。
 *
 * 顺带一条边界:capability 缺失发生在**派发之前**(宿主按 `requires` 逐个校验),
 * 不会走到 provider,所以它的错误文本里没有 HTTP 状态,单独归成 `capability`。
 */
export function classifyMappingError(message) {
  const text = String(message || "").toLowerCase();
  if (text.includes("requires capability") || text.includes("capability")) return "capability";
  if (text.includes("index_not_found") || text.includes("no such index")) return "missing";
  if (text.includes("security_exception") || text.includes("forbidden")) return "forbidden";
  if (text.includes("timed out") || text.includes("timeout")) return "timeout";
  if (/\b403\b/.test(text)) return "forbidden";
  if (/\b404\b/.test(text)) return "missing";
  return "unknown";
}

/**
 * 把助词/动词接到目标短语后面。
 *
 * 索引名来自服务端,可能是任意西文组合(`idx-2026.09`)。中文与西文直接相邻时补
 * 一个空格(`索引 idx 的 Mapping`),两侧都是中文就不补(`该索引的 Mapping`) ——
 * 否则会挤成 `idx的` 这种读不断句的样子。
 */
function joinParticle(name, particle) {
  return /[A-Za-z0-9]$/.test(name) ? `${name} ${particle}` : `${name}${particle}`;
}

/** 归类结果 → 页面提示语。`index` 用于把提示写具体。 */
export function mappingErrorText(kind, message, index) {
  const target = index ? `索引 ${index}` : "该索引";
  switch (kind) {
    case "capability":
      return "当前连接未声明读取 Mapping 的能力（elasticsearch/index/mapping）。";
    case "forbidden":
      return `无权读取${joinParticle(target, "的")} Mapping。`;
    case "missing":
      return `${joinParticle(target, "不存在")}，可能已被删除。请刷新索引列表。`;
    case "timeout":
      return `读取${joinParticle(target, "的")} Mapping 超时。`;
    default:
      return `读取失败：${String(message || "").trim() || "未知错误"}`;
  }
}
