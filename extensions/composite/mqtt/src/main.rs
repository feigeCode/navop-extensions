//! MQTT 中间件实现扩展的 IPC provider(标准:middleware-standard v1)。
//!
//! resource_type `middleware`,resource_id 前缀 `mqtt-resource-`(每次打开唯一)。
//! provider 只负责传输与标准 §3 方法定义;连接端口的网络权限由宿主在
//! `resource/open` 之前检查,密码等 secret 经宿主 reverse Host API 以
//! `secret://self/...` 引用注入(扩展清单声明 `secrets:read:self.*`)。
//! 连接测试语义在 open:连不上即失败。

mod admin;
mod builtin;
mod config;
mod connection;
mod contract;
mod error;
mod ipc;
mod middleware_contract;
mod pubsub;
mod resource;
mod server;
mod state;
mod types;

#[tokio::main]
async fn main() {
    // rumqttc 以 use-rustls-no-provider 编译,需在进程级安装默认加密后端;
    // 用 ring 以兼容 i686-pc-windows-msvc(aws-lc-sys 不支持 32 位 MSVC)。
    let _ = rustls::crypto::ring::default_provider().install_default();
    server::run().await;
}
