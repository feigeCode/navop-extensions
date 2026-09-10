// Workbench page renderer — Overview tab of the Elasticsearch console.
import { ConsoleView } from "../base.js";

export default class ElasticsearchOverviewView extends ConsoleView {
  brand() {
    return {
      title: "Elasticsearch · 概览",
      subtitle: this.context?.connection?.name || "",
    };
  }

  defaultTab() {
    return "overview";
  }
}
