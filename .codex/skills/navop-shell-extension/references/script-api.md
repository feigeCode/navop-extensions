# 扩展 shell 页面脚本 API 参考（gpui-shell 内嵌运行时）

可用性以 navop 宿主实际注入为准（`../navop/crates/universal-plugins/src/shell_plugin_host/`）。API 语义与独立 gpui-shell 同源，实例优先抄 `extensions/composite/mqtt/ui/`。

## 1. 可 import 的模块

```js
import { View, div } from "gpui";            // View 基类、div 元素、Context/AsyncContext 类型
import { h_flex, v_flex, InputState, TextareaState } from "gpui-base";  // 布局原语 + 状态类
import { Button, Input, Textarea, Select, Switch, Checkbox, Tag, Spinner,
         Separator, ErrorAlert, InfoAlert } from "gpui-component";       // 组件（持续扩充，以现有扩展用过的为准）
import { Buffer } from "buffer";             // 字节编解码（hex/base64/utf8）
import { dispatch, current } from "navop.workbench";
import { current as ctx } from "navop.context";   // 注意与 workbench.current 的内容不同
import { info, error as logError } from "navop.log";
import * as dev from "navop.dev";            // dev-tools 专用
```

- **输入状态优先用 `gpui-base.InputState.new()` / `TextareaState.new()`**；styled `Input` / `Textarea` 从 `gpui-component` 导入。此规则只针对已验证的输入桥接，不表示所有 state 都在 base，也不表示 component catalog 的 retained state 都是空壳。
- `gpui-base` 也有基础 `Input` / `Textarea`：有意自定外观时用它们；普通 Navop 表单用 styled 控件，布局/状态仍可混用 base。`gpui-component-shell` 是宿主 Rust crate，不是 JS module。
- 完整 UI 类型读取 `packages/navop-extension-types/vendor/gpui-kit.d.ts`，同时 include `src/shell/*.d.ts` 的 Navop 模块声明。先核对它们是否匹配 **Navop 实际锁定的 gpui-component revision 与 catalog**；兄弟仓库 `examples/js_story/gpui-kit.d.ts` 仅作对照，不能替代匹配宿主的生成物。具体步骤见 [复用边界](shell-reuse.md)。

## 2. View 生命周期

```js
export default class MqttOverview extends View {
  init(_props, cx) {
    // ① 状态一律在这里赋值，并带 JSDoc 类型
    /** @type {{}|null} */ this.metrics = null;
    this.auto = true;
    this.context = current();                 // 捕获页面上下文
    // ② 事件订阅：签名统一 (event, cx)
    this.filter = InputState.new({ placeholder: "..." });
    this.filter.on("submit", (_e, cx) => cx.spawn(async (cx) => this.load(cx)));
    this.filter.on("change", (_e, cx) => cx.notify());
    // ③ 异步初始化 + 定时器
    cx.spawn(async (cx) => this.load(cx));              // 初次加载
    this.timer = cx.timer.every(2000, (cx) => { if (this.auto) this.load(cx); });
  }
  async load(cx) {
    try { this.data = await dispatch("metrics"); this.error = null; }
    catch (error) { this.error = errorMessage(error); }
    finally { cx.notify(); }                  // 任何状态变化后 cx.notify()
  }
  render(cx) { /* 纯函数：不建状态、不建 FocusHandle、不发请求 */ }
}
```

- **禁止类字段声明**：`View` 构造在 `super()` 内调 `init`，随后类字段初始化会把 init 设的值覆盖回声明值。要类型就写 `/** @type {} */ this.x = ...`。
- 防抖：`cx.timer.after(500, cb)` + `this.saving = null` 哨兵（见 js_dock 的 layout_changed 落盘）。
- `cx.spawn(async (cx) => ...)` 的回调 cx 可直接 `notify`；页面卸载时任务/定时器由宿主按页面世代回收（异步回写按发起时捕获的世代判归属，所以回调里别缓存跨页面的句柄）。

## 3. 数据访问：navop.workbench

```js
const result = await dispatch("操作id", input?, { confirmed? });
// 例：读
const { metrics } = await dispatch("metrics");
const { topics } = await dispatch("listTopics");
// 例：仅在用户已确认该操作后执行；confirmed:true 本身不会请求宿主弹窗
await dispatch("subscribe", { topic, qos: 1 }, { confirmed: true });
```

- `input` 的键对应 manifest `operations.<id>.params` 里 `source: "input"` 的参数；缺的参数由 `literal`/`connection` 来源补。
- 返回是 provider method 的 JSON 结果（ResultRef inline 已解包）。
- 分页上下文 `paging`、路由 `route`、选中 `selection`、连接 `connection` 都在 `current()` 里；dispatch 自动带进 BindingContext。
- 非 read effect（含 unknown）未确认会被 `guard_effect` 拒绝。`navop.workbench.dispatch` 只透传确认标志；页面必须先完成适当确认交互，不能靠固定 true 绕过交互。权威实现：Navop `shell_plugin_host/workbench.rs` 与 `extension-plugin-adapter/src/workbench_dispatch.rs`。

## 4. 组件用法实例（全部来自 mqtt/ui，可直抄）

### Button

```js
new Button("唯一id").label("刷新").ghost().size("small")
  .on_click((_e, cx) => cx.spawn(async (cx) => this.load(cx)));
new Button("add").primary().label(this.busy ? "处理中…" : "订阅").disabled(this.busy)
  .on_click((_e, cx) => this.subscribe(cx));
new Button("unsub").ghost().size("small").danger().label("取消订阅");   // 危险动作
```

### Input / Textarea（状态来自 gpui-base）

```js
// init: this.filter = InputState.new({ value: "", placeholder: "..." });
new Input(this.filter)                     // 外壳只管物化+样式
this.filter.value() / this.filter.set_value("") / .on("submit"|"change", cb)
// 多行：
this.body = TextareaState.new({ value: "", placeholder: "消息内容", rows: 8 });
new Textarea(this.body)
```

### Select（自带整行宽度，必须定宽包裹）

```js
div().w(200).flex_shrink_0().child(
  new Select("唯一id", () => OPTIONS,            // options: [{ id, label }]
    (row) => div().child(row.label),             // 渲染每行
    (value, cx) => { this.qos = String(value); cx.notify(); })
    .placeholder(qosLabel(this.qos)).menu_width(220))
```

### Tag / Switch / Spinner

```js
new Tag().variant("success"|"info"|"warning").size("small"|"xsmall").outline().child("已连接")
new Switch("唯一id").label("Retain").checked(this.retain)
  .on_change((checked, cx) => { this.retain = Boolean(checked); cx.notify(); })
new Spinner().size("medium")
```

## 5. 布局规则（违反即塌/溢出）

| 场景 | 规则 |
|---|---|
| `h_flex()` 行 | **自带交叉轴居中** ⇒ 行内的列必须自己 `.h_full()`，否则塌成一行高 |
| 列长进父容器 | `.flex_1().min_h_0()`（纵向）/ `.flex_1().min_w_0()`（横向） |
| 可滚动区 | 容器 `.flex_1().min_h_0()` + 滚动层 `.overflow_y_scrollbar()` |
| `Select` 裸放行内 | 会吃掉整行 ⇒ 包 `div().w(N).flex_shrink_0()` |
| 定宽窗格里 nowrap 文本 | 画到隔壁 ⇒ `.text_ellipsis()`（或 `.truncate()`）；`.min_h_0()` 只可压缩不裁剪 |
| 固定宽度过滤器行 | 别用固定宽，用 `.flex_1().min_w_0()`，否则最小宽度撑爆把邻列挤出屏 |
| 卡片组 | `.flex_wrap()` + 每卡 `.flex_1().min_w(150)` |
| 交互 div | 需要 hover/click 状态的加 `.id("唯一id")`；行可点加 `.cursor_pointer()` |
| 主题色 | 只用 `cx.theme().colors.<token>` 或 `#hex`；等宽文本 `.font_family("monospace")` |

## 6. 主题 token 闭集（18 个，多一个都不认）

```
background  foreground      surface    surface_foreground
primary     primary_foreground         secondary  secondary_foreground
muted       muted_foreground           accent     accent_foreground
destructive destructive_foreground     border     input
ring        selection
```

- `cx.theme().colors` 是 gpui-base 的语义色闭集（`../gpui-component/crates/shell/src/theme_tokens.rs`）；组件库自家主题名（`list_active`、`table_hover`）读出来是 `undefined` ⇒ 整页渲染失败（"This view could not be rendered" / `expected a string, got nil`）。
- 静态守卫：`tests/scripts.test.mjs` 里两条测试 —— ①扩展 UI 不得出现裸 token 名颜色（颜色要么主题 token 要么 #rgb/#rrggbb/#rrggbbaa）；②`cx.theme().colors.<name>` 的 name 必须在 18 名单内（名单是契约，故意与 gpui-component 重复）。

## 7. 实时数据：轮询（嵌入式页面唯一选择）

```js
// 嵌入式工作台页面没有 navop.event（CustomPageHost 契约）
// ⇒ timer.every 轮询 + provider 侧单调序号/时间窗去重
init(cx) {
  this.lastSeq = -1; this.lastMs = 0; this.polling = false;
  cx.spawn(async (cx) => this.poll(cx));
  this.timer = cx.timer.every(1000, (cx) => { if (!this.paused) this.poll(cx); });
}
async poll(cx) {
  if (this.polling) return;               // 重入保护
  this.polling = true;
  try {
    // 增量窗口 + 翻页上限 + 序号去重（见 messages.js）
    const result = await dispatch("queryByWindow", { ByTimeWindow: { begin_unix_ms: this.lastMs, ... } });
    ...
  } finally { this.polling = false; cx.notify(); }
}
```

只有 manifest 里 `renderer.kind:"native"` + `stack:[{kind:"stream"}]` 的页面走 provider 事件流（宿主登记 stream 身份）。独立 shell 视图（非嵌入页面）可用 `navop.event.open/read/close`。

## 8. 错误与状态提示模式

```js
// shared.js 的三件套（抄 mqtt）：
loadingView(cx, text)                    // Spinner + muted 文本，占满
errorView(cx, id, text, retry)           // destructive 文本 + 重试 Button
card(cx, label, value, hint) / kv(cx, label, value)
// 页内 notice 行（不用 window.open_dialog / push_toast —— 扩展壳未接 overlay 全局）：
div().text_size(12).text_color(this.noticeError ? cx.theme().colors.destructive
                                                : cx.theme().colors.muted_foreground)
    .child(this.notice)
// 独立视图可用 Alert 组件：ErrorAlert / InfoAlert（dev-tools workbench.js）
```

- `errorMessage(error)`：Error 取 message，否则 String(error)。
- host 错误是结构化 navop 错误（`shell_plugin_host/error.rs` ErrorCode）；`dispatch` reject 的 message 已带语义（如 `unknown workbench operation`）。

## 9. payload 编解码（Buffer）

```js
Buffer.from(text, "utf8") / Buffer.from(clean, "hex") / Buffer.from(text, "base64")
Array.from(buf)                            // → provider 的字节数组
buf.toString("base64"|"utf8")              // → 展示
```

完整实现见 `mqtt/ui/shared.js` 的 `encodePayload/decodePayload/formatHex`。

## 10. 调试清单

1. 页面白屏/报错 → 先看 navop 日志 tracing ERROR：物化失败（`failed to materialize 'X'`）、颜色错（`` `xxx` is not a color value `` / `expected a string, got nil`）都在那里，**不进 spec 树**。
2. 改完 UI 先 `node --test tests/scripts.test.mjs`（主题 token/颜色写法静态守卫）。
3. 宿主渲染回归：`cargo test -p main --bin navop <filter> --features shell-plugins`（extension_pages_render_tests.rs）。
4. 状态莫名 undefined → 查类字段覆盖 init（§2）。
5. 输入框消失 → 查 Select 是否裸放行内（§5）。
6. 列塌成一行 → 查 h_flex 行内列有没有 `h_full()`。
7. 切主题后颜色突兀 → 查有没有漏掉的硬编码色（守卫测试会拦，但 fallback/native 侧拿不到）。
