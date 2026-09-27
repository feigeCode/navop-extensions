// MQTT payload 分析:JSON 树形展开、相邻帧 diff。
//
// 全部是纯函数(不依赖 cx / gpui),因此可以在 node 里直接跑;UI 只负责把
// 这些行铺成组件。这里刻意不引入任何依赖:扩展页面跑在宿主的脚本运行时里,
// 打包体积与可用模块都由宿主决定,能自洽实现的解析逻辑就不要外求。

/** 单次解析/展开的规模上限:payload 可能是任意大的 JSON,不能让它拖垮页面。 */
export const MAX_JSON_CHARS = 512 * 1024;
export const MAX_TREE_ROWS = 500;
export const MAX_DIFF_LINES = 2000;

/**
 * 解析 JSON 文本。
 *
 * @returns {{ok: true, value: unknown} | {ok: false, reason: string}}
 */
export function parseJson(text) {
  const source = String(text ?? "").trim();
  if (!source) return { ok: false, reason: "内容为空" };
  if (source.length > MAX_JSON_CHARS) {
    return { ok: false, reason: `内容超过 ${Math.round(MAX_JSON_CHARS / 1024)} KB,不做 JSON 解析` };
  }
  try {
    return { ok: true, value: JSON.parse(source) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "JSON 解析失败" };
  }
}

function kindOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** 值的单行摘要(标量直出,容器给计数)。 */
export function previewOf(value) {
  const kind = kindOf(value);
  if (kind === "array") return `[ ${value.length} 项 ]`;
  if (kind === "object") {
    const keys = Object.keys(value);
    return `{ ${keys.length} 个字段 }`;
  }
  if (kind === "string") return JSON.stringify(value.length > 80 ? `${value.slice(0, 80)}…` : value);
  return String(value);
}

/**
 * 把 JSON 展平成树形行(深度优先,只展开 `expanded` 里出现的路径)。
 *
 * 返回的行是纯数据:`{ path, key, depth, kind, preview, expandable, expanded, size }`。
 * 折叠状态由调用方持有(路径 -> bool),这里只按它决定是否下钻 —— 这样
 * 刷新数据时展开状态不会丢。
 *
 * @param {unknown} value
 * @param {{path?: string, expanded?: Set<string>, limit?: number}} [options]
 */
export function flattenJson(value, options) {
  const opts = options || {};
  const expanded = opts.expanded || new Set();
  const limit = opts.limit || MAX_TREE_ROWS;
  const rows = [];
  const walk = (node, path, key, depth) => {
    if (rows.length >= limit) return;
    const kind = kindOf(node);
    const expandable = kind === "object" || kind === "array";
    const isExpanded = expandable && (depth === 0 || expanded.has(path));
    rows.push({
      path,
      key,
      depth,
      kind,
      preview: previewOf(node),
      expandable,
      expanded: isExpanded,
      size: expandable ? (kind === "array" ? node.length : Object.keys(node).length) : 0,
    });
    if (!expandable || !isExpanded) return;
    const entries = kind === "array"
      ? node.map((item, index) => [String(index), item])
      : Object.entries(node);
    for (const [childKey, childValue] of entries) {
      walk(childValue, path ? `${path}.${childKey}` : childKey, childKey, depth + 1);
      if (rows.length >= limit) return;
    }
  };
  walk(value, "", "", 0);
  return rows;
}

/** 按行切分并做基本归一化(去掉行尾 \r,保留空行位置)。 */
export function splitLines(text) {
  const lines = String(text ?? "").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

/**
 * 行级 diff(LCS 动态规划)。
 *
 * 规模设上限:payload 里的 JSON 数组动辄上万行,而 O(n·m) 的表会直接吃光内存。
 * 超过上限就退化成"整体替换"的两行摘要,而不是让页面卡死。
 *
 * @returns {{kind: "same"|"add"|"del", text: string, left?: number, right?: number}[]}
 */
export function diffLines(before, after) {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return [
      { kind: "del", text: `（差异过大:左侧 ${a.length} 行 / 右侧 ${b.length} 行,只做整体对比）` },
      { kind: "del", text: before },
      { kind: "add", text: after },
    ];
  }
  // 先剥掉公共前后缀:MQTT 的连续帧大多只在尾部变化,这一步能把 O(n·m) 压到很小。
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (
    tail < a.length - head
    && tail < b.length - head
    && a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) tail += 1;
  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);

  const rows = [];
  for (let i = 0; i < head; i += 1) rows.push({ kind: "same", text: a[i], left: i + 1, right: i + 1 });

  const n = midA.length;
  const m = midB.length;
  if (n && m && n * m <= 4_000_000) {
    // dp[i][j] = midA[i..] 与 midB[j..] 的 LCS 长度
    const dp = new Array((n + 1) * (m + 1)).fill(0);
    const at = (i, j) => i * (m + 1) + j;
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        dp[at(i, j)] = midA[i] === midB[j]
          ? dp[at(i + 1, j + 1)] + 1
          : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        rows.push({ kind: "same", text: midA[i], left: head + i + 1, right: head + j + 1 });
        i += 1;
        j += 1;
      } else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) {
        rows.push({ kind: "del", text: midA[i], left: head + i + 1 });
        i += 1;
      } else {
        rows.push({ kind: "add", text: midB[j], right: head + j + 1 });
        j += 1;
      }
    }
    for (; i < n; i += 1) rows.push({ kind: "del", text: midA[i], left: head + i + 1 });
    for (; j < m; j += 1) rows.push({ kind: "add", text: midB[j], right: head + j + 1 });
  } else {
    for (let i = 0; i < n; i += 1) rows.push({ kind: "del", text: midA[i], left: head + i + 1 });
    for (let j = 0; j < m; j += 1) rows.push({ kind: "add", text: midB[j], right: head + j + 1 });
  }

  const total = a.length;
  for (let i = 0; i < tail; i += 1) {
    const text = a[a.length - tail + i];
    rows.push({ kind: "same", text, left: total - tail + i + 1, right: b.length - tail + i + 1 });
  }
  return rows;
}

/** diff 摘要:新增/删除行数,给状态条用。 */
export function diffSummary(rows) {
  let added = 0;
  let removed = 0;
  for (const row of rows || []) {
    if (row.kind === "add") added += 1;
    else if (row.kind === "del") removed += 1;
  }
  return { added, removed };
}

/**
 * 从文本里提取单个数值:用于把数值型 payload 画成趋势。
 *
 * 支持裸数字(`23.5`)与简单 JSON(`{"temp": 23.5}` → 取 path 指定的字段)。
 * 返回 null 表示"这不是一个可绘制的数值样本"。
 */
export function numericSample(text, path) {
  const source = String(text ?? "").trim();
  if (!source) return null;
  if (!path) {
    const bare = Number(source);
    return Number.isFinite(bare) ? bare : null;
  }
  const parsed = parseJson(source);
  if (!parsed.ok) return null;
  let node = parsed.value;
  for (const key of path.split(".")) {
    if (node == null || typeof node !== "object") return null;
    node = node[key];
  }
  const value = Number(node);
  return Number.isFinite(value) ? value : null;
}
