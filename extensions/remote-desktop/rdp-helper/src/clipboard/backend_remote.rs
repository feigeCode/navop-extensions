use ironrdp::cliprdr::backend::ClipboardMessage;
use ironrdp::cliprdr::pdu::{FileContentsResponse, FileDescriptor, LockDataId};

use crate::protocol::HelperEvent;

use super::backend::TextClipboardBackend;
use super::controller::lock_state;
use super::remote::{RemoteClipboardTransfer, RemoteTransferAction, RemoteTransferSettings};
use super::remote_layout::RemoteClipboardLayout;

impl TextClipboardBackend {
    pub(super) fn receive_remote_files(&self, files: &[FileDescriptor], clip_data_id: Option<u32>) {
        let transfer_id = lock_state(&self.shared).pending_remote;
        let Some(transfer_id) = transfer_id else {
            return;
        };
        let result = RemoteClipboardLayout::validate(files).and_then(|layout| {
            RemoteClipboardTransfer::create(
                layout,
                RemoteTransferSettings {
                    transfer_id,
                    staging_root: &self.staging_root,
                    clip_data_id,
                },
            )
        });
        self.install_remote_transfer(transfer_id, result);
    }

    pub(super) fn install_remote_transfer(
        &self,
        transfer_id: u64,
        result: anyhow::Result<RemoteClipboardTransfer>,
    ) {
        let mut state = lock_state(&self.shared);
        if state.pending_remote != Some(transfer_id) {
            return;
        }
        state.pending_remote = None;
        let clip_data_id = result
            .as_ref()
            .ok()
            .and_then(|transfer| transfer.clip_data_id());
        let action = result.and_then(|mut transfer| {
            let action = transfer.start(state.allocate_stream_id())?;
            if matches!(action, RemoteTransferAction::Request(_)) {
                state.remote_transfer = Some(transfer);
            }
            Ok(action)
        });
        drop(state);
        self.dispatch_remote_result(transfer_id, clip_data_id, action);
    }

    pub(super) fn advance_remote_transfer(&self, response: FileContentsResponse<'_>) {
        let mut state = lock_state(&self.shared);
        let Some(mut transfer) = state.remote_transfer.take() else {
            return;
        };
        let transfer_id = transfer.transfer_id();
        let clip_data_id = transfer.clip_data_id();
        let action = transfer.advance(response, state.allocate_stream_id());
        if matches!(
            action,
            Ok(RemoteTransferAction::Request(_) | RemoteTransferAction::Ignore)
        ) {
            state.remote_transfer = Some(transfer);
        }
        drop(state);
        self.dispatch_remote_result(transfer_id, clip_data_id, action);
    }

    pub(super) fn dispatch_remote_result(
        &self,
        transfer_id: u64,
        clip_data_id: Option<u32>,
        result: anyhow::Result<RemoteTransferAction>,
    ) {
        match result {
            Ok(RemoteTransferAction::Request(request)) => {
                if let Err(error) =
                    self.send_clipboard(ClipboardMessage::SendFileContentsRequest(request))
                {
                    let mut state = lock_state(&self.shared);
                    if state
                        .remote_transfer
                        .as_ref()
                        .is_some_and(|transfer| transfer.transfer_id() == transfer_id)
                    {
                        state.remote_transfer = None;
                    }
                    drop(state);
                    tracing::warn!(
                        ?error,
                        transfer_id,
                        "failed to request remote RDP clipboard file contents"
                    );
                    self.release_remote_lock(clip_data_id);
                    let _ = self.output_tx.send(HelperEvent::ClipboardTransferFailed {
                        transfer_id,
                        message: "RDP clipboard channel closed during the file transfer"
                            .to_string(),
                    });
                }
            }
            Ok(RemoteTransferAction::Ready(paths)) => {
                // The whole file list is staged locally: nothing needs the
                // remote's File Stream data any more, so let go of the lock
                // now instead of waiting out the inactivity timeout.
                tracing::info!(
                    transfer_id,
                    clip_data_id,
                    files = paths.len(),
                    "remote clipboard files fully staged; releasing lock and notifying host"
                );
                self.release_remote_lock(clip_data_id);
                if self
                    .output_tx
                    .send(HelperEvent::ClipboardFilesReady { transfer_id, paths })
                    .is_err()
                {
                    tracing::warn!(
                        transfer_id,
                        "RDP clipboard files completed after the helper output channel closed"
                    );
                }
            }
            Ok(RemoteTransferAction::Ignore) => {}
            Err(error) => {
                tracing::warn!(?error, transfer_id, "RDP clipboard transfer failed");
                self.release_remote_lock(clip_data_id);
                let _ = self.output_tx.send(HelperEvent::ClipboardTransferFailed {
                    transfer_id,
                    message: error.to_string(),
                });
            }
        }
    }

    /// Drops the outgoing clipboard lock a download was holding.
    ///
    /// The lock asks the remote to retain its File Stream data for the whole
    /// download ([MS-RDPECLIP] 2.2.4.1). While it is held Windows `rdpclip.exe`
    /// also keeps the *source* files open, so the user cannot delete or move
    /// them. We release it as soon as we know we are done with it — the download
    /// finished, failed, or was cancelled — rather than waiting for the
    /// inactivity timeout. Releasing an id that is unknown or already released
    /// is a no-op on the cliprdr side.
    fn release_remote_lock(&self, clip_data_id: Option<u32>) {
        let Some(clip_data_id) = clip_data_id else {
            return;
        };
        if let Err(error) =
            self.send_clipboard(ClipboardMessage::ReleaseFileLock(LockDataId(clip_data_id)))
        {
            tracing::warn!(
                ?error,
                clip_data_id,
                "failed to release the remote RDP clipboard lock"
            );
        }
    }

    pub(super) fn cancel_remote_locks(&self, clip_data_ids: &[LockDataId]) {
        let mut state = lock_state(&self.shared);
        let matches = state.remote_transfer.as_ref().is_some_and(|transfer| {
            transfer
                .clip_data_id()
                .is_some_and(|id| clip_data_ids.iter().any(|lock| lock.0 == id))
        });
        let transfer_id = matches.then(|| {
            state
                .remote_transfer
                .take()
                .expect("matching transfer exists")
                .transfer_id()
        });
        drop(state);
        if let Some(transfer_id) = transfer_id {
            let _ = self.output_tx.send(HelperEvent::ClipboardTransferFailed {
                transfer_id,
                message: "remote clipboard snapshot expired".to_string(),
            });
        }
    }
}
