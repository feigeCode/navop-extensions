# Navop 如何复用 GPUI Shell

本文件只补充产品约束。通用分层、状态/上下文和组件注册机制见
[gpui-shell skill](../../../../../gpui-component/skills/gpui-shell/SKILL.md)、
[base 与 adapter 选型](../../../../../gpui-component/skills/gpui-shell/references/layer-selection.md)。
下文 `extensions/`、`packages/` 相对 navop-extensions 根目录；`../navop/`、
`../gpui-component/` 是兄弟 checkout，不是相对本文目录。

## 1. 复用现成链路，不创建第二个扩展系统

```text
Navop extension.json / catalog
  -> ShellPluginHost
     -> gpui_component_shell::components()       带样式组件 catalog
     -> ShellRuntime::new_isolated_with_components(...)
     -> 每次挂载的 Policy + 获准的 navop.* HostModule
     -> ViewLoadOptions -> runtime.load_view(...) -> ScriptView
  -> Navop tab 或工作台页面挂载

JS 视图 -> navop.* -> 宿主服务 / 既有 headless provider
```

已接通的权威代码（Navop）：

- `crates/universal-plugins/src/shell_plugin_host/components.rs`：
  `component_registry()` 直接返回上游 adapter catalog；同文件含
  `navop_shell_runtime_uses_the_component_adapter_catalog` 和
  `navop_shell_view_materializes_a_gpui_component` 测试。
- `crates/universal-plugins/src/shell_plugin_host.rs`：`ShellPluginHost::new`。
- `crates/universal-plugins/src/shell_plugin_host/policy.rs`：
  `load_with_session_and_connection`、`base_policy`、`validate_entry_path`、
  `LoadedShellView::unload`。先取消 session，再 retire script。
- `crates/universal-plugins/src/shell_page_host.rs`：`ensure_embeddable` 与
  borrowed mount；挂载页体不重新执行 resource/open。

不要因为新增扩展 UI 而：

- 增加第二份 `gpui-shell.json`、照搬上游 `PluginManager` 接管安装目录；
- 从 UI crate 反向依赖 Navop 业务，或在每个扩展包内创建 runtime/catalog；
- 新增 provider UI tree、UI RPC、Rust dylib UI 插件协议；
- 把现有 IPC/WASM driver/importer 全部改写为 JS。Shell 复用的是 UI 平面；
  provider/driver/importer 能力平面仍遵守各自已存在的协议。

## 2. 扩展作者如何选 base / styled

| 页面需求 | 使用方式 |
| --- | --- |
| 标准表单、按钮、选择器、提示状态 | 从 `gpui-component` 导入绑定的 styled 控件；不自行重造控件行为 |
| 布局、文字、保留输入状态 | `gpui-base` 的 flex helpers、`InputState` / `TextareaState`；`gpui`（兼容别名）或 `gpui-kit` 的 View/div |
| 自定样式的基础输入、特殊组合布局 | base 控件 + 自己的 presentation；仍遵守焦点、状态、主题契约 |
| 标准输入外观 + 自定义业务状态/布局 | base 输入状态传给 styled Input/Textarea，创建状态在 init、元素在 render |
| 新宿主原生组件尚无 JS 绑定 | 先核验 adapter；确需添加时改 adapter/HostModule 边界，不假设 Rust API 自动出现在 JS |

`gpui-component-shell` 由 **Navop Rust 宿主开发者**使用；扩展作者消费它注册的
`gpui-component` JS 模块。`shellViews[].modules` 里写 `context/workbench/log` 等
Navop host module 标识，**不写** `gpui-base` 或 `gpui-component-shell`。
UI-only 扩展不需要虚构 backend/provider，参照 dev-tools 的 manifest。

## 3. 先判定页面入口，再选择数据 API

| 入口 | 数据访问/生命周期 |
| --- | --- |
| 工作台 `pages[].renderer = {kind:"shell", viewId}` | 借用已存在的 resource session，必需 `context` + `workbench`；用命名 operation 的 `dispatch` |
| 连接 `connections[].shellViewId` | 宿主打开连接，按声明授予 resource 等模块；从 `navop.context` 取当前连接的 opaque handle |
| 独立工具（如 dev-tools） | 使用该视图获准模块；没有借用工作台会话，不能仅加 `workbench` 就调用 dispatch |

当前 `ensure_embeddable` 禁止工作台页请求原始
`resource/job/event/blob/runtime/dev` 模块；`log` 不在该禁用清单中。
工作台页不要自行 open/close 共享资源或另开 provider event stream。
job operation 的等待由 dispatch 路径承担，不把 job 轮询复制到页面；
业务指标定时刷新是另一回事，可使用页面生命周期内的 timer。

不把 `surface:"tab"` 直接等同于“连接视图”。先检查连接/工作台引用及
catalog 的工具箱筛选；dev-tools 的独立工具也是 `surface:"tab"`。

## 4. 安全与宿主边界

- `extension.json` 是 Navop 安装、权限、贡献和后端关系的真相来源。
  `shellViews` 必需字段/允许值以宿主 serde schema 为准，不能抄历史设计稿字段。
- 声明模块与权限不是同一件事。`policy.rs` 按 modules 注入 API，另把可支持的
  permissions 映射为 capabilities；不能抄独立 CLI 示例的全开授权。
- entry 要在扩展根目录内，通过 canonical path 校验；不依赖路径逃逸加载项目文件。
- non-read operation 需要实际确认。`confirmed:true` 表示已确认，不是请求弹窗；
  UI 自身不能用固定 true 把确认门控变成空操作。
- 普通 JS 运行不等于 Node/browser：开发时可用 npm/tsc，但宿主不因此支持
  Node 内置模块、DOM 或任意包解析。
- catalog 存在不代表独立 Shell 的 dialog/toast/window API 在 Navop 中可用。
  检查当前宿主 Root/overlay 接入和真实交互，不替换 Navop 窗口根来绕过问题。

## 5. 示例按用途取材，不整份照抄

1. `examples/shell-view-example/{extension.json,ui/tool.js,jsconfig.json}`：
   小型连接级视图，base 布局 + `navop.context/resource/log`，展示 opaque handle。
   这是连接 API 示例，不是工作台 dispatch 模板。
2. `extensions/composite/mqtt/ui/`：工作台页、base 输入状态 + styled 控件，
   配套 manifest 的命名 operation。
3. `extensions/composite/dev-tools/extension.json` 和 `ui/workbench.js`：
   无原生二进制的 UI 扩展、styled catalog 与 `navop.dev`。只取相关 API 模式；
   既有代码不自动证明所有 lifecycle 写法都符合通用 skill。
4. 兄弟仓库 `examples/js_story/app.js`：base 输入；`js_todolist`：状态与异步。
   不复制它们的独立 app manifest、窗口/overlay 假设、授权范围。
5. 兄弟仓库 `crates/component-shell/tests/base_state_bridge_render_test.rs`：
   最小 base InputState/TextareaState → styled Input/Textarea 物化回归。

## 6. 类型和验证必须匹配实际宿主

1. 先查 `../navop/Cargo.toml` 和 `Cargo.lock` 的实际 git revision，不能拿兄弟
   checkout HEAD 或类型包 README 的历史 revision 声称版本一致。
2. 编辑器同时 include `packages/navop-extension-types/vendor/gpui-kit.d.ts`
   和 `packages/navop-extension-types/src/shell/*.d.ts`。UI catalog 与 Navop
   私有模块是两份声明，缺一份就不是完整宿主 API。
3. 升级时从匹配宿主的 checkout/catalog 生成 UI 声明，Navop 声明对照
   `shell_plugin_host/*.rs` 的 `.declarations()` 更新。参考类型包 README 的
   `gen-navop-typings` 工作流；不要为消除类型错误盲目生成最新版。
4. base/component 同名状态有不同构造器/brand；类型检查失败时核验桥接与
   生成器，运行时 bridge 通过并不证明旧 vendored 类型正确，反之亦然。
   2026-09-16 核验：对通用 skill 的最小混用示例运行严格 JS 类型检查，
   当前 vendor 和兄弟仓库 story 声明均报 `TS2345`，缺少
   `__gpuiComponentState` brand；源码存在物化回归测试，但本次未编译执行。
   这是已观察到的声明/运行时契约对齐待办，不应描述为混用示例已全链路通过。
5. 按改动范围逐层验证：扩展根 `node --test tests/scripts.test.mjs`；
   已安装依赖时类型包 `npm run check`；先核验测试目标存在再跑 `npm test`；
   匹配宿主的 JS 加载和
   materialization 测试；最后在 Navop 验证输入、焦点、主题、关闭/重开。
   CLI check 不能执行未注册的 `navop.*`，也不能替代嵌入式页面验证。
   当前类型包 `npm test` 指向缺失的 `test/`，不可把该失败算成“零测试通过”；
   `npm run check` 检查类型工程和 manifest，不替代页面 JS consumer 的类型检查。
6. 报告实际执行的命令与证据等级；文档检查不冒充 Rust 编译或 UI E2E。
   安装脚本会写用户扩展目录，不把“改 skill”自动升级成批量安装扩展。
