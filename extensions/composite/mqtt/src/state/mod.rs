//! provider 全局状态:资源表、blob 表、事件流表与反向请求计数。

mod blob;
mod event;

use std::{collections::HashMap, sync::atomic::AtomicI64};

use crate::resource::MqttResource;

/// 实时消息事件流 kind(spawn 处声明,资源 metadata 与 `open_event_stream` 共用同一常量)
pub(crate) use event::MQTT_MESSAGE_EVENT_KIND;

/// [`ProviderState::sole_resource`] 的失败原因。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SoleResourceError {
    /// 没有任何已打开的连接
    None,
    /// 有多个已打开的连接(无法唯一定位)
    Ambiguous(usize),
}

pub(crate) struct ProviderState {
    resources: HashMap<String, MqttResource>,
    blobs: blob::ProviderBlobTable,
    events: event::ProviderEventStreamTable,
    next_reverse_request_id: AtomicI64,
}

impl ProviderState {
    pub(crate) fn new() -> Self {
        Self {
            resources: HashMap::new(),
            blobs: blob::ProviderBlobTable::new(),
            events: event::ProviderEventStreamTable::default(),
            next_reverse_request_id: AtomicI64::new(1),
        }
    }

    pub(crate) fn resource(&self, resource_id: &str) -> Option<&MqttResource> {
        self.resources.get(resource_id)
    }

    /// 取唯一资源。
    ///
    /// 事件协议(`EventOpenParams`)不携带资源标识(宿主固定传 `conn_id: None`,
    /// 见 `navop/crates/universal-plugins/src/shell_plugin_host/event.rs`),
    /// 而 MQTT 的实时消息源就是某个具体连接,因此只有在**恰好一个**连接打开时
    /// 才能唯一定位;否则由调用方转成可操作错误(不猜、不随机取一个)。
    pub(crate) fn sole_resource(&self) -> Result<&MqttResource, SoleResourceError> {
        let mut iter = self.resources.values();
        let Some(first) = iter.next() else {
            return Err(SoleResourceError::None);
        };
        if iter.next().is_some() {
            return Err(SoleResourceError::Ambiguous(self.resources.len()));
        }
        Ok(first)
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
        // 断开 MQTT 连接(终止 poll 任务),再释放该资源名下的 blob 与事件流
        // (事件流持有的广播接收端在连接 drop 后即进入 Closed,这里同时回收表项)
        resource.disconnect().await;
        self.blobs.close_for_resource(resource_id);
        self.events.clear();
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
        self.events.clear();
    }
}
