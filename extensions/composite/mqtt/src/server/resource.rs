//! resource 生命周期处理:open(建连)/ping/invoke(§3 分发)/close(断连)。

use extension_protocol::{
    error::ProtocolError,
    resource::{
        ResourceCloseParams, ResourceInvokeParams, ResourceInvokeResult, ResourceOpenResult,
        ResourcePingParams,
    },
    result_ref::ResultRef,
};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::{
    config::{PendingPassword, parse_open_params},
    contract::methods,
    error::{ProviderResult, invalid_params, parse_params, resource_error, serialize},
    host_state::{self, StoredProfile},
    ipc::{IpcParts, resolve_secret},
    resource::{MqttResource, ProfileState},
    state::ProviderState,
};

pub(super) async fn open<R, W>(
    ipc: &mut IpcParts<R, W>,
    state: &mut ProviderState,
    params: Value,
) -> ProviderResult
where
    R: AsyncReadExt + Unpin,
    W: AsyncWriteExt + Unpin,
{
    let mut plan = parse_open_params(params)?;
    plan.config.password = resolve_password(ipc, state, &plan.password).await?;

    // 从宿主 KV 恢复上次的订阅画像:host/port/tls/username 相同的连接共用一份。
    // 键刻意不含 provider 随机生成的 client_id(否则每次 open 都换键,永远命中不了)。
    let profile_key = host_state::profile_key(
        &plan.config.host,
        plan.config.port,
        plan.config.use_tls,
        plan.config.username.as_deref(),
        plan.config.client_id.trim(),
    );
    let profile =
        match host_state::load_profile(ipc, &profile_key, state.reverse_request_id()).await {
            Ok(profile) => profile.unwrap_or_else(StoredProfile::new),
            Err(error) => {
                // KV 不可用不是致命错误:退化成"无持久化",连接照常建立
                eprintln!("mqtt: host storage unavailable for reading profile: {error}");
                StoredProfile::new()
            }
        };
    // 用户没填 client_id 时沿用上次 provider 生成的那个:broker 侧会话(clean_session=false)
    // 与遗嘱消息才能续上,否则每次重开都是一个全新的客户端身份。
    if plan.config.client_id.trim().is_empty()
        && let Some(client_id) = profile
            .client_id
            .as_deref()
            .map(str::trim)
            .filter(|client_id| !client_id.is_empty())
    {
        plan.config.client_id = client_id.to_string();
    }
    let restored = profile.restored_subscriptions().len();

    // open 即连接测试(标准约定):连不上即失败
    let resource = MqttResource::connect(
        plan.config,
        profile.restored_subscriptions(),
        ProfileState::new(profile_key, restored),
    )
    .await?;
    // 立刻回写一次画像:既保存(可能是新生成的)client_id,也用"写后读回"实测
    // 宿主 KV 到底能不能落盘,结论会出现在 metadata 的 `persistence` 字段里。
    resource
        .persist_subscriptions(ipc, state.reverse_request_id())
        .await;
    let metadata = resource.metadata().await;
    let resource_id = state.insert_resource(resource);
    serialize(ResourceOpenResult {
        resource_id,
        // open 能力声明 = 契约 crate 的标准 §3 方法表(与 rocketmq-provider 一致)
        capabilities: methods::ALL
            .iter()
            .map(|method| method.to_string())
            .collect(),
        metadata: Some(metadata),
    })
}

/// 解析密码:secret 引用经宿主 reverse Host API;明文直用;缺省为空
async fn resolve_password<R, W>(
    ipc: &mut IpcParts<R, W>,
    state: &ProviderState,
    password: &PendingPassword,
) -> Result<Option<String>, Box<ProtocolError>>
where
    R: AsyncReadExt + Unpin,
    W: AsyncWriteExt + Unpin,
{
    match password {
        PendingPassword::None => Ok(None),
        PendingPassword::Direct(secret) => Ok(Some(secret.clone())),
        PendingPassword::Reference(reference) => {
            let secret = resolve_secret(ipc, reference, state.reverse_request_id()).await?;
            let secret = String::from_utf8(secret)
                .map_err(|_| invalid_params("配置错误: MQTT 密码不是有效的 UTF-8 文本"))?;
            Ok(Some(secret))
        }
    }
}

pub(super) fn ping(state: &ProviderState, params: Value) -> ProviderResult {
    let params: ResourcePingParams = parse_params(params)?;
    if state.resource(&params.resource_id).is_none() {
        return Err(resource_error());
    }
    Ok(Value::Null)
}

pub(super) async fn invoke<R, W>(
    ipc: &mut IpcParts<R, W>,
    state: &mut ProviderState,
    params: Value,
) -> ProviderResult
where
    R: AsyncReadExt + Unpin,
    W: AsyncWriteExt + Unpin,
{
    let params: ResourceInvokeParams = parse_params(params)?;
    if state.resource(&params.resource_id).is_none() {
        return Err(resource_error());
    }
    // `middleware/message/stream` 不返回 JSON,而返回事件流引用:
    // 原生工作台的 `events` 模板页按此订阅实时消息(标准 §5.2)。
    if params.method == methods::MESSAGE_STREAM {
        let stream_id = state
            .open_message_event_stream(crate::state::MQTT_MESSAGE_EVENT_KIND)
            .await?;
        return serialize(ResourceInvokeResult {
            result: ResultRef::EventStream { id: stream_id },
        });
    }
    // 订阅增删成功后立刻把订阅表写回宿主 KV:provider 进程下次重启时才能恢复。
    // 失败一律不致命(持久化是尽力而为),所以这里刻意不把结果冒泡成错误。
    let touches_subscriptions = matches!(
        params.method.as_str(),
        methods::TOPIC_CREATE | methods::TOPIC_UPDATE | methods::TOPIC_DELETE
    );
    let value = {
        let resource = state
            .resource(&params.resource_id)
            .ok_or_else(resource_error)?;
        let result = resource.invoke(&params.method, params.params).await?;
        if touches_subscriptions {
            resource
                .persist_subscriptions(ipc, state.reverse_request_id())
                .await;
        }
        result
    };
    let table = state.blob_table_mut();
    serialize(table.invoke_result(&params.resource_id, value)?)
}

pub(super) async fn close(state: &mut ProviderState, params: Value) -> ProviderResult {
    let params: ResourceCloseParams = parse_params(params)?;
    if !state.close_resource(&params.resource_id).await {
        return Err(resource_error());
    }
    Ok(Value::Null)
}
