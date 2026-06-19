#![allow(clippy::result_large_err)]

use anyhow::{Context, Result};
use extension_protocol::error::{ErrorCode, ErrorData, ProtocolError, error_codes};
use interprocess::local_socket::{
    GenericNamespaced, ToNsName,
    tokio::{Stream, prelude::*},
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::driver::OpenGaussDriver;

pub async fn run(socket_name: &str) -> Result<()> {
    let name = socket_name
        .to_ns_name::<GenericNamespaced>()
        .context("invalid local socket name")?;
    let stream = Stream::connect(name)
        .await
        .context("failed to connect to host listener")?;
    let (reader, writer) = tokio::io::split(stream);
    extension_driver::serve(OpenGaussDriver::new(), reader, writer).await
}

pub async fn handle_stream<R, W>(reader: R, writer: W) -> Result<()>
where
    R: AsyncReadExt + Unpin + Send,
    W: AsyncWriteExt + Unpin + Send + 'static,
{
    extension_driver::serve(OpenGaussDriver::new(), reader, writer).await
}

pub(crate) fn invalid_params(message: impl Into<String>) -> ProtocolError {
    ProtocolError::new(error_codes::INVALID_PARAMS, message)
}

pub(crate) fn params_deserialize_error(error: serde_json::Error) -> ProtocolError {
    ProtocolError::new(
        error_codes::INVALID_PARAMS,
        format!("failed to deserialize params: {error}"),
    )
}

pub(crate) fn protocol_error_from_anyhow(code: ErrorCode, error: anyhow::Error) -> ProtocolError {
    let mut pe = ProtocolError::new(code, format!("{error:#}"));
    pe = pe.with_data(ErrorData::new().with_extra(serde_json::json!({
        "chain": error
            .chain()
            .map(|e| e.to_string())
            .collect::<Vec<_>>(),
    })));
    pe
}

pub(crate) fn not_supported(message: impl Into<String>) -> ProtocolError {
    ProtocolError::new(error_codes::METHOD_NOT_FOUND, message)
}
