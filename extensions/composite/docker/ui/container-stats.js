// Docker container live stats page (embedded shell view).
//
// Source: `containerStats` (docker/container/stats). Each dispatch takes one
// one-shot sample from the daemon (the provider never streams), so the page
// polls every couple of seconds instead of holding a stream open.

import { View, div } from "gpui";
import { h_flex, v_flex } from "gpui-base";
import { Badge, Button } from "gpui-component";
import { current, dispatch } from "navop.workbench";
import { errorMessage, errorView, humanBytes, kv, loadingView, percent, section } from "./shared.js";

const REFRESH_MS = 2000;
const BAR_SEGMENTS = 24;

/** Segmented bar: avoids percentage widths, which the shell does not expose. */
function bar(cx, fraction, color) {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * BAR_SEGMENTS);
  const segments = [];
  for (let index = 0; index < BAR_SEGMENTS; index += 1) {
    segments.push(div().flex_1().h(8).rounded(2)
      .bg(index < filled ? color : cx.theme().colors.secondary));
  }
  return h_flex().w_full().gap(1).children(segments);
}

function levelColor(cx, fraction) {
  if (fraction >= 0.9) return cx.theme().colors.destructive;
  if (fraction >= 0.7) return cx.theme().colors.accent;
  return cx.theme().colors.primary;
}

function gauge(cx, label, value, hint, fraction) {
  return v_flex().flex_1().min_w(220).gap(6).p(12)
    .border_1().border_color(cx.theme().colors.border).rounded(6)
    .child(h_flex().items_center().justify_between()
      .child(div().text_color(cx.theme().colors.muted_foreground).text_size(12).child(label))
      .child(div().text_size(20).font_semibold().child(value)))
    .child(bar(cx, fraction, levelColor(cx, fraction)))
    .child(div().text_color(cx.theme().colors.muted_foreground).text_size(11).child(hint));
}

export default class DockerContainerStats extends View {
  init(_props, cx) {
    this.context = current();
    this.stats = null;
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
      this.stats = await dispatch("containerStats");
      this.error = null;
    } catch (error) {
      this.error = errorMessage(error);
    }
    this.loading = false;
    cx.notify();
  }

  render(cx) {
    if (this.loading && !this.stats && !this.error) return loadingView(cx, "Sampling stats…");
    if (this.error && !this.stats) {
      return errorView(cx, "docker-stats-retry", `Failed to read stats: ${this.error}`,
        (cx) => this.load(cx));
    }
    const stats = this.stats || {};
    const cpuPercent = Number(stats.cpu_percent) || 0;
    const memoryUsed = Number(stats.memory_usage_bytes) || 0;
    const memoryLimit = Number(stats.memory_limit_bytes) || 0;
    const cpus = Number(stats.online_cpus) || 0;
    const cpuFraction = cpus > 0 ? cpuPercent / (100 * cpus) : 0;
    const memoryFraction = percent(memoryUsed, memoryLimit) / 100;

    return v_flex().size_full().min_h_0().min_w_0().overflow_y_scrollbar().p(16).gap(12)
      .child(h_flex().gap(8).items_center().justify_between()
        .child(h_flex().gap(8).items_center()
          .child(div().text_size(16).font_semibold().child("Live stats"))
          .child(new Badge().child(this.auto ? `auto ${REFRESH_MS / 1000}s` : "paused")))
        .child(h_flex().gap(8)
          .child(new Button("docker-stats-toggle").ghost().label(this.auto ? "Pause" : "Resume")
            .on_click((_e, cx) => {
              this.auto = !this.auto;
              cx.notify();
            }))
          .child(new Button("docker-stats-refresh").ghost().label("Refresh")
            .on_click((_e, cx) => cx.spawn(async (cx) => this.load(cx))))))

      .children(this.error
        ? [div().text_color(cx.theme().colors.destructive).text_size(12)
          .child(`Last refresh failed: ${this.error}`)]
        : [])

      .child(h_flex().gap(8).flex_wrap()
        .child(gauge(cx, "CPU", `${cpuPercent.toFixed(2)}%`,
          cpus > 0 ? `${cpus} online CPUs · ${(100 * cpus).toFixed(0)}% is fully saturated` : "online CPU count unavailable",
          cpuFraction))
        .child(gauge(cx, "Memory", humanBytes(memoryUsed),
          memoryLimit > 0 ? `${percent(memoryUsed, memoryLimit).toFixed(1)}% of ${humanBytes(memoryLimit)}` : "no memory limit",
          memoryFraction)))

      .child(section(cx, "Details", [
        kv(cx, "CPU percent", `${cpuPercent.toFixed(3)}%`),
        kv(cx, "Memory usage", humanBytes(memoryUsed)),
        kv(cx, "Memory limit", memoryLimit > 0 ? humanBytes(memoryLimit) : "unlimited"),
        kv(cx, "Online CPUs", cpus > 0 ? cpus : "-"),
        kv(cx, "Container ID", stats.id, { mono: true }),
      ]));
  }
}
