use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct IotDbConnectionConfig {
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_username", alias = "user")]
    pub username: String,
    #[serde(default = "default_password")]
    pub password: String,
    #[serde(default = "default_database")]
    pub database: String,
    #[serde(default = "default_time_zone")]
    pub time_zone: String,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: i64,
    #[serde(default = "default_fetch_size")]
    pub fetch_size: i32,
    #[serde(default)]
    pub rpc_compaction: bool,
    #[serde(default)]
    pub enable_redirect_query: bool,
}

impl IotDbConnectionConfig {
    pub fn endpoint(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }

    pub fn storage_group_filter(&self) -> &str {
        if self.database.trim().is_empty() {
            "root"
        } else {
            self.database.trim()
        }
    }

    pub fn to_iotdb_config(&self) -> iotdb::Config {
        let mut builder = iotdb::ConfigBuilder::new();
        builder
            .endpoint(&self.endpoint())
            .user(&self.username)
            .password(&self.password)
            .time_zone(&self.time_zone)
            .timeout(self.timeout_ms)
            .fetch_size(self.fetch_size)
            .enable_redirect_query(self.enable_redirect_query);
        if self.rpc_compaction {
            builder.enable_rpc_compaction();
        }
        builder.build()
    }
}

fn default_host() -> String {
    "127.0.0.1".to_string()
}

fn default_port() -> u16 {
    6667
}

fn default_username() -> String {
    "root".to_string()
}

fn default_password() -> String {
    "root".to_string()
}

fn default_database() -> String {
    "root".to_string()
}

fn default_time_zone() -> String {
    "UTC+8".to_string()
}

fn default_timeout_ms() -> i64 {
    30_000
}

fn default_fetch_size() -> i32 {
    1_000
}
