// Elasticsearch Console — standalone entry (connection's shellViewId).
//
// Thin wrapper around the shared base. Subclass only customises branding and
// the default landing tab; the base owns data loading, capability gating, and
// every page renderer.
import { ConsoleView } from "./base.js";

export default class ElasticsearchConsole extends ConsoleView {
  brand() {
    return {
      title: "Elasticsearch",
      subtitle: this.context?.connection?.name || "",
    };
  }

  defaultTab() {
    return "overview";
  }
}
