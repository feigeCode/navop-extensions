# 时序数据库 IPC 驱动基础标准

> 适用范围:Navop `database_driver` 类 IPC 扩展中的时序数据库(TDengine、Apache IoTDB 及后续接入的同类产品)。
> 本文从 TDengine 与 IoTDB 两个既有驱动的实现中提炼共性约定,作为新时序驱动评审与实现的基线。

## 1. 库列表的特有列原则

时序数据库的"库"(TDengine 的 DATABASE / IoTDB 的存储组)承载时序特有属性,库列表不能只展示 名称+备注 两列。

**原则:**

1. **名称列永远在首位**,宽度 220px 量级;后续列按数据库特有属性排列。
2. **特有属性列按探测结果动态加入,缺失列整体省略**——不同服务端版本返回的列集有差异(例如 TDengine 3.x 的 `SHOW DATABASES` 返回 `ntables/vgroups/replica/keep0/keep1/precision/status`,老版本为单 `keep` 与 `created_time`),驱动必须先做列名探测,探测不到的列不出现在视图中,而不是渲染一列空值。
3. **单行缺失值统一展示 `-`**(数值列与文本列同规则);keep 类多列可合并展示(TDengine 的 `keep0/keep1` 拼接为 `3650d,3650d`)。
4. **内置系统库在库列表中隐藏**(TDengine 的 `information_schema` / `performance_schema`)。
5. 数值属性列(表数量/副本数/VGroup 数)右对齐;枚举型短文本(精度)可居中。

**参考实现:** TDengine 驱动 `src/metadata.rs` 的 `databases_object_view`(列探测 + 动态列)与主仓 `crates/db/src/tdengine/plugin.rs` 的 `list_databases_view`。

## 2. 对象模型映射到 schema/objects

时序数据库普遍存在**超级表/子表/普通表**的层级(TDengine)或**存储组/时间序列/设备**的层级(IoTDB)。wire 协议 `schema/objects` 只有 `kind=table/view/...` 的通用对象,时序特有语义放在 `extra`:

| 时序概念 | wire 映射 |
| --- | --- |
| 超级表(STABLE) | `kind="table"` + `extra.td_kind="super"` + 列数/标签数 |
| 子表(依超级表创建) | `kind="table"` + `extra.td_kind="child"` + `extra.stable_name`(所属超级表) |
| 普通表 | `kind="table"` + `extra.td_kind="normal"` |
| 存储组(IoTDB) | `schema/databases` 的一个库 |
| 时间序列(IoTDB) | `kind="table"`,路径作为名称 |

**规则:**

- `schema/objects` 的 `database` 参数必填(或连接已 USE 当前库);时序对象的归属库不可省略。
- 创建时间写入 `created_at`;表种类、标签数、所属超级表等私有属性进 `extra`,宿主通用渲染可读。
- 不支持的对象类型(视图/索引/函数/存储过程/触发器/序列)在 `capabilities` 中如实声明为 `false`,对应 schema 方法返回空列表或 METHOD_NOT_FOUND,不虚构数据。

## 3. 元数据优先走 information_schema 再退回 SHOW

时序服务端的原生元数据接口分两层:

1. **结构化层**:`information_schema`(TDengine 的 `INS_TABLES` / `INS_STABLES`)——字段全、可过滤、跨版本列名有差异;
2. **展示层**:`SHOW` 语句(`SHOW DATABASES` / `SHOW {db}.TABLES` / `SHOW {db}.STABLES`)——老版本可用但信息少。

**标准流程:**

```
查 information_schema ──成功──▶ 按列名探测映射(probe by candidate names)
        │
        失败(老版本/权限)
        ▼
   退回 SHOW 语句,按默认种类推断(SHOW TABLES 默认普通表,所属超级表非空即子表;SHOW STABLES 默认超级表)
```

- **列名探测**必须忽略大小写与首尾空白,候选名按优先级排列(如名称列候选 `table_name → name → stable_name → stb_name`)。
- INS 查询**任一报错即整体降级**,不做半结构化混合。
- 同名冲突要清理:超级表行的"所属超级表"必须清空,避免自引用。

**参考实现:** TDengine 驱动 `src/handlers.rs` 的 `table_summaries_from_information_schema` / `table_summaries_from_show`。

## 4. 连接表单字段标准

时序驱动的 Connection 表单遵循统一字段集(键复用主仓 `database.connection.field.*` 既有惯例):

| 字段 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `name` | 是 | — | 连接名称,placeholder 体现产品名 |
| `host` | 是 | `127.0.0.1` | 主机 |
| `port` | 是 | 产品默认端口(同时写入 `ui.default_port`) | TDengine 为 6041(taosAdapter),IoTDB 为 6667 |
| `username` | 是 | 产品出厂账号(TDengine `root`) | |
| `password` | 是 | 产品出厂密码(TDengine `taosdata`) | |
| `database` | 否 | 空 | 默认库/存储组前缀,help 文案说明"留空浏览全部" |

- 端口默认值必须三处一致:`ui.default_port`、表单 `default_value`、驱动配置解析的默认端口。
- `CreateDatabase` 表单只收集 `name`(必填),语义等价 `CREATE DATABASE`(TDengine)/ `CREATE STORAGE GROUP`(IoTDB)。
- 键形态:`database.<driver_id>.connection.title`、`database.<driver_id>.database.new/delete`,通用字段键直接复用。

## 5. object view 自定义列规范

驱动在 `schema/object_view` 方法中返回 `wire_schema::ObjectView`(`title` + `columns` + `rows`),列完全由驱动自定义。宿主侧机制见主仓 `crates/db/src/ipc/plugin.rs` 的 `custom_object_view`:

- 宿主以 `optional_metadata` 调用驱动的 `schema/object_view`(带 `view` 种类与 database/schema/table 作用域);
- 驱动返回 `METHOD_NOT_FOUND` 时宿主回退默认渲染(名称+备注);因此**驱动只对真正定制的视图实现 handler**,未定制的一律报 METHOD_NOT_FOUND;
- 驱动必须在 driver.json `methods` 中声明 `schema/object_view`,否则宿主不会发起调用,特有列不生效。

**列定义规范:**

- `key` 在同一视图内唯一,用 snake_case 语义名(`tables`/`precision`/`vgroups`);
- `name` 是表头文案(wire 层不携带 i18n key,由驱动按当前语言或英文输出);
- `width_px` 数值列 80–100、名称列 200–220、时间列 180、文本长列 150–260;
- `align`:数值列 `right`,枚举短文本可 `center`,默认 `left`;
- `rows` 每行长度必须与 `columns` 一一对应(动态省略列后行列同时收窄)。

**时序驱动应实现的视图:**

| 视图 | 列(TDengine 形态) |
| --- | --- |
| `databases` | 名称 \| 表数量 \| 精度 \| 副本 \| VGroups \| Keep \| 状态 \| 创建时间(缺失列省略) |
| `tables` | 名称 \| 类型(超级表/子表/普通表) \| 列数 \| 标签数 \| 所属超级表 \| 创建时间 |
| `columns` | 名称 \| 类型 \| 备注(TAG 标记) |

## 6. 其它共性约定

- **dialect**:TDengine 类方言用反引号标识符 + `LIMIT n OFFSET m`;IoTDB 类无标识符引用。`bool_true/false` 用 `true/false` 字面量。
- **capabilities 如实声明**:时序库普遍不支持 schema/视图/触发器/存储过程/序列/自增/表空间;函数目录按产品实际(TDengine 树中不展示,`supports_functions=false`)。
- **游标分页**:查询结果经 `query/start` 建立服务端游标,`cursor/fetch` 分页拉取;`cursor/cancel` 停止取数但保留游标 id 直到 `cursor/close`。
- **连接超时**:连接握手(如 TDengine 的 `SELECT SERVER_STATUS()`)必须受 `connect_timeout` 约束并在超时时返回明确错误。
- **错误归类**:连接拒绝 → `IO_CONNECTION_REFUSED`;对象不存在 → `SQL_UNKNOWN_TABLE`;已存在 → `SQL_OBJECT_ALREADY_EXISTS`;超时 → `IO_TIMEOUT`;其余 SQL 错误 → `SQL_SYNTAX_ERROR`。
- **事务**:经典时序模型无跨语句事务,不声明 `tx/*` 方法,`exec/batch` 的 `in_transaction` 请求忽略并在 warnings 中说明。
- **参数绑定**:WebSocket 通道不支持语句级绑定(TDengine),`params` 非空直接 `INVALID_PARAMS`,提示调用方内联值。

## 7. 参考

- TDengine IPC 驱动:`extensions/ipc/tdengine/`(driver.json、src/metadata.rs、src/handlers.rs)
- Apache IoTDB IPC 驱动:`extensions/ipc/iotdb/driver.json`(declarative form + ui.actions 样本)
- 宿主 object view 机制:主仓 `crates/db/src/ipc/plugin.rs` 的 `custom_object_view`
- wire 协议类型:`extension-protocol` crate 的 `schema.rs`(ObjectView/ObjectInfo/DatabaseInfo)
