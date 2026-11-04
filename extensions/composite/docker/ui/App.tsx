// Docker 扩展的 app 入口：一个扩展 = 一个 nsh app，app 内用路由组织 12 个页面。
//
// 宿主只在打开时下发一次启动事实（`params.route` 来自连接清单的
// `connections[].route`），之后的路由切换全在 app 里：左侧 208px 侧栏列路由，
// 右侧内容区按当前路由挂载页面组件。页面不感知外壳，切走即卸载、切回重新
// 初始化（契约 §6：未访问的路由不执行初始化）。
//
// 没有连接时（工具箱打开或连接没建立）不渲染任何页面，只在内容区显示空态，
// 避免页面在模块顶层读 `connection()` 时抛错、也避免发起无用的 invoke。
import { mount, Scroll, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
import { params } from "./lib/navop";
import { Empty } from "./lib/ui";
import { c, hairline, r, t } from "./lib/theme";
import Containers from "./pages/containers/App";
import Images from "./pages/images/App";
import Volumes from "./pages/volumes/App";
import Networks from "./pages/networks/App";
import Overview from "./pages/overview/App";
import LogViewer from "./pages/log-viewer/App";
import Processes from "./pages/processes/App";
import Changes from "./pages/changes/App";
import ContainerInspect from "./pages/container-inspect/App";
import ContainerMounts from "./pages/container-mounts/App";
import ContainerStats from "./pages/container-stats/App";
import ContainerTerminal from "./pages/container-terminal/App";

/** 默认路由：也是连接清单里 `route` 的值。 */
const DEFAULT_ROUTE = "containers";

type RouteItem = {
  /** 沿用旧 shellViews 的 view id，迁移期老入口/连接清单不用改语义。 */
  id: string;
  /** 沿用旧 shellViews 的 title。 */
  title: string;
  /** 侧栏图标位：单字符字形，避免为 12 条路由各带一份图标资源。 */
  glyph: string;
  component: () => JSX.Element;
};

/** 路由表。顺序就是侧栏顺序：先资源（容器/镜像/卷/网络），再引擎与容器单点视图。 */
const ROUTES: RouteItem[] = [
  { id: "containers", title: "容器", glyph: "C", component: Containers },
  { id: "images", title: "Docker Images", glyph: "I", component: Images },
  { id: "volumes", title: "Docker Volumes", glyph: "V", component: Volumes },
  { id: "networks", title: "Docker Networks", glyph: "N", component: Networks },
  { id: "overview", title: "Docker Engine Overview", glyph: "O", component: Overview },
  { id: "log-viewer", title: "Docker Log Viewer", glyph: "L", component: LogViewer },
  { id: "processes", title: "Container Processes", glyph: "P", component: Processes },
  { id: "changes", title: "Container Filesystem Changes", glyph: "D", component: Changes },
  { id: "container-inspect", title: "Docker Container Inspect", glyph: "i", component: ContainerInspect },
  { id: "container-mounts", title: "Docker Container Mounts", glyph: "M", component: ContainerMounts },
  { id: "container-stats", title: "Docker Container Stats", glyph: "S", component: ContainerStats },
  { id: "container-terminal", title: "Container Terminal", glyph: ">", component: ContainerTerminal },
];

/** 未知 route 回落默认路由（老的 view id、拼写错误都走这里）。 */
function resolveRoute(value: string | null | undefined): string {
  if (typeof value === "string" && ROUTES.some((item) => item.id === value)) return value;
  return DEFAULT_ROUTE;
}

function routeById(id: string): RouteItem {
  return ROUTES.find((item) => item.id === id) ?? ROUTES[0];
}

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
      {/* 208px 侧栏：app 标题 + 路由项，当前项高亮。 */}
      <View
        style={{
          width: 208,
          flexShrink: 0,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          backgroundColor: c.panel(),
          borderRightWidth: 1,
          borderRightColor: c.line(),
        }}
      >
        <View
          style={{
            paddingHorizontal: 14,
            paddingTop: 14,
            paddingBottom: 10,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <Text style={t.h1} numberOfLines={1}>
            {title}
          </Text>
          <Text style={t.meta} numberOfLines={1}>
            {connection === null ? "未连接" : connection.name ?? "已连接"}
          </Text>
        </View>
        <View style={hairline()} />
        <Scroll style={{ flex: 1, minHeight: 0 }}>
          <View style={{ padding: 8, display: "flex", flexDirection: "column", gap: 2 }}>
            {ROUTES.map((item) => (
              <View
                role="button"
                onPress={() => route.set(item.id)}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 9,
                  paddingVertical: 5,
                  paddingHorizontal: 8,
                  borderRadius: r.control,
                  backgroundColor: route() === item.id ? c.hover() : "transparent",
                }}
              >
                <View
                  style={{
                    width: 20,
                    height: 20,
                    flexShrink: 0,
                    borderRadius: r.chip,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: route() === item.id ? c.accent() : c.hover(),
                  }}
                >
                  <Text
                    style={{
                      fontSize: 9,
                      fontWeight: "700",
                      color: route() === item.id ? c.accentText() : c.muted(),
                    }}
                  >
                    {item.glyph}
                  </Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    numberOfLines={1}
                    style={{
                      fontSize: 12,
                      fontWeight: route() === item.id ? "600" : "400",
                      color: route() === item.id ? c.text() : c.muted(),
                    }}
                  >
                    {item.title}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </Scroll>
        <View style={hairline()} />
        <View style={{ paddingHorizontal: 14, paddingVertical: 10 }}>
          <Text style={t.meta}>{`共 ${ROUTES.length} 个视图`}</Text>
        </View>
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
