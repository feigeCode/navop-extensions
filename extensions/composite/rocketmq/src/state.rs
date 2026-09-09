//! provider 状态:资源表(单资源固定 id)与大结果 blob 缓存。

use std::collections::HashMap;
use std::sync::atomic::AtomicI64;

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use extension_protocol::{
    blob::{BlobCloseParams, BlobReadParams, BlobReadResult, should_stream_blob},
    error::{ProtocolError, error_codes},
    resource::ResourceInvokeResult,
    result_ref::ResultRef,
};
use serde_json::Value;
use uuid::Uuid;

use crate::admin::RocketmqConnection;
use crate::error::{boxed_error, invalid_params};

/// 资源类型(中间件标准 §1:全局统一)
pub(crate) const RESOURCE_TYPE: &str = "middleware";

/// 固定资源 id(标准 §5.1:控制台经 connection.resource.handle 使用)
pub(crate) const RESOURCE_ID: &str = "rocketmq-resource";

/// 单 provider 进程内 blob 总预算
const MAX_TOTAL_BLOB_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug)]
struct ProviderBlob {
    resource_id: String,
    data: Vec<u8>,
    offset: usize,
}

/// provider 状态:资源与 blob 生命周期归属此表
pub(crate) struct ProviderState {
    resource: Option<RocketmqConnection>,
    blobs: HashMap<String, ProviderBlob>,
    next_reverse_request_id: AtomicI64,
}

impl ProviderState {
    pub(crate) fn new() -> Self {
        Self {
            resource: None,
            blobs: HashMap::new(),
            next_reverse_request_id: AtomicI64::new(1),
        }
    }

    pub(crate) fn resource(&self) -> Option<&RocketmqConnection> {
        self.resource.as_ref()
    }

    /// 插入(替换)唯一资源,返回固定资源 id
    pub(crate) async fn insert_resource(&mut self, resource: RocketmqConnection) -> String {
        if let Some(previous) = self.resource.replace(resource) {
            // 旧资源被覆盖:关闭其底层通道
            previous.close().await;
        }
        RESOURCE_ID.to_string()
    }

    pub(crate) async fn close_resource(&mut self, resource_id: &str) -> bool {
        if resource_id != RESOURCE_ID || self.resource.is_none() {
            return false;
        }
        if let Some(resource) = self.resource.take() {
            resource.close().await;
        }
        self.close_blobs_for_resource(resource_id);
        true
    }

    pub(crate) fn reverse_request_id(&self) -> &AtomicI64 {
        &self.next_reverse_request_id
    }

    pub(crate) async fn clear(&mut self) {
        if let Some(resource) = self.resource.take() {
            resource.close().await;
        }
        self.blobs.clear();
    }

    fn total_blob_bytes(&self) -> usize {
        self.blobs.values().map(|blob| blob.data.len()).sum()
    }

    fn store_blob(&mut self, resource_id: &str, data: Vec<u8>) -> Option<String> {
        if data.len() > MAX_TOTAL_BLOB_BYTES
            || self.total_blob_bytes().saturating_add(data.len()) > MAX_TOTAL_BLOB_BYTES
        {
            return None;
        }
        let blob_id = format!("rocketmq-blob-{}", Uuid::new_v4());
        self.blobs.insert(
            blob_id.clone(),
            ProviderBlob {
                resource_id: resource_id.to_owned(),
                data,
                offset: 0,
            },
        );
        Some(blob_id)
    }

    /// invoke 结果:小结果 inline,超过阈值走 blob(标准 §3:inline 或 blob)
    pub(crate) fn blob_result(
        &mut self,
        resource_id: &str,
        value: Value,
    ) -> Result<ResourceInvokeResult, Box<ProtocolError>> {
        let data = serde_json::to_vec(&value)
            .map_err(|error| invalid_params(format!("结果编码失败: {error}")))?;
        if !should_stream_blob(data.len() as u64) {
            return Ok(ResourceInvokeResult {
                result: ResultRef::Inline { value },
            });
        }
        let Some(blob_id) = self.store_blob(resource_id, data) else {
            return Err(boxed_error(
                error_codes::DATA_VALUE_OUT_OF_RANGE,
                "RocketMQ 结果超出 provider blob 预算",
            ));
        };
        Ok(ResourceInvokeResult {
            result: ResultRef::Blob { id: blob_id },
        })
    }

    pub(crate) fn read_blob(
        &mut self,
        params: BlobReadParams,
    ) -> Result<BlobReadResult, Box<ProtocolError>> {
        let max_bytes = params.effective_max_bytes() as usize;
        let blob = self.blobs.get_mut(&params.blob_id).ok_or_else(|| {
            boxed_error(error_codes::RESOURCE_CLOSED, "blob is closed or unknown")
        })?;
        let start = blob.offset.min(blob.data.len());
        let end = start.saturating_add(max_bytes).min(blob.data.len());
        let bytes_read = end.saturating_sub(start) as u32;
        let done = end == blob.data.len() && bytes_read > 0;
        blob.offset = end;
        Ok(BlobReadResult {
            data: BASE64.encode(&blob.data[start..end]),
            bytes_read,
            done,
        })
    }

    pub(crate) fn close_blob(&mut self, params: BlobCloseParams) {
        self.blobs.remove(&params.blob_id);
    }

    fn close_blobs_for_resource(&mut self, resource_id: &str) {
        self.blobs.retain(|_, blob| blob.resource_id != resource_id);
    }
}
