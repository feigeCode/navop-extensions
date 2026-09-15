//! 生命周期:init 能力声明与 shutdown 清理。

use extension_protocol::{lifecycle::InitResult, method};
use serde_json::Value;

use crate::{
    error::{ProviderResult, serialize},
    state::ProviderState,
};

const PROVIDER_VERSION: &str = env!("CARGO_PKG_VERSION");

/// init 响应:声明本 provider 实际实现的 wire method。
///
/// 宿主以 `methods` 为权威门控调用(未声明的调用直接报
/// `NotImplemented("extension did not declare wire method ...")`),
/// 因此**新增协议方法必须同时在这里声明**,否则分发代码永远走不到。
pub(super) fn init() -> ProviderResult {
    serialize(
        InitResult::new(PROVIDER_VERSION)
            .with_api("extension", "1.0")
            .with_method(method::RESOURCE_OPEN)
            .with_method(method::RESOURCE_PING)
            .with_method(method::RESOURCE_INVOKE)
            .with_method(method::RESOURCE_CLOSE)
            .with_method(method::BLOB_READ)
            .with_method(method::BLOB_CLOSE)
            // 实时消息事件流(标准 §5.2):UI 经 navop.event 调用
            .with_method(method::EVENT_OPEN)
            .with_method(method::EVENT_READ)
            .with_method(method::EVENT_CLOSE),
    )
}

pub(super) fn shutdown(state: &mut ProviderState) -> ProviderResult {
    state.clear();
    Ok(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 声明的方法集必须覆盖分发里真正实现的方法(漏声明 = 宿主侧直接 NotImplemented)
    #[test]
    fn init_declares_event_stream_methods() {
        let result = init().expect("init 序列化");
        let methods = result["methods"].as_array().expect("methods 数组");
        let declared = methods.iter().filter_map(Value::as_str).collect::<Vec<_>>();
        for expected in ["event/open", "event/read", "event/close"] {
            assert!(
                declared.contains(&expected),
                "未声明 {expected}: {declared:?}"
            );
        }
        // job 仍未实现,不应声明
        assert!(!declared.iter().any(|each| each.starts_with("job/")));
    }
}
