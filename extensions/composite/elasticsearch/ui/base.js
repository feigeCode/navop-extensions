// Elasticsearch Console — shared base (QuickJS / gpui + gpui-base + gpui-component).
//
// Subclasses only override `brand()` and `defaultTab()`. All other rendering
// and data loading lives here. Capability gating comes from
// `elasticsearch/capabilities`; write operations require the matching flag.

import { Buffer } from "buffer";
import { View, div } from "gpui";
import { h_flex, v_flex, v_virtual_list } from "gpui-base";
import {
  Badge,
  Button,
  DataTable,
  DataTableState,
  Editor,
  EditorState,
  InfoAlert,
  Input,
  InputState,
  Pagination,
  PieChart,
  Spinner,
  Text,
  Tooltip,
} from "gpui-component";
import { close as closeBlob, read as readBlob } from "navop.blob";
import { current } from "navop.context";
import {
  cancel as cancelJob,
  close as closeJob,
  result as jobResult,
  start as startJob,
  status as jobStatus,
} from "navop.job";
import { info as logInfo, warn as logWarn, error as logError } from "navop.log";
import { invoke } from "navop.resource";

const TAB_OVERVIEW = "overview";
const TAB_INDICES = "indices";
const TAB_INDEX_DETAIL = "index-detail";
const TAB_NODES = "nodes";
const TAB_SEARCH = "search";
const TAB_TASKS = "tasks";

const DETAIL_OVERVIEW = "overview";
const DETAIL_MAPPING = "mapping";
const DETAIL_SETTINGS = "settings";
const DETAIL_ALIASES = "aliases";
const DETAIL_STATS = "stats";
const DETAIL_SHARDS = "shards";

const HEALTH_COLORS = {
  green: "green-500",
  yellow: "amber-500",
  red: "red-500",
};

function colorForHealth(health) {
  return HEALTH_COLORS[health] || "muted";
}

function colorForStatus(status) {
  if (status === "open") return "green-500";
  if (status === "closed") return "muted";
  if (status === "unassigned") return "red-500";
  return "muted";
}

export class ConsoleView extends View {
  init(_props, cx) {
    this.context = current();
    this.resource = this.context?.connection?.resource?.handle ?? null;
    this.connectionName = this.context?.connection?.name ?? "Elasticsearch";
    this.caps = {};
    this.standardVersion = 0;
    this.generation = 0;
    this.refreshing = false;
    this.statusMessage = null;
    this.activeTab = this.defaultTab();
    this.detailTab = DETAIL_OVERVIEW;
    this.selectedIndex = null;

    this.cluster = null;
    this.health = null;
    this.clusterStats = null;
    this.nodes = [];
    this.indices = [];
    this.indexFilter = InputState.new({ value: "" });
    this.indicesPage = 1;
    this.indicesPageSize = 20;
    this.indexFilter.on("change", () => {
      this.indicesPage = 1;
    });

    this.indexDetail = { info: null, mapping: null, settings: null, aliases: null, stats: null, shards: null };
    this.indexDetailLoading = false;

    this.searchEditor = EditorState('{\n  "query": { "match_all": {} }\n}', "json");
    this.searchIndices = InputState.new({ value: "*" });
    this.searchSize = InputState.new({ value: "20" });
    this.searchFrom = InputState.new({ value: "0" });
    this.searchSort = InputState.new({ value: "" });
    this.searching = false;
    this.searchResult = null;
    this.searchError = null;
    this.expandedHitIndex = -1;

    this.recentSearches = [];
    this.toastId = 0;

    cx.spawn(async (cx) => this.bootstrap(cx));
  }

  defaultTab() { return TAB_OVERVIEW; }
  brand() { return { title: "Elasticsearch", subtitle: this.connectionName }; }

  async bootstrap(cx) {
    if (!this.resource) {
      this.statusMessage = "未连接到 Elasticsearch 资源";
      cx.notify();
      return;
    }
    await this.loadCapabilities(cx);
    await this.refreshOverview(cx);
    cx.notify();
  }

  async loadCapabilities(cx) {
    try {
      const value = await this.resolve(invoke(this.resource, "elasticsearch/capabilities", {}));
      this.caps = value?.capabilities ?? {};
      this.standardVersion = value?.standard_version ?? 0;
    } catch (error) {
      this.caps = {};
      this.statusMessage = `无法读取能力位: ${error.message}`;
    }
    cx.notify();
  }

  canWriteIndices() { return this.caps.index_write === true; }
  canWriteDocuments() { return this.caps.document_write === true; }
  canWriteAliases() { return this.caps.alias_write === true; }

  async refreshOverview(cx) {
    if (!this.resource) return;
    this.refreshing = true;
    cx.notify();
    const generation = ++this.generation;
    try {
      const [info, health, indices, stats] = await Promise.all([
        this.resolve(invoke(this.resource, "elasticsearch/cluster/info", {})),
        this.tryResolve(() => invoke(this.resource, "elasticsearch/cluster/health", {})),
        this.resolve(invoke(this.resource, "elasticsearch/index/list", {})),
        this.tryResolve(() => invoke(this.resource, "elasticsearch/cluster/stats", {})),
      ]);
      if (generation !== this.generation) return;
      this.cluster = info;
      this.health = health;
      this.clusterStats = stats;
      this.indices = indices.indices || [];
      this.indicesPage = 1;
      this.statusMessage = null;
    } catch (error) {
      this.statusMessage = `刷新失败: ${error.message}`;
    } finally {
      this.refreshing = false;
      cx.notify();
    }
  }

  async refreshNodes(cx) {
    if (!this.resource) return;
    try {
      const value = await this.resolve(invoke(this.resource, "elasticsearch/nodes/list", {}));
      this.nodes = value.nodes || [];
    } catch (error) {
      this.toast("error", "获取节点失败", error.message);
    }
    cx.notify();
  }

  async loadIndexDetail(name, cx) {
    if (!this.resource || !name) return;
    this.indexDetailLoading = true;
    cx.notify();
    try {
      const [info, mapping, settings, aliases, stats, shards] = await Promise.all([
        this.tryResolve(() => invoke(this.resource, "elasticsearch/index/get", { name })),
        this.tryResolve(() => invoke(this.resource, "elasticsearch/index/mapping", { name })),
        this.tryResolve(() => invoke(this.resource, "elasticsearch/index/settings", { name })),
        this.tryResolve(() => invoke(this.resource, "elasticsearch/index/aliases", { name })),
        this.tryResolve(() => invoke(this.resource, "elasticsearch/index/stats", { name })),
        this.tryResolve(() => invoke(this.resource, "elasticsearch/index/shards", { name })),
      ]);
      this.indexDetail = { info, mapping, settings, aliases, stats, shards };
      this.statusMessage = null;
    } catch (error) {
      this.toast("error", "加载索引详情失败", error.message);
    } finally {
      this.indexDetailLoading = false;
      cx.notify();
    }
  }

  selectIndex(name, cx) {
    this.selectedIndex = name;
    this.detailTab = DETAIL_OVERVIEW;
    this.activeTab = TAB_INDEX_DETAIL;
    cx.spawn(async (cx) => this.loadIndexDetail(name, cx));
  }

  goToTab(tab, cx) {
    this.activeTab = tab;
    if (tab === TAB_NODES && this.nodes.length === 0) {
      cx.spawn(async (cx) => this.refreshNodes(cx));
    }
    cx.notify();
  }

  async runSearch(cx) {
    if (!this.resource) return;
    const query = this.searchEditor.text();
    let body;
    try {
      body = JSON.parse(query);
    } catch (error) {
      this.searchError = `DSL 解析失败: ${error.message}`;
      this.searchResult = null;
      cx.notify();
      return;
    }
    const indices = parseCsv(this.searchIndices.value());
    const size = parseIntOr(this.searchSize.value(), 20);
    const from = parseIntOr(this.searchFrom.value(), 0);
    const sort = parseCsv(this.searchSort.value());

    this.searching = true;
    this.searchError = null;
    cx.notify();

    try {
      const params = { indices, from, size, body, track_total_hits: true };
      if (sort.length > 0) params.sort = sort;
      const value = await this.resolve(await invoke(this.resource, "elasticsearch/search", params));
      this.searchResult = value;
      const total = value?.raw?.hits?.total?.value ?? 0;
      this.recordRecentSearch({ query, indices, size, from, sort, total, took: value?.raw?.took });
      this.statusMessage = null;
    } catch (error) {
      this.searchError = error.message;
    } finally {
      this.searching = false;
      cx.notify();
    }
  }

  recordRecentSearch(entry) {
    this.recentSearches = [{ ...entry, at: Date.now() }, ...this.recentSearches].slice(0, 20);
  }

  async performRefreshIndex(name, cx) {
    if (!this.canWriteIndices()) { this.toast("error", "权限不足", "缺少 index_write 能力"); return; }
    try {
      await this.resolve(invoke(this.resource, "elasticsearch/index/refresh", { name }));
      this.toast("success", "刷新成功", name);
      cx.spawn(async (cx) => this.loadIndexDetail(name, cx));
    } catch (error) { this.toast("error", "刷新失败", error.message); }
    cx.notify();
  }

  async performCloseIndex(name, cx) {
    if (!this.canWriteIndices()) { this.toast("error", "权限不足", "缺少 index_write 能力"); return; }
    try {
      await this.resolve(invoke(this.resource, "elasticsearch/index/close", { name }));
      this.toast("success", "已关闭", name);
      cx.spawn(async (cx) => { await this.loadIndexDetail(name, cx); await this.refreshOverview(cx); });
    } catch (error) { this.toast("error", "关闭失败", error.message); }
    cx.notify();
  }

  async performOpenIndex(name, cx) {
    if (!this.canWriteIndices()) { this.toast("error", "权限不足", "缺少 index_write 能力"); return; }
    try {
      await this.resolve(invoke(this.resource, "elasticsearch/index/open", { name }));
      this.toast("success", "已打开", name);
      cx.spawn(async (cx) => { await this.loadIndexDetail(name, cx); await this.refreshOverview(cx); });
    } catch (error) { this.toast("error", "打开失败", error.message); }
    cx.notify();
  }

  async performDeleteIndex(name, cx) {
    if (!this.canWriteIndices()) { this.toast("error", "权限不足", "缺少 index_write 能力"); return; }
    const confirmed = await this.confirm({
      title: "删除索引",
      message: `确定删除索引 “${name}” 吗？该操作不可撤销。`,
      confirmLabel: "删除",
      danger: true,
    });
    if (!confirmed) return;
    try {
      await this.resolve(invoke(this.resource, "elasticsearch/index/delete", { name }));
      this.toast("success", "已删除", name);
      this.selectedIndex = null;
      this.activeTab = TAB_INDICES;
      cx.spawn(async (cx) => this.refreshOverview(cx));
    } catch (error) { this.toast("error", "删除失败", error.message); }
    cx.notify();
  }

  async performCreateIndex(payload, cx) {
    if (!this.canWriteIndices()) { this.toast("error", "权限不足", "缺少 index_write 能力"); return; }
    try {
      await this.resolve(invoke(this.resource, "elasticsearch/index/create", payload));
      this.toast("success", "已创建", payload.name);
      cx.spawn(async (cx) => this.refreshOverview(cx));
    } catch (error) { this.toast("error", "创建失败", error.message); }
  }

  async performAddAlias(index, alias, filter, cx) {
    if (!this.canWriteAliases()) { this.toast("error", "权限不足", "缺少 alias_write 能力"); return; }
    const action = { add: { index, alias } };
    if (filter) action.add.filter = filter;
    try {
      await this.resolve(invoke(this.resource, "elasticsearch/index/alias/update", { actions: [action] }));
      this.toast("success", "别名已添加", `${alias} → ${index}`);
      cx.spawn(async (cx) => this.loadIndexDetail(index, cx));
    } catch (error) { this.toast("error", "添加别名失败", error.message); }
  }

  async performRemoveAlias(index, alias, cx) {
    if (!this.canWriteAliases()) { this.toast("error", "权限不足", "缺少 alias_write 能力"); return; }
    try {
      await this.resolve(invoke(this.resource, "elasticsearch/index/alias/update", { actions: [{ remove: { index, alias } }] }));
      this.toast("success", "别名已移除", alias);
      cx.spawn(async (cx) => this.loadIndexDetail(index, cx));
    } catch (error) { this.toast("error", "移除别名失败", error.message); }
  }

  setStatus(message) { this.statusMessage = message; }

  toast(level, title, description) {
    this.toastId += 1;
    if (typeof window !== "undefined" && window.push_toast) {
      window.push_toast({ id: `es-toast-${this.toastId}`, level, title, description, timeout: level === "error" ? 6000 : 3500 });
    } else {
      const line = `[${level}] ${title}: ${description || ""}`;
      if (level === "error") logError(line);
      else if (level === "warn") logWarn(line);
      else logInfo(line);
    }
  }

  confirm(options) {
    return new Promise((resolve) => {
      const close = () => { if (typeof window !== "undefined" && window.close_dialog) window.close_dialog(); };
      const ok = () => { close(); resolve(true); };
      const cancel = () => { close(); resolve(false); };
      const view = () => this.renderConfirmContent({ ...options, ok, cancel });
      if (typeof window !== "undefined" && window.open_dialog) {
        window.open_dialog(view, { escape_dismissable: true });
      } else {
        resolve(false);
      }
    });
  }

  renderConfirmContent({ title, message, confirmLabel, danger, ok, cancel }) {
    const okBtn = danger
      ? new Button("es-confirm-ok").danger().label(confirmLabel || "确认")
      : new Button("es-confirm-ok").primary().label(confirmLabel || "确认");
    return v_flex()
      .w(440)
      .gap(12)
      .p(16)
      .bg("background")
      .text_color("foreground")
      .child(div().text_size(15).font_semibold().child(new Text(title || "确认操作")))
      .child(div().text_size(13).text_color("muted").child(new Text(message || "")))
      .child(
        h_flex().gap(8).justify_end()
          .child(new Button("es-confirm-cancel").ghost().label("取消").on_click((_e, cx) => { cancel(); cx.notify(); }))
          .child(okBtn.on_click((_e, cx) => { ok(); cx.notify(); })),
      );
  }

  // ---------- rendering ----------

  render() {
    return h_flex()
      .size_full()
      .min_w_0()
      .min_h_0()
      .bg("background")
      .text_color("foreground")
      .child(this.renderSidebar())
      .child(
        v_flex()
          .flex_1()
          .size_full()
          .min_w_0()
          .min_h_0()
          .child(this.renderHeader())
          .child(
            v_flex()
              .flex_1()
              .min_h_0()
              .min_w_0()
              .p(16)
              .gap(12)
              .child(this.renderTabContent())
          ),
      );
  }

  renderHeader() {
    const brand = this.brand();
    const version = this.cluster?.version?.number || "?";
    const clusterName = this.cluster?.cluster_name || "—";
    const status = this.health?.status || "unknown";
    return h_flex()
      .w_full()
      .items_center()
      .justify_between()
      .px(16)
      .py(10)
      .border_b(1)
      .border_color("border")
      .bg("surface")
      .child(
        h_flex()
          .gap(12)
          .items_center()
          .child(div().text_size(15).font_semibold().child(new Text(`${brand.title} · ${clusterName}`)))
          .child(this.refreshing
            ? new Spinner().size("small")
            : new Badge().color(colorForHealth(status)).child(`状态 ${status}`))
          .child(new Badge().color("muted").child(`ES ${version}`))
          .child(new Badge().color("muted").child(`能力 ${Object.values(this.caps).filter(Boolean).length}`)),
      )
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(this.statusMessage
            ? div().text_size(12).text_color("muted").child(new Text(this.statusMessage))
            : null)
          .child(
            new Button("es-refresh").ghost().label("刷新").on_click((_e, cx) => {
              cx.spawn(async (cx) => this.refreshOverview(cx));
            }),
          ),
      );
  }

  renderSidebar() {
    return v_flex()
      .w(260)
      .h_full()
      .flex_shrink_0()
      .border_r(1)
      .border_color("border")
      .bg("surface")
      .p(12)
      .gap(6)
      .child(
        v_flex()
          .gap(2)
          .pb(8)
          .border_b(1)
          .border_color("border")
          .child(div().text_size(12).font_semibold().text_color("muted").child(new Text(this.brand().title)))
          .child(div().text_size(15).font_semibold().child(new Text(this.connectionName))),
      )
      .child(this.navButton("es-nav-overview", "概览", TAB_OVERVIEW))
      .child(this.navButton("es-nav-indices", "索引", TAB_INDICES))
      .child(this.navButton("es-nav-nodes", "节点", TAB_NODES))
      .child(this.navButton("es-nav-search", "搜索", TAB_SEARCH))
      .child(this.navButton("es-nav-tasks", "任务", TAB_TASKS))
      .child(this.renderRecentSearches());
  }

  renderRecentSearches() {
    if (this.recentSearches.length === 0) return null;
    const items = v_flex().gap(4).mt(12);
    items.child(div().text_size(12).font_semibold().text_color("muted").child(new Text("最近搜索")));
    for (let i = 0; i < Math.min(this.recentSearches.length, 6); i += 1) {
      const entry = this.recentSearches[i];
      const label = (entry.query || JSON.stringify(entry.indices)).slice(0, 36);
      items.child(
        new Button(`es-recent-${i}`).ghost().label(`↩ ${label}`).on_click((_e, cx) => {
          this.activeTab = TAB_SEARCH;
          try { this.searchEditor.set_text(entry.query || '{\n  "query": { "match_all": {} }\n}'); } catch (_) {}
          if (Array.isArray(entry.indices)) this.searchIndices.set_value(entry.indices.join(",") || "*");
          cx.notify();
        }),
      );
    }
    return items;
  }

  navButton(id, label, tab) {
    const active = this.activeTab === tab;
    const btn = active ? new Button(id).label(label) : new Button(id).ghost().label(label);
    return btn
      .w_full()
      .justify_start()
      .on_click((_e, cx) => this.goToTab(tab, cx));
  }

  renderTabContent() {
    switch (this.activeTab) {
      case TAB_INDICES: return this.renderIndicesTab();
      case TAB_INDEX_DETAIL: return this.renderIndexDetailTab();
      case TAB_NODES: return this.renderNodesTab();
      case TAB_SEARCH: return this.renderSearchTab();
      case TAB_TASKS: return this.renderTasksTab();
      default: return this.renderOverviewTab();
    }
  }

  // ---------- Overview ----------

  renderOverviewTab() {
    const indices = this.indices;
    const totalDocs = indices.reduce((sum, idx) => sum + (Number(idx.docs) || 0), 0);
    const totalSize = indices.reduce((sum, idx) => sum + (Number(idx.size_bytes) || 0), 0);
    const counts = { green: 0, yellow: 0, red: 0, unknown: 0 };
    for (const idx of indices) counts[idx.health || "unknown"] = (counts[idx.health || "unknown"] || 0) + 1;
    const nodeCount = this.clusterStats?.nodes?.total ?? (this.cluster?.nodes ? Object.keys(this.cluster.nodes).length : 0);
    return v_flex()
      .gap(16)
      .flex_1()
      .min_h_0()
      .child(
        h_flex()
          .gap(12)
          .child(this.kpi("集群", this.cluster?.cluster_name || "—", "accent"))
          .child(this.kpi("状态", this.health?.status || "unknown", colorForHealth(this.health?.status)))
          .child(this.kpi("节点", String(nodeCount || "—"), "accent"))
          .child(this.kpi("索引", String(indices.length), "accent"))
          .child(this.kpi("文档", formatNumber(totalDocs), "accent"))
          .child(this.kpi("存储", formatBytes(totalSize), "accent")),
      )
      .child(
        h_flex()
          .gap(12)
          .child(
            v_flex()
              .flex_1()
              .gap(8)
              .p(12)
              .rounded(8)
              .border(1)
              .border_color("border")
              .bg("surface")
              .child(div().text_size(13).font_semibold().child(new Text("健康分布")))
              .child(this.renderHealthChart(counts)),
          )
          .child(
            v_flex()
              .flex_1()
              .gap(8)
              .p(12)
              .rounded(8)
              .border(1)
              .border_color("border")
              .bg("surface")
              .child(div().text_size(13).font_semibold().child(new Text("集群信息")))
              .child(this.renderClusterSummary()),
          ),
      )
      .child(
        v_flex()
          .flex_1()
          .min_h_0()
          .gap(8)
          .p(12)
          .rounded(8)
          .border(1)
          .border_color("border")
          .bg("surface")
          .child(
            h_flex()
              .justify_between()
              .items_center()
              .child(div().text_size(13).font_semibold().child(new Text("索引（前 10）")))
              .child(new Button("es-goto-indices").link().label("查看全部 →").on_click((_e, cx) => this.goToTab(TAB_INDICES, cx))),
          )
          .child(this.renderIndicesTable(true)),
      );
  }

  kpi(label, value, color) {
    return v_flex()
      .flex_1()
      .gap(4)
      .p(12)
      .rounded(8)
      .border(1)
      .border_color("border")
      .bg("surface")
      .child(div().text_size(12).text_color("muted").child(new Text(label)))
      .child(div().text_size(18).font_semibold().text_color(color || "foreground").child(new Text(value)));
  }

  renderHealthChart(counts) {
    const rows = () => [
      { label: "green", value: counts.green || 0 },
      { label: "yellow", value: counts.yellow || 0 },
      { label: "red", value: counts.red || 0 },
      { label: "unknown", value: counts.unknown || 0 },
    ];
    return new PieChart(rows).labels(true);
  }

  renderClusterSummary() {
    const cluster = this.cluster;
    if (!cluster) return div().text_color("muted").child(new Text("正在加载..."));
    return v_flex().gap(4).children([
      this.summaryRow("版本", cluster.version?.number),
      this.summaryRow("Lucene", cluster.version?.lucene_version),
      this.summaryRow("构建类型", cluster.version?.build_flavor),
      this.summaryRow("主节点", cluster.cluster_manager || ""),
    ]);
  }

  summaryRow(label, value) {
    return h_flex()
      .justify_between()
      .w_full()
      .child(div().text_color("muted").text_size(12).child(new Text(label)))
      .child(div().text_size(12).font_semibold().child(new Text(value == null ? "—" : String(value))));
  }

  // ---------- Indices ----------

  renderIndicesTab() {
    return v_flex()
      .gap(12)
      .flex_1()
      .min_h_0()
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(Input.new(this.indexFilter).placeholder("过滤索引").w(280))
          .child(new Button("es-reload-indices").ghost().label("刷新列表").on_click((_e, cx) => cx.spawn(async (cx) => this.refreshOverview(cx))))
          .child(this.canWriteIndices()
            ? new Button("es-create-index").primary().label("创建索引").on_click(() => this.openCreateIndexDialog())
            : new Tooltip("es-create-disabled", "需要 index_write 能力", "当前连接没有写权限").child(
                new Button("es-create-index").ghost().label("创建索引").disabled(true),
              )),
      )
      .child(
        v_flex()
          .flex_1()
          .min_h_0()
          .p(12)
          .rounded(8)
          .border(1)
          .border_color("border")
          .bg("surface")
          .child(this.renderIndicesTable(false)),
      );
  }

  renderIndicesTable(compact) {
    const source = this.indices;
    const filter = this.indexFilter.value().toLowerCase();
    const filtered = filter ? source.filter((i) => (i.name || "").toLowerCase().includes(filter)) : source;
    const pageSize = compact ? 10 : this.indicesPageSize;
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (this.indicesPage > totalPages) this.indicesPage = totalPages;
    const start = (this.indicesPage - 1) * pageSize;
    const page = filtered.slice(start, start + pageSize);

    const columns = ["name", "health", "status", "docs", "store", "pri/rep"];
    const rowsFn = () => page;
    const cellFn = (row, column) => this.renderIndexCell(row, column);
    const table = new DataTable(DataTableState(columns), rowsFn, cellFn)
      .stripe(true)
      .bordered(false);

    const tableEl = v_flex().flex_1().min_h_0().child(table);
    if (compact) return tableEl;
    return v_flex()
      .flex_1()
      .min_h_0()
      .gap(8)
      .child(tableEl)
      .child(
        new Pagination("es-indices-pagination")
          .current_page(this.indicesPage)
          .total_pages(totalPages)
          .on_change((page, cx) => { this.indicesPage = page; cx.notify(); }),
      );
  }

  renderIndexCell(row, column) {
    if (column === "name") {
      return h_flex()
        .gap(6)
        .items_center()
        .on_click(() => { /* selection only; nav via row double handled by host */ })
        .child(div().font_semibold().child(new Text(row.name || "—")))
        .child(row.status === "closed" ? new Badge().color("muted").child("closed") : null);
    }
    if (column === "health") return new Badge().color(colorForHealth(row.health)).child(row.health || "unknown");
    if (column === "status") return new Badge().color(colorForStatus(row.status)).child(row.status || "—");
    if (column === "docs") return new Text(formatNumber(row.docs));
    if (column === "store") return new Text(formatBytes(row.size_bytes));
    if (column === "pri/rep") return new Text(`${row.pri ?? "—"}/${row.rep ?? "—"}`);
    return new Text("—");
  }

  // ---------- Index detail ----------

  renderIndexDetailTab() {
    const name = this.selectedIndex;
    if (!name) {
      return v_flex()
        .gap(8)
        .child(div().text_color("muted").child(new Text("未选择索引")))
        .child(new Button("es-back-to-indices").ghost().label("返回索引列表").on_click((_e, cx) => this.goToTab(TAB_INDICES, cx)));
    }
    const isClosed = this.indexDetail.info?.[name]?.settings?.index?.provided_name ? false : (this.indices.find((i) => i.name === name)?.status === "closed");
    return v_flex()
      .gap(12)
      .flex_1()
      .min_h_0()
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .child(new Button("es-back-indices").ghost().label("← 索引").on_click((_e, cx) => this.goToTab(TAB_INDICES, cx)))
          .child(div().text_size(18).font_semibold().child(new Text(name)))
          .child(this.indexDetailLoading ? new Spinner().size("small") : null)
          .child(new Button("es-refresh-detail").ghost().label("刷新").on_click((_e, cx) => cx.spawn(async (cx) => this.loadIndexDetail(name, cx))))
          .child(this.canWriteIndices() && !isClosed
            ? new Button("es-refresh-index").ghost().label("刷新缓存").on_click((_e, cx) => cx.spawn(async (cx) => this.performRefreshIndex(name, cx)))
            : null)
          .child(this.canWriteIndices()
            ? (isClosed
                ? new Button("es-open-index").ghost().label("打开索引").on_click((_e, cx) => cx.spawn(async (cx) => this.performOpenIndex(name, cx)))
                : new Button("es-close-index").ghost().label("关闭索引").on_click((_e, cx) => cx.spawn(async (cx) => this.performCloseIndex(name, cx))))
            : null)
          .child(this.canWriteIndices()
            ? new Button("es-delete-index").danger().label("删除索引").on_click((_e, cx) => cx.spawn(async (cx) => this.performDeleteIndex(name, cx)))
            : null),
      )
      .child(this.renderDetailSubTabs())
      .child(this.renderDetailContent(name));
  }

  renderDetailSubTabs() {
    const tabs = [
      { id: DETAIL_OVERVIEW, label: "概览" },
      { id: DETAIL_MAPPING, label: "映射" },
      { id: DETAIL_SETTINGS, label: "设置" },
      { id: DETAIL_ALIASES, label: "别名" },
      { id: DETAIL_STATS, label: "统计" },
      { id: DETAIL_SHARDS, label: "分片" },
    ];
    const items = h_flex().gap(4).border_b(1).border_color("border");
    for (const t of tabs) {
      const active = this.detailTab === t.id;
      const btn = active ? new Button(`es-detail-tab-${t.id}`).label(t.label) : new Button(`es-detail-tab-${t.id}`).ghost().label(t.label);
      items.child(btn.on_click((_e, cx) => { this.detailTab = t.id; cx.notify(); }));
    }
    return items;
  }

  renderDetailContent(name) {
    if (this.indexDetailLoading) {
      return v_flex().flex_1().items_center().justify_center().child(new Spinner().size("medium"));
    }
    switch (this.detailTab) {
      case DETAIL_MAPPING: return this.renderJsonBlock(this.indexDetail.mapping, "无映射");
      case DETAIL_SETTINGS: return this.renderJsonBlock(this.indexDetail.settings, "无设置");
      case DETAIL_ALIASES: return this.renderAliasesBlock(name);
      case DETAIL_STATS: return this.renderJsonBlock(this.indexDetail.stats, "无统计数据");
      case DETAIL_SHARDS: return this.renderShardsTable();
      default: return this.renderIndexOverviewPane(name);
    }
  }

  renderIndexOverviewPane(name) {
    const info = this.indexDetail.info?.[name] || {};
    const idx = this.indices.find((i) => i.name === name) || {};
    return v_flex().gap(12).flex_1().min_h_0()
      .child(
        h_flex().gap(12)
          .child(this.kpi("状态", idx.status || "—", colorForStatus(idx.status)))
          .child(this.kpi("健康", idx.health || "—", colorForHealth(idx.health)))
          .child(this.kpi("主分片", String(info.settings?.index?.number_of_shards || "—"), "accent"))
          .child(this.kpi("副本", String(info.settings?.index?.number_of_replicas || "—"), "accent"))
          .child(this.kpi("文档", formatNumber(idx.docs), "accent"))
          .child(this.kpi("存储", formatBytes(idx.size_bytes), "accent")),
      )
      .child(
        v_flex().flex_1().min_h_0().p(12).rounded(8).border(1).border_color("border").bg("surface")
          .child(div().text_size(13).font_semibold().pb(8).child(new Text("详情")))
          .child(this.renderJsonBlock(info, "无数据")),
      );
  }

  renderJsonBlock(value, emptyLabel) {
    const text = value ? JSON.stringify(value, null, 2) : (emptyLabel || "无数据");
    const editor = new Editor(EditorState(text, "json")).bordered(true).readonly(true).w_full();
    return v_flex().flex_1().min_h_0().overflow_y_scrollbar().child(editor);
  }

  renderAliasesBlock(name) {
    const aliases = this.indexDetail.aliases?.[name]?.aliases || {};
    const list = Object.entries(aliases).map(([alias, info]) => ({ alias, info }));
    return v_flex().gap(8).flex_1().min_h_0()
      .child(
        h_flex().gap(8).items_center()
          .child(new Button("es-add-alias").primary().label("添加别名").disabled(!this.canWriteAliases()).on_click(() => this.openAddAliasDialog(name)))
          .child(!this.canWriteAliases() ? div().text_size(12).text_color("muted").child(new Text("缺少 alias_write 能力")) : null),
      )
      .child(
        v_flex().flex_1().min_h_0().p(12).rounded(8).border(1).border_color("border").bg("surface")
          .child(list.length === 0
            ? div().text_color("muted").child(new Text("该索引未配置别名"))
            : new DataTable(
                DataTableState(["alias", "filter", "actions"]),
                () => list,
                (row, column) => {
                  if (column === "alias") return div().font_semibold().child(new Text(row.alias));
                  if (column === "filter") return new Text(row.info?.filter ? JSON.stringify(row.info.filter) : "—");
                  if (column === "actions") {
                    return new Button(`es-remove-alias-${row.alias}`).link().label("移除").disabled(!this.canWriteAliases()).on_click((_e, cx) => cx.spawn(async (cx) => this.performRemoveAlias(name, row.alias, cx)));
                  }
                  return new Text("—");
                },
              ).stripe(true).bordered(false)),
      );
  }

  renderShardsTable() {
    const shards = this.indexDetail.shards?.shards || [];
    return v_flex().flex_1().min_h_0().p(12).rounded(8).border(1).border_color("border").bg("surface")
      .child(
        shards.length === 0
          ? div().text_color("muted").child(new Text("没有分片"))
          : new DataTable(
              DataTableState(["shard", "prirep", "state", "docs", "store", "node"]),
              () => shards,
              (row, column) => {
                if (column === "shard") return new Text(String(row.shard ?? "—"));
                if (column === "prirep") return new Text(String(row.prirep ?? "—"));
                if (column === "state") {
                  const color = row.state === "STARTED" ? "green-500" : row.state === "UNASSIGNED" ? "red-500" : "amber-500";
                  return new Badge().color(color).child(String(row.state || "—"));
                }
                if (column === "docs") return new Text(formatNumber(row.docs));
                if (column === "store") return new Text(row.store || "—");
                if (column === "node") return new Text(row.node || row.ip || "—");
                return new Text("—");
              },
            ).stripe(true).bordered(false),
      );
  }

  // ---------- Nodes ----------

  renderNodesTab() {
    const nodes = this.nodes;
    return v_flex()
      .gap(12)
      .flex_1()
      .min_h_0()
      .child(
        h_flex().gap(8).items_center()
          .child(new Button("es-reload-nodes").ghost().label("刷新节点").on_click((_e, cx) => cx.spawn(async (cx) => this.refreshNodes(cx)))),
      )
      .child(
        v_flex().flex_1().min_h_0().p(12).rounded(8).border(1).border_color("border").bg("surface")
          .child(
            nodes.length === 0
              ? div().text_color("muted").child(new Text("正在加载节点..."))
              : new DataTable(
                  DataTableState(["name", "ip", "role", "master", "heap", "ram", "cpu", "load_1m", "disk"]),
                  () => nodes,
                  (row, column) => this.renderNodeCell(row, column),
                ).stripe(true).bordered(false),
          ),
      );
  }

  renderNodeCell(row, column) {
    if (column === "name") return h_flex().gap(6).items_center().child(div().font_semibold().child(new Text(row.name || "—"))).child(row.master === "*" ? new Badge().color("accent").child("master") : null);
    if (column === "ip") return new Text(row.ip || "—");
    if (column === "role") return new Text(row.node_role || "—");
    if (column === "master") return new Text(row.master || "—");
    if (column === "heap") return new Text(row.heap_percent != null ? `${row.heap_percent}%` : "—");
    if (column === "ram") return new Text(row.ram_percent != null ? `${row.ram_percent}%` : "—");
    if (column === "cpu") return new Text(row.cpu != null ? `${row.cpu}%` : "—");
    if (column === "load_1m") return new Text(row.load_1m || "—");
    if (column === "disk") return new Text(row.disk_used_percent != null ? `${row.disk_used_percent}%` : "—");
    return new Text("—");
  }

  // ---------- Search ----------

  renderSearchTab() {
    return h_flex()
      .gap(12)
      .flex_1()
      .min_h_0()
      .child(
        v_flex()
          .w(440)
          .flex_shrink_0()
          .gap(8)
          .p(12)
          .rounded(8)
          .border(1)
          .border_color("border")
          .bg("surface")
          .child(div().text_size(13).font_semibold().child(new Text("查询")))
          .child(
            h_flex().gap(8)
              .child(v_flex().gap(2).flex_1().child(div().text_size(11).text_color("muted").child(new Text("索引（逗号分隔）"))).child(Input.new(this.searchIndices).placeholder("*").w_full()))
              .child(v_flex().gap(2).w(80).child(div().text_size(11).text_color("muted").child(new Text("Size"))).child(Input.new(this.searchSize)))
              .child(v_flex().gap(2).w(80).child(div().text_size(11).text_color("muted").child(new Text("From"))).child(Input.new(this.searchFrom))),
          )
          .child(v_flex().gap(2).child(div().text_size(11).text_color("muted").child(new Text("Sort（field:asc, 逗号分隔）"))).child(Input.new(this.searchSort).w_full()))
          .child(
            v_flex().gap(2).flex_1().min_h_0()
              .child(div().text_size(11).text_color("muted").child(new Text("DSL")))
              .child(new Editor(this.searchEditor).bordered(true).w_full().h_full()),
          )
          .child(
            h_flex().gap(8)
              .child(new Button("es-run-search").primary().label(this.searching ? "执行中..." : "执行").disabled(this.searching).on_click((_e, cx) => cx.spawn(async (cx) => this.runSearch(cx))))
              .child(new Button("es-run-async").ghost().label("异步执行").disabled(this.searching).on_click((_e, cx) => cx.spawn(async (cx) => this.runAsyncSearch(cx))))
              .child(new Button("es-prettify").ghost().label("格式化").on_click((_e, cx) => this.prettifySearch(cx))),
          )
          .child(this.searchError ? new InfoAlert("es-search-error", this.searchError).title("查询错误") : null),
      )
      .child(this.renderSearchResultsPane());
  }

  async runAsyncSearch(cx) {
    if (!this.resource) return;
    const query = this.searchEditor.text();
    let body;
    try { body = JSON.parse(query); }
    catch (error) { this.toast("error", "DSL 解析失败", error.message); return; }
    const indices = parseCsv(this.searchIndices.value());
    const size = parseIntOr(this.searchSize.value(), 20);
    this.searching = true;
    cx.notify();
    let job;
    try {
      const started = await startJob(this.resource, "elasticsearch/search/async", { indices, query: null, body, size });
      job = started.handle;
      while (true) {
        const snapshot = await jobStatus(job);
        if (snapshot.state === "succeeded") break;
        if (snapshot.state !== "running" && snapshot.state !== "queued") {
          throw new Error(snapshot.message || `search ${snapshot.state}`);
        }
        await cx.sleep(120);
      }
      const value = await this.resolve(await jobResult(job));
      this.searchResult = value;
      const total = value?.raw?.hits?.total?.value ?? 0;
      this.recordRecentSearch({ query, indices, size, async: true, total, took: value?.raw?.took });
    } catch (error) {
      this.toast("error", "异步搜索失败", error.message);
    } finally {
      if (job) { try { await cancelJob(job); } catch (_) {} try { await closeJob(job); } catch (_) {} }
      this.searching = false;
      cx.notify();
    }
  }

  prettifySearch(cx) {
    try {
      const parsed = JSON.parse(this.searchEditor.text());
      this.searchEditor.set_text(JSON.stringify(parsed, null, 2));
    } catch (error) {
      this.toast("error", "格式化失败", error.message);
    }
    cx.notify();
  }

  renderSearchResultsPane() {
    const result = this.searchResult;
    if (this.searching && !result) {
      return v_flex().flex_1().items_center().justify_center().gap(8).child(new Spinner().size("medium")).child(div().text_color("muted").child(new Text("执行中...")));
    }
    if (!result) {
      return v_flex().flex_1().items_center().justify_center().child(div().text_color("muted").child(new Text("执行一次查询以查看结果")));
    }
    const hits = result.raw?.hits?.hits || [];
    const total = result.raw?.hits?.total?.value;
    const took = result.raw?.took;
    const aggs = result.raw?.aggregations;
    return v_flex()
      .flex_1()
      .min_h_0()
      .gap(12)
      .child(
        h_flex().gap(8).items_center().flex_wrap()
          .child(new Badge().color("accent").child(`总计 ${formatNumber(total)}`))
          .child(new Badge().color("muted").child(`耗时 ${took ?? "—"} ms`))
          .child(new Badge().color("muted").child(`本次 ${hits.length}`))
          .child(new Badge().color("muted").child(`max_score ${result.raw?.hits?.max_score ?? "—"}`)),
      )
      .child(
        v_flex().flex_1().min_h_0().p(8).rounded(8).border(1).border_color("border").bg("surface")
          .child(this.renderHits(hits)),
      )
      .child(aggs ? this.renderAggregations(aggs) : null);
  }

  renderHits(hits) {
    if (hits.length === 0) return div().text_color("muted").child(new Text("无命中"));
    const renderRange = (range) => {
      const out = [];
      for (let off = 0; off < range.end - range.start; off += 1) {
        const i = range.start + off;
        const hit = hits[i];
        if (!hit) continue;
        const isOpen = this.expandedHitIndex === i;
        const row = v_flex()
          .id(`hit-${i}`)
          .w_full()
          .gap(4)
          .p(8)
          .border_b(1)
          .border_color("border")
          .bg(isOpen ? "muted" : "background")
          .on_click((_e, cx) => { this.expandedHitIndex = isOpen ? -1 : i; cx.notify(); })
          .child(
            h_flex().gap(6).items_center()
              .child(new Badge().color("accent").child(hit._index || "—"))
              .child(div().font_semibold().child(new Text(hit._id || "—")))
              .child(hit._score != null ? new Badge().color("muted").child(`_score ${hit._score}`) : null),
          )
          .child(
            div().text_size(12).text_color("muted").child(new Text(
              hit._source ? JSON.stringify(hit._source).slice(0, 200) : "(no _source)",
            )),
          );
        if (isOpen) {
          const editor = new Editor(EditorState(hit._source ? JSON.stringify(hit._source, null, 2) : "{}", "json")).bordered(true).readonly(true).w_full().h(220);
          row.child(editor);
        }
        out.push(row);
      }
      return out;
    };
    return v_virtual_list(
      "es-hits-list",
      hits.length,
      72,
      (i) => `hit-${i}`,
      renderRange,
    );
  }

  renderAggregations(aggs) {
    const entries = Object.entries(aggs);
    if (entries.length === 0) return null;
    return v_flex().gap(8)
      .child(div().text_size(13).font_semibold().child(new Text("聚合")))
      .child(v_flex().p(8).rounded(8).border(1).border_color("border").bg("surface").child(
        new DataTable(
          DataTableState(["name", "type", "value"]),
          () => entries.map(([name, info]) => ({ name, info })),
          (row, column) => {
            if (column === "name") return div().font_semibold().child(new Text(row.name));
            if (column === "type") return new Text(Object.keys(row.info).filter((k) => k !== "buckets" && k !== "value" && k !== "doc_count").join(",") || "buckets");
            if (column === "value") return new Text(JSON.stringify(row.info).slice(0, 240));
            return new Text("—");
          },
        ).stripe(true).bordered(false),
      ));
  }

  // ---------- Tasks ----------

  renderTasksTab() {
    return v_flex().gap(12).flex_1().min_h_0()
      .child(
        v_flex().flex_1().min_h_0().p(12).rounded(8).border(1).border_color("border").bg("surface")
          .child(this.recentSearches.length === 0
            ? div().text_color("muted").child(new Text("当前会话内还没有执行过查询。"))
            : new DataTable(
                DataTableState(["time", "indices", "size", "took", "total", "query"]),
                () => this.recentSearches,
                (row, column) => {
                  if (column === "time") return new Text(new Date(row.at).toLocaleTimeString());
                  if (column === "indices") return new Text((row.indices || []).join(",") || "*");
                  if (column === "size") return new Text(String(row.size ?? "—"));
                  if (column === "took") return new Text(row.took != null ? `${row.took} ms` : "—");
                  if (column === "total") return new Text(formatNumber(row.total));
                  if (column === "query") return new Text((row.query || "").slice(0, 60));
                  return new Text("—");
                },
              ).stripe(true).bordered(false)),
      );
  }

  // ---------- helpers ----------

  async tryResolve(promiseFactory) {
    try { return await this.resolve(await promiseFactory()); }
    catch (_) { return null; }
  }

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
      try { await closeBlob(result.handle); } catch (_) {}
    }
  }

  // ---------- dialogs ----------

  openCreateIndexDialog() {
    if (typeof window === "undefined" || !window.open_dialog) {
      this.toast("error", "无法打开对话框", "宿主不支持 window.open_dialog");
      return;
    }
    this.createName = InputState.new({ value: "" });
    this.createSettings = EditorState('{\n  "number_of_shards": 1,\n  "number_of_replicas": 0\n}', "json");
    this.createMappings = EditorState('{\n  "properties": {}\n}', "json");
    this.createAliases = EditorState("{}", "json");
    window.open_dialog(() => this.renderCreateIndexDialog(), { escape_dismissable: true });
  }

  renderCreateIndexDialog() {
    const close = () => { if (typeof window !== "undefined" && window.close_dialog) window.close_dialog(); };
    return v_flex()
      .w(560)
      .gap(12)
      .p(16)
      .bg("background")
      .text_color("foreground")
      .child(div().text_size(16).font_semibold().child(new Text("创建索引")))
      .child(v_flex().gap(2).child(div().text_size(11).text_color("muted").child(new Text("名称"))).child(Input.new(this.createName).placeholder("my-index-0001").w_full()))
      .child(v_flex().gap(2).child(div().text_size(11).text_color("muted").child(new Text("设置 (JSON)"))).child(new Editor(this.createSettings).bordered(true).h(120).w_full()))
      .child(v_flex().gap(2).child(div().text_size(11).text_color("muted").child(new Text("映射 (JSON)"))).child(new Editor(this.createMappings).bordered(true).h(120).w_full()))
      .child(v_flex().gap(2).child(div().text_size(11).text_color("muted").child(new Text("别名 (JSON)"))).child(new Editor(this.createAliases).bordered(true).h(80).w_full()))
      .child(
        h_flex().gap(8).justify_end()
          .child(new Button("es-create-cancel").ghost().label("取消").on_click((_e, cx) => { close(); cx.notify(); }))
          .child(new Button("es-create-submit").primary().label("创建").on_click((_e, cx) => this.submitCreateIndex(cx))),
      );
  }

  submitCreateIndex(cx) {
    const name = this.createName.value().trim();
    if (!name) { this.toast("error", "缺少名称", "请输入索引名"); return; }
    let settings, mappings, aliases;
    try { settings = this.createSettings.text().trim() ? JSON.parse(this.createSettings.text()) : null; } catch (e) { this.toast("error", "设置 JSON 解析失败", e.message); return; }
    try { mappings = this.createMappings.text().trim() ? JSON.parse(this.createMappings.text()) : null; } catch (e) { this.toast("error", "映射 JSON 解析失败", e.message); return; }
    try { aliases = this.createAliases.text().trim() ? JSON.parse(this.createAliases.text()) : null; } catch (e) { this.toast("error", "别名 JSON 解析失败", e.message); return; }
    const payload = { name };
    if (settings) payload.settings = settings;
    if (mappings) payload.mappings = mappings;
    if (aliases) payload.aliases = aliases;
    if (typeof window !== "undefined" && window.close_dialog) window.close_dialog();
    cx.spawn(async (cx) => this.performCreateIndex(payload, cx));
  }

  openAddAliasDialog(index) {
    if (typeof window === "undefined" || !window.open_dialog) {
      this.toast("error", "无法打开对话框", "宿主不支持 window.open_dialog");
      return;
    }
    this.aliasName = InputState.new({ value: "" });
    this.aliasFilter = EditorState("{}", "json");
    window.open_dialog(() => this.renderAddAliasDialog(index), { escape_dismissable: true });
  }

  renderAddAliasDialog(index) {
    const close = () => { if (typeof window !== "undefined" && window.close_dialog) window.close_dialog(); };
    return v_flex()
      .w(440)
      .gap(12)
      .p(16)
      .bg("background")
      .text_color("foreground")
      .child(div().text_size(16).font_semibold().child(new Text(`为 ${index} 添加别名`)))
      .child(v_flex().gap(2).child(div().text_size(11).text_color("muted").child(new Text("别名"))).child(Input.new(this.aliasName).placeholder("my-alias").w_full()))
      .child(v_flex().gap(2).child(div().text_size(11).text_color("muted").child(new Text("过滤条件 (JSON, 可选)"))).child(new Editor(this.aliasFilter).bordered(true).h(120).w_full()))
      .child(
        h_flex().gap(8).justify_end()
          .child(new Button("es-alias-cancel").ghost().label("取消").on_click((_e, cx) => { close(); cx.notify(); }))
          .child(new Button("es-alias-submit").primary().label("添加").on_click((_e, cx) => this.submitAddAlias(index, cx))),
      );
  }

  submitAddAlias(index, cx) {
    const alias = this.aliasName.value().trim();
    if (!alias) { this.toast("error", "缺少别名", "请输入别名"); return; }
    let filter = null;
    try { filter = this.aliasFilter.text().trim() ? JSON.parse(this.aliasFilter.text()) : null; } catch (e) { this.toast("error", "过滤条件 JSON 解析失败", e.message); return; }
    if (typeof window !== "undefined" && window.close_dialog) window.close_dialog();
    cx.spawn(async (cx) => this.performAddAlias(index, alias, filter, cx));
  }
}

// -------- pure helpers --------

function formatBytes(value) {
  if (value == null) return "—";
  const n = Number(value);
  if (!isFinite(n) || n < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatNumber(value) {
  if (value == null) return "—";
  const n = Number(value);
  if (!isFinite(n)) return "—";
  return n.toLocaleString();
}

function parseCsv(value) {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

function parseIntOr(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}
