//! RocketMQ Remoting 私有协议层:帧编解码、指令结构与请求/响应码。
//!
//! 协议契约基准:apache/rocketmq `remoting` 模块 `RemotingCommand.java` /
//! `RequestCode.java` / `ResponseCode.java`(以官方源码为准,兼容 4.x/5.x)。
//!
//! 移植说明:本模块为库 crate 表面的完整移植,部分官方常量/辅助方法
//! 供测试与后续能力使用,允许暂时未被 provider 主链路引用。

#![allow(dead_code)]

pub mod codes;
pub mod command;
pub mod dto;

pub use codes::{RequestCode, ResponseCode};
pub use command::{RemotingCommand, decode_frame, ensure_success, frame_body_length};
