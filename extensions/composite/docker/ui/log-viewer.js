import { View, div } from "gpui";
import { v_flex, h_flex, Input, InputState } from "gpui-base";
import { Button } from "gpui-component";
import { current, dispatch } from "navop.workbench";

export default class DockerLogViewer extends View {
  init(_props, cx) {
    this.context = current();
    this.tail = InputState.new({ placeholder: "Tail lines", value: "500" });
    this.logs = "";
    this.status = "Ready";
    this.pending = false;
  }

  containerId() {
    const route = this.context && this.context.route;
    return (route && route.id) || "";
  }

  render() {
    const id = this.containerId();
    return v_flex()
      .size_full()
      .min_w_0()
      .min_h_0()
      .p(16)
      .gap(12)
      .child(
        div()
          .text_size(18)
          .font_semibold()
          .child(id ? `Container Logs — ${id}` : "Container Logs"),
      )
      .child(
        h_flex()
          .gap(8)
          .child(Input.new(this.tail))
          .child(
            new Button("docker-logs-load")
              .label(this.pending ? "Loading..." : "Load")
              .on_click((_event, cx) => {
                cx.spawn(async (cx) => this.load(cx));
              }),
          ),
      )
      .child(`Status: ${this.status}`)
      .child(
        div()
          .flex_1()
          .min_h_0()
          .overflow_y_scrollbar()
          .whitespace_pre_wrap()
          .child(this.logs || "No logs"),
      );
  }

  async load(cx) {
    const id = this.containerId();
    if (!id) {
      this.status = "Container id is missing";
      cx.notify();
      return;
    }
    const parsed = parseInt(this.tail.value(), 10);
    const tail = Number.isFinite(parsed) && parsed > 0 ? String(parsed) : "500";
    this.pending = true;
    this.status = "Loading";
    cx.notify();
    try {
      const result = await dispatch("containerLogsWithTail", { tail });
      this.logs = (result && result.logs) || "";
      this.status = `Loaded (tail ${tail})`;
    } catch (error) {
      this.status = `Failed: ${error.message}`;
    }
    this.pending = false;
    cx.notify();
  }
}
