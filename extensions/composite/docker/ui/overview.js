// Docker 引擎概览页(workbench 嵌入 shell 视图)。
//
// 数据源:systemUsage(docker/system/usage)一次性汇总运行中的容器指标。
// 顶部为状态条,中部为指标卡,底部为磁盘占用与运行中容器预热条。

import { View, div } from "gpui";
import { h_flex, v_flex } from "gpui-base";
import { Badge, Button, Progress, Spinner } from "gpui-component";
import { current, dispatch } from "navop.workbench";

function human(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return unit === 0 ? `${value} ${units[unit]}` : `${value.toFixed(1)} ${units[unit]}`;
}

export default class DockerOverview extends View {
  init(_props, cx) {
    this.context = current();
    this.usage = null;
    this.error = null;
    this.loading = true;
    cx.spawn(async (cx) => this.load(cx));
  }

  async load(cx) {
    this.loading = true;
    cx.notify();
    try {
      const result = await dispatch("systemUsage");
      this.usage = result || {};
      this.error = null;
    } catch (error) {
      this.error = error.message;
    }
    this.loading = false;
    cx.notify();
  }

  card(label, value, hint) {
    return v_flex().p(12).gap(4).border_r_1().rounded(6).min_w(180).flex_1()
      .child(div().text_color("muted").text_size(12).child(label))
      .child(div().text_size(20).font_semibold().child(value))
      .children(hint ? [div().text_color("muted").text_size(11).child(hint)] : []);
  }

  meter(label, used, total) {
    const percent = total > 0 ? Math.min(100, (used / total) * 100) : 0;
    return v_flex().gap(4)
      .child(h_flex().justify_between().items_center()
        .child(div().child(label))
        .child(div().text_color("muted").text_size(12).child(`${human(used)} / ${human(total)}`)))
      .child(new Progress().value(percent));
  }

  render() {
    if (this.loading && !this.usage) {
      return v_flex().size_full().items_center().justify_center().gap(8)
        .child(new Spinner().size("medium"))
        .child(div().text_color("muted").child("正在统计引擎使用情况…"));
    }
    if (this.error) {
      return v_flex().size_full().p(16).gap(8)
        .child(div().text_color("destructive").child(`加载失败: ${this.error}`))
        .child(new Button("docker-usage-retry").label("重试").on_click((_e, cx) => cx.spawn(async (cx) => this.load(cx))));
    }
    const u = this.usage || {};
    const diskUsed = u.disk_used_bytes ?? 0;
    const diskReclaimable = u.disk_reclaimable_bytes ?? 0;
    const diskTotal = diskUsed + diskReclaimable;
    const memUsed = u.containers_memory_bytes ?? 0;
    return v_flex().size_full().min_h_0().min_w_0().overflow_y_scrollbar().p(16).gap(16)
      .child(h_flex().gap(8).items_center().justify_between()
        .child(h_flex().gap(8).items_center()
          .child(div().text_size(16).font_semibold().child("Docker 引擎"))
          .child(new Badge().child(u.engine ? "运行中" : "不可用"))
          .child(div().text_color("muted").text_size(12).child(`Server ${u.server_version || "?"} · ${u.cpu_count ?? 0} CPUs`)))
        .child(new Button("docker-usage-refresh").ghost().label("刷新")
          .on_click((_e, cx) => cx.spawn(async (cx) => this.load(cx)))))
      .child(h_flex().gap(8).flex_wrap()
        .child(this.card("容器", `${u.containers_running ?? 0} / ${u.containers_total ?? 0}`, "运行中 / 总数"))
        .child(this.card("镜像", String(u.images ?? 0), "本机镜像数"))
        .child(this.card("卷", String(u.volumes ?? 0), "逻辑卷数量"))
        .child(this.card("网络", String(u.networks ?? 0), "网络数量")))
      .child(v_flex().gap(6).border_r_1().rounded(6).p(12)
        .child(div().font_semibold().child("磁盘占用"))
        .child(this.meter("已用", diskUsed, diskTotal || 1))
        .child(h_flex().gap(8)
          .child(div().text_size(12).text_color("muted").child(`可回收 ${human(diskReclaimable)}`))
          .child(new Badge().color("accent").child(`可回收 ${diskTotal > 0 ? Math.round(diskReclaimable / diskTotal * 100) : 0}%`))))
      .child(v_flex().gap(6).border_r_1().rounded(6).p(12)
        .child(div().font_semibold().child("运行中容器资源"))
        .child(h_flex().gap(16).text_size(13)
          .child(div().child(`内存合计: ${human(memUsed)}`))
          .child(div().child(`CPU 占用(估计): ${(u.containers_cpu_percent ?? 0).toFixed(1)}%`))
          .child(div().child(`容器总数(运行中): ${u.containers_running ?? 0} / ${u.containers_total ?? 0}`))));
  }
}
