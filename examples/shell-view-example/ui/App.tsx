// Shell View 示例的 app 入口：一个扩展 = 一个 nsh app，app 内用路由组织页面。
//
// 本示例只有一条路由（`tool`），按契约 §6 不画侧栏：入口读一次
// `host.params.route`（连接清单的 `connections[].route`；工具箱打开为 null），
// 未知/缺省值一律回落到 `tool`，然后直接渲染页面组件。
//
// 页面组件不感知外壳：它导出默认组件，初始化只在被渲染时执行。
import { host, mount, View } from "nsh";
import type { JSX } from "nsh";
import { c } from "./lib/theme";
import Tool from "./pages/tool/App";

/** 启动事实：宿主在首帧前写入，app 生命周期内不变（ABI v2）。 */
type StartupParams = {
  route?: string | null;
  extension?: { id?: string; title?: string };
  connection?: { name?: string } | null;
};

const params = host.params as unknown as StartupParams;

type RouteItem = {
  /** 沿用旧版页面的 id：连接清单里的 `route` 直接指向它。 */
  id: string;
  title: string;
  component: () => JSX.Element;
};

/** 路由表：单路由 app，表里的第一条就是唯一首屏。 */
const ROUTES: RouteItem[] = [{ id: "tool", title: "Tool", component: Tool }];

const DEFAULT_ROUTE = "tool";

/** 未知 route 回落默认路由（拼写错误、老 view id 都走这里）。 */
function resolveRoute(value: string | null | undefined): string {
  if (typeof value === "string" && ROUTES.some((item) => item.id === value)) return value;
  return DEFAULT_ROUTE;
}

export default function App() {
  const route = resolveRoute(params.route);
  const Page = (ROUTES.find((item) => item.id === route) ?? ROUTES[0]).component;
  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        backgroundColor: c.bg(),
      }}
    >
      <Page />
    </View>
  );
}

mount(App);
