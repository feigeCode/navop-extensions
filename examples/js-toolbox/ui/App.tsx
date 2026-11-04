// JS 工具箱的 app 入口：一个扩展 = 一个 nsh app，app 内用路由组织 3 个工具页。
//
// 宿主只在打开时下发一次启动事实（`params.route` 来自连接清单的
// `connections[].route`；工具箱打开为 null），之后的路由切换全在 app 里：
// 左侧 208px 侧栏列路由，右侧内容区按当前路由挂载页面组件。页面不感知外壳，
// 切走即卸载、切回重新初始化（契约 §6：未访问的路由不执行初始化）。
//
// 本扩展没有连接声明，`params.connection` 永远是 null，所以不画「请先打开连接」
// 空态——工具箱 app 的页面不依赖连接，直接按路由渲染。
import { host, mount, Scroll, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
import { c, hairline, r, t } from "./lib/theme";
import Crypto from "./pages/crypto/App";
import Hosts from "./pages/hosts/App";
import Json from "./pages/json/App";

/** 默认路由：工具箱打开时先看 JSON 工具。 */
const DEFAULT_ROUTE = "json";

/** 启动事实：宿主在首帧前写入，app 生命周期内不变（ABI v2）。 */
type StartupParams = {
  route?: string | null;
  extension?: { id?: string; title?: string };
};

const params = host.params as unknown as StartupParams;

type RouteItem = {
  /** 沿用旧版页面的 id：工具箱快捷键与老入口不用改语义。 */
  id: string;
  /** 侧栏标题：比页面内 h1 短，208px 侧栏放得下。 */
  title: string;
  /** 侧栏图标位：单字符字形，避免为每条路由各带一份图标资源。 */
  glyph: string;
  component: () => JSX.Element;
};

/** 路由表。顺序就是侧栏顺序：JSON → Crypto → Hosts。 */
const ROUTES: RouteItem[] = [
  { id: "json", title: "JSON 工具", glyph: "J", component: Json },
  { id: "crypto", title: "Crypto 工具箱", glyph: "C", component: Crypto },
  { id: "hosts", title: "Hosts 编辑器", glyph: "H", component: Hosts },
];

/** 未知 route 回落默认路由（拼写错误、老 view id 都走这里）。 */
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
  const title = params.extension?.title ?? "JS Toolbox";

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
            {`共 ${ROUTES.length} 个工具`}
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
      </View>

      {/* 内容区：flex_1 min_w_0 min_h_0，由当前路由决定挂载哪个页面。 */}
      <View style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {() => {
          const Page = routeById(route()).component;
          return <Page />;
        }}
      </View>
    </View>
  );
}

mount(App);
