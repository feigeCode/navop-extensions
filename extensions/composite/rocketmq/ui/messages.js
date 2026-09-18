// RocketMQ 消息查询:按时间窗口 / Message Key / Message ID 查询,结果列表 + 行内详情。
//
// 三种模式各对应一个已声明的工作台操作(它们的 params 绑定到
// `middleware/message/query` 的不同 tagged 变体上);模式选择、时间解析与
// 载荷构造都在 `message-model.js` 里,由 node 测试覆盖。
//
// 嵌入式页拿不到 `navop.event`(清单禁声明),所以这里是"查询一次看一次",
// 不做轮询 —— RocketMQ 的消费是拉取语义,没有可订阅的推流端点。
import { View, div } from "gpui";
import { h_flex, v_flex, InputState } from "gpui-base";
import { Button, Input, Select, Tag } from "gpui-component";
import { dispatch } from "navop.workbench";
import {
  PAGE_SIZES,
  QUERY_MODES,
  TIME_PRESETS,
  bodyText,
  buildQuery,
  emptyView,
  errorMessage,
  formatMillis,
  kv,
  messageProperties,
  messageTime,
  presetById,
  previewOf,
  shortId,
} from "./shared.js";

export default class RocketmqMessages extends View {
  init(_props, cx) {
    this.mode = "time";
    this.preset = "10m";
    this.pageSize = PAGE_SIZES[1];
    this.page = 1;
    this.hasMore = false;
    this.rows = [];
    this.selected = null;
    this.busy = false;
    this.queried = false;
    this.error = null;
    this.status = "填写条件后点击查询";
    this.topic = InputState.new({ value: "", placeholder: "Topic(必填),如 order-topic" });
    this.key = InputState.new({ value: "", placeholder: "Message Key" });
    this.messageId = InputState.new({ value: "", placeholder: "Message ID(存储 ID 或 UNIQ_KEY)" });
    this.begin = InputState.new({ value: "", placeholder: "开始:2025-01-01 00:00 或 Unix 毫秒" });
    this.end = InputState.new({ value: "", placeholder: "结束:留空表示现在" });
    for (const state of [this.topic, this.key, this.messageId, this.begin, this.end]) {
      state.on("change", (_event, cx) => cx.notify());
    }
  }

  async run(cx, page) {
    if (this.busy) return;
    let request;
    try {
      request = buildQuery(this.mode, {
        topic: this.topic.value(),
        key: this.key.value(),
        messageId: this.messageId.value(),
        preset: this.preset,
        begin: this.begin.value(),
        end: this.end.value(),
        page: page ?? 1,
        pageSize: this.pageSize,
      });
    } catch (error) {
      // 输入非法就地拦截,不派发请求。
      this.error = errorMessage(error);
      this.status = "查询条件有误";
      cx.notify();
      return;
    }
    this.busy = true;
    this.error = null;
    this.status = "查询中…";
    cx.notify();
    try {
      const result = await dispatch(request.operation, request.input);
      this.rows = result?.messages || [];
      // provider 侧 `MessagePage.total` 是**本页条数**(不是全量总数),
      // 而且 has_more 在"本页非空"时就会被置真 ⇒ 空页即到底,禁用下一页。
      // 所以这里不接 `total`:表头只能报本页实际行数,写成"共 N 条"会让用户
      // 以为拿到了全量总数(这个字段给不出全量)。
      this.hasMore = Boolean(result?.has_more) && this.rows.length > 0;
      this.page = page ?? 1;
      this.selected = this.rows[0] || null;
      this.queried = true;
      this.status = this.rows.length
        ? `第 ${this.page} 页 · 返回 ${this.rows.length} 条`
        : "没有匹配的消息";
    } catch (error) {
      this.error = errorMessage(error);
      this.status = "查询失败";
    }
    this.busy = false;
    cx.notify();
  }

  switchMode(mode, cx) {
    this.mode = mode;
    this.page = 1;
    this.rows = [];
    this.selected = null;
    this.queried = false;
    this.error = null;
    this.status = "填写条件后点击查询";
    cx.notify();
  }

  fieldsRow(cx) {
    const row = h_flex().items_center().gap(8).min_w_0()
      .child(div().flex_1().min_w_0().child(new Input(this.topic)));
    if (this.mode === "key") {
      row.child(div().flex_1().min_w_0().child(new Input(this.key)));
    } else if (this.mode === "id") {
      row.child(div().flex_1().min_w_0().child(new Input(this.messageId)));
    } else {
      const presets = TIME_PRESETS.map((preset) => ({ id: preset.id, label: preset.label }));
      row.child(div().w(150).flex_shrink_0().child(
        new Select("rmq-msg-preset", () => presets, (item) => div().child(item.label), (value, cx) => {
          this.preset = String(value);
          cx.notify();
        }).placeholder(presetById(this.preset).label).menu_width(140)));
      if (this.preset === "custom") {
        row.child(div().flex_1().min_w_0().child(new Input(this.begin)));
        row.child(div().flex_1().min_w_0().child(new Input(this.end)));
      } else {
        row.child(div().w(150).flex_shrink_0().text_size(11)
          .text_color(cx.theme().colors.muted_foreground)
          .child(`起 ${formatMillis(Date.now() - presetById(this.preset).ms)}`));
      }
      const sizes = PAGE_SIZES.map((size) => ({ id: String(size), label: `${size} 条/页` }));
      row.child(div().w(110).flex_shrink_0().child(
        new Select("rmq-msg-size", () => sizes, (item) => div().child(item.label), (value, cx) => {
          this.pageSize = Number(value);
          cx.notify();
        }).placeholder(`${this.pageSize} 条/页`).menu_width(120)));
    }
    row.child(new Button("rmq-msg-run").primary().size("small").flex_shrink_0()
      .label("查询")
      .loading(this.busy)
      .on_click((_e, cx) => cx.spawn(async (cx) => this.run(cx, 1))));
    return row;
  }

  rowsHeader(cx) {
    return h_flex().w_full().items_center().gap(8).px(10).py(6).border_b_1().min_w_0()
      .child(div().flex_1().min_w_0().text_size(11).child("Message ID"))
      .child(div().w(110).flex_shrink_0().text_size(11).child("Topic"))
      .child(div().w(70).flex_shrink_0().text_size(11).child("Tag"))
      .child(div().w(140).flex_shrink_0().text_size(11).child("存储时间"))
      .child(div().w(150).flex_shrink_0().text_size(11)
        .text_color(cx.theme().colors.muted_foreground)
        .child(this.rows.length ? `本页 ${this.rows.length} 条` : "无结果"))
      .child(new Button("rmq-msg-prev").ghost().size("small").flex_shrink_0().label("上一页")
        .disabled(this.busy || this.page <= 1)
        .on_click((_e, cx) => cx.spawn(async (cx) => this.run(cx, Math.max(1, this.page - 1)))))
      .child(new Button("rmq-msg-next").ghost().size("small").flex_shrink_0().label("下一页")
        .disabled(this.busy || !this.hasMore)
        .on_click((_e, cx) => cx.spawn(async (cx) => this.run(cx, this.page + 1))));
  }

  row(cx, message) {
    const active = this.selected != null && this.selected.message_id === message.message_id;
    return v_flex().w_full().px(10).py(5).gap(2).border_b_1().cursor_pointer().min_w_0()
      // 选中行高亮走主题的 accent;`cx.theme().colors` 只认 18 个 ColorTokens,
      // 组件库的 `list_active` 之类名字在这里是 nil,写了整页渲染失败。
      .when(active, (el) => el.bg(cx.theme().colors.accent))
      .on_click((_event, cx) => {
        this.selected = message;
        cx.notify();
      })
      .child(h_flex().items_center().gap(6).min_w_0()
        .child(div().flex_1().min_w_0().font_family("monospace").text_size(12).truncate()
          .child(shortId(message.message_id)))
        .child(div().w(110).flex_shrink_0().text_size(11).truncate()
          .child(String(message.topic ?? "-")))
        .children(message.tag
          ? [div().w(70).flex_shrink_0().child(new Tag().size("xsmall").outline().child(String(message.tag)))]
          : [div().w(70).flex_shrink_0().text_size(11)
              .text_color(cx.theme().colors.muted_foreground).child("-")])
        .child(div().w(140).flex_shrink_0().text_size(11)
          .text_color(cx.theme().colors.muted_foreground).truncate()
          .child(messageTime(message))))
      .child(h_flex().items_center().gap(6).min_w_0()
        .child(div().flex_1().min_w_0().text_size(12)
          .text_color(cx.theme().colors.muted_foreground).truncate()
          .child(previewOf(message) || "(空消息体)"))
        .children(message.key
          ? [div().w(160).flex_shrink_0().text_size(11)
              .text_color(cx.theme().colors.muted_foreground).truncate()
              .child(`key ${message.key}`)]
          : []));
  }

  detail(cx) {
    const message = this.selected;
    if (!message) return emptyView(cx, "选择一条消息查看详情");
    const properties = messageProperties(message);
    return v_flex().size_full().min_w_0().min_h_0().h_full().gap(6).p(10).overflow_y_scrollbar()
      .child(div().text_size(13).font_semibold().child("消息详情"))
      .child(kv(cx, "Message ID", message.message_id))
      .child(kv(cx, "Topic", message.topic))
      .child(kv(cx, "Tag", message.tag || "-"))
      .child(kv(cx, "Key", message.key || "-"))
      .child(kv(cx, "存储时间", message.store_time || "-"))
      .child(kv(cx, "生成时间", message.born_time || "-"))
      .child(kv(cx, "存储 Broker", message.store_host || "-"))
      .child(kv(cx, "生产者", message.born_host || "-"))
      .child(kv(cx, "重试次数", message.retry_times == null ? "-" : String(message.retry_times)))
      .child(div().text_size(12).font_semibold().child("消息体"))
      .child(div().max_h(240).overflow_y_scrollbar().border_1().rounded(6).p(8)
        .font_family("monospace").text_size(12)
        .child(bodyText(message) || "(空消息体,用 Message ID 查询可拉取完整内容)"))
      .children(properties.length
        ? [div().text_size(12).font_semibold().child("属性"),
           v_flex().w_full().gap(4).border_1().rounded(6).p(8)
             .children(properties.map(([key, value]) =>
               h_flex().gap(8).items_start().min_w_0()
                 .child(div().w(120).flex_shrink_0().text_size(11)
                   .text_color(cx.theme().colors.muted_foreground).truncate().child(key))
                 .child(div().flex_1().min_w_0().text_size(11).child(value))))]
        : []);
  }

  render(cx) {
    const modes = QUERY_MODES.map((mode) => ({ id: mode.id, label: mode.label }));
    const activeMode = QUERY_MODES.find((mode) => mode.id === this.mode) || QUERY_MODES[0];
    return v_flex().size_full().min_w_0().min_h_0().p(12).gap(10)
      .child(h_flex().items_center().gap(8).min_w_0()
        .child(div().text_size(15).font_semibold().flex_shrink_0().child("消息查询"))
        // 裸着的 Select 自带整行宽度,会把同行的兄弟挤出可视区 —— 必须包定宽容器。
        .child(div().w(150).flex_shrink_0().child(
          new Select("rmq-msg-mode", () => modes, (item) => div().child(item.label), (value, cx) => {
            this.switchMode(String(value), cx);
          }).placeholder(activeMode.label).menu_width(140)))
        .child(div().flex_1().min_w_0().truncate().text_size(12)
          .text_color(this.error ? cx.theme().colors.destructive : cx.theme().colors.muted_foreground)
          .child(this.error ? `错误: ${this.error}` : this.status)))
      .child(this.fieldsRow(cx))
      // 两列都必须自己声明 h_full():h_flex 默认 items_center,不声明的列会按
      // 内容高度居中塌成一行高 —— 列表与详情就看不到内容了。
      .child(h_flex().flex_1().min_h_0().min_w_0().items_stretch()
        .child(v_flex().flex_1().min_w_0().min_h_0().h_full().border_1().rounded(6)
          .child(this.rowsHeader(cx))
          .child(div().flex_1().min_h_0().overflow_y_scrollbar()
            .children(this.rows.length
              ? this.rows.map((message) => this.row(cx, message))
              : [emptyView(cx, this.queried
                  ? "没有匹配的消息,试试放宽时间窗口或换一种查询模式"
                  : "进入页面不会自动查询 —— 填好条件后点「查询」")])))
        .child(div().w(360).flex_shrink_0().h_full().min_h_0().border_1().rounded(6)
          .child(this.detail(cx))));
  }
}
