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

export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
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
