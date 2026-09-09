//! resource 生命周期处理:open(建连)/ping/invoke(§3 分发)/close(断连)。

use extension_protocol::{
    error::ProtocolError,
    resource::{ResourceCloseParams, ResourceInvokeParams, ResourceOpenResult, ResourcePingParams},
};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::{
    config::{PendingPassword, parse_open_params},
    contract::methods,
    error::{ProviderResult, invalid_params, parse_params, resource_error, serialize},
    ipc::{IpcParts, resolve_secret},
    resource::MqttResource,
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
    // open 即连接测试(标准约定):连不上即失败
    let resource = MqttResource::connect(plan.config).await?;
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

pub(super) async fn invoke(state: &mut ProviderState, params: Value) -> ProviderResult {
    let params: ResourceInvokeParams = parse_params(params)?;
    let resource = state
        .resource(&params.resource_id)
        .ok_or_else(resource_error)?;
    let value = resource.invoke(&params.method, params.params).await?;
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
