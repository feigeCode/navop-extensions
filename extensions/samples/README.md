# 示例插件（samples）

三个专门用来「试扩展机制」的最小插件，覆盖两种面板锚点与主要能力面：

| 目录 | id | 演示内容 |
| --- | --- | --- |
| `sample-terminal-desk/` | `com.navop.sample.terminal-desk` | 终端侧边栏面板（`anchor: "terminal-sidebar"`）+ `Terminal.list/read/exec` |
| `sample-db-explorer/` | `com.navop.sample.db-explorer` | 数据库侧边栏面板（`anchor: "db-sidebar"`，带 `when`）+ `db.tree` 右键菜单（`handler.kind: "nsh"`，开在数据库自己的页签栏）+ `Db.*` 元数据与查询 |
| `sample-db-schema/` | `com.navop.sample.db-schema` | 只讲数据库侧边栏面板（无 `when`）+ 字段/索引元数据 + 面板 `App.open` 跳 tab |

共同点：一个插件一个 nsh app；tab 与面板是同一份 bundle 的两个实例（按
`host.params.surface` 分流）；能力面用 `nativeModule("navop")` 调用，权限
按清单 `contributions.shellApp.modules` + `permissions` 双重把关。

## 本地安装

宿主扫描 `<配置根>/extensions/composite/<id>/extension.json`，直接复制目录即可。
`ui/dist/` 是 `nsh build` 的产物、不在仓库里（`.gitignore` 已忽略），
所以**新克隆的仓库要先构建再安装**。

配置根按构建形态不同：开发版（`cargo run -p navop`）是 `~/.navop-dev/config`，
安装版是 `~/.config/navop`：

```bash
for id in terminal-desk db-explorer db-schema; do
  ( cd "sample-$id/ui" && nsh build . --out dist )
done

# 开发版
for id in terminal-desk db-explorer db-schema; do
  rsync -a --delete --exclude node_modules --exclude .nsh --exclude '*.map' \
    "sample-$id/" "$HOME/.navop-dev/config/extensions/composite/com.navop.sample.$id/"
done

# 安装版把 ~/.navop-dev/config 换成 ~/.config/navop
```

然后在「扩展」页重新加载（或重启应用）。

## 开发

每个目录里都有 `scripts/{check,test,build}.sh`：

```bash
./scripts/check.sh   # nsh check
./scripts/test.sh    # nsh test（各 2 条：tab 形态 / 面板形态）
./scripts/build.sh   # 产出 ui/dist/bundle.js（构建产物，不入库）
```
