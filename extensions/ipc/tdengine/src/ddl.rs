//! TDengine 方言的 DDL 构造(`ddl/build*`)。
//!
//! SQL 模式移植自主仓 `crates/db/src/tdengine/plugin.rs`:
//! - 标识符用反引号引用(`` `name` ``),与 MySQL 方言对齐;
//! - TDengine 不支持列注释/列默认值/主键约束/二级索引/外键,这些声明一律
//!   忽略并汇入 warnings,而不是生成非法 SQL;
//! - 库(schema 的 TDengine 等价物)管理:CREATE DATABASE / DROP DATABASE IF EXISTS;
//! - ALTER 仅支持 ADD COLUMN / DROP COLUMN / MODIFY COLUMN(变长列改宽度)。

use extension_protocol::ddl::{
    BuildAlterTableParams, BuildAlterTableResult, BuildCreateTableParams, BuildCreateTableResult,
    BuildDdlParams, BuildDdlResult, BuildDropParams, BuildDropResult, ColumnRenameSpec, ColumnSpec,
    DdlBuildOp, TableSpec,
};
use extension_protocol::schema::ObjectKind;
use serde_json::Value;

/// TDengine 标识符引用:反引号包裹,内部反引号成对转义。
/// 与主仓 `TdenginePlugin::quote_identifier` 一致。
pub fn quote_identifier(identifier: &str) -> String {
    format!("`{}`", identifier.replace('`', "``"))
}

/// 限定表名:库名存在时输出 `` `db`.`table` ``。
/// wire `TableSpec.schema` 在 TDengine 中无意义,优先取 `database` 字段。
fn table_reference(spec: &TableSpec) -> String {
    let database = spec.database.as_deref().filter(|d| !d.trim().is_empty());
    match database {
        Some(database) => format!(
            "{}.{}",
            quote_identifier(database),
            quote_identifier(&spec.name)
        ),
        None => quote_identifier(&spec.name),
    }
}

/// `ddl/build` 分发:按 op 解码 payload 后走对应构造器。
pub fn build_ddl(params: BuildDdlParams) -> Result<BuildDdlResult, String> {
    match params.op {
        DdlBuildOp::CreateTable => {
            let (result, warnings) = build_create_table_inner(decode_payload(params.payload)?);
            Ok(BuildDdlResult {
                statements: result.statements,
                warnings,
            })
        }
        DdlBuildOp::AlterTable => {
            let result = build_alter_table(decode_payload(params.payload)?)?;
            Ok(BuildDdlResult {
                statements: result.statements,
                warnings: result.warnings,
            })
        }
        DdlBuildOp::DropTable => {
            let result = build_drop(decode_drop_payload(params.payload, ObjectKind::Table)?);
            Ok(single_statement(result.sql))
        }
        DdlBuildOp::DropView => {
            let result = build_drop(decode_drop_payload(params.payload, ObjectKind::View)?);
            Ok(single_statement(result.sql))
        }
        DdlBuildOp::CreateDatabase | DdlBuildOp::CreateSchema => {
            Ok(single_statement(build_create_database(params.payload)?))
        }
        DdlBuildOp::DropDatabase | DdlBuildOp::DropSchema => {
            Ok(single_statement(build_drop_database(params.payload)?))
        }
        DdlBuildOp::ModifyDatabase => Ok(single_statement(build_modify_database(params.payload)?)),
        DdlBuildOp::RenameTable => Ok(single_statement(build_rename_table(params.payload)?)),
        DdlBuildOp::TruncateTable => Ok(single_statement(build_truncate_table(params.payload)?)),
        DdlBuildOp::ColumnDefinition => {
            let column: ColumnSpec = decode_payload(params.payload)?;
            Ok(single_statement(column_definition(&column)))
        }
        op => Err(format!(
            "ddl/build op `{op:?}` is not implemented for TDengine"
        )),
    }
}

/// CREATE TABLE:列定义 + IF NOT_EXISTS;主键/索引/外键/注释/临时表不支持,warnings 说明。
/// wire `BuildCreateTableResult` 不携带 warnings,由 `ddl/build` 路径经
/// [`build_create_table_inner`] 汇入 `BuildDdlResult.warnings`。
pub fn build_create_table(params: BuildCreateTableParams) -> BuildCreateTableResult {
    build_create_table_inner(params).0
}

fn build_create_table_inner(
    params: BuildCreateTableParams,
) -> (BuildCreateTableResult, Vec<String>) {
    let table = table_reference(&params.spec);
    let definitions: Vec<String> = params
        .spec
        .columns
        .iter()
        .map(|column| format!("  {}", column_definition(column)))
        .collect();

    let if_not_exists = if params.options.if_not_exists {
        " IF NOT EXISTS"
    } else {
        ""
    };
    let sql = format!(
        "CREATE TABLE{if_not_exists} {table} (\n{}\n)",
        definitions.join(",\n")
    );
    let statements = vec![sql.clone()];

    // TDengine 经典模型无二级索引/外键/表注释,声明存在时给出 warnings。
    let mut warnings = Vec::new();
    if params.options.temporary {
        warnings.push("TDengine does not support temporary tables".to_string());
    }
    if !params.spec.primary_key.is_empty() || params.spec.columns.iter().any(|c| c.is_primary) {
        warnings.push(
            "TDengine uses the first TIMESTAMP column as the primary key; primary key declarations are ignored"
                .to_string(),
        );
    }
    if params.options.with_indexes && !params.spec.indexes.is_empty() {
        warnings.push(
            "TDengine does not support secondary indexes; index declarations are ignored"
                .to_string(),
        );
    }
    if params.options.with_foreign_keys && !params.spec.foreign_keys.is_empty() {
        warnings.push(
            "TDengine does not support foreign keys; foreign key declarations are ignored"
                .to_string(),
        );
    }
    if params.options.with_comments && !params.spec.comment.trim().is_empty() {
        warnings.push("TDengine does not support table comments; comment is ignored".to_string());
    }
    if params.spec.columns.iter().any(|c| c.auto_increment) {
        warnings.push("TDengine does not support auto increment columns".to_string());
    }
    (BuildCreateTableResult { sql, statements }, warnings)
}

/// ALTER TABLE:列的增删改(与主仓 `build_alter_table_sql` 语义一致)。
pub fn build_alter_table(params: BuildAlterTableParams) -> Result<BuildAlterTableResult, String> {
    let table = table_reference(&params.to_spec);
    let mut statements = Vec::new();
    let mut warnings = Vec::new();

    if !params.column_renames.is_empty() {
        // TDengine 表设计器不支持列重命名(与主仓行为一致),提示手动处理。
        for rename in &params.column_renames {
            warnings.push(format!(
                "TDengine does not support renaming column `{}` to `{}` via the designer; adjust it manually",
                rename.old_name, rename.new_name
            ));
        }
    }

    let renamed_old: std::collections::HashSet<&str> = params
        .column_renames
        .iter()
        .map(|ColumnRenameSpec { old_name, .. }| old_name.as_str())
        .collect();

    if params.options.allow_destructive {
        for column in &params.from_spec.columns {
            if renamed_old.contains(column.name.as_str()) {
                continue;
            }
            if params
                .to_spec
                .columns
                .iter()
                .all(|new| new.name != column.name)
            {
                statements.push(format!(
                    "ALTER TABLE {table} DROP COLUMN {};",
                    quote_identifier(&column.name)
                ));
            }
        }
    } else {
        let dropped = params
            .from_spec
            .columns
            .iter()
            .filter(|old| {
                !renamed_old.contains(old.name.as_str())
                    && params
                        .to_spec
                        .columns
                        .iter()
                        .all(|new| new.name != old.name)
            })
            .count();
        if dropped > 0 {
            warnings.push(format!(
                "{dropped} column(s) would be dropped; enable allow_destructive to generate DROP COLUMN statements"
            ));
        }
    }

    for column in &params.to_spec.columns {
        match params
            .from_spec
            .columns
            .iter()
            .find(|old| old.name == column.name)
        {
            Some(old) => {
                if normalized_type(old) != normalized_type(column) {
                    // TDengine 仅支持修改变长列的宽度,统一输出 MODIFY COLUMN。
                    statements.push(format!(
                        "ALTER TABLE {table} MODIFY COLUMN {} {};",
                        quote_identifier(&column.name),
                        normalized_type(column)
                    ));
                }
            }
            None => {
                statements.push(format!(
                    "ALTER TABLE {table} ADD COLUMN {};",
                    column_definition(column)
                ));
            }
        }
    }

    if statements.is_empty() && warnings.is_empty() {
        warnings.push("No changes detected".to_string());
    }

    // TDengine 无事务,不生成回滚脚本。
    Ok(BuildAlterTableResult {
        statements,
        rollback_statements: Vec::new(),
        warnings,
    })
}

/// DROP TABLE / DROP VIEW(视图不支持,生成注释提示)。
pub fn build_drop(params: BuildDropParams) -> BuildDropResult {
    match params.kind {
        ObjectKind::View | ObjectKind::MaterializedView => BuildDropResult {
            // TDengine 不支持视图,输出注释提示(照主仓 backup 的处理模式)。
            sql: format!(
                "-- TDengine does not support views; nothing to drop for '{}'",
                params.name
            ),
        },
        _ => {
            let if_exists = if params.if_exists { " IF EXISTS" } else { "" };
            let database = params
                .database
                .as_deref()
                .or(params.schema.as_deref())
                .filter(|d| !d.trim().is_empty());
            let qualified = match database {
                Some(database) => format!(
                    "{}.{}",
                    quote_identifier(database),
                    quote_identifier(&params.name)
                ),
                None => quote_identifier(&params.name),
            };
            BuildDropResult {
                sql: format!("DROP TABLE{if_exists} {qualified}"),
            }
        }
    }
}

/// 列定义:`` `name` TYPE ``(TD 不支持列注释/默认值/非空约束,忽略之)。
/// 与主仓 `build_column_def` 一致,unsigned 拼接在类型尾部。
pub fn column_definition(column: &ColumnSpec) -> String {
    format!(
        "{} {}",
        quote_identifier(&column.name),
        normalized_type(column)
    )
}

/// 归一化类型文本:大写 + 无符号后缀(wire 层 `BIGINT UNSIGNED` 保持原样)。
fn normalized_type(column: &ColumnSpec) -> String {
    column.type_str.trim().to_ascii_uppercase()
}

fn decode_payload<T>(payload: Value) -> Result<T, String>
where
    T: serde::de::DeserializeOwned,
{
    serde_json::from_value(payload).map_err(|error| error.to_string())
}

fn decode_drop_payload(mut payload: Value, kind: ObjectKind) -> Result<BuildDropParams, String> {
    if let Value::Object(ref mut object) = payload {
        object.insert("kind".to_string(), serde_json::to_value(kind).unwrap());
    }
    decode_payload(payload)
}

fn single_statement(sql: String) -> BuildDdlResult {
    BuildDdlResult {
        statements: vec![sql],
        warnings: Vec::new(),
    }
}

#[derive(serde::Deserialize)]
struct DatabaseDdlPayload {
    name: Option<String>,
    database: Option<String>,
    database_name: Option<String>,
}

#[derive(serde::Deserialize)]
struct RenameTablePayload {
    database: Option<String>,
    schema: Option<String>,
    name: Option<String>,
    old_name: Option<String>,
    table: Option<String>,
    new_name: Option<String>,
    to: Option<String>,
}

#[derive(serde::Deserialize)]
struct TableDdlPayload {
    name: Option<String>,
    table: Option<String>,
}

/// CREATE DATABASE `name`(TDengine 的库即 schema 的等价物)。
fn build_create_database(payload: Value) -> Result<String, String> {
    let payload: DatabaseDdlPayload = decode_payload(payload)?;
    let name = payload
        .name
        .or(payload.database)
        .or(payload.database_name)
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| "database name is required".to_string())?;
    Ok(format!("CREATE DATABASE {}", quote_identifier(name.trim())))
}

/// DROP DATABASE IF EXISTS `name`。
///
/// 与主仓 `build_drop_database_sql` 一致,删除幂等:始终携带 IF EXISTS
/// (wire 的 `if_exists` 标志对库删除路径视为默认开启)。
fn build_drop_database(payload: Value) -> Result<String, String> {
    let payload: DatabaseDdlPayload = decode_payload(payload)?;
    let name = payload
        .name
        .or(payload.database)
        .or(payload.database_name)
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| "database name is required".to_string())?;
    Ok(format!(
        "DROP DATABASE IF EXISTS {}",
        quote_identifier(name.trim())
    ))
}

/// ALTER DATABASE 需要显式选项(KEEP/PRECISION 等),表单未收集,输出注释提示。
/// 与主仓 `build_modify_database_sql` 一致。
fn build_modify_database(payload: Value) -> Result<String, String> {
    let payload: DatabaseDdlPayload = decode_payload(payload)?;
    let name = payload
        .name
        .or(payload.database)
        .or(payload.database_name)
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| "database name is required".to_string())?;
    Ok(format!(
        "-- TDengine: use `ALTER DATABASE {} ...` to adjust options",
        name.trim()
    ))
}

/// ALTER TABLE `db`.`old` RENAME TO `new`(与主仓 `rename_table` 一致)。
fn build_rename_table(payload: Value) -> Result<String, String> {
    let payload: RenameTablePayload = decode_payload(payload)?;
    let old_name = payload
        .old_name
        .or_else(|| payload.table.clone())
        .or_else(|| payload.name.clone())
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| "table name is required".to_string())?;
    let new_name = payload
        .new_name
        .or(payload.to)
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| "new table name is required".to_string())?;
    let database = payload
        .database
        .or(payload.schema)
        .filter(|name| !name.trim().is_empty());
    let table = match database {
        Some(database) => format!(
            "{}.{}",
            quote_identifier(database.trim()),
            quote_identifier(old_name.trim())
        ),
        None => quote_identifier(old_name.trim()),
    };
    Ok(format!(
        "ALTER TABLE {table} RENAME TO {}",
        quote_identifier(new_name.trim())
    ))
}

/// TDengine 经典模型无 TRUNCATE TABLE,输出注释提示手动清理。
fn build_truncate_table(payload: Value) -> Result<String, String> {
    let payload: TableDdlPayload = decode_payload(payload)?;
    let table = payload
        .table
        .or(payload.name)
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| "table name is required".to_string())?;
    Ok(format!(
        "-- TDengine does not support TRUNCATE TABLE for '{table}', drop and recreate the table instead"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use extension_protocol::ddl::{AlterTableOptions, CreateTableOptions};

    fn column(name: &str, type_str: &str) -> ColumnSpec {
        ColumnSpec {
            name: name.to_string(),
            type_str: type_str.to_string(),
            ..Default::default()
        }
    }

    fn table_spec(name: &str, database: Option<&str>, columns: Vec<ColumnSpec>) -> TableSpec {
        TableSpec {
            name: name.to_string(),
            database: database.map(str::to_string),
            columns,
            ..Default::default()
        }
    }

    // === 以下 SQL 模式单测对齐主仓 plugin.rs 的 DDL 测试 ===

    #[test]
    fn test_quote_identifier() {
        assert_eq!(quote_identifier("orders"), "`orders`");
        assert_eq!(quote_identifier("my`db"), "`my``db`");
    }

    #[test]
    fn test_create_database_sql() {
        let result = build_ddl(BuildDdlParams {
            conn_id: None,
            op: DdlBuildOp::CreateDatabase,
            payload: serde_json::json!({ "database_name": "metrics" }),
        })
        .unwrap();
        assert_eq!(
            result.statements,
            vec!["CREATE DATABASE `metrics`".to_string()]
        );
    }

    #[test]
    fn test_drop_database_sql() {
        let result = build_ddl(BuildDdlParams {
            conn_id: None,
            op: DdlBuildOp::DropDatabase,
            payload: serde_json::json!({ "name": "log_db" }),
        })
        .unwrap();
        assert_eq!(
            result.statements,
            vec!["DROP DATABASE IF EXISTS `log_db`".to_string()]
        );
    }

    #[test]
    fn test_rename_table_sql() {
        let result = build_ddl(BuildDdlParams {
            conn_id: None,
            op: DdlBuildOp::RenameTable,
            payload: serde_json::json!({ "database": "db1", "old_name": "t1", "new_name": "t2" }),
        })
        .unwrap();
        assert_eq!(
            result.statements,
            vec!["ALTER TABLE `db1`.`t1` RENAME TO `t2`".to_string()]
        );
    }

    #[test]
    fn test_build_create_table_sql() {
        let result = build_create_table(BuildCreateTableParams {
            conn_id: None,
            spec: table_spec(
                "meters",
                None,
                vec![column("ts", "TIMESTAMP"), column("current", "FLOAT")],
            ),
            options: CreateTableOptions::default(),
        });
        assert_eq!(
            result.sql,
            "CREATE TABLE `meters` (\n  `ts` TIMESTAMP,\n  `current` FLOAT\n)"
        );
        assert_eq!(result.statements, vec![result.sql.clone()]);
    }

    #[test]
    fn test_build_create_table_uses_database_qualifier() {
        let result = build_create_table(BuildCreateTableParams {
            conn_id: None,
            spec: table_spec("meters", Some("power_db"), vec![column("ts", "TIMESTAMP")]),
            options: CreateTableOptions::default(),
        });
        assert!(result.sql.starts_with("CREATE TABLE `power_db`.`meters`"));
    }

    #[test]
    fn test_build_create_table_warns_on_unsupported_declarations() {
        let mut spec = table_spec("meters", None, vec![column("id", "INT")]);
        spec.columns[0].is_primary = true;
        spec.indexes.push(extension_protocol::ddl::IndexSpec {
            name: "idx".into(),
            columns: vec!["id".into()],
            ..Default::default()
        });
        let (_result, warnings) = build_create_table_inner(BuildCreateTableParams {
            conn_id: None,
            spec,
            options: CreateTableOptions::default(),
        });
        assert!(warnings.iter().any(|w| w.contains("primary key")));
        assert!(warnings.iter().any(|w| w.contains("secondary indexes")));
    }

    #[test]
    fn test_column_definition_appends_unsigned() {
        let mut col = column("value", "BIGINT");
        col.type_str = "BIGINT UNSIGNED".to_string();
        assert_eq!(column_definition(&col), "`value` BIGINT UNSIGNED");
    }

    #[test]
    fn test_build_alter_table_add_drop_modify() {
        let from = table_spec(
            "meters",
            None,
            vec![
                column("ts", "TIMESTAMP"),
                column("old", "INT"),
                column("note", "VARCHAR(8)"),
            ],
        );
        let to = table_spec(
            "meters",
            None,
            vec![
                column("ts", "TIMESTAMP"),
                column("note", "VARCHAR(16)"),
                column("volt", "FLOAT"),
            ],
        );
        let result = build_alter_table(BuildAlterTableParams {
            conn_id: None,
            from_spec: from,
            to_spec: to,
            column_renames: Vec::new(),
            options: AlterTableOptions {
                allow_destructive: true,
                with_rollback: false,
            },
        })
        .unwrap();
        assert_eq!(
            result.statements,
            vec![
                "ALTER TABLE `meters` DROP COLUMN `old`;".to_string(),
                "ALTER TABLE `meters` MODIFY COLUMN `note` VARCHAR(16);".to_string(),
                "ALTER TABLE `meters` ADD COLUMN `volt` FLOAT;".to_string(),
            ]
        );
    }

    #[test]
    fn test_build_alter_table_requires_allow_destructive_for_drop() {
        let from = table_spec(
            "meters",
            None,
            vec![column("ts", "TIMESTAMP"), column("old", "INT")],
        );
        let to = table_spec("meters", None, vec![column("ts", "TIMESTAMP")]);
        let result = build_alter_table(BuildAlterTableParams {
            conn_id: None,
            from_spec: from,
            to_spec: to,
            column_renames: Vec::new(),
            options: AlterTableOptions::default(),
        })
        .unwrap();
        assert!(result.statements.is_empty());
        assert!(
            result
                .warnings
                .iter()
                .any(|w| w.contains("allow_destructive"))
        );
    }

    #[test]
    fn test_build_drop_table_sql() {
        let result = build_drop(BuildDropParams {
            kind: ObjectKind::Table,
            name: "meters".into(),
            database: Some("power_db".into()),
            schema: None,
            if_exists: true,
            cascade: false,
        });
        assert_eq!(result.sql, "DROP TABLE IF EXISTS `power_db`.`meters`");
    }

    #[test]
    fn test_build_drop_view_emits_comment() {
        let result = build_drop(BuildDropParams {
            kind: ObjectKind::View,
            name: "v1".into(),
            database: None,
            schema: None,
            if_exists: false,
            cascade: false,
        });
        assert!(result.sql.starts_with("-- TDengine does not support views"));
    }

    #[test]
    fn test_truncate_table_emits_comment() {
        let result = build_ddl(BuildDdlParams {
            conn_id: None,
            op: DdlBuildOp::TruncateTable,
            payload: serde_json::json!({ "table": "meters" }),
        })
        .unwrap();
        assert!(result.statements[0].contains("TRUNCATE"));
    }

    #[test]
    fn test_modify_database_emits_comment_hint() {
        let result = build_ddl(BuildDdlParams {
            conn_id: None,
            op: DdlBuildOp::ModifyDatabase,
            payload: serde_json::json!({ "database_name": "power_db" }),
        })
        .unwrap();
        assert_eq!(
            result.statements[0],
            "-- TDengine: use `ALTER DATABASE power_db ...` to adjust options"
        );
    }
}
