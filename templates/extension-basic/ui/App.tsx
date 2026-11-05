// 扩展的 app 入口：一个插件 = 一个 nsh app，app 内用路由组织页面。
//
// 宿主只在打开时下发一次启动事实（`params.route` 来自连接清单的
// `connections[].route`），之后的路由切换全在 app 里：左侧 208px 侧栏列路由，
// 右侧内容区按当前路由挂载页面组件。页面不感知外壳，切走即卸载、切回重新
// 初始化。
//
// 没有连接时（工具箱打开或连接没建立）不渲染页面，只在内容区显示空态，
// 避免页面在模块顶层读 `connection()` 时抛错、也避免发起无用的 invoke。
import { mount, Scroll, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
import { params } from "./lib/navop";
import { c, hairline, t } from "./lib/theme";
import Home from "./pages/home/App";
import About from "./pages/about/App";

/** 默认路由：也是连接清单里 `route` 的值。 */
const DEFAULT_ROUTE = "home";

type RouteItem = {
  /** 路由 id，出现在 `host.params.route` 与侧栏里。 */
  id: string;
  /** 侧栏标题。 */
  title: string;
  /** 侧栏图标位：单字符字形，避免为每个路由带一份图标资源。 */
  glyph: string;
  component: () => JSX.Element;
};

/** 路由表。顺序就是侧栏顺序。 */
const ROUTES: RouteItem[] = [
  { id: "home", title: "首页", glyph: "H", component: Home },
  { id: "about", title: "关于", glyph: "A", component: About },
];

/** 未知 route 回落默认路由（老入口、拼写错误都走这里）。 */
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
  const title = params.extension?.title ?? "扩展";

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
                  gap: 8,
                  paddingHorizontal: 8,
                  paddingVertical: 7,
                  borderRadius: 6,
                  backgroundColor: route() === item.id ? c.hover() : "transparent",
                }}
              >
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: route() === item.id ? c.accent() : c.line(),
                  }}
                >
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: "600",
                      color: route() === item.id ? c.accentText() : c.muted(),
                    }}
                  >
                    {item.glyph}
                  </Text>
                </View>
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: 13,
                    color: route() === item.id ? c.text() : c.muted(),
                  }}
                >
                  {item.title}
                </Text>
              </View>
            ))}
          </View>
        </Scroll>
        <View style={hairline()} />
        <Text style={{ ...t.meta, paddingHorizontal: 14, paddingVertical: 10 }}>
          {`route: ${route()}`}
        </Text>
      </View>

      {/* 内容区：按 route 挂载页面。用 <Page /> 而不是 {Page()}：
          `{Page()}` 会把页面里的 signal 注册成外壳的依赖，导致无限重建。

          这个模板没有连接，所以永远渲染页面。依赖连接的 app 应在渲染前判断
          `params.connection === null`，改为显示空态（参考 docker/ui/App.tsx）。 */}
      <View style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {(() => {
          const Page = routeById(route()).component;
          return <Page />;
        })()}
      </View>
    </View>
  );
}

mount(App);
