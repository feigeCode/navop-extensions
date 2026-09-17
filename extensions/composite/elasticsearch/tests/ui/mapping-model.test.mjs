// mapping-model 的纯函数测试。
//
// 这一层是 Mapping 页面的全部语义所在(解析、身份、路径、筛选、错误归类),
// 所以它必须能在 node 下直接跑 —— `ui/mapping-model.js` 不 import 任何 shell
// 模块,这也是为什么解析没有写在 `ui/mapping.js` 里。
//
// 用例中的 payload 都按 ES 真实响应形状写:顶层是**具体索引名**,`mappings` 在其下。
import assert from "node:assert/strict";
import test from "node:test";

import {
  IMPLICIT_OBJECT_LABEL,
  MAX_FIELDS,
  MAX_FIELDS_DEPTH,
  SOURCE_MULTI_FIELD,
  SOURCE_PROPERTY,
  SOURCE_RUNTIME,
  UNDECLARED_TYPE_LABEL,
  buildMappingModel,
  classifyMappingError,
  concreteIndices,
  escapePointer,
  fieldQuerySnippet,
  matchFields,
  mappingErrorText,
  visibleFieldIds,
} from "../../ui/mapping-model.js";

/** 单个具体索引的信封:`{ "<index>": { "mappings": {...} } }`。 */
function envelope(index, mappings) {
  return { [index]: { mappings } };
}

function fieldsByPath(model) {
  const out = new Map();
  for (const field of model.fields) out.set(field.fullPath, field);
  return out;
}

test("envelope is read through the concrete index key, not the top level", () => {
  const response = envelope("orders-v1", {
    properties: {
      user: { properties: { name: { type: "text" }, age: { type: "integer" } } },
    },
  });
  const model = buildMappingModel(response);
  assert.deepEqual(concreteIndices(response), ["orders-v1"]);
  assert.equal(model.index, "orders-v1");
  assert.equal(model.ambiguous, false);
  assert.equal(model.hasProperties, true);
  const byPath = fieldsByPath(model);
  assert.equal(byPath.get("user").type, "");
  assert.equal(byPath.get("user").displayType, IMPLICIT_OBJECT_LABEL);
  assert.equal(byPath.get("user.name").type, "text");
  assert.equal(byPath.get("user.age").type, "integer");
  assert.equal(byPath.get("user.name").parentId, byPath.get("user").id);
});

test("multiple concrete indices are never resolved by picking the first", () => {
  const response = {
    "logs-2026.08": { mappings: { properties: { a: { type: "text" } } } },
    "logs-2026.09": { mappings: { properties: { b: { type: "keyword" } } } },
  };
  const model = buildMappingModel(response);
  assert.equal(model.ambiguous, true);
  assert.equal(model.reason, "multiple-indices");
  assert.deepEqual(model.candidates, ["logs-2026.08", "logs-2026.09"]);
  assert.equal(model.fields.length, 0);

  // 显式指定之后才能解析,且只解析那一个。
  const chosen = buildMappingModel(response, { index: "logs-2026.09" });
  assert.equal(chosen.index, "logs-2026.09");
  assert.deepEqual(
    chosen.fields.map((field) => field.fullPath),
    ["b"],
  );
});

test("nested fields carry their nested ancestors", () => {
  const model = buildMappingModel(
    envelope("orders", {
      properties: {
        items: {
          type: "nested",
          properties: {
            sku: { type: "keyword" },
            attrs: { type: "nested", properties: { k: { type: "keyword" } } },
          },
        },
      },
    }),
  );
  const byPath = fieldsByPath(model);
  assert.deepEqual(byPath.get("items.sku").nestedAncestors, ["items"]);
  assert.deepEqual(byPath.get("items.attrs.k").nestedAncestors, ["items", "items.attrs"]);
});

test("multi-fields are a separate source, not children of the document field", () => {
  const model = buildMappingModel(
    envelope("idx", {
      properties: {
        city: {
          type: "text",
          fields: { raw: { type: "keyword", ignore_above: 256 } },
        },
      },
    }),
  );
  const byPath = fieldsByPath(model);
  const raw = byPath.get("city.raw");
  assert.equal(raw.sourceKind, SOURCE_MULTI_FIELD);
  assert.equal(raw.type, "keyword");
  assert.equal(raw.parentId, byPath.get("city").id);
  assert.equal(raw.pointer, "/properties/city/fields/raw");
  // multi-field 没有自己的子节点,也不是 properties 的孩子。
  assert.equal(raw.hasChildren, false);
});

test("runtime fields are identified separately and addressable by name", () => {
  const model = buildMappingModel(
    envelope("idx", {
      properties: { base: { type: "keyword" } },
      runtime: {
        day_of_week: { type: "keyword", script: { source: "emit(...)" } },
        unnamed: { script: { source: "emit(1)" } },
      },
    }),
  );
  assert.equal(model.runtime.length, 2);
  const byPath = fieldsByPath(model);
  assert.equal(byPath.get("day_of_week").sourceKind, SOURCE_RUNTIME);
  assert.equal(byPath.get("day_of_week").fullPath, "day_of_week");
  assert.equal(byPath.get("day_of_week").pointer, "/runtime/day_of_week");
  // 没有显式 type 的 runtime 字段也要如实说"未声明",不猜成 keyword。
  assert.equal(byPath.get("unnamed").displayType, UNDECLARED_TYPE_LABEL);
  assert.equal(byPath.get("unnamed").type, "");
});

test("alias fields expose their target path and stay distinct from index aliases", () => {
  const model = buildMappingModel(
    envelope("idx", {
      properties: {
        real: { type: "keyword" },
        shortcut: { type: "alias", path: "real" },
      },
    }),
  );
  const alias = fieldsByPath(model).get("shortcut");
  assert.equal(alias.type, "alias");
  assert.equal(alias.aliasPath, "real");
  assert.equal(fieldsByPath(model).get("real").aliasPath, null);
});

test("index-level configuration stays out of the field tree", () => {
  const model = buildMappingModel(
    envelope("idx", {
      properties: { a: { type: "keyword" } },
      dynamic_templates: [{ strings: { match_mapping_type: "string", mapping: { type: "keyword" } } }],
      _source: { enabled: false },
      _meta: { owner: "team-search" },
      _routing: { required: true },
    }),
  );
  assert.equal(model.config.dynamicTemplates.length, 1);
  assert.equal(model.config.source.enabled, false);
  assert.equal(model.config.meta.owner, "team-search");
  assert.equal(model.config.metaFields._routing.required, true);
  assert.deepEqual(
    model.fields.map((field) => field.fullPath),
    ["a"],
  );
});

test("subobjects:false dotted names stay one field instead of being split", () => {
  const model = buildMappingModel(
    envelope("idx", {
      properties: {
        labels: {
          type: "object",
          subobjects: false,
          properties: { "app.name": { type: "keyword" }, "app.version": { type: "keyword" } },
        },
      },
    }),
  );
  const byPath = fieldsByPath(model);
  // 点号是**名字的一部分**:层级只有 labels → "app.name" 一层。
  assert.ok(byPath.has("labels.app.name"));
  assert.equal(byPath.get("labels.app.name").name, "app.name");
  assert.equal(byPath.get("labels.app.name").parentId, byPath.get("labels").id);
  assert.equal(byPath.get("labels.app.name").depth, 1);
  assert.equal(model.fields.some((field) => field.fullPath === "labels.app"), false);
});

test("pointer escaping keeps / and ~ addressable", () => {
  assert.equal(escapePointer("a/b"), "a~1b");
  assert.equal(escapePointer("a~b"), "a~0b");
  const model = buildMappingModel(
    envelope("idx", {
      properties: { "a/b": { type: "keyword" }, "c~d": { type: "keyword" } },
    }),
  );
  assert.deepEqual(
    model.fields.map((field) => field.pointer),
    ["/properties/a~1b", "/properties/c~0d"],
  );
  // id 是 concrete index + 原始 pointer:两套身份不能塌成 dotted path。
  assert.equal(model.fields[0].id, "idx /properties/a~1b");
});

test("flattened fields do not get invented children", () => {
  const model = buildMappingModel(
    envelope("idx", { properties: { payload: { type: "flattened" } } }),
  );
  const payload = fieldsByPath(model).get("payload");
  assert.equal(payload.type, "flattened");
  assert.equal(payload.hasChildren, false);
  assert.equal(model.fields.length, 1);
});

test("unknown types keep the server string verbatim", () => {
  const model = buildMappingModel(
    envelope("idx", { properties: { future: { type: "some_future_type", extra: 1 } } }),
  );
  const field = fieldsByPath(model).get("future");
  assert.equal(field.type, "some_future_type");
  assert.equal(field.displayType, "some_future_type");
  assert.equal(field.raw.extra, 1);
});

test("declaration order is preserved and ids are stable across runs", () => {
  const response = envelope("idx", {
    properties: {
      z: { type: "keyword" },
      a: { type: "keyword" },
      m: { properties: { b: { type: "keyword" } } },
    },
  });
  const first = buildMappingModel(response);
  const second = buildMappingModel(response);
  assert.deepEqual(
    first.fields.map((field) => field.fullPath),
    ["z", "a", "m", "m.b"],
  );
  assert.deepEqual(
    first.fields.map((field) => field.id),
    second.fields.map((field) => field.id),
  );
});

test("deep nesting is bounded instead of overflowing the stack", () => {
  let node = { type: "keyword" };
  for (let i = 0; i < MAX_FIELDS_DEPTH + 8; i += 1) {
    node = { properties: { [`l${i}`]: node } };
  }
  const model = buildMappingModel(envelope("idx", { properties: { root: node } }));
  assert.equal(model.truncated, true);
  assert.ok(model.counts.skipped > 0);
  assert.ok(model.fields.length <= MAX_FIELDS_DEPTH + 2);
});

test("no properties still yields runtime fields and config", () => {
  const model = buildMappingModel(
    envelope("idx", { runtime: { r: { type: "keyword" } }, dynamic_templates: [] }),
  );
  assert.equal(model.hasProperties, false);
  assert.equal(model.counts.properties, 0);
  assert.equal(model.runtime.length, 1);
});

test("filtering matches the full path case-insensitively and keeps ancestors", () => {
  const model = buildMappingModel(
    envelope("idx", {
      properties: {
        user: {
          properties: { Name: { type: "text" }, age: { type: "integer" } },
        },
        other: { type: "keyword" },
      },
    }),
  );
  const { matched, count, total } = matchFields(model, { query: "user.na" });
  assert.equal(count, 1);
  assert.equal(total, model.fields.length);
  const visible = visibleFieldIds(model, matched);
  const byPath = fieldsByPath(model);
  assert.ok(visible.has(byPath.get("user.Name").id));
  // 祖先必须在:否则命中项在树里没有路径可读。
  assert.ok(visible.has(byPath.get("user").id));
  assert.equal(visible.has(byPath.get("other").id), false);

  const typed = matchFields(model, { type: "integer" });
  assert.equal(typed.count, 1);
  assert.ok(typed.matched.has(byPath.get("user.age").id));

  // 空筛选 = 全部命中(页面据此区分"未筛选"与"无匹配")。
  assert.equal(matchFields(model, {}).count, model.fields.length);
});

test("query snippet only claims the field, not a capability", () => {
  const model = buildMappingModel(
    envelope("idx", { properties: { "a/b": { type: "text" } } }),
  );
  const snippet = fieldQuerySnippet(model.fields[0]);
  const parsed = JSON.parse(snippet);
  assert.deepEqual(parsed, {
    query: { simple_query_string: { query: "", fields: ["a/b"] } },
  });
  assert.equal(snippet.includes("term"), false);
  assert.equal(snippet.includes("aggs"), false);
});

test("error classification separates capability, forbidden, missing and timeout", () => {
  assert.equal(classifyMappingError("operation requires capability x"), "capability");
  assert.equal(
    classifyMappingError("Elasticsearch SDK request failed: security_exception"),
    "forbidden",
  );
  assert.equal(classifyMappingError("... index_not_found_exception ..."), "missing");
  assert.equal(classifyMappingError("HTTP 404 Not Found"), "missing");
  assert.equal(classifyMappingError("operation timed out"), "timeout");
  assert.equal(classifyMappingError("something else entirely"), "unknown");
  // 认不出来时保留服务端原文,不硬猜成权限问题。
  assert.equal(
    mappingErrorText("unknown", "boom", "idx"),
    "读取失败：boom",
  );
  assert.equal(
    mappingErrorText("forbidden", "boom", "idx"),
    "无权读取索引 idx 的 Mapping。",
  );
});

test("a payload that is not a mapping envelope is reported, not guessed", () => {
  assert.deepEqual(concreteIndices(null), []);
  assert.equal(buildMappingModel({ error: { type: "x" } }).reason, "no-index");
  assert.equal(buildMappingModel({ idx: { settings: {} } }).reason, "no-index");
  assert.equal(buildMappingModel({ idx: { mappings: null } }).reason, "no-mapping");
  assert.equal(buildMappingModel(null, { index: "idx" }).reason, "no-mapping");
});

test("property source kind is the default for document fields", () => {
  const model = buildMappingModel(
    envelope("idx", { properties: { a: { type: "keyword" } } }),
  );
  assert.equal(model.fields[0].sourceKind, SOURCE_PROPERTY);
});
