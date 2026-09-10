import { Buffer } from "buffer";
import { View, div } from "gpui";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import { Button } from "gpui-component";
import { current, dispatch } from "navop.workbench";

export default class RocketmqSendMessage extends View {
  init(_props, cx) {
    this.context = current();
    this.topic = InputState.new({ value: "", placeholder: "Topic" });
    this.tag = InputState.new({ value: "", placeholder: "Tag (optional)" });
    this.key = InputState.new({ value: "", placeholder: "Key (optional)" });
    this.body = InputState.new({ value: "", placeholder: "Message body" });
    this.status = "Ready";
    this.pending = false;
    this.result = null;
  }

  render() {
    return v_flex()
      .size_full()
      .min_w_0()
      .min_h_0()
      .p(16)
      .gap(12)
      .child(div().text_size(18).font_semibold().child("Send RocketMQ Message"))
      .child(Input.new(this.topic))
      .child(Input.new(this.tag))
      .child(Input.new(this.key))
      .child(Input.new(this.body))
      .child(h_flex().gap(8)
        .child(new Button("rmq-send").label(this.pending ? "Confirm send" : "Send").on_click((_e, cx) => {
          cx.spawn(async (cx) => this.onSend(cx));
        }))
        .child(this.pending ? new Button("rmq-cancel").ghost().label("Cancel").on_click((_e, cx) => {
          this.pending = false;
          this.status = "Cancelled";
          cx.notify();
        }) : null))
      .child(`Status: ${this.status}`)
      .child(div().flex_1().min_h_0().overflow_y_scrollbar().whitespace_pre_wrap()
        .child(this.result ? JSON.stringify(this.result, null, 2) : "No result"));
  }

  async onSend(cx) {
    if (!this.pending) {
      const topic = this.topic.value().trim();
      if (!topic || !this.body.value()) {
        this.status = "Topic and body are required";
        cx.notify();
        return;
      }
      this.pending = true;
      this.status = "Confirm to send";
      cx.notify();
      return;
    }

    this.status = "Sending";
    cx.notify();
    const input = {
      topic: this.topic.value().trim(),
      tag: this.tag.value().trim() || undefined,
      key: this.key.value().trim() || undefined,
      body: Array.from(Buffer.from(this.body.value())),
    };
    try {
      this.result = await dispatch("sendMessage", input, { confirmed: true });
      this.status = "Sent";
    } catch (error) {
      this.status = `Failed: ${error.message}`;
    }
    this.pending = false;
    cx.notify();
  }
}
