//! provider 全局状态:资源表、blob 表与反向请求计数。

mod blob;

use std::{collections::HashMap, sync::atomic::AtomicI64};

use crate::resource::MqttResource;

pub(crate) struct ProviderState {
    resources: HashMap<String, MqttResource>,
    blobs: blob::ProviderBlobTable,
    next_reverse_request_id: AtomicI64,
}

impl ProviderState {
    pub(crate) fn new() -> Self {
        Self {
            resources: HashMap::new(),
            blobs: blob::ProviderBlobTable::new(),
            next_reverse_request_id: AtomicI64::new(1),
        }
    }

    pub(crate) fn resource(&self, resource_id: &str) -> Option<&MqttResource> {
        self.resources.get(resource_id)
    }

    /// 插入资源并返回新资源 ID(`mqtt-resource-<uuid>`,前缀稳定、每次打开唯一)
    pub(crate) fn insert_resource(&mut self, resource: MqttResource) -> String {
        let resource_id = loop {
            let candidate = format!("mqtt-resource-{}", uuid::Uuid::new_v4());
            if !self.resources.contains_key(&candidate) {
                break candidate;
            }
        };
        self.resources.insert(resource_id.clone(), resource);
        resource_id
    }

    pub(crate) async fn close_resource(&mut self, resource_id: &str) -> bool {
        let Some(resource) = self.resources.remove(resource_id) else {
            return false;
        };
        // 断开 MQTT 连接(终止 poll 任务),再释放该资源名下的 blob
        resource.disconnect().await;
        self.blobs.close_for_resource(resource_id);
        true
    }

    pub(crate) fn reverse_request_id(&self) -> &AtomicI64 {
        &self.next_reverse_request_id
    }

    pub(crate) fn blob_table_mut(&mut self) -> &mut blob::ProviderBlobTable {
        &mut self.blobs
    }

    pub(crate) fn clear(&mut self) {
        self.resources.clear();
        self.blobs.clear();
    }
}
