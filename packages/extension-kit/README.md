# @navop/extension-kit

Navop 扩展开发工具包：一个插件 = 一个 nsh app，这个包里是 app 与宿主之间的通用层。

| 入口 | 内容 |
|---|---|
| `@navop/extension-kit` | 宿主 ABI v2 绑定：`params` / `connection()` / `invoke()` / `open()` / `ping()` / `close()` / `log()` / `onEvent()` |
| `@navop/extension-kit/ui` | 页面组件（Button / SearchField / Empty / Loading / Badge / Row …） |
| `@navop/extension-kit/theme` | 语义色 `c`、排版 `t`、`hairline()` / `panel()`；全部走 `token()`，跟随宿主主题 |
| `@navop/extension-kit/format` | 数字/时间/体积/错误信息等格式化 |
| `@navop/extension-kit/testing` | `testParams()` / `hostHandlers()` / `TEST_CONNECTION`，给 `nsh/test` 用 |

```ts
import { invoke, connection } from "@navop/extension-kit";
import { Empty, Loading } from "@navop/extension-kit/ui";
import { c, t } from "@navop/extension-kit/theme";
import { testParams } from "@navop/extension-kit/testing";
```

## 版本

- `0.x` 跟随宿主 ABI `apiVersion: 2` 与 `engines.nsh 0.3.x`；包内是 TypeScript 源码，
  由 `nsh build` 在扩展里一起打包，运行时不需要 node_modules。
- 不兼容改动走 minor（0.x），新增 API 走 patch。

## 离线 / 内网

`npx @navop/create-extension --vendor-lib` 会把本包源码复制进扩展的 `ui/lib`，
构建不依赖 registry。
