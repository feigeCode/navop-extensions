// RocketMQ 工作台 shell 页共用的 UI 片段。
//
// 颜色一律从渲染上下文的主题读取(`cx.theme().colors.*`):shell 只接受
// `#rgb`/`#rrggbb`/`#rrggbbaa` 字面量,`text_color("muted")` 这类 token 名会在
// 渲染时报 "`muted` is not a color value" 并且**整页渲染失败**。因此下面每个
// 片段都把 `cx` 作为显式参数,不要把颜色名留在辅助函数里。
//
// `cx.theme().colors` 是闭集(gpui-base 的 18 个 ColorTokens),组件库自己的
// 主题名(`list_active`/`table_hover`)在这里不存在,写错会解析成 nil。
import { div } from "gpui";
import { h_flex, v_flex } from "gpui-base";
import { Spinner } from "gpui-component";

export {
  QUERY_MODES,
  TIME_PRESETS,
  PAGE_SIZES,
  bodyText,
  buildQuery,
  errorMessage,
  formatMillis,
  messageProperties,
  messageTime,
  parseTimeInput,
  presetById,
  presetWindow,
  previewOf,
  shortId,
} from "./message-model.js";

export function loadingView(cx, text) {
  return v_flex().size_full().items_center().justify_center().gap(8)
    .child(new Spinner().size("medium"))
    .child(div().text_color(cx.theme().colors.muted_foreground).text_size(12).child(text));
}

export function emptyView(cx, text) {
  return v_flex().flex_1().min_h_0().items_center().justify_center().p(16)
    .child(div().text_color(cx.theme().colors.muted_foreground).text_size(12).child(text));
}

/** 指标卡片:概览页顶部一排。 */
export function card(cx, label, value, hint) {
  return v_flex().p(12).gap(4).border_1().rounded(6).min_w(140).flex_1()
    .child(div().text_color(cx.theme().colors.muted_foreground).text_size(12).child(label))
    .child(div().text_size(20).font_semibold().child(String(value ?? "-")))
    .children(hint
      ? [div().text_color(cx.theme().colors.muted_foreground).text_size(11).child(hint)]
      : []);
}

/** 键值行:左侧固定宽度标签,右侧内容可换行。 */
export function kv(cx, label, value) {
  return h_flex().gap(8).items_start().min_w_0()
    .child(div().w(96).flex_shrink_0().text_color(cx.theme().colors.muted_foreground)
      .text_size(12).child(label))
    .child(div().flex_1().min_w_0().text_size(12).child(String(value ?? "-")));
}

export function section(cx, title, children) {
  return v_flex().w_full().gap(6).border_1().rounded(6).p(12)
    .child(div().text_size(13).font_semibold().child(title))
    .children(children);
}
