// MQTT 连接概览:连接信息 + 订阅数 + 收发速率,每 2 秒自动刷新。
import { View, div } from "gpui";
import { h_flex, v_flex } from "gpui-base";
import { Button, Tag } from "gpui-component";
import { current, dispatch } from "navop.workbench";
import { banner, card, errorMessage, errorView, kv, loadingView, parseError } from "./shared.js";

const REFRESH_MS = 2000;

/** provider 的 tls_mode 取值 -> 中文说明(见 builtin.rs::tls_mode)。 */
const TLS_MODES = {
  off: "未启用",
  "system-roots": "系统根证书",
  "custom-ca": "自定义 CA",
  mutual: "mTLS(双向证书)",
  "skip-verify": "跳过校验(仅调试)",
};

/** 连接配置元数据(provider open 响应里的 metadata,不含任何凭据)。 */
function resourceMetadata(context) {
  try {
    return context?.connection?.resource?.metadata || null;
  } catch {
    return null;
  }
}

export default class MqttOverview extends View {
  init(_props, cx) {
    this.context = current();
    this.metadata = resourceMetadata(this.context);
    this.metrics = null;
    this.client = null;
    this.error = null;
    this.errorTransient = false;
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
      this.errorTransient = false;
    } catch (error) {
      this.error = errorMessage(error);
      this.errorTransient = parseError(error).transient;
    }
    this.loading = false;
    cx.notify();
  }

  render(cx) {
    if (this.loading && !this.metrics) return loadingView(cx, "正在读取连接指标…");
    if (this.error && !this.metrics) {
      // 空页面上的报错要写明"可能是宿主重启了 provider",而不是把
      // `rpc client is closed` 直接甩给用户(shared.js 已剥掉 base64 envelope)
      const text = this.errorTransient
        ? `连接已断开(宿主可能重启了扩展 provider):${this.error}`
        : `加载失败: ${this.error}`;
      return errorView(cx, "mqtt-overview-retry", text, (cx) => this.load(cx));
    }
    const m = this.metrics || {};
    const extras = Object.fromEntries(m.extras || []);
    const client = this.client || {};
    return v_flex().size_full().min_h_0().min_w_0().overflow_y_scrollbar().p(16).gap(16)
      .child(h_flex().gap(8).items_center().justify_between()
        .child(h_flex().gap(8).items_center()
          .child(div().text_size(16).font_semibold().child("MQTT 连接"))
          .children(this.errorTransient
            ? [new Tag().variant("warning").size("small").child("连接中断")]
            : [new Tag().variant("success").size("small").child("已连接")])
          .child(div().text_color(cx.theme().colors.muted_foreground).text_size(12).child(client.version || "MQTT 3.1.1")))
        .child(h_flex().gap(6)
          .child(new Button("mqtt-overview-auto").ghost().size("small")
            .label(this.auto ? "自动刷新: 开" : "自动刷新: 关")
            .on_click((_e, cx) => { this.auto = !this.auto; cx.notify(); }))
          .child(new Button("mqtt-overview-refresh").ghost().size("small").label("刷新")
            .on_click((_e, cx) => cx.spawn(async (cx) => this.load(cx))))))
      .children(this.error
        ? [banner(cx, `刷新失败: ${this.error}`, { error: true, action: {
            id: "mqtt-overview-reload",
            label: "重试",
            on_click: (cx) => cx.spawn(async (cx) => this.load(cx)),
          } })]
        : [])
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
        .child(div().font_semibold().child("连接配置"))
        .child(kv(cx, "MQTT 版本", this.metadata?.mqtt_version || "3.1.1"))
        .child(kv(cx, "TLS", TLS_MODES[this.metadata?.tls_mode] || "-"))
        .child(kv(cx, "Clean Session", this.metadata ? String(Boolean(this.metadata.clean_session)) : "-"))
        .child(kv(cx, "自动订阅", this.metadata?.auto_subscribe || "-"))
        .child(kv(cx, "订阅持久化",
          this.metadata?.persistence === "host"
            ? `宿主持久化(已恢复 ${Number(this.metadata.restored_subscriptions) || 0} 条)`
            : "本机未启用(重启后会丢)"))
        .child(kv(cx, "Broker", this.metadata?.broker)))
      .child(v_flex().gap(6).border_1().rounded(6).p(12)
        .child(div().font_semibold().child(`订阅(${(client.subscriptions || []).length})`))
        .children((client.subscriptions || []).length
          ? (client.subscriptions || []).map((filter) => div().text_size(12).font_family("monospace").child(filter))
          : [div().text_color(cx.theme().colors.muted_foreground).text_size(12).child("暂无订阅,前往「订阅」页添加")]));
  }
}
