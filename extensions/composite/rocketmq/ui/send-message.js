// RocketMQ 消息发送:选择 Topic 发送带 Tag/Key 的消息,带结果与发送历史。
//
// 与其它嵌入式工作台页一样,只经 `navop.workbench.dispatch` 走已声明的写操作;
// `effect: "write"` 的确认由宿主的 dispatch 负责(传 confirmed: true),
// 页面自己不再做二次点击确认。
import { Buffer } from "buffer";
import { View, div } from "gpui";
import { h_flex, v_flex, InputState, TextareaState } from "gpui-base";
import { Button, Input, Select, Tag, Textarea } from "gpui-component";
import { dispatch } from "navop.workbench";
import { errorMessage, kv, section } from "./shared.js";

const HISTORY_LIMIT = 10;

export default class RocketmqSendMessage extends View {
  init(_props, cx) {
    this.topic = InputState.new({ value: "", placeholder: "Topic(必填),如 order-topic" });
    this.tag = InputState.new({ value: "", placeholder: "Tag(可选),如 create" });
    this.key = InputState.new({ value: "", placeholder: "Key(可选),用于按 Key 查询" });
    this.body = TextareaState.new({ value: "", placeholder: "消息体(UTF-8 文本)", rows: 10 });
    this.topics = [];
    this.busy = false;
    this.result = null;
    this.status = "填写 Topic 与消息体后发送";
    this.statusError = false;
    this.history = [];
    cx.spawn(async (cx) => this.loadTopics(cx));
  }

  async loadTopics(cx) {
    try {
      const result = await dispatch("listTopics");
      // 下拉用 id/label 形状:Select 以 row.id 作为取值键。
      this.topics = (result?.topics || []).map((topic) => ({
        id: String(topic.name),
        label: String(topic.name),
      }));
      cx.notify();
    } catch {
      // 拉不到列表不阻塞手填:静默降级为纯输入框。
      this.topics = [];
    }
  }

  fail(text, cx) {
    this.status = text;
    this.statusError = true;
    this.busy = false;
    cx.notify();
  }

  async send(cx) {
    if (this.busy) return;
    const topic = this.topic.value().trim();
    const body = this.body.value();
    if (!topic) return this.fail("Topic 不能为空", cx);
    if (!body) return this.fail("消息体不能为空", cx);
    this.busy = true;
    this.statusError = false;
    this.status = "发送中…";
    cx.notify();
    try {
      // body 是字节数组:provider 的 SendMessageRequest.body 为 Vec<u8>。
      const result = await dispatch("sendMessage", {
        topic,
        tag: this.tag.value().trim() || undefined,
        key: this.key.value().trim() || undefined,
        body: Array.from(Buffer.from(body, "utf8")),
      }, { confirmed: true });
      this.result = result;
      this.status = `发送成功:${result?.message_id ?? "-"} (${result?.status ?? "-"})`;
      this.pushHistory({
        topic,
        tag: this.tag.value().trim(),
        key: this.key.value().trim(),
        text: body,
      });
    } catch (error) {
      this.fail(`发送失败: ${errorMessage(error)}`, cx);
    }
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
    this.tag.set_value(entry.tag);
    this.key.set_value(entry.key);
    this.body.set_value(entry.text);
    this.status = "已回填历史消息";
    this.statusError = false;
    cx.notify();
  }

  render(cx) {
    return v_flex().size_full().min_w_0().min_h_0().p(16).gap(12).overflow_y_scrollbar()
      .child(h_flex().items_center().gap(8).min_w_0()
        .child(div().text_size(15).font_semibold().flex_shrink_0().child("发送消息"))
        .child(div().flex_1().min_w_0().truncate().text_size(12)
          .text_color(this.statusError ? cx.theme().colors.destructive : cx.theme().colors.muted_foreground)
          .child(this.status)))
      .child(section(cx, "目标", [
        h_flex().items_center().gap(8).min_w_0()
          .child(div().flex_1().min_w_0().child(new Input(this.topic)))
          // 裸 Select 自带整行宽度,必须包在定宽容器里,否则同行输入框会被压成 0 宽。
          .child(div().w(220).flex_shrink_0().child(
            new Select("rmq-send-topic", () => this.topics, (item) => div().child(item.label),
              (value, cx) => {
                this.topic.set_value(String(value));
                cx.notify();
              }).placeholder("从已有 Topic 选择").menu_width(220))),
        h_flex().items_center().gap(8).min_w_0()
          .child(div().flex_1().min_w_0().child(new Input(this.tag)))
          .child(div().flex_1().min_w_0().child(new Input(this.key))),
      ]))
      .child(section(cx, "消息体", [
        new Textarea(this.body),
      ]))
      .child(h_flex().items_center().gap(8)
        .child(new Button("rmq-send-submit").primary().flex_shrink_0().label("发送")
          .loading(this.busy)
          .on_click((_e, cx) => cx.spawn(async (cx) => this.send(cx))))
        .child(new Button("rmq-send-clear").ghost().flex_shrink_0().label("清空")
          .on_click((_e, cx) => {
            this.body.set_value("");
            this.result = null;
            this.status = "已清空消息体";
            this.statusError = false;
            cx.notify();
          }))
        .child(div().flex_1())
        .children(this.topics.length
          ? [new Tag().size("xsmall").child(`${this.topics.length} 个 Topic`)]
          : []))
      .children(this.result
        ? [section(cx, "发送结果", [
            kv(cx, "Message ID", this.result.message_id),
            kv(cx, "状态", this.result.status),
          ])]
        : [])
      .children(this.history.length
        ? [section(cx, "发送历史", this.history.map((entry) =>
            h_flex().px(8).py(5).gap(8).rounded(4).cursor_pointer().min_w_0()
              .hover((el) => el.bg(cx.theme().colors.muted))
              .on_click((_event, cx) => this.restore(entry, cx))
              .child(div().w(140).flex_shrink_0().text_size(12).truncate().child(entry.topic))
              .child(div().w(80).flex_shrink_0().text_size(11)
                .text_color(cx.theme().colors.muted_foreground).truncate()
                .child(entry.tag || "-"))
              .child(div().flex_1().min_w_0().text_size(11)
                .text_color(cx.theme().colors.muted_foreground).truncate()
                .child(entry.text.replace(/\s+/g, " ")))))]
        : []);
  }
}
