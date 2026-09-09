//! TDengine 驱动的方法处理函数集合。
//!
//! 每个 handler 接收 `params: &Value`,返回 `Result<Value, ProtocolError>`。
//! 数据面(查询/执行)与元数据面(SHOW / information_schema / DESCRIBE)委托给
//! [`crate::tdengine_session`] 与 [`crate::metadata`],handlers 只负责参数解码 /
//! 结果编码 / 错误码归类。
//!
//! 元数据映射逻辑(SHOW DATABASES 列探测、INS_TABLES/INS_STABLES 优先再降级
//! SHOW、DESCRIBE 列详情)移植自主仓 `crates/db/src/tdengine/plugin.rs`。

// ProtocolError 是 wire 契约类型,Err 类型大小固定,统一 allow。
#![allow(clippy::result_large_err)]

use extension_protocol::conn::{ConnPingParams, ConnTestParams, ConnUseParams};
use extension_protocol::ddl::{
    BuildAlterTableParams, BuildCreateTableParams, BuildDdlParams, BuildDropParams,
};
use extension_protocol::error::{ProtocolError, error_codes};
use extension_protocol::query::{
    BatchError, CursorCancelParams, CursorCloseParams, CursorFetchParams, ExecBatchParams,
    ExecBatchResult, ExecRunParams, ExecRunResult, QueryStartParams,
};
use extension_protocol::schema::{
    ColumnInfo, ColumnsParams, DatabaseInfo, DatabasesParams, ObjectInfo, ObjectKind,
    ObjectViewKind, ObjectViewParams, ObjectsParams, ViewsParams,
};
use serde_json::Value;

use crate::metadata::{
    self, TdengineTableKind, TdengineTableSummary, escape_single_quoted, is_system_database,
    tables_object_view,
};
use crate::server::{
    invalid_params, missing_param, params_deserialize_error, protocol_error_from_anyhow,
    serialize_error,
};
use crate::state::{ConnectionState, CursorState};
use crate::tdengine_session::TdSession;

/// 引用标识符:反引号包裹(与 ddl 模块一致)。
fn quote_identifier(identifier: &str) -> String {
    crate::ddl::quote_identifier(identifier)
}

/// 转义 SQL 字符串字面量中的单引号(供 information_schema 查询拼值)。
fn escape_single_quoted_value(value: &str) -> String {
    escape_single_quoted(value)
}

// ===================== Connection =====================

/// `conn/test`:建 DSN 短连 + SERVER_STATUS 握手,返回连通性与服务端版本。
pub async fn handle_conn_test(params: &Value) -> Result<Value, ProtocolError> {
    let started = std::time::Instant::now();
    let p: ConnTestParams =
        serde_json::from_value(params.clone()).map_err(params_deserialize_error)?;
    ensure_tdengine_driver(&p.driver_id)?;

    let config = crate::protocol::TdConnectionConfig::from_config_value(&p.config)
        .map_err(|e| invalid_params(format!("invalid connection config: {e}")))?;
    let session = TdSession::connect(&config)
        .await
        .map_err(|e| protocol_error_from_anyhow(error_codes::IO_CONNECTION_REFUSED, e))?;
    let server_version = session
        .server_version()
        .await
        .map_err(|e| protocol_error_from_anyhow(error_codes::SERVER_CLOSED_CONNECTION, e))?;
    session
        .ping()
        .await
        .map_err(|e| protocol_error_from_anyhow(error_codes::SERVER_CLOSED_CONNECTION, e))?;

    Ok(serde_json::json!({
        "ok": true,
        "server_version": server_version,
        "warnings": [],
        "latency_ms": started.elapsed().as_millis() as u32,
    }))
}

/// `conn/ping`:SELECT SERVER_STATUS() 计时。
pub async fn handle_conn_ping(session: &TdSession, params: &Value) -> Result<Value, ProtocolError> {
    let p: ConnPingParams =
        serde_json::from_value(params.clone()).map_err(params_deserialize_error)?;
    let _ = p;
    let started = std::time::Instant::now();
    session
        .ping()
        .await
        .map_err(|e| protocol_error_from_anyhow(error_codes::SERVER_CLOSED_CONNECTION, e))?;
    Ok(serde_json::json!({ "latency_ms": started.elapsed().as_millis() as u32 }))
}

/// `conn/use`:USE `db` 切换当前库;schema/role 无意义,直接忽略。
pub async fn handle_conn_use(session: &TdSession, params: &Value) -> Result<Value, ProtocolError> {
    let p: ConnUseParams =
        serde_json::from_value(params.clone()).map_err(params_deserialize_error)?;
    if let Some(database) = p.database.as_deref().filter(|db| !db.trim().is_empty()) {
        session
            .use_database(database.trim())
            .await
            .map_err(|e| protocol_error_from_anyhow(error_codes::SQL_OBJECT_NOT_FOUND, e))?;
    }
    Ok(Value::Null)
}

// ===================== Query / Cursor =====================

/// `query/start`:执行查询并建立内存缓冲游标。
///
/// TDengine 的 WebSocket 通道不支持语句级参数绑定(仅 stmt 接口支持),
/// `params` 非空时直接报 INVALID_PARAMS。
pub async fn handle_query_start(
    session: &TdSession,
    state: &mut ConnectionState,
    params: &Value,
) -> Result<Value, ProtocolError> {
    let p: QueryStartParams =
        serde_json::from_value(params.clone()).map_err(params_deserialize_error)?;
    if !p.params.is_empty() {
        return Err(invalid_params(
            "TDengine WebSocket channel does not support bound parameters; inline the values in SQL",
        ));
    }
    if p.sql.trim().is_empty() {
        return Err(missing_param("sql"));
    }

    let (columns, rows) = session
        .query_typed_rows(p.sql.trim())
        .await
        .map_err(ta_sql_error)?;
    let cursor_state = CursorState::new(columns.clone(), rows, p.fetch_size, p.max_rows);
    let cursor_id = state.open_cursor(cursor_state);

    Ok(serde_json::json!({
        "cursor_id": cursor_id,
        "columns": columns,
        "row_count_known": false,
        "row_count_estimate": Value::Null,
    }))
}

/// `cursor/fetch`:从缓冲弹出一页。
pub async fn handle_cursor_fetch(
    state: &mut ConnectionState,
    params: &Value,
) -> Result<Value, ProtocolError> {
    let p: CursorFetchParams =
        serde_json::from_value(params.clone()).map_err(params_deserialize_error)?;
    let cursor = state
        .get_cursor_mut(&p.cursor_id)
        .ok_or_else(|| unknown_cursor(&p.cursor_id))?;
    let n = cursor.page_size(p.n);
    let (rows, done) = cursor.fetch(n);
    Ok(serde_json::json!({ "rows": rows, "done": done }))
}

/// `cursor/close`:释放游标。
pub async fn handle_cursor_close(
    state: &mut ConnectionState,
    params: &Value,
) -> Result<Value, ProtocolError> {
    let p: CursorCloseParams =
        serde_json::from_value(params.clone()).map_err(params_deserialize_error)?;
    if !state.close_cursor(&p.cursor_id) {
        return Err(unknown_cursor(&p.cursor_id));
    }
    Ok(Value::Null)
}

/// `cursor/cancel`:丢弃剩余缓冲,保留游标 id 直到 close。
pub async fn handle_cursor_cancel(
    state: &mut ConnectionState,
    params: &Value,
) -> Result<Value, ProtocolError> {
    let p: CursorCancelParams =
        serde_json::from_value(params.clone()).map_err(params_deserialize_error)?;
    let cursor = state
        .get_cursor_mut(&p.cursor_id)
        .ok_or_else(|| unknown_cursor(&p.cursor_id))?;
    cursor.cancel();
    Ok(Value::Null)
}

// ===================== Exec =====================

/// `exec/run`:执行单条非查询语句。
pub async fn handle_exec_run(session: &TdSession, params: &Value) -> Result<Value, ProtocolError> {
    let p: ExecRunParams =
        serde_json::from_value(params.clone()).map_err(params_deserialize_error)?;
    if !p.params.is_empty() {
        return Err(invalid_params(
            "TDengine WebSocket channel does not support bound parameters; inline the values in SQL",
        ));
    }
    let result = exec_statement(session, &p.sql).await?;
    serde_json::to_value(result).map_err(serialize_error)
}

/// `exec/batch`:逐条执行;stop_on_error 控制首个错误后是否继续。
///
/// TDengine 经典模型无跨语句事务,`in_transaction` 请求被忽略并在结果
/// warnings 中说明。
pub async fn handle_exec_batch(
    session: &TdSession,
    params: &Value,
) -> Result<Value, ProtocolError> {
    let p: ExecBatchParams =
        serde_json::from_value(params.clone()).map_err(params_deserialize_error)?;

    let mut results = Vec::with_capacity(p.statements.len());
    let mut errors = Vec::new();
    for (index, sql) in p.statements.iter().enumerate() {
        match exec_statement(session, sql).await {
            Ok(mut result) => {
                if p.in_transaction {
                    result
                        .warnings
                        .push("TDengine does not support multi-statement transactions".to_string());
                }
                results.push(result);
            }
            Err(error) => {
                results.push(ExecRunResult::default());
                errors.push(BatchError {
                    index: index as u32,
                    code: error.code,
                    message: error.message,
                });
                if p.stop_on_error {
                    break;
                }
            }
        }
    }
    serde_json::to_value(ExecBatchResult { results, errors }).map_err(serialize_error)
}

async fn exec_statement(session: &TdSession, sql: &str) -> Result<ExecRunResult, ProtocolError> {
    if sql.trim().is_empty() {
        return Err(invalid_params("sql must not be empty"));
    }
    let affected = session.exec(sql.trim()).await.map_err(ta_sql_error)?;
    Ok(ExecRunResult {
        affected_rows: affected,
        last_insert_id: None,
        warnings: Vec::new(),
    })
}

// ===================== Schema =====================

/// `schema/databases`:SHOW DATABASES → 库摘要(过滤内置系统库)。
///
/// SHOW DATABASES 3.x 返回 name/ntables/precision/replica/vgroups/keep0/keep1/
/// status 等多列,按列名探测填充;wire `DatabaseInfo` 的固定字段之外,TD 特有
/// 属性(table_count/keep 等)放入 `extra`,供详情面板与对象视图使用。
pub async fn handle_schema_databases(
    session: &TdSession,
    params: &Value,
) -> Result<Value, ProtocolError> {
    let p: DatabasesParams =
        serde_json::from_value(params.clone()).map_err(params_deserialize_error)?;
    let _ = p;

    let (columns, rows) = session
        .query_table("SHOW DATABASES", "list databases")
        .await
        .map_err(ta_sql_error)?;
    let databases = metadata::summarize_databases(&columns, &rows);

    let infos: Vec<DatabaseInfo> = databases
        .into_iter()
        .map(|db| DatabaseInfo {
            name: db.name.clone(),
            // TDengine 无库引擎概念,统一展示为 TDengine(与主仓 list_databases_detailed 一致)。
            charset: Some("TDengine".to_string()),
            collation: None,
            comment: String::new(),
            owner: None,
            size_bytes: None,
            extra: serde_json::json!({
                "table_count": db.table_count,
                "precision": db.precision,
                "replica": db.replica,
                "vgroups": db.vgroups,
                "keep": db.keep,
                "status": db.status,
                "create_time": db.create_time,
            }),
        })
        .collect();
    serde_json::to_value(infos).map_err(serialize_error)
}

/// `schema/objects`:库下超级表/子表/普通表。
///
/// 优先 `information_schema.INS_TABLES` + `INS_STABLES`(含表类型/列数/标签数/
/// 所属超级表),查询报错时降级 `SHOW {db}.TABLES` + `SHOW {db}.STABLES`。
/// 表种类写入 extra.td_kind(super/child/normal)。
pub async fn handle_schema_objects(
    session: &TdSession,
    params: &Value,
) -> Result<Value, ProtocolError> {
    let p: ObjectsParams =
        serde_json::from_value(params.clone()).map_err(params_deserialize_error)?;
    if !p.kinds.is_empty() && !p.kinds.contains(&ObjectKind::Table) {
        // TDengine 只有表对象;其它 kind 视为不支持。
        return Err(method_not_found(format!(
            "schema/objects only supports kind `table` for TDengine (requested {:?})",
            p.kinds
        )));
    }
    let database = resolve_database(session, p.database.as_deref()).await?;

    let summaries = table_summaries(session, &database).await?;
    let objects: Vec<ObjectInfo> = summaries
        .into_iter()
        .map(|table| {
            let TdengineTableSummary {
                name,
                kind,
                column_count,
                tag_count,
                stable_name,
                create_time,
            } = table;
            ObjectInfo {
                name,
                kind: ObjectKind::Table,
                schema: String::new(),
                comment: String::new(),
                row_count_estimate: None,
                size_bytes: None,
                created_at: create_time,
                updated_at: None,
                extra: serde_json::json!({
                    "td_kind": kind.wire_tag(),
                    "column_count": column_count,
                    "tag_count": tag_count,
                    "stable_name": stable_name,
                }),
            }
        })
        .collect();
    serde_json::to_value(objects).map_err(serialize_error)
}

/// 表列表摘要:优先 information_schema,失败时降级 SHOW 方案。
/// 移植自主仓 `TdenginePlugin::table_summaries`。
pub async fn table_summaries(
    session: &TdSession,
    database: &str,
) -> Result<Vec<TdengineTableSummary>, ProtocolError> {
    // information_schema.INS_TABLES/INS_STABLES 含表类型/列数/标签数等富元数据,
    // 老版本或权限不足时查询报错,整体降级到 SHOW 方案。
    if let Ok(summaries) = table_summaries_from_information_schema(session, database).await {
        return Ok(summaries);
    }
    table_summaries_from_show(session, database).await
}

/// information_schema 路径:INS_TABLES(普通表/子表,部分版本含超级表行)
/// + INS_STABLES(超级表,含列数/标签数);任一查询报错即返回 Err 交给上层降级。
async fn table_summaries_from_information_schema(
    session: &TdSession,
    database: &str,
) -> Result<Vec<TdengineTableSummary>, ProtocolError> {
    let literal = escape_single_quoted_value(database);
    let (tables_columns, tables_rows) = session
        .query_table(
            &format!("SELECT * FROM information_schema.INS_TABLES WHERE db_name = '{literal}'"),
            "list tables from information_schema",
        )
        .await
        .map_err(ta_sql_error)?;
    let (stables_columns, stables_rows) = session
        .query_table(
            &format!("SELECT * FROM information_schema.INS_STABLES WHERE db_name = '{literal}'"),
            "list stables from information_schema",
        )
        .await
        .map_err(ta_sql_error)?;

    let tables_index = metadata::probe_table_columns(&tables_columns);
    let stables_index = metadata::probe_table_columns(&stables_columns);
    let tables = metadata::map_table_rows(&tables_index, &tables_rows, TdengineTableKind::Normal);
    let stables = metadata::map_table_rows(&stables_index, &stables_rows, TdengineTableKind::Super);

    // 超级表以 INS_STABLES 为准,创建时间/列数缺失时从 INS_TABLES 的超级表行回填。
    let mut summaries: Vec<TdengineTableSummary> = Vec::new();
    let mut seen_supers: std::collections::HashSet<String> = std::collections::HashSet::new();
    for mut stable in stables {
        if let Some(row) = tables
            .iter()
            .find(|t| t.kind == TdengineTableKind::Super && t.name == stable.name)
        {
            if stable.create_time.is_none() {
                stable.create_time = row.create_time.clone();
            }
            if stable.column_count.is_none() {
                stable.column_count = row.column_count;
            }
        }
        seen_supers.insert(stable.name.clone());
        summaries.push(stable);
    }
    // INS_TABLES 中出现而 INS_STABLES 未覆盖的超级表行(理论上少见)也保留。
    for table in &tables {
        if table.kind == TdengineTableKind::Super && !seen_supers.contains(&table.name) {
            seen_supers.insert(table.name.clone());
            summaries.push(table.clone());
        }
    }
    // 普通表/子表。
    summaries.extend(
        tables
            .into_iter()
            .filter(|t| t.kind != TdengineTableKind::Super),
    );

    summaries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(summaries)
}

/// SHOW 降级路径:普通表/子表来自 SHOW {db}.TABLES,超级表来自 SHOW {db}.STABLES。
async fn table_summaries_from_show(
    session: &TdSession,
    database: &str,
) -> Result<Vec<TdengineTableSummary>, ProtocolError> {
    let db = quote_identifier(database);
    let (tables_columns, tables_rows) = session
        .query_table(&format!("SHOW {db}.TABLES"), "list tables")
        .await
        .map_err(ta_sql_error)?;
    let (stables_columns, stables_rows) = session
        .query_table(&format!("SHOW {db}.STABLES"), "list stables")
        .await
        .map_err(ta_sql_error)?;

    let mut summaries = metadata::map_table_rows(
        &metadata::probe_table_columns(&tables_columns),
        &tables_rows,
        TdengineTableKind::Normal,
    );
    summaries.extend(metadata::map_table_rows(
        &metadata::probe_table_columns(&stables_columns),
        &stables_rows,
        TdengineTableKind::Super,
    ));

    summaries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(summaries)
}

/// `schema/columns`:DESCRIBE `db`.`table` → 列详情。
///
/// DESCRIBE 返回 field/type/length/note,note 为 TAG 时表示超级表标签列;
/// 变长类型补上宽度(如 BINARY(16)),与主仓 `list_columns` 一致。
pub async fn handle_schema_columns(
    session: &TdSession,
    params: &Value,
) -> Result<Value, ProtocolError> {
    let p: ColumnsParams =
        serde_json::from_value(params.clone()).map_err(params_deserialize_error)?;
    if p.table.trim().is_empty() {
        return Err(missing_param("table"));
    }
    let database = resolve_database(session, p.database.as_deref()).await?;

    let sql = format!(
        "DESCRIBE {}.{}",
        quote_identifier(&database),
        quote_identifier(p.table.trim())
    );
    let (_, rows) = session
        .query_table(&sql, "list columns")
        .await
        .map_err(ta_sql_error)?;

    let mut columns = Vec::new();
    for (index, row) in rows.iter().enumerate() {
        let Some(name) = row.first().and_then(|value| value.clone()) else {
            continue;
        };
        let raw_type = row
            .get(1)
            .and_then(|value| value.clone())
            .unwrap_or_default();
        let length = row
            .get(2)
            .and_then(|value| value.clone())
            .and_then(|value| value.trim().parse::<u32>().ok())
            .unwrap_or(0);
        let note = row.get(3).and_then(|value| value.clone());

        // 变长类型补上宽度,例如 BINARY(16),与 DESCRIBE 语义保持一致。
        let data_type = if length > 0 && metadata::tdengine_type_takes_width(&raw_type) {
            format!("{}({})", raw_type.to_uppercase(), length)
        } else {
            raw_type.to_uppercase()
        };

        columns.push(ColumnInfo {
            ordinal: (index + 1) as u32,
            name,
            raw_type: Some(data_type.clone()),
            type_str: semantic_type_of(&data_type),
            // TDengine 普通列均可为 NULL(时间戳列除外),按可空处理。
            nullable: true,
            default: None,
            is_primary: index == 0 && data_type.eq_ignore_ascii_case("TIMESTAMP"),
            is_unique: false,
            is_partition_key: false,
            is_clustering_key: false,
            max_length: if length > 0 { Some(length) } else { None },
            precision: None,
            scale: None,
            // note 列为 TAG 时标记为标签列。
            comment: note.unwrap_or_default(),
            extra: Value::Null,
        });
    }

    serde_json::to_value(columns).map_err(serialize_error)
}

/// `schema/views`:TDengine 不支持视图,返回空列表。
pub async fn handle_schema_views(
    _session: &TdSession,
    params: &Value,
) -> Result<Value, ProtocolError> {
    let p: ViewsParams =
        serde_json::from_value(params.clone()).map_err(params_deserialize_error)?;
    let _ = p;
    Ok(serde_json::json!([]))
}

/// `schema/object_view`:TD 特有列视图。
///
/// - databases:名称|表数量|精度|副本|VGroups|Keep(keep0/keep1 合并)|状态|创建时间,
///   缺失列自动省略(照主仓 `list_databases_view` 逻辑);
/// - tables:名称|类型|列数|标签数|所属超级表|创建时间(照 `list_tables_view`);
/// - columns:名称|类型|备注(照 `list_columns_view`);
/// - 其它视图类型报 METHOD_NOT_FOUND,宿主回退默认渲染。
pub async fn handle_schema_object_view(
    session: &TdSession,
    params: &Value,
) -> Result<Value, ProtocolError> {
    let p: ObjectViewParams =
        serde_json::from_value(params.clone()).map_err(params_deserialize_error)?;
    let view = match p.view {
        ObjectViewKind::Databases => {
            let (columns, rows) = session
                .query_table("SHOW DATABASES", "list databases")
                .await
                .map_err(ta_sql_error)?;
            metadata::databases_object_view(&columns, &rows)
        }
        ObjectViewKind::Tables => {
            let database = resolve_database(session, p.database.as_deref()).await?;
            let tables = table_summaries(session, &database).await?;
            tables_object_view(&tables)
        }
        ObjectViewKind::Columns => {
            let table = p.table.clone().unwrap_or_default();
            if table.trim().is_empty() {
                return Err(missing_param("table"));
            }
            let columns_params = serde_json::json!({
                "conn_id": p.conn_id,
                "database": p.database,
                "schema": p.schema,
                "table": table,
            });
            let columns: Vec<ColumnInfo> =
                serde_json::from_value(handle_schema_columns(session, &columns_params).await?)
                    .map_err(params_deserialize_error)?;
            columns_object_view(&columns)
        }
        other => {
            return Err(method_not_found(format!(
                "TDengine driver does not provide object view `{}`",
                other.as_str()
            )));
        }
    };
    serde_json::to_value(view).map_err(serialize_error)
}

/// 列详情对象视图:名称|类型|备注(照主仓 `list_columns_view` 的列形态)。
fn columns_object_view(columns: &[ColumnInfo]) -> extension_protocol::schema::ObjectView {
    use extension_protocol::schema::{ObjectView, ObjectViewColumn};

    let rows: Vec<Vec<String>> = columns
        .iter()
        .map(|col| {
            vec![
                col.name.clone(),
                col.raw_type.clone().unwrap_or_else(|| col.type_str.clone()),
                col.comment.clone(),
            ]
        })
        .collect();
    ObjectView {
        title: "Columns".to_string(),
        columns: vec![
            ObjectViewColumn {
                key: "name".to_string(),
                name: "Name".to_string(),
                width_px: Some(180.0),
                align: None,
            },
            ObjectViewColumn {
                key: "type".to_string(),
                name: "Type".to_string(),
                width_px: Some(180.0),
                align: None,
            },
            ObjectViewColumn {
                key: "comment".to_string(),
                name: "Comment".to_string(),
                width_px: Some(160.0),
                align: None,
            },
        ],
        rows,
    }
}

// ===================== DDL builder =====================

pub fn handle_ddl_build(params: &Value) -> Result<Value, ProtocolError> {
    let p: BuildDdlParams =
        serde_json::from_value(params.clone()).map_err(params_deserialize_error)?;
    let result = crate::ddl::build_ddl(p).map_err(invalid_params)?;
    serde_json::to_value(result).map_err(serialize_error)
}

pub fn handle_ddl_build_create_table(params: &Value) -> Result<Value, ProtocolError> {
    let p: BuildCreateTableParams =
        serde_json::from_value(params.clone()).map_err(params_deserialize_error)?;
    serde_json::to_value(crate::ddl::build_create_table(p)).map_err(serialize_error)
}

pub fn handle_ddl_build_alter_table(params: &Value) -> Result<Value, ProtocolError> {
    let p: BuildAlterTableParams =
        serde_json::from_value(params.clone()).map_err(params_deserialize_error)?;
    let result = crate::ddl::build_alter_table(p).map_err(invalid_params)?;
    serde_json::to_value(result).map_err(serialize_error)
}

pub fn handle_ddl_build_drop(params: &Value) -> Result<Value, ProtocolError> {
    let p: BuildDropParams =
        serde_json::from_value(params.clone()).map_err(params_deserialize_error)?;
    serde_json::to_value(crate::ddl::build_drop(p)).map_err(serialize_error)
}

// ===================== Helpers =====================

/// 校验 driver_id 必须是 tdengine。
pub fn ensure_tdengine_driver(driver_id: &str) -> Result<(), ProtocolError> {
    if driver_id != "tdengine" {
        return Err(invalid_params(format!(
            "unsupported driver_id `{driver_id}` (this driver only handles `tdengine`)"
        )));
    }
    Ok(())
}

/// 解析对象查询的目标库:显式 database 优先,否则取连接当前库。
/// 当前库为空(未 USE)时报 invalid_params——TDengine 的表必须隶属某个库。
async fn resolve_database(
    session: &TdSession,
    database: Option<&str>,
) -> Result<String, ProtocolError> {
    if let Some(database) = database.filter(|db| !db.trim().is_empty()) {
        return Ok(database.trim().to_string());
    }
    let current = session.current_database().await.map_err(ta_sql_error)?;
    current.filter(|db| !is_system_database(db)).ok_or_else(|| {
        invalid_params("database is required: no database selected on this connection")
    })
}

/// taos 查询错误 → 按文本归类错误码的 ProtocolError。
fn ta_sql_error(error: anyhow::Error) -> ProtocolError {
    let code = classify_tdengine_error(&error.to_string());
    protocol_error_from_anyhow(code, error)
}

/// TDengine 服务端错误文本的保守归类(表不存在/语法错误/连接失败)。
fn classify_tdengine_error(message: &str) -> i32 {
    let lower = message.to_ascii_lowercase();
    if lower.contains("failed to connect") || lower.contains("connection refused") {
        error_codes::IO_CONNECTION_REFUSED
    } else if lower.contains("does not exist") || lower.contains("not exist") {
        error_codes::SQL_UNKNOWN_TABLE
    } else if lower.contains("already exists") {
        error_codes::SQL_OBJECT_ALREADY_EXISTS
    } else if lower.contains("timeout") || lower.contains("timed out") {
        error_codes::IO_TIMEOUT
    } else {
        error_codes::SQL_SYNTAX_ERROR
    }
}

fn unknown_cursor(id: &str) -> ProtocolError {
    ProtocolError::new(
        error_codes::UNKNOWN_CURSOR_ID,
        format!("unknown cursor_id `{id}`"),
    )
}

fn method_not_found(message: impl Into<String>) -> ProtocolError {
    ProtocolError::new(error_codes::METHOD_NOT_FOUND, message)
}

/// DESCRIBE 原始类型 → wire 语义类型(粗粒度)。
fn semantic_type_of(data_type: &str) -> String {
    // wire ColumnInfo.type 按驱动原始类型文本回传(宿主按 raw_type 优先展示),
    // 这里直接复用大写类型名,避免再引入一层有损映射。
    data_type.to_string()
}
