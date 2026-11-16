// navop 宿主能力面：nsh 的 nativeModule（"navop" UI set）。
//
// 与 `host.call` 的区别：这是 nsh 的**强类型**宿主机制——宿主用
// `#[module]` 实现 Rust 方法、以 UI set 注册（`set_ui_sets`），页面用
// `nativeModule<T>("navop")` 拿到对象。普通函数同步返回，`async` 的返回
// Promise；参数类型不对是 `TypeError`，能力没声明是调用时的
// `PERMISSION_DENIED`（消息里带模块名）。
//
// 清单侧仍然写 `contributes.shellApp.modules: ["db", "ui", ...]`：宿主在
// 每个模块方法入口用同一份清单校验（nativeModule 本身不做鉴权）。

import { nativeModule } from "nsh";

// 通知级别与 `./api` 的 `NotifyLevel` 是同一个类型；只在 api 里定义一次。
import type { NotifyLevel } from "./api";

/** 元数据调用的数据源：给会话句柄，或直接给连接。 */
export type DbSource = {
  sessionId?: string;
  connectionId?: number | string;
  database?: string;
  schema?: string;
};

/** 表/视图元数据（`Db.listTables` 的条目）。 */
export type DbTable = {
  name: string;
  /** `table` / `view` / `foreign_table`。 */
  kind: string;
  schema: string | null;
  comment: string | null;
  engine: string | null;
  charset: string | null;
  collation: string | null;
};

/** 列元数据。 */
export type DbColumnMetadata = {
  name: string;
  typeName: string;
  nullable: boolean;
  primaryKey: boolean;
  autoIncrement: boolean;
  defaultValue: string | null;
  comment: string | null;
  charset: string | null;
  collation: string | null;
};

/** 索引元数据。 */
export type DbIndex = {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
  typeName: string | null;
};

/** 外键元数据。 */
export type DbForeignKey = {
  name: string;
  columns: string[];
  refTable: string;
  refSchema: string | null;
  refColumns: string[];
  onDelete: string;
  onUpdate: string;
};

/** 一张表的完整描述。 */
export type DbTableDescription = {
  columns: DbColumnMetadata[];
  indexes: DbIndex[];
  foreignKeys: DbForeignKey[];
};

/** 函数/过程元数据。 */
export type DbFunction = {
  name: string;
  schema: string | null;
  returnType: string | null;
  parameters: string[];
  identityArguments: string | null;
  definition: string | null;
  comment: string | null;
};

export type NativeDbModule = {
  /** 列连接（需要 `db:connections:list`）。 */
  listConnections(): Promise<{ connections: unknown[] }>;
  /** 开会话；返回不透明句柄。 */
  openSession(options: {
    connectionId: number | string;
    database?: string;
  }): Promise<{ sessionId: string }>;
  /** 执行 SQL；读写分级由宿主按语句判定。 */
  execute(options: {
    sessionId: string;
    sql: string;
    maxRows?: number;
  }): Promise<unknown>;
  listDatabases(options?: DbSource): Promise<{ databases: string[] }>;
  listSchemas(options: DbSource & { database: string }): Promise<{
    schemas: string[];
  }>;
  /** 表与视图（元数据，只读；需要 `db:schema:<conn>`）。 */
  listTables(options?: DbSource): Promise<{ tables: DbTable[] }>;
  /** 一张表的列、索引、外键（一次会话取全）。 */
  describeTable(options: DbSource & { table: string }): Promise<DbTableDescription>;
  /** 库里的函数/过程。 */
  listFunctions(options?: DbSource): Promise<{ functions: DbFunction[] }>;
  closeSession(options: { sessionId: string }): Promise<{ ok: boolean }>;
  /** 刷新宿主里已打开的 DB 树；`refreshed` 是刷新的连接根数量。 */
  refreshTree(options?: { connectionId?: number | string }): Promise<{
    ok: boolean;
    refreshed: number;
  }>;
};

/** `Terminal.exec` 的结果：把命令打进活动终端后的输出与退出码。 */
export type TerminalExecResult = {
  sessionId: string;
  command: string;
  /** 命令是否已提交（`submit: false` 只写入不回车）。 */
  submitted: boolean;
  /**
   * 结束方式：`observed_output`（等到输出静止）/ `shell_integration_exit`
   * （shell 集成报了退出码）/ `submitted_only`（不等输出）/
   * `timed_out`（超时）。
   */
  completion: "observed_output" | "shell_integration_exit" | "submitted_only" | "timed_out";
  exitCode: number | null;
  output: string;
  truncated: boolean;
  capturedBytes: number;
  discardedBytes: number;
  durationMs: number;
  commandId: string | null;
};

/** `Terminal.sshExec` 的结果：一次独立的远端命令调用。 */
export type TerminalSshExecResult = {
  sessionId: string;
  status: "running" | "exited" | "failed" | "cancel_requested" | "cancelled" | "timed_out";
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  /** 后台模式下用它轮询输出。 */
  commandId: string | null;
  startedAtMs: number | null;
};

export type NativeTerminalModule = {
  list(): Promise<{ sessions: unknown[] }>;
  read(options?: { sessionId?: string; lines?: number }): Promise<unknown>;
  write(options: { text: string; sessionId?: string }): Promise<{
    sessionId: string;
    sent: boolean;
    bytes: number;
  }>;
  /** 等输出变化（宿主侧长轮询）。 */
  wait(options?: {
    sessionId?: string;
    previous?: string;
    lines?: number;
    timeoutMs?: number;
  }): Promise<unknown>;
  /** 往活动终端里执行一条命令并等输出（经过用户 shell，支持 SSH 终端）。 */
  exec(options: {
    command: string;
    /** 缺省取第一个已连接的会话。 */
    sessionId?: string;
    /** 默认 true；false 只写入不回车。 */
    submit?: boolean;
    /** 默认 true；false 只提交不等输出。 */
    waitForOutput?: boolean;
    readyTimeoutMs?: number;
    timeoutMs?: number;
  }): Promise<TerminalExecResult>;
  /** 在 SSH 会话上执行命令（stdout/stderr 分开，可后台运行）。 */
  sshExec(options: {
    sessionId: string;
    command: string;
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
    /** 默认 foreground。 */
    mode?: "foreground" | "background";
  }): Promise<TerminalSshExecResult>;
};

export type NativeUiModule = {
  notify(options: {
    level?: NotifyLevel;
    title: string;
    message?: string;
  }): Promise<{ ok: boolean }>;
};

export type NativeAppModule = {
  open(options?: {
    extensionId?: string;
    route?: string;
    context?: Record<string, unknown>;
  }): Promise<{ ok: boolean }>;
};

export type NavopNative = {
  Db: NativeDbModule;
  Terminal: NativeTerminalModule;
  Ui: NativeUiModule;
  App: NativeAppModule;
};

/** UI set 的名字；宿主侧 `native_api::UI_SET` 与之对应。 */
export const NATIVE_SPECIFIER = "navop";

let cached: NavopNative | null = null;

/**
 * 取 navop 的能力面。首次调用时向 nsh 解析（未装 UI set 会抛
 * `ReferenceError`）；之后复用同一个对象。
 */
export function navopNative(): NavopNative {
  if (cached === null) cached = nativeModule<NavopNative>(NATIVE_SPECIFIER);
  return cached;
}
