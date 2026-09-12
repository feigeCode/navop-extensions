// Docker 容器进程页(workbench 嵌入 shell 视图)。
//
// 数据源:命名操作 containerTop(docker/container/top),依托当前路由 id。
// 渲染为真正的表格:首行 titles 作表头,processes 作数据行。

import { View, div } from "gpui";
import { h_flex, v_flex } from "gpui-base";
import { Button, DataTable, DataTableState, Spinner } from "gpui-component";
import { current, dispatch } from "navop.workbench";

export default class DockerProcesses extends View {
  init(_props, cx) {
    this.context = current();
    this.titles = [];
    this.rows = [];
    this.error = null;
    this.loading = true;
    cx.spawn(async (cx) => this.load(cx));
  }

  async load(cx) {
    this.loading = true;
    cx.notify();
    try {
      const result = await dispatch("containerTop");
      this.titles = (result && result.titles) || [];
      this.rows = (result && result.processes) || [];
      this.error = null;
    } catch (error) {
      this.error = error.message;
    }
    this.loading = false;
    cx.notify();
  }

  render() {
    if (this.loading && this.rows.length === 0) {
      return v_flex().size_full().items_center().justify_center().gap(8)
        .child(new Spinner().size("medium"))
        .child(div().text_color("muted").child("Loading processes…"));
    }
    if (this.error) {
      return v_flex().size_full().p(16).gap(8)            
        .child(div().text_color("destructive").child(`Failed: ${this.error}`))
        .child(new Button("docker-ps-retry").label("Retry").on_click((_e, cx) => cx.spawn(async (cx) => this.load(cx))));
    }
    const tableState = DataTableState(this.titles);
    return v_flex().size_full().min_h_0().min_w_0().p(12).gap(8)
      .child(h_flex().items_center().justify_between()
        .child(div().font_semibold().child(`${this.rows.length} processes`))
        .child(new Button("docker-ps-refresh").ghost().label("Refresh").on_click((_e, cx) => cx.spawn(async (cx) => this.load(cx)))))
      .child(div().flex_1().min_h_0().child(
        new DataTable(tableState, () => this.rows, (row, column) =>
          div().whitespace_nowrap().child(String(row[column] ?? "")),
        ).stripe(true).bordered(true),
      ));
  }
}
