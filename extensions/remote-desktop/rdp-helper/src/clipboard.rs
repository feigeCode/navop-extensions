use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use ironrdp::cliprdr::backend::{ClipboardMessage, CliprdrBackend, CliprdrBackendFactory};
use ironrdp::cliprdr::pdu::{
    ClipboardFileAttributes, ClipboardFormat, ClipboardFormatId, ClipboardGeneralCapabilityFlags,
    FileContentsFlags, FileContentsRequest, FileContentsResponse, FileDescriptor,
    FormatDataRequest, FormatDataResponse, LockDataId,
};
use ironrdp::core::{AsAny, IntoOwned};
use ironrdp_client::rdp::RdpInputEvent;
use tokio::sync::mpsc;

use crate::output_mailbox::OutputSender;
use crate::protocol::HelperEvent;

const MAX_FILE_CHUNK_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct TextClipboardController {
    shared: Arc<Mutex<TextClipboardState>>,
    input_tx: mpsc::UnboundedSender<RdpInputEvent>,
}

impl TextClipboardController {
    pub fn set_local_text(&self, text: String) -> anyhow::Result<()> {
        let mut state = self.shared.lock().expect("clipboard mutex");
        state.local_text = Some(text);
        state.local_files.clear();
        drop(state);
        self.send_clipboard(ClipboardMessage::SendInitiateCopy(text_formats()))
    }

    pub fn set_local_files(&self, paths: Vec<String>) -> anyhow::Result<()> {
        let files = paths
            .into_iter()
            .map(PathBuf::from)
            .filter(|path| path.is_file())
            .collect::<Vec<_>>();
        anyhow::ensure!(!files.is_empty(), "clipboard file list is empty");
        let mut state = self.shared.lock().expect("clipboard mutex");
        state.local_text = None;
        state.local_files = files.clone();
        drop(state);
        self.input_tx
            .send(RdpInputEvent::ClipboardFileCopy(file_descriptors(&files)))
            .map_err(|_| anyhow::anyhow!("RDP input channel closed"))
    }

    fn send_clipboard(&self, message: ClipboardMessage) -> anyhow::Result<()> {
        self.input_tx
            .send(RdpInputEvent::Clipboard(message))
            .map_err(|_| anyhow::anyhow!("RDP input channel closed"))
    }
}

#[derive(Debug, Default)]
struct TextClipboardState {
    local_text: Option<String>,
    local_files: Vec<PathBuf>,
}

#[derive(Clone, Debug)]
struct TextClipboardBackendFactory {
    shared: Arc<Mutex<TextClipboardState>>,
    input_tx: mpsc::UnboundedSender<RdpInputEvent>,
    output_tx: OutputSender,
}

impl CliprdrBackendFactory for TextClipboardBackendFactory {
    fn build_cliprdr_backend(&self) -> Box<dyn CliprdrBackend> {
        Box::new(TextClipboardBackend {
            shared: self.shared.clone(),
            input_tx: self.input_tx.clone(),
            output_tx: self.output_tx.clone(),
            temporary_directory: std::env::temp_dir().to_string_lossy().to_string(),
        })
    }
}

#[derive(Debug)]
struct TextClipboardBackend {
    shared: Arc<Mutex<TextClipboardState>>,
    input_tx: mpsc::UnboundedSender<RdpInputEvent>,
    output_tx: OutputSender,
    temporary_directory: String,
}

impl AsAny for TextClipboardBackend {
    fn as_any(&self) -> &dyn core::any::Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn core::any::Any {
        self
    }
}

impl TextClipboardBackend {
    fn send_clipboard(&self, message: ClipboardMessage) {
        let _ = self.input_tx.send(RdpInputEvent::Clipboard(message));
    }

    fn send_local_text_response(&self, request: FormatDataRequest) {
        let response = if request.format == ClipboardFormatId::CF_UNICODETEXT {
            self.shared
                .lock()
                .expect("clipboard mutex")
                .local_text
                .as_deref()
                .map(FormatDataResponse::new_unicode_string)
                .unwrap_or_else(FormatDataResponse::new_error)
        } else {
            FormatDataResponse::new_error()
        };
        self.send_clipboard(ClipboardMessage::SendFormatData(response.into_owned()));
    }

    fn send_file_contents_response(&self, request: FileContentsRequest) {
        let file = self
            .shared
            .lock()
            .expect("clipboard mutex")
            .local_files
            .get(usize::try_from(request.index).unwrap_or(usize::MAX))
            .cloned();
        let response = file
            .and_then(|path| read_file_contents(&path, &request).ok())
            .unwrap_or_else(|| FileContentsResponse::new_error(request.stream_id));
        let _ = self.input_tx.send(RdpInputEvent::Clipboard(
            ClipboardMessage::SendFileContentsResponse(response),
        ));
    }
}

impl CliprdrBackend for TextClipboardBackend {
    fn temporary_directory(&self) -> &str {
        &self.temporary_directory
    }

    fn client_capabilities(&self) -> ClipboardGeneralCapabilityFlags {
        ClipboardGeneralCapabilityFlags::CAN_LOCK_CLIPDATA
            | ClipboardGeneralCapabilityFlags::STREAM_FILECLIP_ENABLED
    }

    fn on_ready(&mut self) {}

    fn on_request_format_list(&mut self) {
        let state = self.shared.lock().expect("clipboard mutex");
        if !state.local_files.is_empty() {
            let files = state.local_files.clone();
            drop(state);
            let _ = self
                .input_tx
                .send(RdpInputEvent::ClipboardFileCopy(file_descriptors(&files)));
        } else if state.local_text.is_some() {
            self.send_clipboard(ClipboardMessage::SendInitiateCopy(text_formats()));
        } else {
            self.send_clipboard(ClipboardMessage::SendInitiateCopy(Vec::new()));
        }
    }

    fn on_process_negotiated_capabilities(&mut self, _: ClipboardGeneralCapabilityFlags) {}

    fn on_remote_copy(&mut self, available_formats: &[ClipboardFormat]) {
        if available_formats
            .iter()
            .any(|format| format.id() == ClipboardFormatId::CF_UNICODETEXT)
        {
            self.send_clipboard(ClipboardMessage::SendInitiatePaste(
                ClipboardFormatId::CF_UNICODETEXT,
            ));
        }
    }

    fn on_format_data_request(&mut self, request: FormatDataRequest) {
        self.send_local_text_response(request);
    }

    fn on_format_data_response(&mut self, response: FormatDataResponse<'_>) {
        if response.is_error() {
            return;
        }
        if let Ok(text) = response.to_unicode_string() {
            let _ = self.output_tx.send(HelperEvent::ClipboardText { text });
        }
    }

    fn on_file_contents_request(&mut self, request: FileContentsRequest) {
        self.send_file_contents_response(request);
    }

    fn on_file_contents_response(&mut self, _: FileContentsResponse<'_>) {}

    fn on_lock(&mut self, _: LockDataId) {}

    fn on_unlock(&mut self, _: LockDataId) {}
}

pub fn text_clipboard(
    input_tx: mpsc::UnboundedSender<RdpInputEvent>,
    output_tx: OutputSender,
) -> (
    TextClipboardController,
    Box<dyn CliprdrBackendFactory + Send>,
) {
    let shared = Arc::new(Mutex::new(TextClipboardState::default()));
    let controller = TextClipboardController {
        shared: shared.clone(),
        input_tx: input_tx.clone(),
    };
    let factory = TextClipboardBackendFactory {
        shared,
        input_tx,
        output_tx,
    };
    (controller, Box::new(factory))
}

fn text_formats() -> Vec<ClipboardFormat> {
    vec![ClipboardFormat::new(ClipboardFormatId::CF_UNICODETEXT)]
}

fn file_descriptors(paths: &[PathBuf]) -> Vec<FileDescriptor> {
    paths
        .iter()
        .filter_map(|path| {
            let name = path.file_name()?.to_string_lossy().into_owned();
            let size = std::fs::metadata(path).ok()?.len();
            Some(
                FileDescriptor::new(name)
                    .with_file_size(size)
                    .with_attributes(ClipboardFileAttributes::ARCHIVE),
            )
        })
        .collect()
}

fn read_file_contents(
    path: &PathBuf,
    request: &FileContentsRequest,
) -> anyhow::Result<FileContentsResponse<'static>> {
    let mut file = std::fs::File::open(path)?;
    let size = file.metadata()?.len();
    if request.flags.contains(FileContentsFlags::SIZE) {
        return Ok(FileContentsResponse::new_size_response(
            request.stream_id,
            size,
        ));
    }
    anyhow::ensure!(request.position <= size, "file range starts past end");
    let amount = u64::from(request.requested_size)
        .min(MAX_FILE_CHUNK_BYTES)
        .min(size - request.position);
    let mut data = vec![0; usize::try_from(amount)?];
    file.seek(SeekFrom::Start(request.position))?;
    file.read_exact(&mut data)?;
    Ok(FileContentsResponse::new_data_response(
        request.stream_id,
        data,
    ))
}

#[cfg(test)]
#[path = "clipboard_tests.rs"]
mod tests;
