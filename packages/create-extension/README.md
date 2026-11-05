# @navop/create-extension

生成一个 Navop 扩展骨架：一个插件 = 一个 nsh app（`ui/` 里是 App 入口 + 路由 + 页面），
清单只声明 `contributes.shellApp` 与 `connections[].route`。

```bash
# 用一个反向域名做 id，输出到 ./extensions/composite/<最后一段>
npx @navop/create-extension new --id com.example.demo --name "演示扩展"

# 离线 / 内网：把 @navop/extension-kit 源码复制进 ui/lib，不依赖 registry
npx @navop/create-extension new --id com.example.demo --name "演示扩展" --vendor-lib
```

生成的目录：

```
extension.json        清单：shellApp（entry/backends/modules）+ connections[].route
extension.build.json  打包/发布元数据
ui/App.tsx            app 入口：208px 侧栏 + 路由表 + 内容区
ui/pages/<route>/     页面组件（不 mount、不读宿主 connection 之外的全局）
ui/lib/               @navop/extension-kit 的转发层 + 本扩展测试启动事实
ui/nsh.json           nsh app 元数据（id 与扩展 id 相同）
scripts/{build,check,test}.sh
```

生成后默认跑 `nsh check ui` 与 `nsh build ui --out dist`；随后：

```bash
cd <dir>
nsh test ui            # 外壳 + 所有页面测试（递归）
bash scripts/build.sh  # 重新构建 ui/dist/bundle.js
```

## 离线（不装 npm / 没有网络）

npm 发布之前（或内网机器），用扩展仓库自带的脚本，不需要任何 npm 依赖：

```bash
bash scripts/create-extension-offline.sh --id com.example.demo --name "演示扩展"
```

它直接把 `packages/extension-kit/src` 复制进 `ui/lib`，`nsh build` 不读 `node_modules`。
把脚本 + 模板 + kit 打成离线包：

```bash
bash scripts/pack-offline.sh   # artifacts/navop-extensions-offline-<version>.tar.gz
```
