use anyhow::{Result, bail};
use serde::Deserialize;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};

const APP_NAME: &str = "onetcli";
const DISCOVERY_FILE_NAME: &str = "public-mcp.json";
const DISCOVERY_VERSION: u32 = 1;
const TOKEN_HEX_LEN: usize = 64;

#[derive(Clone, Debug, Deserialize)]
pub struct DiscoveryDocument {
    pub version: u32,
    pub app: String,
    pub pid: u32,
    pub host: String,
    pub port: u16,
    pub token: String,
    pub mode: String,
}

impl DiscoveryDocument {
    pub fn socket_addr(&self) -> Result<SocketAddr> {
        Ok(format!("{}:{}", self.host, self.port).parse()?)
    }

    pub fn validate_for_stdio_bridge(&self) -> Result<()> {
        if self.version != DISCOVERY_VERSION {
            bail!(
                "unsupported public MCP discovery version {} (expected {})",
                self.version,
                DISCOVERY_VERSION
            );
        }
        if self.app != APP_NAME {
            bail!("unexpected app `{}` in public MCP discovery", self.app);
        }
        let addr = self.socket_addr()?;
        if !addr.ip().is_loopback() {
            bail!(
                "public MCP discovery must point to a loopback address, got {}",
                addr.ip()
            );
        }
        if !is_valid_token(&self.token) {
            bail!("invalid token in public MCP discovery");
        }
        Ok(())
    }
}

pub fn public_mcp_discovery_path() -> PathBuf {
    let base = dirs::config_dir()
        .or_else(dirs::data_dir)
        .unwrap_or_else(std::env::temp_dir);
    base.join(APP_NAME).join(DISCOVERY_FILE_NAME)
}

pub fn read_discovery(path: &Path) -> Result<DiscoveryDocument> {
    let text = std::fs::read_to_string(path)?;
    Ok(serde_json::from_str(&text)?)
}

fn is_valid_token(token: &str) -> bool {
    token.len() == TOKEN_HEX_LEN && token.as_bytes().iter().all(|byte| byte.is_ascii_hexdigit())
}
