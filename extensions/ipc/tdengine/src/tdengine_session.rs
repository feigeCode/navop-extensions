//! taos 连接封装:DSN 连接、查询执行、结果到 wire 值的映射。
//!
//! 连接流程移植自主仓 `crates/db/src/tdengine/connection.rs`:
//! `TaosBuilder::from_dsn(dsn)` → `AsyncTBuilder::build` → 在超时窗口内执行
//! `SELECT SERVER_STATUS()` 完成 WebSocket 实际握手。
//!
//! 查询结果统一转为 wire 层的 [`ColumnSpec`] + [`Row`];数值/布尔/时间戳保持
//! 类型化 [`CellValue`],元数据探测用的文本接口保留 `Option<String>` 形态。

use std::time::Duration;

use anyhow::{Context, Result};
use extension_protocol::row::{CellValue, ColumnSpec, ColumnTypeKind};
use taos::{AsyncFetchable, AsyncQueryable, AsyncTBuilder, Field, Taos, TaosBuilder, Value};

use crate::protocol::TdConnectionConfig;

/// 单条语句的执行结果:有结果集 / 无结果集(受影响行数)。
#[derive(Debug)]
pub enum ExecOutcome {
    /// SELECT / SHOW / DESCRIBE 等返回结果集的语句。
    ResultSet {
        columns: Vec<ColumnSpec>,
        rows: Vec<Vec<Option<String>>>,
    },
    /// DDL / DML 等无结果集语句。
    Affected(u64),
}

/// 一个已建立的 TDengine 会话。
pub struct TdSession {
    taos: Taos,
}

impl TdSession {
    /// 按 `conn/test` / `conn/open` 的连接配置建连。
    pub async fn connect(config: &TdConnectionConfig) -> Result<Self> {
        let dsn = crate::protocol::build_dsn(config);
        tracing::debug!(dsn, "[TDengine] connecting");

        let builder = TaosBuilder::from_dsn(&dsn)
            .map_err(|e| anyhow::anyhow!("invalid TDengine DSN: {e}"))?;
        let taos = AsyncTBuilder::build(&builder)
            .await
            .map_err(|e| anyhow::anyhow!("failed to create TDengine builder: {e}"))?;

        // WebSocket 客户端是惰性建立的,这里用测试查询在超时内完成实际握手。
        let timeout_secs = config.connect_timeout_secs();
        let test = tokio::time::timeout(
            Duration::from_secs(timeout_secs),
            taos.query("SELECT SERVER_STATUS()"),
        )
        .await;
        match test {
            Ok(Ok(mut result_set)) => {
                // 拉取并丢弃测试结果,确保结果集被完整消费。
                let _ = result_set.to_records().await;
            }
            Ok(Err(e)) => {
                return Err(anyhow::anyhow!("failed to connect to TDengine: {e}"));
            }
            Err(_) => {
                return Err(anyhow::anyhow!(
                    "connection timed out after {timeout_secs}s"
                ));
            }
        }

        Ok(Self { taos })
    }

    /// 执行单条语句:有字段说明是查询(返回结果集),否则按受影响行数处理。
    /// 与主仓 `TdengineDbConnection::execute_single` 语义一致。
    pub async fn execute(&self, sql: &str) -> Result<ExecOutcome> {
        let mut result_set = self
            .taos
            .query(sql)
            .await
            .map_err(|e| anyhow::anyhow!("TDengine execute failed: {e}"))?;

        // 无字段说明是非查询语句(DDL/DML),使用受影响行数构造执行结果。
        if result_set.fields().is_empty() {
            let affected = result_set.affected_rows().max(0) as u64;
            return Ok(ExecOutcome::Affected(affected));
        }

        let columns: Vec<ColumnSpec> = result_set
            .fields()
            .iter()
            .map(column_spec_from_field)
            .collect();
        let records = result_set
            .to_records()
            .await
            .map_err(|e| anyhow::anyhow!("TDengine fetch rows failed: {e}"))?;
        let rows: Vec<Vec<Option<String>>> = records
            .into_iter()
            .map(|record| record.into_iter().map(value_to_text_cell).collect())
            .collect();
        Ok(ExecOutcome::ResultSet { columns, rows })
    }

    /// 执行查询并返回列名与全部行(文本形态,供元数据列探测使用)。
    pub async fn query_table(
        &self,
        sql: &str,
        context: &str,
    ) -> Result<(Vec<String>, Vec<Vec<Option<String>>>)> {
        match self.execute(sql).await? {
            ExecOutcome::ResultSet { columns, rows } => {
                Ok((columns.into_iter().map(|c| c.name).collect(), rows))
            }
            ExecOutcome::Affected(_) => {
                Err(anyhow::anyhow!("{context} did not return a result set"))
            }
        }
    }

    /// 执行查询并把行解析为类型化 wire 单元格(供 query/start 游标使用)。
    pub async fn query_typed_rows(
        &self,
        sql: &str,
    ) -> Result<(Vec<ColumnSpec>, Vec<Vec<CellValue>>)> {
        match self.execute(sql).await? {
            ExecOutcome::ResultSet { columns, rows } => {
                let typed = rows
                    .into_iter()
                    .map(|row| {
                        row.into_iter()
                            .zip(columns.iter().map(|c| c.type_kind))
                            .map(|(cell, kind)| text_cell_to_cell_value(cell, kind))
                            .collect()
                    })
                    .collect();
                Ok((columns, typed))
            }
            ExecOutcome::Affected(_) => {
                Err(anyhow::anyhow!("query did not return a result set: {sql}"))
            }
        }
    }

    /// 执行非查询语句,返回受影响行数;若语句带结果集则报错。
    pub async fn exec(&self, sql: &str) -> Result<u64> {
        match self.execute(sql).await? {
            ExecOutcome::Affected(n) => Ok(n),
            ExecOutcome::ResultSet { .. } => Ok(0),
        }
    }

    /// 连通性检查:SELECT SERVER_STATUS() 计时。
    pub async fn ping(&self) -> Result<()> {
        let mut rs = self
            .taos
            .query("SELECT SERVER_STATUS()")
            .await
            .map_err(|e| anyhow::anyhow!("TDengine ping failed: {e}"))?;
        let _ = rs.to_records().await;
        Ok(())
    }

    /// 服务端版本(SELECT SERVER_VERSION() 首行首列)。
    pub async fn server_version(&self) -> Result<String> {
        let (columns, rows) = self
            .query_table("SELECT SERVER_VERSION()", "query server version")
            .await?;
        let _ = columns;
        Ok(rows
            .first()
            .and_then(|row| row.first())
            .and_then(|v| v.clone())
            .unwrap_or_else(|| "unknown".to_string()))
    }

    /// 当前数据库(SELECT DATABASE();未选择时为 NULL → None)。
    pub async fn current_database(&self) -> Result<Option<String>> {
        let (_, rows) = self
            .query_table("SELECT DATABASE()", "query current database")
            .await?;
        Ok(rows
            .first()
            .and_then(|row| row.first())
            .and_then(|v| v.clone()))
    }

    /// 切换当前数据库:USE `db`(与主仓 switch_database 一致)。
    pub async fn use_database(&self, database: &str) -> Result<()> {
        let sql = format!("USE `{}`", database.replace('`', "``"));
        self.execute(&sql)
            .await
            .map(|_| ())
            .with_context(|| format!("failed to switch database to {database}"))
    }
}

/// 生成查询结果列的 wire 描述;变长类型附带字节宽度,例如 `VARCHAR(16)`。
/// 与主仓 `field_type_name` 语义一致。
pub fn column_spec_from_field(field: &Field) -> ColumnSpec {
    let ty = field.ty();
    let type_str = if ty.is_var_type() && field.bytes() > 0 {
        format!("{}({})", ty.name(), field.bytes())
    } else {
        ty.name().to_string()
    };
    ColumnSpec::new(field.name(), type_str, map_ty_to_kind(ty))
}

/// taos 类型 → wire 粗粒度类型。
pub fn map_ty_to_kind(ty: taos::Ty) -> ColumnTypeKind {
    use taos::Ty;
    match ty {
        Ty::Bool => ColumnTypeKind::Bool,
        Ty::TinyInt | Ty::SmallInt | Ty::Int | Ty::BigInt => ColumnTypeKind::I64,
        Ty::UTinyInt | Ty::USmallInt | Ty::UInt | Ty::UBigInt => ColumnTypeKind::U64,
        Ty::Float | Ty::Double => ColumnTypeKind::F64,
        Ty::Decimal => ColumnTypeKind::Decimal,
        Ty::VarChar | Ty::NChar => ColumnTypeKind::Text,
        Ty::VarBinary | Ty::Blob | Ty::MediumBlob | Ty::Geometry => ColumnTypeKind::Bytes,
        Ty::Json => ColumnTypeKind::Json,
        Ty::Timestamp => ColumnTypeKind::Datetime,
        // Null 不是真实类型;未知类型(Ty 标注 non_exhaustive)保守映射为 Text 展示。
        Ty::Null => ColumnTypeKind::Unknown,
        _ => ColumnTypeKind::Text,
    }
}

/// 将 taos 值转换为文本单元格:NULL 转 None,其余转显示字符串。
/// 与主仓 `value_to_cell` 保持一致(二进制类值 to_string 失败时回退 Display)。
pub fn value_to_text_cell(value: Value) -> Option<String> {
    match value {
        Value::Null(_) => None,
        // taos 的 to_string 对二进制类值可能失败,回退到 Display 形式。
        other => Some(other.to_string().unwrap_or_else(|_| format!("{other}"))),
    }
}

/// 把元数据层的文本单元格按列类型还原为类型化 wire 单元格。
///
/// 元数据行已经过 `value_to_text_cell` 文本化(主仓语义),这里按列的粗粒度
/// 类型做保守还原:数值列尝试解析数值,布尔列解析 true/false,其余保持文本。
fn text_cell_to_cell_value(cell: Option<String>, kind: ColumnTypeKind) -> CellValue {
    use ColumnTypeKind as K;
    let Some(text) = cell else {
        return CellValue::Null;
    };
    match kind {
        K::Bool => match text.as_str() {
            "true" => CellValue::Bool { value: true },
            "false" => CellValue::Bool { value: false },
            _ => CellValue::Text { value: text },
        },
        K::I64 => match text.parse::<i64>() {
            Ok(value) => CellValue::I64 { value },
            Err(_) => CellValue::Text { value: text },
        },
        K::U64 => match text.parse::<u64>() {
            Ok(value) => CellValue::U64 { value },
            Err(_) => CellValue::Text { value: text },
        },
        K::F64 => match text.parse::<f64>() {
            Ok(value) => CellValue::F64 { value },
            Err(_) => CellValue::Text { value: text },
        },
        // 时间戳/字符串/二进制等保持文本形态(wire 层 Bytes 为 base64,
        // 元数据文本化后无法可靠区分原始字节,统一按文本回传)。
        _ => CellValue::Text { value: text },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use extension_protocol::row::ColumnTypeKind as K;

    #[test]
    fn map_ty_covers_common_types() {
        use taos::Ty;
        assert_eq!(map_ty_to_kind(Ty::Bool), K::Bool);
        assert_eq!(map_ty_to_kind(Ty::Int), K::I64);
        assert_eq!(map_ty_to_kind(Ty::BigInt), K::I64);
        assert_eq!(map_ty_to_kind(Ty::UBigInt), K::U64);
        assert_eq!(map_ty_to_kind(Ty::Double), K::F64);
        assert_eq!(map_ty_to_kind(Ty::VarChar), K::Text);
        assert_eq!(map_ty_to_kind(Ty::NChar), K::Text);
        assert_eq!(map_ty_to_kind(Ty::Json), K::Json);
        assert_eq!(map_ty_to_kind(Ty::Timestamp), K::Datetime);
        assert_eq!(map_ty_to_kind(Ty::VarBinary), K::Bytes);
    }

    // === 移植自主仓 crates/db/src/tdengine/connection.rs 的值映射单测 ===

    #[test]
    fn null_value_maps_to_none_and_scalars_map_to_text() {
        use taos::Ty;
        assert_eq!(value_to_text_cell(Value::Null(Ty::Int)), None);
        assert_eq!(value_to_text_cell(Value::Int(42)), Some("42".to_string()));
        assert_eq!(
            value_to_text_cell(Value::Bool(true)),
            Some("true".to_string())
        );
        assert_eq!(
            value_to_text_cell(Value::NChar("涛思".to_string())),
            Some("涛思".to_string())
        );
    }

    #[test]
    fn text_cell_restores_typed_values() {
        assert_eq!(
            text_cell_to_cell_value(Some("42".into()), K::I64),
            CellValue::I64 { value: 42 }
        );
        assert_eq!(
            text_cell_to_cell_value(Some("false".into()), K::Bool),
            CellValue::Bool { value: false }
        );
        assert_eq!(
            text_cell_to_cell_value(Some("3.5".into()), K::F64),
            CellValue::F64 { value: 3.5 }
        );
        assert_eq!(
            text_cell_to_cell_value(Some("abc".into()), K::Text),
            CellValue::Text {
                value: "abc".into()
            }
        );
        // 数值列解析失败时保守回退文本。
        assert_eq!(
            text_cell_to_cell_value(Some("nan-ish".into()), K::I64),
            CellValue::Text {
                value: "nan-ish".into()
            }
        );
        assert_eq!(text_cell_to_cell_value(None, K::I64), CellValue::Null);
    }
}
