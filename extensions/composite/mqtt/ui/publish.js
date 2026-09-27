// MQTT 消息发布:主题、QoS、Retain、多格式 payload、历史重发。
import { Buffer } from "buffer";
import { View, div } from "gpui";
import { h_flex, v_flex, InputState, TextareaState } from "gpui-base";
import { Button, Input, Select, Switch, Tag, Textarea } from "gpui-component";
import { dispatch } from "navop.workbench";
import {
  FORMAT_OPTIONS, QOS_OPTIONS, banner, encodePayload, errorMessage, humanBytes, qosLabel,
} from "./shared.js";

const HISTORY_LIMIT = 20;

/**
 * 单条 payload 上限(发送前拦截)。
 *
 * provider 侧的硬上限是 2 MiB(见 admin.rs::MQTT_MAX_PUBLISH_BYTES)。这里收到
 * 1 MiB 是因为 payload 以字节数组走 JSON:1 字节最坏膨胀成 4 个字符,再叠加
 * 帧头与转义,单帧必须留在宿主 16 MiB 的帧上限内。超限在 UI 就拦下并说明原因,
 * 比让宿主判成协议错误、把整条 IPC 连接带走要好得多。
 */
const MAX_PAYLOAD_BYTES = 1024 * 1024;
/** 超过这个大小给出提示:大 payload 会明显放大 IPC 帧。 */
const LARGE_PAYLOAD_BYTES = 256 * 1024;

/** payload 的字节数估算(与 encodePayload 同口径,但不物化数组)。 */
function estimateBytes(text, format) {
  switch (format) {
    case "hex": {
      const clean = text.replace(/[\s:,]/g, "");
      return /^[0-9a-fA-F]*$/.test(clean) && clean.length % 2 === 0 ? clean.length / 2 : 0;
    }
    case "base64":
      return Math.floor(text.trim().length * 3 / 4);
    default:
      return Buffer.byteLength(text, "utf8");
  }
}

export default class MqttPublish extends View {
  init(_props, _cx) {
    this.topic = InputState.new({ value: "", placeholder: "目标主题(不能含 + / # 通配符)" });
    this.body = TextareaState.new({ value: "", placeholder: "消息内容", rows: 8 });
    this.qos = "1";
    this.retain = false;
    this.format = "text";
    this.busy = false;
    this.status = null;
    this.statusError = false;
    /** 大 payload 的二次确认状态(见 publish());存放被确认的 topic+长度。 */
    this.armed = null;
    this.history = [];
  }

  async publish(cx) {
    const topic = this.topic.value().trim();
    if (!topic || topic.includes("+") || topic.includes("#")) {
      this.fail("主题不能为空且不能包含通配符 `+`/`#`", cx);
      return;
    }
    let body;
    try {
      body = encodePayload(this.body.value(), this.format);
    } catch (error) {
      this.fail(errorMessage(error), cx);
      return;
    }
    if (body.length > MAX_PAYLOAD_BYTES) {
      this.fail(
        `消息体 ${humanBytes(body.length)} 超过单条上限 ${humanBytes(MAX_PAYLOAD_BYTES)}`
        + `(MQTT payload 以字节数组走 IPC,过大会撑爆宿主帧上限并把连接断开)。`
        + `请改用 Base64/Hex 之外的传输方式,或拆成多条发送。`,
        cx,
      );
      return;
    }
    // 大 payload 是"会伤连接"的操作:第一次点击只做预告,第二次才真发。
    // 小消息保持单击直发 —— 给日常发消息加二次确认只会变成噪音。
    const arming = `${topic}\u0000${body.length}`;
    if (body.length > LARGE_PAYLOAD_BYTES && this.armed !== arming) {
      this.armed = arming;
      this.status = `内容约 ${humanBytes(body.length)},体积偏大;再点一次「确认发布」发送到 ${topic}`;
      this.statusError = false;
      cx.notify();
      return;
    }
    this.armed = null;
    this.busy = true;
    this.status = "发布中…";
    this.statusError = false;
    cx.notify();
    try {
      // 「发布」按钮即确认交互(用户明确点按);宿主对写操作要求 confirmed。
      const result = await dispatch("publish", {
        topic,
        body,
        properties: [["qos", this.qos], ["retain", this.retain ? "true" : "false"]],
      }, { confirmed: true });
      this.status = `已发布到 ${topic} · ${humanBytes(body.length)} · ${result?.message_id || ""}`;
      this.pushHistory({ topic, text: this.body.value(), format: this.format, qos: this.qos, retain: this.retain });
    } catch (error) {
      this.fail(`发布失败: ${errorMessage(error)}`, cx);
    }
    this.busy = false;
    cx.notify();
  }

  fail(text, cx) {
    this.status = text;
    this.statusError = true;
    this.busy = false;
    cx.notify();
  }

  /**
   * 发送前的体积检查(不物化字节数组:每次渲染都调用,大文本下 Array.from
   * 会拖慢输入)。
   */
  sizeHint(cx) {
    const size = estimateBytes(this.body.value(), this.format);
    if (size > MAX_PAYLOAD_BYTES) {
      return banner(cx, `当前内容约 ${humanBytes(size)}:超过单条上限 ${humanBytes(MAX_PAYLOAD_BYTES)},发布会被拒绝`, { error: true });
    }
    if (size > LARGE_PAYLOAD_BYTES) {
      return banner(cx, `当前内容约 ${humanBytes(size)}:体积偏大,发送会放大 IPC 帧`, {});
    }
    return null;
  }

  pushHistory(entry) {
    const key = JSON.stringify(entry);
    const rest = this.history.filter((item) => JSON.stringify(item) !== key);
    this.history = [entry, ...rest].slice(0, HISTORY_LIMIT);
  }

  restore(entry, cx) {
    this.topic.set_value(entry.topic);
    this.body.set_value(entry.text);
    this.format = entry.format;
    this.qos = entry.qos;
    this.retain = entry.retain;
    cx.notify();
  }

  historyRow(cx, entry, index) {
    return h_flex().items_center().gap(8).px(8).py(4).border_b_1().cursor_pointer()
      .on_click((_e, cx) => this.restore(entry, cx))
      .child(div().flex_1().min_w_0().text_ellipsis().font_family("monospace").text_size(12).child(entry.topic))
      .child(new Tag().size("xsmall").outline().child(`Q${entry.qos}`))
      .children(entry.retain ? [new Tag().size("xsmall").variant("warning").child("R")] : [])
      .child(div().text_color(cx.theme().colors.muted_foreground).text_size(11).child(entry.format))
      .child(new Button(`mqtt-pub-resend-${index}`).ghost().size("xsmall").label("重发")
        .on_click((_e, cx) => {
          this.restore(entry, cx);
          cx.spawn(async (cx) => this.publish(cx));
        }));
  }

  render(cx) {
    const sizeHint = this.sizeHint(cx);
    return h_flex().size_full().min_w_0().min_h_0().items_stretch()
      // 行内的两列都必须自己声明 h_full():`h_flex` 默认 items_center,
      // 不声明的列会按内容高度居中,发布框和正文框会一起塌掉。
      .child(v_flex().flex_1().min_w_0().min_h_0().h_full().p(12).gap(10)
        .child(div().text_size(16).font_semibold().child("发布消息"))
        .child(new Input(this.topic))
        // 选择器包在定宽容器里:它们自带宽度,直接当行子元素会让整行
        // 的最小宽度撑到 ~720px,把右侧「发送历史」挤出可视区。
        .child(h_flex().items_center().gap(8).min_w_0()
          .child(div().w(200).flex_shrink_0().child(
            new Select("mqtt-pub-qos", () => QOS_OPTIONS, (row) => div().child(row.label), (value, cx) => {
              this.qos = String(value);
              cx.notify();
            }).placeholder(qosLabel(this.qos)).menu_width(220)))
          .child(div().w(150).flex_shrink_0().child(
            new Select("mqtt-pub-format", () => FORMAT_OPTIONS, (row) => div().child(row.label), (value, cx) => {
              this.format = String(value);
              cx.notify();
            }).placeholder(`格式: ${this.format}`).menu_width(140)))
          .child(div().flex_1().min_w_0())
          .child(new Switch("mqtt-pub-retain").label("Retain").checked(this.retain)
            .on_change((checked, cx) => { this.retain = Boolean(checked); cx.notify(); })))
        .child(div().flex_1().min_h_0().child(new Textarea(this.body)))
        .child(h_flex().gap(8).items_center()
          .child(new Button("mqtt-pub-send").primary().label(this.busy ? "发布中…" : (this.armed ? "确认发布" : "发布"))
            .disabled(this.busy)
            .on_click((_e, cx) => cx.spawn(async (cx) => this.publish(cx))))
          .child(new Button("mqtt-pub-clear").ghost().label("清空")
            .on_click((_e, cx) => { this.body.set_value(""); this.status = null; this.armed = null; cx.notify(); }))
          .child(div().flex_1().min_w_0().text_size(12).text_ellipsis()
            .text_color(this.statusError ? cx.theme().colors.destructive : cx.theme().colors.muted_foreground)
            .child(this.status || "")))
        .children(sizeHint ? [sizeHint] : []))
      .child(v_flex().w(280).flex_none().h_full().min_h_0().border_l_1().p(8).gap(6)
        .child(h_flex().items_center().justify_between().flex_shrink_0()
          .child(div().font_semibold().text_size(13).child("发送历史"))
          .child(new Button("mqtt-pub-history-clear").ghost().size("xsmall").label("清除")
            .on_click((_e, cx) => { this.history = []; cx.notify(); })))
        .child(div().flex_1().min_h_0().overflow_y_scrollbar()
          .children(this.history.length
            ? this.history.map((entry, index) => this.historyRow(cx, entry, index))
            : [div().p(8).text_color(cx.theme().colors.muted_foreground).text_size(12).child("发布成功后会记录到这里,点击可回填、重发。")])));
  }
}
