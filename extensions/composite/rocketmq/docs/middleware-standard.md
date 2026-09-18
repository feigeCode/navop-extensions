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

能力位为 false 的方法由调用方（UI）保证不调用；实现仍需兜底返回 `Unsupported` 错误。新增能力位必须带 `#[serde(default)]`，缺字段按 false 处理（旧 provider 响应不会被新代码解析失败）。

```json
{
  "topics": false,          // Topic 列表与详情查询
  "topic_write": false,     // Topic 创建/更新/删除
  "groups": false,          // 订阅组列表与消费详情
  "clients": false,         // 订阅组客户端查询
  "message_query": false,   // 消息查询
  "send_message": false,    // 发送消息
  "metrics": false,         // 指标快照
  "cluster_overview": false,// 集群概览
  "message_stream": false   // 实时消息事件流（见 §3、§5.2）
}
```

`message_stream = true` 的实现扩展**必须**在资源 metadata 中给出 `message_stream_kind`（值的语义见 §5.2）。当前：MQTT `true`（kind `mqtt/message/events`）、RocketMQ `false`（未实现实时流，且 open 的能力清单里也不声明该方法）。

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
| `middleware/message/stream` | `{}` | 事件流引用 `ResultRef::EventStream { id }`（见 §5.2） |

数据模型（`MiddlewareTopicInfo`/`TopicDetail`/`QueueStat`/`MiddlewareGroupInfo`/`MiddlewareClientInfo`/`GroupConsumeDetail`/`GroupQueueStat`/`MiddlewareMessage`/`MessagePage`/`BrokerInfo`/`ClusterInfo`/`ClusterOverview`/`MiddlewareMetrics`/`SendMessageRequest`/`SendResult`/`CreateTopicRequest`）的字段定义以本扩展 `src/middleware_contract.rs`（serde `#[serde(default)]`，向前兼容缺字段）。

### 3.1 事件流方法（`middleware/message/stream`）

同一份订阅语义有两条入口，必须共用实现（校验 kind、唯一连接约束、流数量上限完全一致）：

| 入口 | 通道 | 用途 |
|---|---|---|
| `navop.event.open(kind)` / `read` / `close` | 宿主 event 通道（长轮询） | JS 壳层视图订阅实时消息 |
| `middleware/message/stream` | `resource/invoke` → 返回 `ResultRef::EventStream` | 原生工作台 `events` 模板页的声明式订阅（页面 `load` 操作必须返回事件流引用） |

- 事件**不带资源标识**：`EventOpenParams.conn_id` 必须为 `None`，消息源由「当前唯一打开的连接」定位；多连接返回 `RESOURCE_BUSY`，无连接返回 `RESOURCE_CLOSED`。
- 每条事件是标准消息模型 `MiddlewareMessage` 的 JSON：`message_id` 为流内单调序号（如 `mqtt-live-<seq>`），`body` 省略（避免大消息体撑爆事件批），`body_text` 给出 UTF-8 文本；需要原始字节时用 `middleware/message/query` 查缓冲。
- `Unsupported` 兜底：未实现该方法的实现扩展（如 RocketMQ）必须在 open 的能力清单里**不声明** `middleware/message/stream`，并让 invoke 返回 `Unsupported`。

### 3.2 字段复用约定（跨实现共享）

标准模型没有 MQTT/RocketMQ 专属字段，协议语义一律在既有字段上表达；下表为**跨实现约定**，新增实现须遵守、改动须双副本同步：

| 语义 | 承载位置 | 取值 |
|---|---|---|
| 「已订阅 topic」列表 | `middleware/topic/list`，`MiddlewareTopicInfo.topic_type = "SUBSCRIPTION"` | MQTT 的订阅列表即 Topic 列表 |
| 订阅 QoS | `CreateTopicRequest.queue_count`（= `MiddlewareTopicInfo.queue_count`） | `0` / `1` / `2` |
| 发布 QoS、保留消息 | `SendMessageRequest.properties`：`qos` / `retain` | `"0"`/`"1"`/`"2"`、`"true"`/`"false"`（缺省 QoS 1、不保留） |
| 消息 QoS / 保留标记 / 接收时间 | `MiddlewareMessage.properties`：`qos` / `retain` / `received_at_ms` | `qos` 为可读文案（`QoS 1`）、`retain` 为 `"true"`/`"false"`、`received_at_ms` 为 Unix 毫秒 |
| 消息时间列 | `MiddlewareMessage.store_time` | `YYYY-MM-DD HH:MM:SS` 本地时间；实时事件同样带 `store_time` |

工作台的事件行渲染按上表取值：`properties.qos` → QoS 徽章、`properties.retain = "true"` → Retain 徽章、`store_time`（回落 `born_time` → `properties.received_at_ms`）→ 时间列，其余 `properties` 原样列在行末。

## 4. 连接表单标准（contributes.connections）

- MQTT：`host`(Text,必填,默认 127.0.0.1)、`port`(Number,必填,默认 1883)、`username`(Text)、`password`(Password,secret)、`client_id`(Text,默认 `navop-mqtt-` 随机后缀由 provider 生成)、`keep_alive_secs`(Number,默认 60)
- RocketMQ：`namesrv_addrs`(Text,必填,占位 `127.0.0.1:9876;10.0.0.2:9876`，分号或 JSON 数组皆可)、`acl_enabled`(Select: none/rocketmq)、`access_key`(Text,visibleWhen acl=rocketmq)、`secret_key`(Password,secret,visibleWhen acl=rocketmq)、`timeout_ms`(Number,默认 5000)
- secret 字段（password/secret_key）必须声明 `"secret": true`，宿主经 reverse Host API 以 `secret://self/...` 引用注入。
- SSH 隧道字段由宿主连接窗口统一提供，provider 侧不感知。

## 5. UI 注册标准（contributes.resourceWorkbenches + contributes.shellViews）

所有扩展连接在存储里都是 `ConnectionType::Extension`（旧内置 MQTT 连接会在打开时经 `try_migrate_legacy_middleware_connection` 就地迁移）。

**打开路径（`shell-plugins` 自本次发布起随官方产物提供）**：

| 扩展连接 | 打开决策 |
|---|---|
| **声明了 `resourceWorkbenches`** | `ExtensionOpenStrategy` / `MiddlewareExtensionOpenStrategy` 先查 `resource_workbench_for_connection(...)`，命中即 `open_native_extension_connection`。**这与构建无关**——工作台优先是打开策略里的硬逻辑，工作台与 `shellViews.console` 同时声明时后者永远不执行。 |
| **未声明工作台、连接声明了 `shellViewId`** | 回落到 `host.open_connection(ConnectionShellOpen)`，加载 `shellViews` 里那个 JS 视图（连接级 JSON 控制台）。**这就是纯 JS 扩展写连接 UI 的唯一途径**：不需要 Rust provider，也不需要声明工作台。 |
| 未声明工作台、也没有 `shellViewId` | 只推一条通知（旧构建文案为 *"This extension connection requires the shell-plugins build"*）。 |

`shell-plugins` 关闭时（`--no-default-features` 且未补该 feature），`universal-plugins` 的 `shell_plugin_host` / `shell_page_host` / `shell_plugin_tab` 整块不编译，`ShellPluginHost` / `ConnectionShellOpen` / `open_connection` 不存在 ⇒ 连接级 JS 控制台与嵌入式 shell 页都不可用。本扩展不依赖这条假设：**MQTT/RocketMQ 的工作台在任何构建下都能打开**。

**两条路由怎么选**（中间件实现扩展的既定选择是「工作台」，不要反向替换）：

| | 工作台（`resourceWorkbenches`，`template` + `renderer.kind: native`） | 连接级 JS 控制台（`connections[].shellViewId` + `shellViews`） |
|---|---|---|
| 前提 | 需要 Rust provider 与资源协议（`resource/open` + `middleware/*` 方法） | 纯 JS 即可，也可走 `navop.resource.open` 自建 provider 会话 |
| UI 能力 | 宿主模板集合（`json`/`collection`/`detail`/`query`/`events`/`tasks`/`terminal`），组件受限但主题、虚拟滚动、事件流等由宿主统一实现 | 任意 `gpui-shell` 视图（gpui / gpui-base / gpui-component 全量组件），完全自定义布局 |
| 事件流 | `events` 模板页，`load` 返回 `ResultRef::EventStream`（§3.1、§5.2） | `navop.event.open/read/close` 长轮询，同一套 provider 流实现 |
| 连接上下文 | 无「连接对象」概念，只有工作台会话与命名操作 | `navop.context` 注入 mount-scoped opaque resource handle；视图不得自行 `resource/open` 主连接 |
| 适用 | 中间件四类（mqtt/rocketmq/elasticsearch/docker）等有 provider 的重型连接 | 纯 JS 小工具、无需 provider 的自定义连接 UI |

- 原 `MiddlewareConsole`（`ui/console/base.js` + 实现扩展的 `ui/console.js` 薄壳）承载的四页能力已**提升为标准契约**，见 §5.3；MQTT/RocketMQ 已声明工作台，故不再保留这两个文件（它们的 `shellViewId` 与 `shellViews.console` 已移除）。新增**纯 JS** 实现若要照抄该四页，按 §5.3 的字段契约实现即可，不必复活共享库。
- **硬约束**：`renderer.kind = "shell"` 的**工作台页**若未声明 `fallback: "native"`，在未开 `shell-plugins` 的构建里会渲染错误块 *"Shell renderer is unavailable in this build"*（`resource_view::mount_shell_page` 取不到 host）；写了 `fallback` 才会退回该页 `stack` 里的原生原语。**实现扩展的嵌入式 shell 页现已全部声明 `fallback: "native"`**（MQTT 的概览/订阅退化为 metrics/collection 表；RocketMQ 的三个 shell 页退化为 `clusterOverview`/`listTopics` 的 JSON 视图）⇒ 未开 `shell-plugins` 的构建里页面仍可打开，只是外观退化。
- **不要用 `surface` 之外的规则判断「独立工具」**：工具箱（`catalog::toolbox_views`）列出的是**没有被任何入口占用**的 shell 视图 —— 排除「连接 `shellViewId` 引用」「工作台页面 `renderer.viewId` 引用」「声明了 `workbench` 模块」三类。工作台页体只声明 `context` + `workbench`，独立打开时宿主必然报 *"navop.workbench requires a borrowed resource-workbench session"*，**不得把它当成独立工具暴露**。

### 5.1 工作台声明约定

- 每个实现扩展声明一个工作台：`resourceWorkbenches: [{ id: "<impl>", connectionIds: ["<impl>"], runtimeId: "main", resourceType: "middleware", defaultPage: "<pageId>", operations: {...}, navigation: [...], pages: [...] }]`
- `operations[*]` 是「工作台操作」到资源方法的映射：`{ mode: "invoke"|"job", method, requires: [能力位同名方法], effect: "read"|"write"|"destructive", params }`；`requires` 会在派发前与 open 时 provider 声明的能力清单逐个校验（缺一个就不派发）。
- `params` 的取值来源：`input`（页面输入，走 `inputs[*].id`，支持覆盖路径如 `/properties`）、`route`、`selection`（表格行）、`literal`；`type` 支持 `string`/`number`/`json`。
- 页面模板（`pages[*].template`）：`json`（键值/JSON 视图）、`collection`（表格 + 行操作 + 分页）、`detail`、`query`（输入表单 + 执行）、`stream`（原语 `{"kind": "stream"}`，实时事件流，见 §5.2）、`tasks`、`terminal`。`renderer.kind = "native"` 用宿主渲染，`"shell"` 挂 QuickJS 视图（`viewId` 对应 `shellViews[*].id`），可配 `fallback: "native"`。
- 页面 tab 组：同一组的每个页面都声明**完整** `tabs` 列表（`{id, title, pageId, route}`），宿主按 `pageId == 当前页` 判定高亮。MQTT 的发布/订阅四页共用一组：Topics / Subscribe / Live Messages / Send Message。
- 参考实现（RocketMQ，v0.2 起为客户端式工作台：三个 `shell` 页 + 八个原生页 + `list` 导航）：
  1. 概览 `ui/overview.js`（`metrics` + `clusterOverview` 并发拉取，5s 自动刷新；指标卡片 + 集群/Broker 拓扑表；带 `fallback: "native"`，退化为 `clusterOverview` 的 JSON 视图）。
  2. 主题 `topics`（原生 `table`：Topic/类型/队列数/权限/消息量，行点击进详情、行内 Delete）+ `topic-detail`（原生 `table`：broker/queue_id/min_offset/max_offset/last_update，links = 全部主题 / 重置消费位点）+ `create-topic` / `update-topic`（原生表单：topic / queue_count / perm 三字段）。provider 侧 CREATE 与 UPDATE 是同一个 Remoting 请求码（`UPDATE_AND_CREATE_TOPIC`），即 upsert 语义，所以两个页只是入口语义不同。
  3. 订阅组 `groups`（原生 `table`：订阅组/在线客户端/消费类型/消息模型/TPS/堆积量/版本，行点击进详情）+ `group-detail`（原生 `table`：topic/broker/queue_id/broker_offset/consumer_offset/diff）+ `group-clients`（原生 `table`：客户端 ID/地址/语言/版本/订阅 Topic，走 `middleware/group/clients`；该能力位 RocketMQ 一直是 `true`）。
  4. 消息查询 `ui/messages.js`：模式选择（时间窗口 / Message Key / Message ID）+ 条件表单 + 结果列表 + 行内详情。三种模式各自绑定到一个工作台操作（`queryByTimeWindow` / `queryByKey` / `queryById`）—— 操作的 `params` 是静态映射，没法在运行期按输入切换 `MessageQuery` 的 tagged 变体。时间窗口支持预设跨度与自定义区间（`YYYY-MM-DD HH:mm` 或 Unix 毫秒，非法输入**就地拦截、不派发请求**），页大小 10/20/50，翻页按 `MessagePage.has_more` 控制。**进入页面不自动查询**（§5.3）。
  5. 发送 `ui/send-message.js`：Topic 输入 + 已有 Topic 下拉（`listTopics`，拉不到时静默降级为纯输入）+ Tag/Key + 消息体 + 发送历史回填。`effect: "write"` 的确认交给宿主的 `dispatch(..., { confirmed: true })`，页面不再自己做二次点击确认（旧版要求点两次才发出）。
  6. 重置消费位点 `reset-offset`（原生表单：group/topic/timestamp，`rocketmq/consumer/reset-offset`）。
  能力位九项全开，标准 §3 除实时流（§3.1）之外的 13 个方法全部在工作台里有对应入口。**宿主 `table` 原语的行 `open`/`actions` 与页头 `links` 已足够表达市面客户端的导航**，所以左栏是扁平 `list`（概览/主题/订阅组/消息查询/发送消息），创建/更新/重置这类"表单页"挂在上游列表页或详情页的 `links` 上，不再堆进左栏。
- **已知实现缺口**：
  1. 消息轨迹（Trace）、向指定消费组重投消息、消费组增删改、Broker 运行状态（CPU/内存/磁盘）需要 provider 侧新增 Remoting 命令，本轮未做。
  2. `MessagePage.total` 在时间窗口模式下是**本页返回条数**，不是全量总数（RocketMQ 的时间范围查询不返回总数）；`has_more` 也偏宽松（本页非空即为真）⇒ 界面用"本页 N 条"，并在空页时禁用「下一页」。
  3. 重置消费位点的 `timestamp` 非法字符串在 provider 侧会被当作"缺省 ⇒ 当前时刻"（`server/resource.rs` 的解析分支）。工作台表单已就地拦截非法输入，但直接调用 `rocketmq/consumer/reset-offset` 仍可能静默重置到最新位点 —— 建议后续把解析失败改成 `配置错误:` 返回。

### 5.2 「实时消息」页约定（页面原语 `{"kind": "stream"}`）

声明写法（现行 schema；早前本文档写的 `template: "events"` 是同一件事的旧词汇）：

```json
{ "id": "live", "title": "实时消息", "renderer": { "kind": "native" },
  "load": { "operation": "messageStream" }, "stack": [{ "kind": "stream" }] }
```

三条**运行期**前置条件，缺一条就一个事件也看不到（宿主 `resource_view`）：

1. `renderer.kind` 必须是 `native` —— `render_page` 先判 shell renderer 并直接接管页面，只有非 shell 才会走到 `has_stream` → `render_events_page`；写成 shell 页时 stream 原语被静默忽略。
2. `load.operation` 的 `effect` 必须是 `read` —— 宿主以 `confirmed=false` 派发（`dispatch_invoke_result_scoped`），非 read 会被 `guard_effect` 直接拒成 `ConfirmationRequired`。
3. 该操作的 `requires` 必须含它自己的 `method`（`middleware/message/stream`）—— `ensure_capabilities` 按 open 返回的能力清单逐个校验，未声明该方法的实现扩展（RocketMQ）就此被挡在门外。

- 页面 `load.operation` 指向的**必须是**返回事件流引用的操作（`middleware/message/stream` → `ResultRef::EventStream`）。宿主拿到引用后走 `subscribe_events` 长轮询，把批次追加进页面事件列表；非事件流的返回值会直接进错误态（"events operation did not return an event stream"）。
- 事件流的 kind 由**资源 metadata** 的 `message_stream_kind` 给出（协议层不定义 kind 常量）：MQTT 为 `mqtt/message/events`。
- 页头保留 Clear/Stop 与 dropped/closed 徽章语义；`Stop` 取消长轮询并停止追加。
- 行渲染：事件能按标准消息模型解析（有 `topic`）时渲染成「topic + QoS/Retain 徽章 + 时间 + 单行截断的消息体」；否则回落原始 JSON 行 —— 保证 `events` 模板对非消息类事件通用。
- 消费方（UI）不得假设事件一定带 `body`（实时事件省略原始字节），要完整载荷用 `middleware/message/query` 查缓冲。

### 5.3 控制台四页能力契约（承载方式：原生工作台页 或 纯 JS 控制台）

本节是**四页能力契约**，与承载方式无关：既约束原生工作台页面（`native` 模板，MQTT/RocketMQ 现状），也约束按 §5 第二条路由编写的纯 JS 连接控制台。原 `MiddlewareConsole`（`ui/console/base.js` + 实现扩展的 `ui/console.js` 薄壳）即后者的参考实现，其能力已全部提升为本节契约。

**通用约定（四页共用）**

- 能力门控：页签与每个 section 都按 open 时返回的能力清单显隐（§2）。四页的门控对：概览 `metrics|cluster_overview`、Topic `topics|topic_write`、订阅组 `groups|clients`、消息 `message_query|send_message`；门控对两个都为 false 时该页签不出现。
- 刷新防护：每次异步加载持有 generation 计数，返回时若不是当前世代就整批丢弃（旧页面/旧请求的响应不得覆盖新状态）。
- 状态呈现：加载中提示、空态（「暂无数据」）、错误框（显示 provider 错误消息）三者互斥；无能力时显示该页专属的空态文案。
- 时间输入：接受 `YYYY-MM-DD HH:mm` 或 Unix 毫秒两种写法；非法时以「时间格式非法」中断，**不派发请求**。
- 国际化：文案键以中文为基准，键缺失时回落基准语言、再回落键名本身。

**概览页**

- 指标卡片（`middleware/metrics`，gated by `metrics`）：固定五项按序 = TPS In(`tps_in`) / TPS Out(`tps_out`) / Topics(`topic_count`) / Connections(`connection_count`) / Messages Today(`message_count_today`)；其后渲染 `MiddlewareMetrics.extras`，顺序由实现扩展声明的 extras 顺序提示决定——提示中出现的键先按提示顺序，其余按键原始顺序追加。空值显示 `-`。
- 集群拓扑表（`middleware/cluster/overview`，gated by `cluster_overview`）：把 `clusters[*].brokers[*]` 展平成行，列 = cluster（取所属 cluster 的 `name`）/ name / address / topic_count / queue_count / version / tps_in / tps_out。
- 两块**并发**加载、各自独立 gate；只有一块有能力的页只渲染该块，都没有能力时整页空态。

**Topic 页**

- 列表（`middleware/topic/list`，gated by `topics`）：列 = name / topic_type / queue_count / perm / message_count / created_at，实现扩展可追加特有列。`name` 列为链接，点击加载详情。
- 详情（`middleware/topic/detail`，入参 `{topic}`）：`detail.stats[*]` 表 = broker / queue_id / min_offset / max_offset / last_update；详情区底部提供删除按钮（gated by `topic_write`，`middleware/topic/delete`，入参 `{topic}`），成功后退回列表态并刷新列表。
- 新建（gated by `topic_write`，`middleware/topic/create`）：字段 = topic（必填）、queue_count（正整数；留空表示不指定 ⇒ 传 `null`）、perm（如 `6`；留空 ⇒ `null`）。topic 为空以「必填项缺失」拦截，不派发请求；成功后关闭表单并刷新列表。

**订阅组·客户端页**

- 列表（`middleware/group/list`，gated by `groups`）：列 = group / client_count / consume_type / message_model / tps / total_diff / version / update_time；`group` 列为链接，点击**同时**加载详情与客户端。
- 消费进度（`middleware/group/detail`，入参 `{group}`）：`detail.queues[*]` 表 = topic / broker / queue_id / broker_offset / consumer_offset / diff。
- 客户端（`middleware/group/clients`，入参 `{group}`，gated by `clients`）：表 = client_id / client_addr / language / version / subscriptions（数组以 `, ` 连接，空显示 `-`）。
- 详情与客户端并发加载，`clients` 单独 gate（无该能力时只渲染消费进度）。

**消息查询页**

- 查询模式三选一，切换模式时重置页码。`MessageQuery` 是 tagged enum，外层键即模式名：
  - `{"ByTimeWindow": {topic, begin_unix_ms, end_unix_ms, page, page_size}}` —— 唯一具备服务端分页语义的模式；
  - `{"ByKey": {topic, key}}`；
  - `{"ById": {topic, message_id}}`。
  `topic` 在三种模式下都必填，为空时以「必填项缺失」拦截。
- 结果表（`middleware/message/query`）：列 = message_id / topic / tag / key / store_time / born_time / retry_times；`message_id` 列为链接，点击打开详情；`tag` 非空用徽章展示、空显示 `-`；仅 `ByTimeWindow` 模式呈现分页（页大小 10/20/50，总数取 `MessagePage.total`，翻页即按新页码重新查询）。**进入页面不自动查询**，未查过时结果区为空态。
- 消息详情（取自行数据）：键值表 = message_id / topic / tag / key / store_time / born_time / store_host / born_host / retry_times / 消息体，其中 `body_text` 为空时显示「(二进制消息体)」；`properties`（序列化形态 `[[k,v],...]`）非空时另起一张键值表。
- 发送表单（gated by `send_message`，`middleware/message/send`）：字段 = topic（必填）、tag（可选，空 ⇒ `null`）、key（可选，空 ⇒ `null`）、body（必填，UTF-8 字节序列）。成功后提示「发送成功: `<message_id>` (`<status>`)」，失败提示「失败: `<错误>`」。

本页与 §5.2 分工：实时订阅在 §5.2 的 `events` 页，本页负责「查历史缓冲 + 发送」。

### 5.4 工作台的 shell 页与 QuickJS 运行时

`renderer.kind = "shell"` 的页面是**正常可用**的页面承载方式（不是废弃对象），在开启 `shell-plugins` 的产物里正常加载。唯一的构建约束来自 §5 硬约束：未开该 feature 的自建构建（如 `--no-default-features`）里取不到 host，此时**只有**声明了 `fallback: "native"` 才会退回该页的原生 `template` 渲染，否则显示错误块。参考实现见同仓 docker 扩展（5 个 shell 页全部带 `fallback: "native"`）。

- 技术栈：`gpui` / `gpui-base` / `gpui-component`（QuickJS 运行时，`engines.gpui_shell = "0.2.0"`）。可用组件含 `DataTable`/`DataTableState`、`Pagination`、`Input`/`InputState`、`Textarea`/`TextareaState`、`Select`、`Switch`、`Badge`、`Tag`、`Button`、`chart`、`description_list`、`virtual_list` 等。
- 运行时 API 要点（照抄现有实现，别按记忆写）：
  - 布局原语与输入状态来自 `gpui-base`（`h_flex` / `v_flex` / `InputState` / `TextareaState`），**元素与组件来自 `gpui-component`**：`InputState.new({value, placeholder})` + `new Input(state)`、`TextareaState.new({value, placeholder, rows})` + `new Textarea(state)`。placeholder 只能在 `*State.new` 里设置。
  - 组件构造：`Select(id, rowsFn, renderRowFn, onSelect)`（行对象约定 `{id, label}`，`onSelect` 收到 `id`）、`Tag()` / `Badge()` / `Spinner()` 为 nullary 构造；`Button(id)` 的 id 是**构造期必填**。
  - 数据通道：嵌入式页只拿到 `navop.context` 与 `navop.workbench`（清单声明面），**没有** `navop.event` / `navop.resource` / `navop.job` / `navop.blob` ⇒ 数据一律 `dispatch(operationId, input, opts)`。`mode: "job"` 的操作由宿主在 `dispatch` 内部轮询到结束才返回，页面不要自己写轮询；`effect` 非 `read` 的操作传 `{confirmed: true}` 让宿主弹确认。
- 布局硬规则（都是**静默**故障——页面照常渲染、不报错，只是少了东西）：
  1. **`Select` 必须包在定宽容器里**：`div().w(200).flex_shrink_0().child(new Select(...))`。`Select` 的根是 shell 对 `div` 的 `RenderOnce` 包装，自带整行宽度；裸着当行子元素会让同行的 `div().flex_1()` 拿到 0 基准宽、没有剩余空间可 grow ⇒ 输入框整块消失，或者把不可收缩的兄弟（标题、按钮）挤出可视区。
  2. **`h_flex()` 默认 `items_center`**：整页的行要么在行上声明 `items_stretch()`，要么每个列自己声明 `h_full()`，否则两列都会按内容高度居中塌成一行。
  3. **颜色只能是主题色或 `#hex`**：元素样式取 `cx.theme().colors.*`，组件 prop 只认 Tailwind 名/`#hex`；`"muted"` 这类 token 名会让整个 view 渲染失败。`cx.theme().colors` 本身是 gpui-base 的 18 个 ColorTokens 闭集（`background/foreground/surface/…/selection`），组件库自己的主题名（`list_active`、`table_hover`）在这里是 nil。
  4. **定宽窗格里的长文本要省略**：盒子默认 `overflow: visible` 且 `whitespace_nowrap()` 不设 `text_overflow` ⇒ 定宽列里的长 ID/地址会画到隔壁列上。用 `.truncate()`（或 `text_ellipsis_start/middle`）；列表区要滚动就写 `overflow_y_scroll()`，`min_h_0()` 只让区域可压缩、既不裁剪也不滚动。
  5. **输入校验的文案要对上原因**：RocketMQ 消息查询页把"缺 Topic / 缺 Key"与"时间格式非法"分开提示，非法输入**就地拦截、不派发请求**；错误文案用 `destructive` 上色、普通状态用 `muted_foreground`。
  这五条各有对应守卫测试（`tests/scripts.test.mjs` 的 `extension UI rows size every Select...` / `...declare h_full` / `...never bare token names` / `nowrap text inside a fixed-width pane...`），新增页面时按测试名字自查即可。
- 纯逻辑单独成模块：`ui/message-model.js`（时间解析、查询载荷构造、消息整形）**不 import 任何 shell 模块**，因此能被 `tests/ui/message-model.test.mjs` 在 node 下直接跑；仓级守卫 *"extension node tests are discovered and actually executed"* 会真正执行它（在测试里 `execFileSync(node --test …)` 必须剥掉 `NODE_TEST_CONTEXT`，否则子进程以 0 退出、失败用例永远不报）。写页面逻辑时把可测的部分抽到这一层，别塞进 `render()`。
- 数据解包：`dispatch` 的返回值按操作语法直接就是结果对象（如 `MessagePage` 的 `messages`），不需要再解 `ResultRef`。发送消息时 body 必须是**字节数组**：`Array.from(Buffer.from(text, "utf8"))`（`Buffer` 来自内置 `buffer` 模块，见 `rocketmq/ui/send-message.js`）。

## 6. 打包与发布

- 实现扩展遵循 elasticsearch 模式：`extension.json` + `extension.build.json`（package/binary/targets/releaseTagPrefix/r2Prefix）+ `scripts/package-composite-extension.sh`
- 本地安装：`scripts/install-local-composite-extensions.sh`（无 console 同步步骤——共享控制台库已拆除）
- 市场索引：`manifest.json` 由 `scripts/generate-marketplace-manifest.mjs` 生成
