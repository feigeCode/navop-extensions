# 字段速览（示例插件）

演示 **数据库侧边栏面板**（`anchor: "db-sidebar"`）：在数据库标签页右侧的侧栏
挂一个「字段速览」按钮，点开是一个 nsh 页面，按当前连接列出库 / 表 / 字段
（类型、可空、主键、默认值），并且可以从面板跳进本插件的详情页。

和 `sample-db-explorer` 的区别：那个示例侧重「库树右键菜单 + 元数据 + 数据预览」，
这个示例只讲**面板形态**（没有 `when`，所有数据库标签页都会出现按钮），
适合先确认侧栏链路是通的。

## 清单要点

```json
{
  "permissions": ["shell:exec", "db:connections:list", "db:schema:*"],
  "contributes": {
    "shellApp": { "modules": ["db", "app", "ui"], "entry": "ui/dist/bundle.js" },
    "panels": [
      { "id": "schema", "title": "字段速览", "anchor": "db-sidebar", "order": 230 }
    ]
  }
}
```

- `modules` 里的 `db` 对应 `nativeModule("navop").Db`；`app` 用来从面板
  `App.open` 跳回本插件的 tab；`ui` 对应 `Ui.notify`。
- `shell:exec` 是 `shellApp` 的固定要求（宿主校验），本插件不启动进程。

## 面板上下文

`host.params.context` 在面板形态下是**当前连接**：

```ts
{ connectionId: number, connectionType: "database", params: {...} | null }
```

换连接时宿主会重建视图（`view_connection` 不一致就丢弃旧视图），所以面板里
不用处理“连接变了”的刷新。

## 开发与安装

```bash
# 开发
cd ui && nsh check . && nsh test . && nsh build . --out dist

# 安装到本地开发版
rsync -a --delete --exclude node_modules --exclude .nsh --exclude '*.map' \
  ./ ~/.navop-dev/config/extensions/composite/com.navop.sample.db-schema/
```

装好后重开扩展管理页（或重启应用）触发重扫，数据库标签页右侧就会出现
「字段速览」按钮。
