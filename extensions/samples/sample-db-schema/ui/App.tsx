// 示例插件：字段速览（数据库侧边栏）。
//
// 这个样例演示「数据库能力面 + 两种接入点」：
//   - 数据库侧边栏面板：`contributes.panels[].anchor = "db-sidebar"`，
//     第二个实例（`params.surface == "panel"`，`params.anchor == "db-sidebar"`），
//     启动上下文 `host.params.context` 是当前连接；
//   - 详情页：面板里 `openApp` 跳到本插件的 tab（同一个 bundle），
//     把连接上下文一起带过去。
import { mount, Scroll, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
import { params } from "./lib/navop";
import { c, hairline, t } from "./lib/theme";
import SchemaPage from "./pages/schema/App";
import Panel from "./pages/panel/App";

const DEFAULT_ROUTE = "schema";

type RouteItem = {
  id: string;
  title: string;
  glyph: string;
  component: () => JSX.Element;
};

const ROUTES: RouteItem[] = [{ id: "schema", title: "字段速览", glyph: "F", component: SchemaPage }];

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
  const title = params.extension?.title ?? "字段速览";

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
            modules: db / app / ui · anchor: db-sidebar
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
