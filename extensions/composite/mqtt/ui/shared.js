// MQTT 工作台页面共享工具:payload 编解码、时间格式化、通用 UI 片段。
import { Buffer } from "buffer";
import { div } from "gpui";
import { h_flex, v_flex } from "gpui-base";
import { Button, Spinner } from "gpui-component";

export const QOS_OPTIONS = [
  { id: "0", label: "QoS 0 · At most once" },
  { id: "1", label: "QoS 1 · At least once" },
  { id: "2", label: "QoS 2 · Exactly once" },
];

export const FORMAT_OPTIONS = [
  { id: "text", label: "Text" },
  { id: "json", label: "JSON" },
  { id: "hex", label: "Hex" },
  { id: "base64", label: "Base64" },
];

export function qosLabel(value) {
  const found = QOS_OPTIONS.find((option) => option.id === String(value));
  return found ? found.label : `QoS ${value}`;
}

/** 消息 properties 为 [[k, v]] 数组,转成对象便于取值。 */
export function props(message) {
  const out = {};
  for (const entry of message?.properties || []) {
    if (Array.isArray(entry) && entry.length === 2) out[entry[0]] = entry[1];
  }
  return out;
}

/** 编辑器文本 -> 发送字节数组;format 决定解释方式。失败抛 Error。 */
export function encodePayload(text, format) {
  switch (format) {
    case "hex": {
      const clean = text.replace(/[\s:,]/g, "");
      if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
        throw new Error("Hex 内容必须是偶数长度的 0-9a-f 字符");
      }
      return Array.from(Buffer.from(clean, "hex"));
    }
    case "base64": {
      if (text.trim() && !/^[A-Za-z0-9+/=\s]+$/.test(text)) throw new Error("Base64 内容非法");
      return Array.from(Buffer.from(text.trim(), "base64"));
    }
    case "json": {
      JSON.parse(text);
      return Array.from(Buffer.from(text, "utf8"));
    }
    default:
      return Array.from(Buffer.from(text, "utf8"));
  }
}

/** 消息 -> 按 format 展示的文本。body 为字节数组(历史查询),body_text 为 UTF-8 文本。 */
export function decodePayload(message, format) {
  const bytes = Array.isArray(message.body) ? Buffer.from(message.body) : null;
  const text = message.body_text ?? (bytes ? bytes.toString("utf8") : "");
  switch (format) {
    case "hex":
      return bytes ? formatHex(bytes) : formatHex(Buffer.from(text, "utf8"));
    case "base64":
      return (bytes || Buffer.from(text, "utf8")).toString("base64");
    case "json":
      try {
        return JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        return text;
      }
    default:
      if (message.body_text == null && bytes) return `<binary ${bytes.length} bytes>`;
      return text;
  }
}

function formatHex(bytes) {
  const lines = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const chunk = bytes.subarray(offset, offset + 16);
    const hex = Array.from(chunk, (b) => b.toString(16).padStart(2, "0")).join(" ");
    lines.push(`${offset.toString(16).padStart(6, "0")}  ${hex}`);
  }
  return lines.join("\n");
}

export function payloadSize(message) {
  if (Array.isArray(message.body)) return message.body.length;
  return Buffer.from(message.body_text || "", "utf8").length;
}

export function humanBytes(n) {
  if (!Number.isFinite(n)) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatTime(message) {
  const ms = Number(props(message).received_at_ms);
  if (Number.isFinite(ms)) {
    const date = new Date(ms);
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    const mss = String(date.getMilliseconds()).padStart(3, "0");
    return `${hh}:${mm}:${ss}.${mss}`;
  }
  return message.store_time || "-";
}

/** MQTT 主题过滤器匹配(`+` 单层、`#` 多层)。 */
export function topicMatches(filter, topic) {
  if (!filter || filter === "#") return true;
  const f = filter.split("/");
  const t = topic.split("/");
  for (let i = 0; i < f.length; i += 1) {
    if (f[i] === "#") return true;
    if (i >= t.length) return false;
    if (f[i] !== "+" && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

export function isValidFilter(filter) {
  if (!filter) return false;
  const parts = filter.split("/");
  return parts.every((part, index) => {
    if (part === "#") return index === parts.length - 1;
    if (part === "+") return true;
    return !part.includes("#") && !part.includes("+");
  });
}

/** 结构化错误 envelope 的标记(见 shell_plugin_host/error.rs)。 */
const ERROR_ENVELOPE = "__NAVOP_ERROR__";

/** provider 被宿主重启/传输断开时,错误里会出现这些特征。 */
const TRANSIENT_CODES = ["RUNTIME_UNAVAILABLE", "STALE_HANDLE", "EXTENSION_UNLOADED"];
const TRANSIENT_PATTERN = /rpc client is (closed|unavailable)|provider call failed|transport|broken pipe|connection reset/i;

/**
 * 解析工作台抛出的错误。
 *
 * 宿主把结构化错误挂在 message 尾部(`...__NAVOP_ERROR__<base64url>`),直接
 * 渲染就会在页面上出现一长串 base64 —— 用户看不懂,真正的错误码也被淹没。
 * 这里把它解回 `{code, message}`,并判定是否为「provider 被重启」这类可自愈错误。
 */
export function parseError(error) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  let code = typeof error?.code === "string" ? error.code : null;
  let message = raw;
  const marker = raw.indexOf(ERROR_ENVELOPE);
  if (marker >= 0) {
    const encoded = raw.slice(marker + ERROR_ENVELOPE.length).trim().split(/[^A-Za-z0-9\-_+/=]/)[0];
    let decoded = null;
    try {
      decoded = JSON.parse(
        Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
      );
    } catch {
      decoded = null;
    }
    if (decoded && typeof decoded.message === "string") {
      message = decoded.message;
      if (typeof decoded.code === "string") code = decoded.code;
    } else {
      // 解不开也别把 base64 甩给用户
      message = raw.slice(0, marker).trim() || "操作失败(错误详情无法解析)";
    }
  }
  const transient = (code != null && TRANSIENT_CODES.includes(code)) || TRANSIENT_PATTERN.test(message)
    // 宿主现在把「provider 调用失败且运行时已不在」映射成可重试的
    // RUNTIME_UNAVAILABLE(见 navop 侧 WorkbenchDispatchError::ProviderUnavailable)。
    // 这一条文本兜底留给旧宿主:它们把同一件事笼统报成 PROTOCOL_ERROR。
    || (code === "PROTOCOL_ERROR" && /closed|unavailable/i.test(message));
  return { code, message: cleanMessage(message), transient };
}

/** 去掉宿主加的前缀,只留人能读的部分。 */
function cleanMessage(message) {
  return String(message)
    .replace(/^navop\.workbench\.dispatch:\s*/, "")
    .replace(/^provider call failed:\s*/, "")
    .trim();
}

/** 面向用户的错误文本(已剥离 envelope)。 */
export function errorMessage(error) {
  return parseError(error).message;
}

/** 是否为「provider 被重启/连接断开」这类可自愈错误。 */
export function isTransientError(error) {
  return parseError(error).transient;
}

// 颜色一律从主题读(`cx.theme().colors.*`):shell 只接受 #rgb/#rrggbb/#rrggbbaa
// 字面量,`text_color("muted")` 这类 token 名会在渲染时报
// "`muted` is not a color value" 并整页渲染失败。下面每个helper 都要
// 渲染上下文的 `cx`,别把颜色名写回字符串。

export function loadingView(cx, text) {
  return v_flex().size_full().items_center().justify_center().gap(8)
    .child(new Spinner().size("medium"))
    .child(div().text_color(cx.theme().colors.muted_foreground).child(text));
}

export function errorView(cx, id, text, retry) {
  return v_flex().size_full().p(16).gap(8)
    .child(div().text_color(cx.theme().colors.destructive).child(text))
    .child(new Button(id).label("重试").on_click((_e, cx) => cx.spawn(async (cx) => retry(cx))));
}

/**
 * 内联状态条:`action` 给出时右侧带一个按钮(退避重试 / 确认操作)。
 *
 * `children([...])` 而不是条件式链式调用:banner 里的按钮是可选的,而构建器
 * 只能在末尾追加,不能中途分支。
 */
export function banner(cx, text, options) {
  const opts = options || {};
  return h_flex().items_center().gap(8).px(10).py(6).border_1().rounded(6).min_w_0()
    .child(div().flex_1().min_w_0().text_size(12).text_ellipsis()
      .text_color(opts.error ? cx.theme().colors.destructive : cx.theme().colors.muted_foreground)
      .child(text))
    .children(opts.action ? [new Button(opts.id || "mqtt-banner-action").ghost().size("small").flex_shrink_0()
      .label(opts.action.label)
      .on_click((_e, cx) => opts.action.on_click(cx))] : []);
}

/**
 * 轮询型页面共用的状态条。
 *
 * 分三类:provider 断开(自动退避重连,不需用户动)、不可自愈的错误(已停止轮询,
 * 需要一个手动重试)、换代提示。错误已由 parseError 剥掉 base64 envelope。
 */
export function feedBanner(cx, feed) {
  if (feed.error) {
    return [banner(cx, `${feed.errorTransient ? "连接中断" : "轮询失败"}: ${feed.error}`, {
      error: true,
      action: feed.halted
        ? {
            id: "mqtt-feed-retry",
            label: "重试",
            on_click: (cx) => cx.spawn(async (cx) => feed.retry(cx)),
          }
        : null,
    })];
  }
  return feed.notice ? [banner(cx, feed.notice, {})] : [];
}

export function card(cx, label, value, hint) {
  return v_flex().p(12).gap(4).border_1().rounded(6).min_w(150).flex_1()
    .child(div().text_color(cx.theme().colors.muted_foreground).text_size(12).child(label))
    .child(div().text_size(20).font_semibold().child(String(value)))
    .children(hint ? [div().text_color(cx.theme().colors.muted_foreground).text_size(11).child(hint)] : []);
}

export function kv(cx, label, value) {
  return h_flex().gap(8).items_start()
    .child(div().w(110).flex_shrink_0().text_color(cx.theme().colors.muted_foreground).text_size(12).child(label))
    .child(div().flex_1().min_w_0().text_size(12).child(String(value ?? "-")));
}
