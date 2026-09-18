// RocketMQ 集群概览:指标卡片 + 集群/Broker 拓扑,可自动刷新。
//
// 嵌入式工作台页面只拿得到 `navop.context` 与 `navop.workbench`(清单声明面),
// 拿不到 raw resource/event 模块,所以数据一律走 dispatch 的命名操作。
import { View, div } from "gpui";
import { h_flex, v_flex } from "gpui-base";
import { Button, Tag } from "gpui-component";
import { current, dispatch } from "navop.workbench";
import { card, errorMessage, loadingView, section } from "./shared.js";

const REFRESH_MS = 5000;

export default class RocketmqOverview extends View {
  init(_props, cx) {
    this.context = current();
    this.metrics = null;
    this.clusters = [];
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
      const [metrics, overview] = await Promise.all([
        dispatch("metrics"),
        dispatch("clusterOverview"),
      ]);
      this.metrics = metrics?.metrics || metrics || {};
      this.clusters = overview?.clusters || [];
      this.error = null;
    } catch (error) {
      this.error = errorMessage(error);
    }
    this.loading = false;
    cx.notify();
  }

  /** 集群列表 → 扁平的 Broker 行。 */
  brokers() {
    const rows = [];
    for (const cluster of this.clusters || []) {
      for (const broker of cluster.brokers || []) {
        rows.push({ cluster: cluster.name, ...broker });
      }
    }
    return rows;
  }

  headerRow() {
    const columns = [
      ["集群", 140],
      ["Broker", 150],
      ["地址", 190],
      ["Topic", 60],
      ["队列", 60],
      ["版本", 90],
      ["入 TPS", 70],
      ["出 TPS", 70],
    ];
    return h_flex().w_full().px(10).py(6).gap(8).border_b_1()
      .children(columns.map(([title, width]) =>
        div().w(width).flex_shrink_0().text_size(11).child(title)));
  }

  brokerRow(cx, row) {
    const cells = [
      [row.cluster || "-", 140, false],
      [row.name || "-", 150, false],
      [row.address || "-", 190, true],
      [String(row.topic_count ?? 0), 60, false],
      [String(row.queue_count ?? 0), 60, false],
      [row.version || "-", 90, false],
      [Number(row.tps_in ?? 0).toFixed(1), 70, false],
      [Number(row.tps_out ?? 0).toFixed(1), 70, false],
    ];
    return h_flex().w_full().px(10).py(5).gap(8).border_b_1()
      .children(cells.map(([text, width, isAddress]) =>
        // 定宽窗格里的长文本要么省略要么裁剪,否则会画到隔壁列上。
        div().w(width).flex_shrink_0().text_size(12).truncate()
          .when(isAddress, (el) => el.font_family("monospace"))
          .child(String(text))));
  }

  render(cx) {
    if (this.loading && !this.metrics) return loadingView(cx, "正在读取集群指标…");
    const m = this.metrics || {};
    const extras = Object.fromEntries((m.extras || []).map(([key, value]) => [key, value]));
    const rows = this.brokers();
    const connected = rows.length > 0;
    return v_flex().size_full().min_w_0().min_h_0().overflow_y_scrollbar().p(16).gap(16)
      .child(h_flex().items_center().gap(8).min_w_0()
        .child(div().text_size(16).font_semibold().flex_shrink_0().child("RocketMQ 集群"))
        .child(new Tag().size("small")
          .variant(connected ? "success" : "warning")
          .child(connected ? `已连接 · ${rows.length} Broker` : "未发现 Broker"))
        .child(div().flex_1().min_w_0().truncate().text_size(12)
          .text_color(cx.theme().colors.muted_foreground)
          .child(this.context?.connection?.name || m.name || ""))
        .child(new Button("rmq-overview-auto").ghost().size("small").flex_shrink_0()
          .label(this.auto ? "自动刷新: 开" : "自动刷新: 关")
          .on_click((_e, cx) => {
            this.auto = !this.auto;
            cx.notify();
          }))
        .child(new Button("rmq-overview-refresh").ghost().size("small").flex_shrink_0()
          .label("刷新")
          .on_click((_e, cx) => cx.spawn(async (cx) => this.load(cx)))))
      .children(this.error
        ? [div().text_color(cx.theme().colors.destructive).text_size(12).child(`刷新失败: ${this.error}`)]
        : [])
      .child(h_flex().gap(8).flex_wrap()
        .child(card(cx, "入 TPS", Number(m.tps_in ?? 0).toFixed(1), "全部 Broker 合计"))
        .child(card(cx, "出 TPS", Number(m.tps_out ?? 0).toFixed(1), "全部 Broker 合计"))
        .child(card(cx, "Topic 数", m.topic_count ?? 0, "NameServer 全量列表"))
        .child(card(cx, "连接数", m.connection_count ?? 0, "在线消费者连接"))
        .child(card(cx, "今日消息量", m.message_count_today ?? 0, `Broker 数 ${extras.broker_count ?? rows.length}`)))
      .child(v_flex().w_full().gap(6).border_1().rounded(6)
        .child(h_flex().w_full().items_center().gap(8).px(10).py(8)
          .child(div().text_size(13).font_semibold().flex_shrink_0().child("集群拓扑"))
          .child(div().flex_1())
          .child(new Tag().size("xsmall").child(String(rows.length))))
        .child(this.headerRow())
        .children(rows.length
          ? rows.map((row) => this.brokerRow(cx, row))
          : [div().px(10).py(12).text_size(12)
              .text_color(cx.theme().colors.muted_foreground)
              .child("NameServer 未返回集群拓扑,请确认地址与网络可达")]))
      .child(section(cx, "附加指标", (m.extras || []).length
        ? (m.extras || []).map(([key, value]) =>
            h_flex().gap(8).items_start().min_w_0()
              .child(div().w(200).flex_shrink_0().text_size(12)
                .text_color(cx.theme().colors.muted_foreground).child(String(key)))
              .child(div().flex_1().min_w_0().text_size(12).child(String(value))))
        : [div().text_size(12).text_color(cx.theme().colors.muted_foreground).child("无")]));
  }
}
