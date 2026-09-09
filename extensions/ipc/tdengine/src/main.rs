use anyhow::Result;

/// TDengine IPC 驱动入口。
///
/// 标准模式:宿主(extension-host)先创建 local socket listener,把 socket 名
/// 通过 `ONETCLI_EXT_SOCKET` 环境变量透传过来,本进程主动 connect 后把
/// transport 交给共享运行时(`extension_driver::serve_async`)。
#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .init();

    let socket_name = std::env::var("ONETCLI_EXT_SOCKET")
        .ok()
        .or_else(|| std::env::args().nth(1))
        .unwrap_or_else(|| "navop-tdengine-driver.sock".to_string());

    tdengine_driver::server::run(&socket_name).await
}
