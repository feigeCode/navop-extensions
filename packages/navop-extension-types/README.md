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

### 0. nsh app 的两个入口

`contributes.shellApp` 声明扩展**唯一**的 nsh app（`entry` 指向 `ui/dist/bundle.js`；最多一个，有 `engines.nsh` 就必须有）。入口由「谁打开它」决定：

| app 被谁打开 | 打开方式 | 可用模块 |
|---|---|---|
| `contributes.connections[].route` | 打开该连接时按连接 tab 打开 app，`route` 放进 `host.params.route` | `resource`/`job`/`event`/`blob`/`runtime`/`log`/`dev`；`backends` 至少一个 alias 指向该连接的 `runtimeId`（开发指南 §6.4） |
| 没有任何连接引用 | **工具箱**聚合为独立工具卡片 | 自由；可用 `backends` + `resource`/`job`/`event`/`blob` 等模块自建 provider 会话（`params.connection` 为 null） |

- app 内路由由 app 自己解释：`host.params.route` 只在打开时给一次，缺省或未知 route 由 app 回落到自己的默认路由。
- 声明了 `resource`/`job`/`event`/`blob` 模块的 app 必须声明至少一个 `backends` alias（宿主校验）；`shell:exec` 权限仍是硬要求。
- 一个扩展只有一个 tab：连接型是 `extension-connection:{connectionId}`，工具箱是 `nsh:app:{extensionId}`。

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

宿主字段变化时按上表回写。shellApp/connections 两个 section Rust 侧 `deny_unknown_fields`，schema 已严格；其余宽松。
