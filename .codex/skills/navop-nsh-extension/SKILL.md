---
name: navop-nsh-extension
description: 'Use when writing, reviewing, or debugging Navop extension UI built on nsh: one plugin = one nsh app (ui/App.tsx + ui/pages/*), nsh.json, host ABI v2 (params / invoke / onEvent / log), extension.json contributes.shellApp and connections, theme tokens, nsh check/test/build, local install, and rendering or empty-state failures.'
---

# Navop 扩展 = 一个 nsh app

## 0. 先确认入口：nsh，不是 gpui-shell

Navop 扩展页面已从 gpui-shell 脚本页迁到 **nsh**：`ui/` 是一个 TSX app，入口 `ui/App.tsx`，
页面是 `ui/pages/<route>/App.tsx`，`nsh build` 产出一个 `ui/dist/bundle.js`。

以下约定**已下线，不要照抄**（历史扩展里还能见到）：

| 已下线 | 现在 |
| --- | --- |
| `ui/*.js` 脚本页、`gpui-shell` / `gpui-component-shell` 运行时 | `ui/**/*.tsx` + `nsh` |
| `contributes.shellViews` / `shellViewId` | `contributes.shellApp` + `connections[].route` |
| `resourceWorkbenches[].pages[].renderer={kind:"shell"}` | app 内路由（`pages/<route>/App.tsx`） |
| `View` 的 `init()` / `render()` 生命周期、`cx` / `cx.theme()` | 函数组件 + `signal()` / `effect()` / `cleanup()`，颜色走 `token()` |
| `navop.workbench.dispatch()`、`navop.context`、`navop.i18n`、`navop.theme` | `host.params` / `invoke()`，语言与主题由 nsh 原生提供 |

旧 skill 的 `references/script-api.md`、`references/shell-reuse.md` 已删除。迁移旧扩展时，先看
`templates/extension-basic/`，把页面搬进 `ui/pages/` 并删掉旧清单段。

## 1. 模型

一个插件 = 一个 nsh app = 一个包。宿主在打开 tab 时下发**一次**启动事实
（`route`、`connection`、`backends`），之后侧栏切换、页内跳转、返回都由 app 自己的路由表处理。
页面只是组件，不感知外壳，也不重复 mount。

## 2. 目录骨架

```
demo/
├── extension.json           # 身份 / 权限 / shellApp / connections
├── extension.build.json     # 打包元数据（静态扩展无需原生二进制）
├── scripts/{check,test,build}.sh
└── ui/                      # 一个 nsh app
    ├── App.tsx              # 外壳：208px 侧栏 + ROUTES 路由表
    ├── App.test.tsx         # 外壳测试（默认路由 / 未知 route 回落）
    ├── nsh.json             # app 元数据；id 必须等于扩展 id
    ├── tsconfig.json        # extends ./.nsh/tsconfig.json
    ├── lib/
    │   ├── navop.ts         # export * from "@navop/extension-kit"
    │   ├── theme.ts         # export * from "@navop/extension-kit/theme"
    │   ├── test-host.ts     # 本扩展的测试启动事实
    │   └── format.ts
    ├── pages/<route>/       # 每个目录一个路由页面
    │   ├── App.tsx          # 只 export default 组件
    │   └── App.test.tsx
    └── dist/bundle.js       # nsh build 产物，入库随扩展分发
```

页面目录里**不再**有 `nsh.json` / `tsconfig.json` / `dist` / `.nsh`。

## 3. 从模板起步，不要手写骨架

```bash
# 外部（npm 包）
npx @navop/create-extension new --id com.example.demo --name "演示扩展"

# 本仓库内
node scripts/create-extension.mjs --id com.example.demo --name "演示扩展" --dir extensions/composite/demo

cd extensions/composite/demo
nsh check ui && nsh test ui && bash scripts/build.sh
```

生成器会复制模板、改写 id/名称、装依赖，并跑一次 `nsh check` + `nsh build`。

## 4. 硬契约（违反多半是安装失败或整页空白）

1. **一个插件一个 app**：`contributes.shellApp.entry` 指向唯一的 `ui/dist/bundle.js`；不写 `shellViews`。
2. **路由在 app 内**：宿主只下发一次 `host.params.route`；`ui/App.tsx` 用 `ROUTES` 解释，
   未知 route 回落默认路由。别再让宿主按 view 挂页面。
3. **连接走 `connections[].route`**：打开连接时宿主把 `route` 和 `connection` 一起下发；
   没有连接（工具箱打开 / 未建立）时 `params.connection === null`，外壳只显示空态、不渲染页面，
   也不要在模块顶层调 `connection()`。
4. **页面无壳**：`pages/*/App.tsx` 只 `export default` 一个组件，不 `mount`、不读自己的 `nsh.json`。
5. **两层 id 对齐**：`nsh.json.id === extension.json.id`；`capabilities.host: true` 才允许 `host.call`。
6. **`dist/` 入库**：构建产物随扩展分发；宿主按 `entry` 加载，不会替你构建。
7. **最小权限**：`permissions` 只加实际用到的（`shell:exec`、`spawn:...`、`net:...`、`secrets:...`）；
   声明 `resource/job/event/blob` 模块就必须有 `backends`，且 `backends` 指向 `runtime.ipc[].id`。

## 5. 宿主 ABI v2

`@navop/extension-kit`（`ui/lib/navop.ts` 转发）是页面与宿主之间的唯一通道：

| 封装 | 底层 | 用途 |
| --- | --- | --- |
| `params` | `host.params` | 启动事实：`apiVersion`、`extension{id,title}`、`route`、`backends`、`connection` |
| `extension` / `backends` | 同上 | 当前 app 身份 / 已激活 runtime 别名 |
| `connection()` | `params.connection` | 当前连接；无连接时抛错 |
| `invoke(method, payload?, {timeout})` | `host.call("navop.resource.invoke", {handle, method, params})` | 调 provider 方法，默认 30s，慢命令用 `SLOW_TIMEOUT_MS`（60s）或 `0` |
| `open(resourceType, config?, {backend})` | `navop.resource.open` | 自己开资源，返回句柄 |
| `ping` / `close` | `navop.resource.ping` / `.close` | 探活 / 关句柄 |
| `log(level, message, fields?)` | `host.post("navop.log")` | 单向日志，不等应答 |
| `onEvent(fn)` | `host.on("navop.event")` | provider 事件推送；返回停止函数，渲染期注册随卸载自动停 |

`invoke` 失败抛带 `code` / `retryable` / `details` 的错误；读操作直接 `await`，写操作成功后
`signal` 更新 + 提示，不要吞错。

## 6. nsh 写法速查

**最重要的坑：函数组件体只在挂载时跑一次，JSX 属性表达式与子节点每帧重新求值。**
依赖 props / 响应式值（主题 token、选中态、busy、数据）的东西必须内联写在 JSX 里；
提成组件体常量会冻住（按钮 disabled 后按不动、进度条不动、tone 不变，都是这个根因）。

```tsx
import { Scroll, Text, View, effect, signal, cleanup } from "nsh";
import { invoke, params } from "../../lib/navop";
import { c, hairline, panel, r, t } from "../../lib/theme";
import { Button, Empty, List, ListRow, Loading, LoadError } from "@navop/extension-kit/ui";

export default function Containers() {
  const rows = signal<Row[]>([]);
  const busy = signal(false);
  const error = signal<string | null>(null);

  async function load() {
    busy.set(true);
    error.set(null);
    try {
      rows.set(await invoke<Row[]>("docker/container/list"));
    } catch (failure) {
      error.set(String((failure as { message?: string }).message ?? failure));
    } finally {
      busy.set(false);
    }
  }

  // 挂载即取数；轮询用 effect + cleanup，条件变化自动重跑。
  void load();
  effect(() => {
    const timer = setInterval(() => void load(), 5000);
    cleanup(() => clearInterval(timer));
  });

  if (error() !== null) return <LoadError message={error()!} onRetry={() => void load()} />;
  if (busy() && rows().length === 0) return <Loading label="加载中" />;
  if (rows().length === 0) return <Empty title="还没有容器" hint="先启动一个容器" />;

  return (
    <Scroll style={{ flex: 1, minHeight: 0, padding: 16 }}>
      <View style={{ ...panel(), display: "flex", flexDirection: "column" }}>
        <List
          items={rows()}
          keyOf={(row) => row.id}
          onSelect={(id) => select(id)}
          render={(row) => <ListRow title={row.name} subtitle={row.status} />}
        />
      </View>
    </Scroll>
  );
}
```

规则：

- **状态**：`signal(initial)`；读 `sig()`、写 `sig.set(v)` / `sig.update(fn)`。派生值写成函数，别缓存。
- **副作用**：组件体里直接执行一次挂载副作用；依赖项用 `effect(fn)` 重跑；清理用 `cleanup(fn)`。
- **布局**：flexbox 样式对象（`display/flexDirection/gap/padding/flex/minWidth/minHeight`）；
  滚动容器 `Scroll` 必须 `flex: 1, minHeight: 0`；窄容器文本 `numberOfLines={1}`。
- **可点区域**：`role="button"` + `onPress`；图标按钮用 `IconButton`。
- **组件库优先**：`@navop/extension-kit/ui` 已有 Stack/Row/Card/Badge/Button/SearchField/List/
  ListRow/Empty/Loading/LoadError/Stat/Meter/KeyValue/Section/Toolbar/Segmented/SplitPane/ConfirmBar/Notice，
  不要在页面里重造；纯 nsh 原语只有 `View/Text/Scroll` 等。先读 `packages/extension-kit/src/ui.tsx`
  的 props 再写（`List` 是 `items/keyOf/render`，`ListRow` 是 `title/subtitle/leading/trailing`，
  `SearchField` 的 `value` 是字符串 + `onChange`）。
- **主题**：只用 `c.*`（`background/card/foreground/muted-foreground/border/primary/
  primary-foreground/destructive/muted/sidebar*/input/chart-1..5`）、`t.*`、`r.*`、
  `hairline()`、`panel()`；颜色是响应式 token，**不要写死色值**，否则切主题后瞎。
- **确认**：破坏性操作先 `ConfirmBar`/二次确认，再调 provider；不要为了消错无条件放行。

## 7. 测试与本地验证

```bash
cd extensions/composite/demo
nsh check ui                     # tsc 类型检查
nsh test ui                      # 外壳 + ui/pages/* 全部页面测试
bash scripts/build.sh            # 产出 ui/dist/bundle.js（入库）
cd ../.. && node --test tests/scripts.test.mjs   # 仓库静态守卫（manifest/主题/双语描述/i18n…）
```

- 页面测试打开**外壳**并注入路由，零额外入口文件：
  `open("../../App.tsx", { width: 1200, height: 800, host: { params: { ...TEST_PARAMS, route: "home" }, handlers } })`；
  之后 `app.waitFor("text:…")`、`app.texts()`、`app.press("…")`、`app.dispose()`。
- 测试桩从 `@navop/extension-kit/testing` 取 `testParams/hostHandlers/TEST_CONNECTION`，
  扩展在 `ui/lib/test-host.ts` 固化自己的 extension/route/backends/connection。
- 默认视口 390×844；带侧栏的断言显式给 `width/height`，否则会被裁掉。
- 改完 Rust provider 或 manifest 后，再跑扩展自身的 cargo 测试（`extensions/composite/<x>/tests`）。
- 本机安装：`bash scripts/install-local-composite-extensions.sh`（装到
  `~/.config/navop/extensions/composite/<短id>`，旧版备份到 `.backups/`），重启 Navop 后打开对应 tab 验证。

## 8. 排错

- **整页空白**：先看 Navop 日志。常见原因是清单与实现不一致——`nsh.json.id` 与扩展 id 不等、
  `entry` 指向不存在的文件、`modules` 声明了未实现的能力、`pages/` 里残留旧 `nsh.json`。
- **打开无内容**：`params.connection === null` 时是否仍渲染页面？`route` 是否在 `ROUTES` 里？
  未知 route 要走默认路由而不是白屏。
- **`no resource handle`**：在无连接上下文里调了 `invoke()`；工具箱打开时只显示空态。
- **按钮/进度/选中态冻住**：把依赖 props 的值提成组件体常量了，改回内联 JSX 或 accessor。
- **切主题后颜色不跟**：写死了色值或在模块加载时求值了 `c.*()`；用 `t.*`/`c.*` 函数并在 JSX 里调用。
- **`nsh check` 报 style 类型**：`nsh` 的 `ViewStyle`/`TextStyle` 是闭集；`width` 百分比要写成
  `` `${number}%` `` 模板字面量类型，不认识的属性直接删。

## 9. 参考

- [清单参考](references/manifest.md) — `extension.json` 全字段、`shellApp`、`connections`、`modules`、构建安装。
- [nsh app 参考](references/nsh-app.md) — 外壳/路由骨架、主题 token、组件库、宿主绑定、测试 API、产物结构。
- 模板与示例（本仓库）：`templates/extension-basic/`、`extensions/composite/docker/ui`、
  `extensions/composite/mqtt/ui`、`extensions/composite/dev-tools/ui`。
- `@navop/extension-kit`：`packages/extension-kit/README.md`；nsh 文档：https://nsh.dev。
- 宿主侧契约：`../navop/crates/extension-runtime/src/extension/manifest/contributes/shell.rs`（`deny_unknown_fields`）。
