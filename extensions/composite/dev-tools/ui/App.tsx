// 开发者工具扩展的 nsh app 外壳：一个插件一个 app。
//
// 只有一个页面（workbench），所以不画左侧路由栏，内容区直接渲染页面。
// 这个 app 没有声明连接，host.params.connection 恒为 null；页面只用
// host.call 走 navop.dev.* 与 navop.log，不需要资源句柄。
// route 缺省或未知（例如连到旧宿主留下的 viewId）时都回落到 workbench。
import { host, mount, View } from "nsh";
import type { JSX } from "nsh";
import WorkbenchPage from "./pages/workbench/App";

/** 宿主启动事实（apiVersion 2）里这个 app 关心的部分。 */
type AppStartup = {
  route?: string | null;
};

const startup = host.params as unknown as AppStartup;

/** 路由表：route id → 页面。 */
const DEFAULT_ROUTE = "workbench";
const ROUTES: Record<string, () => JSX.Element> = {
  workbench: WorkbenchPage,
};

const resolveRoute = (raw: string | null | undefined): string => {
  const route = raw ?? "";
  return route.length > 0 && Object.prototype.hasOwnProperty.call(ROUTES, route) ? route : DEFAULT_ROUTE;
};

function DevToolsApp(): JSX.Element {
  const Page = ROUTES[resolveRoute(startup.route)] as () => JSX.Element;
  return (
    <View style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Page />
    </View>
  );
}

mount(DevToolsApp);
