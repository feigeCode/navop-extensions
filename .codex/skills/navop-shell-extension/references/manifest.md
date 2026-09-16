# extension.json 清单参考

以 `extensions/composite/mqtt/extension.json`（521 行，最完整的现役样本）为基准。serde 侧定义在兄弟仓库 `../navop/crates/extension-runtime/src/extension/manifest/`，shell 贡献项在 `contributes/shell.rs`（`deny_unknown_fields`——多写未知字段安装期直接报错）。

## 1. 顶层字段

```jsonc
{
  "schema_version": 1,
  "kind": "composite",                        // composite | language | wasm | ...
  "id": "com.navop.middleware.mqtt",          // 复合扩展 id，市场与安装目录名（安装目录用短名 mqtt）
  "name": "MQTT",
  "version": "0.2.0",
  "publisher": "Navop",
  "license": "Apache-2.0",
  "description": "中英双语、详尽；守卫测试强制双语描述同步",
  "categories": ["middleware", "messaging", "developer-tools"],
  "keywords": ["mqtt", "..."],
  "engines": { "onetcli": ">=0.17.0", "gpui_shell": "0.2.0" },
  "api": { "extension": "1.0", "shell": "1.0" },
  "permissions": [...],                        // 见 §2
  "runtime": { ... },                          // 见 §3
  "contributes": { ... }                       // 见 §4-§7
}
```

## 2. permissions

示例：`["shell:exec", "spawn:./bin/mqtt-provider", "net:tcp:*:1883", "net:tcp:*:8883", "secrets:read:self.*"]`

- `spawn:<相对路径>` 允许拉起 provider 子进程；`net:tcp:<host>:<port>` 网络出口；`secrets:read:self.*` 读自己的 secret。
- 能力按清单裁剪：声明面必须与实现面对齐，失败要发生在「安装」而不是「使用」。

## 3. runtime.ipc —— provider 进程

```jsonc
"runtime": {
  "ipc": [{
    "id": "main",                          // shellViews[].backends / workbench.runtimeId 引用它
    "entry": { "command": "./bin/mqtt-provider" },
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
  "id": "mqtt",                            // 页面 context.connection 引用
  "label": "MQTT", "description": "...",
  "runtimeId": "main",
  "resourceType": "middleware",
  "icon": "icons/xxx.svg",
  "form": { "tabs": [{
      "id": "general", "label": "常规",
      "fields": [
        { "id": "host", "label": "主机", "fieldType": "Text", "required": true,
          "defaultValue": "127.0.0.1", "placeholder": "broker.example.com" },
        { "id": "port", "fieldType": "Number", "required": true, "defaultValue": "1883" },
        { "id": "use_tls", "fieldType": "Checkbox", "defaultValue": "false" },
        { "id": "password", "fieldType": "Password", "secret": true }
      ]},
      { "id": "session", "label": "会话", "fields": [...] }
  ]}
}]
```

`fieldType`：`Text | Number | Checkbox | Password`（按现有 manifest 取并集）。字段值最终经 BindingContext.connection 传给 provider（宿主注入，天然不含明文密码）。

## 5. contributes.resourceWorkbenches —— 工作台

```jsonc
"resourceWorkbenches": [{
  "schemaVersion": 3,
  "id": "mqtt",
  "title": "MQTT",
  "connectionIds": ["mqtt"],
  "runtimeId": "main",
  "resourceType": "middleware",
  "defaultPage": "messages",
  "operations": { /* §5.1 */ },
  "pages": [ /* §5.2 */ ]
}]
```

### 5.1 operations

```jsonc
"subscribe": {
  "mode": "invoke",                        // invoke（请求-响应）| job（长任务，配 navop.job）
  "method": "middleware/topic/create",     // provider 方法 URI
  "requires": ["middleware/topic/create"], // capabilities 校验按它逐个核对 —— 必须回填 method
  "effect": "write",                       // read | write | destructive（写/破坏需 confirmed）
  "params": {
    "topic": { "source": "input", "path": "/topic", "type": "string" },   // JS dispatch 的 input.<param>
    "group": { "source": "literal", "path": "/group", "type": "string", "value": "local" }
    // "source": "connection" 也可用 —— 从连接表单取值
  }
}
```

- params 的 `source` 三种：`input`（JS 传入）/ `literal`（写死）/ `connection`（连接上下文）。
- `type`：`string | number | json`。
- 校验点：声明 `requires` 为空或漏 method → 运行期才报 capability 错（声明偏松，别这么写）。

### 5.2 pages

```jsonc
"pages": [
  { "id": "overview", "title": "概览",
    "renderer": { "kind": "shell", "viewId": "overview", "fallback": "native" },
    "load": { "operation": "metrics" },
    "stack": [{ "kind": "viewer", "format": "json" }] },

  { "id": "subscriptions", "title": "订阅",
    "renderer": { "kind": "shell", "viewId": "subscriptions", "fallback": "native" },
    "load": { "operation": "listTopics" },
    "stack": [{ "kind": "table", "itemsPath": "/topics", "keyPaths": ["/name"],
                "pagination": { "kind": "none" },
                "columns": [{ "id": "name", "title": "Topic Filter", "path": "/name", "type": "string" },
                            { "id": "qos", "title": "QoS", "path": "/queue_count", "type": "display" }] }] },

  { "id": "live", "title": "实时消息",
    "renderer": { "kind": "native" },
    "load": { "operation": "messageStream" },
    "stack": [{ "kind": "stream" }] }
]
```

规则：

- `renderer.kind`: `"shell"`（viewId 指向 shellViews 里的视图，即 ui/<viewId>.js）| `"native"`（宿主按 stack 原生渲染）。`fallback: "native"` 允许 shell 页面挂掉时退回原生。
- **一个 page 只允许一个 stack 原语**（viewer/table/stream；多原语安装期被拒）。
- `stack.kind: "stream"` 的页面 `load` 必须返回 EventStream（provider 流身份由宿主记账登记）；shell 页面拿不到流 ⇒ 实时数据在 JS 里轮询。
- table 只有行级 `actions`，**没有页面级 toolbar** —— 工具入口放自定义 shell 页或导航页。

## 6. contributes.shellViews —— 脚本视图

```jsonc
"shellViews": [{
  "id": "overview",                        // pages[].renderer.viewId 或独立入口引用它
  "title": "MQTT 连接概览",
  "description": "...",
  "entry": "ui/overview.js",               // 相对扩展根；default export View 子类
  "surface": "tab",                        // 呈现面
  "singleton": false,
  "backends": { "resource": "main" },      // 别名 → runtime.ipc 的 ipc id（navop.resource.open 的 backend 参数）
  "modules": ["context", "workbench"]      // 宿主模块门控 —— 见 §7
}]
```

归属判定（`extension-runtime/src/catalog.rs toolbox_views`）：被 `connections[].shellViewId` 或工作台 `pages[].renderer.viewId` 引用的视图不进工具箱；声明了 `workbench` 模块的视图也不进（独立打开时 `navop.workbench` 必然报 "requires a borrowed resource-workbench session"）。

## 7. modules 门控 ↔ 可用宿主模块

| module 声明 | host 模块 | 关键导出 |
|---|---|---|
| `context` | `navop.context` | `current()` → `{ extensionId, viewId, backends, connection: { id, name, contributionId, resourceType, resource: { handle, capabilities, metadata } } \| null }` |
| `workbench` | `navop.workbench` | `current()`（含 route/selection/paging/connection 的 page context）、`dispatch(operationId, input?, { confirmed? })` —— 仅命名操作，工作台挂载会话限定 |
| `resource` | `navop.resource` | `open(backend, resourceType, config)` / `invoke(handle, method, params)` / `ping` / `close` —— ResultRef: inline \| blob \| event_stream |
| `job` | `navop.job` | `start(resource, method, params)` / `status(handle)` / `cancel` / `result` / `close` |
| `event` | `navop.event` | `open(resource, kind, capacity?)` / `read(handle, maxEvents?, waitMs?)` / `close` —— **独立 shell 视图可用；嵌入式工作台页面不可用**（CustomPageHost 契约） |
| `blob` | `navop.blob` | `read(handle, maxBytes?)` → `{ data, bytesRead, done }` / `close` |
| `log` | `navop.log` | `debug/info/warn/error(message)` —— 进扩展结构化日志（`navop.log` 用法见 dev-tools workbench.js） |
| `runtime` | `navop.runtime` | `info(backend)` → `{ backend, runtimeId, generation }` |
| `dev` | `navop.dev` | `list/open/reload/watch/remove/logs/pickDirectory/pickResult/openView` —— dev-tools 专用 |

`ShellHostModule` 枚举源：`../navop/crates/extension-runtime/src/extension/manifest/contributes/shell.rs`；模块实现：`../navop/crates/universal-plugins/src/shell_plugin_host/{context,workbench,resource,job,event,blob,log,runtime,dev}.rs`（declarations 即 TS 签名，以它为准）。

## 8. 构建 / 安装 / 发布

```bash
# 本机构建+安装（旧版本自动备份到 .backups/）
bash scripts/install-local-composite-extensions.sh
# 打包（R2/市场格式）
bash scripts/package-composite-extension.sh <extension-dir>
# 静态守卫（141 项：双语描述、i18n key、主题 token、图标路径、市场 id 一致性...）
node --test tests/scripts.test.mjs
```

安装位置：`~/.config/navop/extensions/composite/<短id>`（Windows 走 APPDATA）。
