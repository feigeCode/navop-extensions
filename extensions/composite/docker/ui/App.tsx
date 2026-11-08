// Docker 扩展的 app 入口：一个扩展 = 一个 nsh app，app 内用路由组织 12 个页面。
//
// 宿主只在打开时下发一次启动事实（`params.route` 来自连接清单的
// `connections[].route`），之后的路由切换全在 app 里：左侧侧栏列「资源 / 引擎」
// 两组，右侧内容区按当前路由挂载页面组件。页面不感知外壳，切走即卸载、切回重新
// 初始化（契约 §6：未访问的路由不执行初始化）。
//
// 「单容器」那 7 个视图（进程 / 容器文件 / 文件变更 / 检查 / 挂载 / 统计 / 终端）不再占侧栏：
// 它们都作用于「当前选中的那个容器」，所以进了容器详情页的标签条（见
// `pages/containers/App.tsx` 的 detailTab），侧栏只留资源与引擎两类入口。路由 id
// 仍然保留，老的连接清单里 `route: "container-terminal"` 这类值照样能打开。
//
// 侧栏刻意做得像桌面应用的导航：只留文字与分组标签，不放字母方块 ——
// 字母块既占地方又要靠猜，而分组本身就说明了这些视图是什么关系。
//
// 没有连接时（工具箱打开或连接没建立）不渲染任何页面，只在内容区显示空态，
// 避免页面在模块顶层读 `connection()` 时抛错、也避免发起无用的 invoke。
import { mount, Scroll, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
import { params } from "./lib/navop";
import { Dot, Empty } from "./lib/ui";
import { c, hairline, r, t } from "./lib/theme";
import Containers from "./pages/containers/App";
import Images from "./pages/images/App";
import Volumes from "./pages/volumes/App";
import Networks from "./pages/networks/App";
import Overview from "./pages/overview/App";
import LogViewer from "./pages/log-viewer/App";
import Processes from "./pages/processes/App";
import Changes from "./pages/changes/App";
import ContainerFiles from "./pages/container-files/App";
import ContainerInspect from "./pages/container-inspect/App";
import ContainerMounts from "./pages/container-mounts/App";
import ContainerStats from "./pages/container-stats/App";
import ContainerTerminal from "./pages/container-terminal/App";

/** 默认路由：也是连接清单里 `route` 的值。 */
const DEFAULT_ROUTE = "containers";

type RouteItem = {
  /** 沿用旧 shellViews 的 view id，迁移期老入口/连接清单不用改语义。 */
  id: string;
  /** 侧栏显示名。 */
  title: string;
  component: () => JSX.Element;
};

type RouteGroup = {
  title: string;
  items: RouteItem[];
  /** 不进侧栏：只保留路由 id，供老的连接清单 / 深链打开。 */
  hidden?: boolean;
};

/** 路由表。分组表达关系：资源是引擎里的东西，后六个是「已选中那个容器」的单点视图。 */
const GROUPS: RouteGroup[] = [
  {
    title: "资源",
    items: [
      { id: "containers", title: "容器", component: Containers },
      { id: "images", title: "镜像", component: Images },
      { id: "volumes", title: "数据卷", component: Volumes },
      { id: "networks", title: "网络", component: Networks },
    ],
  },
  {
    title: "引擎",
    items: [
      { id: "overview", title: "引擎概览", component: Overview },
      { id: "log-viewer", title: "日志", component: LogViewer },
    ],
  },
  {
    title: "单个容器",
    hidden: true,
    items: [
      { id: "processes", title: "进程", component: Processes },
      { id: "container-files", title: "容器文件", component: ContainerFiles },
      { id: "changes", title: "文件变更", component: Changes },
      { id: "container-inspect", title: "检查", component: ContainerInspect },
      { id: "container-mounts", title: "挂载", component: ContainerMounts },
      { id: "container-stats", title: "统计", component: ContainerStats },
      { id: "container-terminal", title: "终端", component: ContainerTerminal },
    ],
  },
];

/** 扁平路由表（查找用，含不进侧栏的老路由）。 */
const ROUTES: RouteItem[] = GROUPS.reduce<RouteItem[]>((all, group) => all.concat(group.items), []);

/** 侧栏只画显式列出来的组。 */
const SIDEBAR_GROUPS: RouteGroup[] = GROUPS.filter((group) => group.hidden !== true);

/** 未知 route 回落默认路由（老的 view id、拼写错误都走这里）。 */
function resolveRoute(value: string | null | undefined): string {
  if (typeof value === "string" && ROUTES.some((item) => item.id === value)) return value;
  return DEFAULT_ROUTE;
}

function routeById(id: string): RouteItem {
  return ROUTES.find((item) => item.id === id) ?? ROUTES[0];
}

/** 侧栏宽度。216 能放下「文件变更」这类四字标题，再宽就抢内容区了。 */
const SIDEBAR_WIDTH = 216;

export default function App() {
  // 启动事实只读一次：宿主打开 tab 时给一次 route，之后 app 自己维护。
  const route = signal(resolveRoute(params.route));
  const connection = params.connection ?? null;
  const title = params.extension?.title ?? "Docker";

  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "row",
        backgroundColor: c.bg(),
      }}
    >
      {/* 侧栏：标题 + 连接状态 + 分组路由。用 sidebar 一组 token，和宿主侧栏同色系。 */}
      <View
        style={{
          width: SIDEBAR_WIDTH,
          flexShrink: 0,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          backgroundColor: c.sidebar(),
          borderRightWidth: 1,
          borderRightColor: c.sidebarLine(),
        }}
      >
        <View
          style={{
            paddingHorizontal: 12,
            paddingTop: 12,
            paddingBottom: 10,
            display: "flex",
            flexDirection: "column",
            gap: 3,
          }}
        >
          <Text style={t.h1} numberOfLines={1}>
            {title}
          </Text>
          <View style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Dot color={connection === null ? c.muted() : c.chart(1)} size={5} />
            <Text style={t.meta} numberOfLines={1}>
              {connection === null ? "未连接" : connection.name ?? "已连接"}
            </Text>
          </View>
        </View>
        <View style={hairline()} />
        <Scroll style={{ flex: 1, minHeight: 0 }}>
          <View style={{ paddingHorizontal: 8, paddingTop: 4, paddingBottom: 12 }}>
            {SIDEBAR_GROUPS.map((group) => (
              <View style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <Text
                  numberOfLines={1}
                  style={{
                    ...t.label,
                    color: c.muted(),
                    paddingHorizontal: 8,
                    paddingTop: 10,
                    paddingBottom: 4,
                  }}
                >
                  {group.title}
                </Text>
                {group.items.map((item) => (
                  <View
                    role="button"
                    onPress={() => route.set(item.id)}
                    hoverStyle={{ backgroundColor: c.sidebarActive() }}
                    style={{
                      display: "flex",
                      flexDirection: "row",
                      alignItems: "center",
                      height: 26,
                      paddingHorizontal: 8,
                      borderRadius: r.control,
                      backgroundColor: route() === item.id ? c.sidebarActive() : "transparent",
                      cursor: "default",
                    }}
                  >
                    <Text
                      numberOfLines={1}
                      style={{
                        fontSize: 12.5,
                        fontWeight: route() === item.id ? "600" : "400",
                        color: route() === item.id ? c.sidebarActiveText() : c.sidebarText(),
                      }}
                    >
                      {item.title}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </Scroll>
      </View>

      {/* 内容区：flex_1 min_w_0 min_h_0，由当前路由决定挂载哪个页面。 */}
      <View style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {() => {
          if (connection === null) {
            return (
              <Empty
                title="请先打开一个 Docker 连接"
                hint="在工具箱或连接列表里打开 Docker，连接成功后会显示容器与资源视图。"
              />
            );
          }
          const Page = routeById(route()).component;
          return <Page />;
        }}
      </View>
    </View>
  );
}

mount(App);
