// 示例插件：终端工作台（一个插件 = 一个 nsh app，app 内用路由组织页面）。
//
// 这个样例演示「终端能力面 + 面板形态」：
//   - tab 形态：列终端会话、读屏幕快照、往活动终端执行命令；
//   - 面板形态（`params.surface == "panel"`）：同一份 bundle 的第二实例，
//     挂在终端侧边栏（`contributes.panels[].anchor = "terminal-sidebar"`）。
import { mount, Scroll, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
import { params } from "./lib/navop";
import { c, hairline, t } from "./lib/theme";
import Desk from "./pages/desk/App";
import Panel from "./pages/panel/App";

const DEFAULT_ROUTE = "desk";

type RouteItem = {
  id: string;
  title: string;
  glyph: string;
  component: () => JSX.Element;
};

const ROUTES: RouteItem[] = [{ id: "desk", title: "工作台", glyph: "T", component: Desk }];

function resolveRoute(value: string | null | undefined): string {
  if (typeof value === "string" && ROUTES.some((item) => item.id === value)) return value;
  return DEFAULT_ROUTE;
}

function routeById(id: string): RouteItem {
  return ROUTES.find((item) => item.id === id) ?? ROUTES[0];
}

export default function App() {
  if (params.surface === "panel") return <Panel />;

  const route = signal(resolveRoute(params.route));
  const title = params.extension?.title ?? "终端工作台";

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
            modules: terminal / ui
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
                  style={{ fontSize: 13, color: route() === item.id ? c.text() : c.muted() }}
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
