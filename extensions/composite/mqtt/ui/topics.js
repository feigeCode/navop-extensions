// MQTT 主题树:按 `/` 分层聚合本会话观测到的主题。
//
// 与「消息」页共用同一套轮询引擎(ui/feed.js),因此水位/去重/换代行为一致;
// 差别只在于呈现:消息页是扁平时间线,这里是按主题聚合的树 + 观测到的 retained。
//
// 两条必须说清的事实(否则用户会当成 bug):
//  1. 树是**本会话观测到**的消息聚合出来的,不是 broker 的主题清单 —— MQTT 协议
//     没有"列出所有主题"的接口,没订阅到的主题这里永远看不到。
//  2. 同理,retained 也只能是"订阅过的主题 + 本会话收到过的保留消息"。要一次
//     看全,请在订阅页订阅 `#`(或在连接配置里把 auto_subscribe 设为 `#`)。
import { View, div } from "gpui";
import { h_flex, v_flex, InputState } from "gpui-base";
import { Button, Clipboard, Input, LineChart, Tag } from "gpui-component";
import { dispatch } from "navop.workbench";
import { MessageFeed } from "./feed.js";
import { numericSample } from "./payload.js";
import {
  banner, card, decodePayload, errorMessage, feedBanner, formatTime, humanBytes, payloadSize, props,
} from "./shared.js";

/** 树最多渲染这么多行:帧预算有限,主题爆炸时宁可截断也不要卡住页面。 */
const MAX_TREE_ROWS = 800;
/** 右侧「该分支最近消息」最多展示条数。 */
const BRANCH_ROWS = 30;
/** 预览截断长度(与消息页一致)。 */
const PREVIEW_CHARS = 160;

function makeNode(path, name) {
  return {
    path, name, children: new Map(), count: 0, last: null, lastMs: 0, lastRetained: null,
  };
}

/** 把一个节点上的消息统计并入(取最新的一条;retain=true 的另存一份)。 */
function bump(node, message, ms) {
  node.count += 1;
  if (!node.last || ms >= node.lastMs) {
    // 同一毫秒内的多条按到达顺序取后者:它才是"最后一次观测"
    node.last = message;
    node.lastMs = ms;
  }
  if (props(message).retain === "true" && (!node.lastRetained || ms >= node.lastMs)) {
    node.lastRetained = message;
  }
}

/**
 * 把扁平消息聚合成主题树。
 *
 * 每一层(含中间层 `a/b`)都累计它下面的所有消息,这样选中 `a/b` 就能看到
 * `a/b/c/d` 的消息 —— 与 MQTT Explorer 的语义一致。
 *
 * @param {Array<object>} rows 消息列表(顺序无关)
 */
export function buildTopicTree(rows) {
  const root = makeNode("", "");
  for (const message of rows || []) {
    const topic = String(message?.topic || "");
    if (!topic) continue;
    const ms = Number(props(message).received_at_ms) || 0;
    let node = root;
    bump(node, message, ms);
    for (const part of topic.split("/")) {
      let child = node.children.get(part);
      if (!child) {
        child = makeNode(node.path ? `${node.path}/${part}` : part, part);
        node.children.set(part, child);
      }
      node = child;
      bump(node, message, ms);
    }
  }
  return root;
}

/** 子节点排序:名字升序(`$SYS/...` 会自然排在前面,与 broker 惯例一致)。 */
function sortedChildren(node) {
  return Array.from(node.children.values())
    .sort((a, b) => (a.name < b.name ? -1 : (a.name > b.name ? 1 : 0)));
}

/**
 * 按搜索词过滤:命中的节点连同其祖先与后代一起保留(看到匹配就要能看到它的上下文)。
 * 返回 null 表示"无过滤"。
 */
function matchSet(root, needle) {
  if (!needle) return null;
  const keep = new Set();
  const walk = (node) => {
    const hit = node.path.toLowerCase().includes(needle);
    let descendantHit = false;
    for (const child of node.children.values()) {
      if (walk(child)) descendantHit = true;
    }
    const relevant = hit || descendantHit;
    if (relevant) keep.add(node.path);
    // 命中节点的整棵子树都要展示:否则搜到一个中间层却看不到它下面有什么
    if (hit) {
      const stack = [node];
      while (stack.length) {
        const current = stack.pop();
        keep.add(current.path);
        for (const child of current.children.values()) stack.push(child);
      }
    }
    return relevant;
  };
  walk(root);
  return keep;
}

/** 右侧趋势图最多取多少个样本(再多图也看不清,还白花帧预算)。 */
const TREND_SAMPLES = 60;

/**
 * $SYS 指标的中文名与展示形式(MQTT broker 惯例主题)。
 * 只列常见项,剩下的原样列在「其他 $SYS 主题」里 —— 不装懂、不丢弃。
 */
const SYS_FIELDS = [
  ["$SYS/broker/version", "Broker 版本", "text"],
  ["$SYS/broker/uptime", "运行时长", "text"],
  ["$SYS/broker/clients/connected", "在线客户端", "number"],
  ["$SYS/broker/clients/disconnected", "掉线客户端", "number"],
  ["$SYS/broker/clients/total", "客户端总数", "number"],
  ["$SYS/broker/clients/maximum", "客户端峰值", "number"],
  ["$SYS/broker/subscriptions/count", "订阅数", "number"],
  ["$SYS/broker/retained messages/count", "保留消息", "number"],
  ["$SYS/broker/messages/received", "收到报文", "number"],
  ["$SYS/broker/messages/sent", "发出报文", "number"],
  ["$SYS/broker/messages/stored", "存储报文", "number"],
  ["$SYS/broker/publish/messages/received", "收到 PUBLISH", "number"],
  ["$SYS/broker/publish/messages/sent", "发出 PUBLISH", "number"],
  ["$SYS/broker/publish/messages/dropped", "丢弃报文", "number"],
  ["$SYS/broker/bytes/received", "收到字节", "bytes"],
  ["$SYS/broker/bytes/sent", "发出字节", "bytes"],
  ["$SYS/broker/load/messages/received/1min", "收报文速率(1min)", "number"],
  ["$SYS/broker/load/messages/sent/1min", "发报文速率(1min)", "number"],
  ["$SYS/broker/load/bytes/received/1min", "收字节速率(1min)", "bytes"],
  ["$SYS/broker/load/bytes/sent/1min", "发字节速率(1min)", "bytes"],
];

/**
 * 汇总 $SYS 主题的最新取值(每个主题只取本会话观测到的最新一条)。
 *
 * @param {Array<object>} rows 消息列表(顺序无关)
 * @returns {{known: Array<object>, others: Array<object>}}
 */
export function sysMetrics(rows) {
  const latest = new Map();
  for (const message of rows || []) {
    const topic = String(message?.topic || "");
    if (!topic.startsWith("$SYS/")) continue;
    const ms = Number(props(message).received_at_ms) || 0;
    const current = latest.get(topic);
    if (!current || ms >= current.ms) latest.set(topic, { ms, message });
  }
  const known = [];
  for (const [topic, label, kind] of SYS_FIELDS) {
    const entry = latest.get(topic);
    if (!entry) continue;
    const raw = String(entry.message.body_text ?? "").trim();
    const numeric = kind === "text" ? null : Number(raw);
    const value = kind === "text"
      ? raw
      : (Number.isFinite(numeric) ? (kind === "bytes" ? humanBytes(numeric) : String(numeric)) : raw);
    known.push({ topic, label, value, ms: entry.ms });
    latest.delete(topic);
  }
  const others = Array.from(latest.entries())
    .map(([topic, entry]) => ({
      topic,
      value: String(entry.message.body_text ?? "").trim().replace(/\s+/g, " ").slice(0, PREVIEW_CHARS),
      ms: entry.ms,
    }))
    .sort((a, b) => (a.topic < b.topic ? -1 : (a.topic > b.topic ? 1 : 0)));
  return { known, others };
}

/**
 * 观测到的 retained:每个主题取最新的一条保留消息,按主题排序。
 */
export function retainedTopics(rows) {
  const byTopic = new Map();
  for (const message of rows || []) {
    if (props(message).retain !== "true") continue;
    const topic = String(message.topic || "");
    if (!topic) continue;
    const current = byTopic.get(topic);
    const ms = Number(props(message).received_at_ms) || 0;
    if (!current || ms >= (Number(props(current).received_at_ms) || 0)) byTopic.set(topic, message);
  }
  return Array.from(byTopic.entries())
    .map(([topic, message]) => ({ topic, message }))
    .sort((a, b) => (a.topic < b.topic ? -1 : (a.topic > b.topic ? 1 : 0)));
}

export default class MqttTopics extends View {
  init(_props, cx) {
    this.feed = new MessageFeed({
      // 换代后树与选中节点一起作废:旧节点可能来自已死的那个进程
      onReset: () => {
        this.selected = null;
        this.armed = null;
      },
      onUpdate: (cx) => cx.notify(),
    });
    this.mode = "tree";
    /** 展开的路径集合(按路径保留,数据刷新不丢)。 */
    this.expanded = new Set();
    this.selected = null;
    this.armed = null;
    this.status = null;
    this.statusError = false;
    this.search = InputState.new({ value: "", placeholder: "搜索主题(子串匹配)" });
    this.search.on("change", (_e, cx) => cx.notify());
    this.feed.start(cx);
  }

  /** 树行:点击既选中也折叠/展开(紧凑树里这是最少点击的交互)。 */
  row(cx, node, depth) {
    const active = this.selected === node.path;
    const open = this.expanded.has(node.path);
    const hasChildren = node.children.size > 0;
    const retained = node.lastRetained;
    return h_flex().id(`mqtt-topics-row-${node.path}`).items_center().gap(6).px(8).py(3)
      .cursor_pointer()
      .when(active, (el) => el.bg(cx.theme().colors.accent))
      .on_click((_e, cx) => {
        this.selected = node.path;
        if (hasChildren) {
          if (open) this.expanded.delete(node.path);
          else this.expanded.add(node.path);
        }
        this.armed = null;
        this.status = null;
        cx.notify();
      })
      .child(div().w(depth * 12).flex_shrink_0())
      .child(div().w(10).flex_shrink_0().text_size(11).text_color(cx.theme().colors.muted_foreground)
        .child(hasChildren ? (open ? "▾" : "▸") : "·"))
      .child(div().flex_1().min_w_0().text_ellipsis().font_family("monospace").text_size(12)
        .child(node.name))
      .children(retained
        ? [new Tag().size("xsmall").variant("warning").child("R")]
        : [])
      .child(new Tag().size("xsmall").outline().child(String(node.count)))
      .child(div().text_size(10).text_color(cx.theme().colors.muted_foreground).whitespace_nowrap()
        .child(node.last ? formatTime(node.last) : ""));
  }

  /** 深度优先铺行,带行数上限与搜索过滤。 */
  treeRows(cx) {
    const root = buildTopicTree(this.feed.rows);
    const needle = this.search.value().trim().toLowerCase();
    const keep = matchSet(root, needle);
    const rows = [];
    const walk = (node, depth) => {
      if (rows.length >= MAX_TREE_ROWS) return;
      for (const child of sortedChildren(node)) {
        if (rows.length >= MAX_TREE_ROWS) return;
        if (keep && !keep.has(child.path)) continue;
        rows.push(this.row(cx, child, depth));
        // 搜索时命中路径自动展开,否则用户搜到了还要手动逐层点开
        if (this.expanded.has(child.path) || (keep && child.children.size > 0)) {
          walk(child, depth + 1);
        }
      }
    };
    walk(root, 0);
    if (rows.length >= MAX_TREE_ROWS) {
      rows.push(div().px(8).py(4).text_size(11).text_color(cx.theme().colors.muted_foreground)
        .child(`仅显示前 ${MAX_TREE_ROWS} 行(主题过多,请用搜索收窄)`));
    }
    return rows;
  }

  /** 选中节点的消息(含其所有子主题)。 */
  branchRows() {
    const path = this.selected;
    if (!path) return [];
    const rows = this.feed.rows.filter((m) => {
      const topic = String(m.topic || "");
      return topic === path || topic.startsWith(`${path}/`);
    });
    // feed.rows 已是"新在前",这里保持同一顺序
    return rows.slice(0, BRANCH_ROWS);
  }

  setStatus(text, isError, cx) {
    this.status = text;
    this.statusError = Boolean(isError);
    if (cx) cx.notify();
  }

  /** 订阅选中分支:`topic` 精确订阅,`topic/#` 订阅整棵子树。 */
  async subscribe(path, wildcard, cx) {
    const topic = wildcard ? `${path}/#` : path;
    if (!topic || topic.includes("+")) {
      this.setStatus(`无法订阅 “${topic}”`, true, cx);
      return;
    }
    this.setStatus("订阅中…", false, cx);
    try {
      await dispatch("subscribe", { topic, qos: 1 }, { confirmed: true });
      this.setStatus(`已订阅 ${topic}`, false, cx);
    } catch (error) {
      this.setStatus(`订阅失败: ${errorMessage(error)}`, true, cx);
    }
  }

  /**
   * 清除该主题的 retained(空 payload + retain)。
   *
   * 只在**具体主题**上开放:树的中间层节点代表的是"这一层下面所有主题",
   * 对它下发 retained 没有意义。两步确认同上,第二步才真发。
   */
  async clearRetained(topic, cx) {
    if (!topic || topic.includes("+") || topic.includes("#")) {
      this.setStatus(`只能对具体主题清除 retained,当前是“${topic}”`, true, cx);
      return;
    }
    const key = `retain:${topic}`;
    if (this.armed !== key) {
      this.armed = key;
      this.setStatus(`再点一次确认:以空 payload 向 ${topic} 发布 retained,该主题的保留消息将被删除`, false, cx);
      return;
    }
    this.armed = null;
    this.setStatus("清除中…", false, cx);
    try {
      await dispatch("publish", {
        topic,
        body: [],
        properties: [["qos", "1"], ["retain", "true"]],
      }, { confirmed: true });
      this.setStatus(`已向 ${topic} 发送空 retained`, false, cx);
    } catch (error) {
      this.setStatus(`清除失败: ${errorMessage(error)}`, true, cx);
    }
  }

  /**
   * 选中分支的数值趋势:把每条消息里的单个数值抽出来画折线。
   *
   * 抽不出数值(或样本不足 2 条)就返回 null —— 不画空图、不拿 0 占位。
   */
  trendChart(cx, branch) {
    const samples = [];
    for (const message of [...branch].reverse()) {
      const value = numericSample(message.body_text ?? "", null);
      if (value === null || !Number.isFinite(value)) continue;
      samples.push({ label: formatTime(message), value });
    }
    if (samples.length < 2) return null;
    const recent = samples.slice(-TREND_SAMPLES);
    return v_flex().gap(4).flex_shrink_0()
      .child(h_flex().items_center().gap(6)
        .child(div().text_size(12).font_semibold().child("数值趋势"))
        .child(div().text_size(11).text_color(cx.theme().colors.muted_foreground)
          .child(`${recent.length} 个数值样本(裸数字或单个数值的 JSON)`)))
      .child(LineChart.new(() => recent).x_axis(true).grid(true).dot().h(120).w_full());
  }

  /** 选中节点的详情:最新一条 + 该分支最近若干条。 */
  detail(cx) {
    const path = this.selected;
    if (!path) {
      return v_flex().size_full().items_center().justify_center()
        .child(div().text_color(cx.theme().colors.muted_foreground).text_size(12)
          .child("选择左侧的主题节点查看该分支的最新消息"));
    }
    const root = buildTopicTree(this.feed.rows);
    let node = root;
    for (const part of path.split("/")) {
      node = node?.children.get(part);
      if (!node) break;
    }
    const branch = this.branchRows();
    const latest = node?.last || null;
    const latestRetained = node?.lastRetained || null;
    const clearing = this.armed === `retain:${path}`;
    return v_flex().size_full().min_h_0().p(10).gap(6)
      .child(div().font_semibold().text_size(13).child("主题分支"))
      .child(h_flex().items_center().gap(6).min_w_0()
        .child(div().flex_1().min_w_0().text_ellipsis().font_family("monospace").text_size(12).child(path))
        .child(new Clipboard("mqtt-topics-copy-path").value(path).tooltip("复制主题")
          .child(new Tag().size("xsmall").outline().child("复制主题"))))
      .child(h_flex().items_center().gap(6)
        .child(new Tag().size("small").outline().child(`消息 ${node?.count || 0}`))
        .child(new Tag().size("small").outline().child(`子主题 ${node?.children.size || 0}`))
        .children(latestRetained ? [new Tag().size("small").variant("warning").child("有 retained")] : []))
      .child(h_flex().items_center().gap(6).flex_wrap().min_w_0()
        .child(new Button("mqtt-topics-sub-exact").ghost().size("xsmall").label("订阅此主题")
          .on_click((_e, cx) => cx.spawn(async (cx) => this.subscribe(path, false, cx))))
        .child(new Button("mqtt-topics-sub-subtree").ghost().size("xsmall").label("订阅子树 /#")
          .on_click((_e, cx) => cx.spawn(async (cx) => this.subscribe(path, true, cx))))
        .children(latestRetained
          ? [new Button("mqtt-topics-clear-retained").ghost().size("xsmall")
              .label(clearing ? "确认清除 retained" : "清除 retained")
              .on_click((_e, cx) => cx.spawn(async (cx) => this.clearRetained(path, cx)))]
          : []))
      .children(this.status
        ? [div().text_size(11).text_ellipsis()
            .text_color(this.statusError ? cx.theme().colors.destructive : cx.theme().colors.muted_foreground)
            .child(this.status)]
        : [])
      .children(latest
        ? [
          div().text_size(12).font_semibold().child("最新一条"),
          div().text_size(11).text_color(cx.theme().colors.muted_foreground)
            .child(`${formatTime(latest)} · QoS ${props(latest).qos || "-"} · retain ${props(latest).retain || "false"} · ${humanBytes(payloadSize(latest))}`),
          h_flex().items_center().gap(6)
            .child(new Clipboard("mqtt-topics-copy-body").value(decodePayload(latest, "text")).tooltip("复制内容")
              .child(new Tag().size("xsmall").outline().child("复制内容"))),
          div().max_h(160).overflow_y_scrollbar().border_1().rounded(6).p(8)
            .font_family("monospace").text_size(12)
            .child(String(decodePayload(latest, "text")).slice(0, 4000)),
          ...(this.trendChart(cx, branch) ? [this.trendChart(cx, branch)] : []),
        ]
        : [div().text_size(11).text_color(cx.theme().colors.muted_foreground).child("该分支暂无观测到的消息")])
      .child(div().text_size(12).font_semibold().child(`最近 ${branch.length} 条`))
      .child(div().flex_1().min_h_0().overflow_y_scrollbar().border_1().rounded(6)
        .children(branch.length
          ? branch.map((m, index) => h_flex().id(`mqtt-topics-branch-${index}`)
              .items_center().gap(6).px(8).py(3).border_b_1().cursor_pointer()
              .on_click((_e, cx) => {
                this.armed = null;
                this.setStatus(`已选中 ${m.topic}(${formatTime(m)})`, false, cx);
              })
              .child(div().flex_1().min_w_0().text_ellipsis().font_family("monospace").text_size(11)
                .child(m.topic || ""))
              .child(new Tag().size("xsmall").outline().child(`Q${props(m).qos || "?"}`))
              .children(props(m).retain === "true" ? [new Tag().size("xsmall").variant("warning").child("R")] : [])
              .child(div().text_size(10).text_color(cx.theme().colors.muted_foreground).whitespace_nowrap()
                .child(formatTime(m)))
              .child(div().w(160).flex_shrink_0().text_ellipsis().text_size(11)
                .text_color(cx.theme().colors.muted_foreground)
                .child(String(m.body_text ?? "").replace(/\s+/g, " ").slice(0, PREVIEW_CHARS))))
          : [div().p(12).text_size(12).text_color(cx.theme().colors.muted_foreground).child("暂无消息")]));
  }

  /** Retained 视图:观测到的保留消息 + 一键清除。 */
  retainedView(cx) {
    const retained = retainedTopics(this.feed.rows);
    return v_flex().flex_1().min_h_0().gap(6).p(8)
      .child(banner(cx, "Broker 没有“列出全部 retained”的接口:这里只列出**本会话观测到**的保留消息。"
        + "要一次看全,请订阅 `#`(或在连接配置里把自动订阅设为 `#`)。", {}))
      .child(h_flex().items_center().gap(6)
        .child(div().text_size(12).font_semibold().child(`Retained(${retained.length})`))
        .child(div().text_size(11).text_color(cx.theme().colors.muted_foreground)
          .child("清除 = 以空 payload + retain 发布一次,由 broker 删除该主题的保留消息")))
      .children(this.status
        ? [div().text_size(11).text_ellipsis()
            .text_color(this.statusError ? cx.theme().colors.destructive : cx.theme().colors.muted_foreground)
            .child(this.status)]
        : [])
      .child(div().flex_1().min_h_0().overflow_y_scrollbar().border_1().rounded(6)
        .children(retained.length
          ? retained.map((entry) => {
            const clearing = this.armed === `retain:${entry.topic}`;
            return h_flex().id(`mqtt-retained-${entry.topic}`).items_center().gap(6)
              .px(8).py(4).border_b_1()
              .child(div().flex_1().min_w_0().text_ellipsis().font_family("monospace").text_size(12)
                .child(entry.topic))
              .child(new Tag().size("xsmall").outline().child(`Q${props(entry.message).qos || "?"}`))
              .child(div().text_size(10).text_color(cx.theme().colors.muted_foreground).whitespace_nowrap()
                .child(formatTime(entry.message)))
              .child(div().w(200).flex_shrink_0().text_ellipsis().text_size(11)
                .text_color(cx.theme().colors.muted_foreground)
                .child(String(entry.message.body_text ?? "").replace(/\s+/g, " ").slice(0, PREVIEW_CHARS)))
              .child(new Clipboard(`mqtt-retained-copy-${entry.topic}`).value(entry.topic).tooltip("复制主题")
                .child(new Tag().size("xsmall").outline().child("复制")))
              .child(new Button(`mqtt-retained-clear-${entry.topic}`).ghost().size("xsmall").danger()
                .label(clearing ? "确认清除" : "清除")
                .on_click((_e, cx) => cx.spawn(async (cx) => this.clearRetained(entry.topic, cx))));
          })
          : [div().p(16).text_size(12).text_color(cx.theme().colors.muted_foreground)
            .child("本会话还没有观测到 retained 消息(只有订阅到的主题才会收到)")]));
  }

  /**
   * $SYS 概览:broker 自报的统计值。
   *
   * 数据完全来自 broker 主动发布的 `$SYS/...` 保留主题:没订阅就一片空白,所以
   * 空状态直接给一键订阅,而不是让用户自己去猜要订阅什么。
   */
  sysView(cx) {
    const { known, others } = sysMetrics(this.feed.rows);
    return v_flex().flex_1().min_h_0().gap(8).p(8).overflow_y_scrollbar()
      .child(h_flex().items_center().gap(6).min_w_0()
        .child(div().text_size(12).font_semibold().child("Broker 概览($SYS)"))
        .child(new Button("mqtt-sys-subscribe").ghost().size("xsmall").label("订阅 $SYS/#")
          .on_click((_e, cx) => cx.spawn(async (cx) => this.subscribe("$SYS/#", false, cx))))
        .child(div().flex_1().min_w_0()))
      .child(banner(cx, "这些数值由 broker 主动发布到 $SYS/... 主题,不同 broker 的主题名与刷新间隔不同"
        + "(Mosquitto 约 10 秒一次);本页取的是本会话观测到的最新值。", {}))
      .children(this.status
        ? [div().text_size(11).text_ellipsis()
            .text_color(this.statusError ? cx.theme().colors.destructive : cx.theme().colors.muted_foreground)
            .child(this.status)]
        : [])
      .children(known.length
        ? [
          h_flex().flex_wrap().gap(8).min_w_0()
            .children(known.map((item) => card(cx, item.label, item.value, item.topic))),
        ]
        : [v_flex().p(16).gap(6)
          .child(div().text_size(12).text_color(cx.theme().colors.muted_foreground)
            .child("还没有观测到 $SYS 消息。点上面的「订阅 $SYS/#」后等待 broker 下一次发布。"))
          .child(div().text_size(11).text_color(cx.theme().colors.muted_foreground)
            .child("有些 broker(如 EMQX 默认配置)不开 $SYS,这时只能看连接页的指标。"))])
      .children(others.length
        ? [
          div().text_size(12).font_semibold().child(`其他 $SYS 主题(${others.length})`),
          div().border_1().rounded(6).overflow_y_scrollbar()
            .children(others.map((item) => h_flex().id(`mqtt-sys-${item.topic}`).items_center().gap(6)
              .px(8).py(3).border_b_1()
              .child(div().flex_1().min_w_0().text_ellipsis().font_family("monospace").text_size(11)
                .child(item.topic))
              .child(div().w(200).flex_shrink_0().text_ellipsis().font_family("monospace").text_size(11)
                .child(item.value))
              .child(div().text_size(10).text_color(cx.theme().colors.muted_foreground).whitespace_nowrap()
                .child(new Date(item.ms).toTimeString().slice(0, 8))))),
        ]
        : []);
  }

  render(cx) {
    const tree = this.mode === "tree";
    const retained = this.mode === "retained";
    const sys = this.mode === "sys";
    // 每帧只构建一次树:treeRows 会遍历全部消息并新建元素,不能重复调用。
    const rows = tree ? this.treeRows(cx) : [];
    return h_flex().size_full().min_w_0().min_h_0().items_stretch()
      .child(v_flex().flex_1().min_w_0().min_h_0().h_full()
        .child(h_flex().items_center().gap(6).p(8).border_b_1().min_w_0()
          .child(new Button("mqtt-topics-mode-tree").size("small").flex_shrink_0()
            .label("主题树")
            .when(!tree, (el) => el.ghost())
            .on_click((_e, cx) => { this.mode = "tree"; cx.notify(); }))
          .child(new Button("mqtt-topics-mode-retained").size("small").flex_shrink_0()
            .label("Retained")
            .when(!retained, (el) => el.ghost())
            .on_click((_e, cx) => { this.mode = "retained"; this.armed = null; cx.notify(); }))
          .child(new Button("mqtt-topics-mode-sys").size("small").flex_shrink_0()
            .label("Broker 概览")
            .when(!sys, (el) => el.ghost())
            .on_click((_e, cx) => { this.mode = "sys"; this.armed = null; cx.notify(); }))
          .child(div().flex_1().min_w_0().child(new Input(this.search)))
          .child(div().flex_shrink_0().text_size(11).whitespace_nowrap()
            .text_color(cx.theme().colors.muted_foreground)
            .child(`${this.feed.rows.length} 条消息`))
          .child(new Button("mqtt-topics-pause").ghost().size("small").flex_shrink_0()
            .label(this.feed.paused ? "继续" : "暂停")
            .on_click((_e, cx) => { this.feed.paused = !this.feed.paused; cx.notify(); })))
        .children(feedBanner(cx, this.feed))
        .children(tree
          ? [div().flex_1().min_h_0().overflow_y_scrollbar()
              .children(rows.length
                ? rows
                : [div().p(16).text_size(12).text_color(cx.theme().colors.muted_foreground)
                  .child(this.feed.rows.length ? "没有匹配的主题" : "等待消息…请确认已订阅相关主题")])]
          : retained
            ? [this.retainedView(cx)]
            : [this.sysView(cx)]))
      .child(div().w(420).flex_shrink_0().h_full().min_h_0().border_l_1()
        .child(tree
          ? this.detail(cx)
          : v_flex().size_full().items_center().justify_center()
            .child(div().text_size(12).text_color(cx.theme().colors.muted_foreground)
              .child("Retained 视图的行内即可清除;切回主题树可看分支详情与数值趋势"))));
  }
}
