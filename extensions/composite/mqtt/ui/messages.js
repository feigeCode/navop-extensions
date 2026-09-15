// MQTT 消息浏览:轮询 provider 的历史缓冲增量拉取,收/发消息同一时间线。
//
// 嵌入式工作台页面不能使用 navop.event(CustomPageHost 契约),
// 因此以 queryByWindow 增量轮询代替事件流:按 received_at_ms 取窗口,
// 用合成 ID `mqtt-<seq>` 的单调序号去重。
import { View, div } from "gpui";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import { Button, Select, Tag } from "gpui-component";
import { dispatch } from "navop.workbench";
import {
  FORMAT_OPTIONS, decodePayload, errorMessage, formatTime, humanBytes, kv, payloadSize, props, topicMatches,
} from "./shared.js";

const POLL_MS = 1000;
const PAGE_SIZE = 200;
const MAX_ROWS = 2000;

function seqOf(message) {
  const match = /^mqtt-(\d+)$/.exec(message.message_id || "");
  return match ? Number(match[1]) : -1;
}

export default class MqttMessages extends View {
  init(_props, cx) {
    this.rows = [];
    this.lastSeq = -1;
    this.lastMs = 0;
    this.paused = false;
    this.error = null;
    this.polling = false;
    this.format = "text";
    this.direction = "all";
    this.selected = null;
    this.topicFilter = InputState.new({ value: "", placeholder: "主题过滤(支持 + / #)" });
    this.keyword = InputState.new({ value: "", placeholder: "关键字(主题或内容)" });
    this.topicFilter.on("change", (_e, cx) => cx.notify());
    this.keyword.on("change", (_e, cx) => cx.notify());
    cx.spawn(async (cx) => this.poll(cx));
    this.timer = cx.timer.every(POLL_MS, (cx) => {
      if (!this.paused) return this.poll(cx);
    });
  }

  async poll(cx) {
    if (this.polling) return;
    this.polling = true;
    try {
      let page = 1;
      let incoming = [];
      for (;;) {
        const result = await dispatch("queryByWindow", {
          ByTimeWindow: { topic: "#", begin_unix_ms: this.lastMs, end_unix_ms: 9007199254740991, page, page_size: PAGE_SIZE },
        });
        incoming = incoming.concat((result?.messages || []).filter((m) => seqOf(m) > this.lastSeq));
        if (!result?.has_more || page >= 10) break;
        page += 1;
      }
      if (incoming.length) {
        incoming.sort((a, b) => seqOf(a) - seqOf(b));
        for (const m of incoming) {
          this.lastSeq = Math.max(this.lastSeq, seqOf(m));
          this.lastMs = Math.max(this.lastMs, Number(props(m).received_at_ms) || 0);
        }
        this.rows = incoming.reverse().concat(this.rows).slice(0, MAX_ROWS);
      }
      this.error = null;
    } catch (error) {
      this.error = errorMessage(error);
    }
    this.polling = false;
    cx.notify();
  }

  visible() {
    const filter = this.topicFilter.value().trim();
    const needle = this.keyword.value().trim().toLowerCase();
    return this.rows.filter((m) => {
      if (this.direction !== "all" && props(m).direction !== this.direction) return false;
      if (filter && !topicMatches(filter, m.topic || "")) return false;
      if (needle) {
        const hay = `${m.topic || ""}\n${m.body_text || ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }

  row(cx, m) {
    const p = props(m);
    const out = p.direction === "out";
    const active = this.selected && this.selected.message_id === m.message_id;
    const preview = (m.body_text ?? `<binary ${payloadSize(m)} B>`).replace(/\s+/g, " ").slice(0, 160);
    return v_flex().px(10).py(5).gap(2).border_b_1().cursor_pointer()
      .when(active, (el) => el.bg("#3b82f622"))
      .on_click((_e, cx) => { this.selected = m; cx.notify(); })
      .child(h_flex().items_center().gap(6)
        .child(new Tag().size("xsmall").variant(out ? "info" : "success").child(out ? "OUT" : "IN"))
        .child(div().flex_1().min_w_0().text_ellipsis().font_family("monospace").text_size(12).child(m.topic || ""))
        .child(new Tag().size("xsmall").outline().child(p.qos || "QoS ?"))
        .children(p.retain === "true" ? [new Tag().size("xsmall").variant("warning").child("R")] : [])
        .child(div().text_color(cx.theme().colors.muted_foreground).text_size(11).whitespace_nowrap().child(formatTime(m))))
      .child(div().text_size(12).text_color(cx.theme().colors.muted_foreground).text_ellipsis().child(preview));
  }

  detail(cx) {
    const m = this.selected;
    if (!m) {
      return v_flex().size_full().items_center().justify_center()
        .child(div().text_color(cx.theme().colors.muted_foreground).text_size(12).child("选择一条消息查看详情"));
    }
    const p = props(m);
    return v_flex().size_full().min_h_0().p(10).gap(6)
      .child(h_flex().items_center().justify_between().gap(6).min_w_0()
        .child(div().flex_1().min_w_0().text_ellipsis().font_semibold().text_size(13).child("消息详情"))
        // 同 subscriptions.js:选择器自带整行宽度,裸着当行子元素会把标题挤没。
        .child(div().w(150).flex_shrink_0().child(
          new Select("mqtt-msg-format", () => FORMAT_OPTIONS, (row) => div().child(row.label), (value, cx) => {
            this.format = String(value);
            cx.notify();
          }).placeholder(`格式: ${this.format}`).menu_width(140))))
      .child(kv(cx, "主题", m.topic))
      .child(kv(cx, "方向", p.direction === "out" ? "发送" : "接收"))
      .child(kv(cx, "QoS / Retain", `${p.qos || "-"} / ${p.retain || "false"}`))
      .child(kv(cx, "时间", m.store_time || formatTime(m)))
      .child(kv(cx, "大小", humanBytes(payloadSize(m))))
      .child(kv(cx, "ID", m.message_id))
      .child(div().flex_1().min_h_0().overflow_y_scrollbar().border_1().rounded(6).p(8)
        .font_family("monospace").text_size(12)
        .child(decodePayload(m, this.format)));
  }

  render(cx) {
    const visible = this.visible();
    const directions = [
      { id: "all", label: "全部" },
      { id: "in", label: "仅接收" },
      { id: "out", label: "仅发送" },
    ];
    return h_flex().size_full().min_w_0().min_h_0().items_stretch()
      // 行内的两列都必须自己声明 h_full():`h_flex` 默认 items_center,
      // 不声明的列会按内容高度居中 —— 消息列表与详情都会塌成一行高。
      .child(v_flex().flex_1().min_w_0().min_h_0().h_full()
        // 过滤器用 flex_1 + min_w_0 而不是固定宽度:固定宽度会让工具行的
        // 最小宽度超过主列,把右侧详情挤出屏幕。
        .child(h_flex().items_center().gap(6).p(8).border_b_1().min_w_0()
          .child(div().flex_1().min_w_0().child(Input.new(this.topicFilter)))
          .child(div().flex_1().min_w_0().child(Input.new(this.keyword)))
          .child(div().w(110).flex_shrink_0().child(
            new Select("mqtt-msg-dir", () => directions, (row) => div().child(row.label), (value, cx) => {
              this.direction = String(value);
              cx.notify();
            }).placeholder(directions.find((d) => d.id === this.direction)?.label || "全部").menu_width(120)))
          .child(div().flex_shrink_0().text_color(cx.theme().colors.muted_foreground).text_size(11).whitespace_nowrap().child(`${visible.length} / ${this.rows.length}`))
          .child(new Button("mqtt-msg-pause").ghost().size("small").flex_shrink_0()
            .label(this.paused ? "继续" : "暂停")
            .on_click((_e, cx) => { this.paused = !this.paused; cx.notify(); }))
          .child(new Button("mqtt-msg-clear").ghost().size("small").flex_shrink_0().label("清空")
            .on_click((_e, cx) => { this.rows = []; this.selected = null; cx.notify(); })))
        .children(this.error ? [div().px(10).py(4).text_color(cx.theme().colors.destructive).text_size(12).child(`轮询失败: ${this.error}`)] : [])
        .child(div().flex_1().min_h_0().overflow_y_scrollbar()
          .children(visible.length
            ? visible.map((m) => this.row(cx, m))
            : [div().p(16).text_color(cx.theme().colors.muted_foreground).text_size(12)
                .child(this.rows.length ? "没有匹配过滤条件的消息" : "等待消息…请确认已订阅相关主题")])))
      .child(div().w(360).flex_shrink_0().h_full().min_h_0().border_l_1().child(this.detail(cx)));
  }
}
