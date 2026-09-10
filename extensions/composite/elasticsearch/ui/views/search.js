// Workbench page renderer — Search tab of the Elasticsearch console.
import { ConsoleView } from "../base.js";

export default class ElasticsearchSearchView extends ConsoleView {
  brand() {
    return {
      title: "Elasticsearch · 搜索",
      subtitle: this.context?.connection?.name || "",
    };
  }

  defaultTab() {
    return "search";
  }
}
