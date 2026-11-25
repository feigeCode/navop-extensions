use std::{future::Future, pin::Pin};

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite};
use tracing::{info, trace};

use super::{
    auth::{AuthHelper, AuthResult, SecurityType, read_failure_reason},
    connection::VncClient,
    security::{
        SecurityPolicy, VncCredentials,
        ra2::{MaybeEncryptedStream, handshake_ra2},
        select_security,
    },
};
use crate::{PixelFormat, VncEncoding, VncError, VncVersion};

pub type DefaultAuthFuture = std::future::Ready<Result<String, VncError>>;

pub enum VncState<S, F = DefaultAuthFuture>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + Sync + 'static,
    F: Future<Output = Result<String, VncError>> + Send + Sync + 'static,
{
    Handshake(VncConnector<S, F>),
    Authenticate(VncConnector<S, F>),
    Connected(VncClient),
}

impl<S, F> VncState<S, F>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + Sync + 'static,
    F: Future<Output = Result<String, VncError>> + Send + Sync + 'static,
{
    pub fn try_start(
        self,
    ) -> Pin<Box<dyn Future<Output = Result<Self, VncError>> + Send + Sync + 'static>> {
        Box::pin(async move {
            match self {
                Self::Handshake(mut connector) => {
                    negotiate_version(&mut connector).await?;
                    Self::Authenticate(connector).try_start().await
                }
                Self::Authenticate(mut connector) => {
                    authenticate(&mut connector).await?;
                    info!("auth done, client connected");
                    Ok(Self::Connected(create_client(connector).await?))
                }
                Self::Connected(_) => Err(VncError::ConnectError),
            }
        })
    }

    pub fn finish(self) -> Result<VncClient, VncError> {
        match self {
            Self::Connected(client) => Ok(client),
            _ => Err(VncError::ConnectError),
        }
    }
}

async fn negotiate_version<S, F>(connector: &mut VncConnector<S, F>) -> Result<(), VncError>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + Sync + 'static,
    F: Future<Output = Result<String, VncError>> + Send + Sync + 'static,
{
    let stream = connector.stream_mut()?;
    let server_version = VncVersion::read(stream).await?;
    trace!(
        "Our version {:?}, server version {:?}",
        connector.rfb_version, server_version
    );
    connector.rfb_version = if connector.rfb_version < server_version {
        connector.rfb_version
    } else {
        server_version
    };
    trace!("Negotiated rfb version: {:?}", connector.rfb_version);
    let version = connector.rfb_version;
    version.write(connector.stream_mut()?).await
}

async fn authenticate<S, F>(connector: &mut VncConnector<S, F>) -> Result<(), VncError>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + Sync + 'static,
    F: Future<Output = Result<String, VncError>> + Send + Sync + 'static,
{
    let version = connector.rfb_version;
    let advertised = SecurityType::read(connector.stream_mut()?, &version).await?;
    let selected = select_security(
        &advertised,
        connector.security_policy,
        &connector.credentials,
        connector.auth_method.is_some(),
    )?;
    trace!(
        "Selected VNC security type {} with policy {}",
        selected.describe(),
        connector.security_policy
    );
    match selected {
        SecurityType::None => authenticate_none(connector).await,
        SecurityType::VncAuth => authenticate_vnc(connector).await,
        SecurityType::RA2 => authenticate_ra2(connector).await,
        _ => unreachable!("selection only returns implemented security backends"),
    }
}

async fn authenticate_ra2<S, F>(connector: &mut VncConnector<S, F>) -> Result<(), VncError>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + Sync + 'static,
    F: Future<Output = Result<String, VncError>> + Send + Sync + 'static,
{
    if connector.rfb_version != VncVersion::RFB33 {
        SecurityType::RA2.write(connector.stream_mut()?).await?;
    }
    let password = connector.resolve_password().await?;
    let username = connector.credentials.username.clone();
    let plain_stream = connector.stream.take().ok_or(VncError::ConnectError)?;
    let MaybeEncryptedStream::Plain(inner) = plain_stream else {
        return Err(VncError::ConnectError);
    };
    let mut ra2_stream = handshake_ra2(inner, username.as_deref(), &password).await?;
    check_auth_result(&mut ra2_stream, connector.rfb_version).await?;
    connector.stream = Some(MaybeEncryptedStream::Ra2(ra2_stream));
    Ok(())
}

async fn authenticate_none<S, F>(connector: &mut VncConnector<S, F>) -> Result<(), VncError>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + Sync + 'static,
    F: Future<Output = Result<String, VncError>> + Send + Sync + 'static,
{
    if connector.rfb_version == VncVersion::RFB33 {
        info!("No auth needed in vnc3.3");
        return Ok(());
    }
    let version = connector.rfb_version;
    SecurityType::None.write(connector.stream_mut()?).await?;
    if version == VncVersion::RFB38 {
        check_auth_result(connector.stream_mut()?, version).await?;
    }
    Ok(())
}

async fn authenticate_vnc<S, F>(connector: &mut VncConnector<S, F>) -> Result<(), VncError>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + Sync + 'static,
    F: Future<Output = Result<String, VncError>> + Send + Sync + 'static,
{
    let version = connector.rfb_version;
    if version != VncVersion::RFB33 {
        SecurityType::VncAuth.write(connector.stream_mut()?).await?;
    }
    let password = connector.resolve_password().await?;
    let auth = AuthHelper::read(connector.stream_mut()?, &password).await?;
    auth.write(connector.stream_mut()?).await?;
    let result = auth.finish(connector.stream_mut()?).await?;
    handle_auth_result(result, connector.stream_mut()?, version).await
}

async fn check_auth_result<S>(stream: &mut S, version: VncVersion) -> Result<(), VncError>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let raw_result = stream.read_u32().await?;
    let result = AuthResult::decode(raw_result)?;
    handle_auth_result(result, stream, version).await
}

async fn handle_auth_result<S>(
    result: AuthResult,
    stream: &mut S,
    version: VncVersion,
) -> Result<(), VncError>
where
    S: AsyncRead + Unpin,
{
    match result {
        AuthResult::Ok => Ok(()),
        AuthResult::Failed => Err(authentication_failure(stream, version).await?),
    }
}

async fn authentication_failure<S>(
    stream: &mut S,
    version: VncVersion,
) -> Result<VncError, VncError>
where
    S: AsyncRead + Unpin,
{
    if version != VncVersion::RFB38 {
        return Ok(VncError::WrongPassword);
    }
    Ok(VncError::General(read_failure_reason(stream).await?))
}

async fn create_client<S, F>(connector: VncConnector<S, F>) -> Result<VncClient, VncError>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + Sync + 'static,
    F: Future<Output = Result<String, VncError>> + Send + Sync + 'static,
{
    let stream = connector.stream.ok_or(VncError::ConnectError)?;
    VncClient::new(
        stream,
        connector.allow_shared,
        connector.pixel_format,
        connector.encodings,
    )
    .await
}

/// Connection builder for a VNC client.
pub struct VncConnector<S, F = DefaultAuthFuture>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    F: Future<Output = Result<String, VncError>> + Send + Sync + 'static,
{
    stream: Option<MaybeEncryptedStream<S>>,
    credentials: VncCredentials,
    auth_method: Option<F>,
    security_policy: SecurityPolicy,
    rfb_version: VncVersion,
    allow_shared: bool,
    pixel_format: Option<PixelFormat>,
    encodings: Vec<VncEncoding>,
}

impl<S> VncConnector<S, DefaultAuthFuture>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + Sync + 'static,
{
    pub fn new(stream: S) -> Self {
        Self {
            stream: Some(MaybeEncryptedStream::Plain(stream)),
            credentials: VncCredentials::default(),
            auth_method: None,
            security_policy: SecurityPolicy::Auto,
            allow_shared: true,
            rfb_version: VncVersion::RFB38,
            pixel_format: None,
            encodings: Vec::new(),
        }
    }
}

impl<S, F> VncConnector<S, F>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + Sync + 'static,
    F: Future<Output = Result<String, VncError>> + Send + Sync + 'static,
{
    fn stream_mut(&mut self) -> Result<&mut MaybeEncryptedStream<S>, VncError> {
        self.stream.as_mut().ok_or(VncError::ConnectError)
    }
    /// Compatibility adapter for password-only callers.
    pub fn set_auth_method<A>(self, auth_callback: A) -> VncConnector<S, A>
    where
        A: Future<Output = Result<String, VncError>> + Send + Sync + 'static,
    {
        VncConnector {
            stream: self.stream,
            credentials: self.credentials,
            auth_method: Some(auth_callback),
            security_policy: self.security_policy,
            rfb_version: self.rfb_version,
            allow_shared: self.allow_shared,
            pixel_format: self.pixel_format,
            encodings: self.encodings,
        }
    }

    pub fn set_credentials(mut self, credentials: VncCredentials) -> Self {
        self.credentials = credentials;
        self.auth_method = None;
        self
    }

    pub fn set_security_policy(mut self, policy: SecurityPolicy) -> Self {
        self.security_policy = policy;
        self
    }

    pub fn set_version(mut self, version: VncVersion) -> Self {
        self.rfb_version = version;
        self
    }

    pub fn set_pixel_format(mut self, pixel_format: PixelFormat) -> Self {
        self.pixel_format = Some(pixel_format);
        self
    }

    pub fn allow_shared(mut self, allow_shared: bool) -> Self {
        self.allow_shared = allow_shared;
        self
    }

    pub fn add_encoding(mut self, encoding: VncEncoding) -> Self {
        self.encodings.push(encoding);
        self
    }

    pub fn build(self) -> Result<VncState<S, F>, VncError> {
        if self.encodings.is_empty() {
            return Err(VncError::NoEncoding);
        }
        Ok(VncState::Handshake(self))
    }

    async fn resolve_password(&mut self) -> Result<String, VncError> {
        let password = match self.auth_method.take() {
            Some(auth_method) => Some(auth_method.await?),
            None => self.credentials.password.clone(),
        };
        password.ok_or(VncError::NoPassword)
    }
}

#[cfg(test)]
#[path = "connector_tests.rs"]
mod tests;
