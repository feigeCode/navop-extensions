//! blob 读取/关闭入口。

use extension_protocol::blob::{BlobCloseParams, BlobReadParams};
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
