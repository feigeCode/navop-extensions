// MQTT 订阅管理:列表 + 新增订阅(过滤器/QoS)+ 取消订阅。
//
// 两条安全约束:
//  1. `auto_subscribe` 生成的自动订阅(默认 `#`)只读:它是连接配置的产物,
//     单独取消只会让 provider 与配置不一致(重连又被加回来)。provider 用
//     `topic_type = AUTO_SUBSCRIPTION` 标出来,这里禁止取消并显示徽标。
//  2. 取消订阅是**两步确认**:点「取消订阅」只在行内展开确认,再点「确认取消」
//     才真正下发。写操作不靠固定的 `confirmed: true` 静默绕过宿主确认语义,
//     而是由这个真实交互产生。
import { View, div } from "gpui";
import { h_flex, v_flex, InputState } from "gpui-base";
import { Button, Input, Select, Tag } from "gpui-component";
import { dispatch } from "navop.workbench";
import * as context from "navop.context";
import {
  QOS_OPTIONS, banner, errorView, errorMessage, isTransientError, isValidFilter, loadingView, qosLabel,
} from "./shared.js";

/** provider 对自动订阅给出的 topic_type(见 admin.rs)。 */
const AUTO_TOPIC_TYPE = "AUTO_SUBSCRIPTION";

/**
 * 宿主是否真的把订阅存下来了(provider 在 open metadata 里给结论)。
 *
 * 宿主 KV 在部分版本是桩实现:provider 写完读回为空,于是 metadata 报
 * `unavailable`。这时 UI 要如实说明"重启后会丢",而不是让用户以为已经保存。
 */
function persistenceHint() {
  try {
    const metadata = context.current()?.connection?.resource?.metadata;
    if (!metadata) return null;
    if (metadata.persistence === "host") {
      const restored = Number(metadata.restored_subscriptions) || 0;
      return restored > 0 ? `已从上次会话恢复 ${restored} 条订阅(宿主存储)` : null;
    }
    return "「已保存订阅」只在本机生效:当前宿主未启用扩展存储(host/storage),provider 重启后订阅需要重新添加";
  } catch {
    return null;
  }
}

/** 连接配置里的自动订阅过滤器(用户手工订阅同一过滤器没有意义)。 */
function autoFilter() {
  try {
    return context.current()?.connection?.resource?.metadata?.auto_subscribe || null;
  } catch {
    return null;
  }
}

export default class MqttSubscriptions extends View {
  init(_props, cx) {
    this.topics = [];
    this.filter = InputState.new({ value: "", placeholder: "主题过滤器,如 sensors/+/temp 或 devices/#" });
    this.filter.on("submit", (_e, cx) => cx.spawn(async (cx) => this.subscribe(cx)));
    this.qos = "1";
    this.loading = true;
    this.busy = false;
    this.error = null;
    this.errorTransient = false;
    this.notice = null;
    this.noticeError = false;
    /** 正在等待二次确认的过滤器(取消订阅需要用户再点一次) */
    this.pendingUnsubscribe = null;
    this.persistenceHint = persistenceHint();
    this.autoFilter = autoFilter();
    cx.spawn(async (cx) => this.load(cx));
  }

  async load(cx) {
    try {
      const result = await dispatch("listTopics");
      this.topics = result?.topics || [];
      this.error = null;
      this.errorTransient = false;
    } catch (error) {
      this.error = errorMessage(error);
      this.errorTransient = isTransientError(error);
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
    if (this.autoFilter && topic === this.autoFilter) {
      this.notice = `\`${topic}\` 已由连接配置的自动订阅覆盖,无需重复订阅`;
      this.noticeError = true;
      cx.notify();
      return;
    }
    this.busy = true;
    this.notice = null;
    this.noticeError = false;
    cx.notify();
    try {
      // 「订阅」按钮本身就是确认交互(非破坏性,且输入已通过过滤器校验);
      // 破坏性的「取消订阅」走两步确认,见 row()。
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
    this.pendingUnsubscribe = null;
    cx.notify();
    try {
      // confirmed:true 由上面那一步真实交互(行内「确认取消」)授权,不是硬编码绕过
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

  row(topic, cx) {
    const name = topic.name || "";
    const managed = topic.topic_type === AUTO_TOPIC_TYPE;
    const confirming = this.pendingUnsubscribe === name;
    return h_flex().items_center().gap(8).px(10).py(6).border_b_1()
      .child(div().flex_1().min_w_0().text_ellipsis().font_family("monospace").child(name))
      // 自动订阅:来自连接配置(auto_subscribe),不能被单独取消
      .children(managed
        ? [new Tag().size("small").variant("info").child("自动订阅"),
           div().text_size(11).text_color(cx.theme().colors.muted_foreground)
             .child(topic.description || "由连接配置 auto_subscribe 提供")]
        : [])
      .child(new Tag().size("small").outline().child(qosLabel(topic.queue_count ?? 0)))
      .children(managed
        ? []
        : (confirming
            ? [new Button(`mqtt-unsub-confirm-${name}`).size("small").danger()
                .label(this.busy ? "处理中…" : "确认取消")
                .disabled(this.busy)
                .on_click((_e, cx) => cx.spawn(async (cx) => this.unsubscribe(name, cx))),
               new Button(`mqtt-unsub-abort-${name}`).ghost().size("small").label("放弃")
                 .on_click((_e, cx) => { this.pendingUnsubscribe = null; cx.notify(); })]
            // 第一步只是展开确认,不下发任何写操作
            : [new Button(`mqtt-unsub-${name}`).ghost().size("small").danger().label("取消订阅")
                .disabled(this.busy)
                .on_click((_e, cx) => { this.pendingUnsubscribe = name; cx.notify(); })]));
  }

  render(cx) {
    if (this.loading && this.topics.length === 0) return loadingView(cx, "正在读取订阅列表…");
    if (this.error && this.topics.length === 0) {
      // provider 被宿主重启时报错文案要能自解释,而不是"加载失败: ...rpc client is closed"
      const text = this.errorTransient
        ? `连接已断开(宿主可能重启了扩展 provider):${this.error}`
        : `加载失败: ${this.error}`;
      return errorView(cx, "mqtt-subs-retry", text, (cx) => this.load(cx));
    }
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
      // 列表非空但读失败(例如 provider 被重启):列表保留旧内容,状态条给出原因和重试
      .children(this.error
        ? [banner(cx, `订阅列表可能已过期:${this.error}`, { error: true, action: {
            id: "mqtt-subs-reload",
            label: "重新加载",
            on_click: (cx) => cx.spawn(async (cx) => this.load(cx)),
          } })]
        : [])
      .children(this.persistenceHint ? [banner(cx, this.persistenceHint, {})] : [])
      .child(div().flex_1().min_h_0().overflow_y_scrollbar().border_1().rounded(6)
        .children(this.topics.length
          ? this.topics.map((topic) => this.row(topic, cx))
          : [div().p(16).text_color(cx.theme().colors.muted_foreground).text_size(12).child("暂无订阅。添加过滤器后,匹配的消息会出现在「消息」页。")]));
  }
}
