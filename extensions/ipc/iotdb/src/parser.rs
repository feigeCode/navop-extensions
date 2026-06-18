use anyhow::{Context, Result, bail};
use extension_protocol::row::{CellValue, ColumnSpec, ColumnTypeKind, Row};

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedDataSet {
    pub columns: Vec<String>,
    pub rows: Vec<ParsedRow>,
    pub ignore_timestamp: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedRow {
    pub timestamp: i64,
    pub fields: Vec<ParsedField>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedField {
    pub data_type: String,
    pub value: CellValue,
}

impl ParsedDataSet {
    pub fn column_specs(&self) -> Vec<ColumnSpec> {
        let mut specs = Vec::new();
        if !self.ignore_timestamp {
            specs.push(ColumnSpec::new("Time", "INT64", ColumnTypeKind::I64).nullable(false));
        }
        for (idx, name) in self.columns.iter().enumerate() {
            let type_str = self
                .rows
                .iter()
                .find_map(|row| row.fields.get(idx))
                .map(|field| field.data_type.as_str())
                .unwrap_or("TEXT");
            specs.push(ColumnSpec::new(
                name.clone(),
                type_str,
                column_type_kind(type_str),
            ));
        }
        specs
    }

    pub fn protocol_rows(&self) -> Vec<Row> {
        self.rows
            .iter()
            .map(|row| {
                let mut cells = Vec::new();
                if !self.ignore_timestamp {
                    cells.push(CellValue::I64 {
                        value: row.timestamp,
                    });
                }
                cells.extend(row.fields.iter().map(|field| field.value.clone()));
                cells
            })
            .collect()
    }
}

pub fn parse_debug_dataset(debug: &str) -> Result<ParsedDataSet> {
    let columns = parse_columns(debug)?;
    let ignore_timestamp = debug.contains("ignore_time_stamp: Some(true)");
    let rows = parse_rows(debug)?;
    Ok(ParsedDataSet {
        columns,
        rows,
        ignore_timestamp,
    })
}

pub fn column_type_kind(type_str: &str) -> ColumnTypeKind {
    match type_str {
        "BOOLEAN" => ColumnTypeKind::Bool,
        "INT32" | "INT64" => ColumnTypeKind::I64,
        "FLOAT" | "DOUBLE" => ColumnTypeKind::F64,
        "TEXT" => ColumnTypeKind::Text,
        _ => ColumnTypeKind::Unknown,
    }
}

fn parse_columns(debug: &str) -> Result<Vec<String>> {
    let start = debug
        .find("columns: [")
        .context("DataSet debug output does not contain columns")?
        + "columns: ".len();
    let end = matching_bracket(debug, start, '[', ']')?;
    parse_string_array(&debug[start..=end])
}

fn parse_rows(debug: &str) -> Result<Vec<ParsedRow>> {
    let mut rows = Vec::new();
    let mut offset = 0;
    while let Some(relative) = debug[offset..].find("ValueRow {") {
        let start = offset + relative;
        let end = matching_bracket(debug, start + "ValueRow ".len(), '{', '}')?;
        rows.push(parse_row(&debug[start..=end])?);
        offset = end + 1;
    }
    Ok(rows)
}

fn parse_row(row_debug: &str) -> Result<ParsedRow> {
    let timestamp_start = row_debug
        .find("timestamp: ")
        .context("ValueRow debug output does not contain timestamp")?
        + "timestamp: ".len();
    let timestamp_end = row_debug[timestamp_start..]
        .find(',')
        .map(|idx| timestamp_start + idx)
        .context("ValueRow timestamp is not terminated")?;
    let timestamp = row_debug[timestamp_start..timestamp_end]
        .trim()
        .parse::<i64>()
        .context("ValueRow timestamp is not an i64")?;

    let fields_label = row_debug
        .find("fields: [")
        .context("ValueRow debug output does not contain fields")?;
    let fields_start = fields_label + "fields: ".len();
    let fields_end = matching_bracket(row_debug, fields_start, '[', ']')?;
    let fields_debug = &row_debug[fields_start + 1..fields_end];

    let mut fields = Vec::new();
    let mut offset = 0;
    while let Some(relative) = fields_debug[offset..].find("Field {") {
        let start = offset + relative;
        let end = matching_bracket(fields_debug, start + "Field ".len(), '{', '}')?;
        fields.push(parse_field(&fields_debug[start..=end])?);
        offset = end + 1;
    }

    Ok(ParsedRow { timestamp, fields })
}

fn parse_field(field_debug: &str) -> Result<ParsedField> {
    let data_type_start = field_debug
        .find("data_type: ")
        .context("Field debug output does not contain data_type")?
        + "data_type: ".len();
    let data_type_end = field_debug[data_type_start..]
        .find(',')
        .map(|idx| data_type_start + idx)
        .context("Field data_type is not terminated")?;
    let data_type = field_debug[data_type_start..data_type_end]
        .trim()
        .to_string();

    let value = match data_type.as_str() {
        "BOOLEAN" => parse_option_bool(field_debug, "bool_value")?
            .map(|value| CellValue::Bool { value })
            .unwrap_or(CellValue::Null),
        "INT32" => parse_option_i64(field_debug, "int_value")?
            .map(|value| CellValue::I64 { value })
            .unwrap_or(CellValue::Null),
        "INT64" => parse_option_i64(field_debug, "long_value")?
            .map(|value| CellValue::I64 { value })
            .unwrap_or(CellValue::Null),
        "FLOAT" => parse_option_f64(field_debug, "float_value")?
            .map(|value| CellValue::F64 { value })
            .unwrap_or(CellValue::Null),
        "DOUBLE" => parse_option_f64(field_debug, "double_value")?
            .map(|value| CellValue::F64 { value })
            .unwrap_or(CellValue::Null),
        "TEXT" => parse_option_bytes(field_debug, "binary_value")?
            .map(|bytes| CellValue::Text {
                value: String::from_utf8_lossy(&bytes).to_string(),
            })
            .unwrap_or(CellValue::Null),
        _ => CellValue::Null,
    };

    Ok(ParsedField { data_type, value })
}

fn parse_option_bool(input: &str, name: &str) -> Result<Option<bool>> {
    parse_option_atom(input, name).map(|atom| atom.map(|value| value == "true"))
}

fn parse_option_i64(input: &str, name: &str) -> Result<Option<i64>> {
    match parse_option_atom(input, name)? {
        Some(atom) => Ok(Some(atom.parse()?)),
        None => Ok(None),
    }
}

fn parse_option_f64(input: &str, name: &str) -> Result<Option<f64>> {
    match parse_option_atom(input, name)? {
        Some(atom) => Ok(Some(atom.parse()?)),
        None => Ok(None),
    }
}

fn parse_option_atom<'a>(input: &'a str, name: &str) -> Result<Option<&'a str>> {
    let needle = format!("{name}: ");
    let start = input
        .find(&needle)
        .with_context(|| format!("Field debug output does not contain {name}"))?
        + needle.len();
    if input[start..].starts_with("None") {
        return Ok(None);
    }
    if !input[start..].starts_with("Some(") {
        bail!("{name} is neither Some nor None");
    }
    let value_start = start + "Some(".len();
    let value_end = input[value_start..]
        .find(')')
        .map(|idx| value_start + idx)
        .with_context(|| format!("{name} Some value is not closed"))?;
    Ok(Some(input[value_start..value_end].trim()))
}

fn parse_option_bytes(input: &str, name: &str) -> Result<Option<Vec<u8>>> {
    let needle = format!("{name}: ");
    let start = input
        .find(&needle)
        .with_context(|| format!("Field debug output does not contain {name}"))?
        + needle.len();
    if input[start..].starts_with("None") {
        return Ok(None);
    }
    if !input[start..].starts_with("Some([") {
        bail!("{name} is neither Some([..]) nor None");
    }
    let array_start = start + "Some(".len();
    let array_end = matching_bracket(input, array_start, '[', ']')?;
    let content = input[array_start + 1..array_end].trim();
    if content.is_empty() {
        return Ok(Some(Vec::new()));
    }
    let bytes = content
        .split(',')
        .map(|part| part.trim().parse::<u8>().map_err(anyhow::Error::from))
        .collect::<Result<Vec<_>>>()?;
    Ok(Some(bytes))
}

fn parse_string_array(input: &str) -> Result<Vec<String>> {
    let trimmed = input.trim();
    if !trimmed.starts_with('[') || !trimmed.ends_with(']') {
        bail!("expected string array");
    }
    let mut values = Vec::new();
    let mut chars = trimmed[1..trimmed.len() - 1].chars().peekable();
    while let Some(ch) = chars.peek().copied() {
        if ch.is_whitespace() || ch == ',' {
            chars.next();
            continue;
        }
        if ch != '"' {
            bail!("expected string in array");
        }
        chars.next();
        let mut value = String::new();
        while let Some(ch) = chars.next() {
            match ch {
                '"' => break,
                '\\' => {
                    if let Some(escaped) = chars.next() {
                        value.push(escaped);
                    }
                }
                other => value.push(other),
            }
        }
        values.push(value);
    }
    Ok(values)
}

fn matching_bracket(input: &str, start: usize, open: char, close: char) -> Result<usize> {
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for (idx, ch) in input[start..].char_indices() {
        let absolute = start + idx;
        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        if ch == '"' {
            in_string = true;
            continue;
        }
        if ch == open {
            depth += 1;
        } else if ch == close {
            depth = depth.saturating_sub(1);
            if depth == 0 {
                return Ok(absolute);
            }
        }
    }
    bail!("no matching bracket found")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_iotdb_dataset_debug_output() {
        let debug = r#"DataSet { record_batch: RecordBatch { columns: ["root.ln.wf01.temperature", "root.ln.wf01.status"], values: [ValueRow { timestamp: 42, fields: [Field { data_type: FLOAT, bool_value: None, int_value: None, long_value: None, float_value: Some(18.5), double_value: None, binary_value: None }, Field { data_type: BOOLEAN, bool_value: Some(true), int_value: None, long_value: None, float_value: None, double_value: None, binary_value: None }] }, ValueRow { timestamp: 43, fields: [Field { data_type: FLOAT, bool_value: None, int_value: None, long_value: None, float_value: None, double_value: None, binary_value: None }, Field { data_type: BOOLEAN, bool_value: None, int_value: None, long_value: None, float_value: None, double_value: None, binary_value: None }] }] }, ignore_time_stamp: Some(false) }"#;

        let parsed = parse_debug_dataset(debug).unwrap();

        assert_eq!(parsed.columns.len(), 2);
        assert_eq!(parsed.rows.len(), 2);
        assert_eq!(parsed.column_specs()[0].name, "Time");
        assert_eq!(parsed.protocol_rows()[0][1], CellValue::F64 { value: 18.5 });
        assert_eq!(parsed.protocol_rows()[1][2], CellValue::Null);
    }
}
