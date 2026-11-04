# Shell View 示例（nsh 单 app · 宿主 ABI v2）

演示一个**连接型** shell app 怎么用 nsh 的宿主通道调 provider 资源。整个扩展是一个 nsh app：
`ui/App.tsx` 是外壳与路由表（本示例只有 `tool` 一条路由，按契约不画侧栏），页面本体在
`ui/pages/tool/`，清单在本目录的 `extension.json`。

## 目录

```
extension.json                       扩展清单：runtime.ipc + contributes.shellApp
ui/App.tsx                           app 入口：读 host.params.route、渲染路由页，自己 mount
ui/App.test.tsx                      外壳测试（路由回落 / 单路由无侧栏）
ui/nsh.json                          app 构建输入（id 必须等于扩展 id，capabilities.host）
ui/tsconfig.json                     app tsconfig（extends ./.nsh/tsconfig.json）
ui/lib/{format,theme,ui}.ts(x)       从 docker 扩展借来的展示层小工具
ui/pages/tool/App.tsx                页面本体（export default，不自己 mount）
ui/pages/tool/App.test.tsx           页面测试（stub handler）
ui/dist/                             构建产物，入库
```

页面目录只放源码和测试：不再有自己的 `nsh.json` / `tsconfig.json` / `dist/`。

## 页面通道

- `host.params`：启动事实（`extension` 只有 `{ id, title }`、`route`、`backends`、`connection`），同步可读；
  `route` 由宿主按 `connections[].route` 或用户上次停留的路由传进来；
- `host.call("navop.resource.open / invoke / ping / close", …)`：驱动 provider，第三参显式给超时；
- `host.post("navop.log", …)`：日志，无应答；
- `host.on("navop.event", …)`：本示例没用到（页面没有声明 `event` 模块）。

完整契约见 `docs/extension-resource-plugins/host-abi-v2.md`，页面写法见
`docs/extension-resource-plugins/nsh-page-guide.zh-CN.md`。

## demo provider 未随示例提供

清单里的 `runtime.ipc`（`demo` → `./bin/demo-provider`）与 `shellApp.backends`（`{"demo": "demo"}`）
只是**占位**：本示例没有附带这个二进制。

- 真在宿主里打开这个 app 时，`backends` 是「已激活的 runtime alias」，provider 没起来页面就不会被创建，
  看到的是宿主的错误页（`BACKEND_START_FAILED`）。**这是 provider 未就绪时的预期表现，不是页面 bug。**
- 想让它真跑起来：把 `bin/demo-provider` 换成自己的 IPC provider（或把 `backends` 指向一个已激活的别名）。

## 构建与测试

在 `ui/` 目录内执行（构建产物写入 `dist/`，注意入库）：

```bash
nsh check .
nsh build . --out dist
nsh test pages/tool      # 页面用例
nsh test App.test.tsx    # 外壳用例
```

不要跑 `nsh test .`——它会把当前目录当 app 入口，nsh 0.3.0 会等 stdin。

页面测试打开的是**外壳入口** `open("../../App.tsx", { host: { params: { ...TEST_PARAMS, route: "tool" }, handlers } })`：
nsh 只读入口目录的 `nsh.json`，入口必须自己 `mount`，所以页面测试也走真实外壳，顺带覆盖路由。
stub handler 验证**调用形状**（`navop.resource.invoke` 的 `handle` / `method` / `params`、`navop.log` 上报），
不依赖真实 provider；handler 抛错在测试里只会得到 `ERR_NSH_HOST_ERROR`（nsh-testing 走 `reject(String)`），
真实宿主才会给出 `BACKEND_NOT_FOUND` 这类稳定错误码。
