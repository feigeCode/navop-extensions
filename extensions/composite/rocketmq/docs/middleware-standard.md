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
| `navop.event.subscribe` / `unsubscribe` + `host.on("navop.event")` | 宿主 event 通道（推送） | nsh 页订阅实时消息（见 §5.2） |
| `middleware/message/stream` | `resource/invoke` → 返回 `ResultRef::EventStream` | 实时订阅页：`navop.event.subscribe` 后用 `host.on("navop.event")` 收批次（见 §5.2） |

- 事件**不带资源标识**：消息源由「当前唯一打开的连接」定位；多连接返回 `RESOURCE_BUSY`，无连接返回 `RESOURCE_CLOSED`。
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

事件行渲染按上表取值：`properties.qos` → QoS 徽章、`properties.retain = "true"` → Retain 徽章、`store_time`（回落 `born_time` → `properties.received_at_ms`）→ 时间列，其余 `properties` 原样列在行末。

## 4. 连接表单标准（contributes.connections）

- MQTT：`host`(Text,必填,默认 127.0.0.1)、`port`(Number,必填,默认 1883)、`username`(Text)、`password`(Password,secret)、`client_id`(Text,默认 `navop-mqtt-` 随机后缀由 provider 生成)、`keep_alive_secs`(Number,默认 60)
- RocketMQ：`namesrv_addrs`(Text,必填,占位 `127.0.0.1:9876;10.0.0.2:9876`，分号或 JSON 数组皆可)、`acl_enabled`(Select: none/rocketmq)、`access_key`(Text,visibleWhen acl=rocketmq)、`secret_key`(Password,secret,visibleWhen acl=rocketmq)、`timeout_ms`(Number,默认 5000)
- secret 字段（password/secret_key）必须声明 `"secret": true`，宿主经 reverse Host API 以 `secret://self/...` 引用注入。
- SSH 隧道字段由宿主连接窗口统一提供，provider 侧不感知。

## 5. UI 注册标准（`contributes.shellApp`）

连接级控制台是**一个 nsh app**：`shellApp.entry` 指向 `ui/dist/bundle.js`，源码在 `ui/`（`App.tsx` 外壳 + 路由表，`pages/<route>/` 页面组件，`lib/` 共享库）。ABI v2 起本类扩展**不再声明** `resourceWorkbenches`，也不再提供 `ui/*.js` 形式的 gpui-shell 页面，也没有「每页一个 nsh 包」。

打开路径：连接在 `contributes.connections[*].route` 里声明初始路由（RocketMQ 是 `messages`），宿主据此打开 app 并把 `route` 写进 `host.params`。连接型打开从 `host.params.connection` 拿到宿主借给它的 `resourceHandle`；工具箱打开时 `connection` 与 `route` 都是 `null`，app 显示空态并回落默认路由。

**页面通道（ABI v2）**

| 通道 | 用途 |
|---|---|
| `host.params` | 同步可读的启动事实：`apiVersion`、`extension`（id/title）、`route`、`backends`（alias 列表）、`connection`（含 `resourceHandle`、连接名与 `config`） |
| `host.call(name, data, {timeout})` | 请求-应答：`navop.resource.invoke` / `open` / `ping` / `close`、`navop.job.*`、`navop.blob.read`、`navop.event.subscribe` / `unsubscribe`、`navop.runtime.info` |
| `host.post("navop.log", {level, message, fields})` | 单向日志，无应答 |
| `host.on("navop.event", batch => …)` | 事件推送（先 `navop.event.subscribe`），返回停止函数；组件里注册的随卸载自动停 |

- **连接上下文只从 `params.connection` 读**：`navop.context` 已删除，没有「重取上下文」的 RPC。
- **能力面**：页面不声明 capabilities；能力由 `shellApp.modules` 派生（`resource` / `job` / `event` / `blob` / `runtime` / `log` / `dev`）。未声明的模块调用会被拒成 `PERMISSION_DENIED`（`details.module` 指出缺哪个）。
- 完整契约见 `docs/extension-resource-plugins/host-abi-v2.md`，页面写法见 `nsh-page-guide.zh-CN.md`。

### 5.1 app 声明与页面目录

- app 声明：`shellApp: { title: "RocketMQ", entry: "ui/dist/bundle.js", backends: { "<alias>": "<runtime id>" }, modules: ["resource"], category?, keywords? }`。`backends` 的 alias 必须指向本清单 `runtime.ipc` 里的 runtime id；`resource` 模块要求 `backends` 非空。一个扩展只有一个 `shellApp`、一个 `build` 号。
- 目录：`ui/{App.tsx, App.test.tsx, nsh.json, tsconfig.json, .gitignore, lib/, pages/, dist/}`；`pages/<route>/` 只放 `App.tsx` + `App.test.tsx`（`export default` 页面组件，不 `mount`、没有自己的 `nsh.json` / `tsconfig.json` / `dist/`）；`dist/`（`bundle.js` / `bundle.nshc` 等）入库，由 `nsh build . --out dist` 生成，不要手改。
- 路由与渠道：`App.tsx` 读 `params.route` 选根页面，侧栏切换只改 app 内状态；未知/`null` 回落 `messages`。
- 本扩展三个路由：
  1. 概览 `overview`（`metrics` + `clusterOverview` 并发拉取，5s 自动刷新；指标卡片 + 集群/Broker 拓扑表）。
  2. 消息查询 `messages`：模式选择（时间窗口 / Message Key / Message ID）+ 条件表单 + 结果列表 + 行内详情；三种模式按输入切换 `MessageQuery` 的 tagged 变体。时间窗口支持预设跨度与自定义区间（`YYYY-MM-DD HH:mm` 或 Unix 毫秒，非法输入**就地拦截、不派发请求**），页大小 10/20/50，翻页按 `MessagePage.has_more` 控制。**进入页面不自动查询**（§5.3）。
  3. 发送 `send-message`：Topic 输入 + 已有 Topic 下拉（拉不到时静默降级为纯输入）+ Tag/Key + 消息体 + 发送历史回填。`effect` 非 `read` 的操作由宿主弹确认，页面不再自己做二次点击确认；body 是 UTF-8 字节数组。
- **已知实现缺口**：
  1. 消息轨迹（Trace）、向指定消费组重投消息、消费组增删改、Broker 运行状态（CPU/内存/磁盘）需要 provider 侧新增 Remoting 命令，本轮未做。
  2. `MessagePage.total` 在时间窗口模式下是**本页返回条数**，不是全量总数（RocketMQ 的时间范围查询不返回总数）；`has_more` 也偏宽松（本页非空即为真）⇒ 界面用"本页 N 条"，并在空页时禁用「下一页」。
  3. 重置消费位点的 `timestamp` 非法字符串在 provider 侧会被当作"缺省 ⇒ 当前时刻"（`server/resource.rs` 的解析分支）。页面已就地拦截非法输入，但直接调用 `rocketmq/consumer/reset-offset` 仍可能静默重置到最新位点 —— 建议后续把解析失败改成 `配置错误:` 返回。

### 5.2 实时消息流约定（`navop.event` 推送）

页面侧：先 `navop.event.subscribe` 拿到 `handle`，再用 `host.on("navop.event", ({ handle, cursor, events, done, error }) => …)` 收批次；`EVENT_OVERFLOW` 时按 `cursor` 续订，`done` / `error` 结束订阅。

三条**运行期**前置条件，缺一条就一个事件也看不到：

1. `shellApp.modules` 必须含 `event`，否则 `navop.event.subscribe` 会被拒成 `PERMISSION_DENIED`。
2. provider 的 `middleware/message/stream` 必须返回事件流引用（`ResultRef::EventStream`）；非事件流的返回值直接进错误态。
3. 该操作的 `requires` 必须含它自己的 `method`（`middleware/message/stream`）—— `ensure_capabilities` 按 open 返回的能力清单逐个校验，未声明该方法的实现扩展不提供实时消息页。

- 事件流的 kind 由**资源 metadata** 的 `message_stream_kind` 给出（协议层不定义 kind 常量）：MQTT 为 `mqtt/message/events`。
- 行渲染：事件能按标准消息模型解析（有 `topic`）时渲染成「topic + QoS/Retain 徽章 + 时间 + 单行截断的消息体」；否则回落原始 JSON 行。
- 消费方（UI）不得假设事件一定带 `body`（实时事件省略原始字节），要完整载荷用 `middleware/message/query` 查缓冲。

### 5.3 控制台页面能力契约（承载方式：app 内路由）

本节是**页面能力契约**，与承载方式无关，约束 `shellApp` 里的路由（MQTT/RocketMQ 现状）。

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

本页与 §5.2 分工：实时订阅走 §5.2 的 `navop.event` 推送，本页负责「查历史缓冲 + 发送」。

### 5.4 nsh 页面运行时（ABI v2）

页面是 TypeScript/TSX，组件来自 `nsh` / `nsh/base`；没有 QuickJS / gpui-shell 运行时（`engines.gpui_shell` 只是旧产物元数据）。

- 构建与验证（页面目录内）：`nsh check .`、`nsh test .`、`nsh build . --out dist`；`dist/` 入库。
- 超时：`host.call` 第三参 `{timeout}` 以毫秒计，`0` 表示不超时；不传即 nsh 缺省的 30 秒。长操作（建连、大列表/日志查询）显式给 60 秒或 0。
- 错误：`catch` 到的对象直接带 `code` / `retryable` / `details` / `message`；不要解析任何 base64 信封（`__NAVOP_ERROR__` 已删除）。
- 主题与语言：宿主把主题写进 nsh —— 用 `token("background")` 这类语义色、`colorScheme()` 与 `dark:` 类名；语言用 `locale()` / `Intl`。没有 `navop.theme.*` / `navop.i18n.*`。
- 数据解包：`navop.resource.invoke` 的结果是 inline 值，或 `{ blob: handle }`（再 `navop.blob.read` 取值，协议见开发指南 §9.3）。发送消息时 body 必须是字节数组（MQTT 用 `Array.from(Buffer.from(text, "utf8"))`，RocketMQ 用 `Array.from(new TextEncoder().encode(text))`）。
- 页面写法与布局规范以 `docs/extension-resource-plugins/nsh-page-guide.zh-CN.md` 为准。

## 6. 打包与发布

- 实现扩展遵循 elasticsearch 模式：`extension.json` + `extension.build.json`（package/binary/targets/releaseTagPrefix/r2Prefix）+ `scripts/package-composite-extension.sh`
- 本地安装：`scripts/install-local-composite-extensions.sh`（无 console 同步步骤——共享控制台库已拆除）
- 市场索引：`manifest.json` 由 `scripts/generate-marketplace-manifest.mjs` 生成
