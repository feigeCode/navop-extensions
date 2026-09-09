//! RocketMQ 中间件实现扩展 provider(独立安装,composite)。
//!
//! - 通过 `extension-protocol` over local_socket 与宿主通信
//!   (`ONETCLI_EXT_SOCKET`,与 elasticsearch 扩展一致的 IPC 结构);
//! - resource_type `middleware`、resource_id `rocketmq-resource`;
//! - 连接配置来自标准 §4 RocketMQ 表单(namesrv_addrs/acl_enabled/access_key/
//!   secret_key(secret,经宿主 ResolveSecret 反向解析)/timeout_ms);
//! - `middleware/*` 方法按标准 §3 分发,Remoting 协议实现完整移植自
//!   主仓 `rocketmq-runtime`(4B 总长 + 4B 头描述 + JSON 头 + body)。

mod acl;
mod admin;
mod config;
mod contract;
mod error;
mod ipc;
mod message;
mod protocol;
mod remoting;
mod server;
mod state;
mod types;

#[tokio::main]
async fn main() {
    server::run().await;
}
