/**
 * Navop provider wire 协议类型。
 *
 * 与 `navop/crates/extension-protocol/src/*` 的 serde 结构一一对应，
 * 用于 Go/Rust 之外的 provider（Node、Python 等）实现 JSON-RPC 协议时
 * 获得类型提示。字段名 snake_case，序列化与 Rust 侧一致。
 */

// ---------------------------------------------------------------------------
// envelope（JSON-RPC 2.0）
// ---------------------------------------------------------------------------

export type RequestId = number | string | null;

export interface RpcRequest<P = unknown> {
  jsonrpc: '2.0';
  id?: RequestId;
  method: string;
  params?: P;
}

export interface RpcResponse<R = unknown> {
  jsonrpc: '2.0';
  id: RequestId;
  result?: R;
  error?: RpcError;
}

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type RpcMessage<P = unknown, R = unknown> =
  | RpcRequest<P>
  | RpcResponse<R>;

// ---------------------------------------------------------------------------
// 错误码（extension-protocol/src/error.rs）
// ---------------------------------------------------------------------------

export const ErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  NOT_INITIALIZED: -32001,
  ALREADY_INITIALIZED: -32002,
  API_VERSION_MISMATCH: -32003,
  CAPABILITY_DISABLED: -32004,
  REQUEST_TIMEOUT: -32005,
  REQUEST_CANCELLED: -32006,
  UNKNOWN_CONN_ID: -32007,
  UNKNOWN_CURSOR_ID: -32008,
  UNKNOWN_TX_ID: -32009,
  UNKNOWN_IMPORT_ID: -32010,
  RESOURCE_CLOSED: -32011,
  RESOURCE_BUSY: -32012,

  IO_CONNECTION_REFUSED: -33001,
  IO_DNS_FAILURE: -33002,
  IO_NETWORK_UNREACHABLE: -33003,
  IO_TIMEOUT: -33004,
  TLS_HANDSHAKE_FAILED: -33010,
  SSH_TUNNEL_FAILED: -33020,
  SERVER_CLOSED_CONNECTION: -33030,
  SERVER_INCOMPATIBLE: -33031,

  SQL_SYNTAX_ERROR: -34001,
  SQL_CONSTRAINT_VIOLATION: -34010,

  AUTH_FAILED: -35001,
  PERMISSION_DENIED: -35002,

  /** 扩展自定义区间起点。 */
  CUSTOM_RANGE_START: -39000,
  CUSTOM_RANGE_END: -39999,
} as const;

// ---------------------------------------------------------------------------
// method 名（extension-protocol/src/method.rs）
// ---------------------------------------------------------------------------

export const Methods = {
  CANCEL_REQUEST: '$/cancelRequest',
  PING: '$/ping',

  INIT: 'init',
  SHUTDOWN: 'shutdown',

  CONN_TEST: 'conn/test',
  CONN_OPEN: 'conn/open',
  CONN_CLOSE: 'conn/close',
  CONN_PING: 'conn/ping',
  CONN_USE: 'conn/use',

  SCHEMA_DATABASES: 'schema/databases',
  SCHEMA_SCHEMAS: 'schema/schemas',
  SCHEMA_OBJECT_VIEW: 'schema/object_view',
  SCHEMA_OBJECTS: 'schema/objects',
  SCHEMA_USERS: 'schema/users',
  SCHEMA_COLUMNS: 'schema/columns',
  SCHEMA_INDEXES: 'schema/indexes',
  SCHEMA_FOREIGN_KEYS: 'schema/foreign_keys',
  SCHEMA_CHECKS: 'schema/checks',
  SCHEMA_VIEWS: 'schema/views',
  SCHEMA_FUNCTIONS: 'schema/functions',
  SCHEMA_PROCEDURES: 'schema/procedures',
  SCHEMA_TRIGGERS: 'schema/triggers',
  SCHEMA_SEQUENCES: 'schema/sequences',
  SCHEMA_TYPES: 'schema/types',
  SCHEMA_VIEW_DEFINITION: 'schema/view_definition',
  SCHEMA_DUMP_DDL: 'schema/dump_ddl',

  QUERY_START: 'query/start',
  CURSOR_FETCH: 'cursor/fetch',
  CURSOR_CANCEL: 'cursor/cancel',
  CURSOR_CLOSE: 'cursor/close',

  EXEC_RUN: 'exec/run',
  EXEC_BATCH: 'exec/batch',

  TX_BEGIN: 'tx/begin',
  TX_COMMIT: 'tx/commit',
  TX_ROLLBACK: 'tx/rollback',
  TX_SAVEPOINT: 'tx/savepoint',
  TX_RELEASE: 'tx/release',

  SQL_PARSE: 'sql/parse',
  SQL_FORMAT: 'sql/format',
  SQL_EXPLAIN: 'sql/explain',
  SQL_BUILD: 'sql/build',

  COMPLETION_PROVIDE: 'completion/provide',
  LINT_ANALYZE: 'lint/analyze',

  DDL_BUILD: 'ddl/build',
  DDL_BUILD_CREATE_TABLE: 'ddl/build_create_table',
  DDL_BUILD_ALTER_TABLE: 'ddl/build_alter_table',
  DDL_BUILD_DROP: 'ddl/build_drop',

  DATA_EXPORT: 'data/export',
  DATA_IMPORT_BEGIN: 'data/import_begin',
  DATA_IMPORT_CHUNK: 'data/import_chunk',
  DATA_IMPORT_COMMIT: 'data/import_commit',
  DATA_IMPORT_ABORT: 'data/import_abort',
  STREAM_READ: 'stream/read',
  STREAM_CLOSE: 'stream/close',

  BLOB_OPEN: 'blob/open',
  BLOB_READ: 'blob/read',
  BLOB_CLOSE: 'blob/close',

  EVENT_OPEN: 'event/open',
  EVENT_READ: 'event/read',
  EVENT_CLOSE: 'event/close',

  RESOURCE_OPEN: 'resource/open',
  RESOURCE_CLOSE: 'resource/close',
  RESOURCE_PING: 'resource/ping',
  RESOURCE_INVOKE: 'resource/invoke',

  JOB_START: 'job/start',
  JOB_STATUS: 'job/status',
  JOB_CANCEL: 'job/cancel',
  JOB_RESULT: 'job/result',
  JOB_CLOSE: 'job/close',

  REDIS_COMMAND: 'redis/command',
  REDIS_PIPELINE: 'redis/pipeline',
  REDIS_PUBSUB_OPEN: 'redis/pubsub_open',
  REDIS_PUBSUB_CONTROL: 'redis/pubsub_control',

  MONGODB_COMMAND: 'mongodb/command',
  MONGODB_FIND: 'mongodb/find',
  MONGODB_CURSOR_GET_MORE: 'mongodb/cursor_get_more',
  MONGODB_CURSOR_CLOSE: 'mongodb/cursor_close',

  HOST_RESOLVE_SECRET: 'host/secret/resolve',
  HOST_REQUEST_CREDENTIAL: 'host/request_credential',
  HOST_NOTIFY: 'host/notify',
} as const;

/** init 响应可声明的 capability 字符串（lifecycle.rs Capability）。 */
export const Capabilities = {
  STREAMING: 'streaming',
  CANCEL_REQUEST: 'cancel_request',
  NAMED_PARAMS: 'named_params',
  RICH_ERRORS: 'rich_errors',
  TRANSACTIONS: 'transactions',
  NESTED_TRANSACTIONS: 'nested_transactions',
  BATCH_EXEC: 'batch_exec',
  DATA_PIPE: 'data_pipe',
  SQL_TOOLS: 'sql_tools',
  COMPLETION: 'completion',
  LINT: 'lint',
  DDL_BUILDER: 'ddl_builder',
  SCHEMA_INTROSPECTION: 'schema_introspection',
  SSH_TUNNEL: 'ssh_tunnel',
  SERVER_CURSOR: 'server_cursor',
} as const;

// ---------------------------------------------------------------------------
// 生命周期（lifecycle.rs）
// ---------------------------------------------------------------------------

/** `init` 请求参数（host → provider）。 */
export interface InitParams {
  host_version: string;
  api_offered: Record<string, string>;
  instance_id: string;
  config?: InitConfig;
}

export interface InitConfig {
  log_level?: string;
  workspace?: string;
  locale?: string;
  extra?: unknown;
}

/** `init` 响应（provider → host）。`methods` 为权威能力声明。 */
export interface InitResult {
  extension_version: string;
  api_used: Record<string, string>;
  features?: string[];
  /** 实际实现的 wire method 全名列表，如 `resource/invoke`。 */
  methods?: string[];
  drivers_ready?: string[];
  extra?: unknown;
}

/** `shutdown` 请求参数。 */
export interface ShutdownParams {
  /** 默认 30000；超时后宿主 SIGKILL。 */
  grace_ms?: number;
}

// ---------------------------------------------------------------------------
// 通用资源（resource.rs / result_ref.rs）
// ---------------------------------------------------------------------------

/** invoke 结果引用：小结果 inline，大结果 blob，持续事件 event_stream。 */
export type ResultRef =
  | { kind: 'inline'; value: unknown }
  | { kind: 'blob'; id: string }
  | { kind: 'event_stream'; id: string };

/** `resource/open` 参数。config 内 secret 为 `secret://self/...` 引用。 */
export interface ResourceOpenParams {
  resource_type: string;
  config: Record<string, unknown>;
  metadata?: unknown;
}

export interface ResourceOpenResult {
  resource_id: string;
  capabilities?: string[];
  metadata?: unknown;
}

export interface ResourcePingParams {
  resource_id: string;
}

export interface ResourceInvokeParams {
  resource_id: string;
  /** 领域 namespaced method，如 `my-provider/item/list`。 */
  method: string;
  params?: unknown;
}

export interface ResourceInvokeResult {
  result: ResultRef;
}

export interface ResourceCloseParams {
  resource_id: string;
}

// ---------------------------------------------------------------------------
// Job（job.rs）
// ---------------------------------------------------------------------------

export type JobState =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface JobStartParams {
  resource_id?: string;
  method: string;
  params?: unknown;
}

export interface JobStartResult {
  job_id: string;
  state: JobState;
}

export interface JobStatusParams {
  job_id: string;
}

export interface JobStatusResult {
  job_id: string;
  state: JobState;
  progress_percent?: number;
  message?: string;
}

export interface JobCancelParams {
  job_id: string;
}

export interface JobResultParams {
  job_id: string;
}

export interface JobResultResult {
  result: ResultRef;
}

export interface JobCloseParams {
  job_id: string;
}

// ---------------------------------------------------------------------------
// Event stream（event_stream.rs）
// ---------------------------------------------------------------------------

export const EventLimits = {
  DEFAULT_MAX_EVENTS: 128,
  MAX_MAX_EVENTS: 1024,
} as const;

export interface EventOpenParams {
  conn_id?: number;
  kind: string;
  /** 默认 128，上限 1024。 */
  capacity?: number;
}

export interface EventOpenResult {
  stream_id: string;
}

export interface EventReadParams {
  stream_id: string;
  max_events?: number;
  wait_ms?: number;
}

export interface EventReadResult {
  events: unknown[];
  closed: boolean;
  dropped_count: number;
}

export interface EventCloseParams {
  stream_id: string;
}

// ---------------------------------------------------------------------------
// Blob（blob.rs）
// ---------------------------------------------------------------------------

export const BlobLimits = {
  INLINE_THRESHOLD_BYTES: 4 * 1024 * 1024,
  DEFAULT_CHUNK_BYTES: 256 * 1024,
  MAX_CHUNK_BYTES: 4 * 1024 * 1024,
} as const;

export interface BlobOpenParams {
  /** 字节数；wire 上按 WireBytes 编码。 */
  len: unknown;
}

export interface BlobReadParams {
  blob_id: string;
  max_bytes?: number;
}

/** `data` 为 Base64 string。 */
export interface BlobReadResult {
  data: string;
  bytes_read: number;
  done: boolean;
}

export interface BlobCloseParams {
  blob_id: string;
}

// ---------------------------------------------------------------------------
// Host 反向调用（host.rs / conn.rs）
// ---------------------------------------------------------------------------

/** 凭证引用。前缀：`kss://` secret store、`env://` 环境变量、`inline:base64(...)` 测试。 */
export interface SecretRef {
  secret_ref: string;
}

/** `host/secret/resolve` 参数。 */
export interface ResolveSecretParams {
  secret_ref: SecretRef;
}

/** `value` 为 Base64 编码 bytes。 */
export interface ResolveSecretResult {
  value: string;
}

export type NotifyLevel = 'info' | 'warning' | 'error' | 'success';

export interface NotifyParams {
  level: NotifyLevel;
  title: string;
  body?: string;
  duration_ms?: number;
  actions?: NotifyAction[];
}

export interface NotifyAction {
  id: string;
  label: string;
  primary?: boolean;
}

export interface NotifyResult {}
