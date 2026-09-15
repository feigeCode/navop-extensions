// MQTT 连接概览:连接信息 + 订阅数 + 收发速率,每 2 秒自动刷新。
import { View, div } from "gpui";
import { h_flex, v_flex } from "gpui-base";
import { Button, Tag } from "gpui-component";
import { current, dispatch } from "navop.workbench";
import { card, errorMessage, errorView, kv, loadingView } from "./shared.js";

const REFRESH_MS = 2000;

export default class MqttOverview extends View {
  init(_props, cx) {
    this.context = current();
    this.metrics = null;
    this.client = null;
    this.error = null;
    this.loading = true;
    this.auto = true;
    cx.spawn(async (cx) => this.load(cx));
    this.timer = cx.timer.every(REFRESH_MS, (cx) => {
      if (this.auto) return this.load(cx);
    });
  }

  async load(cx) {
    try {
      const [metrics, clients] = await Promise.all([dispatch("metrics"), dispatch("listClients")]);
      this.metrics = metrics?.metrics || metrics || {};
      this.client = (clients?.clients || [])[0] || null;
      this.error = null;
    } catch (error) {
      this.error = errorMessage(error);
    }
    this.loading = false;
    cx.notify();
  }

  render(cx) {
    if (this.loading && !this.metrics) return loadingView(cx, "正在读取连接指标…");
    if (this.error && !this.metrics) return errorView(cx, "mqtt-overview-retry", `加载失败: ${this.error}`, (cx) => this.load(cx));
    const m = this.metrics || {};
    const extras = Object.fromEntries(m.extras || []);
    const client = this.client || {};
    return v_flex().size_full().min_h_0().min_w_0().overflow_y_scrollbar().p(16).gap(16)
      .child(h_flex().gap(8).items_center().justify_between()
        .child(h_flex().gap(8).items_center()
          .child(div().text_size(16).font_semibold().child("MQTT 连接"))
          .child(new Tag().variant("success").size("small").child("已连接"))
          .child(div().text_color(cx.theme().colors.muted_foreground).text_size(12).child(client.version || "MQTT 3.1.1")))
        .child(h_flex().gap(6)
          .child(new Button("mqtt-overview-auto").ghost().size("small")
            .label(this.auto ? "自动刷新: 开" : "自动刷新: 关")
            .on_click((_e, cx) => { this.auto = !this.auto; cx.notify(); }))
          .child(new Button("mqtt-overview-refresh").ghost().size("small").label("刷新")
            .on_click((_e, cx) => cx.spawn(async (cx) => this.load(cx))))))
      .children(this.error ? [div().text_color(cx.theme().colors.destructive).text_size(12).child(`刷新失败: ${this.error}`)] : [])
      .child(h_flex().gap(8).flex_wrap()
        .child(card(cx, "接收速率", `${Number(m.tps_in ?? 0).toFixed(1)} /s`, "最近 5 秒平均"))
        .child(card(cx, "发送速率", `${Number(m.tps_out ?? 0).toFixed(1)} /s`, "最近 5 秒平均"))
        .child(card(cx, "订阅数", m.topic_count ?? 0, "当前活跃订阅过滤器"))
        .child(card(cx, "今日接收", m.message_count_today ?? 0, `累计接收 ${extras.received_total ?? 0}`))
        .child(card(cx, "累计发送", extras.sent_total ?? 0, "本连接发布的消息数"))
        .child(card(cx, "本地缓冲", `${extras.buffered_messages ?? 0} / ${extras.buffer_capacity ?? "-"}`, "历史消息环形缓冲")))
      .child(v_flex().gap(6).border_1().rounded(6).p(12)
        .child(div().font_semibold().child("客户端"))
        .child(kv(cx, "Client ID", client.client_id))
        .child(kv(cx, "协议", client.version))
        .child(kv(cx, "连接名", this.context?.connection?.name || "-")))
      .child(v_flex().gap(6).border_1().rounded(6).p(12)
        .child(div().font_semibold().child(`订阅(${(client.subscriptions || []).length})`))
        .children((client.subscriptions || []).length
          ? (client.subscriptions || []).map((filter) => div().text_size(12).font_family("monospace").child(filter))
          : [div().text_color(cx.theme().colors.muted_foreground).text_size(12).child("暂无订阅,前往「订阅」页添加")]));
  }
}
