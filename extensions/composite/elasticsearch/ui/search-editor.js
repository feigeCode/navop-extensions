import { View, div } from "gpui";
import { v_flex } from "gpui-base";
import { Button, Input, InputState } from "gpui-component";
import { current, dispatch } from "navop.workbench";

export default class ElasticsearchSearchEditor extends View {
  init(_props, cx) {
    this.context = current();
    this.query = InputState.new({ value: "*" });
    this.status = "Ready";
    this.result = null;
  }

  render() {
    return v_flex()
      .size_full()
      .min_w_0()
      .min_h_0()
      .p(16)
      .gap(12)
      .child(div().text_size(18).font_semibold().child("Elasticsearch Search"))
      .child(Input.new(this.query).placeholder("Search text or *"))
      .child(new Button("workbench-search").label("Search").on_click((_event, cx) => {
        cx.spawn(async (cx) => this.search(cx));
      }))
      .child(`Status: ${this.status}`)
      .child(
        div()
          .flex_1()
          .min_h_0()
          .overflow_y_scrollbar()
          .whitespace_pre_wrap()
          .child(this.result ? JSON.stringify(this.result, null, 2) : "No result"),
      );
  }

  async search(cx) {
    const query = this.query.value().trim();
    if (!query) {
      this.status = "Query is required";
      cx.notify();
      return;
    }
    this.status = "Running";
    cx.notify();
    try {
      this.result = await dispatch("search", { query });
      this.status = "Completed";
    } catch (error) {
      this.status = `Failed: ${error.message}`;
    }
    cx.notify();
  }
}
