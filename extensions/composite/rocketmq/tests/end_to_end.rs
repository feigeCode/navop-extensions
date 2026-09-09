//! 端到端测试:extension-host 拉起 provider 二进制,经 local_socket 走完整
//! resource open/ping/invoke/close 往返(仿 elasticsearch 端到端结构)。
//!
//! NameServer 以 mock TCP fixture 代替(真实 namesrv 不在单测范围):
//! fixture 直接讲 Remoting 二进制协议(4B 总长 + 4B 头描述 + JSON 头 + body)。

use std::collections::HashMap;
use std::{fs, net::Ipv4Addr, ops::Deref, path::Path, sync::Arc, time::Duration};

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

use extension_host::{
    HostApiHandler, HostApiProvider, HostError, HostResult, NegotiationConfig, ProcessRpcSession,
    ProcessRpcSessionConfig, SpawnConfig, UniversalPluginClient,
};
use extension_protocol::{
    error::{ProtocolError, error_codes},
    host,
    resource::{ResourceCloseParams, ResourceInvokeParams, ResourceOpenParams, ResourcePingParams},
    result_ref::ResultRef,
};
use serde_json::{Value, json};

fn copy_executable(source: &Path, destination: &Path) {
    fs::copy(source, destination).expect("copy provider executable");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(destination)
            .expect("provider executable metadata")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(destination, permissions).expect("make provider executable");
    }
}

struct TestHostApi {
    secret_allowed: bool,
}

#[async_trait::async_trait]
impl HostApiProvider for TestHostApi {
    async fn request_credential(
        &self,
        _params: host::RequestCredentialParams,
    ) -> HostResult<host::RequestCredentialResult> {
        Err(HostError::NotImplemented(
            "interactive credential requests are not used by this test host".into(),
        ))
    }

    async fn resolve_secret(
        &self,
        params: host::ResolveSecretParams,
    ) -> HostResult<host::ResolveSecretResult> {
        if !self.secret_allowed {
            return Err(HostError::protocol(ProtocolError::new(
                error_codes::PERMISSION_DENIED,
                "extension is not permitted to read this secret",
            )));
        }
        if params.secret_ref.secret_ref != "secret://rocketmq/secret_key" {
            return Err(HostError::protocol(ProtocolError::new(
                error_codes::SECRET_NOT_FOUND,
                "requested secret was not found",
            )));
        }
        Ok(host::ResolveSecretResult {
            value: b"test-secret".to_vec(),
        })
    }

    async fn notify(&self, _params: host::NotifyParams) -> HostResult<host::NotifyResult> {
        Err(HostError::NotImplemented(
            "notifications are not used by this test host".into(),
        ))
    }

    async fn storage_get(
        &self,
        _params: host::StorageGetParams,
    ) -> HostResult<host::StorageGetResult> {
        Err(HostError::NotImplemented(
            "storage is not used by this test host".into(),
        ))
    }

    async fn storage_set(&self, _params: host::StorageSetParams) -> HostResult<()> {
        Err(HostError::NotImplemented(
            "storage is not used by this test host".into(),
        ))
    }

    async fn log(&self, _params: host::LogParams) -> HostResult<()> {
        Err(HostError::NotImplemented(
            "host logging is not used by this test host".into(),
        ))
    }
}

/// 记录到的 Remoting 请求(头部字段)
#[derive(Clone, Debug)]
struct RecordedRemotingRequest {
    code: i32,
    ext_fields: HashMap<String, String>,
}

/// mock NameServer:按请求码回放 body,记录请求头
async fn spawn_namesrv_fixture() -> (std::net::SocketAddr, Arc<std::sync::Mutex<Vec<RecordedRemotingRequest>>>) {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .await
        .expect("bind mock namesrv");
    let addr = listener.local_addr().expect("mock namesrv address");
    let records = Arc::new(std::sync::Mutex::new(Vec::new()));
    let collector = Arc::clone(&records);
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            let records = Arc::clone(&collector);
            tokio::spawn(async move {
                let mut buffer = Vec::new();
                let mut chunk = [0u8; 4096];
                loop {
                    let read = match socket.read(&mut chunk).await {
                        Ok(0) | Err(_) => break,
                        Ok(read) => read,
                    };
                    buffer.extend_from_slice(&chunk[..read]);
                    // 尽力解析完整帧并响应
                    while buffer.len() >= 4 {
                        let total = match u32_from_be(&buffer[0..4]) {
                            Some(total) => total as usize,
                            None => break,
                        };
                        if buffer.len() < 4 + total {
                            break;
                        }
                        let frame: Vec<u8> = buffer.drain(..4 + total).collect();
                        let Some(header) = parse_frame_header(&frame[4..]) else {
                            continue;
                        };
                        records
                            .lock()
                            .expect("records lock")
                            .push(RecordedRemotingRequest {
                                code: header.code,
                                ext_fields: header.ext_fields.clone(),
                            });
                        let body = match header.code {
                            // GET_BROKER_CLUSTER_INFO → 空集群
                            106 => br#"{"brokerAddrTable":{},"clusterAddrTable":{}}"#.to_vec(),
                            // GET_ALL_TOPIC_LIST_FROM_NAMESERVER → 样本 Topic 集
                            206 => br#"{"topicList":["order-topic","%RETRY%order-group"]}"#.to_vec(),
                            _ => br#"{}"#.to_vec(),
                        };
                        if write_response(&mut socket, header.opaque, body).await.is_err() {
                            return;
                        }
                    }
                }
            });
        }
    });
    (addr, records)
}

/// 解析后的 Remoting 头
struct RemotingHeader {
    code: i32,
    opaque: i32,
    ext_fields: HashMap<String, String>,
}/// 大端读取 4B 无符号整数
fn u32_from_be(bytes: &[u8]) -> Option<u32> {
    Some(u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

/// 解析帧体(4B 头部描述 + JSON 头)中的头部字段
fn parse_frame_header(frame: &[u8]) -> Option<RemotingHeader> {
    if frame.len() < 4 {
        return None;
    }
    let desc = u32_from_be(&frame[0..4])?;
    let header_len = (desc & 0x00FF_FFFF) as usize;
    if 4 + header_len > frame.len() {
        return None;
    }
    let header: Value = serde_json::from_slice(&frame[4..4 + header_len]).ok()?;
    let mut ext_fields = HashMap::new();
    if let Some(fields) = header.get("extFields").and_then(Value::as_object) {
        for (key, value) in fields {
            if let Some(text) = value.as_str() {
                ext_fields.insert(key.clone(), text.to_string());
            }
        }
    }
    Some(RemotingHeader {
        code: header.get("code").and_then(Value::as_i64)? as i32,
        opaque: header.get("opaque").and_then(Value::as_i64).unwrap_or(0) as i32,
        ext_fields,
    })
}

/// 写一帧成功响应(code=0, flag=1, opaque 回填)
async fn write_response(
    socket: &mut tokio::net::TcpStream,
    opaque: i32,
    body: Vec<u8>,
) -> std::io::Result<()> {
    let header = format!(
        r#"{{"code":0,"language":"JAVA","version":412,"opaque":{opaque},"flag":1}}"#
    );
    let header_bytes = header.as_bytes();
    let total = 4 + header_bytes.len() + body.len();
    let mut frame = Vec::with_capacity(4 + total);
    frame.extend_from_slice(&(total as u32).to_be_bytes());
    // serialize_type=JSON(0) << 24 | header_len
    frame.extend_from_slice(&((header_bytes.len() as u32) & 0x00FF_FFFF).to_be_bytes());
    frame.extend_from_slice(header_bytes);
    frame.extend_from_slice(&body);
    socket.write_all(&frame).await
}

struct TestPluginClient {
    inner: UniversalPluginClient,
    allowed_port: u16,
}

impl TestPluginClient {
    fn new(inner: UniversalPluginClient, allowed_port: u16) -> Self {
        Self {
            inner,
            allowed_port,
        }
    }

    /// 宿主侧网络权限预检:namesrv_addrs 仅允许 127.0.0.1:allowed_port
    async fn open_resource(
        &self,
        params: &ResourceOpenParams,
    ) -> HostResult<extension_protocol::resource::ResourceOpenResult> {
        let addrs = match params.config.get("namesrv_addrs") {
            Some(Value::Array(items)) => items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>(),
            Some(Value::String(text)) => text
                .split(';')
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(str::to_string)
                .collect(),
            _ => Vec::new(),
        };
        let endpoint_allowed = !addrs.is_empty()
            && addrs.iter().all(|addr| {
                let (host, port) = addr.rsplit_once(':').unwrap_or((addr.as_str(), ""));
                host == "127.0.0.1" && port == self.allowed_port.to_string()
            });
        if !endpoint_allowed {
            return Err(HostError::protocol(ProtocolError::new(
                error_codes::PERMISSION_DENIED,
                "extension is not permitted to connect to this network endpoint",
            )));
        }
        self.inner.open_resource(params).await
    }
}

impl Deref for TestPluginClient {
    type Target = UniversalPluginClient;

    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

struct TestHarness {
    client: TestPluginClient,
    session: Arc<ProcessRpcSession>,
    root: tempfile::TempDir,
    records: Arc<std::sync::Mutex<Vec<RecordedRemotingRequest>>>,
    namesrv_port: u16,
}

async fn harness(secret_allowed: bool) -> TestHarness {
    let (namesrv, records) = spawn_namesrv_fixture().await;
    let port = namesrv.port();
    build_harness(secret_allowed, port, records).await
}

async fn build_harness(
    secret_allowed: bool,
    namesrv_port: u16,
    records: Arc<std::sync::Mutex<Vec<RecordedRemotingRequest>>>,
) -> TestHarness {
    let root = tempfile::tempdir().expect("extension temp root");
    let bin_dir = root.path().join("bin");
    fs::create_dir_all(&bin_dir).expect("create bin directory");
    copy_executable(
        Path::new(env!("CARGO_BIN_EXE_rocketmq-provider")),
        &bin_dir.join("rocketmq-provider"),
    );
    let spawn = SpawnConfig::new(bin_dir.join("rocketmq-provider"))
        .with_program_root(root.path())
        .with_ready_timeout(Duration::from_secs(5));
    let negotiation =
        NegotiationConfig::new("0.15.2", "rocketmq-e2e").offer_api("extension", "1.0");
    let config = ProcessRpcSessionConfig::new(spawn, negotiation)
        .with_request_timeout(Duration::from_secs(8))
        .with_shutdown_grace_ms(2_500)
        .with_label("com.navop.middleware.rocketmq::main")
        .with_host_api(Arc::new(HostApiHandler::new(Arc::new(TestHostApi {
            secret_allowed,
        }))));
    let session = Arc::new(
        ProcessRpcSession::start(config)
            .await
            .expect("start provider"),
    );
    let client = TestPluginClient::new(
        UniversalPluginClient::new(Arc::clone(&session)),
        namesrv_port,
    );
    TestHarness {
        client,
        session,
        root,
        records,
        namesrv_port,
    }
}

fn open_params(namesrv_port: u16) -> ResourceOpenParams {
    ResourceOpenParams {
        resource_type: "middleware".into(),
        config: json!({
            "namesrv_addrs": [format!("127.0.0.1:{namesrv_port}")],
            "acl_enabled": "none",
            "timeout_ms": 3000
        }),
        metadata: None,
    }
}

fn acl_open_params(namesrv_port: u16) -> ResourceOpenParams {
    ResourceOpenParams {
        resource_type: "middleware".into(),
        config: json!({
            "namesrv_addrs": [format!("127.0.0.1:{namesrv_port}")],
            "acl_enabled": "rocketmq",
            "access_key": "rocketmq",
            "credential_refs": {"secret_key": "secret://rocketmq/secret_key"},
            "timeout_ms": 3000
        }),
        metadata: None,
    }
}

/// 内联结果解包辅助
fn inline(value: extension_protocol::resource::ResourceInvokeResult) -> Value {
    let ResultRef::Inline { value } = value.result else {
        panic!("期望内联结果, 实际: {:?}", value.result)
    };
    value
}

#[tokio::test]
async fn provider_opens_resource_and_serves_capabilities_roundtrip() {
    let harness = harness(true).await;
    let opened = harness
        .client
        .open_resource(&open_params(harness.namesrv_port))
        .await
        .expect("open resource");
    // 固定资源 id(标准 §1/§5.1)
    assert_eq!("rocketmq-resource", opened.resource_id);
    let capabilities = opened
        .capabilities
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    assert!(capabilities.contains(&"middleware/capabilities"));
    assert!(capabilities.contains(&"middleware/topic/list"));
    assert!(capabilities.contains(&"middleware/message/send"));
    assert_eq!(13, capabilities.len());
    assert_eq!(
        Some(&json!({
            "standard_version": 1,
            "resource": "rocketmq",
            "namesrv_addrs": format!("127.0.0.1:{}", harness.namesrv_port),
            "acl_enabled": false,
            "protocol": "rocketmq-remoting-json",
            "network": true,
        })),
        opened.metadata.as_ref()
    );

    // capabilities 方法往返(标准 §3)
    let caps = harness
        .client
        .invoke_resource(&ResourceInvokeParams {
            resource_id: opened.resource_id.clone(),
            method: "middleware/capabilities".into(),
            params: Value::Null,
        })
        .await
        .expect("invoke capabilities");
    let caps = inline(caps);
    assert_eq!(1, caps["standard_version"]);
    for flag in [
        "topics",
        "topic_write",
        "groups",
        "clients",
        "message_query",
        "send_message",
        "metrics",
        "cluster_overview",
    ] {
        assert_eq!(
            true,
            caps["capabilities"][flag],
            "RocketMQ 能力位 {flag} 应全开"
        );
    }

    // 集群概览走真实 Remoting 协议到 mock NameServer
    let overview = harness
        .client
        .invoke_resource(&ResourceInvokeParams {
            resource_id: opened.resource_id.clone(),
            method: "middleware/cluster/overview".into(),
            params: Value::Null,
        })
        .await
        .expect("invoke cluster overview");
    assert_eq!(json!({"clusters": []}), inline(overview));

    // Topic 列表(NameServer 全量列表 + 空集群配置补全)
    let topics = harness
        .client
        .invoke_resource(&ResourceInvokeParams {
            resource_id: opened.resource_id.clone(),
            method: "middleware/topic/list".into(),
            params: Value::Null,
        })
        .await
        .expect("invoke topic list");
    let topics = inline(topics);
    let names = topics["topics"]
        .as_array()
        .expect("topics 数组")
        .iter()
        .map(|topic| topic["name"].as_str().expect("name").to_string())
        .collect::<Vec<_>>();
    assert_eq!(names, ["%RETRY%order-group", "order-topic"]);

    harness
        .client
        .ping_resource(&ResourcePingParams {
            resource_id: opened.resource_id.clone(),
        })
        .await
        .expect("ping");

    // 未知方法 → 协议错误(不支持的操作 前缀)
    let error = harness
        .client
        .invoke_resource(&ResourceInvokeParams {
            resource_id: opened.resource_id.clone(),
            method: "middleware/unknown".into(),
            params: Value::Null,
        })
        .await
        .expect_err("未知方法应报错");
    let HostError::Protocol(protocol) = error else {
        panic!("协议错误 expected")
    };
    assert_eq!(error_codes::CAPABILITY_DISABLED, protocol.code);
    assert!(protocol.message.contains("不支持的操作"));

    harness
        .client
        .close_resource(&ResourceCloseParams {
            resource_id: opened.resource_id.clone(),
        })
        .await
        .expect("close resource");
    // 关闭后再 invoke → RESOURCE_CLOSED
    let error = harness
        .client
        .invoke_resource(&ResourceInvokeParams {
            resource_id: opened.resource_id,
            method: "middleware/capabilities".into(),
            params: Value::Null,
        })
        .await
        .expect_err("closed resource cannot invoke");
    assert!(matches!(
        error,
        HostError::Protocol(ref protocol) if protocol.code == error_codes::RESOURCE_CLOSED
    ));

    // Remoting 请求落盘校验:
    // open 验证(106)+ 概览 cluster_info(106)+ 概览推导 master(106)
    // + Topic 列表(206)+ Topic 配置推导 master(106)
    let codes = {
        let records = harness.records.lock().expect("records lock");
        records.iter().map(|r| r.code).collect::<Vec<_>>()
    };
    assert_eq!(codes, [106, 106, 106, 206, 106]);

    harness.session.shutdown().await;
    assert!(harness.session.is_closed());
    drop(harness.root);
}

#[tokio::test]
async fn acl_secret_is_resolved_via_host_and_signature_is_sent() {
    let harness = harness(true).await;
    let opened = harness
        .client
        .open_resource(&acl_open_params(harness.namesrv_port))
        .await
        .expect("open resource with acl");
    assert_eq!("rocketmq-resource", opened.resource_id);
    assert_eq!(
        true,
        opened.metadata.as_ref().expect("metadata")["acl_enabled"]
    );

    // ACL 开启:NameServer 请求头应含 AccessKey 与 HMAC-SHA1 签名
    let metrics = harness
        .client
        .invoke_resource(&ResourceInvokeParams {
            resource_id: opened.resource_id.clone(),
            method: "middleware/topic/list".into(),
            params: Value::Null,
        })
        .await
        .expect("invoke with acl");
    assert!(inline(metrics)["topics"].is_array());

    let signed_access_key = {
        let records = harness.records.lock().expect("records lock");
        records
            .iter()
            .find(|record| record.ext_fields.contains_key("Signature"))
            .and_then(|record| record.ext_fields.get("AccessKey").cloned())
    };
    assert_eq!(
        signed_access_key.as_deref(),
        Some("rocketmq"),
        "签名请求应被 mock NameServer 记录且携带 AccessKey"
    );

    harness
        .client
        .close_resource(&ResourceCloseParams {
            resource_id: opened.resource_id,
        })
        .await
        .expect("close resource");
    harness.session.shutdown().await;
}

#[tokio::test]
async fn secret_permission_is_enforced_before_lookup() {
    let harness = harness(false).await;
    let error = harness
        .client
        .open_resource(&acl_open_params(harness.namesrv_port))
        .await
        .expect_err("secret denied");
    let HostError::Protocol(protocol) = error else {
        panic!("protocol error expected: {error:?}")
    };
    assert_eq!(error_codes::PERMISSION_DENIED, protocol.code);
    // 未解析到 secret 前不应发出任何 Remoting 请求
    assert!(harness.records.lock().expect("records lock").is_empty());
    harness.session.shutdown().await;
}

#[tokio::test]
async fn network_permission_is_enforced_before_provider_rpc() {
    let harness = harness(true).await;
    let mut params = open_params(harness.namesrv_port);
    params.config["namesrv_addrs"] =
        json!([format!("127.0.0.1:{}", harness.namesrv_port + 1)]);
    let error = harness
        .client
        .open_resource(&params)
        .await
        .expect_err("network denied");
    assert!(matches!(
        error,
        HostError::Protocol(ref protocol) if protocol.code == error_codes::PERMISSION_DENIED
    ));
    assert!(harness.records.lock().expect("records lock").is_empty());
    harness.session.shutdown().await;
}

#[tokio::test]
async fn invalid_config_is_rejected_as_invalid_params() {
    let harness = harness(true).await;
    let mut params = open_params(harness.namesrv_port);
    // acl=rocketmq 但缺 access_key
    params.config["acl_enabled"] = json!("rocketmq");
    params.config["credential_refs"] = json!({"secret_key": "secret://rocketmq/secret_key"});
    let error = harness
        .client
        .open_resource(&params)
        .await
        .expect_err("missing access_key");
    let HostError::Protocol(protocol) = error else {
        panic!("protocol error expected: {error:?}")
    };
    assert_eq!(error_codes::INVALID_PARAMS, protocol.code);
    assert!(protocol.message.contains("配置错误"));

    // acl_enabled 非法取值
    let mut params = open_params(harness.namesrv_port);
    params.config["acl_enabled"] = json!("ldap");
    let error = harness
        .client
        .open_resource(&params)
        .await
        .expect_err("invalid acl_enabled");
    assert!(matches!(
        error,
        HostError::Protocol(ref protocol) if protocol.code == error_codes::INVALID_PARAMS
    ));
    harness.session.shutdown().await;
}
