//! 库/表列表元数据的纯映射逻辑。
//!
//! 全部逻辑移植自主仓 `crates/db/src/tdengine/plugin.rs`:
//! - `SHOW DATABASES` 在 TDengine 3.x 返回多列元数据(ntables/vgroups/replica/
//!   keep0/keep1/precision/status 等,不同版本列集有差异),按列名探测映射,
//!   缺失列容忍为空;
//! - 表列表优先走 `information_schema.INS_TABLES`/`INS_STABLES`(含表类型/列数/
//!   标签数/所属超级表),查询报错时降级为 `SHOW TABLES`/`SHOW STABLES`;
//! - 库列表对象视图输出 TD 特有列:名称|表数量|精度|副本|VGroups|Keep(keep0/keep1
//!   合并)|状态|创建时间,缺失列自动省略。
//!
//! 输入输出都是纯数据(列名 + 文本行),便于单元测试,不涉及任何 I/O。

use extension_protocol::schema::{ObjectView, ObjectViewColumn, ObjectViewColumnAlign};

/// TDengine 内置数据库,在库列表中隐藏。
pub const TDENGINE_SYSTEM_DATABASES: &[&str] = &["information_schema", "performance_schema"];

/// TDengine 表种类:超级表 / 子表 / 普通表。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TdengineTableKind {
    /// 普通表。
    #[default]
    Normal,
    /// 超级表。
    Super,
    /// 子表(依超级表创建)。
    Child,
}

impl TdengineTableKind {
    /// wire `schema/objects` extra 里的类型标记。
    pub fn wire_tag(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Super => "super",
            Self::Child => "child",
        }
    }

    /// 对象视图类型列的展示文案。
    pub fn display_name(self) -> &'static str {
        match self {
            Self::Normal => "Normal Table",
            Self::Super => "Super Table",
            Self::Child => "Child Table",
        }
    }
}

/// 库列表摘要(`SHOW DATABASES` 按列名探测的结果)。
#[derive(Debug, Default, Clone, PartialEq)]
pub struct TdengineDatabaseSummary {
    pub name: String,
    /// 表数量(ntables)。
    pub table_count: Option<i64>,
    /// 时间戳精度(precision,如 ms/us/ns)。
    pub precision: Option<String>,
    /// 副本数(replica)。
    pub replica: Option<i64>,
    /// VGroup 数(vgroups)。
    pub vgroups: Option<i64>,
    /// 保留策略(keep,或 keep0/keep1 合并,如 "3650d,3650d")。
    pub keep: Option<String>,
    /// 库状态(status,如 ready)。
    pub status: Option<String>,
    /// 创建时间(create_time)。
    pub create_time: Option<String>,
}

/// `SHOW DATABASES` 结果的列下标探测结果(缺失列为 None)。
#[derive(Debug, Default, Clone, Copy)]
pub struct TdengineDatabaseColumnIndex {
    pub name: Option<usize>,
    pub ntables: Option<usize>,
    pub precision: Option<usize>,
    pub replica: Option<usize>,
    pub vgroups: Option<usize>,
    pub keep: Option<usize>,
    pub keep0: Option<usize>,
    pub keep1: Option<usize>,
    pub status: Option<usize>,
    pub create_time: Option<usize>,
}

/// 表列表摘要(INS_TABLES/INS_STABLES/SHOW 派生)。
#[derive(Debug, Default, Clone, PartialEq)]
pub struct TdengineTableSummary {
    pub name: String,
    pub kind: TdengineTableKind,
    /// 列数(不含标签)。
    pub column_count: Option<i64>,
    /// 标签数(仅超级表有)。
    pub tag_count: Option<i64>,
    /// 所属超级表(仅子表有)。
    pub stable_name: Option<String>,
    pub create_time: Option<String>,
}

/// 表查询结果(INS_TABLES/INS_STABLES/SHOW TABLES/SHOW STABLES)的列下标探测结果。
#[derive(Debug, Default, Clone, Copy)]
pub struct TdengineTableColumnIndex {
    pub name: Option<usize>,
    /// 表类型列(INS_TABLES 的 type,如 SUPER_TABLE/CHILD_TABLE/NORMAL_TABLE)。
    pub table_type: Option<usize>,
    /// 列数(候选名 columns/col_count)。
    pub column_count: Option<usize>,
    /// 标签数(候选名 tags/tag_columns)。
    pub tag_count: Option<usize>,
    /// 所属超级表(候选名 stable_name/stb_name)。
    pub stable_name: Option<usize>,
    /// 创建时间(候选名 create_time/created_time)。
    pub create_time: Option<usize>,
}

/// 在列名列表中按候选名查找列下标(忽略大小写与首尾空白,候选名按优先级排序)。
pub fn probe_column(columns: &[String], candidates: &[&str]) -> Option<usize> {
    candidates.iter().find_map(|candidate| {
        columns
            .iter()
            .position(|name| name.trim().eq_ignore_ascii_case(candidate))
    })
}

/// 探测 `SHOW DATABASES` 结果的列下标;不同版本列集有差异,缺失列保持 None。
pub fn probe_database_columns(columns: &[String]) -> TdengineDatabaseColumnIndex {
    TdengineDatabaseColumnIndex {
        name: probe_column(columns, &["name"]),
        ntables: probe_column(columns, &["ntables"]),
        precision: probe_column(columns, &["precision"]),
        replica: probe_column(columns, &["replica"]),
        vgroups: probe_column(columns, &["vgroups"]),
        keep: probe_column(columns, &["keep"]),
        keep0: probe_column(columns, &["keep0"]),
        keep1: probe_column(columns, &["keep1"]),
        status: probe_column(columns, &["status"]),
        // 3.x 为 create_time,老版本为 created_time。
        create_time: probe_column(columns, &["create_time", "created_time"]),
    }
}

/// 探测表查询结果的列下标;缺失列保持 None。
pub fn probe_table_columns(columns: &[String]) -> TdengineTableColumnIndex {
    TdengineTableColumnIndex {
        // INS_TABLES/SHOW TABLES 为 table_name,SHOW STABLES 为 name,
        // INS_STABLES 部分版本为 stable_name/stb_name,按优先级探测。
        name: probe_column(columns, &["table_name", "name", "stable_name", "stb_name"]),
        table_type: probe_column(columns, &["type"]),
        column_count: probe_column(columns, &["columns", "col_count"]),
        tag_count: probe_column(columns, &["tags", "tag_columns"]),
        stable_name: probe_column(columns, &["stable_name", "stb_name"]),
        create_time: probe_column(columns, &["create_time", "created_time"]),
    }
}

/// 取行中指定下标的文本值。
pub fn cell_text(row: &[Option<String>], index: Option<usize>) -> Option<String> {
    index
        .and_then(|i| row.get(i))
        .and_then(|value| value.clone())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// 取行中指定下标的整数值。
pub fn cell_i64(row: &[Option<String>], index: Option<usize>) -> Option<i64> {
    cell_text(row, index).and_then(|value| value.parse::<i64>().ok())
}

/// 将单行 `SHOW DATABASES` 结果映射为库摘要;名称缺失时返回 None。
pub fn map_database_row(
    index: &TdengineDatabaseColumnIndex,
    row: &[Option<String>],
) -> Option<TdengineDatabaseSummary> {
    Some(TdengineDatabaseSummary {
        name: cell_text(row, index.name)?,
        table_count: cell_i64(row, index.ntables),
        precision: cell_text(row, index.precision),
        replica: cell_i64(row, index.replica),
        vgroups: cell_i64(row, index.vgroups),
        keep: merge_keep_text(
            cell_text(row, index.keep).as_deref(),
            cell_text(row, index.keep0).as_deref(),
            cell_text(row, index.keep1).as_deref(),
        ),
        status: cell_text(row, index.status),
        create_time: cell_text(row, index.create_time),
    })
}

/// `SHOW DATABASES` 查询结果 → 库摘要列表(含内置系统库过滤)。
pub fn summarize_databases(
    columns: &[String],
    rows: &[Vec<Option<String>>],
) -> Vec<TdengineDatabaseSummary> {
    let index = probe_database_columns(columns);
    rows.iter()
        .filter_map(|row| map_database_row(&index, row))
        .filter(|db| !is_system_database(&db.name))
        .collect()
}

/// 判断是否为 TDengine 内置系统库(库列表中隐藏)。
pub fn is_system_database(name: &str) -> bool {
    TDENGINE_SYSTEM_DATABASES
        .iter()
        .any(|system| name.eq_ignore_ascii_case(system))
}

/// 合并保留策略文本:优先单列 keep,否则拼接 keep0/keep1(如 "3650d,3650d")。
pub fn merge_keep_text(
    keep: Option<&str>,
    keep0: Option<&str>,
    keep1: Option<&str>,
) -> Option<String> {
    if let Some(keep) = keep {
        return Some(keep.to_string());
    }
    let parts: Vec<&str> = [keep0, keep1]
        .into_iter()
        .flatten()
        .filter(|value| !value.is_empty())
        .collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(","))
    }
}

/// 依据类型文本推断表种类(INS_TABLES 的 type 列,如 SUPER_TABLE/CHILD_TABLE)。
pub fn table_kind_from_type(type_text: Option<&str>) -> Option<TdengineTableKind> {
    let text = type_text?.to_ascii_uppercase();
    if text.contains("SUPER") {
        Some(TdengineTableKind::Super)
    } else if text.contains("CHILD") {
        Some(TdengineTableKind::Child)
    } else if text.contains("NORMAL") {
        Some(TdengineTableKind::Normal)
    } else {
        None
    }
}

/// 将表查询行映射为表摘要列表;无类型列时按 default_kind 与所属超级表推断种类
/// (SHOW TABLES 默认普通表,所属超级表非空即为子表;SHOW STABLES 默认超级表)。
pub fn map_table_rows(
    index: &TdengineTableColumnIndex,
    rows: &[Vec<Option<String>>],
    default_kind: TdengineTableKind,
) -> Vec<TdengineTableSummary> {
    rows.iter()
        .filter_map(|row| {
            let name = cell_text(row, index.name)?;
            let stable_name = cell_text(row, index.stable_name);
            let kind = table_kind_from_type(cell_text(row, index.table_type).as_deref()).unwrap_or(
                match default_kind {
                    TdengineTableKind::Super => TdengineTableKind::Super,
                    _ if stable_name.is_some() => TdengineTableKind::Child,
                    _ => TdengineTableKind::Normal,
                },
            );
            Some(TdengineTableSummary {
                name,
                kind,
                column_count: cell_i64(row, index.column_count),
                tag_count: cell_i64(row, index.tag_count),
                // 超级表无所属超级表;个别数据源(如 INS_STABLES 的名称列)会与
                // 所属超级表列同名,这里统一清除避免自引用。
                stable_name: if kind == TdengineTableKind::Super {
                    None
                } else {
                    stable_name
                },
                create_time: cell_text(row, index.create_time),
            })
        })
        .collect()
}

/// 数值单元格文本:缺失时展示 "-"。
pub fn format_i64_cell(value: Option<i64>) -> String {
    value
        .map(|n| n.to_string())
        .unwrap_or_else(|| "-".to_string())
}

/// 转义 SQL 字符串字面量中的单引号(以成对单引号表示)。
pub fn escape_single_quoted(value: &str) -> String {
    value.replace('\'', "''")
}

/// 判断 DESCRIBE 输出的类型是否需要附带宽度展示。
pub fn tdengine_type_takes_width(raw_type: &str) -> bool {
    let base = raw_type
        .split('(')
        .next()
        .unwrap_or(raw_type)
        .trim()
        .to_ascii_uppercase();
    matches!(
        base.as_str(),
        "BINARY" | "VARCHAR" | "NCHAR" | "VARBINARY" | "GEOMETRY"
    )
}

// ============================================================================
// ObjectView 构建(TD 特有列;列由探测结果动态决定,缺失列整体省略)
// ============================================================================

/// 构建库列表对象视图:名称|表数量|精度|副本|VGroups|Keep|状态|创建时间。
///
/// 与主仓 `TdenginePlugin::list_databases_view` 逻辑一致:特有属性列按
/// `SHOW DATABASES` 结果的列探测情况动态加入,缺失列整体省略,缺失值展示 "-"。
pub fn databases_object_view(columns: &[String], rows: &[Vec<Option<String>>]) -> ObjectView {
    let index = probe_database_columns(columns);
    let databases = summarize_databases(columns, rows);

    // TDengine 特有属性列:keep 可来自 keep/keep0/keep1 任一列。
    let keep_available = index.keep.is_some() || index.keep0.is_some() || index.keep1.is_some();
    let mut view_columns = vec![object_view_column("name", "Name", Some(220.0), None)];
    if index.ntables.is_some() {
        view_columns.push(object_view_column(
            "tables",
            "Tables",
            Some(100.0),
            Some(ObjectViewColumnAlign::Right),
        ));
    }
    if index.precision.is_some() {
        view_columns.push(object_view_column(
            "precision",
            "Precision",
            Some(90.0),
            Some(ObjectViewColumnAlign::Center),
        ));
    }
    if index.replica.is_some() {
        view_columns.push(object_view_column(
            "replica",
            "Replica",
            Some(80.0),
            Some(ObjectViewColumnAlign::Right),
        ));
    }
    if index.vgroups.is_some() {
        view_columns.push(object_view_column(
            "vgroups",
            "VGroups",
            Some(90.0),
            Some(ObjectViewColumnAlign::Right),
        ));
    }
    if keep_available {
        view_columns.push(object_view_column("keep", "Keep", Some(150.0), None));
    }
    if index.status.is_some() {
        view_columns.push(object_view_column("status", "Status", Some(90.0), None));
    }
    if index.create_time.is_some() {
        view_columns.push(object_view_column(
            "create_time",
            "Created",
            Some(180.0),
            None,
        ));
    }

    let view_rows: Vec<Vec<String>> = databases
        .iter()
        .map(|db| {
            // 与上方动态列一一对应,缺失值统一展示 "-"。
            let mut cells = vec![db.name.clone()];
            if index.ntables.is_some() {
                cells.push(format_i64_cell(db.table_count));
            }
            if index.precision.is_some() {
                cells.push(db.precision.clone().unwrap_or_else(|| "-".to_string()));
            }
            if index.replica.is_some() {
                cells.push(format_i64_cell(db.replica));
            }
            if index.vgroups.is_some() {
                cells.push(format_i64_cell(db.vgroups));
            }
            if keep_available {
                cells.push(db.keep.clone().unwrap_or_else(|| "-".to_string()));
            }
            if index.status.is_some() {
                cells.push(db.status.clone().unwrap_or_else(|| "-".to_string()));
            }
            if index.create_time.is_some() {
                cells.push(db.create_time.clone().unwrap_or_else(|| "-".to_string()));
            }
            cells
        })
        .collect();

    ObjectView {
        title: "Databases".to_string(),
        columns: view_columns,
        rows: view_rows,
    }
}

/// 构建表列表对象视图:名称|类型|列数|标签数|所属超级表|创建时间。
///
/// 与主仓 `TdenginePlugin::list_tables_view` 逻辑一致:属性列按数据可用性动态
/// 加入(任一行有值才展示对应列,缺失列整体省略)。
pub fn tables_object_view(tables: &[TdengineTableSummary]) -> ObjectView {
    let has_column_count = tables.iter().any(|t| t.column_count.is_some());
    let has_tag_count = tables.iter().any(|t| t.tag_count.is_some());
    let has_stable = tables.iter().any(|t| t.stable_name.is_some());
    let has_create_time = tables.iter().any(|t| t.create_time.is_some());

    let mut columns = vec![
        object_view_column("name", "Name", Some(220.0), None),
        object_view_column("type", "Type", Some(110.0), None),
    ];
    if has_column_count {
        columns.push(object_view_column(
            "column_count",
            "Columns",
            Some(90.0),
            Some(ObjectViewColumnAlign::Right),
        ));
    }
    if has_tag_count {
        columns.push(object_view_column(
            "tag_count",
            "Tags",
            Some(90.0),
            Some(ObjectViewColumnAlign::Right),
        ));
    }
    if has_stable {
        columns.push(object_view_column(
            "stable_name",
            "Super Table",
            Some(220.0),
            None,
        ));
    }
    if has_create_time {
        columns.push(object_view_column(
            "create_time",
            "Created",
            Some(180.0),
            None,
        ));
    }

    // 类型列展示超级表/子表/普通表。
    let rows: Vec<Vec<String>> = tables
        .iter()
        .map(|table| {
            let mut cells = vec![table.name.clone(), table.kind.display_name().to_string()];
            if has_column_count {
                cells.push(format_i64_cell(table.column_count));
            }
            if has_tag_count {
                cells.push(format_i64_cell(table.tag_count));
            }
            if has_stable {
                cells.push(table.stable_name.clone().unwrap_or_else(|| "-".to_string()));
            }
            if has_create_time {
                cells.push(table.create_time.clone().unwrap_or_else(|| "-".to_string()));
            }
            cells
        })
        .collect();

    ObjectView {
        title: "Tables".to_string(),
        columns,
        rows,
    }
}

fn object_view_column(
    key: &str,
    name: &str,
    width_px: Option<f32>,
    align: Option<ObjectViewColumnAlign>,
) -> ObjectViewColumn {
    ObjectViewColumn {
        key: key.to_string(),
        name: name.to_string(),
        width_px,
        align,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // === 以下单测移植自主仓 crates/db/src/tdengine/plugin.rs 的纯逻辑测试 ===

    /// 按列数构造一行模拟数据:与列一一对应,空字符串表示 NULL。
    fn mock_row(columns: &[&str], cells: &[&str]) -> Vec<Option<String>> {
        assert_eq!(columns.len(), cells.len(), "模拟行与列数不一致");
        columns
            .iter()
            .zip(cells)
            .map(|(_, value)| (!value.is_empty()).then(|| value.to_string()))
            .collect()
    }

    #[test]
    fn test_probe_column_ignores_case_and_prioritizes_candidates() {
        let columns = vec!["Name".to_string(), "NTABLES".to_string()];
        assert_eq!(probe_column(&columns, &["name"]), Some(0));
        assert_eq!(probe_column(&columns, &["ntables"]), Some(1));
        assert_eq!(probe_column(&columns, &["keep"]), None);
        // 候选名按优先级取第一个命中的列。
        assert_eq!(probe_column(&columns, &["keep", "name"]), Some(0));
    }

    #[test]
    fn test_summarize_databases_full_columns() {
        // TDengine 3.x 的 SHOW DATABASES 完整列集(截取映射关心的列)。
        let columns: Vec<String> = [
            "name",
            "create_time",
            "ntables",
            "vgroups",
            "replica",
            "quorum",
            "days",
            "keep0",
            "keep1",
            "cache",
            "blocks",
            "minrows",
            "maxrows",
            "wal",
            "wal_level",
            "comp",
            "cachemodel",
            "precision",
            "status",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let values = [
            "power_db",
            "2024-05-01 10:00:00.000",
            "24",
            "4",
            "1",
            "1",
            "10",
            "3650d",
            "3650d",
            "16",
            "12",
            "100",
            "4096",
            "1",
            "1",
            "2",
            "none",
            "ms",
            "ready",
        ];
        let row: Vec<Option<String>> = values.iter().map(|v| Some(v.to_string())).collect();

        let databases = summarize_databases(&columns, &[row]);
        assert_eq!(databases.len(), 1);
        let db = &databases[0];
        assert_eq!(db.name, "power_db");
        assert_eq!(db.table_count, Some(24));
        assert_eq!(db.precision.as_deref(), Some("ms"));
        assert_eq!(db.replica, Some(1));
        assert_eq!(db.vgroups, Some(4));
        // keep0/keep1 合并展示。
        assert_eq!(db.keep.as_deref(), Some("3650d,3650d"));
        assert_eq!(db.status.as_deref(), Some("ready"));
        assert_eq!(db.create_time.as_deref(), Some("2024-05-01 10:00:00.000"));
    }

    #[test]
    fn test_summarize_databases_tolerates_missing_columns() {
        // 列缺失变体:仅 name 一列,其余属性保持 None。
        let columns = vec!["name".to_string()];
        let row = vec![Some("log_db".to_string())];

        let databases = summarize_databases(&columns, &[row]);
        assert_eq!(databases.len(), 1);
        let db = &databases[0];
        assert_eq!(db.name, "log_db");
        assert_eq!(db.table_count, None);
        assert_eq!(db.precision, None);
        assert_eq!(db.replica, None);
        assert_eq!(db.vgroups, None);
        assert_eq!(db.keep, None);
        assert_eq!(db.status, None);
        assert_eq!(db.create_time, None);
    }

    #[test]
    fn test_summarize_databases_legacy_keep_and_created_time() {
        // 老版本变体:单 keep 列 + created_time 列名。
        let columns: Vec<String> = ["name", "created_time", "ntables", "keep"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let row: Vec<Option<String>> = ["old_db", "2023-01-01 00:00:00", "12", "3650d"]
            .iter()
            .map(|v| Some(v.to_string()))
            .collect();

        let databases = summarize_databases(&columns, &[row]);
        assert_eq!(databases.len(), 1);
        let db = &databases[0];
        assert_eq!(db.table_count, Some(12));
        // 单 keep 列直接使用原始值。
        assert_eq!(db.keep.as_deref(), Some("3650d"));
        assert_eq!(db.create_time.as_deref(), Some("2023-01-01 00:00:00"));
    }

    #[test]
    fn test_summarize_databases_filters_system_databases() {
        let columns = vec!["name".to_string(), "ntables".to_string()];
        let rows = vec![
            vec![
                Some("information_schema".to_string()),
                Some("17".to_string()),
            ],
            vec![
                Some("performance_schema".to_string()),
                Some("9".to_string()),
            ],
            vec![Some("power_db".to_string()), Some("3".to_string())],
        ];

        let databases = summarize_databases(&columns, &rows);
        // 内置系统库隐藏,仅保留用户库。
        assert_eq!(databases.len(), 1);
        assert_eq!(databases[0].name, "power_db");
        assert_eq!(databases[0].table_count, Some(3));
    }

    #[test]
    fn test_merge_keep_text_variants() {
        // 优先单 keep 列。
        assert_eq!(
            merge_keep_text(Some("3650d"), Some("3650d"), Some("3650d")),
            Some("3650d".to_string())
        );
        // keep0/keep1 拼接。
        assert_eq!(
            merge_keep_text(None, Some("3650d"), Some("1825d")),
            Some("3650d,1825d".to_string())
        );
        // 仅 keep0。
        assert_eq!(
            merge_keep_text(None, Some("3650d"), None),
            Some("3650d".to_string())
        );
        // 全部缺失。
        assert_eq!(merge_keep_text(None, None, None), None);
    }

    #[test]
    fn test_map_table_rows_from_ins_tables() {
        // information_schema.INS_TABLES 风格:含类型列与标签数列。
        let cols = [
            "vgroup_id",
            "db_name",
            "table_name",
            "create_time",
            "columns",
            "tag_columns",
            "type",
            "stable_name",
        ];
        let columns: Vec<String> = cols.iter().map(|s| s.to_string()).collect();
        let rows = vec![
            mock_row(
                &cols,
                &[
                    "2",
                    "power_db",
                    "meters",
                    "2024-05-01 10:00:00",
                    "4",
                    "2",
                    "SUPER_TABLE",
                    "",
                ],
            ),
            mock_row(
                &cols,
                &[
                    "2",
                    "power_db",
                    "d1001",
                    "2024-05-01 10:01:00",
                    "4",
                    "2",
                    "CHILD_TABLE",
                    "meters",
                ],
            ),
            mock_row(
                &cols,
                &[
                    "3",
                    "power_db",
                    "alarm",
                    "2024-05-02 08:00:00",
                    "2",
                    "0",
                    "NORMAL_TABLE",
                    "",
                ],
            ),
        ];

        let index = probe_table_columns(&columns);
        let tables = map_table_rows(&index, &rows, TdengineTableKind::Normal);
        assert_eq!(tables.len(), 3);

        assert_eq!(tables[0].name, "meters");
        assert_eq!(tables[0].kind, TdengineTableKind::Super);
        assert_eq!(tables[0].column_count, Some(4));
        assert_eq!(tables[0].tag_count, Some(2));
        assert_eq!(tables[0].stable_name, None);

        assert_eq!(tables[1].name, "d1001");
        assert_eq!(tables[1].kind, TdengineTableKind::Child);
        assert_eq!(tables[1].stable_name.as_deref(), Some("meters"));

        assert_eq!(tables[2].name, "alarm");
        assert_eq!(tables[2].kind, TdengineTableKind::Normal);
    }

    #[test]
    fn test_map_table_rows_from_show_tables_infers_child_by_stable() {
        // SHOW TABLES 风格:无类型列,所属超级表非空即推断为子表。
        let columns: Vec<String> = ["table_name", "stable_name", "created_time"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let rows = vec![
            mock_row(
                &["table_name", "stable_name", "created_time"],
                &["d1001", "meters", "2024-05-01 10:01:00"],
            ),
            mock_row(
                &["table_name", "stable_name", "created_time"],
                &["alarm", "", "2024-05-02 08:00:00"],
            ),
        ];

        let index = probe_table_columns(&columns);
        let tables = map_table_rows(&index, &rows, TdengineTableKind::Normal);
        assert_eq!(tables.len(), 2);
        assert_eq!(tables[0].kind, TdengineTableKind::Child);
        assert_eq!(tables[0].stable_name.as_deref(), Some("meters"));
        assert_eq!(tables[1].kind, TdengineTableKind::Normal);
        assert_eq!(tables[1].stable_name, None);
        assert_eq!(
            tables[1].create_time.as_deref(),
            Some("2024-05-02 08:00:00")
        );
    }

    #[test]
    fn test_map_table_rows_from_show_stables() {
        // SHOW STABLES 风格:默认超级表,含列数/标签数。
        let columns: Vec<String> = ["name", "created_time", "columns", "tags"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let rows = vec![mock_row(
            &["name", "created_time", "columns", "tags"],
            &["meters", "2024-05-01 10:00:00", "4", "2"],
        )];

        let index = probe_table_columns(&columns);
        let tables = map_table_rows(&index, &rows, TdengineTableKind::Super);
        assert_eq!(tables.len(), 1);
        assert_eq!(tables[0].name, "meters");
        assert_eq!(tables[0].kind, TdengineTableKind::Super);
        assert_eq!(tables[0].column_count, Some(4));
        assert_eq!(tables[0].tag_count, Some(2));
    }

    #[test]
    fn test_map_table_rows_from_ins_stables_with_stable_name_column() {
        // INS_STABLES 列名变体:名称列为 stable_name,与所属超级表候选同名,
        // 名称探测需命中该列且超级表的所属超级表清空(避免自引用)。
        let cols = ["stable_name", "db_name", "create_time", "columns", "tags"];
        let columns: Vec<String> = cols.iter().map(|s| s.to_string()).collect();
        let rows = vec![mock_row(
            &cols,
            &["meters", "power_db", "2024-05-01 10:00:00", "4", "2"],
        )];

        let index = probe_table_columns(&columns);
        let tables = map_table_rows(&index, &rows, TdengineTableKind::Super);
        assert_eq!(tables.len(), 1);
        assert_eq!(tables[0].name, "meters");
        assert_eq!(tables[0].kind, TdengineTableKind::Super);
        assert_eq!(tables[0].tag_count, Some(2));
        assert_eq!(tables[0].stable_name, None);
    }

    #[test]
    fn test_table_kind_from_type() {
        assert_eq!(
            table_kind_from_type(Some("SUPER_TABLE")),
            Some(TdengineTableKind::Super)
        );
        assert_eq!(
            table_kind_from_type(Some("child_table")),
            Some(TdengineTableKind::Child)
        );
        assert_eq!(
            table_kind_from_type(Some("NORMAL_TABLE")),
            Some(TdengineTableKind::Normal)
        );
        // 无法识别或缺失时交由调用方推断。
        assert_eq!(table_kind_from_type(Some("VIEW")), None);
        assert_eq!(table_kind_from_type(None), None);
    }

    #[test]
    fn test_escape_single_quoted() {
        assert_eq!(escape_single_quoted("power_db"), "power_db");
        assert_eq!(escape_single_quoted("a'b"), "a''b");
    }

    #[test]
    fn test_describe_type_takes_width() {
        assert!(tdengine_type_takes_width("BINARY"));
        assert!(tdengine_type_takes_width("nchar"));
        assert!(!tdengine_type_takes_width("INT"));
        assert!(!tdengine_type_takes_width("TIMESTAMP"));
    }

    #[test]
    fn test_format_i64_cell_missing_shows_dash() {
        assert_eq!(format_i64_cell(Some(24)), "24");
        assert_eq!(format_i64_cell(None), "-");
    }

    // === 新增:对象视图构建测试 ===

    #[test]
    fn databases_object_view_includes_special_columns_when_probe_hits() {
        let cols = [
            "name",
            "ntables",
            "precision",
            "replica",
            "vgroups",
            "keep0",
            "keep1",
            "status",
            "create_time",
        ];
        let columns: Vec<String> = cols.iter().map(|s| s.to_string()).collect();
        let rows = vec![mock_row(
            &cols,
            &[
                "power_db",
                "24",
                "ms",
                "1",
                "4",
                "3650d",
                "3650d",
                "ready",
                "2024-05-01 10:00:00.000",
            ],
        )];

        let view = databases_object_view(&columns, &rows);
        let keys: Vec<&str> = view.columns.iter().map(|c| c.key.as_str()).collect();
        assert_eq!(
            keys,
            vec![
                "name",
                "tables",
                "precision",
                "replica",
                "vgroups",
                "keep",
                "status",
                "create_time"
            ]
        );
        assert_eq!(view.rows.len(), 1);
        assert_eq!(view.rows[0][0], "power_db");
        assert_eq!(view.rows[0][1], "24");
        assert_eq!(view.rows[0][5], "3650d,3650d");
        assert_eq!(view.rows[0][6], "ready");
    }

    #[test]
    fn databases_object_view_omits_missing_columns() {
        // 仅 name 列:视图只剩名称列。
        let columns = vec!["name".to_string()];
        let rows = vec![vec![Some("log_db".to_string())]];

        let view = databases_object_view(&columns, &rows);
        assert_eq!(view.columns.len(), 1);
        assert_eq!(view.columns[0].key, "name");
        assert_eq!(view.rows[0], vec!["log_db".to_string()]);
    }

    #[test]
    fn databases_object_view_hides_system_databases() {
        let cols = ["name", "ntables"];
        let columns: Vec<String> = cols.iter().map(|s| s.to_string()).collect();
        let rows = vec![
            mock_row(&cols, &["information_schema", "17"]),
            mock_row(&cols, &["power_db", "3"]),
        ];
        let view = databases_object_view(&columns, &rows);
        assert_eq!(view.rows.len(), 1);
        assert_eq!(view.rows[0][0], "power_db");
    }

    #[test]
    fn tables_object_view_appends_columns_by_availability() {
        let tables = vec![
            TdengineTableSummary {
                name: "meters".to_string(),
                kind: TdengineTableKind::Super,
                column_count: Some(4),
                tag_count: Some(2),
                stable_name: None,
                create_time: Some("2024-05-01 10:00:00".to_string()),
            },
            TdengineTableSummary {
                name: "d1001".to_string(),
                kind: TdengineTableKind::Child,
                column_count: None,
                tag_count: None,
                stable_name: Some("meters".to_string()),
                create_time: None,
            },
        ];
        let view = tables_object_view(&tables);
        let keys: Vec<&str> = view.columns.iter().map(|c| c.key.as_str()).collect();
        assert_eq!(
            keys,
            vec![
                "name",
                "type",
                "column_count",
                "tag_count",
                "stable_name",
                "create_time"
            ]
        );
        assert_eq!(view.rows[0][1], "Super Table");
        assert_eq!(view.rows[0][2], "4");
        assert_eq!(view.rows[1][1], "Child Table");
        assert_eq!(view.rows[1][2], "-");
        assert_eq!(view.rows[1][4], "meters");
    }

    #[test]
    fn tables_object_view_minimal_columns() {
        let tables = vec![TdengineTableSummary {
            name: "alarm".to_string(),
            kind: TdengineTableKind::Normal,
            ..Default::default()
        }];
        let view = tables_object_view(&tables);
        assert_eq!(view.columns.len(), 2);
        assert_eq!(
            view.rows[0],
            vec!["alarm".to_string(), "Normal Table".to_string()]
        );
    }

    #[test]
    fn table_kind_wire_tags_are_distinct() {
        assert_eq!(TdengineTableKind::Super.wire_tag(), "super");
        assert_eq!(TdengineTableKind::Child.wire_tag(), "child");
        assert_eq!(TdengineTableKind::Normal.wire_tag(), "normal");
    }
}
