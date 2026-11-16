// 扩展能力演示的 app 外壳。
//
// 两种 surface 共用这一份 bundle：
// - tab 形态（工具箱 / DB 右键菜单打开）：左侧路由栏 + explorer 页面；
// - panel 形态（终端侧边栏按钮）：直接渲染 ui/pages/panel。
//
// DB 菜单命令（kind:"nsh"）进来时宿主把节点上下文放进
// `host.params.context`，explorer 页读它显示「从哪个表打开」。
import { mount, Scroll, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
import { params } from "./lib/navop";
import { c, hairline, t } from "./lib/theme";
import Explorer from "./pages/explorer/App";
import Panel from "./pages/panel/App";

const DEFAULT_ROUTE = "explorer";

const ROUTES: Array<{ id: string; title: string; glyph: string; component: () => JSX.Element }> = [
  { id: "explorer", title: "能力面演示", glyph: "E", component: Explorer },
];

function resolveRoute(value: string | null | undefined): string {
  return typeof value === "string" && ROUTES.some((item) => item.id === value)
    ? value
    : DEFAULT_ROUTE;
}

export default function App() {
  // 面板形态：侧栏空间有限，不渲染 tab 外壳。
  if (params.surface === "panel") return <Panel />;

  const route = signal(resolveRoute(params.route));
  const title = params.extension?.title ?? "扩展能力演示";

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
        <View style={{ paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10 }}>
          <Text style={t.h1} numberOfLines={1}>
            {title}
          </Text>
          <Text style={t.meta} numberOfLines={1}>
            surface: tab · context: {params.context ? "有" : "null"}
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
          const Page = ROUTES.find((item) => item.id === route())?.component ?? ROUTES[0].component;
          return <Page />;
        })()}
      </View>
    </View>
  );
}

mount(App);
