#![allow(clippy::result_large_err)]

use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};

use extension_driver::{Driver, DriverConnection, OpenedConnection};
use extension_protocol::conn::ConnOpenParams;
use extension_protocol::error::{ProtocolError, error_codes};
use extension_protocol::method;
use serde_json::{Value, json};

use crate::config::OpenGaussConnectionConfig;
use crate::handlers;
use crate::server::{params_deserialize_error, protocol_error_from_anyhow};
use crate::session::OpenGaussSession;
use crate::state::ConnectionState;

pub struct OpenGaussDriver {
    initialized: AtomicI64,
    next_conn_id: AtomicU64,
}

impl OpenGaussDriver {
    pub fn new() -> Self {
        Self {
            initialized: AtomicI64::new(0),
            next_conn_id: AtomicU64::new(1),
        }
    }
}

impl Default for OpenGaussDriver {
    fn default() -> Self {
        Self::new()
    }
}

impl Driver for OpenGaussDriver {
    fn init(&self, params: &Value) -> Result<Value, ProtocolError> {
        handlers::handle_init(&self.initialized, params)
    }

    fn open_connection(&self, params: &Value) -> Result<OpenedConnection, ProtocolError> {
        let p: ConnOpenParams =
            serde_json::from_value(params.clone()).map_err(params_deserialize_error)?;
        handlers::ensure_driver(&p.driver_id)?;
        let cfg = OpenGaussConnectionConfig::from_wire_config(p.config.clone())
            .map_err(params_deserialize_error)?;

        let mut session = OpenGaussSession::connect(cfg)
            .map_err(|e| protocol_error_from_anyhow(error_codes::IO_CONNECTION_REFUSED, e))?;
        let version = session
            .server_version()
            .unwrap_or_else(|_| "unknown".to_string());
        let conn_id = self.next_conn_id.fetch_add(1, Ordering::SeqCst);
        let open_result = json!({
            "conn_id": conn_id,
            "server_info": {
                "version": version,
                "features": ["postgresql_compatible", "schemas", "catalogs"],
            }
        });

        Ok(OpenedConnection {
            conn_id,
            open_result,
            connection: Box::new(OpenGaussConnection {
                state: ConnectionState::new(session),
            }),
        })
    }

    fn call_connless(&self, method_name: &str, params: &Value) -> Result<Value, ProtocolError> {
        match method_name {
            method::CONN_TEST => handlers::handle_conn_test(params),
            method::DDL_BUILD
            | method::DDL_BUILD_CREATE_TABLE
            | method::DDL_BUILD_ALTER_TABLE
            | method::DDL_BUILD_DROP => handlers::handle_ddl_fallback(method_name, params),
            other => Err(method_not_found(other)),
        }
    }
}

pub struct OpenGaussConnection {
    state: ConnectionState,
}

impl DriverConnection for OpenGaussConnection {
    fn call(&mut self, method_name: &str, params: &Value) -> Result<Value, ProtocolError> {
        match method_name {
            method::CONN_PING => handlers::handle_conn_ping(&mut self.state, params),
            method::CONN_USE => handlers::handle_conn_use(&mut self.state, params),
            method::QUERY_START => handlers::handle_query_start(&mut self.state, params),
            method::CURSOR_FETCH => handlers::handle_cursor_fetch(&mut self.state, params),
            method::CURSOR_CLOSE => handlers::handle_cursor_close(&mut self.state, params),
            method::CURSOR_CANCEL => handlers::handle_cursor_cancel(&mut self.state, params),
            method::EXEC_RUN => handlers::handle_exec_run(&mut self.state, params),
            method::EXEC_BATCH => handlers::handle_exec_batch(&mut self.state, params),
            method::TX_BEGIN => handlers::handle_tx_begin(&mut self.state, params),
            method::TX_COMMIT => handlers::handle_tx_commit(&mut self.state, params),
            method::TX_ROLLBACK => handlers::handle_tx_rollback(&mut self.state, params),
            method::TX_SAVEPOINT => handlers::handle_tx_savepoint(&mut self.state, params),
            method::TX_RELEASE => handlers::handle_tx_release(&mut self.state, params),
            method::DATA_EXPORT => handlers::handle_data_export(&mut self.state, params),
            method::DATA_IMPORT_BEGIN => {
                handlers::handle_data_import_begin(&mut self.state, params)
            }
            method::DATA_IMPORT_CHUNK => {
                handlers::handle_data_import_chunk(&mut self.state, params)
            }
            method::DATA_IMPORT_COMMIT => {
                handlers::handle_data_import_commit(&mut self.state, params)
            }
            method::DATA_IMPORT_ABORT => {
                handlers::handle_data_import_abort(&mut self.state, params)
            }
            method::STREAM_READ => handlers::handle_stream_read(&mut self.state, params),
            method::STREAM_CLOSE => handlers::handle_stream_close(&mut self.state, params),
            handlers::SCHEMA_OBJECT_VIEW => {
                handlers::handle_schema_object_view(&mut self.state, params)
            }
            method::SCHEMA_DATABASES => handlers::handle_schema_databases(&mut self.state, params),
            method::SCHEMA_SCHEMAS => handlers::handle_schema_schemas(&mut self.state, params),
            method::SCHEMA_OBJECTS => handlers::handle_schema_objects(&mut self.state, params),
            method::SCHEMA_COLUMNS => handlers::handle_schema_columns(&mut self.state, params),
            method::SCHEMA_VIEWS => handlers::handle_schema_views(&mut self.state, params),
            method::SCHEMA_INDEXES => handlers::handle_schema_indexes(&mut self.state, params),
            method::SCHEMA_FOREIGN_KEYS => {
                handlers::handle_schema_foreign_keys(&mut self.state, params)
            }
            method::SCHEMA_CHECKS => handlers::handle_schema_checks(&mut self.state, params),
            method::SCHEMA_FUNCTIONS => handlers::handle_schema_functions(&mut self.state, params),
            method::SCHEMA_PROCEDURES => {
                handlers::handle_schema_procedures(&mut self.state, params)
            }
            method::SCHEMA_TRIGGERS => handlers::handle_schema_triggers(&mut self.state, params),
            method::SCHEMA_SEQUENCES => handlers::handle_schema_sequences(&mut self.state, params),
            method::SCHEMA_TYPES => handlers::handle_schema_types(&mut self.state, params),
            method::SCHEMA_VIEW_DEFINITION => {
                handlers::handle_schema_view_definition(&mut self.state, params)
            }
            method::SCHEMA_DUMP_DDL => handlers::handle_schema_dump_ddl(&mut self.state, params),
            method::DDL_BUILD
            | method::DDL_BUILD_CREATE_TABLE
            | method::DDL_BUILD_ALTER_TABLE
            | method::DDL_BUILD_DROP => handlers::handle_ddl_fallback(method_name, params),
            other => Err(method_not_found(other)),
        }
    }

    fn close(&mut self) {
        self.state.conn_mut().close();
    }
}

fn method_not_found(method_name: &str) -> ProtocolError {
    ProtocolError::new(
        error_codes::METHOD_NOT_FOUND,
        format!("method `{method_name}` is not implemented in OpenGauss driver"),
    )
}
