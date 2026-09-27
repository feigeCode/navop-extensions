// MQTT 消息浏览:轮询 provider 的历史缓冲增量拉取,收/发消息同一时间线。
//
// 轮询 / 水位 / 去重 / 换代判定 / 退避重连都在 ui/feed.js(与主题树页共用),
// 这里只负责列表与详情的呈现。
import { Buffer } from "buffer";
import { View, div } from "gpui";
import { h_flex, v_flex, InputState } from "gpui-base";
import { Button, Clipboard, Input, Select, Tag } from "gpui-component";
import { dispatch } from "navop.workbench";
import { MessageFeed } from "./feed.js";
import { diffLines, diffSummary, flattenJson, parseJson } from "./payload.js";
import {
  FORMAT_OPTIONS, decodePayload, errorMessage, feedBanner, formatTime, humanBytes, kv,
  payloadSize, props, topicMatches,
} from "./shared.js";

/** 详情区视图模式。 */
const VIEW_MODES = [
  { id: "text", label: "文本" },
  { id: "tree", label: "JSON 树" },
  { id: "diff", label: "与上一帧对比" },
];

/** 完整内容的纯文本(用于 JSON 解析与 diff);body_text 缺失时回退字节解码。 */
function plainText(message) {
  if (!message) return "";
  if (typeof message.body_text === "string") return message.body_text;
  if (Array.isArray(message.body)) return Buffer.from(message.body).toString("utf8");
  return "";
}

export default class MqttMessages extends View {
  init(_props, cx) {
    this.feed = new MessageFeed({
      // 换代重读时列表整体作废:选中行与已取回的详情都属于旧进程
      onReset: () => {
        this.selected = null;
        this.detailMessage = null;
        this.detailError = null;
      },
      onUpdate: (cx) => cx.notify(),
    });
    this.format = "text";
    this.direction = "all";
    this.selected = null;
    this.detailMessage = null;
    this.detailError = null;
    /** 详情区模式:文本 / JSON 树 / 与上一帧对比。 */
    this.viewMode = "text";
    /** JSON 树的展开路径集合(数据刷新时保留)。 */
    this.jsonExpanded = new Set();
    /** 同主题的上一帧(用于 diff)与其加载状态。 */
    this.prevMessage = null;
    this.prevLoading = false;
    this.prevError = null;
    /** 行内二次确认的武装键(大 payload 重发 / 清除 retained)。 */
    this.armed = null;
    this.actionStatus = null;
    this.actionError = false;
    this.topicFilter = InputState.new({ value: "", placeholder: "主题过滤(支持 + / #)" });
    this.keyword = InputState.new({ value: "", placeholder: "关键字(主题或内容)" });
    this.topicFilter.on("change", (_e, cx) => cx.notify());
    this.keyword.on("change", (_e, cx) => cx.notify());
    this.feed.start(cx);
  }

  /** 按 ID 取回一条消息的完整字节:列表只带预览,详情按需拉单条。 */
  async fetchMessage(row) {
    if (Array.isArray(row?.body)) return row;
    const result = await dispatch("queryById", {
      ById: { topic: row.topic, message_id: row.message_id },
    });
    const found = (result?.messages || [])[0];
    if (!found) throw new Error("这条消息已不在 provider 缓冲里(默认只保留最近若干条)");
    return found;
  }

  /** 当前选中消息的完整文本(详情未回来时退回列表预览)。 */
  selectedText() {
    return plainText(this.detailMessage) || plainText(this.selected);
  }

  /** 同主题的上一帧:列表按时间倒序,取选中行之后的第一条同主题行。 */
  previousRow() {
    const m = this.selected;
    if (!m) return null;
    const rows = this.feed.rows;
    const index = rows.findIndex((row) => row.message_id === m.message_id);
    if (index < 0) return null;
    for (let i = index + 1; i < rows.length; i += 1) {
      if (rows[i].topic === m.topic) return rows[i];
    }
    return null;
  }

  /** 对比上一帧:上一帧可能不在列表里(更早的已滚出缓冲),取不到就直说。 */
  async loadPrevious(cx) {
    if (this.prevLoading) return;
    const row = this.previousRow();
    if (!row) {
      this.prevMessage = null;
      this.prevError = "这是该主题在本页缓冲里的第一条消息,没有可比对的上一帧";
      cx.notify();
      return;
    }
    const target = this.selected?.message_id ?? null;
    this.prevLoading = true;
    this.prevError = null;
    cx.notify();
    try {
      const found = await this.fetchMessage(row);
      // 期间用户可能点了别的行:只在仍选中同一条时回填
      if (this.selected?.message_id !== target) return;
      this.prevMessage = found;
    } catch (error) {
      this.prevMessage = null;
      this.prevError = errorMessage(error);
    }
    this.prevLoading = false;
    cx.notify();
  }

  setAction(text, isError, cx) {
    this.actionStatus = text;
    this.actionError = Boolean(isError);
    if (cx) cx.notify();
  }

  /**
   * 以选中消息的主题与内容重新发布。
   *
   * 与 publish.js 同一约定:大 payload 会放大 IPC 帧,第一次点击只做预告,
   * 第二次才真发;小消息单击即发。
   */
  async republish(cx) {
    const m = this.selected;
    if (!m) return;
    const topic = m.topic || "";
    const p = props(m);
    if (!topic || topic.includes("+") || topic.includes("#")) {
      this.setAction(`主题“${topic}”不是可发布的具体主题(含通配符或为空)`, true, cx);
      return;
    }
    const text = this.selectedText();
    const bytes = Buffer.from(text, "utf8");
    const key = `pub:${topic}:${bytes.length}`;
    if (bytes.length > 256 * 1024 && this.armed !== key) {
      this.armed = key;
      this.setAction(`内容约 ${humanBytes(bytes.length)},体积偏大;再点一次确认发布到 ${topic}`, false, cx);
      return;
    }
    this.armed = null;
    this.setAction("发布中…", false, cx);
    try {
      const result = await dispatch("publish", {
        topic,
        body: Array.from(bytes),
        properties: [["qos", p.qos || "1"], ["retain", p.retain === "true" ? "true" : "false"]],
      }, { confirmed: true });
      this.setAction(`已发布到 ${topic} · ${humanBytes(bytes.length)} · ${result?.message_id || ""}`, false, cx);
    } catch (error) {
      this.setAction(`发布失败: ${errorMessage(error)}`, true, cx);
    }
  }

  /**
   * 清除该主题的 retained 消息(空 payload + retain)。
   *
   * 只对**具体主题**开放:通配符会把同层其它主题的 retained 一起清掉。
   */
  async clearRetained(cx) {
    const m = this.selected;
    if (!m) return;
    const topic = m.topic || "";
    if (!topic || topic.includes("+") || topic.includes("#")) {
      this.setAction(`只能对具体主题清除 retained,当前是“${topic}”`, true, cx);
      return;
    }
    const key = `retain:${topic}`;
    if (this.armed !== key) {
      this.armed = key;
      this.setAction(`再点一次确认:以空 payload 向 ${topic} 发布 retained,该主题的保留消息将被删除`, false, cx);
      return;
    }
    this.armed = null;
    this.setAction("清除中…", false, cx);
    try {
      await dispatch("publish", {
        topic,
        body: [],
        properties: [["qos", props(m).qos || "1"], ["retain", "true"]],
      }, { confirmed: true });
      this.setAction(`已向 ${topic} 发送空 retained,保留消息应已被 broker 删除`, false, cx);
    } catch (error) {
      this.setAction(`清除失败: ${errorMessage(error)}`, true, cx);
    }
  }

  /** 选中一行并取回完整字节;对比模式下顺带拉取上一帧。 */
  async select(message, cx) {
    // 换一条消息:与上一帧的对比结果、行内二次确认都随之作废
    this.prevMessage = null;
    this.prevError = null;
    this.armed = null;
    this.actionStatus = null;
    this.actionError = false;
    this.selected = message;
    this.detailMessage = Array.isArray(message.body) ? message : null;
    this.detailError = null;
    cx.notify();
    if (this.viewMode === "diff") cx.spawn(async (cx) => this.loadPrevious(cx));
    if (this.detailMessage) return;
    try {
      const found = await this.fetchMessage(message);
      // 期间用户可能点了别的行:只在仍选中同一条时回填
      if (!this.selected || this.selected.message_id !== message.message_id) return;
      this.detailMessage = found || null;
    } catch (error) {
      if (!this.selected || this.selected.message_id !== message.message_id) return;
      this.detailError = errorMessage(error);
    }
    cx.notify();
  }

  visible() {
    const filter = this.topicFilter.value().trim();
    const needle = this.keyword.value().trim().toLowerCase();
    return this.feed.rows.filter((m) => {
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
      // 选中行高亮走主题的 accent(与 dev-tools 选中行同一 token),不要硬编码
      // 颜色 —— 否则切主题后与其余组件不一致。
      // 注意:`cx.theme().colors` 只认 ColorTokens 的 18 个名字,`list_active`
      // 之类 gpui-component 的扩展 token 在 shell 侧不存在,写了会解析成
      // undefined 并让整页渲染失败。
      .when(active, (el) => el.bg(cx.theme().colors.accent))
      .on_click((_e, cx) => cx.spawn(async (cx) => this.select(m, cx)))
      .child(h_flex().items_center().gap(6)
        .child(new Tag().size("xsmall").variant(out ? "info" : "success").child(out ? "OUT" : "IN"))
        .child(div().flex_1().min_w_0().text_ellipsis().font_family("monospace").text_size(12).child(m.topic || ""))
        .child(new Tag().size("xsmall").outline().child(p.qos || "QoS ?"))
        .children(p.retain === "true" ? [new Tag().size("xsmall").variant("warning").child("R")] : [])
        .child(div().text_color(cx.theme().colors.muted_foreground).text_size(11).whitespace_nowrap().child(formatTime(m))))
      .child(div().text_size(12).text_color(cx.theme().colors.muted_foreground).text_ellipsis().child(preview));
  }

  /** JSON 树的一行:可展开的路径可点击折叠/展开(折叠态按路径保留)。 */
  treeRow(cx, row) {
    const muted = cx.theme().colors.muted_foreground;
    return h_flex().id(`mqtt-msg-tree-${row.path}`).items_start().gap(6).py(2)
      .when(row.depth > 0, (el) => el.pl(row.depth * 12))
      .when(row.expandable, (el) => el.cursor_pointer().on_click((_e, cx) => {
        if (this.jsonExpanded.has(row.path)) this.jsonExpanded.delete(row.path);
        else this.jsonExpanded.add(row.path);
        cx.notify();
      }))
      .child(div().flex_shrink_0().text_size(11).text_color(muted)
        .child(row.expandable ? (row.expanded ? "▾" : "▸") : "·"))
      .children(row.key
        ? [div().flex_shrink_0().text_size(12).text_color(cx.theme().colors.primary).child(`${row.key}:`)]
        : [])
      .child(div().flex_1().min_w_0().text_size(12)
        .text_color(row.kind === "string" ? cx.theme().colors.foreground : muted)
        .child(row.preview));
  }

  /** diff 的一行:增/删/未变三态。 */
  diffRow(cx, row) {
    const color = row.kind === "add"
      ? cx.theme().colors.primary
      : (row.kind === "del" ? cx.theme().colors.destructive : cx.theme().colors.muted_foreground);
    const sign = row.kind === "add" ? "+" : (row.kind === "del" ? "-" : " ");
    return h_flex().items_start().gap(6).py(1)
      .child(div().w(10).flex_shrink_0().text_size(11).text_color(color).child(sign))
      .child(div().flex_1().min_w_0().text_size(12).font_family("monospace").text_color(color)
        .child(row.text === "" ? " " : row.text));
  }

  /** 详情区主体:文本 / JSON 树 / 与上一帧对比三选一。 */
  detailBody(cx, m) {
    const full = this.detailMessage || m;
    const text = plainText(full) || plainText(m);
    if (this.viewMode === "tree") {
      const parsed = parseJson(text);
      if (!parsed.ok) {
        return [div().p(8).text_size(12).text_color(cx.theme().colors.destructive)
          .child(`不是合法 JSON:${parsed.reason}`)];
      }
      const rows = flattenJson(parsed.value, { expanded: this.jsonExpanded });
      return rows.map((row) => this.treeRow(cx, row));
    }
    if (this.viewMode === "diff") {
      if (this.prevLoading) {
        return [div().p(8).text_size(12).text_color(cx.theme().colors.muted_foreground).child("读取上一帧…")];
      }
      if (this.prevError) {
        return [div().p(8).text_size(12).text_color(cx.theme().colors.muted_foreground).child(this.prevError)];
      }
      if (!this.prevMessage) {
        return [div().p(8).text_size(12).text_color(cx.theme().colors.muted_foreground).child("暂无对比结果")];
      }
      const rows = diffLines(plainText(this.prevMessage), text);
      const summary = diffSummary(rows);
      return [div().px(6).py(2).text_size(11).text_color(cx.theme().colors.muted_foreground)
        .child(`对比上一帧(${this.prevMessage.message_id}):+${summary.added} / -${summary.removed}`)]
        .concat(rows.map((row) => this.diffRow(cx, row)));
    }
    return [div().child(decodePayload(full, this.format))];
  }

  detail(cx) {
    const m = this.selected;
    if (!m) {
      return v_flex().size_full().items_center().justify_center()
        .child(div().text_color(cx.theme().colors.muted_foreground).text_size(12).child("选择一条消息查看详情"));
    }
    const p = props(m);
    // 列表只带预览(provider 侧截断):完整内容在选中时按 ID 单取,不再把
    // 每页 200 条 × 完整 payload 塞进响应帧。
    const full = this.detailMessage || m;
    const bytes = Array.isArray(this.detailMessage?.body) ? this.detailMessage.body.length : null;
    const text = plainText(full) || plainText(m);
    const republishArmed = String(this.armed || "").startsWith("pub:");
    const clearArmed = String(this.armed || "").startsWith("retain:");
    return v_flex().size_full().min_h_0().p(10).gap(6)
      .child(h_flex().items_center().justify_between().gap(6).min_w_0()
        .child(div().flex_1().min_w_0().text_ellipsis().font_semibold().text_size(13).child("消息详情"))
        // 格式选择器只在文本模式有意义(树形与 diff 都是结构化展示)。
        .children(this.viewMode === "text"
          ? [div().w(120).flex_shrink_0().child(
              new Select("mqtt-msg-format", () => FORMAT_OPTIONS, (row) => div().child(row.label), (value, cx) => {
                this.format = String(value);
                cx.notify();
              }).placeholder(`格式: ${this.format}`).menu_width(140))]
          : [])
        // 同 subscriptions.js:选择器自带整行宽度,裸着当行子元素会把标题挤没。
        .child(div().w(140).flex_shrink_0().child(
          new Select("mqtt-msg-view", () => VIEW_MODES, (row) => div().child(row.label), (value, cx) => {
            this.viewMode = String(value);
            if (this.viewMode === "diff" && !this.prevMessage) cx.spawn(async (cx) => this.loadPrevious(cx));
            cx.notify();
          }).placeholder(VIEW_MODES.find((v) => v.id === this.viewMode)?.label || "文本").menu_width(160))))
      .child(h_flex().items_center().gap(6).min_w_0()
        .child(div().w(96).flex_shrink_0().text_size(12).text_color(cx.theme().colors.muted_foreground).child("主题"))
        .child(div().flex_1().min_w_0().text_size(12).font_family("monospace").text_ellipsis().child(m.topic || ""))
        .child(new Clipboard("mqtt-msg-copy-topic").value(m.topic || "").tooltip("复制主题")
          .child(new Tag().size("xsmall").outline().child("复制主题"))))
      .child(kv(cx, "方向", p.direction === "out" ? "发送" : "接收"))
      .child(kv(cx, "QoS / Retain", `${p.qos || "-"} / ${p.retain || "false"}`))
      .child(kv(cx, "时间", m.store_time || formatTime(m)))
      .child(kv(cx, "大小", humanBytes(bytes ?? (Number(p.payload_size) || payloadSize(m)))))
      .children(this.detailError
        ? [div().text_size(11).text_color(cx.theme().colors.destructive).child(this.detailError)]
        : (!Array.isArray(this.detailMessage?.body) && !Array.isArray(m.body)
            ? [div().text_size(11).text_color(cx.theme().colors.muted_foreground).child("完整内容读取中…")]
            : []))
      // 操作行:复制主题/内容(Clipboard 组件直写系统剪贴板)、重发、清除 retained。
      // 重发与 retained 清除都是**会改 broker 状态**的动作:第一次点只做预告(见
      // republish / clearRetained),第二次才真发。
      .child(h_flex().items_center().gap(6).flex_wrap().min_w_0()
        .child(new Clipboard("mqtt-msg-copy-body").value(text).tooltip("复制内容")
          .child(new Tag().size("xsmall").outline().child("复制内容")))
        .child(new Button("mqtt-msg-republish").ghost().size("xsmall")
          .label(republishArmed ? "确认发布" : "以此内容发布")
          .disabled(!text)
          .on_click((_e, cx) => cx.spawn(async (cx) => this.republish(cx))))
        .children(p.retain === "true"
          ? [new Button("mqtt-msg-clear-retained").ghost().size("xsmall")
              .label(clearArmed ? "确认清除 retained" : "清除 retained")
              .on_click((_e, cx) => cx.spawn(async (cx) => this.clearRetained(cx)))]
          : []))
      .children(this.actionStatus
        ? [div().text_size(11).text_ellipsis()
            .text_color(this.actionError ? cx.theme().colors.destructive : cx.theme().colors.muted_foreground)
            .child(this.actionStatus)]
        : [])
      .child(div().flex_1().min_h_0().overflow_y_scrollbar().border_1().rounded(6).p(8)
        .font_family("monospace").text_size(12)
        .children(this.detailBody(cx, m)));
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
          .child(div().flex_1().min_w_0().child(new Input(this.topicFilter)))
          .child(div().flex_1().min_w_0().child(new Input(this.keyword)))
          .child(div().w(110).flex_shrink_0().child(
            new Select("mqtt-msg-dir", () => directions, (row) => div().child(row.label), (value, cx) => {
              this.direction = String(value);
              cx.notify();
            }).placeholder(directions.find((d) => d.id === this.direction)?.label || "全部").menu_width(120)))
          .child(div().flex_shrink_0().text_color(cx.theme().colors.muted_foreground).text_size(11).whitespace_nowrap().child(`${visible.length} / ${this.feed.rows.length}`))
          .child(new Button("mqtt-msg-pause").ghost().size("small").flex_shrink_0()
            .label(this.feed.paused ? "继续" : "暂停")
            .on_click((_e, cx) => { this.feed.paused = !this.feed.paused; cx.notify(); }))
          .child(new Button("mqtt-msg-clear").ghost().size("small").flex_shrink_0().label("清空")
            .on_click((_e, cx) => {
              this.feed.clear();
              this.prevMessage = null;
              this.prevError = null;
              this.armed = null;
              this.actionStatus = null;
              cx.notify();
            })))
        // 状态条分三类:provider 断开(自动退避重连)、不可自愈的错误(停止轮询 +
        // 手动重试)、换代提示。与主题树页共用(shared.js::feedBanner)。
        .children(feedBanner(cx, this.feed))
        .child(div().flex_1().min_h_0().overflow_y_scrollbar()
          .children(visible.length
            ? visible.map((m) => this.row(cx, m))
            : [div().p(16).text_color(cx.theme().colors.muted_foreground).text_size(12)
                .child(this.feed.rows.length ? "没有匹配过滤条件的消息" : "等待消息…请确认已订阅相关主题")])))
      .child(div().w(420).flex_shrink_0().h_full().min_h_0().border_l_1().child(this.detail(cx)));
  }
}
