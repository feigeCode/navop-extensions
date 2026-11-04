# extension.json 清单参考

以 `extensions/composite/elasticsearch/extension.json`（nsh 扩展）为基准。serde 侧定义在兄弟仓库 `../navop/crates/extension-runtime/src/extension/manifest/`，shell 贡献项在 `contributes/shell.rs`（`deny_unknown_fields`——多写未知字段安装期直接报错）。契约全文见 `docs/extension-resource-plugins/plugin-app.md`。

## 1. 顶层字段

```jsonc
{
  "schema_version": 1,
  "kind": "composite",                        // composite | language | wasm | ...
  "id": "com.navop.elasticsearch",            // 扩展 id，市场与安装目录名（安装目录用短名）
  "name": "Elasticsearch 9",
  "version": "0.1.0",
  "publisher": "Navop",
  "license": "Apache-2.0",
  "description": "中英双语、详尽；守卫测试强制双语描述同步",
  "categories": ["database", "search", "developer-tools"],
  "keywords": ["elasticsearch", "..."],
  "engines": { "onetcli": ">=0.15.2", "gpui_shell": "0.6.4", "nsh": "0.3.0" },
  "api": { "extension": "1.0", "shell": "1.0" },
  "permissions": [...],                        // 见 §2
  "runtime": { ... },                          // 见 §3
  "contributes": { ... }                       // 见 §4-§7
}
```

`engines.nsh` 出现 = nsh 扩展：必须有 `contributes.shellApp`，且只能有一个。

## 2. permissions

示例：`["shell:exec", "spawn:./bin/elasticsearch-provider", "net:tcp:*:9200", "secrets:read:self.*"]`

- `spawn:<相对路径>` 允许拉起 provider 子进程；`net:tcp:<host>:<port>` 网络出口；`secrets:read:self.*` 读自己的 secret。
- 能力按清单裁剪：声明面必须与实现面对齐，失败要发生在「安装」而不是「使用」。
- nsh app 读取宿主模块仍要求 `shell:exec`（硬要求）。

## 3. runtime.ipc —— provider 进程

```jsonc
"runtime": {
  "ipc": [{
    "id": "main",                          // shellApp.backends 的值引用它
    "entry": { "command": "./bin/elasticsearch-provider" },
    "transport": { "kind": "local_socket", "connect_timeout_ms": 5000 },
    "auto_restart": true,
    "max_restart_attempts": 3,
    "shutdown_grace_ms": 2500
  }]
}
```

## 4. contributes.connections —— 连接类型与表单

```jsonc
"connections": [{
  "id": "elasticsearch9",                  // 连接贡献 id（用户建的连接实例另有一份记录）
  "label": "Elasticsearch 9", "description": "...",
  "runtimeId": "main",                     // 必须指向 runtime.ipc[].id
  "resourceType": "elasticsearch",
  "icon": "icons/elasticsearch-color.svg",
  "route": "mapping",                      // app 内路由：可选、非空字符串，app 自己解释
  "form": { "tabs": [{
      "id": "general", "label": "常规",
      "fields": [
        { "id": "host", "label": "主机", "fieldType": "Text", "required": true,
          "defaultValue": "127.0.0.1", "placeholder": "es.example.com" },
        { "id": "port", "fieldType": "Number", "required": true, "defaultValue": "9200" },
        { "id": "password", "fieldType": "Password", "secret": true }
      ]},
      { "id": "session", "label": "会话", "fields": [...] }
  ]}
}]
```

- `fieldType`：`Text | Number | Checkbox | Password`（按现有 manifest 取并集）。字段值经 BindingContext.connection 传给 provider（宿主注入，天然不含明文密码）。
- `route` 取代旧的 `shellViewId`：连接打开时宿主把它放进 `host.params.route`；缺省时 `route` 为 `null`，由 app 回落默认路由。
- 非 terminal 连接仍要求 `runtimeId`/`resourceType`，且对应 app 必须声明 `resource` 模块。

## 5. contributes.resourceWorkbenches —— 旧工作台（已由 app 内路由取代）

新扩展不要再声明 `resourceWorkbenches`，也不要用 `pages[].renderer = { kind: "shell", viewId }`：页面改为 app 内的普通 TSX 组件，由 `shellApp.entry` 这一个包承载，导航由 app 自己的 `App.tsx` 解释。仍保留该 section 的旧扩展在迁移时应删掉它，并把页面搬进 `ui/pages/<page>/`。

## 6. contributes.shellApp —— 唯一的 nsh app

```jsonc
"shellApp": {
  "title": "Elasticsearch 9",              // 缺省用 manifest.name
  "description": "索引的字段定义表：...",
  "icon": "icons/elasticsearch-color.svg",
  "entry": "ui/dist/bundle.js",            // 一个包，含所有被 import 的页面
  "category": "database",
  "keywords": ["elasticsearch", "mapping"],
  "backends": { "resource": "main" },      // 别名 → runtime.ipc[].id
  "modules": ["resource"]                  // 宿主模块门控 —— 见 §7
}
```

规则：

- 最多一个；有 `engines.nsh` 就必须有。没有 `id`/`surface`/`singleton`——一个扩展只有一个 app、一个版本、一份 `ui/dist/bundle.js`。
- 入口判定：「有连接 → 打开连接时按连接 tab 打开；无连接 → 工具箱卡片」。不再有 toolbox 卡片页。
- `backends` 别名保留字 `host`/`navop`/`default` 禁用；`host.params.backends` 是它的别名 keys（如 `["resource"]`），不是 runtime id。
- `dist/app.json` 的 `id` 必须等于扩展 id（宿主按它认 app）。
- app 工程结构：`ui/{App.tsx（结尾 mount）, nsh.json（id=扩展 id，capabilities.host）, tsconfig.json（extends ./.nsh/tsconfig.json）, lib/, pages/<page>/{App.tsx 不 mount, App.test.tsx}, dist/}`；页面目录里不再有 `nsh.json`/`tsconfig.json`/`dist`/`.nsh`。

## 7. modules 门控 ↔ 可用宿主模块

| module 声明 | host 模块 | 关键导出 |
|---|---|---|
| `resource` | `navop.resource` | `open(backend, resourceType, config)` / `invoke(handle, method, params)` / `ping` / `close` —— ResultRef: inline \| blob \| event_stream |
| `job` | `navop.job` | `start(resource, method, params)` / `status(handle)` / `cancel` / `result` / `close` |
| `event` | `navop.event` | `open(resource, kind, capacity?)` / `read(handle, maxEvents?, waitMs?)` / `close` |
| `blob` | `navop.blob` | `read(handle, maxBytes?)` → `{ data, bytesRead, done }` / `close` |
| `log` | `navop.log` | `debug/info/warn/error(message)` —— 进扩展结构化日志 |
| `runtime` | `navop.runtime` | `info(backend)` → `{ backend, runtimeId, generation }` |
| `dev` | `navop.dev` | `list/open/reload/watch/remove/logs/pickDirectory/pickResult/openApp` —— dev-tools 专用；`openApp(extensionId, route?)` 打开工程的唯一 app |

- 声明了 `resource`/`job`/`event`/`blob` 模块的 app 必须声明至少一个 `backends` alias（宿主校验）。
- 旧枚举里的 `context`、`workbench` 已删除：连接事实改从 `host.params.connection` 读，工作台页改由 app 内路由承担。
- `ShellHostModule` 枚举源：`../navop/crates/extension-runtime/src/extension/manifest/contributes/shell.rs`（`module_specifier()` 是「声明面拼写 ↔ 脚本 import 名字」的唯一来源）。

## 8. 构建 / 安装 / 发布

```bash
# nsh app（每个扩展的 ui/）
cd ui && nsh build . --out dist      # 产物 dist/{app.json,bundle.js,capabilities.json}
nsh test pages/<page>                # 逐页 headless 测试
nsh check .                          # tsc 类型检查

# 本机构建+安装（旧版本自动备份到 .backups/）
bash scripts/install-local-composite-extensions.sh
# 打包（R2/市场格式）
bash scripts/package-composite-extension.sh <extension-dir>
# 静态守卫（双语描述、i18n key、主题 token、图标路径、市场 id 一致性...）
node --test tests/scripts.test.mjs
```

安装位置：`~/.config/navop/extensions/composite/<短id>`（Windows 走 APPDATA）。
