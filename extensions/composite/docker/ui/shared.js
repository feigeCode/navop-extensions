// Docker workbench shell pages: shared helpers.
//
// Colors must come from the theme (`cx.theme().colors.*`) or a literal
// #rgb/#rrggbb/#rrggbbaa value. A bare token name such as `"muted"` makes the
// shell throw "`muted` is not a color value" and the whole page fails to render.

import { div } from "gpui";
import { h_flex, v_flex } from "gpui-base";
import { Button, Spinner } from "gpui-component";

/**
 * Case-tolerant field lookup.
 *
 * `docker inspect` goes through bollard/Docker API naming (PascalCase: `State`,
 * `Config`), while our own list operations emit snake_case. Pages should not
 * have to care which one they are holding.
 */
export function pick(source, ...names) {
  if (!source || typeof source !== "object") return undefined;
  for (const name of names) {
    const value = source[name];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/** Render any value as display text; nullish and empty become a placeholder. */
export function text(value, fallback) {
  const placeholder = fallback === undefined ? "-" : fallback;
  if (value === undefined || value === null || value === "") return placeholder;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length === 0 ? placeholder : value.join(", ");
  if (typeof value === "object") return placeholder;
  return String(value);
}

/** Strip the host's dispatch prefix so the user sees only the real message. */
export function errorMessage(error) {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return raw.replace(/^navop\.workbench\.dispatch:\s*/, "").trim();
}

export function humanBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} ${units[unit]}` : `${value.toFixed(1)} ${units[unit]}`;
}

/** `2026-09-24T06:22:11.123456789Z` -> `2026-09-24 06:22`; anything else stays as-is. */
export function shortTime(value) {
  if (typeof value !== "string" || value.length < 16 || value.startsWith("0001-")) return "-";
  return `${value.slice(0, 10)} ${value.slice(11, 16)}`.replace("T", " ");
}

export function percent(used, total) {
  const u = Number(used);
  const t = Number(total);
  if (!Number.isFinite(u) || !Number.isFinite(t) || t <= 0) return 0;
  return Math.min(100, Math.max(0, (u / t) * 100));
}

// --- shared primitives -----------------------------------------------------

export function card(cx, label, value, hint) {
  return v_flex().p(12).gap(4).border_1().border_color(cx.theme().colors.border).rounded(6).min_w(160).flex_1()
    .child(div().text_color(cx.theme().colors.muted_foreground).text_size(12).child(label))
    .child(div().text_size(20).font_semibold().child(String(value)))
    .children(hint ? [div().text_color(cx.theme().colors.muted_foreground).text_size(11).child(hint)] : []);
}

/** One label/value row, sized for a description block. */
export function kv(cx, label, value, options) {
  const opts = options || {};
  const body = div().flex_1().min_w_0().text_size(12).child(text(value));
  if (opts.mono) body.font_family("monospace");
  return h_flex().gap(8).items_start()
    .child(div().w(150).flex_shrink_0().text_color(cx.theme().colors.muted_foreground).text_size(12)
      .child(label))
    .child(body);
}

/** Bordered block with a title and a list of rows. */
export function section(cx, title, rows) {
  return v_flex().gap(6).border_1().border_color(cx.theme().colors.border).rounded(6).p(12)
    .child(div().font_semibold().child(title))
    .children(rows);
}

export function loadingView(cx, label) {
  return v_flex().size_full().items_center().justify_center().gap(8)
    .child(new Spinner().size("medium"))
    .child(div().text_color(cx.theme().colors.muted_foreground).child(label));
}

export function errorView(cx, id, message, retry) {
  return v_flex().size_full().p(16).gap(8)
    .child(div().text_color(cx.theme().colors.destructive).child(message))
    .child(new Button(id).label("Retry").on_click((_e, cx) => cx.spawn(async (cx) => retry(cx))));
}

/** Inline status line; `action` adds an optional trailing button. */
export function banner(cx, message, options) {
  const opts = options || {};
  return h_flex().items_center().gap(8).px(10).py(6)
    .border_1().border_color(cx.theme().colors.border).rounded(6).min_w_0()
    .child(div().flex_1().min_w_0().text_size(12).text_ellipsis()
      .text_color(opts.error ? cx.theme().colors.destructive : cx.theme().colors.muted_foreground)
      .child(message))
    .children(opts.action
      ? [new Button(opts.id || "docker-banner-action").ghost().size("small").flex_shrink_0()
        .label(opts.action.label)
        .on_click((_e, cx) => opts.action.on_click(cx))]
      : []);
}

/** Colored pill for a container/image state. */
export function stateColor(cx, state) {
  const value = String(state || "").toLowerCase();
  if (value === "running") return cx.theme().colors.primary;
  if (value === "paused" || value === "restarting" || value === "created") {
    return cx.theme().colors.accent;
  }
  if (value === "exited" || value === "dead" || value === "removing") {
    return cx.theme().colors.destructive;
  }
  return cx.theme().colors.muted_foreground;
}
