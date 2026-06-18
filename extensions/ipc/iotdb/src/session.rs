use anyhow::{Context, Result};
use extension_protocol::row::{CellValue, ColumnTypeKind};
use extension_protocol::schema::{ColumnInfo, DatabaseInfo, ObjectInfo, ObjectKind, SchemaInfo};
use serde_json::json;

use crate::config::IotDbConnectionConfig;
use crate::parser::{ParsedDataSet, column_type_kind, parse_debug_dataset};

pub struct IotDbSession {
    cfg: IotDbConnectionConfig,
    session: iotdb::Session,
}

// iotdb 0.0.7 stores thrift protocols behind trait objects without `Send`
// bounds. The driver runtime moves an opened connection into one dedicated
// worker thread and then accesses it serially, so the wrapper never shares the
// thrift client across threads.
unsafe impl Send for IotDbSession {}

impl IotDbSession {
    pub fn connect(cfg: IotDbConnectionConfig) -> Result<Self> {
        let session = iotdb::Session::connect(cfg.to_iotdb_config())
            .with_context(|| format!("failed to connect to IoTDB at {}", cfg.endpoint()))?;
        Ok(Self { cfg, session })
    }

    pub fn close(&mut self) {
        let _ = self.session.close();
    }

    pub fn ping(&mut self) -> Result<()> {
        self.session
            .time_zone()
            .context("failed to ping IoTDB with time_zone")
            .map(|_| ())
    }

    pub fn query(&mut self, sql: &str) -> Result<ParsedDataSet> {
        let data_set = self
            .session
            .sql(sql)
            .with_context(|| format!("failed to execute IoTDB query `{sql}`"))?;
        parse_debug_dataset(&format!("{data_set:?}"))
            .with_context(|| format!("failed to decode IoTDB query result for `{sql}`"))
    }

    pub fn exec_update(&mut self, sql: &str) -> Result<()> {
        self.session
            .exec_update(sql)
            .with_context(|| format!("failed to execute IoTDB statement `{sql}`"))?;
        Ok(())
    }

    pub fn exec_batch(&mut self, statements: Vec<String>) -> Result<()> {
        self.session
            .exec_batch(statements)
            .context("failed to execute IoTDB batch")
    }

    pub fn database_filter(&self) -> &str {
        self.cfg.storage_group_filter()
    }

    pub fn list_databases(&mut self) -> Result<Vec<DatabaseInfo>> {
        let parsed = self.query("SHOW STORAGE GROUP")?;
        let names = first_text_column(&parsed);
        Ok(names
            .into_iter()
            .filter(|name| path_matches_filter(name, self.database_filter()))
            .map(|name| DatabaseInfo {
                name,
                comment: "IoTDB storage group".to_string(),
                extra: json!({ "kind": "storage_group" }),
                ..Default::default()
            })
            .collect())
    }

    pub fn list_schemas(&mut self, database: &str) -> Vec<SchemaInfo> {
        vec![SchemaInfo {
            name: database.to_string(),
            comment: "IoTDB storage group".to_string(),
            extra: json!({ "kind": "storage_group" }),
            ..Default::default()
        }]
    }

    pub fn list_devices(
        &mut self,
        database: Option<&str>,
        schema: Option<&str>,
    ) -> Result<Vec<ObjectInfo>> {
        let prefix = schema
            .or(database)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| self.database_filter());
        let sql = format!("SHOW DEVICES {prefix}.**");
        let parsed = self.query(&sql)?;
        Ok(first_text_column(&parsed)
            .into_iter()
            .map(|name| ObjectInfo {
                name,
                kind: ObjectKind::Table,
                comment: "IoTDB device".to_string(),
                row_count_estimate: None,
                size_bytes: None,
                created_at: None,
                updated_at: None,
                extra: json!({ "kind": "device" }),
            })
            .collect())
    }

    pub fn list_columns(&mut self, table: &str) -> Result<Vec<ColumnInfo>> {
        let sql = format!("SHOW TIMESERIES {table}.*");
        let parsed = self.query(&sql)?;
        let mut columns = vec![ColumnInfo {
            ordinal: 1,
            name: "Time".to_string(),
            type_str: "int64".to_string(),
            raw_type: Some("INT64".to_string()),
            nullable: false,
            is_primary: true,
            extra: json!({ "kind": "timestamp" }),
            ..Default::default()
        }];

        let ts_idx = parsed
            .columns
            .iter()
            .position(|column| {
                let lower = column.to_ascii_lowercase();
                lower.contains("timeseries") || lower == "timeseries"
            })
            .unwrap_or(0);
        let type_idx = parsed.columns.iter().position(|column| {
            let lower = column.to_ascii_lowercase();
            lower == "datatype" || lower == "data_type" || lower.contains("datatype")
        });

        for row in parsed.rows {
            let Some(path) = row.fields.get(ts_idx).and_then(cell_to_text) else {
                continue;
            };
            let Some(name) = path.rsplit('.').next().filter(|value| !value.is_empty()) else {
                continue;
            };
            let raw_type = type_idx
                .and_then(|idx| row.fields.get(idx))
                .and_then(cell_to_text)
                .unwrap_or_else(|| "TEXT".to_string());
            columns.push(ColumnInfo {
                ordinal: columns.len() as u32 + 1,
                name: name.to_string(),
                type_str: column_type_name(&raw_type).to_string(),
                raw_type: Some(raw_type.clone()),
                nullable: true,
                extra: json!({ "timeseries": path }),
                ..Default::default()
            });
        }

        Ok(columns)
    }
}

fn first_text_column(parsed: &ParsedDataSet) -> Vec<String> {
    parsed
        .rows
        .iter()
        .filter_map(|row| row.fields.first())
        .filter_map(cell_to_text)
        .collect()
}

fn cell_to_text(field: &crate::parser::ParsedField) -> Option<String> {
    match &field.value {
        CellValue::Text { value } => Some(value.clone()),
        CellValue::I64 { value } => Some(value.to_string()),
        CellValue::U64 { value } => Some(value.to_string()),
        CellValue::F64 { value } => Some(value.to_string()),
        CellValue::Bool { value } => Some(value.to_string()),
        CellValue::Null => None,
        other => Some(format!("{other:?}")),
    }
}

fn column_type_name(raw_type: &str) -> &'static str {
    match column_type_kind(raw_type) {
        ColumnTypeKind::Bool => "bool",
        ColumnTypeKind::I64 => "int64",
        ColumnTypeKind::F64 => "float64",
        ColumnTypeKind::Text => "text",
        _ => "text",
    }
}

fn path_matches_filter(path: &str, filter: &str) -> bool {
    let filter = filter.trim();
    filter.is_empty()
        || filter == "root"
        || path == filter
        || path.starts_with(&format!("{filter}."))
}
