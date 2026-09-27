// MQTT 消息浏览:轮询 provider 的历史缓冲增量拉取,收/发消息同一时间线。
//
// 嵌入式工作台页面不能使用 navop.event(CustomPageHost 契约),
// 因此以 queryByWindow 增量轮询代替事件流。
//
// **水位为什么不能只用序号**:宿主重启 provider 进程后,新进程的缓冲是空的、
// 合成 ID 的序号也从 0 重来。若把 `seq > lastSeq` 当成唯一去重条件,重启后所有
// 新消息都会被判成"已读"而永久消失(这正是"点几下消息就没了"的成因之一)。
// 现在:
//   1. 游标用**时间**(begin_unix_ms = 上一批最大的 received_at_ms),跨重启有效;
//   2. 同一批内按 `message_id` 去重,不再依赖跨代次可比的序号;
//   3. 序号**倒退**即判定 provider 换代 → 清空重读。
// 另:嵌入式页面**不允许**声明 navop.runtime 模块(见 shell_page_host
// ::ensure_embeddable),所以拿不到 generation,只能靠这两条信号。
import { View, div } from "gpui";
import { h_flex, v_flex, InputState } from "gpui-base";
import { Button, Input, Select, Tag } from "gpui-component";
import { dispatch } from "navop.workbench";
import {
  FORMAT_OPTIONS, banner, decodePayload, errorMessage, formatTime, humanBytes, kv, parseError,
  payloadSize, props, topicMatches,
} from "./shared.js";

const POLL_MS = 1000;
const PAGE_SIZE = 200;
const MAX_ROWS = 2000;
/** 出错后的退避下限/上限:1s 无退避轮询在 provider 已死时会刷屏报错。 */
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 15000;
/** 换代提示的停留时间(到时自动消失,不要求用户手动关)。 */
const NOTICE_MS = 5000;

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
    this.errorTransient = false;
    this.notice = null;
    this.noticeUntil = 0;
    this.halted = false;
    this.failures = 0;
    this.nextAttemptAt = 0;
    this.needsResync = false;
    this.polling = false;
    this.format = "text";
    this.direction = "all";
    this.selected = null;
    this.detailMessage = null;
    this.detailError = null;
    this.topicFilter = InputState.new({ value: "", placeholder: "主题过滤(支持 + / #)" });
    this.keyword = InputState.new({ value: "", placeholder: "关键字(主题或内容)" });
    this.topicFilter.on("change", (_e, cx) => cx.notify());
    this.keyword.on("change", (_e, cx) => cx.notify());
    cx.spawn(async (cx) => this.poll(cx));
    this.timer = cx.timer.every(POLL_MS, (cx) => {
      if (!this.paused) return this.poll(cx);
    });
  }

  /** 拉取 `beginMs` 之后的消息(最多 10 页),并报告是否发现序号倒退。 */
  async fetchSince(beginMs) {
    let page = 1;
    const messages = [];
    let regression = false;
    for (;;) {
      const result = await dispatch("queryByWindow", {
        ByTimeWindow: {
          topic: "#",
          begin_unix_ms: beginMs,
          // 上界取当前时间:2^53-1 这种哨兵值没有意义,时间窗口也无法作为索引下推
          end_unix_ms: Date.now(),
          page,
          page_size: PAGE_SIZE,
        },
      });
      for (const message of result?.messages || []) {
        // 序号比水位小 ⇒ provider 换了进程(新缓冲从 0 开始)
        if (seqOf(message) >= 0 && seqOf(message) < this.lastSeq) regression = true;
        messages.push(message);
      }
      if (!result?.has_more || page >= 10) break;
      page += 1;
    }
    return { messages, regression };
  }

  /** 丢水位:换代后序号从头开始,旧行与新行不可比,整段重读。 */
  resetWatermarks() {
    this.rows = [];
    this.lastSeq = -1;
    this.lastMs = 0;
    this.selected = null;
    this.detailMessage = null;
    this.detailError = null;
  }

  /** 把一批消息并进列表(按 message_id 去重,不再用跨代次的序号水位)。 */
  merge(messages) {
    if (!messages.length) return 0;
    const seen = new Set(this.rows.map((message) => message.message_id));
    const fresh = [];
    for (const message of messages) {
      if (seen.has(message.message_id)) continue;
      seen.add(message.message_id);
      fresh.push(message);
    }
    if (fresh.length) {
      fresh.sort((a, b) =>
        (Number(props(a).received_at_ms) || 0) - (Number(props(b).received_at_ms) || 0)
        || seqOf(a) - seqOf(b));
      this.rows = fresh.reverse().concat(this.rows).slice(0, MAX_ROWS);
    }
    // 水位始终向前推进,便于下一轮把窗口收窄
    for (const message of messages) {
      this.lastSeq = Math.max(this.lastSeq, seqOf(message));
      this.lastMs = Math.max(this.lastMs, Number(props(message).received_at_ms) || 0);
    }
    return fresh.length;
  }

  async poll(cx) {
    if (this.polling || this.halted) return;
    if (Date.now() < this.nextAttemptAt) return;
    this.polling = true;
    try {
      // 上一次是传输中断:旧行属于已死的那个进程,而新进程的 ID 会与它撞车
      // (又从 `mqtt-0` 开始),所以先清空再从 0 重读一次。
      let resynced = this.needsResync;
      if (resynced) {
        this.resetWatermarks();
        this.needsResync = false;
      }
      let { messages, regression } = await this.fetchSince(this.lastMs);
      if (regression) {
        // 序号倒退 = 换代:旧行与新行不可比,清空后从 0 重读整个缓冲
        this.resetWatermarks();
        messages = (await this.fetchSince(0)).messages;
        resynced = true;
      }
      if (resynced) {
        this.notice = "provider 已重启,消息缓冲已重建(重启前的缓冲无法恢复)";
        this.noticeUntil = Date.now() + NOTICE_MS;
      } else if (Date.now() >= (this.noticeUntil || 0)) {
        this.notice = null;
      }
      this.merge(messages);
      this.error = null;
      this.errorTransient = false;
      this.failures = 0;
      this.nextAttemptAt = 0;
    } catch (error) {
      const info = parseError(error);
      this.error = info.message;
      this.errorTransient = info.transient;
      this.failures += 1;
      if (info.transient) {
        // 传输断了:几乎一定是 provider 进程被换掉了,水位与缓冲一起作废
        this.needsResync = true;
        this.notice = `provider 连接已断开,正在自动重连…(第 ${this.failures} 次)`;
        this.noticeUntil = 0;
        this.nextAttemptAt = Date.now() + Math.min(
          BACKOFF_MIN_MS * 2 ** Math.min(this.failures - 1, 4),
          BACKOFF_MAX_MS,
        );
      } else {
        // 参数/权限这类错误重试没有意义:停下来把控制权交回用户
        this.halted = true;
      }
    }
    this.polling = false;
    cx.notify();
  }

  /** 选中一行并取回完整字节:列表页只带预览,详情按需拉单条。 */
  async select(message, cx) {
    this.selected = message;
    this.detailMessage = Array.isArray(message.body) ? message : null;
    this.detailError = null;
    cx.notify();
    if (this.detailMessage) return;
    try {
      const result = await dispatch("queryById", {
        ById: { topic: message.topic, message_id: message.message_id },
      });
      // 期间用户可能点了别的行:只在仍选中同一条时回填
      if (!this.selected || this.selected.message_id !== message.message_id) return;
      const found = (result?.messages || [])[0];
      this.detailMessage = found || null;
      if (!found) {
        this.detailError = "这条消息已不在 provider 缓冲里(默认只保留最近若干条)";
      }
    } catch (error) {
      if (!this.selected || this.selected.message_id !== message.message_id) return;
      this.detailError = errorMessage(error);
    }
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
      .child(kv(cx, "大小", humanBytes(bytes ?? (Number(p.payload_size) || payloadSize(m)))))
      .child(kv(cx, "ID", m.message_id))
      .children(this.detailError
        ? [div().text_size(11).text_color(cx.theme().colors.destructive).child(this.detailError)]
        : (!Array.isArray(this.detailMessage?.body) && !Array.isArray(m.body)
            ? [div().text_size(11).text_color(cx.theme().colors.muted_foreground).child("完整内容读取中…")]
            : []))
      .child(div().flex_1().min_h_0().overflow_y_scrollbar().border_1().rounded(6).p(8)
        .font_family("monospace").text_size(12)
        .child(decodePayload(full, this.format)));
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
          .child(div().flex_shrink_0().text_color(cx.theme().colors.muted_foreground).text_size(11).whitespace_nowrap().child(`${visible.length} / ${this.rows.length}`))
          .child(new Button("mqtt-msg-pause").ghost().size("small").flex_shrink_0()
            .label(this.paused ? "继续" : "暂停")
            .on_click((_e, cx) => { this.paused = !this.paused; cx.notify(); }))
          .child(new Button("mqtt-msg-clear").ghost().size("small").flex_shrink_0().label("清空")
            .on_click((_e, cx) => {
              this.rows = [];
              this.selected = null;
              this.detailMessage = null;
              cx.notify();
            })))
        // 状态条分三类:provider 断开(自动退避重连)、不可自愈的错误(停止轮询 +
        // 手动重试)、换代提示。base64 envelope 已由 shared.js 剥掉,不再直接
        // 铺在页面上。
        .children(this.error
          ? [banner(cx, `${this.errorTransient ? "连接中断" : "轮询失败"}: ${this.error}`, {
              error: true,
              action: this.halted
                ? {
                    id: "mqtt-msg-retry",
                    label: "重试",
                    on_click: (cx) => {
                      this.halted = false;
                      this.failures = 0;
                      this.nextAttemptAt = 0;
                      this.needsResync = true;
                      cx.spawn(async (cx) => this.poll(cx));
                    },
                  }
                : null,
            })]
          : (this.notice
              ? [banner(cx, this.notice, {})]
              : []))
        .child(div().flex_1().min_h_0().overflow_y_scrollbar()
          .children(visible.length
            ? visible.map((m) => this.row(cx, m))
            : [div().p(16).text_color(cx.theme().colors.muted_foreground).text_size(12)
                .child(this.rows.length ? "没有匹配过滤条件的消息" : "等待消息…请确认已订阅相关主题")])))
      .child(div().w(360).flex_shrink_0().h_full().min_h_0().border_l_1().child(this.detail(cx)));
  }
}
