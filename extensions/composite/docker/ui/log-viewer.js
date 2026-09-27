// Docker container log viewer (embedded shell view).
//
// Source: `containerLogsWithTail` (docker/container/logs, `tail` param). Follow
// mode re-dispatches on a timer rather than holding a stream open — the
// provider only ever returns one batch per call.

import { View, div } from "gpui";
import { h_flex, v_flex, InputState } from "gpui-base";
import { Badge, Button, Input } from "gpui-component";
import { current, dispatch } from "navop.workbench";
import { errorMessage } from "./shared.js";

const FOLLOW_MS = 2000;
const MAX_RENDER_LINES = 1000;

export default class DockerLogViewer extends View {
  init(_props, cx) {
    this.context = current();
    this.tail = InputState.new({ value: "500", placeholder: "Tail lines" });
    this.filter = InputState.new({ value: "", placeholder: "Filter lines" });
    this.logs = "";
    this.error = null;
    this.pending = false;
    this.follow = false;
    this.loadedAt = "";
    cx.spawn(async (cx) => this.load(cx));
    this.timer = cx.timer.every(FOLLOW_MS, (cx) => {
      if (this.follow && !this.pending) return this.load(cx);
    });
  }

  containerId() {
    const route = this.context && this.context.route;
    return (route && route.id) || "";
  }

  tailValue() {
    const parsed = parseInt(this.tail.value(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : "500";
  }

  async load(cx) {
    const id = this.containerId();
    if (!id) {
      this.error = "Container id is missing";
      cx.notify();
      return;
    }
    this.pending = true;
    cx.notify();
    try {
      const result = await dispatch("containerLogsWithTail", { tail: this.tailValue() });
      this.logs = (result && result.logs) || "";
      this.error = null;
      this.loadedAt = new Date().toTimeString().slice(0, 8);
    } catch (error) {
      this.error = errorMessage(error);
    }
    this.pending = false;
    cx.notify();
  }

  visibleLines() {
    const needle = this.filter.value().trim().toLowerCase();
    const all = this.logs.split("\n");
    const numbered = all.map((line, index) => ({ index, line }));
    const matched = needle
      ? numbered.filter((entry) => entry.line.toLowerCase().includes(needle))
      : numbered;
    const lines = matched.length > MAX_RENDER_LINES ? matched.slice(-MAX_RENDER_LINES) : matched;
    return { matched: matched.length, total: all.length, lines, hidden: matched.length - lines.length };
  }

  render(cx) {
    const id = this.containerId();
    const needle = this.filter.value().trim();
    const { matched, total, lines, hidden } = this.visibleLines();
    const summary = needle
      ? `${matched} of ${total} lines match`
      : `${total} lines loaded`;

    return v_flex().size_full().min_h_0().min_w_0().p(12).gap(8)
      .child(h_flex().gap(8).items_center().justify_between()
        .child(h_flex().gap(8).items_center().min_w_0()
          .child(div().font_semibold().text_ellipsis().child(id ? `Logs — ${id}` : "Logs"))
          .children(this.follow ? [new Badge().child("following")] : []))
        .child(h_flex().gap(8)
          .child(new Button("docker-logs-follow").ghost().label(this.follow ? "Stop follow" : "Follow")
            .on_click((_e, cx) => {
              this.follow = !this.follow;
              if (this.follow) cx.spawn(async (cx) => this.load(cx));
              cx.notify();
            }))
          .child(new Button("docker-logs-load").label(this.pending ? "Loading…" : "Reload")
            .on_click((_e, cx) => cx.spawn(async (cx) => this.load(cx))))))

      .child(h_flex().gap(8).items_center()
        .child(div().w(130).flex_shrink_0().child(new Input(this.tail)))
        .child(div().w(260).flex_shrink_0().child(new Input(this.filter))))

      .child(h_flex().gap(8).items_center().text_size(12)
        .child(div().text_color(cx.theme().colors.muted_foreground).child(summary))
        .children(hidden > 0
          ? [div().text_color(cx.theme().colors.muted_foreground)
            .child(`· showing last ${lines.length}, ${hidden} older hidden`)]
          : [])
        .children(this.loadedAt
          ? [div().text_color(cx.theme().colors.muted_foreground).child(`· updated ${this.loadedAt}`)]
          : []))

      .children(this.error
        ? [div().text_color(cx.theme().colors.destructive).text_size(12).child(this.error)]
        : [])

      .child(div().flex_1().min_h_0().overflow_y_scrollbar()
        .children(lines.length > 0
          ? [v_flex().gap(1).children(lines.map((entry) =>
            h_flex().gap(8).items_start()
              .child(div().w(50).flex_shrink_0().text_size(11).font_family("monospace")
                .text_color(cx.theme().colors.muted_foreground).child(String(entry.index + 1)))
              .child(div().flex_1().min_w_0().text_size(11).font_family("monospace")
                .child(entry.line.length > 0 ? entry.line : " "))))]
          : [div().p(16).text_color(cx.theme().colors.muted_foreground)
            .child(this.logs.length > 0 ? "No lines match the filter." : "No logs.")]));
  }
}
