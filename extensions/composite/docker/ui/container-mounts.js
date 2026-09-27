// Docker container mounts page (embedded shell view).
//
// Source: `containerMounts` (docker/container/mounts), which returns the
// `Mounts` array taken from the container inspect document.

import { View, div } from "gpui";
import { h_flex, v_flex } from "gpui-base";
import { Button, DataTable, DataTableState } from "gpui-component";
import { current, dispatch } from "navop.workbench";
import { errorMessage, errorView, loadingView, pick, text } from "./shared.js";

const TITLES = ["Type", "Source", "Destination", "Mode", "Access"];

export default class DockerContainerMounts extends View {
  init(_props, cx) {
    this.context = current();
    this.rows = [];
    this.error = null;
    this.loading = true;
    cx.spawn(async (cx) => this.load(cx));
  }

  async load(cx) {
    this.loading = true;
    cx.notify();
    try {
      const result = await dispatch("containerMounts");
      const mounts = (result && result.mounts) || [];
      this.rows = mounts.map((mount) => [
        text(pick(mount, "Type")),
        text(pick(mount, "Source")),
        text(pick(mount, "Destination")),
        text(pick(mount, "Mode"), ""),
        pick(mount, "RW") === false ? "read-only" : "read-write",
      ]);
      this.error = null;
    } catch (error) {
      this.error = errorMessage(error);
    }
    this.loading = false;
    cx.notify();
  }

  render(cx) {
    if (this.loading && this.rows.length === 0 && !this.error) return loadingView(cx, "Loading mounts…");
    if (this.error) {
      return errorView(cx, "docker-mounts-retry", `Failed to read mounts: ${this.error}`,
        (cx) => this.load(cx));
    }
    const tableState = DataTableState(TITLES);

    return v_flex().size_full().min_h_0().min_w_0().p(12).gap(8)
      .child(h_flex().items_center().justify_between()
        .child(div().font_semibold()
          .child(this.rows.length === 1 ? "1 mount" : `${this.rows.length} mounts`))
        .child(new Button("docker-mounts-refresh").ghost().label("Refresh")
          .on_click((_e, cx) => cx.spawn(async (cx) => this.load(cx)))))
      .children(this.rows.length === 0
        ? [div().text_color(cx.theme().colors.muted_foreground).text_size(12)
          .child("This container has no bind mounts or volumes.")]
        : [])
      .children(this.rows.length > 0
        ? [div().flex_1().min_h_0().child(
          new DataTable(tableState, () => this.rows, (row, column) =>
            div().whitespace_nowrap().child(String(row[column] ?? "")),
          ).stripe(true).bordered(true),
        )]
        : []);
  }
}
