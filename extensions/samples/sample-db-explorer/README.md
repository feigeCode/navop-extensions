# 库表速览（示例插件）

演示 **数据库能力面** 与 **两种接入点**：

- **库树右键菜单**：`contributes.menus["db.tree.table"]` 引用一条
  `handler.kind: "nsh"` 的命令，点菜单打开 tab，节点上下文经
  `host.params.context` 注入（`{ commandId, connectionId, databaseType, driverId, node }`）；
- **数据库侧边栏面板**：`contributes.panels[].anchor = "db-sidebar"`，
  面板上下文是当前连接（`{ connectionId, connectionType, params }`）。

页面里演示的能力面：

| 方法 | 用途 |
| --- | --- |
| `Db.listDatabases` / `Db.listTables` | 库、表清单 |
| `Db.describeTable` | 一次取回字段 / 索引 / 外键 |
| `Db.openSession` + `Db.execute` | 20 行数据预览 |

## 清单要点

```json
{
  "permissions": ["shell:exec", "db:connections:list", "db:schema:*", "db:read:*"],
  "contributes": {
    "shellApp": { "modules": ["db", "app", "ui"] },
    "panels": [{ "id": "inspector", "anchor": "db-sidebar", "order": 220,
                 "when": "connection.type == 'database'" }],
    "commands": [{ "id": "sample.dbExplorer.openTable", "handler": { "kind": "nsh", "route": "table" } }],
    "menus": { "db.tree.table": [{ "command": "sample.dbExplorer.openTable" }] }
  }
}
```

`shell:exec` 是 shellApp 的固定要求；元数据要 `db:schema:<conn|*>`，
预览数据另要 `db:read:<conn|*>`。

## 开发

```bash
./scripts/check.sh
./scripts/test.sh
./scripts/build.sh
```

## 安装（开发版）

```bash
cp -R . ~/.config/navop/extensions/composite/com.navop.sample.db-explorer
```
