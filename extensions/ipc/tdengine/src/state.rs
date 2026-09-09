//! 每连接的游标状态机。
//!
//! v1 采用内存缓冲游标:`query/start` 时一次性拉取结果集(与主仓连接层的
//! `to_records` 语义一致,表数据查询通常带 max_rows 上限),`cursor/fetch`
//! 从缓冲中分页弹出。后续如需超大结果集可升级为 taos 的块式流拉取
//! (`AsyncFetchable::fetch_raw_block`)。

use std::collections::HashMap;

use extension_protocol::query::CursorId;
use extension_protocol::row::{CellValue, ColumnSpec};

/// 单个游标的服务端状态。
pub struct CursorState {
    pub columns: Vec<ColumnSpec>,
    /// 剩余待拉取的行缓冲(已按 max_rows 截断)。
    rows: Vec<Vec<CellValue>>,
    next: usize,
    fetch_size: Option<u32>,
    done: bool,
}

impl CursorState {
    pub fn new(
        columns: Vec<ColumnSpec>,
        mut rows: Vec<Vec<CellValue>>,
        fetch_size: Option<u32>,
        max_rows: Option<u64>,
    ) -> Self {
        // max_rows 上限截断(0 表示立即完成,不出行)。
        if let Some(max_rows) = max_rows {
            rows.truncate(max_rows.min(usize::MAX as u64) as usize);
        }
        let done = rows.is_empty();
        Self {
            columns,
            rows,
            next: 0,
            fetch_size,
            done,
        }
    }

    /// 默认每页拉取行数(取 fetch_size,未指定时用驱动默认值)。
    pub fn page_size(&self, requested: Option<u32>) -> u32 {
        requested
            .or(self.fetch_size)
            .filter(|n| *n > 0)
            .unwrap_or(DEFAULT_CURSOR_FETCH_SIZE)
            .min(MAX_CURSOR_FETCH_SIZE)
    }

    /// 弹出最多 n 行;返回 (rows, done)。
    pub fn fetch(&mut self, n: u32) -> (Vec<Vec<CellValue>>, bool) {
        if self.done || n == 0 {
            return (Vec::new(), self.done);
        }
        let end = (self.next + n as usize).min(self.rows.len());
        let rows: Vec<Vec<CellValue>> = self.rows[self.next..end].to_vec();
        self.next = end;
        if self.next >= self.rows.len() {
            self.done = true;
            // 已读完,释放缓冲。
            self.rows.clear();
            self.next = 0;
        }
        let done = self.done;
        (rows, done)
    }

    /// 取消:丢弃剩余缓冲,后续 fetch 立即 done。
    pub fn cancel(&mut self) {
        self.rows.clear();
        self.next = 0;
        self.done = true;
    }

    pub fn is_done(&self) -> bool {
        self.done
    }
}

/// 默认每页行数。
pub const DEFAULT_CURSOR_FETCH_SIZE: u32 = 1_000;
/// 每页行数上限。
pub const MAX_CURSOR_FETCH_SIZE: u32 = 10_000;

/// 单个连接持有的全部游标。
#[derive(Default)]
pub struct ConnectionState {
    cursors: HashMap<CursorId, CursorState>,
    next_cursor_seq: u64,
}

impl ConnectionState {
    pub fn new() -> Self {
        Self::default()
    }

    /// 注册一个新游标,返回分配的 cursor_id(形如 `c-<seq>`)。
    pub fn open_cursor(&mut self, state: CursorState) -> CursorId {
        self.next_cursor_seq += 1;
        let id = format!("c-{}", self.next_cursor_seq);
        self.cursors.insert(id.clone(), state);
        id
    }

    pub fn get_cursor_mut(&mut self, id: &str) -> Option<&mut CursorState> {
        self.cursors.get_mut(id)
    }

    /// 关闭游标;不存在时返回 false。
    pub fn close_cursor(&mut self, id: &str) -> bool {
        self.cursors.remove(id).is_some()
    }

    pub fn cursor_count(&self) -> usize {
        self.cursors.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_row(value: &str) -> Vec<CellValue> {
        vec![CellValue::Text {
            value: value.to_string(),
        }]
    }

    fn spec() -> Vec<ColumnSpec> {
        vec![ColumnSpec::new(
            "v",
            "VARCHAR",
            extension_protocol::row::ColumnTypeKind::Text,
        )]
    }

    #[test]
    fn fetch_pages_until_done_and_frees_buffer() {
        let rows = vec![text_row("a"), text_row("b"), text_row("c")];
        let mut cursor = CursorState::new(spec(), rows, Some(2), None);
        let (page, done) = cursor.fetch(2);
        assert_eq!(page.len(), 2);
        assert!(!done);
        let (page, done) = cursor.fetch(2);
        assert_eq!(page.len(), 1);
        assert!(done);
        // done 之后再 fetch 返回空。
        let (page, done) = cursor.fetch(2);
        assert!(page.is_empty());
        assert!(done);
    }

    #[test]
    fn fetch_without_n_uses_fetch_size_default() {
        let rows: Vec<Vec<CellValue>> = (0..5).map(|i| text_row(&i.to_string())).collect();
        let mut cursor = CursorState::new(spec(), rows, Some(2), None);
        assert_eq!(cursor.page_size(None), 2);
        let (page, done) = cursor.fetch(cursor.page_size(None));
        assert_eq!(page.len(), 2);
        assert!(!done);
    }

    #[test]
    fn max_rows_truncates_buffer() {
        let rows: Vec<Vec<CellValue>> = (0..5).map(|i| text_row(&i.to_string())).collect();
        let mut cursor = CursorState::new(spec(), rows, None, Some(2));
        let (page, done) = cursor.fetch(10);
        assert_eq!(page.len(), 2);
        assert!(done);
    }

    #[test]
    fn max_rows_zero_completes_immediately() {
        let rows = vec![text_row("a")];
        let mut cursor = CursorState::new(spec(), rows, None, Some(0));
        let (page, done) = cursor.fetch(10);
        assert!(page.is_empty());
        assert!(done);
    }

    #[test]
    fn cancel_discards_remaining_rows() {
        let rows = vec![text_row("a"), text_row("b")];
        let mut cursor = CursorState::new(spec(), rows, None, None);
        cursor.cancel();
        let (page, done) = cursor.fetch(10);
        assert!(page.is_empty());
        assert!(done);
    }

    #[test]
    fn connection_state_allocates_unique_cursor_ids() {
        let mut state = ConnectionState::new();
        let first = state.open_cursor(CursorState::new(spec(), vec![], None, None));
        let second = state.open_cursor(CursorState::new(spec(), vec![], None, None));
        assert_ne!(first, second);
        assert_eq!(state.cursor_count(), 2);
        assert!(state.close_cursor(&first));
        assert!(!state.close_cursor(&first));
        assert_eq!(state.cursor_count(), 1);
    }
}
