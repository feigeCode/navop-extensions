# Elasticsearch 扩展易用性与 Mapping 导航实现方案

> 日期：2026-09-16
>
> 状态：设计与实现交接，尚未实施。本文不表示任何功能已经完成或测试已经通过。
>
> 调研基线：`navop-extensions@095a3fe`、`navop@f47f45ae0`。后续实现前须复核工作区增量。
>
> 范围：`extensions/composite/elasticsearch`，以及确实需要补齐的宿主通用 resource workbench 能力。不是重做所有扩展。

## 1. 结论与明确取舍

**要改，但重点不是再添加一个 Mapping API，而是把已有能力组织成“找索引 → 看字段 → 查文档”的工作流。**

1. **左侧树应该有 Mapping 入口**：放在具体索引下，不做脱离索引上下文的全局 Mapping 页面。
2. **完整字段树主要放在 Mapping 页面内部**，不要默认把所有索引的所有字段装入全局导航树。
3. **索引工作区使用共享 Tabs**：概览、文档、Mapping、设置、别名、统计、分片。保留现有 page ID，复用宿主已有 tabGroups，不重新造一套 JS 路由。
4. **Mapping 默认结构化只读，保留原始 JSON**。优先解决字段搜索、类型、层次、多字段、原始定义定位；不把它做成“随便改类型然后保存”的表格编辑器。
5. **索引节点首次点击进入概览**，概览提供显眼的“浏览文档”，Mapping 是同层 Tab。这样不因浏览导航树就自动搜索生产数据；不要默认记忆上次 Tab 而产生不可预测跳转。
6. **只为通用能力改宿主**：静态功能子节点、树展开与导航分离、正确的刷新/选中状态。ES 字段解析、DSL、索引策略留在扩展。
7. **先交付 P0，再做 P1**。P0 已能显著改善入口与 Mapping 浏览；字段联动查询、多索引能力、深分页不绑在第一版里。

一句话目标：**左树找对象，中间切任务，页内看字段，原始 JSON 随时可查。**

## 2. 当前实现：已有、缺口与源码依据

以下路径以工作区为基准；行号对应上面的调研基线，后续以符号名为准。

| 事实 | 源码位置 | 对方案的影响 |
|---|---|---|
| 已有 `indexMapping` operation 与 `index-mapping` 页面 | `navop-extensions/extensions/composite/elasticsearch/extension.json:224-252,805-837` | 不要重复发明 mapping/get RPC |
| Mapping 当前是 native JSON viewer，经 index-detail 链接进入 | 同文件 `732-837` | 短板是入口与结构化交互，不是服务端完全不支持 |
| 左侧目前是 list；中央共享 tabGroups 为空 | 同文件 `1001-1034` | 可以先用已有 tabs 串联已有页面 |
| 索引列表已有健康、状态、分片、文档数、大小等数据与行操作 | 同文件 `506-610` | 不要为了新视觉重写全部已有管理能力 |
| 当前 Search 表单只有 `query`，默认 `*` | 同文件 `614-635`；operation `201-215` | 缺少可见索引范围、DSL 编辑与实用结果浏览 |
| Provider 已支持按 indices 搜索、body、from/size/sort/track_total_hits | `.../elasticsearch/src/client.rs:486-515,662-685` | UI/manifest 没有充分使用现有能力 |
| 搜索标准化结果是 `{ "raw": ES原始响应 }` | 同文件 `normalize_search:822` | 页面不能误读成顶层 `hits`，更不能擅自破坏旧返回契约 |
| Mapping 返回保留 ES 原始形状 | 同文件 `200-239,688-696` | 在扩展 UI 的纯函数中建立字段模型，保留原始 JSON |
| Provider 声明的是实现能力，不是当前账号授权探测结果 | `.../elasticsearch/src/server/resource.rs:26-45` | 有 capability 不等于当前账号能执行，403 仍须独立处理 |
| 树支持 operation 懒加载与递归声明，但没有静态功能子项 | `navop/crates/extension-runtime/src/extension/manifest/contributes/resource_workbench.rs:170-202` | 不能仅改 ES manifest 就假装已有静态 Mapping 子节点 |
| 树加载使用固定 paging `{page:1,limit:200,cursor:null}`，未消费下一页 | `navop/crates/resource_view/src/nav_tree.rs:117-181` | 不能宣称已有完整树分页；也不能把 200 误写成 ES 当前只返回 200 个索引 |
| 树当前点击同时切换展开并导航；折叠会清理后代缓存 | 同文件 `184-215` | 要分离点击语义，避免导航时意外收起 |
| 树选中比较 pageId 与完整 route | 同文件 `46-73` | 静态叶子路由保持最小；字段选择不乱塞 route 破坏高亮 |
| shared tabGroups 与 route 绑定已存在 | `.../resource_workbench.rs:204-211,304-313`；`navop/crates/resource_view/src/lib.rs:1638-1692` | 优先复用，不做单页私有 Tab 状态与宿主双重路由 |
| Shell workbench 只有 `current()` / `dispatch()`，没有 navigate API | `navop/crates/universal-plugins/src/shell_plugin_host/workbench.rs:13-64` | P0 不调用虚构导航 API；P1 联动需要明确增加宿主契约 |
| 当前 ES 连接定位为 Elasticsearch 9 | ES manifest 开头；`src/server/resource.rs:38-43` | 本次不顺便承诺 ES 8 / OpenSearch 兼容 |

特别注意两个问题：

- 当前 listIndices 通过 CAT indices 获取列表，未在这一分支实现服务端 cursor。宿主传了 paging 并不意味着 provider 分页已经生效。
- 当前 provider 单响应存在 16 MiB 上限（`src/client.rs:24-25`）。超过限制需要明确报错，不许悄悄截断后称为“完整 Mapping”。

## 3. 市面客户端参考：借鉴工作流，而非照搬样式

调研方法：阅读官方文档与官方仓库，日期 2026-09-16；未声称实际运行或逐版本测评这些产品。不据此给市场占有率、最新版本或性能排名。

| 参考 | 已核实的能力/组织方式 | Navop 应借鉴 | 不照搬 |
|---|---|---|---|
| Kibana Index Management [R1] | 索引详情组织 overview/mappings/settings/statistics，并可进入 Discover；有索引搜索与隐藏索引开关 | 对象明确、详情内分任务；显示查询目标；隐藏对象有显式入口 | 不复制整个 Stack Management 层级 |
| Kibana Discover [R2][R3] | 字段面板支持查找字段、添加为结果列；结果表支持列与密度调整 | 字段与数据互相定位，保留工作上下文 | 第一版不建设仪表盘、KQL/ES\|QL 全套编辑体验 |
| Elasticvue 官方 README [R4] | 集群概览、索引/别名、分片、文档搜索编辑、REST 查询等职责分开 | 日常数据操作与运维操作分区 | 不因其支持 REST 就把任意 HTTP 通道放入嵌入 shell |
| Dejavu 官方 README [R5] | 强调数据浏览、可视过滤、分页、多索引与字段显示 | 文档页是实际工作区，不只是一个返回 JSON 的搜索按钮 | 不先复制批量写入、导入和搜索 UI 生成器 |

**设计推论（本方案自己的选择，不是竞品事实）**：Navop 应把数据库客户端式“对象树”和 ES 客户端式“索引工作区 + 字段面板”结合。没有证据说明“所有 ES 客户端都会在全局树展开 Mapping”，因此不以此作为必要性依据。

## 4. 信息架构与交互

### 4.1 P0 目标左树

```text
当前 Elasticsearch 连接              ← 使用已有连接宿主，不再重复一层连接树
├─ 集群概览
├─ 索引
│  ├─ orders-v1
│  │  ├─ 文档
│  │  ├─ Mapping
│  │  ├─ 设置
│  │  ├─ 别名
│  │  ├─ 统计
│  │  └─ 分片
│  └─ logs-2026.09
│     └─ ...
├─ 查询                              ← 保留全局 Search，要求显式选择目标
├─ 节点
└─ 任务
```

- “索引”根节点进入索引总表，展开时才拉索引列表。
- 索引行文字点击进入 `index-detail`；箭头仅展开静态功能子项，不发 Mapping 请求。
- Mapping 叶子进入 `index-mapping`，此时才读取该索引 Mapping。
- 不在全局树下继续展开所有字段；不要给 Mapping 节点显示一个必须遍历全索引才能算出的字段数。
- “新建索引”是索引列表页面动作，不再与“索引/节点”平级冒充一种资源；保留原 `index-create` page。
- 分片默认进入具体索引工作区；若保留集群级分片页，要单独声明其范围，不能点击一个无 `name` 的索引分片页。
- 左树索引筛选、隐藏对象、长列表处理见第 8 节，不用几十个前缀目录假装 ES 有文件夹。

### 4.2 索引工作区

```text
orders-v1  · 当前连接 prod-es         [刷新] [更多操作]
概览 | 文档 | Mapping | 设置 | 别名 | 统计 | 分片
───────────────────────────────────────────────────
当前 Tab 内容
```

共享路由只携带实际对象标识，P0 使用 `{name:"orders-v1"}`。所有 Tab 显式转发 `name`；不要使用空 route，不能切完 Tab 丢索引。

已有页面继续使用原 ID：

| Tab | pageId | P0 呈现 |
|---|---|---|
| 概览 | `index-detail` | 现有 native 页可先保留，增强后展示紧凑属性摘要与原始 JSON |
| 文档 | `index-documents`（新增） | 有索引约束的查询/结果页；结构化文档浏览在 P1 增强 |
| Mapping | `index-mapping` | 新 shell 字段浏览器 + native fallback |
| 设置 | `index-settings` | 保留 native JSON，优先只读 |
| 别名 | `index-aliases` | 保留读取，P1 做结构化表与受控管理 |
| 统计 | `index-stats` | 保留 native 读取 |
| 分片 | `index-shards` | 核对并补齐 route.name；保留原有数据能力 |

### 4.3 Mapping 页面线框

```text
orders-v1 / Mapping                     已更新 14:32   [刷新]
[字段名搜索________________] [类型: 全部] [字段 | 原始 JSON]
──────────────────────────────────┬────────────────────────────
字段                         类型  │ user.name
▾ user                      object│ 类型          text
  ▾ name                    text  │ 来源          properties
    keyword                 keyword│ analyzer      standard
  age                       integer│
▸ items                     nested│ [复制字段路径] [复制定义]
  created_at                date  │
──────────────────────────────────│ 当前字段的原始定义
匹配 5 / 已解析 42 个字段节点        │ { "type": "text", ... }
```

- 页内采用“可筛选的字段树/扁平列表 + 选中字段详情”；不是 SQL 列编辑器。
- 左区宽度可调整；窄窗口时详情区折叠成可展开区域，不压缩成不可读的多列。
- 字段路径可复制，长字段名可查看完整内容；类型用紧凑文本，不给每个单元格堆彩色胶囊。
- 搜索按完整字段路径不区分大小写匹配；树模式保留命中字段祖先；清空搜索恢复此前展开状态。
- 字段切换不发网络请求；首次加载后使用同一 Mapping 快照。
- P0 动作：复制路径、复制字段原始定义、生成/复制查询片段、切原始 JSON。
- P1 动作：“在文档中筛选”“添加为结果列”，等通用导航/视图状态交接完备再启用。
- 原始 JSON 默认只读；不存在“保存 Mapping”按钮。字段统计、样本值不是 Mapping 元数据，不伪造。

### 4.4 统一状态与操作语义

| 状态 | 展示与行为 |
|---|---|
| 首次加载 | 在内容区显示加载；仍能识别当前连接与索引 |
| 刷新中 | 保留旧快照并标记刷新中；禁止重复提交，不把全页清空 |
| Mapping 无 properties | “暂无显式字段定义”，仍可查看 runtime、dynamic_templates、元字段与原始 JSON |
| 搜索无匹配 | “没有匹配字段”，一键清除筛选；不等于索引没有字段 |
| 403 | 明确“无权读取此索引的 Mapping”；保留可重试与错误详情，不伪装空树 |
| 404 / 索引被删除 | 显示对象失效，引导刷新索引列表；不自动创建同名索引 |
| 超时/断连 | 保留旧数据与更新时间，标记过期；按需重试，不无限轮询 |
| 超过响应/解析预算 | 明确“未完整加载”与原因，不能显示“全部字段已加载” |
| 未知字段类型 | 显示服务端原类型字符串与定义，不崩溃，不当成普通字符串字段 |

键盘支持方向键移动/展开、Enter 选中，搜索有可发现的聚焦入口。点击箭头不改变页面；点击行不丢展开状态。焦点与选中必须可见，颜色不能作为健康/错误/只读的唯一标识。

## 5. P0 Mapping 数据模型与语义

### 5.1 数据流

```text
extension.json indexMapping
    -> navop.workbench.dispatch("indexMapping")
    -> 宿主已有 session / operation / capability / blob 解包
    -> provider elasticsearch/index/mapping
    -> GET 当前索引 _mapping
    -> ui/mapping-model.js 纯函数
    -> Mapping 页面状态与虚拟化/分页字段列表
```

Provider 继续返回领域数据，不返回 `pageId`、组件名、图标、中文菜单或 UI 字段树。

不新增 mapping 字段 provider RPC 作为 P0 前提。一次单索引 Mapping 足够在扩展 UI 解析；如果未来大响应确实需要服务端投影，另立领域 API 设计和限制说明。

### 5.2 建议 UI 内部模型（不是 IPC 协议）

```ts
type MappingField = {
  id: string;                  // concreteIndex + 原始 JSON Pointer，不能只用 dotted path
  parentId: string | null;
  name: string;                // 该节点原始名字
  fullPath: string;            // 展示/查询字段路径，与结构身份分离
  pointer: string;             // 指向原始 Mapping，正确转义 ~ 和 /
  type: string;                // ES 类型；隐式 object 可标注推断来源
  source: "property" | "multi-field" | "runtime";
  nestedAncestors: string[];   // 为 P1 查询生成保留上下文
  raw: unknown;               // 原始定义，不丢未知属性
};
```

解析要求：

1. 按 ES 响应的 concrete-index 键处理，再读取其 `mappings`；不得假定顶层就是 `properties`。
2. 递归 `properties`，区分 `object` / `nested`；存在 properties 但未显式 type 时可以显示 `object（隐式）`。
3. `fields` 是 multi-fields，与 `properties` 分开标识，不伪装成 `_source` 对象的孩子。[R6]
4. `runtime` 独立标识；`dynamic_templates`、`_source`、`_meta` 等展示在“Mapping 配置/原始 JSON”，不要混充文档字段。
5. 字段类型为 `alias` 时展示目标 `path`；不要与索引级 alias 混淆。[R7]
6. 保留原始名字与结构。不能把所有带 `.` 的键一律拆分成 object；需要覆盖 `subobjects:false` 的合法点号字段。[R8]
7. 不为 `flattened` 等类型杜撰未在 Mapping 声明的子字段；未知类型走通用只读展示。
8. 使用可迭代遍历或深度保护，避免异常深度使 JS 栈溢出。排序稳定，不改变 raw JSON 原顺序。
9. 如果请求结果意外包含多个 concrete indices，先要求选择具体索引；不静默取第一个，也不把同名字段无脑合并。
10. P0 不展示凭类型猜出来的“可聚合/可搜索”勾选。显式 Mapping 参数可如实展示，最终能力在 P1 通过 field caps 补齐。[R9]

### 5.3 Mapping 修改边界

已有字段类型不能用一次普通更新直接改掉；应新建目标索引并 reindex。部分参数与新增字段支持更新，新增 multi-field 也不意味着历史文档立即具有该新子字段值。[R7]

因此：

- P0/P1 Mapping 以只读为主。
- “新增字段 / 更新允许参数”单独列入 P2，显示请求预览、影响范围与确认。
- 不做“删除字段”“重命名字段”“任意类型下拉保存”这种误导式 CRUD。
- Reindex 是独立任务流程，不通过一个“保存”按钮暗中创建索引、迁数据、切别名。

## 6. Manifest 与宿主改动设计

### 6.1 直接复用现有 shared tabGroups

所有索引页声明相同 `tabGroupId`。下面只展示一项，实施时列全：

```json
{
  "id": "index-tabs",
  "tabs": [
    {
      "id": "mapping",
      "title": "Mapping",
      "pageId": "index-mapping",
      "route": {
        "name": { "source": "route", "path": "/name", "type": "string" }
      }
    }
  ]
}
```

P0 不需要 shell 导航 API。Tabs、页面 links、树节点跳转全部由已有宿主执行。

### 6.2 新增通用“静态树子项”，而不是 ES 专属树

**这是拟新增契约，不是当前已经支持的 JSON。**

建议把当前 `ResourceWorkbenchTreeChildren` 的使用位置提升为“远程集合或静态集合”两种 child source：

- 远程集合继续接受现有 `operation/itemsPath/keyPaths/labelPath/open/children` 形状，旧 manifest 不变。
- 新增显式 `kind:"static"` 的集合，具有 `items`；每个 item 有 `id/title/open`，可递归声明 children。
- 不用 provider 伪造 `elasticsearch/index/navigation` 返回“文档/Mapping/设置”行。
- 不支持任意脚本计算 pageId；静态 item 的 pageId 仍做编译期/注册期引用校验。

示意：在“索引列表动态行的 children”处声明：

```json
{
  "kind": "static",
  "items": [
    {
      "id": "mapping",
      "title": "Mapping",
      "open": {
        "pageId": "index-mapping",
        "route": {
          "name": { "source": "parent", "path": "/name", "type": "string" }
        }
      }
    }
  ]
}
```

明确静态绑定语义，实施不可凭感觉补：

1. 静态 item 的 `selection` 是自身稳定元数据 `{id}`；`parent` 是直接父节点领域行。例如 Mapping 的 parent 是索引行 `{name,...}`。
2. 若静态项内还声明远程 children，其请求 `parent` 默认仍按现有“当前节点行”规则处理。需要继承更远领域上下文时，应显式定义扩展契约；不要隐式穿透祖先。本次只需一层静态功能叶子。
3. 节点 key 使用父级 key + 稳定 item.id，不能用 title；动态 key 仍基于 keyPaths。处理分隔符编码，防冲突。
4. 静态项注册时校验 ID 重复、目标页不存在、循环/深度上限、非法 binding；不发 provider 请求即可展开。
5. 左树叶子与 Tab 产生相同 `{pageId,route:{name}}`。索引父行显示祖先上下文态，只有当前叶子显示 active；不能所有兄弟一起高亮。
6. 协议兼容必须跨 manifest parser、注册模型、渲染、文档/schema/类型与 fixture 一起更新。当前 `deny_unknown_fields` 会拒绝未知字段，不可只在扩展侧添加。
7. 版本门禁：若现行 schemaVersion 政策要求升级，则为新 child source 增加新版本并继续读取旧版本；若允许向后兼容增补，也必须声明最低宿主支持并拒绝旧宿主安装/加载新声明。**不能把 native fallback 当成 manifest 解析失败的兜底。**

这是为资源型扩展补一个通用能力，不是趁机设计完整树脚本引擎。

### 6.3 树生命周期修正

- 分离 `expandedKeys` 与 `childrenCache`；折叠仅隐藏，不等于刷新/丢缓存。
- 箭头事件与行导航事件隔离，避免事件冒泡触发两次行为。
- 每次异步加载携带 node key + request generation；刷新、连接重开、节点删除后，迟到响应不得重新写回旧子树。
- 增加“刷新当前分支”，失败显示可重试节点；切页/展开不应触发整个集群批量刷新。
- 索引刷新后保留仍存在的选中项；已删除对象进入失效态，不能让旧缓存继续看起来有效。
- 不把当前固定 `limit:200` 当成已实现 cursor；远程树分页若尚未做，界面与测试必须明确其限制。

### 6.4 无宿主改动的独立交付切片

若团队先只发扩展，可先交付：

1. 现有索引列表 + 现有动态索引树（或保留 list）；
2. 索引共享 Tabs；
3. Mapping 结构化只读页与 JSON fallback；
4. 有明确索引约束的文档查询入口。

此切片**不宣称已交付“索引下静态 Mapping 子节点”**。完整 P0 在静态子项能力合入宿主后完成。不要为了赶进度把 UI 菜单伪装成 provider 资源。

## 7. P1：文档查询与字段联动

### 7.1 先修查询范围，再做高级体验

- 索引内文档页只查询当前 `route.name`，请求显式传 `indices:[name]`。
- 全局查询页必须显示/选择目标；空选择禁用执行，不再默默等价 `_all`。
- 为 `index-documents` 新建索引绑定 operation，不直接修改旧全局 search 的必填绑定造成兼容破坏。
- 支持“简单搜索”和“Query DSL”两种模式；简单模式标明 `simple_query_string`，不要写成 KQL。
- DSL 必须 JSON object；执行前展示目标及请求。模式切换保留各自草稿；复杂 DSL 不强行无损反解成简单表单。
- 查询草稿与“上次执行请求”分离，用户能知道表格是哪次请求的结果。
- 简单模式由 UI 构造一个 body；DSL 模式 body 为唯一查询主体。明确分页/sort 参数由谁控制，避免 body 与 URL 参数相互覆盖。
- P0 可用已有 native form/result 能力交付索引约束查询；若 native 表单无法构造 indices 数组，可为同一 provider 方法声明独立 operation，在 shell 提交时传入数组，不能偷退回全局查询。

### 7.2 结果与分页

- 结果读取 `result.raw`；保留 `_index`、`_id`、`_score`、`_source`、`fields`、`sort`、took、timed_out、shard failures。
- 固定身份列 + 用户选列；默认摘要而不是展开全部 JSON。行展开查看结构化/原始文档。
- 同名 `_id` 跨索引不唯一，行 key 使用 `_index + _id` 等完整身份，不只用 `_id`。
- multi-field / runtime / alias 不保证出现在 `_source`；选列取值要区分 `fields` 与 `_source`，缺失不能显示成空字符串。[R6]
- `hits.total.relation == "gte"` 显示“至少 N”，不能显示成精确总量；精确计数按需打开，不默认对所有查询执行 count。[R10]
- 分页默认每页 50（产品建议值，可配置），普通 from/size 只在结果窗口内使用；达到实际允许窗口显示限制，不自动修改服务端 `max_result_window`。[R11]
- PIT + search_after 作为 P1 后段独立任务：需新增 PIT 生命周期与能力声明、稳定排序、游标栈、过期恢复、最新 PIT ID 替换与关闭；不能仅加“下一页”按钮就宣称深分页完成。[R11][R12]
- PIT 搜索不能继续同时指定 indices，必须走 provider 明确的 PIT 搜索分支；索引范围在打开 PIT 时确定。[R12]
- 查询取消若当前嵌入 dispatch 未提供可控 cancellation handle，不显示假的“已取消服务端任务”；先做请求代次隔离，真正取消再补通用宿主契约。

### 7.3 字段能力与联动

新增领域只读方法 `elasticsearch/field/caps`（名称为建议，实施时与 URI 命名规范统一），接入 method capabilities、dispatch allowlist、manifest operation 与测试：

- 输入：显式目标 indices、fields；禁止隐式全局范围。
- 返回：保留 ES 原始 field caps 结构，UI 再投影 searchable/aggregatable 与冲突索引。[R9]
- 多索引同路径不同类型：显示冲突，不默认为其中一种类型。无权限/请求失败显示 unknown，不当成 false。
- 不把 `aggregatable:true` 简化成“任何查询都可以排序”；按字段类型与操作分别判断，不确定时不自动生成。
- 普通 keyword/数值/日期可生成合适 term/range 模板；text 提供 match，不把全文字段默认塞进 term。
- nested 字段生成正确 nested 上下文；P1 首版不能保证复杂多层语义时只复制带解释的模板，不一键执行错误查询。

跨页联动需要新增、受宿主约束的通用导航：

```ts
// 拟新增，当前不可调用；具体异步签名按宿主调度模型最终确定。
navigate({ pageId: "index-documents", route: { name: "orders-v1" } });
```

实施要求：

1. 当前 workbench 内验证目标页与目标 route schema，拒绝跨连接/任意页面跳转。
2. 将导航回调从 workbench owner 注入 shell host，挂载销毁后拒绝调用；不要只补一个 TS 函数声明。
3. 大型 DSL/文档/凭据不塞 route。跨页草稿需另定义 session-scoped、短生命周期的 view-state/handoff 契约（包含来源/目标 mount 与消费规则）；它属于 UI 状态，不进入 provider。
4. 状态交接失败显示说明，不能静默换成 match_all；执行仍由用户确认。
5. 没有完成该契约前，Mapping 只提供复制字段/查询片段。纯点击事件不能自动变成现有声明式 page link。

## 8. 性能、权限与状态所有权

### 8.1 索引与字段规模

- 不在连接打开时调用所有索引的 `_mapping`；P0 打开单索引 Mapping 至多一次读取，刷新另算。
- 索引列表和字段列表独立滚动，优先使用已导出的虚拟列表/表格。若 shell adapter 没有合适虚拟化能力，先做可见分页，再提通用 adapter 增强；不每次 render 构造一万行组件。
- 字段搜索本地执行，可 debounce；缓存过滤结果，render 不重新遍历全 Mapping。
- 对“1000 个索引/单索引 10000 个字段”的合成 fixture 测量首屏、搜索、滚动；记录机器/构建模式/样本大小，目标是交互无明显阻塞，不预先宣称已达到某个耗时。
- 当前 CAT 全列表可先缓存后筛选；显示“在已加载 N 个索引中筛选”。新分页契约实现前不称为服务端全局搜索。
- 大列表不能静默截成前 200 项。若只渲染窗口/分页，必须仍可到达后续对象；如果上游响应超限，明确报告不完整。
- “点号前缀”不等于 hidden/system 的权威分类。真实隐藏对象开关需 provider 显式 expand_wildcards/元数据支持；若 P0 只做点号名过滤，文案就叫“显示点号前缀索引”。不要暗示可绕过系统索引权限。

### 8.2 缓存与异步

- 宿主负责连接、session、page/route、权限边界、树缓存；shell 负责页内输入、字段选中、展开和快照。
- P0 页内缓存以 mount + 当前索引限定，页面卸载自然失效；不要把 borrowed resource handle 放进全局 JS 缓存或磁盘。
- 若实现跨页缓存，必须使用宿主 session generation + 索引身份。当前没有 UUID 时，刷新/重连/同名重建必须失效，不能仅用字符串 name 跨 session 复用。
- 请求序号至少比较当前索引与 generation。先请求 A、后切 B，即使 A 最后返回也不能污染 B。
- 刷新错误保留旧快照并显示 stale；修改别名/创建删除索引后精确失效相关缓存。
- 自动轮询默认关闭；页面不可见时停止工作。独立 Mapping 页不订阅不存在的 `navop.event`。

### 8.3 安全与写操作

- 网络与凭据仍由 provider/宿主处理，不让 shell 拼 URL 带 token 直接请求 ES。
- operation.requires 是方法支持检查，ES 账号授权仍以服务端结果为准。读取 Mapping 失败不应禁掉所有能用的页面。
- 原有删除、关闭索引、别名变更等操作保留真实确认流程；确认内容包含连接、索引和影响。
- `confirmed:true` 是用户已确认后的调用标记，不是让宿主自动弹确认框的指令。
- 不自动重试写操作。账号凭据不进查询历史/日志；历史默认 session 内，持久化另行明确隐私策略。
- 第一轮文档浏览不顺手上线编辑/删除文档。后续编辑应单独设计版本冲突与并发控制。

## 9. GPUI Shell 落地约束

必须先阅读并遵守本工作区技能：

- `.codex/skills/navop-shell-extension/SKILL.md` 及 manifest/script-api/shell-reuse references。
- `.codex/skills/gpui-shell/SKILL.md` 与 layer-selection。
- `.codex/skills/gpui-component/SKILL.md` 与 design-guides/coding-guides。
- 若修改宿主 GPUI，补读 `.codex/skills/gpui/SKILL.md`。
- 修改 provider IPC 时，补读 `.codex/skills/ipc-driver-development/SKILL.md` 中适用的协议边界说明，不把 resource provider 改造成数据库 driver。

实施硬约束：

1. 保留 `extension.json`，以 `contributes.shellViews` 注册 `ui/*.js`；renderer 使用 shell + native fallback。native stack 仍可读 Mapping，不删掉退路。
2. 嵌入页只申请所需 `context/workbench` modules；用 `dispatch` 命名操作借用 session，不自行 `resource.open/close`，不申请整套 raw resource/job/event/blob 权限。
3. 使用现有 gpui-shell/gpui-component-shell，不创建 ES 专用 JS runtime、浏览器 DOM 页面或 provider UI RPC。
4. `gpui-base` 做布局/retained input state，styled 控件优先 `gpui-component`。先核对锁定 revision 对应的 JS catalog/types，不能假定 Rust Tree/Table/Editor 自动可从 JS import。
5. 所有状态在 `init` 初始化；不要以 class field 初始值覆盖 init。render 无请求、无订阅、无状态重建。
6. 异步通过 `cx.spawn` 获取合适 context，更新时通知；保留输入 state 与稳定 row ID，不每帧新建。
7. 只用当前 JS 导出的语义主题颜色；不写死浅/深色值，不假定存在 warning/success 等未导出的 token。文字明确表达健康/错误。
8. 紧凑工具栏、稳定 Tabs、表格/字段详情为主，不做大标题欢迎卡、满屏统计卡或装饰性渐变。
9. `h_full/min_h_0/min_w_0` 与 flex shrink 明确，区域自行滚动；Select 宽度通过容器控制，窄窗口验证不溢出。
10. 确认框若没有可用 overlay adapter，使用明确的页内确认区域，不做外观像对话框但无法正确聚焦/取消的伪组件。
11. 若 typings 有 InputState 品牌类型不一致，修正来源与版本，不用 `as any` 遮盖运行时差异。
12. Shell 模块加载失败应验证 native fallback 真正可用；业务 403 不是模块失败，不触发循环回退。

## 10. 文件级实施地图

标记“新增”的路径是建议落点，实际实施可按仓库惯例细分；禁止把建议当作文件已经存在。

### navop-extensions

| 文件/目录 | 改动职责 |
|---|---|
| `extensions/composite/elasticsearch/extension.json` | tree/tabs/索引路由、shellViews、文档页与 named operations；保留旧 page ID |
| `extensions/composite/elasticsearch/ui/mapping.js`（新增） | 页内字段浏览、状态机、只读 raw 切换 |
| `.../ui/mapping-model.js`（新增） | 纯解析、稳定 ID、过滤、字段路径/类型语义 |
| `.../ui/documents.js`（P1 新增） | 简单/DSL 查询、结果列、文档详情、分页 |
| `.../ui/search-model.js`（P1 新增） | request/result 纯函数，读取 raw envelope、field caps 合并 |
| `.../src/client.rs` | P0 尽量不动 Mapping API；P1 field caps/PIT/必要列表参数及验证 |
| `.../src/server/resource.rs` 及 job/state 相关路径 | 仅在新增方法/生命周期确有需要时调整；保留 host-owned scope |
| `.../tests/end_to_end.rs` | Mapping read、显式索引搜索、权限错误、资源生命周期回归 |
| `.../tests/ui/*.test.mjs`、`.../tests/fixtures/*`（新增） | 纯模型、请求构造与恶劣数据 fixture |
| `packages/navop-extension-types/src/shell/navop.d.ts` | P1 新增宿主 API 时同步；同时核对当前 workbench 类型声明缺口 |
| `tests/scripts.test.mjs` 与打包脚本 | 验证 shell 文件收录和安装包完整；改 scripts 前读其 AGENTS.md |

### navop

| 文件/目录 | 改动职责 |
|---|---|
| `crates/extension-runtime/src/extension/manifest/contributes/resource_workbench.rs` | 通用 static child source 类型与兼容策略 |
| 同 crate manifest parser / validator / parser_tests.rs（按符号定位） | 引用/版本/递归校验与旧 manifest 回归 |
| `crates/resource_view/src/nav_tree.rs` | 静态实例化、展开/导航分离、active、刷新/迟到响应 |
| `crates/resource_view/src/layout.rs` | resolved tree model 与必要的布局解析 |
| `crates/resource_view/src/lib.rs` | 路由/共享 tab/页级加载与状态整合，不写 ES 类型判断 |
| `crates/resource_view/src/custom_page_host.rs` | P1 若增加 navigate/handoff，补宿主回调边界 |
| `crates/universal-plugins/src/shell_plugin_host/workbench.rs` | P1 generic navigate/state handoff，与 declarations 同步 |
| `crates/universal-plugins/src/shell_plugin_host/extension_pages_render_tests.rs` | ES shell 页加载、渲染、卸载/异常、fallback |
| manifest schemas/docs/生成类型的实际源文件 | T0 先定位维护源；不手改单个生成产物冒充同步 |

## 11. 分阶段任务与依赖

### T0：先固定契约与测试入口

- [ ] 复核基线差异、AGENTS 与上述 skills。
- [ ] 找到 manifest schema/注册模型/生成类型的实际维护入口，决定静态 children 的版本门禁。
- [ ] 验证 JS 侧可用的列表、输入、只读代码/JSON 组件；确定虚拟化或显式分页路径。
- [ ] 为现有 Mapping 响应、search `{raw}`、路由 name、native fallback 建立 characterization tests。
- [ ] 核实 shell 页带 load 时是否会与 `init -> dispatch` 双重请求。选定单一数据 owner：shell 自己 dispatch，native fallback 再按原 load；若现宿主不能区分，先补通用规则，不能接受重复加载。

### T1：索引上下文与共享 Tabs（可独立合入）

- [ ] 接入 index-tabs，保留旧页 ID，所有 tab/link 正确转发 name。
- [ ] 文档查询显式限制当前索引；全局查询提示/要求选择目标。
- [ ] 把新建索引与分片入口放回正确上下文。
- [ ] 补 A/B 索引切换、无 name、错误索引、旧链接回归。

### T2：通用树能力（宿主切片）

- [ ] 实现 static child source、解析与验证，旧远程 children 行为不变。
- [ ] 分离展开和导航，补缓存/刷新/请求代次逻辑。
- [ ] 补静态 parent binding、高亮、键盘、失败重试与长列表测试。
- [ ] 同步 schema/docs/types 和最低宿主要求，再让 ES manifest 使用新声明。

### T3：Mapping 可用性（扩展切片）

- [ ] 先实现 mapping-model 与 fixture tests，再做 shell UI。
- [ ] 完成字段树/筛选/详情/raw、复制与明确状态。
- [ ] 完成大 Mapping 的分页/虚拟化与解析预算。
- [ ] 包装 shell renderer + native fallback，验证安装包收录所有文件。

**完整 P0 = T1 + T2 + T3 通过验收**。若只完成 T1/T3，记录为“扩展先行切片”，不要把静态树功能标成完成。

### T4：P1 文档工作区与联动

- [ ] documents/search-model、DSL 模式、结果列/详情、窗口内分页。
- [ ] field caps 方法与冲突/unknown 能力模型。
- [ ] 完成 generic navigation 与 session-scoped 状态交接之后，才接 Mapping → Documents。
- [ ] PIT 深分页/可控取消分别作为独立子任务，不阻塞基础文档浏览。

### P2：明确延期

数据流/模板/组件模板导航、完整 alias 写管理、Mapping 有限更新、Analyze 工具、Reindex、文档编辑/批量写入、快照、通用 REST Console、ES 8/OpenSearch 兼容。每项另出权限、协议和验收设计；本次不放空按钮占位。

建议提交拆分：契约测试 → 通用树 → ES 导航/Tabs → Mapping 模型 → Mapping UI/打包 → 文档页 → field caps/跨页联动。避免把宿主、provider、UI 三层揉成不可回退的大提交。

## 12. 验证矩阵与完成标准

### 12.1 自动测试

| 层 | 必须覆盖 |
|---|---|
| Mapping parser | scalar、隐式 object、nested、multi-fields、runtime、field alias、dynamic_templates、未知类型、空定义、点号/斜杠/~ 字段、深层结构、多 concrete index、稳定 ID |
| 字段 UI | 搜索保留祖先、清空恢复展开、选中详情一致、unknown 参数保留、10000 字段不整页创建组件 |
| 树/路由 | 旧 manifest 仍可用，静态子项无网络请求，parent.name 正确，箭头不导航，行不误折叠，A/B 高亮隔离、刷新与迟到请求隔离 |
| 搜索 | 当前索引显式绑定、空目标拒绝、无效 JSON 阻止提交、body/分页冲突处理、raw envelope、总数下界、超时/部分分片失败、跨索引同 ID |
| 状态 | A 慢 B 快不串页，卸载后回调不更新，重连/同名索引重建缓存失效，403 不变空结果 |
| 权限/破坏操作 | capability 缺失与服务器 403 分开，真实确认前不发写请求，无跨连接导航/句柄复用 |
| 打包/降级 | JS 文件进包，shell 模块失败可 native fallback，旧宿主版本门禁正确 |

建议命令（实施 agent 实际执行并记录结果；本文未执行这些功能测试）：

```bash
# workspace/navop-extensions
cargo test -p elasticsearch-provider
node --test tests/scripts.test.mjs
# 新增纯函数测试后：
node --test extensions/composite/elasticsearch/tests/ui/*.test.mjs

# workspace/navop
cargo test -p extension-runtime
cargo test -p resource_view
cargo test -p universal-plugins --features shell-plugins
```

GUI 相关测试如需窗口/平台环境，按项目测试约定运行；默认 feature 未开启的测试不能计作 shell 覆盖。若现有 render harness 通过主程序测试入口执行，还要运行对应 `main --bin navop --features shell-plugins` 的精确测试过滤器。先查真实测试名，禁止报告“0 tests”命令为功能通过。

本地安装验证使用仓库现有 `scripts/install-local-composite-extensions.sh elasticsearch` 流程；先阅读脚本说明，不对用户生产连接执行创建/删除测试。

### 12.2 手工场景

1. 新开测试连接，不预加载全部 Mapping；索引总表能用。
2. 展开某索引，再点 Mapping；仅请求目标索引，字段结构正确。
3. 文档/Mapping/设置切换始终保持同一个 name；另一索引不继承错误 raw/选中字段。
4. 查找一个深层 nested 字段与一个 multi-field，能区分类型、路径与 raw。
5. 收起左树不跳页；刷新不闪空；删除测试索引后进入失效态。
6. 只读/无 Mapping 权限账号得到明确提示；仍可用的功能不被整体锁死。
7. 深/浅主题、窄窗口、键盘导航、长字段名、中文、超大 fixture 均验证。
8. 人为让 shell 加载失败，确认 native Mapping 仍可读；切页卸载不泄漏 session。

### 12.3 P0 验收清单

- [ ] 索引下确有 Mapping 入口，且全局树不默认铺开所有字段。
- [ ] 同一索引可在共享 Tabs 内切换，不丢路由上下文。
- [ ] 结构化字段视图能搜索/查看定义/复制，原始 JSON 保留且只读。
- [ ] 单索引首次打开只有一条 Mapping 数据请求，展开静态功能项零 Mapping 请求。
- [ ] 403/404/空 Mapping/搜索无匹配/超限彼此区分。
- [ ] 长列表后续对象可到达，没有静默前 200 项截断。
- [ ] 旧页面 ID、native fallback、旧 manifest 的测试通过。
- [ ] 无新增 ES 专属宿主分支、provider UI RPC、JS 直接 HTTP 或 borrowed handle 持久化。
- [ ] 提供真实自动测试结果与至少一轮本地 UI 验证记录；未执行项明确列出。

## 13. 外部参考与事实溯源

以下是官方资料入口，调研日期统一为 2026-09-16。URL 用代码文本保存，便于后续 agent 重新核对；产品文档可能继续变化，实施时以锁定的 ES 9 能力与客户端版本为准。

- **[R1] Elastic — Manage indices in Kibana**：`https://www.elastic.co/docs/manage-data/data-store/perform-index-operations`
- **[R2] Elastic — Explore fields and data with Discover**：`https://www.elastic.co/docs/explore-analyze/discover/discover-get-started`
- **[R3] Elastic — Customize the Discover view**：`https://www.elastic.co/docs/explore-analyze/discover/document-explorer`
- **[R4] Elasticvue 官方仓库 README，Features**：`https://github.com/cars10/elasticvue`
- **[R5] Dejavu 官方仓库 README，Features**：`https://github.com/appbaseio/dejavu`
- **[R6] Elastic — fields / Multi-fields**：`https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/multi-fields`
- **[R7] Elastic — Update mapping API examples**：`https://www.elastic.co/docs/manage-data/data-store/mapping/update-mappings-examples`
- **[R8] Elastic — subobjects**：`https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/subobjects`
- **[R9] Elastic — Get the field capabilities**：`https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-field-caps`
- **[R10] Elastic — The _search API，Track total hits**：`https://www.elastic.co/docs/solutions/search/the-search-api`
- **[R11] Elastic — Paginate search results**：`https://www.elastic.co/docs/reference/elasticsearch/rest-apis/paginate-search-results`
- **[R12] Elastic — Open a point in time**：`https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-open-point-in-time`

## 14. 本次交付边界

本次只新增此方案文档，不改应用/扩展源码，不安装扩展、不操作 ES 集群、不运行功能实现测试。本文中的任务、类型定义、新 API、性能目标与验收项均属于后续实现要求，不是当前产品能力声明。
