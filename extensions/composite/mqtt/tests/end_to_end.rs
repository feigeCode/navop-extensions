//! 端到端测试:extension-host 拉起 mqtt-provider,经 extension-protocol 完成
//! resource open/invoke/close 与标准 §3 方法往返。
//!
//! 真实 MQTT broker 不在单测范围:这里实现一个**最小 MQTT 3.1.1 假 broker**
//! (仅覆盖 CONNECT/CONNACK、SUBSCRIBE/SUBACK、PUBLISH/PUBACK、PINGREQ/PINGRESP、
//! DISCONNECT),足以验证 rumqttc 建连、自动订阅 `#`、消息流入环形缓冲、
//! 发送消息、secret 反向解析与错误映射。

use std::{
    fs,
    net::Ipv4Addr,
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
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
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

// ---------------------------------------------------------------------------
// 最小 MQTT 3.1.1 假 broker
// ---------------------------------------------------------------------------

/// 一次客户端连接的 CONNECT 信息
#[derive(Debug, Clone)]
struct ConnectInfo {
    client_id: String,
    username: Option<String>,
    password: Option<String>,
    #[allow(dead_code)]
    keep_alive: u16,
}

/// 客户端发布的一条消息
#[derive(Debug, Clone, PartialEq, Eq)]
struct PublishInfo {
    topic: String,
    payload: Vec<u8>,
    qos: u8,
}

/// broker 记录的全局状态(测试侧断言用)
#[derive(Default)]
struct BrokerState {
    connects: Vec<ConnectInfo>,
    publishes: Vec<PublishInfo>,
    subscriptions: Vec<String>,
}

/// broker 推送给客户端的消息命令
#[derive(Debug, Clone)]
struct PushCommand {
    topic: String,
    payload: Vec<u8>,
}

/// 假 broker 句柄:测试侧用来检查记录与推送消息
struct FakeBroker {
    state: Arc<Mutex<BrokerState>>,
    push_tx: tokio::sync::broadcast::Sender<PushCommand>,
    subscription_count: tokio::sync::watch::Receiver<usize>,
}

impl FakeBroker {
    /// 启动假 broker(监听 127.0.0.1 随机端口;reject_auth=true 时拒绝所有凭据)
    async fn start(reject_auth: bool) -> (Self, u16) {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind fake MQTT broker");
        let port = listener.local_addr().expect("fake broker address").port();
        let state = Arc::new(Mutex::new(BrokerState::default()));
        let (push_tx, _) = tokio::sync::broadcast::channel(64);
        let (sub_tx, sub_rx) = tokio::sync::watch::channel(0usize);
        tokio::spawn(broker_accept_loop(
            listener,
            Arc::clone(&state),
            push_tx.clone(),
            sub_tx,
            reject_auth,
        ));
        (
            Self {
                state,
                push_tx,
                subscription_count: sub_rx,
            },
            port,
        )
    }

    /// 推送一条 QoS 0 消息给所有在线客户端
    fn push(&self, topic: &str, payload: &[u8]) {
        let _ = self.push_tx.send(PushCommand {
            topic: topic.to_string(),
            payload: payload.to_vec(),
        });
    }

    /// 等待至少 `count` 个订阅完成(自动订阅 `#` 到达 broker)
    async fn wait_subscriptions(&self, count: usize) -> bool {
        let mut rx = self.subscription_count.clone();
        let deadline = Duration::from_secs(5);
        if *rx.borrow_and_update() >= count {
            return true;
        }
        tokio::time::timeout(deadline, async {
            loop {
                if rx.changed().await.is_err() {
                    return;
                }
                if *rx.borrow_and_update() >= count {
                    return;
                }
            }
        })
        .await
        .is_ok()
    }

    fn with_state<T>(&self, visitor: impl FnOnce(&BrokerState) -> T) -> T {
        visitor(&self.state.lock().expect("broker state lock"))
    }
}

async fn broker_accept_loop(
    listener: TcpListener,
    state: Arc<Mutex<BrokerState>>,
    push_tx: tokio::sync::broadcast::Sender<PushCommand>,
    subscription_count: tokio::sync::watch::Sender<usize>,
    reject_auth: bool,
) {
    while let Ok((stream, _)) = listener.accept().await {
        let state = Arc::clone(&state);
        let push_rx = push_tx.subscribe();
        let subscription_count = subscription_count.clone();
        tokio::spawn(broker_connection(
            stream,
            state,
            push_rx,
            subscription_count,
            reject_auth,
        ));
    }
}

/// 单个客户端连接:完成 CONNECT 握手后按需响应订阅/发布/心跳
async fn broker_connection(
    stream: tokio::net::TcpStream,
    state: Arc<Mutex<BrokerState>>,
    mut push_rx: tokio::sync::broadcast::Receiver<PushCommand>,
    subscription_count: tokio::sync::watch::Sender<usize>,
    reject_auth: bool,
) {
    let (mut reader, mut writer) = stream.into_split();

    // 1. CONNECT -> CONNACK
    let Some((first, rest)) = read_packet(&mut reader).await else {
        return;
    };
    if first >> 4 != 1 {
        return; // 不是 CONNECT,直接断开
    }
    let info = parse_connect(&rest).expect("parse CONNECT");
    state.lock().expect("broker state lock").connects.push(info);
    // CONNACK:session_present=0;拒绝模式下返回 BadUserNamePassword(4)
    let return_code = if reject_auth { 0x04 } else { 0x00 };
    if writer
        .write_all(&[0x20, 0x02, 0x00, return_code])
        .await
        .is_err()
    {
        return;
    }
    if reject_auth {
        return; // 拒绝连接后客户端不会继续发包
    }

    // 2. 会话循环:读客户端包 / 推送消息
    loop {
        tokio::select! {
            packet = read_packet(&mut reader) => {
                let Some((first, rest)) = packet else { break };
                match first >> 4 {
                    8 => {
                        // SUBSCRIBE -> SUBACK(全部授予请求的 QoS)
                        let granted = rest.len().saturating_sub(2);
                        if granted == 0 {
                            break;
                        }
                        let pkid = [rest[0], rest[1]];
                        let mut suback = vec![0x90];
                        suback.extend_from_slice(&remaining_length(2 + granted));
                        suback.extend_from_slice(&pkid);
                        let filters = parse_subscribe_filters(&rest).expect("parse SUBSCRIBE");
                        {
                            let mut state = state.lock().expect("broker state lock");
                            state.subscriptions.extend(filters.iter().cloned());
                        }
                        subscription_count.send_modify(|count| *count += filters.len());
                        // 全部授予 QoS 1
                        suback.extend_from_slice(&vec![0x01; granted]);
                        if writer.write_all(&suback).await.is_err() {
                            break;
                        }
                    }
                    3 => {
                        // 客户端 PUBLISH:记录并按需 PUBACK
                        if let Some(publish) = parse_publish(first, &rest) {
                            state
                                .lock()
                                .expect("broker state lock")
                                .publishes
                                .push(PublishInfo {
                                    topic: publish.topic,
                                    payload: publish.payload,
                                    qos: publish.qos,
                                });
                            if publish.qos > 0
                                && let Some(pkid) = publish.pkid
                                && writer
                                    .write_all(&[0x40, 0x02, pkid[0], pkid[1]])
                                    .await
                                    .is_err()
                            {
                                break;
                            }
                        }
                    }
                    12 => {
                        // PINGREQ -> PINGRESP(写失败时后续读取自然失败,无需特殊处理)
                        let _ = writer.write_all(&[0xD0, 0x00]).await;
                    }
                    14 => break, // DISCONNECT
                    _ => {}
                }
            }
            command = push_rx.recv() => {
                if let Ok(command) = command {
                    let packet = encode_publish_qos0(&command.topic, &command.payload);
                    if writer.write_all(&packet).await.is_err() {
                        break;
                    }
                }
            }
        }
    }
}

/// 读取一个 MQTT 包:返回(首字节,剩余长度载荷)
async fn read_packet<S: AsyncReadExt + Unpin>(stream: &mut S) -> Option<(u8, Vec<u8>)> {
    let mut first = [0u8; 1];
    stream.read_exact(&mut first).await.ok()?;
    let mut length = 0usize;
    let mut multiplier = 1usize;
    loop {
        let mut byte = [0u8; 1];
        stream.read_exact(&mut byte).await.ok()?;
        length += usize::from(byte[0] & 0x7F) * multiplier;
        multiplier *= 128;
        if byte[0] & 0x80 == 0 {
            break;
        }
    }
    let mut rest = vec![0u8; length];
    stream.read_exact(&mut rest).await.ok()?;
    Some((first[0], rest))
}

/// 解析 CONNECT 载荷(MQTT 3.1.1)
fn parse_connect(rest: &[u8]) -> Option<ConnectInfo> {
    let mut pos = 0usize;
    let name_len = be_u16(rest, &mut pos)?;
    pos += name_len as usize; // 协议名 "MQTT"
    pos += 1; // 协议级别 4
    let flags = *rest.get(pos)?;
    pos += 1;
    let keep_alive = be_u16(rest, &mut pos)?;
    let client_id = read_mqtt_string(rest, &mut pos)?;
    let username = if flags & 0x80 != 0 {
        Some(read_mqtt_string(rest, &mut pos)?)
    } else {
        None
    };
    let password = if flags & 0x40 != 0 {
        let len = be_u16(rest, &mut pos)? as usize;
        let bytes = rest.get(pos..pos + len)?.to_vec();
        Some(String::from_utf8_lossy(&bytes).to_string())
    } else {
        None
    };
    Some(ConnectInfo {
        client_id,
        username,
        password,
        keep_alive,
    })
}

/// 解析 SUBSCRIBE 载荷中的过滤器列表
fn parse_subscribe_filters(rest: &[u8]) -> Option<Vec<String>> {
    let mut pos = 2usize; // 跳过报文标识符
    let mut filters = Vec::new();
    while pos < rest.len() {
        filters.push(read_mqtt_string(rest, &mut pos)?);
        pos += 1; // 请求的 QoS
    }
    Some(filters)
}

/// 解析后的客户端 PUBLISH:(topic, QoS>0 时的报文标识符, payload, qos)
struct ClientPublish {
    topic: String,
    pkid: Option<[u8; 2]>,
    payload: Vec<u8>,
    qos: u8,
}

/// 解析客户端 PUBLISH 载荷
fn parse_publish(first: u8, rest: &[u8]) -> Option<ClientPublish> {
    let qos = (first >> 1) & 0x03;
    let mut pos = 0usize;
    let topic = read_mqtt_string(rest, &mut pos)?;
    let pkid = if qos > 0 {
        let id = [*rest.get(pos)?, *rest.get(pos + 1)?];
        pos += 2;
        Some(id)
    } else {
        None
    };
    Some(ClientPublish {
        topic,
        pkid,
        payload: rest.get(pos..)?.to_vec(),
        qos,
    })
}

/// 编码 broker -> 客户端的 QoS 0 PUBLISH
fn encode_publish_qos0(topic: &str, payload: &[u8]) -> Vec<u8> {
    let mut packet = vec![0x30];
    let body_len = 2 + topic.len() + payload.len();
    packet.extend_from_slice(&remaining_length(body_len));
    packet.extend_from_slice(&(topic.len() as u16).to_be_bytes());
    packet.extend_from_slice(topic.as_bytes());
    packet.extend_from_slice(payload);
    packet
}

/// 编码剩余长度(varint,最多 4 字节)
fn remaining_length(mut value: usize) -> Vec<u8> {
    let mut out = Vec::new();
    loop {
        let mut byte = (value % 128) as u8;
        value /= 128;
        if value > 0 {
            byte |= 0x80;
        }
        out.push(byte);
        if value == 0 {
            return out;
        }
    }
}

fn be_u16(bytes: &[u8], pos: &mut usize) -> Option<u16> {
    let hi = *bytes.get(*pos)?;
    let lo = *bytes.get(*pos + 1)?;
    *pos += 2;
    Some(u16::from_be_bytes([hi, lo]))
}

fn read_mqtt_string(bytes: &[u8], pos: &mut usize) -> Option<String> {
    let len = be_u16(bytes, pos)? as usize;
    let slice = bytes.get(*pos..*pos + len)?;
    *pos += len;
    Some(String::from_utf8_lossy(slice).to_string())
}

// ---------------------------------------------------------------------------
// 测试宿主(Host API)
// ---------------------------------------------------------------------------

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
        if params.secret_ref.secret_ref != "secret://self/7:password" {
            return Err(HostError::protocol(ProtocolError::new(
                error_codes::SECRET_NOT_FOUND,
                "requested secret was not found",
            )));
        }
        Ok(host::ResolveSecretResult {
            value: b"mqtt-pass".to_vec(),
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

// ---------------------------------------------------------------------------
// 测试脚手架
// ---------------------------------------------------------------------------

struct TestHarness {
    client: UniversalPluginClient,
    session: Arc<ProcessRpcSession>,
    root: tempfile::TempDir,
}

async fn harness(secret_allowed: bool) -> TestHarness {
    let root = tempfile::tempdir().expect("extension temp root");
    let bin_dir = root.path().join("bin");
    fs::create_dir_all(&bin_dir).expect("create bin directory");
    copy_executable(
        Path::new(env!("CARGO_BIN_EXE_mqtt-provider")),
        &bin_dir.join("mqtt-provider"),
    );
    let spawn = SpawnConfig::new(bin_dir.join("mqtt-provider"))
        .with_program_root(root.path())
        .with_ready_timeout(Duration::from_secs(5));
    let negotiation = NegotiationConfig::new("0.15.2", "mqtt-e2e").offer_api("extension", "1.0");
    let config = ProcessRpcSessionConfig::new(spawn, negotiation)
        .with_request_timeout(Duration::from_secs(10))
        .with_shutdown_grace_ms(2_500)
        .with_label("com.navop.middleware.mqtt::main")
        .with_host_api(Arc::new(HostApiHandler::new(Arc::new(TestHostApi {
            secret_allowed,
        }))));
    let session = Arc::new(
        ProcessRpcSession::start(config)
            .await
            .expect("start provider"),
    );
    let client = UniversalPluginClient::new(Arc::clone(&session));
    TestHarness {
        client,
        session,
        root,
    }
}

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

/// 构造 resource/open 参数:标准 §4 表单字段 + secret 引用
fn open_params(port: u16) -> ResourceOpenParams {
    ResourceOpenParams {
        resource_type: "middleware".into(),
        config: json!({
            "host": "127.0.0.1",
            "port": port,
            "username": "mqtt-user",
            "client_id": "",
            "keep_alive_secs": 60,
            "credential_refs": {"password": "secret://self/7:password"},
        }),
        metadata: None,
    }
}

async fn invoke(
    client: &UniversalPluginClient,
    resource_id: &str,
    method: &str,
    params: Value,
) -> Result<Value, extension_protocol::result_ref::ResultRef> {
    let result = client
        .invoke_resource(&ResourceInvokeParams {
            resource_id: resource_id.to_owned(),
            method: method.to_owned(),
            params,
        })
        .await
        .expect("invoke resource rpc");
    match result.result {
        ResultRef::Inline { value } => Ok(value),
        ResultRef::Blob { .. } | ResultRef::EventStream { .. } => Err(result.result),
    }
}

/// 断言 invoke 返回内联 JSON
async fn inline(
    client: &UniversalPluginClient,
    resource_id: &str,
    method: &str,
    params: Value,
) -> Value {
    match invoke(client, resource_id, method, params).await {
        Ok(value) => value,
        Err(result_ref) => panic!("expected inline result, got {result_ref:?}"),
    }
}

/// 轮询直到条件满足(或超时返回最后一次结果)
async fn wait_until(timeout: Duration, interval: Duration, mut cond: impl FnMut() -> bool) -> bool {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if cond() {
            return true;
        }
        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(interval).await;
    }
}

fn assert_resource_closed(error: HostError) {
    assert!(
        matches!(
            error,
            HostError::Protocol(ref protocol) if protocol.code == error_codes::RESOURCE_CLOSED
        ),
        "expected RESOURCE_CLOSED, got {error:?}"
    );
}

// ---------------------------------------------------------------------------
// 测试用例
// ---------------------------------------------------------------------------

/// 标准 §3 全方法往返:能力位、订阅列表、消息流入缓冲、发送、指标、客户端视图
#[tokio::test]
async fn provider_roundtrips_standard_methods_against_fake_broker() {
    let (broker, port) = FakeBroker::start(false).await;
    let harness = harness(true).await;
    let opened = harness
        .client
        .open_resource(&open_params(port))
        .await
        .expect("open resource");

    // 资源 ID 前缀稳定、每次打开唯一
    assert!(opened.resource_id.starts_with("mqtt-resource-"),);
    // open 响应的能力列表 = 标准 §3 方法表
    let expected_methods = [
        "middleware/capabilities",
        "middleware/metrics",
        "middleware/cluster/overview",
        "middleware/topic/list",
        "middleware/topic/detail",
        "middleware/topic/create",
        "middleware/topic/update",
        "middleware/topic/delete",
        "middleware/group/list",
        "middleware/group/detail",
        "middleware/group/clients",
        "middleware/message/query",
        "middleware/message/send",
    ];
    assert_eq!(
        expected_methods.to_vec(),
        opened.capabilities,
        "open capabilities 应与标准 §3 方法表一致"
    );
    let metadata = opened.metadata.expect("open metadata");
    assert_eq!(1, metadata["standard_version"]);
    assert_eq!("rumqttc", metadata["client"]);
    assert_eq!("#", metadata["auto_subscribe"]);

    // 自动订阅 `#` 到达 broker
    assert!(
        broker.wait_subscriptions(1).await,
        "自动订阅 `#` 应在 open 后到达 broker"
    );

    let resource_id = opened.resource_id.clone();

    // capabilities:能力位如实
    let capabilities = inline(
        &harness.client,
        &resource_id,
        "middleware/capabilities",
        json!({}),
    )
    .await;
    assert_eq!(1, capabilities["standard_version"]);
    let caps = &capabilities["capabilities"];
    assert_eq!(true, caps["topics"]);
    assert_eq!(true, caps["topic_write"]);
    assert_eq!(false, caps["groups"]);
    assert_eq!(true, caps["clients"]);
    assert_eq!(true, caps["message_query"]);
    assert_eq!(true, caps["send_message"]);
    assert_eq!(true, caps["metrics"]);
    assert_eq!(false, caps["cluster_overview"]);

    // topic/list = 订阅列表(SUBSCRIPTION,queue_count=QoS)
    let topics = inline(
        &harness.client,
        &resource_id,
        "middleware/topic/list",
        json!({}),
    )
    .await;
    assert_eq!("#", topics["topics"][0]["name"]);
    assert_eq!("SUBSCRIPTION", topics["topics"][0]["topic_type"]);
    assert_eq!(1, topics["topics"][0]["queue_count"]);

    // topic/detail:MQTT 无队列位点,返回空统计
    let detail = inline(
        &harness.client,
        &resource_id,
        "middleware/topic/detail",
        json!({"topic": "#"}),
    )
    .await;
    assert_eq!("#", detail["topic"]);
    assert_eq!(0, detail["stats"].as_array().map(Vec::len).unwrap_or(0));

    // broker 推送消息 -> 环形缓冲 -> message/query
    broker.push("sensors/room-1", b"hello mqtt");
    let query = json!({
        "ByTimeWindow": {
            "topic": "#",
            "begin_unix_ms": 0,
            "end_unix_ms": i64::MAX,
            "page": 1,
            "page_size": 10,
        }
    });
    let mut page = Value::Null;
    for _ in 0..100 {
        page = inline(
            &harness.client,
            &resource_id,
            "middleware/message/query",
            query.clone(),
        )
        .await;
        if page["total"].as_u64().unwrap_or(0) >= 1 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert_eq!(1, page["total"], "推送的消息应进入查询结果: {page}");
    assert_eq!("sensors/room-1", page["messages"][0]["topic"]);
    assert_eq!("hello mqtt", page["messages"][0]["body_text"]);
    assert_eq!(
        vec![104, 101, 108, 108, 111, 32, 109, 113, 116, 116],
        page["messages"][0]["body"]
            .as_array()
            .expect("body 应为字节数组")
            .iter()
            .map(|byte| byte.as_u64().expect("字节值"))
            .collect::<Vec<_>>()
    );

    // ByKey 尽力匹配(payload 文本包含,大小写不敏感)
    let by_key = inline(
        &harness.client,
        &resource_id,
        "middleware/message/query",
        json!({"ByKey": {"topic": "#", "key": "HELLO"}}),
    )
    .await;
    assert_eq!(1, by_key["total"]);

    // ById 命中合成 ID
    let message_id = page["messages"][0]["message_id"].as_str().unwrap();
    let by_id = inline(
        &harness.client,
        &resource_id,
        "middleware/message/query",
        json!({"ById": {"topic": "sensors/room-1", "message_id": message_id}}),
    )
    .await;
    assert_eq!(1, by_id["total"]);

    // message/send = publish(properties 指定 qos=1)
    let send = inline(
        &harness.client,
        &resource_id,
        "middleware/message/send",
        json!({
            "topic": "cmd/lamp",
            "body": [111, 110],
            "properties": [["qos", "1"]],
        }),
    )
    .await;
    assert_eq!("OK", send["status"]);
    assert!(
        send["message_id"]
            .as_str()
            .unwrap()
            .starts_with("mqtt-sent-")
    );
    assert!(
        wait_until(Duration::from_secs(5), Duration::from_millis(25), || {
            broker.with_state(|state| {
                state
                    .publishes
                    .iter()
                    .any(|publish| publish.topic == "cmd/lamp" && publish.payload == b"on")
            })
        })
        .await,
        "发送的消息应到达 broker"
    );

    // metrics:topic_count=订阅数,connection_count=1,今日消息 >= 1
    let metrics = inline(
        &harness.client,
        &resource_id,
        "middleware/metrics",
        json!({}),
    )
    .await;
    let metrics = &metrics["metrics"];
    assert_eq!(1, metrics["topic_count"]);
    assert_eq!(1, metrics["connection_count"]);
    assert!(metrics["message_count_today"].as_u64().unwrap_or(0) >= 1);

    // group/clients:本地连接自身
    let clients = inline(
        &harness.client,
        &resource_id,
        "middleware/group/clients",
        json!({"group": "local"}),
    )
    .await;
    let client = &clients["clients"][0];
    assert!(
        client["client_id"]
            .as_str()
            .expect("client_id")
            .starts_with("navop-mqtt-")
    );
    assert_eq!("RUST", client["language"]);
    assert_eq!(json!(["#"]), client["subscriptions"]);

    // CONNECT 携带 username 与解析后的 secret 密码(reverse Host API 生效),
    // client_id 为 provider 生成的 `navop-mqtt-<随机后缀>`
    broker.with_state(|state| {
        let connect = state.connects.first().expect("应有连接记录");
        assert!(connect.client_id.starts_with("navop-mqtt-"));
        assert_eq!("mqtt-user", connect.username.as_deref().unwrap_or_default());
        assert_eq!("mqtt-pass", connect.password.as_deref().unwrap_or_default());
    });

    // 新增订阅(标准 §3 topic/create = MQTT 订阅):broker 应收到 SUBSCRIBE,
    // 本地订阅列表与新 topic/list 都要反映 `sensors/+`
    inline(
        &harness.client,
        &resource_id,
        "middleware/topic/create",
        json!({"topic": "sensors/+", "queue_count": 2}),
    )
    .await;
    assert!(
        wait_until(Duration::from_secs(5), Duration::from_millis(25), || {
            broker.with_state(|state| state.subscriptions.iter().any(|f| f == "sensors/+"))
        })
        .await,
        "broker 应记录新增的订阅"
    );
    let topics_after = inline(
        &harness.client,
        &resource_id,
        "middleware/topic/list",
        json!({}),
    )
    .await;
    assert!(
        topics_after["topics"]
            .as_array()
            .expect("topics array")
            .iter()
            .any(|topic| topic["name"] == "sensors/+"),
        "topic/list 应包含新订阅: {topics_after}"
    );

    // 取消订阅(标准 §3 topic/delete = 取消订阅):本地订阅列表移出过滤器
    inline(
        &harness.client,
        &resource_id,
        "middleware/topic/delete",
        json!({"topic": "sensors/+"}),
    )
    .await;
    let topics_removed = inline(
        &harness.client,
        &resource_id,
        "middleware/topic/list",
        json!({}),
    )
    .await;
    assert!(
        !topics_removed["topics"]
            .as_array()
            .expect("topics array")
            .iter()
            .any(|topic| topic["name"] == "sensors/+"),
        "topic/list 应移除已取消的订阅: {topics_removed}"
    );

    // ping/close 生命周期
    harness
        .client
        .ping_resource(&ResourcePingParams {
            resource_id: resource_id.clone(),
        })
        .await
        .expect("ping");
    harness
        .client
        .close_resource(&ResourceCloseParams {
            resource_id: resource_id.clone(),
        })
        .await
        .expect("close");
    let closed = harness
        .client
        .ping_resource(&ResourcePingParams { resource_id })
        .await
        .expect_err("closed resource");
    assert_resource_closed(closed);
    harness.session.shutdown().await;
    drop(harness.root);
}

/// 能力位为 false 的方法兜底返回 `不支持的操作:` 协议错误
#[tokio::test]
async fn unsupported_capabilities_return_standard_errors() {
    let (_broker, port) = FakeBroker::start(false).await;
    let harness = harness(true).await;
    let opened = harness
        .client
        .open_resource(&open_params(port))
        .await
        .expect("open resource");
    let resource_id = opened.resource_id.clone();

    for (method, params) in [
        ("middleware/cluster/overview", json!({})),
        ("middleware/group/list", json!({})),
        ("middleware/group/detail", json!({"group": "g1"})),
    ] {
        let error = harness
            .client
            .invoke_resource(&ResourceInvokeParams {
                resource_id: resource_id.clone(),
                method: method.to_owned(),
                params,
            })
            .await
            .expect_err("不支持的操作应返回协议错误");
        let HostError::Protocol(protocol) = error else {
            panic!("应返回协议错误: {method}");
        };
        assert_eq!(
            error_codes::METHOD_NOT_FOUND,
            protocol.code,
            "方法 {method} 的错误码"
        );
        assert!(
            protocol.message.starts_with("不支持的操作:"),
            "方法 {method} 的错误文本应带标准前缀: {}",
            protocol.message
        );
    }

    // 未知方法同样返回 METHOD_NOT_FOUND
    let error = harness
        .client
        .invoke_resource(&ResourceInvokeParams {
            resource_id: resource_id.clone(),
            method: "middleware/bogus".into(),
            params: json!({}),
        })
        .await
        .expect_err("未知方法应返回协议错误");
    let HostError::Protocol(protocol) = error else {
        panic!("应返回协议错误");
    };
    assert_eq!(error_codes::METHOD_NOT_FOUND, protocol.code);

    harness
        .client
        .close_resource(&ResourceCloseParams { resource_id })
        .await
        .expect("close");
    harness.session.shutdown().await;
}

/// open 即连接测试:broker 拒绝凭据时立即失败(认证错误)
#[tokio::test]
async fn open_fails_when_broker_rejects_credentials() {
    let (broker, port) = FakeBroker::start(true).await;
    let harness = harness(true).await;
    let error = harness
        .client
        .open_resource(&open_params(port))
        .await
        .expect_err("broker 拒绝凭据时 open 应失败");
    let HostError::Protocol(protocol) = error else {
        panic!("应返回协议错误: {error:?}");
    };
    assert_eq!(error_codes::AUTH_FAILED, protocol.code);
    assert!(
        protocol.message.starts_with("认证错误:"),
        "错误文本应带认证前缀: {}",
        protocol.message
    );
    // broker 侧记录到了这次被拒的 CONNECT
    assert_eq!(1, broker.with_state(|state| state.connects.len()));
    harness.session.shutdown().await;
}

/// secret 权限在 provider 建连之前被宿主拒绝(broker 不应看到任何 CONNECT)
#[tokio::test]
async fn secret_permission_is_enforced_before_broker_connect() {
    let (broker, port) = FakeBroker::start(false).await;
    let harness = harness(false).await;
    let error = harness
        .client
        .open_resource(&open_params(port))
        .await
        .expect_err("secret 被拒时 open 应失败");
    let HostError::Protocol(protocol) = error else {
        panic!("应返回协议错误: {error:?}");
    };
    assert_eq!(error_codes::PERMISSION_DENIED, protocol.code);
    assert!(
        broker.with_state(|state| state.connects.is_empty()),
        "secret 解析失败不应触发 MQTT 连接"
    );
    harness.session.shutdown().await;
}

/// 多资源隔离:关闭一个资源不影响其他资源
#[tokio::test]
async fn multiple_resources_remain_isolated_when_one_closes() {
    let (broker, port) = FakeBroker::start(false).await;
    let harness = harness(true).await;
    let first = harness
        .client
        .open_resource(&open_params(port))
        .await
        .expect("open first");
    let second = harness
        .client
        .open_resource(&open_params(port))
        .await
        .expect("open second");
    assert_ne!(first.resource_id, second.resource_id);

    // 两个连接各自完成自动订阅
    assert!(broker.wait_subscriptions(2).await, "两个连接都应订阅 `#`");

    harness
        .client
        .close_resource(&ResourceCloseParams {
            resource_id: first.resource_id.clone(),
        })
        .await
        .expect("close first");

    let ping = harness
        .client
        .ping_resource(&ResourcePingParams {
            resource_id: first.resource_id.clone(),
        })
        .await
        .expect_err("first closed");
    assert_resource_closed(ping);
    let invoke_error = harness
        .client
        .invoke_resource(&ResourceInvokeParams {
            resource_id: first.resource_id,
            method: "middleware/topic/list".into(),
            params: json!({}),
        })
        .await
        .expect_err("first closed cannot invoke");
    assert_resource_closed(invoke_error);

    // second 仍可正常工作
    let topics = inline(
        &harness.client,
        &second.resource_id,
        "middleware/topic/list",
        json!({}),
    )
    .await;
    assert_eq!("#", topics["topics"][0]["name"]);

    harness
        .client
        .close_resource(&ResourceCloseParams {
            resource_id: second.resource_id,
        })
        .await
        .expect("close second");
    harness.session.shutdown().await;
}
