// MQTT 消息发布:主题、QoS、Retain、多格式 payload、历史重发。
import { View, div } from "gpui";
import { h_flex, v_flex, Input, InputState, Textarea, TextareaState } from "gpui-base";
import { Button, Select, Switch, Tag } from "gpui-component";
import { dispatch } from "navop.workbench";
import { FORMAT_OPTIONS, QOS_OPTIONS, encodePayload, errorMessage, humanBytes, qosLabel } from "./shared.js";

const HISTORY_LIMIT = 20;

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
    this.busy = true;
    this.status = "发布中…";
    this.statusError = false;
    cx.notify();
    try {
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
    return h_flex().size_full().min_w_0().min_h_0().items_stretch()
      // 行内的两列都必须自己声明 h_full():`h_flex` 默认 items_center,
      // 不声明的列会按内容高度居中,发布框和正文框会一起塌掉。
      .child(v_flex().flex_1().min_w_0().min_h_0().h_full().p(12).gap(10)
        .child(div().text_size(16).font_semibold().child("发布消息"))
        .child(Input.new(this.topic))
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
        .child(div().flex_1().min_h_0().child(Textarea.new(this.body)))
        .child(h_flex().gap(8).items_center()
          .child(new Button("mqtt-pub-send").primary().label(this.busy ? "发布中…" : "发布")
            .disabled(this.busy)
            .on_click((_e, cx) => cx.spawn(async (cx) => this.publish(cx))))
          .child(new Button("mqtt-pub-clear").ghost().label("清空")
            .on_click((_e, cx) => { this.body.set_value(""); this.status = null; cx.notify(); }))
          .child(div().flex_1().min_w_0().text_size(12).text_ellipsis()
            .text_color(this.statusError ? cx.theme().colors.destructive : cx.theme().colors.muted_foreground)
            .child(this.status || ""))))
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
