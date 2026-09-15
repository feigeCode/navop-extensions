//! blob 读取/关闭入口与实时消息事件流入口。

use extension_protocol::blob::{BlobCloseParams, BlobReadParams};
use extension_protocol::event_stream::{EventCloseParams, EventOpenParams, EventReadParams};
use serde_json::Value;

use crate::{
    error::{ProviderResult, parse_params, serialize},
    state::ProviderState,
};

pub(super) fn read_blob(state: &mut ProviderState, params: Value) -> ProviderResult {
    let params: BlobReadParams = parse_params(params)?;
    serialize(state.blob_table_mut().read(params)?)
}

pub(super) fn close_blob(state: &mut ProviderState, params: Value) -> ProviderResult {
    let params: BlobCloseParams = parse_params(params)?;
    state.blob_table_mut().close(params);
    Ok(Value::Null)
}

/// `event/open`:打开实时消息事件流(标准 §5.2)。
pub(super) async fn open_event(state: &mut ProviderState, params: Value) -> ProviderResult {
    let params: EventOpenParams = parse_params(params)?;
    state.open_event_stream(params).await
}

/// `event/read`:读取一批事件;必要时做有上限的阻塞等待(长轮询)。
pub(super) async fn read_event(state: &mut ProviderState, params: Value) -> ProviderResult {
    let params: EventReadParams = parse_params(params)?;
    state.read_event_stream(params).await
}

/// `event/close`:关闭事件流(幂等)。
pub(super) fn close_event(state: &mut ProviderState, params: Value) -> ProviderResult {
    let params: EventCloseParams = parse_params(params)?;
    Ok(state.close_event_stream(&params.stream_id))
}
