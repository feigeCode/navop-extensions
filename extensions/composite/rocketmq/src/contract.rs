//! 中间件标准契约:正式引用 `middleware-contract` crate。
//!
//! 契约唯一事实源为 `extensions/composite/middleware-base`
//! (标准文档 docs/middleware-standard.md §3 + `middleware-contract` 类型定义),
//! 本模块仅作统一再导出,供 crate 内各处以 `crate::contract::*` 引用。
//!
//! 历史:该 crate 就绪前本文件曾按标准 §3 的 JSON 形状临时定义契约类型,
//! 就绪后已整体切换为下面的再导出。

pub use middleware_contract::*;
