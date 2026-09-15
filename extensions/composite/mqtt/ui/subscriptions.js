// MQTT 订阅管理:列表 + 新增订阅(过滤器/QoS)+ 取消订阅。
import { View, div } from "gpui";
import { h_flex, v_flex, InputState } from "gpui-base";
import { Button, Input, Select, Tag } from "gpui-component";
import { dispatch } from "navop.workbench";
import { QOS_OPTIONS, errorMessage, errorView, isValidFilter, loadingView, qosLabel } from "./shared.js";

export default class MqttSubscriptions extends View {
  init(_props, cx) {
    this.topics = [];
    this.filter = InputState.new({ value: "", placeholder: "主题过滤器,如 sensors/+/temp 或 devices/#" });
    this.filter.on("submit", (_e, cx) => cx.spawn(async (cx) => this.subscribe(cx)));
    this.qos = "1";
    this.loading = true;
    this.busy = false;
    this.error = null;
    this.notice = null;
    this.noticeError = false;
    cx.spawn(async (cx) => this.load(cx));
  }

  async load(cx) {
    try {
      const result = await dispatch("listTopics");
      this.topics = result?.topics || [];
      this.error = null;
    } catch (error) {
      this.error = errorMessage(error);
    }
    this.loading = false;
    cx.notify();
  }

  async subscribe(cx) {
    const topic = this.filter.value().trim();
    // 空输入单独提示:以前它也走「过滤器非法」那条分支,用户点了订阅却没打
    // 字时看到的是一句讲 `#`/`+` 规则的错,和实际原因对不上。
    if (!topic) {
      this.notice = "请先填写主题过滤器,如 sensors/+/temp 或 devices/#";
      this.noticeError = true;
      cx.notify();
      return;
    }
    if (!isValidFilter(topic)) {
      this.notice = `过滤器非法: \`${topic}\` —— \`#\` 只能位于末尾且独占一层,\`+\` 必须独占一层`;
      this.noticeError = true;
      cx.notify();
      return;
    }
    this.busy = true;
    this.notice = null;
    this.noticeError = false;
    cx.notify();
    try {
      await dispatch("subscribe", { topic, qos: Number(this.qos) }, { confirmed: true });
      this.filter.set_value("");
      this.notice = `已订阅 ${topic}(${qosLabel(this.qos)})`;
    } catch (error) {
      this.notice = `订阅失败: ${errorMessage(error)}`;
      this.noticeError = true;
    }
    this.busy = false;
    await this.load(cx);
  }

  async unsubscribe(topic, cx) {
    this.busy = true;
    cx.notify();
    try {
      await dispatch("unsubscribe", { topic }, { confirmed: true });
      this.notice = `已取消订阅 ${topic}`;
      this.noticeError = false;
    } catch (error) {
      this.notice = `取消订阅失败: ${errorMessage(error)}`;
      this.noticeError = true;
    }
    this.busy = false;
    await this.load(cx);
  }

  row(topic) {
    const name = topic.name || "";
    return h_flex().items_center().gap(8).px(10).py(6).border_b_1()
      .child(div().flex_1().min_w_0().text_ellipsis().font_family("monospace").child(name))
      .child(new Tag().size("small").outline().child(qosLabel(topic.queue_count ?? 0)))
      .child(new Button(`mqtt-unsub-${name}`).ghost().size("small").danger().label("取消订阅")
        .disabled(this.busy)
        .on_click((_e, cx) => cx.spawn(async (cx) => this.unsubscribe(name, cx))));
  }

  render(cx) {
    if (this.loading && this.topics.length === 0) return loadingView(cx, "正在读取订阅列表…");
    if (this.error && this.topics.length === 0) return errorView(cx, "mqtt-subs-retry", `加载失败: ${this.error}`, (cx) => this.load(cx));
    return v_flex().size_full().min_w_0().min_h_0().p(12).gap(10)
      .child(h_flex().gap(8).items_center()
        .child(div().text_size(16).font_semibold().child(`订阅(${this.topics.length})`))
        .child(div().flex_1())
        .child(new Button("mqtt-subs-refresh").ghost().size("small").label("刷新")
          .on_click((_e, cx) => cx.spawn(async (cx) => this.load(cx)))))
      .child(v_flex().gap(6).p(10).border_1().rounded(6).min_w_0()
        .child(div().font_semibold().child("新增订阅"))
        .child(h_flex().gap(6).items_center().min_w_0()
          .child(div().flex_1().min_w_0().child(new Input(this.filter)))
          // QoS 选择器必须包在定宽容器里:`Select` 自带整行宽度,直接当行子元素
          // 会把同行的 `flex_1` 过滤器输入压成 0 宽 —— 表现是整个输入框消失,
          // 只剩 QoS 下拉和按钮(见 docs/middleware-standard.md §5.4)。
          .child(div().w(200).flex_shrink_0().child(
            new Select("mqtt-sub-qos", () => QOS_OPTIONS, (row) => div().child(row.label), (value, cx) => {
              this.qos = String(value);
              cx.notify();
            }).placeholder(qosLabel(this.qos)).menu_width(220)))
          .child(new Button("mqtt-sub-add").primary().flex_shrink_0().label(this.busy ? "处理中…" : "订阅")
            .disabled(this.busy)
            .on_click((_e, cx) => cx.spawn(async (cx) => this.subscribe(cx)))))
        .children(this.notice ? [div().text_size(12)
          .text_color(this.noticeError ? cx.theme().colors.destructive : cx.theme().colors.muted_foreground)
          .child(this.notice)] : []))
      .child(div().flex_1().min_h_0().overflow_y_scrollbar().border_1().rounded(6)
        .children(this.topics.length
          ? this.topics.map((topic) => this.row(topic))
          : [div().p(16).text_color(cx.theme().colors.muted_foreground).text_size(12).child("暂无订阅。添加过滤器后,匹配的消息会出现在「消息」页。")]));
  }
}
