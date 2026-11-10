# extension.json 清单参考

基准样例：`extensions/composite/docker/extension.json`（连接型 nsh 扩展）、
`templates/extension-basic/extension.json`（静态 nsh 扩展）。
serde 定义在兄弟仓库 `../navop/crates/extension-runtime/src/extension/manifest/`，
其中 shell 贡献项在 `contributes/shell.rs`。**全部结构体 `deny_unknown_fields`——多写一个未知字段，
安装期直接报错**；不要凭记忆加字段，先对照本文件与样例。

## 1. 顶层字段

```jsonc
{
  "schema_version": 1,
  "id": "com.navop.docker",                 // 扩展身份；安装目录用短名，nsh.json 必须与它一致
  "name": "Docker",
  "version": "0.1.0",
  "publisher": "Navop",
  "license": "Apache-2.0",
  "description": "中英双语、详尽；守卫测试会校验描述同步",
  "categories": ["database", "search", "developer-tools"],
  "keywords": ["docker", "container"],
  "engines": { "onetcli": ">=0.17.0", "gpui_shell": "0.6.4", "nsh": "0.3.0" },
  "api": { "extension": "1.0" },            // 可选 "shell": "1.0"
  "permissions": ["shell:exec", "spawn:./bin/docker-provider", "net:unix:/var/run/docker.sock"],
  "runtime": { "ipc": [ /* 见 §2 */ ] },
  "contributes": { /* 见 §3–§5 */ }
}
```

- **`engines.nsh` 出现 = nsh 扩展**：必须有且只有一个 `contributes.shellApp`。
- 没有原生 provider 的静态扩展（`dev-tools`、`extension-basic`）不写 `runtime`/`permissions` 里的 `spawn`。
- `api.shell` 只在清单仍带旧脚本面时需要；纯 nsh 扩展可以只写 `api.extension`。

## 2. permissions 与 runtime.ipc

```jsonc
"runtime": {
  "ipc": [{
    "id": "main",                              // shellApp.backends 的值引用它
    "entry": { "command": "./bin/docker-provider" },
    "transport": { "kind": "local_socket", "connect_timeout_ms": 5000 },
    "auto_restart": true,
    "max_restart_attempts": 3,
    "shutdown_grace_ms": 2500
  }]
}
```

- `spawn:<相对路径>` 允许拉起 provider；`net:tcp:<host>:<port>` / `net:unix:<path>` 网络出口；
  `secrets:read:self.*` 读自己的 secret。
- nsh app 读取宿主模块仍要求 `shell:exec`（硬要求，不管用不用 provider）。
- 权限按「用不到就不写」裁剪：能力不足要失败在安装期，而不是运行期。

## 3. contributes.connections —— 连接类型与表单

```jsonc
"connections": [{
  "id": "docker-local",                      // 连接贡献 id；用户建的连接实例另有记录
  "label": "Docker",
  "description": "…",
  "icon": "icons/docker-color.svg",          // 相对扩展根
  "runtimeId": "main",                       // 必须指向 runtime.ipc[].id
  "resourceType": "docker",
  "route": "containers",                     // 可选：打开连接时下发给 host.params.route
  "form": { "tabs": [{
    "id": "general", "label": "General",
    "fields": [
      { "id": "mode", "label": "Connection", "fieldType": "Select", "required": true,
        "defaultValue": "local",
        "options": [{ "value": "local", "label": "Local" }] },
      { "id": "host", "label": "Host", "fieldType": "Text", "defaultValue": "127.0.0.1" },
      { "id": "port", "label": "Port", "fieldType": "Number", "defaultValue": "2375" },
      { "id": "password", "label": "Password", "fieldType": "Password", "secret": true }
    ]
  }]}
}]
```

- `fieldType` 闭集：`Text | Number | Password | TextArea | Select | Checkbox | FilePath | Auth | Icon`。
  `Select` 必须给 `options`；`TextArea` 可给 `rows`（默认 5）；`Auth` 自带用户名/密码/钥匙串复合表单，
  不要再配 `secret: true`；`Icon` 每个连接至多一个，不能 `secret`/`defaultValue`/`options`。
- `visibleWhen` 可按字段值折叠；`{{字段ID}}` 占位符只在终端声明的 `args`/`env`/`title` 里替换，
  `command` 必须写死。
- `route` 取代旧的 `shellViewId`：宿主打开连接时把它放进 `host.params.route`；
  没声明时 `route` 为 `null`，app 回落默认路由。
- 非 terminal 连接仍要求 `runtimeId`/`resourceType`，且 app 必须声明 `resource` 模块。
- 只做工具箱的 app（无连接）不写 `connections`，清单里也不要 `route`。

## 4. contributes.shellApp —— 唯一的 nsh app

```jsonc
"shellApp": {
  "title": "Docker",                         // 缺省用 manifest.name
  "description": "Docker 容器管理：…",
  "icon": "icons/docker-color.svg",
  "entry": "ui/dist/bundle.js",              // 一个包，含所有被 import 的页面
  "category": "container",                   // 工具箱分组（无连接的 app 才进工具箱）
  "keywords": ["docker", "container"],
  "backends": { "docker": "main" },          // 别名 → runtime.ipc[].id
  "modules": ["resource"]                    // 宿主模块门控，见 §5
}
```

规则：

- **最多一个**；`engines.nsh` 存在时必须有。没有 `id`/`surface`/`singleton`——
  一个扩展只有一个 app、一个版本、一份 `ui/dist/bundle.js`。
- 入口判定：有连接 → 打开连接时按连接 tab 打开；无连接 → 工具箱卡片。
- `backends` 别名的保留字 `host` / `navop` / `default` 禁用；`host.params.backends`
  是别名的 keys（如 `["docker"]`），不是 runtime id。
- `dist/app.json` 的 `id` 必须等于扩展 id（宿主按它认 app）。
- app 工程结构：`ui/{App.tsx（结尾 mount）、nsh.json（id=扩展 id，capabilities.host）、
  tsconfig.json、lib/、pages/<route>/{App.tsx 不 mount, App.test.tsx}、dist/}`；
  页面目录里不再有 `nsh.json` / `tsconfig.json` / `dist` / `.nsh`。

## 5. modules 门控 ↔ 可用宿主模块

| module 声明 | 脚本可用的 host 模块 | 关键能力 |
| --- | --- | --- |
| `resource` | `navop.resource` | `invoke` / `ping` / `close`；ResultRef: inline \| blob \| event_stream |
| `job` | `navop.job` | 长任务 start/status/cancel/result |
| `event` | `navop.event` | 事件流 open/read/close |
| `blob` | `navop.blob` | 大结果分块 read |
| `log` | `navop.log` | 结构化日志 |
| `runtime` | `navop.runtime` | `info(backend)` → `{backend, runtimeId, generation}` |
| `dev` | `navop.dev` | dev-tools 专用；只对内置扩展开放 |

- 声明 `resource/job/event/blob` 的 app 必须至少有一个 `backends` alias（宿主校验）。
- ABI v2 已删除 `context` / `workbench` / `i18n` / `theme`：连接事实从 `host.params.connection` 读，
  语言与主题由 nsh 原生提供；旧清单写这些值会在安装期报错。
- 枚举源：`../navop/crates/extension-runtime/src/extension/manifest/contributes/shell.rs`
  （`module_specifier()` 是「清单拼写 ↔ 脚本 import 名」的唯一来源）。

## 6. nsh.json（app 元数据，不是扩展清单）

```json
{
  "name": "Docker",
  "id": "com.navop.docker",
  "version": "0.1.0",
  "build": 1,
  "capabilities": { "host": true }
}
```

- `id` 必须等于 `extension.json.id`；`capabilities.host: true` 才允许 `host.call`。
- nsh 只读**入口所在目录**的 `nsh.json`；入口在别处会读不到配置。
- 宿主切语言 / 主题会重建 app；页面不要缓存 `params` 之外的环境状态。

## 7. 构建 / 安装 / 发布

```bash
cd ui
nsh check .                       # tsc 类型检查
nsh test .                        # 外壳 + pages/* 全部页面测试
nsh build . --out dist            # 产物 dist/{app.json,bundle.js,capabilities.json}，入库

# 仓库根
node --test tests/scripts.test.mjs                              # 静态守卫（manifest/主题/双语描述/i18n/图标…）
bash scripts/install-local-composite-extensions.sh              # 构建并装到 ~/.config/navop/extensions/composite/<短id>，旧版备份 .backups/
bash scripts/package-composite-extension.sh <extension-dir>     # 打包成 R2/市场格式
```

安装位置：`~/.config/navop/extensions/composite/<短id>`（Windows 走 `%APPDATA%`）。
安装后重启 Navop，再从连接列表或工具箱打开验证。
