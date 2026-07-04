use serde_json::Value;

pub fn str_field<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
    })
}

pub fn owned_field(value: &Value, keys: &[&str]) -> Option<String> {
    str_field(value, keys)
        .map(ToOwned::to_owned)
        .or_else(|| numeric_field(value, keys).map(|value| value.to_string()))
}

pub fn port_field(value: &Value, keys: &[&str]) -> Option<u16> {
    keys.iter().find_map(|key| match value.get(*key) {
        Some(Value::Number(number)) => number.as_u64().and_then(|port| u16::try_from(port).ok()),
        Some(Value::String(text)) => text.trim().parse::<u16>().ok(),
        _ => None,
    })
}

pub fn slug(value: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in value.chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            last_dash = false;
        } else if !last_dash && !out.is_empty() {
            out.push('-');
            last_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "connection".to_string()
    } else {
        out
    }
}

pub fn database_type(raw: &str) -> Option<String> {
    let normalized = raw
        .trim()
        .to_ascii_lowercase()
        .replace([' ', '-', '.'], "_");
    match normalized.as_str() {
        "mysql" | "mariadb" | "mysql8" | "mysql5" => Some("my_sql".to_string()),
        "postgres" | "postgresql" | "postgres_jdbc" => Some("postgre_sql".to_string()),
        "sqlite" | "sqlite3" => Some("sqlite".to_string()),
        "duckdb" => Some("duck_db".to_string()),
        "sqlserver" | "sql_server" | "mssql" | "microsoft_sql_server" => {
            Some("sql_server".to_string())
        }
        "oracle" | "oracle_thin" => Some("oracle".to_string()),
        "clickhouse" | "click_house" => Some("click_house".to_string()),
        _ => None,
    }
}

fn numeric_field(value: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter().find_map(|key| value.get(*key)?.as_u64())
}
