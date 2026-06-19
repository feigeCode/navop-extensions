use std::collections::HashMap;
use std::time::Instant;

use extension_protocol::data::{FailedRow, ImportId, ImportOptions, StreamId};
use extension_protocol::query::CursorId;
use extension_protocol::row::{ColumnSpec, Row};

use crate::session::OpenGaussSession;

pub struct CursorState {
    rows: Vec<Row>,
    next_row: usize,
    max_rows: Option<u64>,
    done: bool,
}

impl CursorState {
    pub fn new(rows: Vec<Row>, max_rows: Option<u64>) -> Self {
        Self {
            rows,
            next_row: 0,
            max_rows,
            done: max_rows == Some(0),
        }
    }

    pub fn fetch(&mut self, n: Option<u32>) -> (Vec<Row>, bool) {
        if self.done {
            return (Vec::new(), true);
        }
        let requested = n.unwrap_or(1_000).clamp(1, 10_000) as usize;
        let remaining_by_max = self
            .max_rows
            .map(|max| max.saturating_sub(self.next_row as u64) as usize)
            .unwrap_or(usize::MAX);
        let take = requested.min(remaining_by_max);
        let end = self.next_row.saturating_add(take).min(self.rows.len());
        let rows = self.rows[self.next_row..end].to_vec();
        self.next_row = end;
        if self.next_row >= self.rows.len()
            || self.max_rows.is_some_and(|max| self.next_row as u64 >= max)
        {
            self.done = true;
        }
        (rows, self.done)
    }

    pub fn cancel(&mut self) {
        self.done = true;
    }
}

pub struct ConnectionState {
    conn: OpenGaussSession,
    cursors: HashMap<CursorId, CursorState>,
    streams: HashMap<StreamId, StreamState>,
    imports: HashMap<ImportId, ImportState>,
    tx_conn: HashMap<String, bool>,
}

impl ConnectionState {
    pub fn new(conn: OpenGaussSession) -> Self {
        Self {
            conn,
            cursors: HashMap::new(),
            streams: HashMap::new(),
            imports: HashMap::new(),
            tx_conn: HashMap::new(),
        }
    }

    pub fn conn_mut(&mut self) -> &mut OpenGaussSession {
        &mut self.conn
    }

    pub fn open_cursor(&mut self, cursor: CursorState) -> CursorId {
        let cursor_id = format!("opengauss-cursor-{}", uuid::Uuid::new_v4());
        self.cursors.insert(cursor_id.clone(), cursor);
        cursor_id
    }

    pub fn cursor_mut(&mut self, cursor_id: &str) -> Option<&mut CursorState> {
        self.cursors.get_mut(cursor_id)
    }

    pub fn close_cursor(&mut self, cursor_id: &str) -> bool {
        self.cursors.remove(cursor_id).is_some()
    }

    pub fn insert_stream(&mut self, stream_id: StreamId, stream: StreamState) {
        self.streams.insert(stream_id, stream);
    }

    pub fn stream_mut(&mut self, stream_id: &str) -> Option<&mut StreamState> {
        self.streams.get_mut(stream_id)
    }

    pub fn close_stream(&mut self, stream_id: &str) -> bool {
        self.streams.remove(stream_id).is_some()
    }

    pub fn insert_import(&mut self, import_id: ImportId, import: ImportState) {
        self.imports.insert(import_id, import);
    }

    pub fn import_mut(&mut self, import_id: &str) -> Option<&mut ImportState> {
        self.imports.get_mut(import_id)
    }

    pub fn remove_import(&mut self, import_id: &str) -> Option<ImportState> {
        self.imports.remove(import_id)
    }

    pub fn insert_tx(&mut self, tx_id: String) {
        self.tx_conn.insert(tx_id, true);
    }

    pub fn has_tx(&self, tx_id: &str) -> bool {
        self.tx_conn.contains_key(tx_id)
    }

    pub fn remove_tx(&mut self, tx_id: &str) -> bool {
        self.tx_conn.remove(tx_id).is_some()
    }
}

#[allow(dead_code)]
pub fn _assert_column_spec(_: ColumnSpec) {}

pub struct StreamState {
    data: Vec<u8>,
    offset: usize,
}

impl StreamState {
    pub fn new(data: Vec<u8>) -> Self {
        Self { data, offset: 0 }
    }

    pub fn estimated_bytes(&self) -> u64 {
        self.data.len() as u64
    }

    pub fn read(&mut self, max_bytes: Option<u32>) -> (Vec<u8>, bool) {
        let max = max_bytes.unwrap_or(64 * 1024).clamp(1, 1024 * 1024) as usize;
        let end = self.offset.saturating_add(max).min(self.data.len());
        let chunk = self.data[self.offset..end].to_vec();
        self.offset = end;
        (chunk, self.offset >= self.data.len())
    }
}

pub struct ImportState {
    table: String,
    schema: Option<String>,
    database: Option<String>,
    columns: Vec<String>,
    options: ImportOptions,
    inserted: u64,
    failed: Vec<FailedRow>,
    next_row: u64,
    started: Instant,
}

impl ImportState {
    pub fn new(
        table: String,
        schema: Option<String>,
        database: Option<String>,
        columns: Vec<String>,
        options: ImportOptions,
    ) -> Self {
        Self {
            table,
            schema,
            database,
            columns,
            options,
            inserted: 0,
            failed: Vec::new(),
            next_row: 0,
            started: Instant::now(),
        }
    }

    pub fn table(&self) -> &str {
        &self.table
    }

    pub fn schema(&self) -> Option<&str> {
        self.schema.as_deref()
    }

    pub fn database(&self) -> Option<&str> {
        self.database.as_deref()
    }

    pub fn columns(&self) -> &[String] {
        &self.columns
    }

    pub fn options(&self) -> &ImportOptions {
        &self.options
    }

    pub fn inserted(&self) -> u64 {
        self.inserted
    }

    pub fn failed(&self) -> &[FailedRow] {
        &self.failed
    }

    pub fn elapsed_ms(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }

    pub fn record_inserted(&mut self) {
        self.inserted = self.inserted.saturating_add(1);
        self.next_row = self.next_row.saturating_add(1);
    }

    pub fn record_failed(&mut self, message: String, code: i32) -> Option<FailedRow> {
        let failed = FailedRow {
            row_index: self.next_row,
            message,
            code,
        };
        self.next_row = self.next_row.saturating_add(1);
        if self.options.track_failed_rows {
            self.failed.push(failed.clone());
            Some(failed)
        } else {
            None
        }
    }
}
