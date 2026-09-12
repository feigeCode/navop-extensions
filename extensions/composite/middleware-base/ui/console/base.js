// 中间件共享控制台基类（middleware-standard v1，标准 §5/§5.1）。
//
// 本文件由基础扩展 com.navop.middleware 持有，构建期经
// scripts/sync-middleware-console.mjs 同步进各实现扩展的 ui/console/ 目录；
// 实现扩展入口 ui/console.js 只写薄壳：
//
//   import { MiddlewareConsole } from "./console/base.js";
//   export default class ConsoleView extends MiddlewareConsole {
//     brand() { return { title: "MQTT", subtitle: this.context.connection?.name || "" }; }
//     extraTopicColumns() { return []; }   // [{key, label?, width?}]
//     metricsExtrasOrder() { return []; }  // MiddlewareMetrics.extras 展示顺序提示
//   }
//
// 子类不得覆盖 init/render。
//
// 运行时 API 依据（QuickJS shell + gpui-component component-shell 注册表）：
// - gpui: View、div；样式方法链（size_full/p/gap/text_size/font_semibold/flex_1/
//   border_r_1/overflow_y_scrollbar/whitespace_pre_wrap/items_center/...）
// - gpui-base: h_flex/v_flex 布局辅助、InputState.new({ value, placeholder })、
//   Input.new(state)；state.value()/set_value() 可读写（placeholder 只能在
//   InputState.new 设置，Input 元素无 placeholder 方法）
// - gpui-component: Button(id).label/.ghost/.secondary/.link/.on_click、
//   Badge()（nullary 构造，children 承载内容）、DataTableState(columns)（位置参数）、
//   DataTable(state, rowsFn, cellFn)（位置参数）+ stripe/bordered、
//   Pagination(id).current_page/.total_pages/.on_change、
//   Select(id, rowsFn, renderRowFn, onSelect)（位置参数）+ placeholder
// - navop.context current()、navop.resource invoke、navop.blob read/close
// - resolve() inline/blob 解包辅助照抄 elasticsearch/ui/explorer.js

import { Buffer } from "buffer";
import { View, div } from "gpui";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import { Badge, Button, DataTable, DataTableState, Pagination, Select } from "gpui-component";
import { close as closeBlob, read as readBlob } from "navop.blob";
import { current } from "navop.context";
import { invoke } from "navop.resource";

// ---------------------------------------------------------------------------
// i18n 字典：默认 zh-CN；键缺失时回落 zh-CN，再回落键名本身。
// ---------------------------------------------------------------------------

const I18N = {
  "zh-CN": {
    "nav.overview": "概览",
    "nav.topics": "Topic",
    "nav.groups": "订阅组·客户端",
    "nav.messages": "消息查询",
    "common.refresh": "刷新",
    "common.loading": "加载中…",
    "common.empty": "暂无数据",
    "common.failed": "失败",
    "common.none": "-",
    "common.cancel": "取消",
    "common.close": "关闭",
    "overview.metrics": "指标",
    "overview.topology": "集群拓扑",
    "overview.no_capability": "当前后端未开放 metrics / cluster_overview 能力",
    "topics.title": "Topic 列表",
    "topics.detail": "队列偏移详情",
    "topics.create": "新建 Topic",
    "topics.create.submit": "创建",
    "topics.create.topic": "Topic 名称",
    "topics.create.queue_count": "队列数量",
    "topics.create.perm": "读写权限(如 6)",
    "topics.delete": "删除此 Topic",
    "topics.no_capability": "当前后端未开放 topics 能力",
    "groups.title": "订阅组列表",
    "groups.consume_detail": "消费进度",
    "groups.clients": "客户端",
    "groups.no_capability": "当前后端未开放 groups 能力",
    "messages.title": "消息查询",
    "messages.mode.by_time": "按时间窗口",
    "messages.mode.by_key": "按 Key",
    "messages.mode.by_id": "按消息 ID",
    "messages.topic": "Topic",
    "messages.begin": "开始时间",
    "messages.end": "结束时间",
    "messages.key": "消息 Key",
    "messages.message_id": "消息 ID",
    "messages.page_size": "每页",
    "messages.query": "查询",
    "messages.query.result": "查询结果",
    "messages.detail": "消息详情",
    "messages.body_text": "消息体",
    "messages.properties": "属性",
    "messages.send": "发送消息",
    "messages.send.tag": "Tag(可选)",
    "messages.send.key": "Key(可选)",
    "messages.send.body": "消息体",
    "messages.send.submit": "发送",
    "messages.send.ok": "发送成功",
    "messages.no_capability": "当前后端未开放 message_query 能力",
    "messages.time_hint": "格式 YYYY-MM-DD HH:mm 或 Unix 毫秒",
    "messages.time_invalid": "时间格式非法",
    "messages.binary_body": "(二进制消息体)",
    "status.connecting": "连接中…",
    "status.connected": "已连接",
    "status.version_warning": "标准版本不匹配，界面可能异常",
    "status.no_capabilities": "无可用能力",
    "error.missing_resource": "连接缺少 resource handle",
    "error.required": "必填项缺失",
  },
  en: {
    "nav.overview": "Overview",
    "nav.topics": "Topics",
    "nav.groups": "Groups · Clients",
    "nav.messages": "Messages",
    "common.refresh": "Refresh",
    "common.loading": "Loading…",
    "common.empty": "No data",
    "common.failed": "Failed",
    "common.none": "-",
    "common.cancel": "Cancel",
    "common.close": "Close",
    "overview.metrics": "Metrics",
    "overview.topology": "Cluster topology",
    "overview.no_capability": "metrics / cluster_overview capabilities are not enabled",
    "topics.title": "Topics",
    "topics.detail": "Queue offset detail",
    "topics.create": "Create topic",
    "topics.create.submit": "Create",
    "topics.create.topic": "Topic name",
    "topics.create.queue_count": "Queue count",
    "topics.create.perm": "Permission (e.g. 6)",
    "topics.delete": "Delete this topic",
    "topics.no_capability": "topics capability is not enabled",
    "groups.title": "Consumer groups",
    "groups.consume_detail": "Consume progress",
    "groups.clients": "Clients",
    "groups.no_capability": "groups capability is not enabled",
    "messages.title": "Message query",
    "messages.mode.by_time": "By time window",
    "messages.mode.by_key": "By key",
    "messages.mode.by_id": "By message id",
    "messages.topic": "Topic",
    "messages.begin": "Begin",
    "messages.end": "End",
    "messages.key": "Message key",
    "messages.message_id": "Message id",
    "messages.page_size": "Page size",
    "messages.query": "Query",
    "messages.query.result": "Results",
    "messages.detail": "Message detail",
    "messages.body_text": "Body",
    "messages.properties": "Properties",
    "messages.send": "Send message",
    "messages.send.tag": "Tag (optional)",
    "messages.send.key": "Key (optional)",
    "messages.send.body": "Body",
    "messages.send.submit": "Send",
    "messages.send.ok": "Sent",
    "messages.no_capability": "message_query capability is not enabled",
    "messages.time_hint": "Format YYYY-MM-DD HH:mm or unix ms",
    "messages.time_invalid": "Invalid time format",
    "messages.binary_body": "(binary body)",
    "status.connecting": "Connecting…",
    "status.connected": "Connected",
    "status.version_warning": "Standard version mismatch; UI may misbehave",
    "status.no_capabilities": "No capabilities available",
    "error.missing_resource": "Connection resource handle is missing",
    "error.required": "Required field is missing",
  },
  "zh-HK": {
    "nav.overview": "概覽",
    "nav.topics": "Topic",
    "nav.groups": "訂閱組·客戶端",
    "nav.messages": "訊息查詢",
    "common.refresh": "重新整理",
    "common.loading": "載入中…",
    "common.empty": "暫無資料",
    "common.failed": "失敗",
    "common.none": "-",
    "common.cancel": "取消",
    "common.close": "關閉",
    "overview.metrics": "指標",
    "overview.topology": "叢集拓撲",
    "overview.no_capability": "目前後端未開放 metrics / cluster_overview 能力",
    "topics.title": "Topic 列表",
    "topics.detail": "佇列偏移詳情",
    "topics.create": "新增 Topic",
    "topics.create.submit": "建立",
    "topics.create.topic": "Topic 名稱",
    "topics.create.queue_count": "佇列數量",
    "topics.create.perm": "讀寫權限(如 6)",
    "topics.delete": "刪除此 Topic",
    "topics.no_capability": "目前後端未開放 topics 能力",
    "groups.title": "訂閱組列表",
    "groups.consume_detail": "消費進度",
    "groups.clients": "客戶端",
    "groups.no_capability": "目前後端未開放 groups 能力",
    "messages.title": "訊息查詢",
    "messages.mode.by_time": "按時間視窗",
    "messages.mode.by_key": "按 Key",
    "messages.mode.by_id": "按訊息 ID",
    "messages.topic": "Topic",
    "messages.begin": "開始時間",
    "messages.end": "結束時間",
    "messages.key": "訊息 Key",
    "messages.message_id": "訊息 ID",
    "messages.page_size": "每頁",
    "messages.query": "查詢",
    "messages.query.result": "查詢結果",
    "messages.detail": "訊息詳情",
    "messages.body_text": "訊息體",
    "messages.properties": "屬性",
    "messages.send": "傳送訊息",
    "messages.send.tag": "Tag(可選)",
    "messages.send.key": "Key(可選)",
    "messages.send.body": "訊息體",
    "messages.send.submit": "傳送",
    "messages.send.ok": "傳送成功",
    "messages.no_capability": "目前後端未開放 message_query 能力",
    "messages.time_hint": "格式 YYYY-MM-DD HH:mm 或 Unix 毫秒",
    "messages.time_invalid": "時間格式非法",
    "messages.binary_body": "(二進位訊息體)",
    "status.connecting": "連線中…",
    "status.connected": "已連線",
    "status.version_warning": "標準版本不符，介面可能異常",
    "status.no_capabilities": "無可用能力",
    "error.missing_resource": "連線缺少 resource handle",
    "error.required": "必填欄位缺失",
  },
};

// 指标卡片固定键位（MiddlewareMetrics 标准字段）。
const METRIC_KEYS = [
  ["tps_in", "TPS In"],
  ["tps_out", "TPS Out"],
  ["topic_count", "Topics"],
  ["connection_count", "Connections"],
  ["message_count_today", "Messages Today"],
];

// 每页大小可选项（分页 10/20/50）。
const PAGE_SIZES = [10, 20, 50];

// ---------------------------------------------------------------------------
// 纯函数辅助
// ---------------------------------------------------------------------------

// UTF-8 编码为字节数组：SendMessageRequest.body 为 Vec<u8>，JSON 序列化为数字数组。
// 手写实现以避免依赖 QuickJS 未必携带的 TextEncoder。
function utf8Encode(text) {
  const bytes = [];
  const source = String(text ?? "");
  for (let i = 0; i < source.length; i += 1) {
    let code = source.charCodeAt(i);
    // 处理代理对（surrogate pair）
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < source.length) {
      const next = source.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
      }
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

// 数值/文本格式化；null/undefined 显示占位符。
function formatValue(value, placeholder) {
  if (value === null || value === undefined) return placeholder;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return placeholder;
    if (Number.isInteger(value)) return String(value);
    return String(Math.round(value * 100) / 100);
  }
  return String(value);
}

// 解析时间输入为 Unix 毫秒：支持 "YYYY-MM-DD HH:mm"（本地时区）或纯数字毫秒；
// 非法输入返回 null。
function parseTimeToMs(text) {
  const raw = String(text ?? "").trim();
  if (raw === "") return null;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = match[4] === undefined ? 0 : parseInt(match[4], 10);
  const minute = match[5] === undefined ? 0 : parseInt(match[5], 10);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date.getTime();
}

// "YYYY-MM-DD HH:mm" 格式化（用于默认时间值）。
function formatDateTime(ms) {
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 安全取正整数（用于 queue_count / page_size 等数字输入）。
function parsePositiveInt(text, fallback) {
  const raw = String(text ?? "").trim();
  if (raw === "") return fallback;
  const value = parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// 过滤掉数组中的 null/undefined（用于可空 section 的 children 组装）。
function compact(items) {
  return items.filter((item) => item !== null && item !== undefined);
}

// ---------------------------------------------------------------------------
// MiddlewareConsole 基类
// ---------------------------------------------------------------------------

export class MiddlewareConsole extends View {
  // ---- 子类契约（标准 §5.1）-----------------------------------------------

  // 品牌标识：控制台标题栏。子类覆盖返回 { title, subtitle }。
  brand() {
    return { title: "Middleware", subtitle: (this.context && this.context.connection &&
      this.context.connection.name) || "" };
  }

  // 可选：Topic 列表追加实现特有列 [{key, label?, width?}]
  //（key 对应 MiddlewareTopicInfo 或后端 extra 字段；受运行时限制列头渲染为 key 原文）。
  extraTopicColumns() {
    return [];
  }

  // 可选：概览页扩展指标键（MiddlewareMetrics.extras 的展示顺序提示）。
  metricsExtrasOrder() {
    return [];
  }

  // 界面语言：默认 zh-CN；子类可覆盖返回 "en" / "zh-CN" / "zh-HK"。
  locale() {
    return "zh-CN";
  }

  // ---- 文案辅助 -------------------------------------------------------------

  _t(key) {
    const language = I18N[this.locale()] ? this.locale() : "zh-CN";
    return (I18N[language] && I18N[language][key]) || I18N["zh-CN"][key] || key;
  }

  // ---- 生命周期 -------------------------------------------------------------

  init(_props, cx) {
    // 宿主上下文：connection.resource.handle 是全部 invoke 的资源句柄。
    this.context = current();
    this.resource = null;

    // 能力位与标准版本（capabilities 加载后填充）。
    this.capabilities = null;
    this.standardVersion = null;
    this.versionWarning = false;

    // 当前页签；导航项按能力位显隐。
    this.page = "overview";

    // 全局刷新代数：任何一次重新加载都会递增；异步任务完成后比对，
    // 不等则丢弃响应（对应原 middleware_view 的 refresh_generation 语义）。
    this.refreshGeneration = 0;

    // 状态栏文本。
    this.status = this._t("status.connecting");

    // 各页状态。
    this.overviewState = { loading: false, error: null, metrics: null, cluster: null };
    this.topicsState = {
      loading: false,
      error: null,
      topics: [],
      detail: null,
      selectedTopic: null,
      showCreate: false,
    };
    this.groupsState = {
      loading: false,
      error: null,
      groups: [],
      detail: null,
      clients: [],
      selectedGroup: null,
    };
    this.messagesState = {
      mode: "by_time",
      loading: false,
      error: null,
      page: null,
      detail: null,
      pageIndex: 1,
      pageSize: 20,
      sendStatus: null,
    };

    // Topic 新建表单输入状态（gpui-base 保留态）。
    this.createTopicInput = InputState.new({ placeholder: "order-topic" });
    this.createQueueInput = InputState.new({ value: "8" });
    this.createPermInput = InputState.new({ value: "6" });

    // 消息查询输入状态（ByTimeWindow 默认今天 00:00 → 现在）。
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    this.queryTopicInput = InputState.new({ placeholder: "order-topic" });
    this.queryBeginInput = InputState.new({ value: formatDateTime(todayStart.getTime()) });
    this.queryEndInput = InputState.new({ value: formatDateTime(Date.now()) });
    this.queryKeyInput = InputState.new({});
    this.queryIdInput = InputState.new({});

    // 发送消息表单输入状态。
    this.sendTopicInput = InputState.new({ placeholder: "order-topic" });
    this.sendTagInput = InputState.new({});
    this.sendKeyInput = InputState.new({});
    this.sendBodyInput = InputState.new({});

    // DataTable 保留态按「表 id + 列签名」惰性创建并复用
    //（DataTableState 需要稳定的列集；列变化时自动新建状态）。
    this._tableStates = {};

    cx.spawn(async (cx2) => this.bootstrap(cx2));
  }

  // 连接引导：拿资源句柄 → 查能力位 → 打开首个可用页签。
  async bootstrap(cx) {
    try {
      const connection = this.context && this.context.connection;
      if (!connection || !connection.resource || !connection.resource.handle) {
        throw new Error(this._t("error.missing_resource"));
      }
      this.resource = connection.resource.handle;

      const response = await this.resolve(
        await invoke(this.resource, "middleware/capabilities", {}),
      );
      this.standardVersion = response.standard_version;
      this.capabilities = response.capabilities || {};
      // 标准版本不匹配：状态栏警告，但仍尽力渲染。
      this.versionWarning = this.standardVersion !== 1;
      this.status = this._t("status.connected");

      // 打开第一个有能力的页签。
      if (!this.navItems().some((item) => item.page === this.page)) {
        const first = this.navItems()[0];
        this.page = first ? first.page : "overview";
      }
      await this.loadCurrentPage(cx);
    } catch (error) {
      this.status = `${this._t("common.failed")}: ${error.message}`;
    }
    cx.notify();
  }

  // ---- 能力位 -------------------------------------------------------------

  has(capability) {
    return Boolean(this.capabilities && this.capabilities[capability]);
  }

  anyCapability() {
    return [
      "topics",
      "topic_write",
      "groups",
      "clients",
      "message_query",
      "send_message",
      "metrics",
      "cluster_overview",
    ].some((capability) => this.has(capability));
  }

  // ---- 资源调用辅助 ---------------------------------------------------------

  // invoke + inline/blob 解包（照抄 explorer.js 的 resolve 辅助）。
  async resolve(result) {
    if (result.kind === "inline") return result.value;
    if (result.kind !== "blob") return result;
    const chunks = [];
    try {
      while (true) {
        const chunk = await readBlob(result.handle, 1024 * 1024);
        chunks.push(Buffer.from(chunk.data, "base64"));
        if (chunk.done) break;
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } finally {
      await closeBlob(result.handle);
    }
  }

  // 带解包的中间件方法调用。
  async invokeMW(method, params) {
    return this.resolve(await invoke(this.resource, method, params));
  }

  // 开启一轮刷新：递增代数并返回本轮令牌。
  beginRefresh() {
    this.refreshGeneration += 1;
    return this.refreshGeneration;
  }

  // 代数是否仍有效（过期响应丢弃）。
  isCurrent(token) {
    return token === this.refreshGeneration;
  }

  // ---- 页面加载 -------------------------------------------------------------

  async loadCurrentPage(cx) {
    if (this.page === "overview") return this.loadOverview(cx);
    if (this.page === "topics") return this.loadTopics(cx);
    if (this.page === "groups") return this.loadGroups(cx);
    if (this.page === "messages") {
      // 消息页：仅当已有结果时刷新，避免打开页签即自动查询。
      if (this.messagesState.page) return this.loadMessages(cx);
      return Promise.resolve();
    }
    return Promise.resolve();
  }

  // 概览页：metrics 与 cluster/overview 并发加载（各自按能力位 gate）。
  async loadOverview(cx) {
    if (!this.has("metrics") && !this.has("cluster_overview")) return;
    const token = this.beginRefresh();
    this.overviewState.loading = true;
    this.overviewState.error = null;
    cx.notify();
    try {
      const [metrics, cluster] = await Promise.all([
        this.has("metrics")
          ? this.invokeMW("middleware/metrics", {}).then((response) => response.metrics)
          : Promise.resolve(null),
        this.has("cluster_overview")
          ? this.invokeMW("middleware/cluster/overview", {})
          : Promise.resolve(null),
      ]);
      if (!this.isCurrent(token)) return; // 过期响应丢弃
      this.overviewState.metrics = metrics;
      this.overviewState.cluster = cluster;
    } catch (error) {
      if (!this.isCurrent(token)) return;
      this.overviewState.error = error.message;
    } finally {
      if (this.isCurrent(token)) this.overviewState.loading = false;
    }
    cx.notify();
  }

  async loadTopics(cx) {
    if (!this.has("topics")) return;
    const token = this.beginRefresh();
    this.topicsState.loading = true;
    this.topicsState.error = null;
    cx.notify();
    try {
      const response = await this.invokeMW("middleware/topic/list", {});
      if (!this.isCurrent(token)) return;
      this.topicsState.topics = response.topics || [];
    } catch (error) {
      if (!this.isCurrent(token)) return;
      this.topicsState.error = error.message;
    } finally {
      if (this.isCurrent(token)) this.topicsState.loading = false;
    }
    cx.notify();
  }

  async openTopicDetail(name, cx) {
    if (!this.has("topics")) return;
    const token = this.beginRefresh();
    this.topicsState.selectedTopic = name;
    this.topicsState.detail = null;
    this.topicsState.error = null;
    cx.notify();
    try {
      const detail = await this.invokeMW("middleware/topic/detail", { topic: name });
      if (!this.isCurrent(token)) return;
      this.topicsState.detail = detail;
    } catch (error) {
      if (!this.isCurrent(token)) return;
      this.topicsState.error = error.message;
    }
    cx.notify();
  }

  async createTopic(cx) {
    if (!this.has("topic_write")) return;
    const topic = this.createTopicInput.value().trim();
    if (topic === "") {
      this.topicsState.error = this._t("error.required");
      cx.notify();
      return;
    }
    const token = this.beginRefresh();
    this.topicsState.error = null;
    cx.notify();
    try {
      const queueCount = parsePositiveInt(this.createQueueInput.value(), 0);
      const perm = this.createPermInput.value().trim();
      // CreateTopicRequest（serde default，可空字段传 null）。
      await this.invokeMW("middleware/topic/create", {
        topic,
        queue_count: queueCount > 0 ? queueCount : null,
        perm: perm === "" ? null : perm,
      });
      if (!this.isCurrent(token)) return;
      this.topicsState.showCreate = false;
      await this.loadTopics(cx);
    } catch (error) {
      if (!this.isCurrent(token)) return;
      this.topicsState.error = error.message;
      cx.notify();
    }
  }

  async deleteTopic(name, cx) {
    if (!this.has("topic_write") || !name) return;
    const token = this.beginRefresh();
    this.topicsState.error = null;
    cx.notify();
    try {
      await this.invokeMW("middleware/topic/delete", { topic: name });
      if (!this.isCurrent(token)) return;
      this.topicsState.selectedTopic = null;
      this.topicsState.detail = null;
      await this.loadTopics(cx);
    } catch (error) {
      if (!this.isCurrent(token)) return;
      this.topicsState.error = error.message;
      cx.notify();
    }
  }

  async loadGroups(cx) {
    if (!this.has("groups")) return;
    const token = this.beginRefresh();
    this.groupsState.loading = true;
    this.groupsState.error = null;
    cx.notify();
    try {
      const response = await this.invokeMW("middleware/group/list", {});
      if (!this.isCurrent(token)) return;
      this.groupsState.groups = response.groups || [];
    } catch (error) {
      if (!this.isCurrent(token)) return;
      this.groupsState.error = error.message;
    } finally {
      if (this.isCurrent(token)) this.groupsState.loading = false;
    }
    cx.notify();
  }

  async openGroupDetail(name, cx) {
    if (!this.has("groups")) return;
    const token = this.beginRefresh();
    this.groupsState.selectedGroup = name;
    this.groupsState.detail = null;
    this.groupsState.clients = [];
    this.groupsState.error = null;
    cx.notify();
    try {
      // 消费详情与客户端并发加载（clients 按能力位 gate）。
      const [detail, clientsResponse] = await Promise.all([
        this.invokeMW("middleware/group/detail", { group: name }),
        this.has("clients")
          ? this.invokeMW("middleware/group/clients", { group: name })
          : Promise.resolve(null),
      ]);
      if (!this.isCurrent(token)) return;
      this.groupsState.detail = detail;
      this.groupsState.clients = clientsResponse ? clientsResponse.clients || [] : [];
    } catch (error) {
      if (!this.isCurrent(token)) return;
      this.groupsState.error = error.message;
    }
    cx.notify();
  }

  async loadMessages(cx) {
    if (!this.has("message_query")) return;
    const state = this.messagesState;
    const topic = this.queryTopicInput.value().trim();
    if (topic === "") {
      state.error = this._t("error.required");
      cx.notify();
      return;
    }
    const token = this.beginRefresh();
    state.loading = true;
    state.error = null;
    state.detail = null;
    cx.notify();
    try {
      let query = null;
      if (state.mode === "by_time") {
        const begin = parseTimeToMs(this.queryBeginInput.value());
        const end = parseTimeToMs(this.queryEndInput.value());
        if (begin === null || end === null) {
          throw new Error(this._t("messages.time_invalid"));
        }
        // MessageQuery 为 tagged enum：{"ByTimeWindow": {...}}
        query = {
          ByTimeWindow: {
            topic,
            begin_unix_ms: begin,
            end_unix_ms: end,
            page: state.pageIndex,
            page_size: state.pageSize,
          },
        };
      } else if (state.mode === "by_key") {
        const key = this.queryKeyInput.value().trim();
        if (key === "") throw new Error(this._t("error.required"));
        query = { ByKey: { topic, key } };
      } else {
        const messageId = this.queryIdInput.value().trim();
        if (messageId === "") throw new Error(this._t("error.required"));
        query = { ById: { topic, message_id: messageId } };
      }
      const page = await this.invokeMW("middleware/message/query", query);
      if (!this.isCurrent(token)) return;
      state.page = page;
    } catch (error) {
      if (!this.isCurrent(token)) return;
      state.error = error.message;
    } finally {
      if (this.isCurrent(token)) state.loading = false;
    }
    cx.notify();
  }

  async sendMessage(cx) {
    if (!this.has("send_message")) return;
    const topic = this.sendTopicInput.value().trim();
    const body = this.sendBodyInput.value();
    if (topic === "" || body === "") {
      this.messagesState.sendStatus = this._t("error.required");
      cx.notify();
      return;
    }
    const token = this.beginRefresh();
    this.messagesState.sendStatus = null;
    cx.notify();
    try {
      const tag = this.sendTagInput.value().trim();
      const key = this.sendKeyInput.value().trim();
      const result = await this.invokeMW("middleware/message/send", {
        topic,
        tag: tag === "" ? null : tag,
        key: key === "" ? null : key,
        // SendMessageRequest.body 为字节数组（Vec<u8>）。
        body: utf8Encode(body),
        properties: [],
      });
      if (!this.isCurrent(token)) return;
      this.messagesState.sendStatus =
        `${this._t("messages.send.ok")}: ${result.message_id} (${result.status || "OK"})`;
    } catch (error) {
      if (!this.isCurrent(token)) return;
      this.messagesState.sendStatus = `${this._t("common.failed")}: ${error.message}`;
    }
    cx.notify();
  }

  // ---- 渲染：骨架 -----------------------------------------------------------

  render() {
    return h_flex()
      .size_full()
      .min_w_0()
      .min_h_0()
      .child(this.renderSidebar())
      .child(
        v_flex()
          .flex_1()
          .size_full()
          .min_w_0()
          .p(16)
          .gap(12)
          .child(this.renderHeader())
          .child(this.renderContent()),
      );
  }

  renderHeader() {
    const brandInfo = this.brand();
    return v_flex().gap(6)
      .child(h_flex().gap(10).items_center()
        .child(div().text_size(18).font_semibold().child(brandInfo.title || "Middleware"))
        .child(div().opacity(0.7).child(brandInfo.subtitle || "")))
      .child(h_flex().gap(8).items_center()
        .child(div().opacity(0.7).child(this.status))
        .children(compact([
          this.versionWarning
            ? h_flex().gap(6).items_center()
                .child(new Badge().child(div().child(
                  `v${formatValue(this.standardVersion, "?")}`,
                )))
                .child(div().text_color("accent").child(this._t("status.version_warning")))
            : null,
        ]))
        .child(this.actionButton("mw-refresh", this._t("common.refresh"), (cx) => {
          cx.spawn(async (cx2) => this.loadCurrentPage(cx2));
        })));
  }

  // 左侧导航（仿 explorer.js 的 sidebar Button 列表）。
  renderSidebar() {
    return v_flex()
      .w(220)
      .h_full()
      .flex_shrink_0()
      .border_r_1()
      .p(12)
      .gap(8)
      .child(div().font_semibold().child(
        (this.context && this.context.connection && this.context.connection.name) ||
        this.brand().title,
      ))
      .children(this.navItems().map((item) =>
        this.navButton(item.id, this._t(item.labelKey), item.page)));
  }

  // 导航项按能力位显隐。
  navItems() {
    const items = [];
    if (this.has("metrics") || this.has("cluster_overview")) {
      items.push({ id: "mw-nav-overview", labelKey: "nav.overview", page: "overview" });
    }
    if (this.has("topics") || this.has("topic_write")) {
      items.push({ id: "mw-nav-topics", labelKey: "nav.topics", page: "topics" });
    }
    if (this.has("groups") || this.has("clients")) {
      items.push({ id: "mw-nav-groups", labelKey: "nav.groups", page: "groups" });
    }
    if (this.has("message_query") || this.has("send_message")) {
      items.push({ id: "mw-nav-messages", labelKey: "nav.messages", page: "messages" });
    }
    return items;
  }

  navButton(id, label, page) {
    const selected = this.page === page;
    return new Button(id)[selected ? "secondary" : "ghost"]()
      .label(label)
      .on_click((_event, cx) => {
        cx.spawn(async (cx2) => {
          this.page = page;
          await this.loadCurrentPage(cx2);
        });
      });
  }

  actionButton(id, label, run) {
    return new Button(id).label(label).on_click((_event, cx) => {
      cx.spawn(async (cx2) => run(cx2));
    });
  }

  renderContent() {
    if (!this.capabilities) {
      // capabilities 尚未返回：由状态栏表达连接进度。
      return this.loadingLine(this._t("common.loading"));
    }
    if (!this.anyCapability()) {
      return this.emptyState(this._t("status.no_capabilities"));
    }
    if (this.page === "topics") return this.renderTopicsPage();
    if (this.page === "groups") return this.renderGroupsPage();
    if (this.page === "messages") return this.renderMessagesPage();
    return this.renderOverviewPage();
  }

  // ---- 渲染：通用小部件 -------------------------------------------------------

  loadingLine(text) {
    return div().flex_1().min_h_0().items_center().justify_center().child(
      div().opacity(0.7).child(text || this._t("common.loading")),
    );
  }

  emptyState(text) {
    return div().flex_1().min_h_0().items_center().justify_center().child(
      div().opacity(0.7).child(text || this._t("common.empty")),
    );
  }

  errorBox(message) {
    if (!message) return null;
    return div().p(8).rounded(6).text_color("destructive").child(
      `${this._t("common.failed")}: ${message}`,
    );
  }

  sectionTitle(text) {
    return div().text_size(14).font_semibold().child(text);
  }

  fieldLabel(text) {
    return div().text_size(12).opacity(0.7).child(text);
  }

  // 键值对列表（description list 风格，用基础 div 实现以保证列宽可控）。
  keyValueList(pairs) {
    return v_flex().gap(4).children(pairs.map(([key, value]) =>
      h_flex().gap(8)
        .child(div().w(140).flex_shrink_0().opacity(0.7).child(key))
        .child(div().flex_1().min_w_0().child(value))));
  }

  // 通用表格小部件：列 key 数组 + 行数组 + 单元格渲染。
  // DataTableState/DataTable 均为位置参数构造；状态按「id + 列签名」复用。
  tableWidget(id, columns, rows, renderCell) {
    const stateKey = `${id}:${columns.join("|")}`;
    if (!this._tableStates[stateKey]) {
      this._tableStates[stateKey] = DataTableState(columns);
    }
    return new DataTable(
      this._tableStates[stateKey],
      () => rows,
      (row, column) => renderCell(row, column),
    )
      .stripe(true)
      .bordered(true);
  }

  // 单元格默认渲染：空值占位、数字格式化、其余转字符串。
  cellText(row, column) {
    return formatValue(row[column], this._t("common.none"));
  }

  // 行首列渲染为可点击链接（DataTable 无行选中回调，用链接按钮承载行点击）。
  linkCell(id, text, run) {
    return new Button(id).link().label(text).on_click((_event, cx) => {
      cx.spawn(async (cx2) => run(cx2));
    });
  }

  // ---- 渲染：概览页 -----------------------------------------------------------

  renderOverviewPage() {
    if (!this.has("metrics") && !this.has("cluster_overview")) {
      return this.emptyState(this._t("overview.no_capability"));
    }
    const state = this.overviewState;
    return v_flex().flex_1().min_h_0().overflow_y_scrollbar().gap(16)
      .children(compact([
        state.loading ? this.loadingLine() : null,
        this.errorBox(state.error),
        this.has("metrics") ? this.renderMetricsSection(state.metrics) : null,
        this.has("cluster_overview") ? this.renderTopologySection(state.cluster) : null,
      ]));
  }

  // 指标卡片：tps_in/tps_out/topic_count/connection_count/message_count_today
  // + extras 按 metricsExtrasOrder() 顺序提示排列。
  renderMetricsSection(metrics) {
    const cards = [];
    const pushCard = (label, value) => {
      cards.push(
        v_flex().w(150).flex_shrink_0().p(12).gap(6).border_r_1().rounded(6)
          .child(this.fieldLabel(label))
          .child(div().text_size(18).font_semibold().child(value)),
      );
    };
    if (metrics) {
      for (const [key, label] of METRIC_KEYS) {
        pushCard(label, formatValue(metrics[key], this._t("common.none")));
      }
      for (const [key, value] of this.orderedExtras(metrics.extras)) {
        pushCard(key, formatValue(value, this._t("common.none")));
      }
    } else {
      pushCard(this._t("overview.metrics"), this._t("common.none"));
    }
    return v_flex().gap(10)
      .child(this.sectionTitle(this._t("overview.metrics")))
      .child(h_flex().gap(12).flex_wrap().children(cards));
  }

  // extras 排序：metricsExtrasOrder() 中出现的键按其顺序排列，其余按原始顺序追加。
  orderedExtras(extras) {
    const pairs = [];
    for (const entry of extras || []) {
      if (Array.isArray(entry)) pairs.push([String(entry[0]), entry[1]]);
      else pairs.push([String(entry.key || ""), entry.value]);
    }
    const order = this.metricsExtrasOrder() || [];
    const ordered = [];
    const remaining = pairs.slice();
    for (const key of order) {
      const index = remaining.findIndex(([eachKey]) => eachKey === key);
      if (index >= 0) ordered.push(remaining.splice(index, 1)[0]);
    }
    for (const pair of remaining) ordered.push(pair);
    return ordered;
  }

  // 集群拓扑表：clusters → brokers 行
  //（cluster/name/address/topic_count/queue_count/version/tps_in/tps_out）。
  renderTopologySection(cluster) {
    const rows = [];
    for (const clusterInfo of (cluster && cluster.clusters) || []) {
      for (const broker of clusterInfo.brokers || []) {
        const row = { cluster: clusterInfo.name };
        for (const key of ["name", "address", "topic_count", "queue_count", "version", "tps_in", "tps_out"]) {
          row[key] = broker[key];
        }
        rows.push(row);
      }
    }
    return v_flex().gap(10).min_h_0()
      .child(this.sectionTitle(this._t("overview.topology")))
      .children(compact([
        rows.length === 0 ? div().opacity(0.7).child(this._t("common.empty")) : null,
        rows.length === 0 ? null : this.tableWidget(
          "mw-brokers",
          ["cluster", "name", "address", "topic_count", "queue_count", "version", "tps_in", "tps_out"],
          rows,
          (row, column) => div().child(this.cellText(row, column)),
        ),
      ]));
  }

  // ---- 渲染：Topic 页 ---------------------------------------------------------

  renderTopicsPage() {
    if (!this.has("topics") && !this.has("topic_write")) {
      return this.emptyState(this._t("topics.no_capability"));
    }
    const state = this.topicsState;
    return v_flex().flex_1().min_h_0().overflow_y_scrollbar().gap(16)
      .children(compact([
        state.loading ? this.loadingLine() : null,
        this.errorBox(state.error),
        this.has("topics") ? this.renderTopicList(state) : null,
        this.has("topic_write") ? this.renderTopicCreate(state) : null,
        state.selectedTopic ? this.renderTopicDetail(state) : null,
      ]));
  }

  renderTopicList(state) {
    // 基础列 + extraTopicColumns() 追加列。
    const columns = ["name", "topic_type", "queue_count", "perm", "message_count", "created_at"];
    for (const extra of this.extraTopicColumns() || []) {
      if (extra && extra.key && !columns.includes(extra.key)) columns.push(extra.key);
    }
    const rows = state.topics || [];
    return v_flex().gap(10).min_h_0()
      .child(this.sectionTitle(this._t("topics.title")))
      .children(compact([
        rows.length === 0 ? div().opacity(0.7).child(this._t("common.empty")) : null,
        rows.length === 0 ? null : this.tableWidget("mw-topics", columns, rows, (row, column) => {
          if (column === "name") {
            // 行点击：第一列渲染为链接，加载 TopicDetail。
            return this.linkCell(
              `mw-topic-open-${row.name}`,
              formatValue(row.name, this._t("common.none")),
              (cx) => this.openTopicDetail(row.name, cx),
            );
          }
          return div().child(this.cellText(row, column));
        }),
      ]));
  }

  renderTopicCreate(state) {
    if (!state.showCreate) {
      return h_flex().gap(8)
        .child(this.actionButton("mw-topic-new", this._t("topics.create"), (cx) => {
          state.showCreate = true;
          cx.notify();
        }));
    }
    return v_flex().gap(10)
      .child(this.sectionTitle(this._t("topics.create")))
      .child(h_flex().gap(8).items_center()
        .child(v_flex().gap(4).flex_1().min_w_0()
          .child(this.fieldLabel(this._t("topics.create.topic")))
          .child(Input.new(this.createTopicInput)))
        .child(v_flex().gap(4).w(120)
          .child(this.fieldLabel(this._t("topics.create.queue_count")))
          .child(Input.new(this.createQueueInput)))
        .child(v_flex().gap(4).w(140)
          .child(this.fieldLabel(this._t("topics.create.perm")))
          .child(Input.new(this.createPermInput))))
      .child(h_flex().gap(8)
        .child(this.actionButton("mw-topic-create-submit", this._t("topics.create.submit"), (cx) => {
          cx.spawn(async (cx2) => this.createTopic(cx2));
        }))
        .child(this.actionButton("mw-topic-create-cancel", this._t("common.cancel"), (cx) => {
          state.showCreate = false;
          cx.notify();
        })));
  }

  // TopicDetail：stats 按 broker/queue_id 的 min/max offset 表 + 删除按钮（topic_write）。
  renderTopicDetail(state) {
    const detail = state.detail;
    const rows = (detail && detail.stats) || [];
    return v_flex().gap(10).min_h_0()
      .child(this.sectionTitle(`${this._t("topics.detail")}: ${state.selectedTopic}`))
      .children(compact([
        rows.length === 0 && !state.loading
          ? div().opacity(0.7).child(this._t("common.empty"))
          : null,
        rows.length === 0 ? null : this.tableWidget(
          "mw-topic-detail",
          ["broker", "queue_id", "min_offset", "max_offset", "last_update"],
          rows,
          (row, column) => div().child(this.cellText(row, column)),
        ),
        this.has("topic_write")
          ? this.actionButton("mw-topic-delete", this._t("topics.delete"), (cx) => {
              cx.spawn(async (cx2) => this.deleteTopic(state.selectedTopic, cx2));
            })
          : null,
      ]));
  }

  // ---- 渲染：订阅组·客户端页 ---------------------------------------------------

  renderGroupsPage() {
    if (!this.has("groups") && !this.has("clients")) {
      return this.emptyState(this._t("groups.no_capability"));
    }
    const state = this.groupsState;
    return v_flex().flex_1().min_h_0().overflow_y_scrollbar().gap(16)
      .children(compact([
        state.loading ? this.loadingLine() : null,
        this.errorBox(state.error),
        this.has("groups") ? this.renderGroupList(state) : null,
        state.selectedGroup ? this.renderGroupDetail(state) : null,
      ]));
  }

  renderGroupList(state) {
    const rows = state.groups || [];
    return v_flex().gap(10).min_h_0()
      .child(this.sectionTitle(this._t("groups.title")))
      .children(compact([
        rows.length === 0 ? div().opacity(0.7).child(this._t("common.empty")) : null,
        rows.length === 0 ? null : this.tableWidget(
          "mw-groups",
          ["group", "client_count", "consume_type", "message_model", "tps", "total_diff", "version", "update_time"],
          rows,
          (row, column) => {
            if (column === "group") {
              // 行点击：加载 GroupConsumeDetail 与 group/clients。
              return this.linkCell(
                `mw-group-open-${row.group}`,
                formatValue(row.group, this._t("common.none")),
                (cx) => this.openGroupDetail(row.group, cx),
              );
            }
            return div().child(this.cellText(row, column));
          },
        ),
      ]));
  }

  // GroupConsumeDetail：queues 消费进度表 + 客户端表（clients 能力位）。
  renderGroupDetail(state) {
    const queues = (state.detail && state.detail.queues) || [];
    const clientRows = state.clients || [];
    return v_flex().gap(10).min_h_0()
      .child(this.sectionTitle(`${this._t("groups.consume_detail")}: ${state.selectedGroup}`))
      .children(compact([
        queues.length === 0 ? div().opacity(0.7).child(this._t("common.empty")) : null,
        queues.length === 0 ? null : this.tableWidget(
          "mw-group-queues",
          ["topic", "broker", "queue_id", "broker_offset", "consumer_offset", "diff"],
          queues,
          (row, column) => div().child(this.cellText(row, column)),
        ),
        this.has("clients") ? this.sectionTitle(this._t("groups.clients")) : null,
        this.has("clients") && clientRows.length === 0
          ? div().opacity(0.7).child(this._t("common.empty"))
          : null,
        this.has("clients") && clientRows.length > 0 ? this.tableWidget(
          "mw-group-clients",
          ["client_id", "client_addr", "language", "version", "subscriptions"],
          clientRows,
          (row, column) => div().child(
            column === "subscriptions"
              ? formatValue((row.subscriptions || []).join(", "), this._t("common.none"))
              : this.cellText(row, column),
          ),
        ) : null,
      ]));
  }

  // ---- 渲染：消息查询页 ---------------------------------------------------------

  renderMessagesPage() {
    if (!this.has("message_query") && !this.has("send_message")) {
      return this.emptyState(this._t("messages.no_capability"));
    }
    const state = this.messagesState;
    return v_flex().flex_1().min_h_0().overflow_y_scrollbar().gap(16)
      .children(compact([
        state.loading ? this.loadingLine() : null,
        this.errorBox(state.error),
        this.has("message_query") ? this.renderMessageQueryForm() : null,
        this.has("message_query") ? this.renderMessageResults() : null,
        state.detail ? this.renderMessageDetail(state.detail) : null,
        this.has("send_message") ? this.renderSendForm() : null,
      ]));
  }

  renderMessageQueryForm() {
    const state = this.messagesState;
    const modeOptions = [
      { id: "by_time", label: this._t("messages.mode.by_time") },
      { id: "by_key", label: this._t("messages.mode.by_key") },
      { id: "by_id", label: this._t("messages.mode.by_id") },
    ];
    const modeRows = [];
    if (state.mode === "by_time") {
      modeRows.push(
        h_flex().gap(8).items_center()
          .child(v_flex().gap(4).flex_1().min_w_0()
            .child(this.fieldLabel(`${this._t("messages.begin")} (${this._t("messages.time_hint")})`))
            .child(Input.new(this.queryBeginInput)))
          .child(v_flex().gap(4).flex_1().min_w_0()
            .child(this.fieldLabel(`${this._t("messages.end")} (${this._t("messages.time_hint")})`))
            .child(Input.new(this.queryEndInput))),
      );
    } else if (state.mode === "by_key") {
      modeRows.push(
        h_flex().gap(8).items_center()
          .child(v_flex().gap(4).flex_1().min_w_0()
            .child(this.fieldLabel(this._t("messages.key")))
            .child(Input.new(this.queryKeyInput))),
      );
    } else {
      modeRows.push(
        h_flex().gap(8).items_center()
          .child(v_flex().gap(4).flex_1().min_w_0()
            .child(this.fieldLabel(this._t("messages.message_id")))
            .child(Input.new(this.queryIdInput))),
      );
    }
    return v_flex().gap(10)
      .child(this.sectionTitle(this._t("messages.title")))
      .child(
        // 查询模式切换（Select：id, rowsFn, renderRowFn, onSelect 位置参数）。
        new Select(
          "mw-msg-mode",
          () => modeOptions,
          (option) => div().child(option.label),
          (value, cx) => {
            this.messagesState.mode = value;
            this.messagesState.pageIndex = 1;
            cx.notify();
          },
        ).placeholder(this._t(`messages.mode.${state.mode}`)),
      )
      .child(h_flex().gap(8).items_center()
        .child(v_flex().gap(4).flex_1().min_w_0()
          .child(this.fieldLabel(this._t("messages.topic")))
          .child(Input.new(this.queryTopicInput)))
        .child(v_flex().gap(4).w(120).flex_shrink_0()
          .child(this.fieldLabel(this._t("messages.page_size")))
          .child(new Select(
            "mw-msg-page-size",
            () => PAGE_SIZES.map((size) => ({ id: String(size), label: String(size) })),
            (option) => div().child(option.label),
            (value, cx) => {
              this.messagesState.pageSize = parsePositiveInt(value, 20);
              this.messagesState.pageIndex = 1;
              cx.notify();
            },
          ).placeholder(String(state.pageSize)))))
      .children(modeRows)
      .child(this.actionButton("mw-msg-query", this._t("messages.query"), (cx) => {
        cx.spawn(async (cx2) => this.loadMessages(cx2));
      }));
  }

  renderMessageResults() {
    const state = this.messagesState;
    const page = state.page;
    if (!page) {
      return v_flex().gap(10)
        .child(this.sectionTitle(this._t("messages.query.result")))
        .child(div().opacity(0.7).child(this._t("common.empty")));
    }
    const messages = page.messages || [];
    const total = Number(page.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
    return v_flex().gap(10)
      .child(this.sectionTitle(this._t("messages.query.result")))
      .children(compact([
        messages.length === 0 ? div().opacity(0.7).child(this._t("common.empty")) : null,
        messages.length === 0 ? null : this.tableWidget(
          "mw-messages",
          ["message_id", "topic", "tag", "key", "store_time", "born_time", "retry_times"],
          messages,
          (row, column) => {
            if (column === "message_id") {
              // 行点击：加载消息详情（含 body_text 与 properties）。
              return this.linkCell(
                `mw-msg-open-${row.message_id}`,
                formatValue(row.message_id, this._t("common.none")),
                (cx) => {
                  this.messagesState.detail = row;
                  cx.notify();
                },
              );
            }
            if (column === "tag") {
              // tag 用 Badge 展示（nullary 构造 + children）。
              const tag = row.tag;
              if (tag === null || tag === undefined || tag === "") {
                return div().child(this._t("common.none"));
              }
              return new Badge().child(div().child(formatValue(tag, "")));
            }
            return div().child(this.cellText(row, column));
          },
        ),
        // 分页（ByTimeWindow 模式才有服务端分页语义；10/20/50 由页大小 Select 控制）。
        state.mode === "by_time"
          ? h_flex().gap(8).items_center()
              .child(div().opacity(0.7).child(formatValue(total, "0")))
              .child(new Pagination("mw-msg-pagination")
                .current_page(state.pageIndex)
                .total_pages(totalPages)
                .on_change((nextPage, cx) => {
                  this.messagesState.pageIndex = Math.max(1, Math.floor(nextPage));
                  cx.notify();
                  // 翻页后立即按新页码查询。
                  cx.spawn(async (cx2) => this.loadMessages(cx2));
                }))
          : null,
      ]));
  }

  renderMessageDetail(message) {
    const none = this._t("common.none");
    const pairs = [
      ["message_id", formatValue(message.message_id, none)],
      ["topic", formatValue(message.topic, none)],
      ["tag", formatValue(message.tag, none)],
      ["key", formatValue(message.key, none)],
      ["store_time", formatValue(message.store_time, none)],
      ["born_time", formatValue(message.born_time, none)],
      ["store_host", formatValue(message.store_host, none)],
      ["born_host", formatValue(message.born_host, none)],
      ["retry_times", formatValue(message.retry_times, none)],
      [this._t("messages.body_text"),
        message.body_text === null || message.body_text === undefined
          ? this._t("messages.binary_body")
          : message.body_text],
    ];
    // properties 键值表：Vec<(String,String)> 序列化为 [["k","v"],...]。
    const properties = message.properties || [];
    return v_flex().gap(10)
      .child(this.sectionTitle(this._t("messages.detail")))
      .child(this.keyValueList(pairs))
      .children(compact([
        properties.length > 0 ? this.sectionTitle(this._t("messages.properties")) : null,
        properties.length > 0 ? this.keyValueList(properties.map((entry) => {
          if (Array.isArray(entry)) return [String(entry[0]), formatValue(entry[1], "")];
          return [String(entry.key || ""), formatValue(entry.value, "")];
        })) : null,
      ]))
      .child(this.actionButton("mw-msg-detail-close", this._t("common.close"), (cx) => {
        this.messagesState.detail = null;
        cx.notify();
      }));
  }

  renderSendForm() {
    const state = this.messagesState;
    return v_flex().gap(10)
      .child(this.sectionTitle(this._t("messages.send")))
      .child(h_flex().gap(8).items_center()
        .child(v_flex().gap(4).flex_1().min_w_0()
          .child(this.fieldLabel(this._t("messages.topic")))
          .child(Input.new(this.sendTopicInput)))
        .child(v_flex().gap(4).w(140)
          .child(this.fieldLabel(this._t("messages.send.tag")))
          .child(Input.new(this.sendTagInput)))
        .child(v_flex().gap(4).w(140)
          .child(this.fieldLabel(this._t("messages.send.key")))
          .child(Input.new(this.sendKeyInput))))
      .child(v_flex().gap(4).min_w_0()
        .child(this.fieldLabel(this._t("messages.send.body")))
        .child(Input.new(this.sendBodyInput)))
      .child(h_flex().gap(8).items_center()
        .child(this.actionButton("mw-msg-send", this._t("messages.send.submit"), (cx) => {
          cx.spawn(async (cx2) => this.sendMessage(cx2));
        }))
        .children(compact([
          state.sendStatus ? div().child(state.sendStatus) : null,
        ])));
  }
}
