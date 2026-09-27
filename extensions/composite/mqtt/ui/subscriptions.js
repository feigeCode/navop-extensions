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
import { h_flex, v_flex, InputState, TextareaState } from "gpui-base";
import { Button, Input, Select, Tag, Textarea } from "gpui-component";
import { dispatch } from "navop.workbench";
import * as context from "navop.context";
import {
  QOS_OPTIONS, banner, errorView, errorMessage, isTransientError, isValidFilter, loadingView, qosLabel,
} from "./shared.js";

/** provider 对自动订阅给出的 topic_type(见 admin.rs)。 */
const AUTO_TOPIC_TYPE = "AUTO_SUBSCRIPTION";

/**
 * 过滤器收藏的存储键。
 *
 * 用 `localStorage`(宿主里是文件,重启仍在)而不是宿主 KV:收藏是纯前端的
 * 便利数据,不值得为它再走一轮 provider 往返;宿主 KV 还会随 provider 换代清空。
 */
const COLLECTION_KEY = "mqtt.subscription.favorites";

/** 收藏的过滤器(去重、只保留合法过滤器;存储不可用时按空处理)。 */
function readFavorites() {
  try {
    const raw = localStorage.getItem(COLLECTION_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((item) => typeof item === "string" && item) : [];
  } catch {
    return [];
  }
}

/** 写回收藏;返回是否成功(存储被禁用时 UI 据此给出提示而不是假装保存了)。 */
function writeFavorites(list) {
  try {
    localStorage.setItem(COLLECTION_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

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
    /** 批量订阅输入(每行一个过滤器)与展开状态 */
    this.batchOpen = false;
    this.batch = TextareaState.new({ value: "", placeholder: "每行一个主题过滤器,例如:\nsensors/+/temp\ndevices/#", rows: 4 });
    /** 收藏的过滤器(localStorage) */
    this.favorites = readFavorites();
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

  /**
   * 批量订阅:一行一个过滤器,逐个下发。
   *
   * 不把所有行合成一次调用 —— provider 的 subscribe 是单条语义,而部分成功
   * 比全有全无更有用:成功多少、哪几行不合法都要如实告知。
   */
  async subscribeBatch(cx) {
    const lines = String(this.batch.value() || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) {
      this.notice = "批量输入为空:每行写一个主题过滤器";
      this.noticeError = true;
      cx.notify();
      return;
    }
    const invalid = lines.filter((line) => !isValidFilter(line));
    const valid = lines.filter((line) => isValidFilter(line) && line !== this.autoFilter);
    const skipped = lines.length - valid.length - invalid.length;
    this.busy = true;
    this.notice = null;
    this.noticeError = false;
    cx.notify();
    let done = 0;
    const failures = [];
    for (const topic of valid) {
      try {
        // 每次订阅都是用户明确点「批量订阅」后发起的,confirmed 由该交互授权
        await dispatch("subscribe", { topic, qos: Number(this.qos) }, { confirmed: true });
        done += 1;
      } catch (error) {
        failures.push(`${topic}(${errorMessage(error)})`);
      }
    }
    this.busy = false;
    this.notice = `批量订阅完成:成功 ${done} 条` + (skipped ? `,跳过 ${skipped} 条(已由自动订阅覆盖)` : "")
      + (invalid.length ? `,非法 ${invalid.length} 条:${invalid.join("、")}` : "")
      + (failures.length ? `,失败 ${failures.length} 条:${failures.join(";")}` : "");
    this.noticeError = invalid.length > 0 || failures.length > 0;
    if (done > 0 && !failures.length) this.batch.set_value("");
    await this.load(cx);
  }

  /** 收藏/取消收藏一个过滤器(不触碰 provider)。 */
  toggleFavorite(filter, cx) {
    if (!filter) return;
    const exists = this.favorites.includes(filter);
    const next = exists ? this.favorites.filter((item) => item !== filter) : [...this.favorites, filter];
    if (!writeFavorites(next)) {
      this.notice = "本机浏览器存储不可用,收藏无法保存";
      this.noticeError = true;
      cx.notify();
      return;
    }
    this.favorites = next;
    this.notice = exists ? `已取消收藏 ${filter}` : `已收藏 ${filter}`;
    this.noticeError = false;
    cx.notify();
  }

  /** 用当前过滤器输入框内容发起订阅(收藏项点击后直接订阅)。 */
  async subscribeTopic(topic, cx) {
    if (!isValidFilter(topic)) {
      this.notice = `过滤器非法: \`${topic}\``;
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
      this.notice = `已订阅 ${topic}(${qosLabel(this.qos)})`;
    } catch (error) {
      this.notice = `订阅失败: ${errorMessage(error)}`;
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
          .child(this.notice)] : [])
        .child(h_flex().items_center().gap(6).flex_wrap().min_w_0()
          .child(new Button("mqtt-sub-batch-toggle").ghost().size("xsmall")
            .label(this.batchOpen ? "收起批量输入" : "批量订阅(MQTTX 支持逐行粘贴)")
            .on_click((_e, cx) => { this.batchOpen = !this.batchOpen; cx.notify(); }))
          .child(new Button("mqtt-sub-favorite-add").ghost().size("xsmall")
            .label(this.favorites.includes(this.filter.value().trim()) ? "取消收藏当前过滤器" : "收藏当前过滤器")
            .on_click((_e, cx) => this.toggleFavorite(this.filter.value().trim(), cx)))
          .child(div().flex_1().min_w_0()))
        .children(this.batchOpen
          ? [
            div().flex_shrink_0().child(new Textarea(this.batch)),
            h_flex().items_center().gap(6)
              .child(new Button("mqtt-sub-batch-run").size("small").label(this.busy ? "处理中…" : "订阅全部")
                .disabled(this.busy)
                .on_click((_e, cx) => cx.spawn(async (cx) => this.subscribeBatch(cx))))
              .child(div().flex_1().min_w_0().text_size(11).text_color(cx.theme().colors.muted_foreground)
                .child("每行一个过滤器;非法行会被跳过并在结果里列出来")),
          ]
          : [])
        .children(this.favorites.length
          ? [h_flex().items_center().gap(6).flex_wrap().min_w_0()
            .child(div().flex_shrink_0().text_size(11).text_color(cx.theme().colors.muted_foreground).child("收藏:"))
            .children(this.favorites.map((filter) => h_flex().id(`mqtt-fav-${filter}`).items_center().gap(4)
              .child(new Button(`mqtt-fav-sub-${filter}`).ghost().size("xsmall").label(filter)
                .on_click((_e, cx) => cx.spawn(async (cx) => this.subscribeTopic(filter, cx))))
              .child(new Button(`mqtt-fav-del-${filter}`).ghost().size("xsmall").label("×")
                .on_click((_e, cx) => this.toggleFavorite(filter, cx)))))]
          : []))
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
