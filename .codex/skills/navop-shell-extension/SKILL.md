---
name: navop-shell-extension
description: 'Use when writing, reviewing, or debugging Navop extension shell pages and examples; reusing gpui-shell/gpui-component-shell in navop-extensions; choosing gpui-base vs styled script components; extension.json contributions (connections, resourceWorkbenches, shellViews); navop.* host modules; View lifecycle, theme constraints, rendering failures, and local verification.'
---

# navop 复合扩展 shell 页面开发

## Overview

Navop 扩展沿用 `extension.json`；UI 使用 `ui/*.js`，需要后端时再声明 provider，并非每个复合扩展都必须带原生 Rust 二进制（`dev-tools` 是静态 UI 扩展）。脚本页面跑在 Navop 内嵌的 gpui-shell（QuickJS）运行时里，由 gpui-component-shell 提供 styled catalog。工作台内嵌页面通过 `navop.workbench.dispatch()` 调操作；连接级/独立视图按宿主授予的模块访问资源。

## 先复用通用 skill，再应用 Navop 约束

1. 阅读通用 [gpui-shell skill](../../../../gpui-component/skills/gpui-shell/SKILL.md) 和其中的 layer-selection reference：运行时/适配器分层、View/context、组件桥接、验证方法复用它，不复制第二套。
2. 阅读 [Navop 复用边界](references/shell-reuse.md)：实际宿主链路、三种页面入口、版本/类型匹配与示例取舍。
3. 写页面前阅读 [manifest](references/manifest.md) 和 [script API](references/script-api.md)：Navop 清单、模块门控、工作台数据访问与页面约束。

上述跨仓库链接适用于本 workspace；独立检出时通过已安装的 `gpui-shell` skill 或匹配宿主 revision 的 gpui-component checkout 定位。找不到时明确报告，不拿在线最新版代替宿主契约。Navop 的 manifest/权限/挂载规则优先于独立 Shell CLI 示例。

**选型速记：** `gpui-base` 是基础行为/状态层，`gpui-component-shell` 是 Rust 宿主的 JS 组件适配层，不是二选一。普通扩展页用 base 布局/输入状态 + `gpui-component` 带样式控件；有意自绘时才选 base 控件。JS 不 import `gpui-component-shell`，扩展包不再创建一套 runtime。

## 架构一页图

```
extension.json
├── contributes.connections[]          连接类型 + 表单（fields/tabs）
├── contributes.resourceWorkbenches[]  工作台：operations{} + pages[]
│     ├── operations.<id>: { mode: invoke|job, method, requires[], effect, params }
│     └── pages[]: { id, title, renderer: shell(viewId)|native, load, stack }
└── contributes.shellViews[]           独立/内嵌脚本视图：entry=ui/*.js
      renderer.kind="shell" 的页面 → materialize ui/<viewId>.js 的 default export View
```

工作台内嵌页面的数据面：`dispatch("操作id", input, { confirmed })` → provider method → Promise。这条限制不应扩展到连接级控制台和独立工具；它们走各自获准的 `navop.*` 模块。

## 工作流

### 1. 写页面（约定速查，细节见 script-api.md）

```js
import { View, div } from "gpui";
import { h_flex, v_flex, InputState } from "gpui-base";   // 布局 + 可编辑输入状态
import { Button, Input, Select, Tag } from "gpui-component"; // 宿主适配器提供的带样式组件
import { dispatch } from "navop.workbench";

export default class Page extends View {
  init(_props, cx) {                    // 状态一律 init 里赋值；禁止类字段（会覆盖 init）
    this.filter = InputState.new({ placeholder: "..." });
    this.filter.on("submit", (_e, cx) => cx.spawn(async (cx) => this.load(cx)));
    cx.spawn(async (cx) => this.load(cx));
    this.timer = cx.timer.every(2000, (cx) => this.load(cx));  // 自动刷新
  }
  async load(cx) { ... await dispatch("metrics") ...; cx.notify(); }
  render(cx) { return v_flex().size_full().min_w_0().min_h_0()/* ... */; }
}
```

铁律（违反即渲染失败或布局塌掉）：

1. 状态在 `init()` 里赋值 + JSDoc 标注；**不写类字段声明**。
2. 颜色只用 `cx.theme().colors.<token>`（18 个名字闭集）或 `#hex` 字面量；组件库 token（`list_active` 等）不存在，写错整页白屏（守卫测试会拦）。
3. `Select` 必须包 `div().w(N).flex_shrink_0()`；`h_flex` 行里的列必须自己 `h_full()`；定宽窗格里 nowrap 文本要 `text_ellipsis()`；可滚动区 `overflow_y_scrollbar()` 且容器 `flex_1().min_h_0()`。
4. 嵌入式工作台页面**没有 navop.event**（CustomPageHost 契约），实时数据用 `cx.timer.every` 轮询 + 单调序号去重；只有 native renderer 页面的 `stack:[{kind:"stream"}]` 走 provider 流。
5. 非 read 操作需要真实确认后才传 `{ confirmed: true }`；该标志不是“让宿主弹窗”的请求，不能为了消除报错无条件设为 true。

### 2. 本地校验（改完必跑）

```bash
node --test tests/scripts.test.mjs        # 仓库根执行；主题 token、颜色、i18n、manifest 等静态守卫；数量以本次结果为准
```

改了 manifest 或 Rust provider 后再跑扩展自身的 cargo 测试（`extensions/composite/<x>/tests`）。

### 3. 安装到本机并验证

```bash
bash scripts/install-local-composite-extensions.sh   # 构建并装到 ~/.config/navop/extensions/composite/<id>，旧版自动备份 .backups/
```

重启 navop 后打开对应工作台页面验证。渲染问题排查：

- **物化/渲染失败只进 tracing ERROR 日志**，不进 spec 树——看 navop 日志（如 `failed to materialize 'Input': ...`、`` `xxx` is not a color value `` / `expected a string, got nil`）。
- 宿主侧渲染回归测试：`../navop/crates/universal-plugins/src/shell_plugin_host/extension_pages_render_tests.rs`（`cargo test -p main --bin navop <filter> --features shell-plugins`）。
- fork 侧（gpui-component/shell）改动要跑 `component-shell` 的 e2e + shell lib 测试。

### 4. 改 manifest 的核对单

- operations 的 `requires` 填 provider method URI 清单（capabilities 按它校验）；新增有能力的操作就把 method 填进去。
- 一个 page 只允许一个 stack 原语（多原语安装期被拒）；table 只有行级 actions，没有页面级 toolbar。
- `shellViews[].modules` 决定可用宿主模块：`workbench` 仅工作台挂载会话可用（独立打开必报错，且这类视图不进工具箱）。
- 改动 languages/i18n key 时同步 locales（守卫测试 1338/1414 行那组）。

## 参考

- [Navop 复用边界](references/shell-reuse.md) — generic skill 与产品契约分工、入口/选型、类型与宿主校验
- `references/manifest.md` — manifest 全字段 + mqtt 实例
- `references/script-api.md` — 脚本 API 全量 + 坑位 + 调试清单
- 现成范式源码（本仓库）：`extensions/composite/mqtt/ui/{overview,messages,subscriptions,publish,shared}.js`、`extensions/composite/dev-tools/ui/workbench.js`（navop.dev + 独立视图）
- 兄弟仓库 `../gpui-component`：`examples/js_dock`（DockArea）、`examples/js_todolist`（状态生命周期）、`examples/js_story`（组件画廊 + gpui-kit.d.ts 类型面）；宿主模块源码 `crates/shell/src/host_modules.rs`（仓库内引用写作 `gpui-component/crates/shell/...`）
- 宿主侧（navop 仓库）：`crates/universal-plugins/src/shell_plugin_host/`（navop.* 模块实现，declarations 即 TS 签名）、`crates/extension-runtime/src/extension/manifest/`（serde 定义，deny_unknown_fields）
