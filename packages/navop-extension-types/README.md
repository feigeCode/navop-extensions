# @navop/extension-types

Navop 扩展开发 TypeScript 类型工程：manifest 类型、gpui-shell UI 模块声明、provider JSON-RPC wire 类型与 JSON Schema。三类声明均从 Navop 宿主 Rust 源码（`extension-runtime` manifest 结构、`universal-plugins/shell_plugin_host` 的 `.declarations()`、`extension-protocol` serde 结构）逐字段映射。

## 结构

```
src/manifest/index.ts          # extension.json 类型（schema_version 1）
src/shell/navop.d.ts           # navop.context/resource/job/event/blob/runtime/log 模块声明
src/wire/index.ts              # provider JSON-RPC envelope / method 名 / params / result 类型
schema/extension-manifest.schema.json   # manifest JSON Schema（编辑器校验 + CLI）
vendor/gpui-kit.d.ts           # gpui-shell 生成的 UI 层声明（gpui/gpui-base/gpui-component…）
scripts/check-manifests.mjs    # 用 ajv 批量校验 extension.json
gen-gpui-typings.rs            # 重新生成 vendor/gpui-kit.d.ts 的源码（见下）
```

## 使用

### 0. Shell 视图的三种入口

`shellViews[]` 是 JS 视图的统一声明；**入口由「谁引用它」决定**，`surface` 只是语义标注（运行时不分它做分支，只影响校验与工具箱卡片的 `category`/`keywords`）：

| 视图被谁引用 | 打开方式 | 可用模块 |
|---|---|---|
| `contributes.connections[].shellViewId` | 打开该连接时加载（**连接级 JS 控制台**） | `context` + `resource`/`job`/`event`/`blob`/`runtime`/`log`；`backends` 至少一个 alias 指向该连接的 `runtimeId`（开发指南 §6.4） |
| 工作台页面 `pages[*].renderer = { kind: "shell", viewId }` | 作为该工作台页的**页体**嵌入 | **只能** `context` + `workbench` —— `ensure_embeddable` 明确禁 `resource`/`job`/`event`/`blob`/`runtime`/`dev`（job 类操作由宿主在 `dispatch` 内轮询到结束，页面不得自建轮询） |
| 没有任何引用 | **工具箱**聚合为独立工具卡片（`extension-runtime::catalog::toolbox_views`） | 自由；可与 `backends` + `resource`/`job`/`event`/`blob` 模块一起用 `navop.resource.open` 自建 provider 会话（`context.connection` 为 null），权限走 `fs:read:`/`fs:write:`/`net:tcp:`/`spawn:` → 运行时 capabilities |

- 工具箱只收「没被上面两种入口占用」的视图：被连接 `shellViewId` 或工作台页 `renderer.viewId` 引用、或声明了 `workbench` 模块的视图**一律不进**（`workbench` 模块只在挂载会话里可用，独立打开必然报 *"navop.workbench requires a borrowed resource-workbench session"*）。`surface: "tab"` 的独立工具（如 dev-tools 的 `workbench`）同样进工具箱。
- 任何声明了 `resource`/`job`/`event`/`blob`/`workbench` 模块的视图必须声明至少一个 `backends` alias（宿主校验）。
- 三种入口都需要构建开启 `shell-plugins`（当前发布产物已开启）；未开启时 JS 视图不可用，工作台页可写 `fallback: "native"` 退回原生模板渲染。

### 1. manifest 类型（Node/TS 工具链）

```ts
import type { NavopExtensionManifest } from '@navop/extension-types/manifest';

const manifest: NavopExtensionManifest = { /* ... */ };
```

编辑器实时校验：扩展目录 `.vscode/settings.json` 加

```json
{
  "json.schemas": [
    {
      "fileMatch": ["extension.json"],
      "url": "./packages/navop-extension-types/schema/extension-manifest.schema.json"
    }
  ]
}
```

### 2. shell UI（gpui-shell JS 页面）

扩展工程 `jsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "checkJs": true,
    "strict": true,
    "strictNullChecks": false,
    "noEmit": true
  },
  "include": [
    "ui/**/*.js",
    "../path/to/navop-extension-types/src/shell/*.d.ts",
    "../path/to/navop-extension-types/vendor/gpui-kit.d.ts"
  ]
}
```

`vendor/gpui-kit.d.ts` 已预生成（gpui-component rev `13c81d89`，与 navop 宿主一致），扩展工程 include 它即获得 `gpui` / `gpui-base` / `gpui-component` / `gpui-fps` / `buffer` 等模块的完整提示；本包 `src/shell/*.d.ts` 只提供 `navop.*` 模块。两者一起 include。

升级 gpui-shell 后重新生成：上游 gpui-component 仓库已内置 `examples/gen-navop-typings` crate（`gen-gpui-typings.rs` 为其独立副本，供不带该 crate 的旧 rev 使用），在 gpui-component 仓库运行

```bash
cargo run -p gen-navop-typings --release -- <本包>/vendor
```

### 3. provider wire 类型（Node/TS provider）

```ts
import type { RpcRequest, ResourceOpenParams } from '@navop/extension-types/wire';
import { Methods, ErrorCodes } from '@navop/extension-types/wire';
```

### 4. 批量校验 manifest

```bash
cd packages/navop-extension-types
npm run check   # tsc + 全仓库 extension.json schema 校验
node scripts/check-manifests.mjs 'path/to/**/extension.json'
```

## 与宿主的同步

| 本包文件 | Rust 权威来源 |
|---|---|
| `src/manifest` | `navop/crates/extension-runtime/src/extension/manifest/` |
| `src/shell/navop.d.ts` | `navop/crates/universal-plugins/src/shell_plugin_host/*.rs` 各 `.declarations()` |
| `src/wire` | `navop/crates/extension-protocol/src/*` |
| `schema/*.json` | 与 `src/manifest` 同步（含 deny_unknown_fields section 的 additionalProperties: false） |

宿主字段变化时按上表回写。shellViews/connections 两个 section Rust 侧 `deny_unknown_fields`，schema 已严格；其余宽松。
