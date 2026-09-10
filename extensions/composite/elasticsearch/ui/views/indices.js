// Workbench page renderer — Indices tab of the Elasticsearch console.
import { ConsoleView } from "../base.js";

export default class ElasticsearchIndicesView extends ConsoleView {
  brand() {
    return {
      title: "Elasticsearch · 索引",
      subtitle: this.context?.connection?.name || "",
    };
  }

  defaultTab() {
    return "indices";
  }
}
