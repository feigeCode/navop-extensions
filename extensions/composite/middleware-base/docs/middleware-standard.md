# Navop 中间件扩展标准（middleware-standard v1）

本文件是中间件类扩展的**唯一事实源**：能力位、资源方法契约、连接表单标准与控制台 UI 注册规范。基础扩展 `com.navop.middleware`（本目录）持有标准契约 crate 与共享控制台 JS 库；实现扩展（如 `com.navop.middleware.mqtt`、`com.navop.middleware.rocketmq`）在构建期把控制台 UI 打进各自扩展包，运行期完全自包含、可独立安装。

## 1. 扩展标识

| 项 | 值 |
|---|---|
| 基础扩展 id | `com.navop.middleware`（kind `composite`，无 runtime 进程，标准+UI 库载体） |
| 实现扩展 id | `com.navop.middleware.<impl>`（如 `mqtt`、`rocketmq`，kind `composite`） |
| resource_type | `middleware`（实现扩展的 IPC runtime 暴露的资源类型，全局统一） |
| runtime id | `main`（每个实现扩展的 IPC runtime 固定 id） |
| 协议 | `extension-protocol` over local_socket（与 elasticsearch 扩展一致） |
| 契约版本 | `standard_version: 1`（capabilities 响应中携带，未来不兼容变更时递增） |

## 2. 能力位（capabilities）

能力位为 false 的方法由调用方（UI）保证不调用；实现仍需兜底返回 `Unsupported` 错误。

```json
{
  "topics": false,          // Topic 列表与详情查询
  "topic_write": false,     // Topic 创建/更新/删除
  "groups": false,          // 订阅组列表与消费详情
  "clients": false,         // 订阅组客户端查询
  "message_query": false,   // 消息查询
  "send_message": false,    // 发送消息
  "metrics": false,         // 指标快照
  "cluster_overview": false // 集群概览
}
```

## 3. 资源方法契约（resource invoke）

所有方法通过宿主 `navop.resource` 的 `invoke(resource, method, params)` 调用；方法名统一 `middleware/` 前缀，参数与响应字段统一 **snake_case**；响应为 JSON 对象（`ResourceInvokeResult` inline 或 blob，UI 侧用统一 resolve 辅助解包）。未实现的能力返回协议错误（错误文本前缀：`配置错误:`/`协议错误:`/`不支持的操作:`/`操作超时:`/`连接错误:`/`认证错误:`）。

| 方法 | 参数 | 响应 |
|---|---|---|
| `middleware/capabilities` | `{}` | `{ "standard_version": 1, "capabilities": {...} }` |
| `middleware/metrics` | `{}` | `{ "metrics": MiddlewareMetrics }` |
| `middleware/cluster/overview` | `{}` | `ClusterOverview` |
| `middleware/topic/list` | `{}` | `{ "topics": [MiddlewareTopicInfo] }` |
| `middleware/topic/detail` | `{ "topic": string }` | `TopicDetail` |
| `middleware/topic/create` | `CreateTopicRequest` | `{}` |
| `middleware/topic/update` | `CreateTopicRequest` | `{}` |
| `middleware/topic/delete` | `{ "topic": string }` | `{}` |
| `middleware/group/list` | `{}` | `{ "groups": [MiddlewareGroupInfo] }` |
| `middleware/group/detail` | `{ "group": string }` | `GroupConsumeDetail` |
| `middleware/group/clients` | `{ "group": string }` | `{ "clients": [MiddlewareClientInfo] }` |
| `middleware/message/query` | `MessageQuery`（tagged enum：`{"ByTimeWindow":{...}}`/`{"ByKey":{...}}`/`{"ById":{...}}`） | `MessagePage` |
| `middleware/message/send` | `SendMessageRequest`（body 为字节数组） | `SendResult` |

数据模型（`MiddlewareTopicInfo`/`TopicDetail`/`QueueStat`/`MiddlewareGroupInfo`/`MiddlewareClientInfo`/`GroupConsumeDetail`/`GroupQueueStat`/`MiddlewareMessage`/`MessagePage`/`BrokerInfo`/`ClusterInfo`/`ClusterOverview`/`MiddlewareMetrics`/`SendMessageRequest`/`SendResult`/`CreateTopicRequest`）的字段定义以契约 crate `middleware-contract/src/lib.rs` 为准（serde `#[serde(default)]`，向前兼容缺字段）。

## 4. 连接表单标准（contributes.connections）

- MQTT：`host`(Text,必填,默认 127.0.0.1)、`port`(Number,必填,默认 1883)、`username`(Text)、`password`(Password,secret)、`client_id`(Text,默认 `navop-mqtt-` 随机后缀由 provider 生成)、`keep_alive_secs`(Number,默认 60)
- RocketMQ：`namesrv_addrs`(Text,必填,占位 `127.0.0.1:9876;10.0.0.2:9876`，分号或 JSON 数组皆可)、`acl_enabled`(Select: none/rocketmq)、`access_key`(Text,visibleWhen acl=rocketmq)、`secret_key`(Password,secret,visibleWhen acl=rocketmq)、`timeout_ms`(Number,默认 5000)
- secret 字段（password/secret_key）必须声明 `"secret": true`，宿主经 reverse Host API 以 `secret://self/...` 引用注入。
- SSH 隧道字段由宿主连接窗口统一提供，provider 侧不感知。

## 5. 控制台 UI 注册标准（contributes.shellViews）

- 每个实现扩展声明 `shellViews: [{ id: "console", surface: "tab", entry: "ui/console.js", modules: ["context","resource","job","event","blob","runtime","log"], backends: {"resource": "main"} }]`
- 控制台四页：**概览**（指标卡片+集群拓扑，gated by `metrics`/`cluster_overview`）、**Topic**（列表+详情+新建/删除，gated by `topics`/`topic_write`）、**订阅组·客户端**（列表+消费详情+客户端，gated by `groups`/`clients`）、**消息查询**（按时间/Key/ID 查询+发送，gated by `message_query`/`send_message`）
- UI 源文件位于本基础扩展 `ui/console/`；构建期经 `scripts/sync-middleware-console.mjs` 同步进实现扩展 `ui/`，实现扩展的 `ui/console.js` 为入口薄壳（品牌定制：标题/副标题/扩展列）
- UI 技术栈：`gpui` / `gpui-base` / `gpui-component`（QuickJS 运行时，`engines.gpui_shell = "0.2.0"`）；可用组件含 `DataTable`/`DataTableState`、`pagination`、`form`、`input`、`select`、`badge`、`chart`、`description_list`、`virtual_list` 等 81 个
- 刷新防护：异步加载携带 generation 计数，过期响应丢弃（对应原 middleware_view 的 refresh_generation 语义）

### 5.1 共享控制台库 API（`ui/console/`）

同步脚本会把 `ui/console/base.js` 等库文件复制进实现扩展的 `ui/console/` 目录；实现扩展入口 `ui/console.js` 按下述薄壳契约编写：

```js
import { MiddlewareConsole } from "./console/base.js";

export default class ConsoleView extends MiddlewareConsole {
  // 品牌标识：控制台标题栏
  brand() { return { title: "MQTT", subtitle: this.context.connection?.name || "" }; }
  // 可选：Topic 列表追加实现特有列 [{key, label, width?}]（key 对应 MiddlewareTopicInfo 或 extra 字段）
  extraTopicColumns() { return []; }
  // 可选：概览页追加实现特有指标键值（MiddlewareMetrics.extras 的展示顺序提示）
  metricsExtrasOrder() { return []; }
}
```

`MiddlewareConsole` 基类职责：`init(_props, cx)` 中读取 `navop.context` 的 connection.resource.handle、调用 `middleware/capabilities` 决定页签显隐、渲染四页与导航；子类不得覆盖 `init`/`render`。

## 6. 打包与发布

- 实现扩展遵循 elasticsearch 模式：`extension.json` + `extension.build.json`（package/binary/targets/releaseTagPrefix/r2Prefix）+ `scripts/package-composite-extension.sh`
- 本地安装：`scripts/install-local-composite-extensions.sh`（先跑 console 同步脚本）
- 市场索引：`manifest.json` 由 `scripts/generate-marketplace-manifest.mjs` 生成
