# @navop/extension-types

Navop 扩展开发 TypeScript 类型工程：`extension.json` 的 manifest 类型与 JSON Schema、
provider 的 JSON-RPC wire 类型。两类声明都从 Navop 宿主 Rust 源码逐字段映射
（`extension-runtime` 的 manifest 结构、`extension-protocol` 的 serde 结构）。

> 页面（nsh app）的类型不在这里：nsh 为每个 app 生成 `ui/.nsh/types`，
> 组件与宿主通道用 `@navop/extension-kit`。本包只管 manifest 与 provider wire。

## 结构

```
src/manifest/index.ts                  # extension.json 类型（schema_version 1）
src/wire/index.ts                      # provider JSON-RPC envelope / method 名 / params / result 类型
schema/extension-manifest.schema.json  # manifest JSON Schema（编辑器校验 + CI 校验）
scripts/check-manifests.mjs            # 用 ajv 批量校验仓库里的 extension.json
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

编辑器实时校验：在扩展仓库根 `.vscode/settings.json` 加

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

### 2. provider wire 类型（Node/TS provider）

```ts
import type { RpcRequest, ResourceOpenParams } from '@navop/extension-types/wire';
import { Methods, ErrorCodes } from '@navop/extension-types/wire';
```

### 3. 批量校验 manifest

```bash
cd packages/navop-extension-types
npm ci
npm run check   # tsc + 全仓库 extension.json schema 校验
node scripts/check-manifests.mjs 'path/to/**/extension.json'
```

仓库根的 `npm run lint:manifests` 就是这条校验，CI 的 `repo-checks` 会跑它。

## 与宿主的同步

| 本包文件 | Rust 权威来源 |
|---|---|
| `src/manifest` | `navop/crates/extension-runtime/src/extension/manifest/` |
| `src/wire` | `navop/crates/extension-protocol/src/*` |
| `schema/*.json` | 与 `src/manifest` 同步（`deny_unknown_fields` 的 section 用 `additionalProperties: false`） |

宿主字段变化时按上表回写。`shellApp` / `connections` 两个 section Rust 侧 `deny_unknown_fields`，
schema 已严格：连接分「普通连接（runtimeId + resourceType + 可选 route）」与
「终端型连接（terminal，不允许 runtimeId/resourceType/route）」两支。
