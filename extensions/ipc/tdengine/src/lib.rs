//! TDengine IPC 驱动扩展(`tdengine_driver`)。
//!
//! 基于 [`extension_driver`] 的 Tokio-first 运行时([`extension_driver::serve_async`])
//! 实现 database wire 协议;连接层复用官方 `taos` 连接器的 WebSocket 通道
//! (ws-rustls 纯 Rust 实现),经 taosAdapter 6041 端口与 TDengine 服务端通信。
//!
//! 模块划分对齐 duckdb IPC 驱动:
//! - `driver`:控制面 / 工厂(init / conn/open / connless 纯方法)。
//! - `handlers`:全部 wire 方法的处理函数。
//! - `tdengine_session`:taos 连接封装(DSN 连接、查询、值映射)。
//! - `metadata`:库/表列表元数据的纯映射逻辑(列探测 + 缺失容忍),
//!   逻辑移植自主仓 `crates/db/src/tdengine/plugin.rs`。
//! - `protocol`:连接配置解析与 DSN 构造(移植自主仓 `tdengine/connection.rs`)。
//! - `state`:每连接的游标状态机。
//! - `ddl`:TDengine 方言的 DDL 构造。
//! - `server`:transport 接入与共享错误 helper。

pub mod ddl;
pub mod driver;
pub mod handlers;
pub mod metadata;
pub mod protocol;
pub mod server;
pub mod state;
pub mod tdengine_session;
