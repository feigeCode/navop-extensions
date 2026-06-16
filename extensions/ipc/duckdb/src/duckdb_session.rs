use anyhow::{Context, Result, anyhow};
use duckdb::Connection;
use serde::Deserialize;
use std::collections::HashMap;

pub const LEGACY_DUCKDB_CATALOG: &str = "main";

#[derive(Clone, Debug, Deserialize)]
pub struct DbConnectionConfig {
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub extra_params: HashMap<String, String>,
}

pub struct DuckDbSession {
    config: Option<DbConnectionConfig>,
    connection: Option<Connection>,
}

impl Default for DuckDbSession {
    fn default() -> Self {
        Self::new()
    }
}

impl DuckDbSession {
    pub fn new() -> Self {
        Self {
            config: None,
            connection: None,
        }
    }

    pub fn connect(&mut self, config: DbConnectionConfig) -> Result<()> {
        let path = database_path(&config)?;
        self.connection = Some(Connection::open(path).context("failed to open DuckDB database")?);
        self.config = Some(config);
        Ok(())
    }

    pub fn disconnect(&mut self) {
        self.connection = None;
        self.config = None;
    }

    pub fn ping(&self) -> Result<()> {
        self.connection()?;
        Ok(())
    }

    pub fn current_database(&self) -> Option<String> {
        self.connection
            .as_ref()
            .and_then(|connection| current_database_name(connection).ok())
    }

    pub fn current_catalog(&self) -> Result<String> {
        current_database_name(self.connection()?).context("failed to read DuckDB current catalog")
    }

    pub fn connection(&self) -> Result<&Connection> {
        self.connection
            .as_ref()
            .ok_or_else(|| anyhow!("DuckDB connection is not initialized"))
    }

    /// 取一个可跨线程调用的中断句柄,用于硬取消正在执行的查询。
    ///
    /// `duckdb::InterruptHandle` 是 `Send + Sync`,可在 reader 线程调用其 `interrupt()`
    /// 来中断本连接 worker 线程上正在跑的查询(查询会返回含 `INTERRUPT` 的错误)。
    pub fn interrupt_handle(&self) -> Option<std::sync::Arc<duckdb::InterruptHandle>> {
        self.connection.as_ref().map(|c| c.interrupt_handle())
    }
}

pub fn current_database_name(connection: &Connection) -> duckdb::Result<String> {
    connection.query_row("SELECT current_database()", [], |row| row.get(0))
}

pub fn is_default_catalog_reference(database: &str, current_catalog: &str) -> bool {
    let database = database.trim();
    database.is_empty() || database == current_catalog || database == LEGACY_DUCKDB_CATALOG
}

pub fn is_duckdb_catalog_schema(schema: &str) -> bool {
    matches!(schema.trim(), "information_schema" | "pg_catalog")
}

fn database_path(config: &DbConnectionConfig) -> Result<String> {
    if !config.host.trim().is_empty() {
        return Ok(config.host.clone());
    }
    if let Some(path) = config
        .database
        .as_ref()
        .filter(|database| !database.trim().is_empty())
    {
        return Ok(path.clone());
    }
    config
        .extra_params
        .get("path")
        .filter(|path| !path.trim().is_empty())
        .cloned()
        .ok_or_else(|| anyhow!("database path is required for DuckDB"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requires_database_path() {
        let config = DbConnectionConfig {
            host: String::new(),
            database: None,
            extra_params: Default::default(),
        };

        assert!(database_path(&config).is_err());
    }

    #[test]
    fn current_database_matches_duckdb_catalog() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir
            .path()
            .join("catalog_source.duckdb")
            .to_string_lossy()
            .to_string();
        let mut session = DuckDbSession::new();
        session
            .connect(DbConnectionConfig {
                host: path,
                database: None,
                extra_params: Default::default(),
            })
            .unwrap();

        let expected: String = session
            .connection()
            .unwrap()
            .query_row("SELECT current_database()", [], |row| row.get(0))
            .unwrap();

        assert_eq!(session.current_database().unwrap(), expected);
    }
}
