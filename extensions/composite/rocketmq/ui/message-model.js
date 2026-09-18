// RocketMQ 消息查询的纯逻辑层:查询模式、时间输入解析、请求载荷构造、消息整形。
//
// 这一层刻意**不** import gpui / gpui-base:它与 `<ext>/tests/ui/*.test.mjs`
// 一起被 `node --test` 直接执行(仓级守卫 scripts.test.mjs 会真正跑这些用例),
// 一旦引入 shell 侧依赖,测试在 node 里会直接模块解析失败。

/** 消息查询的三种模式,对应 `MessageQuery` 的三个 tagged 变体。 */
export const QUERY_MODES = [
  { id: "time", label: "时间窗口" },
  { id: "key", label: "Message Key" },
  { id: "id", label: "Message ID" },
];

/** 时间窗口的预设跨度;`custom` 表示手填起止时间。 */
export const TIME_PRESETS = [
  { id: "10m", label: "最近 10 分钟", ms: 10 * 60 * 1000 },
  { id: "1h", label: "最近 1 小时", ms: 60 * 60 * 1000 },
  { id: "1d", label: "最近 1 天", ms: 24 * 60 * 60 * 1000 },
  { id: "7d", label: "最近 7 天", ms: 7 * 24 * 60 * 60 * 1000 },
  { id: "custom", label: "自定义区间", ms: 0 },
];

/** 时间窗口模式的页大小候选(`MessageQuery::ByTimeWindow.page_size`)。 */
export const PAGE_SIZES = [10, 20, 50];

// 1973-03-03 之前的毫秒值必然是误填 —— 最常见的是把 Unix **秒**当毫秒填。
const MILLISECOND_FLOOR = 100_000_000_000;

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function presetById(id) {
  return TIME_PRESETS.find((preset) => preset.id === id) || TIME_PRESETS[0];
}

/** 预设跨度 → 绝对时间窗口。 */
export function presetWindow(presetId, now) {
  const preset = presetById(presetId);
  return { beginMs: now - preset.ms, endMs: now };
}

/**
 * 时间输入解析:接受 Unix 毫秒或 `YYYY-MM-DD HH:mm[:ss]`(本地时间)。
 *
 * 空输入返回 `fallback`(交给调用方决定是"当前时刻"还是"必须填写");
 * 非法输入**抛错而不是静默回落** —— 重置消费位点这类写操作上,
 * 静默把非法时间当成"当前时刻"会让用户以为回放了历史,实际跳过了全部积压。
 */
export function parseTimeInput(text, fallback = null) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return fallback;

  if (/^\d+$/.test(trimmed)) {
    const ms = Number(trimmed);
    if (!Number.isSafeInteger(ms)) {
      throw new Error(`时间戳超出范围: ${trimmed}`);
    }
    if (ms < MILLISECOND_FLOOR) {
      throw new Error(`时间戳 ${trimmed} 看起来是 Unix 秒或非法值,请填毫秒(13 位)`);
    }
    return ms;
  }

  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) {
    throw new Error(`时间格式非法: ${trimmed}(用 YYYY-MM-DD HH:mm 或 Unix 毫秒)`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? "0");
  const date = new Date(year, month - 1, day, hour, minute, second, 0);
  // Date 会把 2 月 30 日这类不存在的日期静默滚到下个月,回读比对才能挡住。
  const drifted =
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second;
  if (drifted) {
    throw new Error(`时间不存在: ${trimmed}`);
  }
  return date.getTime();
}

/** Unix 毫秒 → `YYYY-MM-DD HH:mm:ss`(本地时间)。 */
export function formatMillis(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value)) return "-";
  const date = new Date(value);
  const pad = (n, width = 2) => String(n).padStart(width, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/** 结果区展示用:优先 `store_time`,其次 `born_time`。 */
export function messageTime(message) {
  return message?.store_time || message?.born_time || "-";
}

/** `properties` 的序列化形态是 `[[k, v], ...]`。 */
export function messageProperties(message) {
  const out = [];
  for (const entry of message?.properties || []) {
    if (Array.isArray(entry) && entry.length === 2) out.push([String(entry[0]), String(entry[1])]);
  }
  return out;
}

/** 消息体文本;实时/历史事件可能只给 `body_text`,原始字节在 `body`。 */
export function bodyText(message) {
  if (message?.body_text != null && message.body_text !== "") return String(message.body_text);
  if (Array.isArray(message?.body)) return `<二进制消息体 ${message.body.length} B>`;
  return "";
}

export function previewOf(message, limit = 160) {
  const text = bodyText(message).replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…`;
}

export function shortId(id, head = 10, tail = 6) {
  const text = String(id ?? "");
  if (text.length <= head + tail + 1) return text;
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
}

/**
 * 查询模式 + 表单字段 → `{ operation, input }`。
 *
 * `operation` 是工作台里已声明的操作 id(`queryByTimeWindow` / `queryByKey` / `queryById`),
 * 三者的 `params` 各自绑定到同一个资源方法 `middleware/message/query` 的不同变体上
 * —— 因为操作的 params 是静态映射,没法在运行期按输入切换变体。
 *
 * 校验失败抛 Error:调用方把消息直接显示给用户。
 */
export function buildQuery(mode, fields = {}, now = Date.now()) {
  const topic = String(fields.topic ?? "").trim();
  if (!topic) throw new Error("请先填写 Topic");

  if (mode === "key") {
    const key = String(fields.key ?? "").trim();
    if (!key) throw new Error("请填写 Message Key");
    return { operation: "queryByKey", input: { ByKey: { topic, key } } };
  }

  if (mode === "id") {
    const messageId = String(fields.messageId ?? "").trim();
    if (!messageId) throw new Error("请填写 Message ID");
    return { operation: "queryById", input: { ById: { topic, message_id: messageId } } };
  }

  const page = Math.max(1, Math.trunc(Number(fields.page)) || 1);
  const rawSize = Number(fields.pageSize);
  const pageSize = PAGE_SIZES.includes(rawSize) ? rawSize : PAGE_SIZES[1];

  let beginMs;
  let endMs;
  if (String(fields.preset ?? "") === "custom") {
    beginMs = parseTimeInput(fields.begin, null);
    endMs = parseTimeInput(fields.end, now);
    if (beginMs == null) throw new Error("自定义区间需要填写开始时间");
  } else {
    ({ beginMs, endMs } = presetWindow(fields.preset, now));
  }
  if (beginMs > endMs) throw new Error("开始时间必须早于结束时间");

  return {
    operation: "queryByTimeWindow",
    input: {
      ByTimeWindow: { topic, begin_unix_ms: beginMs, end_unix_ms: endMs, page, page_size: pageSize },
    },
  };
}
