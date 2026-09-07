/**
 * Navop gpui-shell UI 模块声明（`navop.*`）。
 *
 * 这些模块由 Navop 宿主注册到 gpui-shell 运行时，声明来源为
 * `navop/crates/universal-plugins/src/shell_plugin_host/*.rs` 中每个
 * HostModule 的 `.declarations()` 字符串。`gpui` / `gpui-base` /
 * `gpui-component` 由 gpui-shell 自带的 `gpui-kit.d.ts` 生成，本包不重复
 * 声明，仅提供 navop 扩展面。
 */

/**
 * Mount context（`navop.context`）。
 *
 * `resource.handle` 是 mount-scoped opaque handle：不能跨 tab、跨 reload
 * 或跨 provider generation 保存使用。
 */
declare module 'navop.context' {
  export interface ShellResource {
    handle: string;
    capabilities: string[];
    metadata: unknown;
  }

  export interface ShellConnection {
    id: number;
    name: string;
    contributionId: string;
    resourceType: string;
    resource: ShellResource;
  }

  export interface ShellViewContext {
    extensionId: string;
    viewId: string;
    backends: string[];
    connection: ShellConnection | null;
  }

  /** 当前 mount 的连接 context；独立 shell 页面返回 `connection: null`。 */
  export function current(): ShellViewContext;
}

/**
 * 资源调用（`navop.resource`）。
 *
 * 连接主 UI 应使用 Host 注入的 `context.connection.resource.handle`；
 * `open` 仅供独立工具页创建额外资源。
 */
declare module 'navop.resource' {
  export type ResultRef =
    | { kind: 'inline'; value: unknown }
    | { kind: 'blob'; handle: string }
    | { kind: 'event_stream'; handle: string };

  export interface ResourceHandleInfo {
    handle: string;
    capabilities: string[];
    metadata: unknown;
  }

  export function open(
    backend: string,
    resourceType: string,
    config: unknown,
  ): Promise<ResourceHandleInfo>;

  export function invoke(
    handle: string,
    method: string,
    params?: unknown,
  ): Promise<ResultRef>;

  export function ping(handle: string): Promise<void>;

  export function close(handle: string): Promise<void>;
}

/** 可取消长任务（`navop.job`）。 */
declare module 'navop.job' {
  export type JobState =
    | 'queued'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'cancelled';

  export interface JobStartResult {
    handle: string;
    state: JobState;
  }

  export interface JobStatusResult {
    state: JobState;
    progressPercent?: number;
    message?: string;
  }

  export function start(
    resource: string,
    method: string,
    params?: unknown,
  ): Promise<JobStartResult>;

  export function status(handle: string): Promise<JobStatusResult>;

  export function cancel(handle: string): Promise<void>;

  /** 返回 `ResultRef`（见 `navop.resource`）。 */
  export function result(handle: string): Promise<unknown>;

  export function close(handle: string): Promise<void>;
}

/** 有界事件流（`navop.event`）。 */
declare module 'navop.event' {
  export interface EventOpenResult {
    handle: string;
  }

  export interface EventReadResult {
    events: unknown[];
    closed: boolean;
    droppedCount: number;
  }

  export function open(
    resource: string,
    kind: string,
    capacity?: number,
  ): Promise<EventOpenResult>;

  export function read(
    handle: string,
    maxEvents?: number,
    waitMs?: number,
  ): Promise<EventReadResult>;

  export function close(handle: string): Promise<void>;
}

/**
 * Blob 读取（`navop.blob`）。
 *
 * `read` 返回 Base64 string，UI 自己解码。单次 maxBytes 上限 4 MiB；
 * 读到 `done: true` 后仍应显式 close。
 */
declare module 'navop.blob' {
  export interface BlobReadResult {
    /** Base64 编码字节。 */
    data: string;
    bytesRead: number;
    done: boolean;
  }

  export function read(
    handle: string,
    maxBytes?: number,
  ): Promise<BlobReadResult>;

  export function close(handle: string): Promise<void>;
}

/**
 * 运行时信息（`navop.runtime`）。
 *
 * `generation` 为 provider 重启代数：provider restart 后旧 handle 全部失效，
 * 页面进入失败态，需用户重新打开连接。
 */
declare module 'navop.runtime' {
  export interface RuntimeInfo {
    backend: string;
    runtimeId: string;
    generation: number;
  }

  export function info(backend: string): RuntimeInfo;
}

/** 日志（`navop.log`）。单条上限 16 KiB；不要输出 secret 或未脱敏 config。 */
declare module 'navop.log' {
  export function debug(message: string): void;
  export function info(message: string): void;
  export function warn(message: string): void;
  export function error(message: string): void;
}

/**
 * 开发者工具（`navop.dev`）。仅 `modules: ["dev"]` 的 shell view 可用；
 * 操作 main 层 DevExtensionRegistry（本地工程目录加载/卸载/视图打开）。
 */
declare module 'navop.dev' {
  export interface DevViewInfo {
    id: string;
    title: string;
    surface: string;
    category?: string;
  }

  export interface DevProjectInfo {
    root: string;
    id: string;
    name: string;
    version: string;
    error?: string;
    views: DevViewInfo[];
  }

  export function list(): DevProjectInfo[];

  export function open(rootDir: string): { id: string; error?: string };

  export function remove(rootDir: string): void;

  export function openView(extensionId: string, viewId: string): void;

  export function logs(rootDir: string, tail?: number): string[];
}
