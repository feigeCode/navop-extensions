use extension_protocol::ddl::{
    BuildAlterTableParams, BuildAlterTableResult, BuildCreateTableParams, BuildCreateTableResult,
    BuildDdlParams, BuildDdlResult, BuildDropParams, BuildDropResult, ColumnRenameSpec, ColumnSpec,
    DdlBuildOp, IndexSpec, TableSpec,
};
use extension_protocol::schema::ObjectKind;
use serde::Deserialize;
use serde_json::Value;

pub fn build_ddl(params: BuildDdlParams) -> Result<BuildDdlResult, String> {
    match params.op {
        DdlBuildOp::CreateTable => {
            let result = build_create_table(decode_payload(params.payload)?);
            Ok(BuildDdlResult {
                statements: result.statements,
                warnings: Vec::new(),
            })
        }
        DdlBuildOp::AlterTable => {
            let result = build_alter_table(decode_payload(params.payload)?);
            Ok(BuildDdlResult {
                statements: result.statements,
                warnings: result.warnings,
            })
        }
        DdlBuildOp::DropTable => {
            let result = build_drop(decode_drop_payload(params.payload, ObjectKind::Table)?);
            Ok(BuildDdlResult {
                statements: vec![result.sql],
                warnings: Vec::new(),
            })
        }
        DdlBuildOp::DropView => {
            let result = build_drop(decode_drop_payload(params.payload, ObjectKind::View)?);
            Ok(BuildDdlResult {
                statements: vec![result.sql],
                warnings: Vec::new(),
            })
        }
        DdlBuildOp::CreateSchema => Ok(single_statement(build_create_schema(params.payload)?)),
        DdlBuildOp::DropSchema => Ok(single_statement(build_drop_schema(params.payload)?)),
        DdlBuildOp::RenameTable => Ok(single_statement(build_rename_table(params.payload)?)),
        DdlBuildOp::TruncateTable => Ok(single_statement(build_truncate_table(params.payload)?)),
        DdlBuildOp::ColumnDefinition => {
            let column: ColumnSpec = decode_payload(params.payload)?;
            Ok(single_statement(column_definition(&column)))
        }
        op => Err(format!(
            "ddl/build op `{op:?}` is not implemented for DuckDB"
        )),
    }
}

pub fn build_create_table(params: BuildCreateTableParams) -> BuildCreateTableResult {
    let table = table_reference(&params.spec);
    let mut parts = params
        .spec
        .columns
        .iter()
        .map(column_definition)
        .collect::<Vec<_>>();
    if !params.spec.primary_key.is_empty() && !has_inline_primary_key(&params.spec.columns) {
        parts.push(format!(
            "PRIMARY KEY ({})",
            join_quoted(&params.spec.primary_key)
        ));
    }
    let prefix = if params.options.temporary {
        "CREATE TEMP TABLE"
    } else {
        "CREATE TABLE"
    };
    let if_not_exists = if params.options.if_not_exists {
        " IF NOT EXISTS"
    } else {
        ""
    };
    let sql = format!("{prefix}{if_not_exists} {table} ({})", parts.join(", "));
    let mut statements = vec![sql.clone()];
    if params.options.with_indexes {
        statements.extend(params.spec.indexes.iter().map(|idx| index_sql(&table, idx)));
    }
    BuildCreateTableResult { sql, statements }
}

pub fn build_alter_table(params: BuildAlterTableParams) -> BuildAlterTableResult {
    let table = table_reference(&params.to_spec);
    let mut statements = Vec::new();
    let renamed_old = params
        .column_renames
        .iter()
        .map(|rename| rename.old_name.as_str())
        .collect::<std::collections::HashSet<_>>();
    let renamed_new = params
        .column_renames
        .iter()
        .map(|rename| rename.new_name.as_str())
        .collect::<std::collections::HashSet<_>>();

    for rename in &params.column_renames {
        if rename.old_name != rename.new_name
            && !rename.old_name.trim().is_empty()
            && !rename.new_name.trim().is_empty()
        {
            statements.push(rename_column_sql(&table, rename));
        }
    }

    for column in &params.to_spec.columns {
        if renamed_new.contains(column.name.as_str()) {
            continue;
        }
        if params
            .from_spec
            .columns
            .iter()
            .all(|old| old.name != column.name)
        {
            statements.push(format!(
                "ALTER TABLE {table} ADD COLUMN {}",
                column_definition(column)
            ));
        }
    }
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
                    "ALTER TABLE {table} DROP COLUMN {}",
                    quote_identifier(&column.name)
                ));
            }
        }
    }
    BuildAlterTableResult {
        statements,
        ..Default::default()
    }
}

fn rename_column_sql(table: &str, rename: &ColumnRenameSpec) -> String {
    format!(
        "ALTER TABLE {table} RENAME COLUMN {} TO {}",
        quote_identifier(&rename.old_name),
        quote_identifier(&rename.new_name)
    )
}

pub fn build_drop(params: BuildDropParams) -> BuildDropResult {
    let kind = match params.kind {
        ObjectKind::View | ObjectKind::MaterializedView => "VIEW",
        _ => "TABLE",
    };
    let if_exists = if params.if_exists { " IF EXISTS" } else { "" };
    let mut sql = format!(
        "{kind_drop} {kind}{if_exists} {}",
        qualified_name(&params.schema, &params.name),
        kind_drop = "DROP"
    );
    if params.cascade {
        sql.push_str(" CASCADE");
    }
    BuildDropResult { sql }
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

#[derive(Deserialize)]
struct SchemaDdlPayload {
    name: Option<String>,
    schema: Option<String>,
    schema_name: Option<String>,
    #[serde(default)]
    if_not_exists: bool,
    #[serde(default)]
    if_exists: bool,
    #[serde(default)]
    cascade: bool,
}

#[derive(Deserialize)]
struct RenameTablePayload {
    schema: Option<String>,
    name: Option<String>,
    old_name: Option<String>,
    table: Option<String>,
    new_name: Option<String>,
    to: Option<String>,
}

#[derive(Deserialize)]
struct TableDdlPayload {
    schema: Option<String>,
    name: Option<String>,
    table: Option<String>,
}

fn build_create_schema(payload: Value) -> Result<String, String> {
    let payload: SchemaDdlPayload = decode_payload(payload)?;
    let schema = required_identifier(
        "schema",
        [payload.name, payload.schema, payload.schema_name],
    )?;
    let if_not_exists = if payload.if_not_exists {
        " IF NOT EXISTS"
    } else {
        ""
    };
    Ok(format!(
        "CREATE SCHEMA{if_not_exists} {}",
        quote_identifier(&schema)
    ))
}

fn build_drop_schema(payload: Value) -> Result<String, String> {
    let payload: SchemaDdlPayload = decode_payload(payload)?;
    let schema = required_identifier(
        "schema",
        [payload.name, payload.schema, payload.schema_name],
    )?;
    let if_exists = if payload.if_exists { " IF EXISTS" } else { "" };
    let cascade = if payload.cascade { " CASCADE" } else { "" };
    Ok(format!(
        "DROP SCHEMA{if_exists} {}{cascade}",
        quote_identifier(&schema)
    ))
}

fn build_rename_table(payload: Value) -> Result<String, String> {
    let payload: RenameTablePayload = decode_payload(payload)?;
    let schema = payload.schema;
    let old_name = required_identifier("table", [payload.name, payload.old_name, payload.table])?;
    let new_name = required_identifier("new_name", [payload.new_name, payload.to])?;
    Ok(format!(
        "ALTER TABLE {} RENAME TO {}",
        qualified_name(&schema, &old_name),
        quote_identifier(&new_name)
    ))
}

fn build_truncate_table(payload: Value) -> Result<String, String> {
    let payload: TableDdlPayload = decode_payload(payload)?;
    let table = required_identifier("table", [payload.name, payload.table])?;
    Ok(format!(
        "TRUNCATE TABLE {}",
        qualified_name(&payload.schema, &table)
    ))
}

fn required_identifier<const N: usize>(
    field: &str,
    candidates: [Option<String>; N],
) -> Result<String, String> {
    candidates
        .into_iter()
        .flatten()
        .find(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{field} is required"))
}

fn column_definition(column: &ColumnSpec) -> String {
    let mut sql = format!(
        "{} {}",
        quote_identifier(&column.name),
        sanitize_type(&column.type_str)
    );
    if !column.nullable {
        sql.push_str(" NOT NULL");
    }
    if let Some(default) = &column.default {
        sql.push_str(" DEFAULT ");
        sql.push_str(default);
    }
    if column.is_primary {
        sql.push_str(" PRIMARY KEY");
    } else if column.is_unique {
        sql.push_str(" UNIQUE");
    }
    sql
}

fn index_sql(table: &str, index: &IndexSpec) -> String {
    let unique = if index.is_unique { "UNIQUE " } else { "" };
    format!(
        "CREATE {unique}INDEX {} ON {table} ({})",
        quote_identifier(&index.name),
        join_quoted(&index.columns)
    )
}

fn table_reference(spec: &TableSpec) -> String {
    qualified_name(&spec.schema, &spec.name)
}

fn qualified_name(schema: &Option<String>, name: &str) -> String {
    match schema.as_deref().filter(|s| !s.trim().is_empty()) {
        Some(schema) => format!("{}.{}", quote_identifier(schema), quote_identifier(name)),
        None => quote_identifier(name),
    }
}

fn quote_identifier(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn join_quoted(values: &[String]) -> String {
    values
        .iter()
        .map(|value| quote_identifier(value))
        .collect::<Vec<_>>()
        .join(", ")
}

fn sanitize_type(value: &str) -> String {
    if value.trim().is_empty() {
        "VARCHAR".to_string()
    } else {
        value.trim().to_string()
    }
}

fn has_inline_primary_key(columns: &[ColumnSpec]) -> bool {
    columns.iter().any(|column| column.is_primary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use extension_protocol::ddl::AlterTableOptions;

    #[test]
    fn alter_table_renames_column_without_add_drop_noise() {
        let result = build_alter_table(BuildAlterTableParams {
            conn_id: None,
            from_spec: TableSpec {
                name: "events".into(),
                columns: vec![ColumnSpec {
                    name: "payload".into(),
                    type_str: "VARCHAR".into(),
                    ..Default::default()
                }],
                ..Default::default()
            },
            to_spec: TableSpec {
                name: "events".into(),
                columns: vec![ColumnSpec {
                    name: "body".into(),
                    type_str: "VARCHAR".into(),
                    ..Default::default()
                }],
                ..Default::default()
            },
            column_renames: vec![ColumnRenameSpec {
                old_name: "payload".into(),
                new_name: "body".into(),
            }],
            options: AlterTableOptions {
                allow_destructive: true,
                with_rollback: false,
            },
        });

        assert_eq!(
            result.statements,
            vec!["ALTER TABLE \"events\" RENAME COLUMN \"payload\" TO \"body\""]
        );
    }
}
