//! 中间件标准契约:统一再导出本 crate 的 `middleware_contract` 模块。
//!
//! 契约唯一事实源为本扩展 `src/middleware_contract.rs`
//! (标准文档 docs/middleware-standard.md §3;mqtt 与 rocketmq 双副本,改动必须两边同步),
//! 本模块仅作统一再导出,供 crate 内各处以 `crate::contract::*` 引用。
//!
//! 历史:曾共用 middleware-base 的 `middleware-contract` crate,拆分后改为本地副本,
//! 再导出路径随之从 crate 改为本模块。

pub use crate::middleware_contract::*;
