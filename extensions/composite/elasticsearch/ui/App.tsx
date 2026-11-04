// Elasticsearch 扩展的 nsh app 外壳：一个插件一个 app，路由表在这里。
//
// 目前只有一个页面（mapping），所以不画左侧路由栏，直接把内容区交给页面；
// 宿主打开连接时会把 contributes.connections[].route 放进 host.params.route，
// 从工具箱之类没有路由的入口启动时 route 为 null，回落到默认路由。
//
// 这个扩展只声明了连接型入口：拿不到 connection（没有资源句柄）时页面无法
// 调 provider，所以外壳先给出空态，不渲染页面、也不发任何 invoke。
import { host, mount, View } from "nsh";
import type { JSX } from "nsh";
import MappingPage from "./pages/mapping/App";
import { Empty } from "./lib/ui";

/** 宿主启动事实（apiVersion 2）里这个 app 关心的部分。 */
type AppStartup = {
  route?: string | null;
  connection?: { resourceHandle?: string } | null;
};

const startup = host.params as unknown as AppStartup;

/** 路由表：route id → 页面。仅一条路由时不需要外壳侧栏。 */
const DEFAULT_ROUTE = "mapping";
const ROUTES: Record<string, () => JSX.Element> = {
  mapping: MappingPage,
};

const resolveRoute = (raw: string | null | undefined): string => {
  const route = raw ?? "";
  return route.length > 0 && Object.prototype.hasOwnProperty.call(ROUTES, route) ? route : DEFAULT_ROUTE;
};

const hasConnection = (): boolean =>
  startup.connection !== null && startup.connection !== undefined;

function ElasticsearchApp(): JSX.Element {
  if (!hasConnection()) {
    return (
      <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <Empty
          title="请先打开一个 Elasticsearch 9 连接"
          hint="索引 mapping 需要通过连接访问集群：从左侧连接列表打开一个 Elasticsearch 连接即可。"
        />
      </View>
    );
  }
  const Page = ROUTES[resolveRoute(startup.route)] as () => JSX.Element;
  return (
    <View style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Page />
    </View>
  );
}

mount(ElasticsearchApp);
