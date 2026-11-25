use std::{
    collections::VecDeque,
    io,
    pin::Pin,
    task::{Context, Poll},
};

use aes::Aes128;
use eax::{
    Eax,
    aead::{AeadInPlace, KeyInit, generic_array::GenericArray},
};
use rand::{RngCore, rngs::OsRng};
use rsa::{BigUint, Pkcs1v15Encrypt, RsaPrivateKey, RsaPublicKey, traits::PublicKeyParts};
use sha1::{Digest, Sha1};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf};

use crate::VncError;

const RA2_MAX_KEY_BITS: u32 = 8192;
const RA2_MIN_KEY_BITS: u32 = 1024;
const RA2_CLIENT_KEY_BITS: usize = 2048;
const RA2_AES_KEY_LEN: usize = 16;
const RA2_TAG_LEN: usize = 16;
const RA2_MAX_FRAME_LEN: usize = 64 * 1024;

type Aes128Eax = Eax<Aes128>;

#[derive(Debug)]
struct NonceCounter([u8; 16]);

impl NonceCounter {
    fn new() -> Self {
        Self([0u8; 16])
    }

    fn current(&self) -> &[u8; 16] {
        &self.0
    }

    fn increment(&mut self) {
        // RealVNC RA2 increments the 128-bit nonce as a little-endian integer.
        for byte in &mut self.0 {
            let (next, carry) = byte.overflowing_add(1);
            *byte = next;
            if !carry {
                break;
            }
        }
    }
}

struct EaxDirection {
    cipher: Aes128Eax,
    nonce: NonceCounter,
}

impl EaxDirection {
    fn new(key: &[u8; RA2_AES_KEY_LEN]) -> Self {
        Self {
            cipher: Aes128Eax::new(GenericArray::from_slice(key)),
            nonce: NonceCounter::new(),
        }
    }

    fn encrypt_frame(&mut self, plaintext: &[u8]) -> Result<Vec<u8>, VncError> {
        debug_assert!(plaintext.len() <= u16::MAX as usize);
        let len_bytes = (plaintext.len() as u16).to_be_bytes();
        let mut buf = Vec::with_capacity(2 + plaintext.len() + RA2_TAG_LEN);
        buf.extend_from_slice(&len_bytes);
        buf.extend_from_slice(plaintext);

        let nonce = GenericArray::from_slice(self.nonce.current());
        let tag = self
            .cipher
            .encrypt_in_place_detached(nonce, &len_bytes, &mut buf[2..])
            .map_err(|_| VncError::General("RA2 AES-EAX encryption failed".to_string()))?;
        self.nonce.increment();
        buf.extend_from_slice(tag.as_slice());
        Ok(buf)
    }

    fn decrypt_frame(
        &mut self,
        len_bytes: [u8; 2],
        ciphertext_and_tag: &mut [u8],
    ) -> Result<usize, VncError> {
        if ciphertext_and_tag.len() < RA2_TAG_LEN {
            return Err(VncError::General(
                "RA2 AES-EAX frame shorter than tag".to_string(),
            ));
        }
        let msg_len = ciphertext_and_tag.len() - RA2_TAG_LEN;
        let (ciphertext, tag_slice) = ciphertext_and_tag.split_at_mut(msg_len);
        let nonce = GenericArray::from_slice(self.nonce.current());
        let tag = GenericArray::from_slice(tag_slice);
        self.cipher
            .decrypt_in_place_detached(nonce, &len_bytes, ciphertext, tag)
            .map_err(|_| VncError::General("RA2 AES-EAX decryption failed".to_string()))?;
        self.nonce.increment();
        Ok(msg_len)
    }
}

/// Async stream wrapper implementing RealVNC RA2 AES-128-EAX framing.
pub(crate) struct Ra2Stream<S> {
    inner: S,
    reader: EaxDirection,
    writer: EaxDirection,
    // Read state
    read_plain_buf: VecDeque<u8>,
    read_hdr_buf: [u8; 2],
    read_hdr_pos: usize,
    read_body_buf: Vec<u8>,
    read_body_pos: usize,
    read_body_target: usize,
    // Write state
    write_wire_buf: Vec<u8>,
    write_wire_pos: usize,
    pending_plain_len: usize,
}

impl<S> Ra2Stream<S> {
    fn new(
        inner: S,
        server_key: &[u8; RA2_AES_KEY_LEN],
        client_key: &[u8; RA2_AES_KEY_LEN],
    ) -> Self {
        Self {
            inner,
            reader: EaxDirection::new(server_key),
            writer: EaxDirection::new(client_key),
            read_plain_buf: VecDeque::new(),
            read_hdr_buf: [0u8; 2],
            read_hdr_pos: 0,
            read_body_buf: Vec::new(),
            read_body_pos: 0,
            read_body_target: 0,
            write_wire_buf: Vec::new(),
            write_wire_pos: 0,
            pending_plain_len: 0,
        }
    }
}

impl<S: AsyncRead + Unpin> AsyncRead for Ra2Stream<S> {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        loop {
            if !this.read_plain_buf.is_empty() {
                let to_copy = buf.remaining().min(this.read_plain_buf.len());
                for _ in 0..to_copy {
                    if let Some(byte) = this.read_plain_buf.pop_front() {
                        buf.put_slice(&[byte]);
                    }
                }
                return Poll::Ready(Ok(()));
            }

            if this.read_body_target == 0 {
                while this.read_hdr_pos < 2 {
                    let mut hdr_buf = ReadBuf::new(&mut this.read_hdr_buf[this.read_hdr_pos..]);
                    match Pin::new(&mut this.inner).poll_read(cx, &mut hdr_buf) {
                        Poll::Pending => return Poll::Pending,
                        Poll::Ready(Err(err)) => return Poll::Ready(Err(err)),
                        Poll::Ready(Ok(())) => {
                            let n = hdr_buf.filled().len();
                            if n == 0 {
                                if this.read_hdr_pos == 0 {
                                    return Poll::Ready(Ok(()));
                                }
                                return Poll::Ready(Err(io::Error::new(
                                    io::ErrorKind::UnexpectedEof,
                                    "EOF while reading RA2 frame length",
                                )));
                            }
                            this.read_hdr_pos += n;
                        }
                    }
                }
                let payload_len = u16::from_be_bytes(this.read_hdr_buf) as usize;
                this.read_body_target = payload_len + RA2_TAG_LEN;
                this.read_body_buf.resize(this.read_body_target, 0);
                this.read_body_pos = 0;
            }

            while this.read_body_pos < this.read_body_target {
                let mut body_buf = ReadBuf::new(
                    &mut this.read_body_buf[this.read_body_pos..this.read_body_target],
                );
                match Pin::new(&mut this.inner).poll_read(cx, &mut body_buf) {
                    Poll::Pending => return Poll::Pending,
                    Poll::Ready(Err(err)) => return Poll::Ready(Err(err)),
                    Poll::Ready(Ok(())) => {
                        let n = body_buf.filled().len();
                        if n == 0 {
                            return Poll::Ready(Err(io::Error::new(
                                io::ErrorKind::UnexpectedEof,
                                "EOF while reading RA2 encrypted frame",
                            )));
                        }
                        this.read_body_pos += n;
                    }
                }
            }

            let len_bytes = this.read_hdr_buf;
            let msg_len = this
                .reader
                .decrypt_frame(len_bytes, &mut this.read_body_buf[..this.read_body_target])
                .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err.to_string()))?;
            this.read_plain_buf.extend(&this.read_body_buf[..msg_len]);
            this.read_hdr_pos = 0;
            this.read_body_pos = 0;
            this.read_body_target = 0;
        }
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for Ra2Stream<S> {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        let this = self.get_mut();
        if buf.is_empty() {
            return Poll::Ready(Ok(0));
        }

        if this.write_wire_buf.is_empty() {
            let chunk_len = buf.len().min(RA2_MAX_FRAME_LEN.min(u16::MAX as usize));
            let frame = this
                .writer
                .encrypt_frame(&buf[..chunk_len])
                .map_err(|err| io::Error::other(err.to_string()))?;
            this.write_wire_buf = frame;
            this.write_wire_pos = 0;
            this.pending_plain_len = chunk_len;
        }

        while this.write_wire_pos < this.write_wire_buf.len() {
            match Pin::new(&mut this.inner)
                .poll_write(cx, &this.write_wire_buf[this.write_wire_pos..])
            {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Err(err)) => return Poll::Ready(Err(err)),
                Poll::Ready(Ok(0)) => {
                    return Poll::Ready(Err(io::Error::new(
                        io::ErrorKind::WriteZero,
                        "write zero on RA2 stream",
                    )));
                }
                Poll::Ready(Ok(n)) => {
                    this.write_wire_pos += n;
                }
            }
        }

        let written = this.pending_plain_len;
        this.write_wire_buf.clear();
        this.write_wire_pos = 0;
        this.pending_plain_len = 0;
        Poll::Ready(Ok(written))
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let this = self.get_mut();
        while this.write_wire_pos < this.write_wire_buf.len() {
            match Pin::new(&mut this.inner)
                .poll_write(cx, &this.write_wire_buf[this.write_wire_pos..])
            {
                Poll::Pending => return Poll::Pending,
                Poll::Ready(Err(err)) => return Poll::Ready(Err(err)),
                Poll::Ready(Ok(0)) => {
                    return Poll::Ready(Err(io::Error::new(
                        io::ErrorKind::WriteZero,
                        "write zero during RA2 flush",
                    )));
                }
                Poll::Ready(Ok(n)) => {
                    this.write_wire_pos += n;
                }
            }
        }
        this.write_wire_buf.clear();
        this.write_wire_pos = 0;
        this.pending_plain_len = 0;
        Pin::new(&mut this.inner).poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.get_mut().inner).poll_shutdown(cx)
    }
}

/// Stream abstraction allowing `VncClient` to operate over either plaintext or RA2-encrypted transport.
pub(crate) enum MaybeEncryptedStream<S> {
    Plain(S),
    Ra2(Ra2Stream<S>),
}

impl<S: AsyncRead + Unpin> AsyncRead for MaybeEncryptedStream<S> {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        match self.get_mut() {
            Self::Plain(stream) => Pin::new(stream).poll_read(cx, buf),
            Self::Ra2(stream) => Pin::new(stream).poll_read(cx, buf),
        }
    }
}

impl<S: AsyncWrite + Unpin> AsyncWrite for MaybeEncryptedStream<S> {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        match self.get_mut() {
            Self::Plain(stream) => Pin::new(stream).poll_write(cx, buf),
            Self::Ra2(stream) => Pin::new(stream).poll_write(cx, buf),
        }
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        match self.get_mut() {
            Self::Plain(stream) => Pin::new(stream).poll_flush(cx),
            Self::Ra2(stream) => Pin::new(stream).poll_flush(cx),
        }
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        match self.get_mut() {
            Self::Plain(stream) => Pin::new(stream).poll_shutdown(cx),
            Self::Ra2(stream) => Pin::new(stream).poll_shutdown(cx),
        }
    }
}

fn pad_be_bytes(value: &BigUint, len: usize) -> Vec<u8> {
    let raw = value.to_bytes_be();
    if raw.len() >= len {
        raw[raw.len() - len..].to_vec()
    } else {
        let mut out = vec![0u8; len];
        out[len - raw.len()..].copy_from_slice(&raw);
        out
    }
}

fn derive_session_key(first: &[u8; 16], second: &[u8; 16]) -> [u8; 16] {
    let mut hasher = Sha1::new();
    hasher.update(first);
    hasher.update(second);
    let digest = hasher.finalize();
    let mut key = [0u8; 16];
    key.copy_from_slice(&digest[..16]);
    key
}

fn compute_ra2_hash(
    first_bits: u32,
    first_n: &[u8],
    first_e: &[u8],
    second_bits: u32,
    second_n: &[u8],
    second_e: &[u8],
) -> [u8; 20] {
    let mut hasher = Sha1::new();
    hasher.update(first_bits.to_be_bytes());
    hasher.update(first_n);
    hasher.update(first_e);
    hasher.update(second_bits.to_be_bytes());
    hasher.update(second_n);
    hasher.update(second_e);
    let digest = hasher.finalize();
    let mut out = [0u8; 20];
    out.copy_from_slice(&digest[..20]);
    out
}

/// Perform RealVNC RA2 (security type 5) RSA-AES-128-EAX handshake and credentials exchange.
pub(crate) async fn handshake_ra2<S>(
    mut stream: S,
    username: Option<&str>,
    password: &str,
) -> Result<Ra2Stream<S>, VncError>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    // 1. Read server RSA public key: U32 key_bits + N + E
    let server_key_bits = stream.read_u32().await?;
    if !(RA2_MIN_KEY_BITS..=RA2_MAX_KEY_BITS).contains(&server_key_bits) {
        return Err(VncError::General(format!(
            "RA2 server RSA key length {server_key_bits} bits is out of supported range"
        )));
    }
    let server_key_bytes = (server_key_bits as usize).div_ceil(8);
    let mut server_n = vec![0u8; server_key_bytes];
    let mut server_e = vec![0u8; server_key_bytes];
    stream.read_exact(&mut server_n).await?;
    stream.read_exact(&mut server_e).await?;

    let server_pubkey = RsaPublicKey::new(
        BigUint::from_bytes_be(&server_n),
        BigUint::from_bytes_be(&server_e),
    )
    .map_err(|err| VncError::General(format!("invalid RA2 server RSA public key: {err}")))?;

    // 2. Generate client ephemeral RSA keypair and send public key
    let client_privkey = RsaPrivateKey::new(&mut OsRng, RA2_CLIENT_KEY_BITS).map_err(|err| {
        VncError::General(format!("failed to generate RA2 client RSA key: {err}"))
    })?;
    let client_key_bits = RA2_CLIENT_KEY_BITS as u32;
    let client_key_bytes = RA2_CLIENT_KEY_BITS / 8;
    let client_n = pad_be_bytes(client_privkey.n(), client_key_bytes);
    let client_e = pad_be_bytes(client_privkey.e(), client_key_bytes);

    let mut client_pub_msg = Vec::with_capacity(4 + client_key_bytes * 2);
    client_pub_msg.extend_from_slice(&client_key_bits.to_be_bytes());
    client_pub_msg.extend_from_slice(&client_n);
    client_pub_msg.extend_from_slice(&client_e);
    stream.write_all(&client_pub_msg).await?;
    stream.flush().await?;

    // 3. Exchange RSA-PKCS1v15 encrypted 16-byte random secrets
    let server_enc_len = stream.read_u16().await? as usize;
    if server_enc_len == 0 || server_enc_len > client_key_bytes * 2 {
        return Err(VncError::General(format!(
            "invalid RA2 server random ciphertext length {server_enc_len}"
        )));
    }
    let mut server_enc = vec![0u8; server_enc_len];
    stream.read_exact(&mut server_enc).await?;
    let server_random_vec = client_privkey
        .decrypt(Pkcs1v15Encrypt, &server_enc)
        .map_err(|err| VncError::General(format!("failed to decrypt RA2 server secret: {err}")))?;
    if server_random_vec.len() != RA2_AES_KEY_LEN {
        return Err(VncError::General(format!(
            "unexpected RA2 server secret length {}",
            server_random_vec.len()
        )));
    }
    let mut server_random = [0u8; RA2_AES_KEY_LEN];
    server_random.copy_from_slice(&server_random_vec);

    let mut client_random = [0u8; RA2_AES_KEY_LEN];
    OsRng.fill_bytes(&mut client_random);
    let client_enc = server_pubkey
        .encrypt(&mut OsRng, Pkcs1v15Encrypt, &client_random)
        .map_err(|err| VncError::General(format!("failed to encrypt RA2 client secret: {err}")))?;
    let mut client_rand_msg = Vec::with_capacity(2 + client_enc.len());
    client_rand_msg.extend_from_slice(&(client_enc.len() as u16).to_be_bytes());
    client_rand_msg.extend_from_slice(&client_enc);
    stream.write_all(&client_rand_msg).await?;
    stream.flush().await?;

    // 4. Derive directional AES-128-EAX session keys and wrap stream
    // Server -> Client key: SHA1(client_random || server_random)[0..16]
    // Client -> Server key: SHA1(server_random || client_random)[0..16]
    let server_key = derive_session_key(&client_random, &server_random);
    let client_key = derive_session_key(&server_random, &client_random);
    let mut ra2 = Ra2Stream::new(stream, &server_key, &client_key);

    // 5. Exchange and verify 20-byte (SHA-1) public-key transcript hashes over encrypted stream.
    // Server hash = SHA1(server_key_bits || server_n || server_e || client_key_bits || client_n || client_e)
    // Client hash = SHA1(client_key_bits || client_n || client_e || server_key_bits || server_n || server_e)
    let expected_server_hash = compute_ra2_hash(
        server_key_bits,
        &server_n,
        &server_e,
        client_key_bits,
        &client_n,
        &client_e,
    );
    let mut server_hash = [0u8; 20];
    ra2.read_exact(&mut server_hash).await?;
    if server_hash != expected_server_hash {
        return Err(VncError::General(
            "RA2 server public key hash verification failed".to_string(),
        ));
    }

    let client_hash = compute_ra2_hash(
        client_key_bits,
        &client_n,
        &client_e,
        server_key_bits,
        &server_n,
        &server_e,
    );
    ra2.write_all(&client_hash).await?;
    ra2.flush().await?;

    // 6. Read subtype (1 = username+password, 2 = password-only) and send credentials
    let subtype = ra2.read_u8().await?;
    let user_bytes = match subtype {
        1 => username.unwrap_or("").as_bytes(),
        2 => b"",
        other => {
            return Err(VncError::General(format!(
                "unsupported RA2 credentials subtype: {other}"
            )));
        }
    };
    let pass_bytes = password.as_bytes();
    if user_bytes.len() > u8::MAX as usize || pass_bytes.len() > u8::MAX as usize {
        return Err(VncError::General(
            "RA2 username or password exceeds 255 bytes".to_string(),
        ));
    }
    let mut cred_msg = Vec::with_capacity(2 + user_bytes.len() + pass_bytes.len());
    cred_msg.push(user_bytes.len() as u8);
    cred_msg.extend_from_slice(user_bytes);
    cred_msg.push(pass_bytes.len() as u8);
    cred_msg.extend_from_slice(pass_bytes);
    ra2.write_all(&cred_msg).await?;
    ra2.flush().await?;

    Ok(ra2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nonce_counter_increments_little_endian() {
        let mut nonce = NonceCounter::new();
        assert_eq!(nonce.current(), &[0u8; 16]);
        nonce.increment();
        assert_eq!(nonce.current()[0], 1);
        assert_eq!(nonce.current()[1], 0);
        nonce.0[0] = 0xff;
        nonce.increment();
        assert_eq!(nonce.current()[0], 0);
        assert_eq!(nonce.current()[1], 1);
    }

    #[tokio::test]
    async fn ra2_stream_round_trips_encrypted_frames() {
        let (a, b) = tokio::io::duplex(4096);
        let key_a_to_b = [0x11u8; 16];
        let key_b_to_a = [0x22u8; 16];

        let mut client = Ra2Stream::new(a, &key_b_to_a, &key_a_to_b);
        let mut server = Ra2Stream::new(b, &key_a_to_b, &key_b_to_a);

        let payload = b"hello realvnc ra2 encrypted stream!";
        client.write_all(payload).await.unwrap();
        client.flush().await.unwrap();

        let mut received = vec![0u8; payload.len()];
        server.read_exact(&mut received).await.unwrap();
        assert_eq!(received, payload);

        let reply = b"server reply over aes-eax";
        server.write_all(reply).await.unwrap();
        server.flush().await.unwrap();

        let mut client_recv = vec![0u8; reply.len()];
        client.read_exact(&mut client_recv).await.unwrap();
        assert_eq!(client_recv, reply);
    }
}
