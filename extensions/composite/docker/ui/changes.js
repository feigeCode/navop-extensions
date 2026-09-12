// Docker 容器文件系统变更页(workbench 嵌入 shell 视图)。
//
// 数据源:命名操作 containerDiff(docker/container/diff),依托当前路由 id。
// 变更类型:A=新增 C=修改 D=删除(官方 Docker API 语义),用徽章着色区分。

import { View, div } from "gpui";
import { h_flex, v_flex } from "gpui-base";
import { Badge, Button, Spinner } from "gpui-component";
import { current, dispatch } from "navop.workbench";

const KIND_LABELS = {
  A: { label: "Added", color: "green" },
  C: { label: "Changed", color: "accent" },
  D: { label: "Deleted", color: "danger" },
};

function kindBadge(kind) {
  const meta = KIND_LABELS[kind] || { label: kind || "-", color: "muted" };
  return new Badge().color(meta.color).child(meta.label);
}

export default class DockerChanges extends View {
  init(_props, cx) {
    this.context = current();
    this.changes = [];
    this.error = null;
    this.loading = true;
    cx.spawn(async (cx) => this.load(cx));
  }

  async load(cx) {
    this.loading = true;
    cx.notify();
    try {
      const result = await dispatch("containerDiff");
      this.changes = (result && result.changes) || [];
      this.error = null;
    } catch (error) {
      this.error = error.message;
    }
    this.loading = false;
    cx.notify();
  }

  render() {
    if (this.loading && this.changes.length === 0) {
      return v_flex().size_full().items_center().justify_center().gap(8)
        .child(new Spinner().size("medium"))
        .child(div().text_color("muted").child("Loading filesystem changes…"));
    }
    if (this.error) {
      return v_flex().size_full().p(16).gap(8)
        .child(div().text_color("destructive").child(`Failed: ${this.error}`))
        .child(new Button("docker-diff-retry").label("Retry").on_click((_e, cx) => cx.spawn(async (cx) => this.load(cx))));
    }
    const changes = this.changes;
    const counts = changes.reduce((acc, change) => {
      acc[change.kind] = (acc[change.kind] || 0) + 1;
      return acc;
    }, {});
    return v_flex().size_full().min_h_0().p(12).gap(8)
      .child(h_flex().items_center().justify_between().gap(8)
        .child(h_flex().gap(6).items_center()
          .child(div().font_semibold().child(`${changes.length} changes`))
          .children(["A", "C", "D"].filter((kind) => counts[kind])
            .map((kind) => kindBadge(kind).child(`${KIND_LABELS[kind].label} ${counts[kind]}`))))
        .child(new Button("docker-diff-refresh").ghost().label("Refresh").on_click((_e, cx) => cx.spawn(async (cx) => this.load(cx)))))
      .child(div().flex_1().min_h_0().overflow_y_scrollbar()
        .child(v_flex().gap(1).children(changes.map((change) =>
          h_flex().gap(8).items_center().p(4)
            .child(kindBadge(change.kind))
            .child(div().flex_1().min_w_0().font_family("monospace").text_size(12)
              .child(change.path || "-")),
        ))));
  }
}
