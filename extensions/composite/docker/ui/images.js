// Docker 镜像页(workbench 嵌入 shell 视图)。
//
// listImages 表格 + 行内 Remove;顶部提供拉取表单:提交 dispatch("pullImageJob")
// 返回 job 快照,脚本轮询 jobCompleted 直至结果可读取后展示摘要。

import { View, div } from "gpui";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import { Badge, Button, DataTable, DataTableState, Spinner } from "gpui-component";
import { close as closeJob, status as jobStatus } from "navop.job";
import { current, dispatch } from "navop.workbench";

export default class DockerImages extends View {
  init(_props, cx) {
    this.context = current();
    this.images = [];
    this.error = null;
    this.loading = true;
    this.image = InputState.new({ value: "", placeholder: "Image (e.g. nginx)" });
    this.tag = InputState.new({ value: "", placeholder: "Tag (optional)" });
    this.pulling = false;
    this.pullStatus = null;
    cx.spawn(async (cx) => this.load(cx));
  }

  async load(cx) {
    this.loading = true;
    cx.notify();
    try {
      const result = await dispatch("listImages");
      this.images = (result && result.images) || [];
      this.error = null;
    } catch (error) {
      this.error = error.message;
    }
    this.loading = false;
    cx.notify();
  }

  async pull(cx) {
    const image = this.image.value().trim();
    if (!image) {
      this.pullStatus = "镜像名称不能为空";
      cx.notify();
      return;
    }
    // 防重复提交
    if (this.pulling) return;
    this.pulling = true;
    this.pullStatus = `正在拉取 ${image}…`;
    cx.notify();
    let handle = null;
    try {
      const started = await dispatch("pullImageJob", { image, tag: this.tag.value().trim() }, { confirmed: true });
      handle = started.handle ?? started.job_id ?? null;
      if (handle) {
        // 轮询直至 job 结束
        while (true) {
          await cx.sleep(400);
          const snap = await jobStatus(handle);
          if (snap.state === "succeeded") break;
          if (snap.state !== "running" && snap.state !== "queued") {
            throw new Error(snap.message || `job ${snap.state}`);
          }
        }
      }
      this.pullStatus = `${image} 拉取完成`;
      await this.load(cx);
    } catch (error) {
      this.pullStatus = `拉取失败: ${error.message}`;
      this.pulling = false;
      if (handle) { try { await closeJob(handle); } catch (_) {} }
      cx.notify();
      return;
    }
    if (handle) { try { await closeJob(handle); } catch (_) {} }
    this.pulling = false;
    cx.notify();
  }

  async remove(name, cx) {
    this.loading = true;
    cx.notify();
    try {
      await dispatch("removeImage", { name }, { confirmed: true });
    } catch (error) {
      this.error = error.message;
    }
    await this.load(cx);
  }

  stateBadge(state) {
    return new Badge().child(state || "-");
  }

  render() {
    const columns = ["name", "id", "created", "size"];
    const tableState = DataTableState(columns);
    return v_flex().size_full().min_w_0().min_h_0().p(12).gap(10)
      .child(h_flex().gap(8).items_center()
        .child(div().text_size(16).font_semibold().child("镜像"))
        .child(new Button("docker-images-refresh").ghost().label("刷新")
          .on_click((_e, cx) => cx.spawn(async (cx) => this.load(cx)))))
      .child(v_flex().gap(6).p(10).border_r_1().rounded(6)
        .child(div().font_semibold().child("拉取镜像"))
        .child(h_flex().gap(6)
          .child(Input.new(this.image))
          .child(Input.new(this.tag))
          .child(new Button("docker-pull").label(this.pulling ? "拉取中…" : "拉取")
            .on_click((_e, cx) => cx.spawn(async (cx) => this.pull(cx)))))
        .children(this.pullStatus ? [div().text_size(12).text_color("muted").child(this.pullStatus)] : []))
      .child(this.loading && this.images.length === 0
        ? v_flex().flex_1().items_center().justify_center().gap(8)
          .child(new Spinner().size("medium"))
          .child(div().text_color("muted").child("正在读取镜像列表…"))
        : this.error
        ? v_flex().p(16).gap(8)
          .child(div().text_color("destructive").child(`加载失败: ${this.error}`))
          .child(new Button("docker-images-retry").label("重试").on_click((_e, cx) => cx.spawn(async (cx) => this.load(cx))))
        : div().flex_1().min_h_0().child(
            new DataTable(tableState, () => this.images, (row, column) => {
              if (column === "size") return div().text_size(12).child(`${row.size_mb ?? 0} MB`);
              if (column === "name") {
                return h_flex().items_center().gap(6)
                  .child(div().flex_1().child(row.name || row.id || "-"))
                  .child(new Button(`docker-image-remove-${row.id}`).ghost().label("删除")
                    .on_click((_e, cx) => cx.spawn(async (cx) => this.remove(row.name, cx))));
              }
              return div().text_size(12).child(String(row[column] ?? "-"));
            }).stripe(true).bordered(true),
          ));
  }
}
