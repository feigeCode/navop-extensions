// Elasticsearch —— 单个索引的 Mapping 字段浏览器(只读)。
//
// 数据来源只有一条:命名操作 `indexMapping`(route.name 是唯一的索引范围来源),
// 走 `navop.workbench.dispatch`。页面自己**不** import 任何 raw 模块,
// 也不自己 open resource —— 嵌入页只借用会话(见 docs 的 shell 页契约)。
//
// 语言/形状上的几个硬约束(踩过就有整页失败的):
// - 颜色只从 `cx.theme().colors.*` 取,且只用 ColorTokens 的 18 个名字;
//   写 `text_color("muted")` 这类 token 名会让整页渲染失败。
// - `new Select(...)` 自带整行宽度,必须包在定宽容器里,否则同行的输入框塌成 0 宽。
// - 定宽窗格里的 `whitespace_nowrap()` 文本要配 `text_ellipsis*`,不然会画到隔壁。
// - `.child()` 不收 null/undefined,可选子元素一律走 `.children(cond ? [x] : [])`。
import { View, div } from "gpui";
import { h_flex, v_flex, InputState } from "gpui-base";
import { Button, Input, Select, Tag } from "gpui-component";
import { current, dispatch } from "navop.workbench";
import {
  classifyMappingError,
  buildMappingModel,
  fieldDefinitionText,
  fieldQuerySnippet,
  fieldSourceLabel,
  fieldSummary,
  mappingErrorText,
  matchFields,
  visibleFieldIds,
} from "./mapping-model.js";

/** 一次渲染最多画多少行。超出的部分**明说**没画,不假装已加载完。 */
const RENDER_LIMIT = 400;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function nowLabel() {
  const date = new Date();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function routeName() {
  try {
    const context = current();
    const name = context && context.route ? context.route.name : null;
    return typeof name === "string" && name ? name : null;
  } catch {
    return null;
  }
}

function paramText(value) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export default class ElasticsearchIndexMapping extends View {
  init(_props, cx) {
    // 索引名在挂载时就固定了:它是这个页面的路由身份,不是可变状态。
    // 没有它就不请求 —— 全局 `_all` mapping 不在这个页面的语义里。
    this.index = routeName();
    this.response = null;
    this.model = null;
    this.loading = true;
    this.refreshing = false;
    this.error = null;
    this.errorKind = null;
    this.updatedAt = null;
    this.notice = null;
    this.mode = "fields";
    this.selectedId = null;
    this.type = "";
    // 折叠态与搜索态分开保存:搜索清空后要回到搜索前的展开状态,所以搜索
    // 期间不能改这个集合。
    this.collapsed = new Set();
    this.search = InputState.new({ value: "", placeholder: "按字段路径筛选,如 user.name" });
    this.search.on("change", (_event, cx) => cx.notify());
    this.search.on("submit", (_event, cx) => cx.notify());
    cx.spawn(async (cx) => this.load(cx, false));
  }

  async load(cx, isRefresh) {
    if (!this.index) {
      this.loading = false;
      this.error = "该页面需要一个具体索引（route.name），当前路由没有携带。";
      this.errorKind = "unknown";
      cx.notify();
      return;
    }
    if (isRefresh) {
      this.refreshing = true;
    } else {
      this.loading = true;
    }
    this.notice = null;
    cx.notify();
    try {
      const response = await dispatch("indexMapping");
      this.response = response;
      this.model = buildMappingModel(response, { index: this.index });
      this.error = null;
      this.errorKind = null;
      this.updatedAt = nowLabel();
      // 选中项可能已经不存在(Mapping 变更过);失效就清掉,不留一个指向
      // 不存在字段的详情面板。
      if (this.selectedId && !this.model.byId.has(this.selectedId)) {
        this.selectedId = null;
      }
    } catch (error) {
      this.error = errorMessage(error);
      this.errorKind = classifyMappingError(this.error);
      // 刷新失败保留旧快照(设计要求:不把全页清空)。
    }
    this.loading = false;
    this.refreshing = false;
    cx.notify();
  }

  currentField() {
    if (!this.model || !this.selectedId) return null;
    return this.model.byId.get(this.selectedId) || null;
  }

  copy(cx, label, text) {
    try {
      cx.write_to_clipboard(String(text));
      this.notice = `已复制${label}`;
    } catch (error) {
      this.notice = `复制失败: ${errorMessage(error)}`;
    }
    cx.notify();
  }

  /** 当前筛选下的「可见行 + 命中数」。搜索时忽略折叠,清空后折叠态原样回来。 */
  visibleRows() {
    if (!this.model) return { rows: [], matched: 0, searching: false, total: 0 };
    const query = this.search.value();
    const searching = Boolean(String(query).trim() || this.type);
    if (searching) {
      const { matched, count } = matchFields(this.model, { query, type: this.type });
      const visible = visibleFieldIds(this.model, matched);
      return {
        rows: this.model.fields.filter((field) => visible.has(field.id)),
        matched: count,
        searching: true,
        total: this.model.fields.length,
      };
    }
    const rows = [];
    let skipDeeperThan = -1;
    for (const field of this.model.fields) {
      if (field.depth <= skipDeeperThan) skipDeeperThan = -1;
      if (skipDeeperThan >= 0) continue;
      rows.push(field);
      if (field.hasChildren && this.collapsed.has(field.id)) skipDeeperThan = field.depth;
    }
    return { rows, matched: rows.length, searching: false, total: this.model.fields.length };
  }

  toggle(field, cx) {
    if (this.collapsed.has(field.id)) {
      this.collapsed.delete(field.id);
    } else {
      this.collapsed.add(field.id);
    }
    cx.notify();
  }

  modeButton(cx, id, mode, label) {
    const active = this.mode === mode;
    const button = new Button(id).size("small").flex_shrink_0().label(label);
    return (active ? button.primary() : button.ghost()).on_click((_event, cx) => {
      this.mode = mode;
      cx.notify();
    });
  }

  toolbar(cx) {
    const types = this.model ? this.model.types : [];
    const options = [{ id: "", label: "全部类型" }].concat(
      types.map((type) => ({ id: type, label: type })),
    );
    const activeType = types.indexOf(this.type) >= 0 ? this.type : "";
    return h_flex()
      .items_center()
      .gap(6)
      .px(10)
      .py(6)
      .border_b_1()
      .min_w_0()
      .child(
        div()
          .flex_1()
          .min_w_0()
          .child(new Input(this.search)),
      )
      .child(
        div()
          .w(180)
          .flex_shrink_0()
          .child(
            new Select(
              "es-mapping-type",
              () => options,
              (row) => div().child(row.label),
              (value, cx) => {
                this.type = String(value);
                cx.notify();
              },
            )
              .placeholder(activeType || "全部类型")
              .menu_width(200),
          ),
      )
      .child(this.modeButton(cx, "es-mapping-mode-fields", "fields", "字段"))
      .child(this.modeButton(cx, "es-mapping-mode-raw", "raw", "原始 JSON"))
      .children(
        this.updatedAt
          ? [
              div()
                .flex_shrink_0()
                .text_size(11)
                .text_color(cx.theme().colors.muted_foreground)
                .whitespace_nowrap()
                .child(this.refreshing ? "刷新中…" : `已更新 ${this.updatedAt}`),
            ]
          : [],
      )
      .child(
        new Button("es-mapping-refresh")
          .ghost()
          .size("small")
          .flex_shrink_0()
          .label("刷新")
          .disabled(this.refreshing || this.loading)
          .on_click((_event, cx) => cx.spawn(async (cx) => this.load(cx, true))),
      );
  }

  noticeBar(cx) {
    const lines = [];
    if (this.notice) {
      lines.push(
        div()
          .px(10)
          .py(4)
          .text_size(12)
          .text_color(cx.theme().colors.muted_foreground)
          .child(this.notice),
      );
    }
    if (this.error && this.model) {
      // 刷新失败不清空旧快照,但必须说清"现在看到的是旧的"。
      lines.push(
        div()
          .px(10)
          .py(4)
          .text_size(12)
          .text_color(cx.theme().colors.destructive)
          .child(
            `刷新失败，下面仍是 ${this.updatedAt || "上一次"} 的快照：${mappingErrorText(
              this.errorKind,
              this.error,
              this.index,
            )}`,
          ),
      );
    }
    if (this.model && this.model.truncated) {
      lines.push(
        div()
          .px(10)
          .py(4)
          .text_size(12)
          .text_color(cx.theme().colors.destructive)
          .child(
            `字段过多，未完整解析：已解析 ${this.model.counts.fields} 个节点，跳过 ${this.model.counts.skipped} 个（深度或数量超出解析预算）。`,
          ),
      );
    }
    if (this.model && !this.model.hasProperties) {
      lines.push(
        div()
          .px(10)
          .py(4)
          .text_size(12)
          .text_color(cx.theme().colors.muted_foreground)
          .child(
            "该索引没有显式字段定义（properties）。运行时字段、动态模板与原始 JSON 仍可查看。",
          ),
      );
    }
    return lines;
  }

  fieldRow(cx, field) {
    const selected = this.selectedId === field.id;
    const collapsed = this.collapsed.has(field.id);
    const glyph = field.hasChildren ? (collapsed ? "▸" : "▾") : "";
    const suffix =
      field.sourceKind === "property" ? "" : ` · ${fieldSourceLabel(field)}`;
    return h_flex()
      .items_center()
      .gap(4)
      .pl(8 + field.depth * 14)
      .pr(8)
      .py(2)
      .rounded(4)
      .cursor_pointer()
      .when(selected, (el) => el.bg(cx.theme().colors.accent))
      .on_click((_event, cx) => {
        // 点击行只改选中,不折叠也不导航(设计要求:点行不丢展开状态)。
        this.selectedId = field.id;
        cx.notify();
      })
      .child(
        div()
          .id(`es-mapping-toggle-${field.id}`)
          .w(14)
          .flex_shrink_0()
          .text_size(10)
          .text_color(cx.theme().colors.muted_foreground)
          .when(field.hasChildren, (el) => el.cursor_pointer())
          .on_click((_event, cx) => this.toggle(field, cx))
          .child(glyph),
      )
      .child(
        div()
          .flex_1()
          .min_w_0()
          .text_ellipsis()
          .font_family("monospace")
          .text_size(12)
          .child(field.name),
      )
      .children(
        field.aliasPath
          ? [
              new Tag()
                .size("xsmall")
                .outline()
                .child("alias"),
            ]
          : [],
      )
      .child(
        div()
          .flex_shrink_0()
          .text_size(11)
          .text_color(cx.theme().colors.muted_foreground)
          .whitespace_nowrap()
          .child(`${field.displayType}${suffix}`),
      );
  }

  fieldList(cx) {
    const { rows, matched, searching, total } = this.visibleRows();
    if (!this.model || this.model.fields.length === 0) {
      return v_flex()
        .flex_1()
        .min_h_0()
        .items_center()
        .justify_center()
        .child(
          div()
            .p(16)
            .text_size(12)
            .text_color(cx.theme().colors.muted_foreground)
            .child(
              this.model && this.model.reason === "multiple-indices"
                ? `服务端返回了多个具体索引（${this.model.candidates.join("、")}），请先选择其中一个。`
                : "没有可展示的字段节点。",
            ),
        );
    }
    const limited = rows.slice(0, RENDER_LIMIT);
    const overLimit = rows.length - limited.length;
    return v_flex()
      .flex_1()
      .min_h_0()
      .min_w_0()
      .child(
        div()
          .flex_1()
          .min_h_0()
          .min_w_0()
          .overflow_y_scrollbar()
          .children(
            limited.length > 0
              ? limited.map((field) => this.fieldRow(cx, field))
              : [
                  div()
                    .p(16)
                    .text_size(12)
                    .text_color(cx.theme().colors.muted_foreground)
                    .child(
                      total > 0
                        ? "没有匹配字段（不等于索引没有字段）。"
                        : "没有可展示的字段节点。",
                    ),
                ],
          ),
      )
      .child(
        h_flex()
          .items_center()
          .gap(6)
          .px(10)
          .py(4)
          .border_t_1()
          .min_w_0()
          .child(
            div()
              .flex_1()
              .min_w_0()
              .text_size(11)
              .text_color(cx.theme().colors.muted_foreground)
              .whitespace_nowrap()
              .text_ellipsis()
              .child(
                searching
                  ? `匹配 ${matched} / 已解析 ${total} 个字段节点`
                  : `已解析 ${total} 个字段节点`,
              ),
          )
          .children(
            overLimit > 0
              ? [
                  div()
                    .flex_shrink_0()
                    .text_size(11)
                    .text_color(cx.theme().colors.destructive)
                    .whitespace_nowrap()
                    .child(`另有 ${overLimit} 行未显示，请折叠或筛选`),
                ]
              : [],
          ),
      );
  }

  rawPane(cx) {
    let text = "";
    try {
      text = this.response ? JSON.stringify(this.response, null, 2) : "";
    } catch (error) {
      text = `无法序列化原始响应: ${errorMessage(error)}`;
    }
    return v_flex()
      .flex_1()
      .min_h_0()
      .min_w_0()
      .gap(6)
      .p(10)
      .child(
        div()
          .text_size(11)
          .text_color(cx.theme().colors.muted_foreground)
          .child(
            "ES 原始响应（只读）。字段树只解释 properties / runtime；dynamic_templates、_source、_meta 属于索引级配置。",
          ),
      )
      .child(
        div()
          .flex_1()
          .min_h_0()
          .min_w_0()
          .overflow_y_scrollbar()
          .border_1()
          .rounded(6)
          .p(8)
          .font_family("monospace")
          .text_size(11)
          .child(text),
      );
  }

  detailPane(cx) {
    const field = this.currentField();
    if (!field) {
      return v_flex()
        .size_full()
        .items_center()
        .justify_center()
        .p(12)
        .child(
          div()
            .text_size(12)
            .text_color(cx.theme().colors.muted_foreground)
            .child("选择一个字段查看定义"),
        );
    }
    const theme = cx.theme();
    return v_flex()
      .size_full()
      .min_h_0()
      .min_w_0()
      .gap(6)
      .p(10)
      .child(
        div()
          .min_w_0()
          .text_ellipsis()
          .font_family("monospace")
          .font_semibold()
          .text_size(13)
          .child(field.fullPath),
      )
      .child(
        div()
          .text_size(11)
          .text_color(theme.colors.muted_foreground)
          .child(fieldSummary(field)),
      )
      .children(
        field.raw.dynamic === undefined
          ? []
          : [
              div()
                .text_size(11)
                .text_color(theme.colors.muted_foreground)
                .child(`dynamic ${paramText(field.raw.dynamic)}`),
            ],
      )
      .child(
        h_flex()
          .items_center()
          .gap(6)
          .flex_wrap()
          .min_w_0()
          .child(
            new Button("es-mapping-copy-path")
              .ghost()
              .size("small")
              .label("复制路径")
              .on_click((_event, cx) => this.copy(cx, "字段路径", field.fullPath)),
          )
          .child(
            new Button("es-mapping-copy-query")
              .ghost()
              .size("small")
              .label("复制查询片段")
              .on_click((_event, cx) =>
                this.copy(cx, "查询片段", fieldQuerySnippet(field)),
              ),
          )
          .child(
            new Button("es-mapping-copy-def")
              .ghost()
              .size("small")
              .label("复制定义")
              .on_click((_event, cx) =>
                this.copy(cx, "字段定义", fieldDefinitionText(field)),
              ),
          ),
      )
      .child(
        div()
          .flex_1()
          .min_h_0()
          .min_w_0()
          .overflow_y_scrollbar()
          .border_1()
          .rounded(6)
          .p(8)
          .font_family("monospace")
          .text_size(11)
          .child(fieldDefinitionText(field)),
      );
  }

  render(cx) {
    if (this.loading && !this.model) {
      return v_flex()
        .size_full()
        .items_center()
        .justify_center()
        .gap(6)
        .child(
          div()
            .text_size(12)
            .text_color(cx.theme().colors.muted_foreground)
            .child(`正在读取 ${this.index || "索引"} 的 Mapping…`),
        );
    }
    if (!this.model && this.error) {
      return v_flex()
        .size_full()
        .p(16)
        .gap(8)
        .child(
          div()
            .text_size(12)
            .text_color(cx.theme().colors.destructive)
            .child(mappingErrorText(this.errorKind, this.error, this.index)),
        )
        .child(
          new Button("es-mapping-retry")
            .label("重试")
            .on_click((_event, cx) => cx.spawn(async (cx) => this.load(cx, false))),
        );
    }
    return v_flex()
      .size_full()
      .min_w_0()
      .min_h_0()
      .child(this.toolbar(cx))
      .children(this.noticeBar(cx))
      .child(
        h_flex()
          .size_full()
          .min_w_0()
          .min_h_0()
          .items_stretch()
          .child(
            v_flex()
              .flex_1()
              .min_w_0()
              .min_h_0()
              .h_full()
              .child(
                this.mode === "raw" ? this.rawPane(cx) : this.fieldList(cx),
              ),
          )
          .child(
            div()
              .w(320)
              .flex_shrink_0()
              .h_full()
              .min_h_0()
              .border_l_1()
              .child(this.detailPane(cx)),
          ),
      );
  }
}
