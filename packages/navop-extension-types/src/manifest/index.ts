/**
 * Navop extension.json manifest 类型（schema_version 1）。
 *
 * 字段与 `navop/crates/extension-runtime/src/extension/manifest/` 的 Rust
 * 反序列化结构一一对应；Rust 侧未标 `deny_unknown_fields` 的 section 宽松，
 * 标了 `deny_unknown_fields` 的（shellViews、connections）严格。
 */

/** manifest 顶层。 */
export interface NavopExtensionManifest {
  schema_version: number;
  id: string;
  name: string;
  version: string;
  publisher?: string;
  license?: string;
  homepage?: string;
  repository?: string;
  icon?: string;
  /** i18n 描述文件路径，如 `locales/description.json`。 */
  description_i18n?: string;
  description?: string;
  categories?: string[];
  keywords?: string[];
  engines: Engines;
  api?: ApiVersions;
  /** 激活事件，如 `onConnection:my-resource`。 */
  activation?: string[];
  /** 权限声明，如 `spawn:./bin/provider`、`net:tcp:*:9200`、`secrets:read:self.*`、`shell:exec`。 */
  permissions?: string[];
  runtime?: RuntimeSection;
  contributes?: ContributesManifest;
}

export interface Engines {
  /** 宿主版本约束，如 `>=0.15.2`。 */
  onetcli: string;
  /** gpui-shell 兼容版本，如 `0.2.0`。 */
  gpui_shell?: string;
}

export interface ApiVersions {
  extension?: string;
  database?: string;
  ui?: string;
  task?: string;
  connection?: string;
  shell?: string;
}

// ---------------------------------------------------------------------------
// runtime
// ---------------------------------------------------------------------------

export interface RuntimeSection {
  ipc?: IpcRuntime[];
  wasm?: WasmRuntime[];
}

export interface IpcRuntime {
  id: string;
  entry: IpcEntry;
  transport?: IpcTransport;
  /** 默认 true。 */
  auto_restart?: boolean;
  /** 默认 3。 */
  max_restart_attempts?: number;
  /** 默认 30000。 */
  shutdown_grace_ms?: number;
}

export interface IpcEntry {
  command: string;
  args?: string[];
  working_dir?: string;
  env?: Record<string, string>;
}

export interface IpcTransport {
  /** 默认 `local_socket`。 */
  kind?: string;
  connect_timeout_ms?: number;
}

export interface WasmRuntime {
  id: string;
  module: string;
  /** 目前仅 `component`。 */
  kind: 'component';
  /** 默认 5000。 */
  timeout_ms?: number;
  /** 默认 64。 */
  max_memory_mb?: number;
  /** 默认 100000000。 */
  fuel_per_call?: number;
}

// ---------------------------------------------------------------------------
// contributes
// ---------------------------------------------------------------------------

export interface ContributesManifest {
  languages?: LanguageContrib[];
  connectionImporters?: ConnectionImporterContrib[];
  /** 驱动贡献（database_driver 形态，当前为自由 JSON）。 */
  drivers?: unknown[];
  connections?: ResourceConnectionContrib[];
  commands?: CommandContrib[];
  /** key 为菜单位置（如 `connection/context`），value 为菜单项。 */
  menus?: Record<string, MenuContrib[]>;
  /** key 为工具栏位置，value 为工具栏项。 */
  toolbars?: Record<string, ToolbarContrib[]>;
  keybindings?: KeybindingContrib[];
  htmlPreviewTransforms?: HtmlPreviewTransformContrib[];
  documentRenderers?: DocumentRendererContrib[];
  documentExporters?: DocumentExporterContrib[];
  remoteFileEditors?: RemoteFileEditorContrib[];
  shellViews?: ShellViewContrib[];
  views?: unknown[];
  tasks?: unknown[];
  data_types?: unknown[];
  sidebar?: unknown[];
  tabs?: unknown[];
  forms?: unknown[];
  transforms?: unknown[];
  completions?: unknown[];
  themes?: unknown[];
  icons?: unknown[];
}

// -- shell 视图（deny_unknown_fields：多余字段会被 parser 拒绝） --

/** `tab`：普通 tab 视图；`toolbox`：工具箱页聚合的小工具卡片。 */
export type ShellSurface = 'tab' | 'toolbox';
export type ShellHostModule =
  | 'context'
  | 'resource'
  | 'job'
  | 'event'
  | 'blob'
  | 'log'
  | 'runtime';

export interface ShellViewContrib {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  /** 入口脚本路径，如 `ui/explorer.js`。 */
  entry: string;
  /** 默认 `tab`。 */
  surface?: ShellSurface;
  /** 独立工具页建议 true；连接关联视图必须 false。 */
  singleton?: boolean;
  /** alias → runtimeId 映射；toolbox 视图也可声明后端（工具自建资源）。 */
  backends?: Record<string, string>;
  /** 声明注入的 navop.* host 模块。 */
  modules?: ShellHostModule[];
  /** toolbox 专用：卡片分类（如 `text`、`network`、`system`）。 */
  category?: string;
  /** toolbox 专用：搜索关键词，补充 title/description 匹配。 */
  keywords?: string[];
}

// -- 连接（deny_unknown_fields） --

export interface ResourceConnectionContrib {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  /** 指向 runtime.ipc[].id。 */
  runtimeId: string;
  /** 传给 provider resource/open 的资源类型。 */
  resourceType: string;
  /** 关联 shellView id；无 UI 连接省略。 */
  shellViewId?: string;
  form?: ResourceConnectionForm;
}

export interface ResourceConnectionForm {
  tabs?: ResourceConnectionFormTab[];
}

export interface ResourceConnectionFormTab {
  id: string;
  label: string;
  fields?: ResourceConnectionFormField[];
}

export type ResourceConnectionFieldType =
  | 'Text'
  | 'Number'
  | 'Password'
  | 'TextArea'
  | 'Select'
  | 'Checkbox';

export interface ResourceConnectionFormField {
  id: string;
  label: string;
  fieldType: ResourceConnectionFieldType;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  /** Password 专用；secret 字段不能有非空 defaultValue。 */
  secret?: boolean;
  /** Select 专用；value 必须唯一。 */
  options?: ResourceConnectionSelectOption[];
  /** 引用的字段必须存在；多条按 AND。 */
  visibleWhen?: ResourceConnectionVisibilityRule[];
}

export interface ResourceConnectionSelectOption {
  value: string;
  label: string;
}

export interface ResourceConnectionVisibilityRule {
  field: string;
  equals: string;
}

// -- 连接导入器 --

export interface ConnectionImporterContrib {
  id: string;
  runtimeId?: string;
  displayName: string;
  description?: string;
  icon?: string;
  outputKinds?: string[];
  platforms?: string[];
  manualFilePick?: ManualFilePickContrib;
  candidateFiles?: CandidateFileContrib[];
}

export interface ManualFilePickContrib {
  prompt?: string;
  supportsDirectories?: boolean;
  directoryPrompt?: string;
}

export interface CandidateFileContrib {
  id: string;
  platform?: string;
  path: string;
}

// -- 语言 --

export interface LanguageContrib {
  id: string;
  name: string;
  path?: string;
  file_extensions?: string[];
}

// -- 命令 / 菜单 / 工具栏 / 快捷键 --

export interface CommandContrib {
  id: string;
  title?: string;
  category?: string;
  icon?: string;
  enablement_when?: string;
  handler: CommandHandlerContrib;
}

export interface CommandHandlerContrib {
  /** `builtin`（默认）或 runtime id。 */
  kind?: string;
  runtime_id?: string;
  /** 默认 `invoke`。 */
  function?: string;
}

export interface MenuContrib {
  command: string | MenuCommandRef;
  label?: string;
  group?: string;
  /** 表达式，如 `connection.active`。 */
  when?: string;
  /** 默认 true。 */
  requires_active?: boolean;
}

/** 菜单命令引用；JSON 里直接写命令 id 字符串。 */
export interface MenuCommandRef {
  id: string;
}

export interface ToolbarContrib {
  command: string | MenuCommandRef;
  label?: string;
  group?: string;
  when?: string;
  text_when?: string;
  icon_only?: boolean;
  priority?: number;
}

export interface KeybindingContrib {
  command: string;
  key: string;
  mac?: string;
  linux?: string;
  windows?: string;
  when?: string;
}

// -- 文档渲染 / 导出 / HTML 预览 --

export interface DocumentRendererContrib {
  id: string;
  displayName: string;
  runtimeId?: string;
  /** 默认 `render-document`。 */
  function?: string;
  blockKinds?: string[];
  outputMediaTypes?: string[];
  priority?: number;
}

export interface DocumentExporterContrib {
  id: string;
  displayName: string;
  runtimeId?: string;
  /** 默认 `export-document`。 */
  function?: string;
  formats?: string[];
  outputMediaTypes?: string[];
  priority?: number;
}

export interface HtmlPreviewTransformContrib {
  id: string;
  runtimeId?: string;
  /** 默认 `transform-html`。 */
  function?: string;
  languages?: string[];
  assets?: string;
}

// -- 远程文件编辑器 --

export type RemoteFileEditorLaunchMode = 'direct' | 'macos_open';

export interface RemoteFileEditorContrib {
  id: string;
  displayName: string;
  platforms?: string[];
  fileMasks?: string[];
  priority?: number;
  command: RemoteFileEditorCommandContrib;
}

export interface RemoteFileEditorCommandContrib {
  /** 默认 `direct`；macOS .app 应用用 `macos_open`。 */
  launchMode?: RemoteFileEditorLaunchMode;
  programCandidates?: string[];
  args?: string[];
}
