# nsh app 参考（Navop 扩展 UI）

一个扩展的 `ui/` 就是一个 nsh app：`App.tsx` 是外壳，`pages/<route>/App.tsx` 是页面，
`nsh build` 打成 `ui/dist/bundle.js`。本文只写 Navop 侧**已验证**的用法；组件与样式的完整参考在
https://nsh.dev（`elements` / `components` / `modules`），宿主 ABI 的绑定在
`packages/extension-kit/src/navop.ts`。

## 1. 外壳骨架（`ui/App.tsx`）

```tsx
import { mount, Scroll, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
import { params } from "./lib/navop";
import { c, hairline, t } from "./lib/theme";
import { Empty } from "@navop/extension-kit/ui";
import Containers from "./pages/containers/App";
import Images from "./pages/images/App";

const DEFAULT_ROUTE = "containers";

type RouteItem = { id: string; title: string; component: () => JSX.Element };
const ROUTES: RouteItem[] = [
  { id: "containers", title: "容器", component: Containers },
  { id: "images", title: "镜像", component: Images },
];

function resolveRoute(value: string | null | undefined): string {
  return typeof value === "string" && ROUTES.some((item) => item.id === value) ? value : DEFAULT_ROUTE;
}
const routeById = (id: string): RouteItem => ROUTES.find((item) => item.id === id) ?? ROUTES[0];

export default function App() {
  const route = signal(resolveRoute(params.route));   // 启动事实只读一次
  const connection = params.connection ?? null;

  return (
    <View style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "row", backgroundColor: c.bg() }}>
      <View style={{ width: 208, flexShrink: 0, display: "flex", flexDirection: "column", backgroundColor: c.sidebar(), borderRightWidth: 1, borderRightColor: c.line() }}>
        <Text style={t.h1} numberOfLines={1}>{params.extension?.title ?? "扩展"}</Text>
        <View style={hairline()} />
        <Scroll style={{ flex: 1, minHeight: 0 }}>
          {ROUTES.map((item) => (
            <View key={item.id} role="button" onPress={() => route.set(item.id)}
                  style={{ height: 30, justifyContent: "center", paddingHorizontal: 8, borderRadius: 6,
                           backgroundColor: route() === item.id ? c.hover() : "transparent" }}>
              <Text style={{ ...t.body, color: route() === item.id ? c.accent() : c.text() }}>{item.title}</Text>
            </View>
          ))}
        </Scroll>
      </View>

      <View style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {connection === null
          ? <Empty title="没有连接" hint="从连接列表打开这个扩展" />
          : (() => { const Page = routeById(route()).component; return <Page />; })()}
      </View>
    </View>
  );
}

mount(App);   // 外壳入口在文件末尾 mount；页面文件不要 mount
```

要点：

- **用 `<Page />`，不要 `{Page()}`**：`{Page()}` 会把页面里的 signal 注册成外壳依赖，导致无限重建。
- 未知 route 回落默认路由；老连接清单里的 route id 可以保留（docker 就是这样兼容 `container-terminal` 等旧入口）。
- 无连接时只渲染空态，不挂页面：页面可能在模块顶层读 `params.connection` / 调 `invoke`。
- 路由分组（侧栏分组、隐藏路由）只是外壳的展示结构，不影响 `host.params.route`。

## 2. 页面骨架（`ui/pages/<route>/App.tsx`）

```tsx
import { Scroll, Text, View, effect, signal, cleanup } from "nsh";
import { invoke } from "../../lib/navop";
import { c, panel, r, t } from "../../lib/theme";
import { Empty, List, ListRow, Loading, LoadError, SearchField } from "@navop/extension-kit/ui";

export default function Containers() {
  const rows = signal<Row[]>([]);
  const busy = signal(true);
  const error = signal<string | null>(null);
  const needle = signal("");

  async function load() {
    busy.set(true); error.set(null);
    try { rows.set(await invoke<Row[]>("docker/container/list")); }
    catch (failure) { error.set(String((failure as { message?: string }).message ?? failure)); }
    finally { busy.set(false); }
  }
  void load();                                   // 挂载即取数
  effect(() => {                                 // 依赖变化时重跑；卸载/重跑前先 cleanup
    const timer = setInterval(() => void load(), 5000);
    cleanup(() => clearInterval(timer));
  });

  if (error() !== null) return <LoadError message={error()!} onRetry={() => void load()} />;
  if (busy() && rows().length === 0) return <Loading label="加载中" />;
  if (rows().length === 0) return <Empty title="还没有容器" />;

  const visible = () => rows().filter((row) => row.name.includes(needle()));
  return (
    <Scroll style={{ flex: 1, minHeight: 0, padding: 16 }}>
      <View style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SearchField value={needle()} onChange={(value) => needle.set(value)} placeholder="搜索" />
        <View style={{ ...panel(), display: "flex", flexDirection: "column" }}>
          <List
            items={visible()}
            keyOf={(row) => row.id}
            onSelect={(id) => openDetail(id)}
            render={(row) => <ListRow title={row.name} subtitle={row.status} />}
            empty={<Empty title="没有匹配的容器" />}
          />
        </View>
      </View>
    </Scroll>
  );
}
```

页面文件只 `export default` 一个组件；不 `mount`、不读自己的 `nsh.json`、不假设外层布局。
切走即卸载、切回重新初始化——不要在模块作用域缓存数据。

## 3. nsh 响应式模型（最容易踩的坑）

**函数组件体只在挂载时执行一次；JSX 属性表达式与子节点绑定每帧重新求值。**

- 依赖 props / 响应式值的东西必须内联写在 JSX 属性或子节点里。提成组件体常量会冻住：
  `const disabled = busy()` 之后按钮永远按当前值渲染；`disabled={busy()}` 才会跟。
- 标了 `Maybe<T>` 的 props（如 `Button.disabled`、`List.items`/`selected`、`Stack.scroll`）同时接受
  值或 accessor：`disabled={() => busy()}`。文档里没标 `Maybe` 的仍然是普通值：
  `SearchField value={needle()}`、`Button label={…}`。
- 状态：`signal(initial)` → 读 `sig()`、写 `sig.set(v)` / `sig.update((old) => …)`。
- 副作用：组件体里直接跑一次是「挂载副作用」；要跟随依赖变化用 `effect(fn)`，清理用 `cleanup(fn)`。
  `effect` 会先执行 cleanup 再重跑，定时器/订阅都这么收。
- 派生值写成普通函数，不要在 signal 里缓存第二份；大列表用 `List`/`ListRow`（虚拟化由组件负责）。

## 4. 样式与主题

只用语义 token，不写死色值（写死的在对面主题下会瞎，切主题时也不跟）：

```ts
import { c, hairline, panel, r, t } from "@navop/extension-kit/theme";
```

- `c.*`（响应式函数，每个都返回当前主题值）：
  `bg`、`panel`、`panelText`、`text`、`muted`、`line`、`accent`、`accentText`、`danger`、`hover`、
  `sidebar`、`sidebarText`、`sidebarActive`、`sidebarActiveText`、`sidebarLine`、`field`、`chart(i)`（1–5）。
- `t.*`（getter，避免模块加载时冻结）：`h1`（14/600）、`h2`（12/600）、`body`（12.5）、`row`（13/500）、
  `label`（10/600 宽字距）、`meta`（11）、`mono`（11.5 tabular-nums）。
- `r`：`card:10`、`control:6`、`pill:999`、`chip:4`；`hairline()` 返回 1px 分割线样式；
  `panel(padding?)` 返回卡片容器样式；底层 `token("background")` 等可直接用。
- 布局是 flexbox：`display/flexDirection/gap/padding/margin/width/height/flex/minWidth/minHeight/
  alignItems/justifyContent/borderWidth/borderColor/borderRadius/backgroundColor/overflow`。
- 滚动：`Scroll` 容器自身必须 `flex: 1, minHeight: 0`；内部列也要 `minHeight: 0` 才能正确裁切。
- 文本：`Text` 支持 `numberOfLines`、`style: TextStyle`（fontSize/fontWeight/color/letterSpacing/fontVariant）。
- 百分比宽度要写成 `` `${number}%` ``（`ViewStyle.width` 是字面量联合类型）。

## 5. 组件库（`@navop/extension-kit/ui`）

优先复用，不要在页面里重造：

| 组件 | 用途 |
| --- | --- |
| `Stack` / `Row` | 纵向/横向布局，`gap`、`padding`、`scroll` |
| `Card` / `Section` / `SectionTitle` | 卡片、分区 |
| `Toolbar` / `Button` / `IconButton` / `Segmented` | 工具条、主/次/图标按钮、分段切换 |
| `SearchField` | 搜索输入：`value: string` + `onChange(next)` |
| `List` / `ListRow` | `List` 用 `items/keyOf/render/onSelect/empty`；`ListRow` 用 `title/subtitle/leading/trailing` |
| `Empty` / `Loading` / `LoadError` | 空态 / 加载 / 失败重试 |
| `Badge` / `Dot` / `Notice` | 状态徽标、状态点、提示条 |
| `Stat` / `Meter` / `Metric` | 指标 |
| `KeyValue` / `KeyValueGrid` / `KeyValueList` | 键值展示 |
| `SplitPane` / `ConfirmBar` | 分栏、破坏性操作确认条 |

`Tone`：`neutral | ok | warn | danger | info`。`Text`/`View`/`hairline` 也从这里转出（同 `nsh` 原语）。

## 6. 宿主绑定（`ui/lib/navop.ts`）

```ts
export * from "@navop/extension-kit";
```

- `params`：模块顶层读一次；`apiVersion: 2`、`extension{id,title}`、`route`、`backends: string[]`、
  `connection{resourceHandle,name,resourceType,config,…} | null`。
- `extension` / `backends` 便捷导出；`connection()` 无连接时抛错（只应在有连接的页面里调）。
- `invoke<T>(method, payload?, { timeout? })` → `navop.resource.invoke`；默认 30s，
  `SLOW_TIMEOUT_MS`（60s）用于列表/日志/大查询，`0` 完全交给 provider。
- `open(resourceType, config?, { backend? })` / `ping(handle?)` / `close(handle?)`：自己开/探/关资源；
  连接型页面一般只用宿主给的 `resourceHandle`。
- `log(level, message, fields?)`：单向通知；`onEvent(fn)` 订阅 provider 事件，返回停止函数。
- 错误形状：`{ code?, message, retryable?, details? }`；`retryable` 才值得给「重试」按钮。

## 7. 测试（`nsh/test`）

```tsx
import { expect, open, test } from "nsh/test";
import { TEST_PARAMS } from "../../lib/test-host";

test("列出容器", async () => {
  const app = await open("../../App.tsx", {
    width: 1200, height: 800,
    host: {
      params: { ...TEST_PARAMS, route: "containers" },
      handlers: { "docker/container/list": () => [{ id: "1", name: "web", status: "up" }] },
    },
  });
  await app.waitFor("text:web");
  expect(app.texts()).toContain("up");
  app.dispose();
});
```

- 页面测试**打开外壳**并注入 route，同时覆盖「route → 页面」；零额外入口文件。
- 默认视口 390×844；带侧栏的断言显式给 `width/height`，否则内容被裁掉。
- `handlers` 按 provider 方法名分派，返回值/抛错都行；`app.texts()` 取渲染文本，
  `app.press("按钮文字")` 点击，`app.waitFor("text:…")` 等渲染，`app.dispose()` 释放。
- 宿主桩：`testParams({ extension, route, backends, connection })`、`hostHandlers(byMethod)`、
  `TEST_CONNECTION`（句柄 `r-1`）来自 `@navop/extension-kit/testing`；
  扩展在 `ui/lib/test-host.ts` 里固化自己的 `TEST_PARAMS`。
- `app.host.posts()` 可断言 `navop.log` 等单向调用。

## 8. 构建产物（`ui/dist/`，入库）

```
dist/
├── app.json            # {"id": "<扩展 id>"} —— 宿主按它认 app
├── bundle.js           # 唯一入口，包含所有被 import 的页面
├── bundle.js.map
├── bundle.nshc         # 编译缓存/字节码
└── capabilities.json   # 由 nsh.json 的 capabilities 生成
```

- `nsh build . --out dist` 后**提交 dist**；宿主不会替你构建。
- `extension.json` 的 `shellApp.entry` 指向 `ui/dist/bundle.js`。
- `nsh.json` 的 `id` 与扩展 id 不一致时，`app.json` 也对不上，表现为 tab 打不开或空白。
- 只改页面代码也要重新 build，否则运行的是旧 bundle。

## 9. 常见故障对照

| 现象 | 先查 |
| --- | --- |
| tab 打开空白 | `dist/app.json` id、`nsh.json` id、`shellApp.entry` 是否一致；`dist/` 是否最新 |
| 页面不渲染 | `params.connection === null` 却渲染页面；`route` 不在 `ROUTES`；`<Page />` 写成了 `{Page()}` |
| 点击无反应 / 按钮灰色 | props 被提成组件体常量，或 disabled 传了值而不是 accessor |
| 切主题颜色不变 | 写死色值、模块加载时求值 `c.*()`、或用了非 `token()` 的颜色 |
| `invoke` 抛 no resource handle | 工具箱上下文里调了 `invoke()`；应只显示空态 |
| 布局溢出/被裁 | `Scroll` 或列容器缺 `flex:1, minHeight:0`；百分比宽度类型不对 |
| 安装期报未知字段 | `extension.json` 有 serde 不认的字段（`deny_unknown_fields`），对照 `references/manifest.md` |
| 安装期报 module 不支持 | 写了 v2 已删除的 `context`/`i18n`/`theme`/`workbench`，或声明了没实现的模块 |
