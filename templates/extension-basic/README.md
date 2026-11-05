# Navop 扩展模板（extension-basic）

一个**最小可运行**的 Navop 扩展：一个插件 = 一个 nsh app = 一个包。
模板本身不含 provider（原生后端），先让 UI 跑起来；接 provider 的步骤见 §5。

```
extension-basic/
├── extension.json          # 扩展清单：身份、权限、shellApp（app 入口）
├── extension.build.json    # 打包元数据（静态扩展，无需原生二进制）
├── README.md
├── scripts/
│   ├── check.sh            # nsh check + 全部测试
│   ├── test.sh             # 外壳测试 + 每个页面测试
│   └── build.sh            # 产出 ui/dist/bundle.js
└── ui/                     # 一个 nsh app：入口在 ui/App.tsx
    ├── App.tsx             # 外壳：208px 侧栏 + 路由表 + 内容区
    ├── App.test.tsx        # 外壳测试（route 缺省/未知回落）
    ├── nsh.json            # nsh app 元数据（id 必须等于扩展 id）
    ├── tsconfig.json
    ├── lib/
    │   ├── navop.ts        # 宿主 ABI 绑定：params / route / connection / invoke / log
    │   ├── test-host.ts    # 测试用启动事实
    │   └── theme.ts        # 语义色与排版（全部走宿主主题 token）
    ├── pages/              # 路由组件：每个目录一个页面，不 mount、不读 nsh.json
    │   ├── home/
    │   │   ├── App.tsx
    │   │   └── App.test.tsx
    │   └── about/
    │       └── App.tsx
    └── dist/               # nsh build 产物，入库
```

## 1. 生成一个新扩展

外部（npm 包）：

```bash
npx @navop/create-extension new --id com.example.demo --name "演示扩展"
```

仓库内（同一份实现，走 workspace）：

```bash
node scripts/create-extension.mjs --id com.example.demo --name "演示扩展" --dir extensions/composite/demo
```

两者都会复制本模板、改写 id/名称/路径、装依赖，并跑一次 `nsh check` 与 `nsh build`。
生成后：

```bash
cd extensions/composite/demo
nsh check ui
nsh test ui              # 外壳 + 全部页面测试（递归）
bash scripts/build.sh
```

## 2. 契约要点（详见 docs/extension-resource-plugins/plugin-app.md）

- **一个插件一个 nsh app、一个包**：`contributes.shellApp.entry` 指向唯一的
  `ui/dist/bundle.js`；不要再写 `shellViews`。
- **路由在 app 内**：宿主只下发一次 `host.params.route`，之后侧栏/页内跳转全在 app 里。
- **连接用 `connections[].route`**：连接打开时宿主把 `route` 与 `connection` 一起下发；
  没有连接时 `params.connection` 为 `null`，外壳只显示空态、不渲染页面。
- **`nsh.json` 的 `id` 必须等于 `extension.json` 的 `id`**（宿主按 app id 记账），
  `capabilities.host: true` 才允许 `host.call`。
- **nsh 只读入口所在目录的 `nsh.json`**：测试入口放在别处会读不到配置。
- **页面不感知外壳**：`pages/*/App.tsx` 只 `export default` 一个组件，不 `mount`。

## 3. 宿主 ABI（`apiVersion 2`）

```ts
type Params = {
  apiVersion: 2;
  extension: { id: string; title: string };
  route: string | null;
  backends: string[];               // shellApp.backends 的别名
  connection: Connection | null;    // 有连接时的启动事实
};
```

方法（见 `ui/lib/navop.ts`）：

| 封装 | 宿主调用 | 用途 |
|---|---|---|
| `params` | `host.params` | 启动事实，模块顶层同步读一次 |
| `invoke(method, payload)` | `navop.resource.invoke` | 调 provider 方法（需要连接） |
| `log(level, message)` | `navop.log` | 写宿主日志 |
| `onEvent(fn)` | `host.on("navop.event")` | 订阅 provider 推送 |

## 4. 测试口径

页面测试**打开外壳**并注入路由，零额外入口文件，同时覆盖「route → 页面」：

```ts
open("../../App.tsx", {
  width: 1200,
  height: 800,
  host: { params: { ...TEST_PARAMS, route: "home" }, handlers },
});
```

- 视口默认 390×844，带侧栏的断言要显式给 `width/height`，否则会被裁掉。
- `params.backends` 是 `shellApp.backends` 的别名（不是 runtime id）。

## 5. 加一个原生 provider（可选）

1. 在 `extension.json` 加 `runtime.ipc` 与 `permissions`（如 `spawn:./bin/demo-provider`）；
2. 加 `connections`（`runtimeId`/`resourceType`/`route`/`form`）；
3. `shellApp.backends` 指到该 runtime，`modules` 加 `resource`；
4. 用 `@navop/extension-types` 里的 wire 类型实现 provider 的 JSON-RPC；
5. 页面用 `invoke()` 取数据。

## 6. `ui/lib` 与 `@navop/extension-kit`

`ui/lib` 是 `@navop/extension-kit` 的转发层，页面只认 `../../lib/navop`、
`../../lib/theme` 这些路径：

```ts
export * from "@navop/extension-kit";
```

- 仓库内消费：根 `npm install` 走 workspace，符号链接到 `packages/extension-kit`；
- 外部消费：`ui/package.json` 里依赖 `@navop/extension-kit`（公共 npm）；
- 离线 / 内网：`bash scripts/create-extension-offline.sh --id … --name …`
  会把 kit 源码复制进 `ui/lib`，把转发改成相对导入，**不需要 npm install**；
  要把整套东西拷进内网机器，用 `bash scripts/pack-offline.sh` 打
  `artifacts/navop-extensions-offline-<version>.tar.gz`（脚本 + 模板 + kit）。

不要把这些文件在扩展里再抄一份 —— 修一处（比如 `token` 的语义色）应该所有扩展一起变。
