/**
 * Navop provider wire 协议类型。
 *
 * 与 `navop/crates/extension-protocol/src/*` 的 serde 结构一一对应，
 * 用于 Go/Rust 之外的 provider（Node、Python 等）实现 JSON-RPC 协议时
 * 获得类型提示。字段名 snake_case，序列化与 Rust 侧一致。
 */
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
export type RpcMessage<P = unknown, R = unknown> = RpcRequest<P> | RpcResponse<R>;
export declare const ErrorCodes: {
    readonly PARSE_ERROR: -32700;
    readonly INVALID_REQUEST: -32600;
    readonly METHOD_NOT_FOUND: -32601;
    readonly INVALID_PARAMS: -32602;
    readonly INTERNAL_ERROR: -32603;
    readonly NOT_INITIALIZED: -32001;
    readonly ALREADY_INITIALIZED: -32002;
    readonly API_VERSION_MISMATCH: -32003;
    readonly CAPABILITY_DISABLED: -32004;
    readonly REQUEST_TIMEOUT: -32005;
    readonly REQUEST_CANCELLED: -32006;
    readonly UNKNOWN_CONN_ID: -32007;
    readonly UNKNOWN_CURSOR_ID: -32008;
    readonly UNKNOWN_TX_ID: -32009;
    readonly UNKNOWN_IMPORT_ID: -32010;
    readonly RESOURCE_CLOSED: -32011;
    readonly RESOURCE_BUSY: -32012;
    readonly IO_CONNECTION_REFUSED: -33001;
    readonly IO_DNS_FAILURE: -33002;
    readonly IO_NETWORK_UNREACHABLE: -33003;
    readonly IO_TIMEOUT: -33004;
    readonly TLS_HANDSHAKE_FAILED: -33010;
    readonly SSH_TUNNEL_FAILED: -33020;
    readonly SERVER_CLOSED_CONNECTION: -33030;
    readonly SERVER_INCOMPATIBLE: -33031;
    readonly SQL_SYNTAX_ERROR: -34001;
    readonly SQL_CONSTRAINT_VIOLATION: -34010;
    readonly AUTH_FAILED: -35001;
    readonly PERMISSION_DENIED: -35002;
    /** 扩展自定义区间起点。 */
    readonly CUSTOM_RANGE_START: -39000;
    readonly CUSTOM_RANGE_END: -39999;
};
export declare const Methods: {
    readonly CANCEL_REQUEST: "$/cancelRequest";
    readonly PING: "$/ping";
    readonly INIT: "init";
    readonly SHUTDOWN: "shutdown";
    readonly CONN_TEST: "conn/test";
    readonly CONN_OPEN: "conn/open";
    readonly CONN_CLOSE: "conn/close";
    readonly CONN_PING: "conn/ping";
    readonly CONN_USE: "conn/use";
    readonly SCHEMA_DATABASES: "schema/databases";
    readonly SCHEMA_SCHEMAS: "schema/schemas";
    readonly SCHEMA_OBJECT_VIEW: "schema/object_view";
    readonly SCHEMA_OBJECTS: "schema/objects";
    readonly SCHEMA_USERS: "schema/users";
    readonly SCHEMA_COLUMNS: "schema/columns";
    readonly SCHEMA_INDEXES: "schema/indexes";
    readonly SCHEMA_FOREIGN_KEYS: "schema/foreign_keys";
    readonly SCHEMA_CHECKS: "schema/checks";
    readonly SCHEMA_VIEWS: "schema/views";
    readonly SCHEMA_FUNCTIONS: "schema/functions";
    readonly SCHEMA_PROCEDURES: "schema/procedures";
    readonly SCHEMA_TRIGGERS: "schema/triggers";
    readonly SCHEMA_SEQUENCES: "schema/sequences";
    readonly SCHEMA_TYPES: "schema/types";
    readonly SCHEMA_VIEW_DEFINITION: "schema/view_definition";
    readonly SCHEMA_DUMP_DDL: "schema/dump_ddl";
    readonly QUERY_START: "query/start";
    readonly CURSOR_FETCH: "cursor/fetch";
    readonly CURSOR_CANCEL: "cursor/cancel";
    readonly CURSOR_CLOSE: "cursor/close";
    readonly EXEC_RUN: "exec/run";
    readonly EXEC_BATCH: "exec/batch";
    readonly TX_BEGIN: "tx/begin";
    readonly TX_COMMIT: "tx/commit";
    readonly TX_ROLLBACK: "tx/rollback";
    readonly TX_SAVEPOINT: "tx/savepoint";
    readonly TX_RELEASE: "tx/release";
    readonly SQL_PARSE: "sql/parse";
    readonly SQL_FORMAT: "sql/format";
    readonly SQL_EXPLAIN: "sql/explain";
    readonly SQL_BUILD: "sql/build";
    readonly COMPLETION_PROVIDE: "completion/provide";
    readonly LINT_ANALYZE: "lint/analyze";
    readonly DDL_BUILD: "ddl/build";
    readonly DDL_BUILD_CREATE_TABLE: "ddl/build_create_table";
    readonly DDL_BUILD_ALTER_TABLE: "ddl/build_alter_table";
    readonly DDL_BUILD_DROP: "ddl/build_drop";
    readonly DATA_EXPORT: "data/export";
    readonly DATA_IMPORT_BEGIN: "data/import_begin";
    readonly DATA_IMPORT_CHUNK: "data/import_chunk";
    readonly DATA_IMPORT_COMMIT: "data/import_commit";
    readonly DATA_IMPORT_ABORT: "data/import_abort";
    readonly STREAM_READ: "stream/read";
    readonly STREAM_CLOSE: "stream/close";
    readonly BLOB_OPEN: "blob/open";
    readonly BLOB_READ: "blob/read";
    readonly BLOB_CLOSE: "blob/close";
    readonly EVENT_OPEN: "event/open";
    readonly EVENT_READ: "event/read";
    readonly EVENT_CLOSE: "event/close";
    readonly RESOURCE_OPEN: "resource/open";
    readonly RESOURCE_CLOSE: "resource/close";
    readonly RESOURCE_PING: "resource/ping";
    readonly RESOURCE_INVOKE: "resource/invoke";
    readonly JOB_START: "job/start";
    readonly JOB_STATUS: "job/status";
    readonly JOB_CANCEL: "job/cancel";
    readonly JOB_RESULT: "job/result";
    readonly JOB_CLOSE: "job/close";
    readonly REDIS_COMMAND: "redis/command";
    readonly REDIS_PIPELINE: "redis/pipeline";
    readonly REDIS_PUBSUB_OPEN: "redis/pubsub_open";
    readonly REDIS_PUBSUB_CONTROL: "redis/pubsub_control";
    readonly MONGODB_COMMAND: "mongodb/command";
    readonly MONGODB_FIND: "mongodb/find";
    readonly MONGODB_CURSOR_GET_MORE: "mongodb/cursor_get_more";
    readonly MONGODB_CURSOR_CLOSE: "mongodb/cursor_close";
    readonly HOST_RESOLVE_SECRET: "host/secret/resolve";
    readonly HOST_REQUEST_CREDENTIAL: "host/request_credential";
    readonly HOST_NOTIFY: "host/notify";
};
/** init 响应可声明的 capability 字符串（lifecycle.rs Capability）。 */
export declare const Capabilities: {
    readonly STREAMING: "streaming";
    readonly CANCEL_REQUEST: "cancel_request";
    readonly NAMED_PARAMS: "named_params";
    readonly RICH_ERRORS: "rich_errors";
    readonly TRANSACTIONS: "transactions";
    readonly NESTED_TRANSACTIONS: "nested_transactions";
    readonly BATCH_EXEC: "batch_exec";
    readonly DATA_PIPE: "data_pipe";
    readonly SQL_TOOLS: "sql_tools";
    readonly COMPLETION: "completion";
    readonly LINT: "lint";
    readonly DDL_BUILDER: "ddl_builder";
    readonly SCHEMA_INTROSPECTION: "schema_introspection";
    readonly SSH_TUNNEL: "ssh_tunnel";
    readonly SERVER_CURSOR: "server_cursor";
};
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
/** invoke 结果引用：小结果 inline，大结果 blob，持续事件 event_stream。 */
export type ResultRef = {
    kind: 'inline';
    value: unknown;
} | {
    kind: 'blob';
    id: string;
} | {
    kind: 'event_stream';
    id: string;
};
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
export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
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
export declare const EventLimits: {
    readonly DEFAULT_MAX_EVENTS: 128;
    readonly MAX_MAX_EVENTS: 1024;
};
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
export declare const BlobLimits: {
    readonly INLINE_THRESHOLD_BYTES: number;
    readonly DEFAULT_CHUNK_BYTES: number;
    readonly MAX_CHUNK_BYTES: number;
};
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
export interface NotifyResult {
}
