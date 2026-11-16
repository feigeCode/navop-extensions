// 表详情（tab 形态）：DB 树右键菜单打开的那一页。
//
// 启动上下文（`host.params.context`）由宿主注入，形状：
//   { commandId, connectionId, databaseType, driverId, node: { id, name, type } }
// 元数据全部走 `nativeModule("navop").Db`（清单要声明 modules 含 `db`，
// 权限要 `db:connections:list` 与 `db:schema:<conn|*>`；预览数据另要 `db:read:`）。
import { signal, Scroll, Text, View } from "nsh";
import { describeTable, execute, listDatabases, listTables, openSession } from "@navop/extension-kit/db";
import { params } from "../../lib/navop";
import { c, hairline, panel, t } from "../../lib/theme";

type DbContext = {
  connectionId?: number | string;
  databaseType?: string;
  node?: { id?: string; name?: string; type?: string };
};

function actionButton(label: string, onPress: () => void) {
  return (
    <View
      role="button"
      onPress={onPress}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 6,
        backgroundColor: c.hover(),
      }}
    >
      <Text style={{ fontSize: 13, color: c.text() }}>{label}</Text>
    </View>
  );
}

export default function TablePage() {
  const context = (params.context ?? {}) as DbContext;
  const connectionId = context.connectionId ?? null;
  const tableName = context.node?.name ?? null;
  const note = signal("（还没调用能力面）");

  const describe = () => {
    if (connectionId === null) {
      note.set("没有 connectionId：这页是给库树菜单用的，请从库树右键打开");
      return;
    }
    if (!tableName) {
      note.set("上下文里没有表名（从「表」节点右键打开才有）");
      return;
    }
    describeTable({ connectionId }, tableName)
      .then((result) => note.set(JSON.stringify(result, null, 2)))
      .catch((error: unknown) => note.set(`描述失败: ${String(error)}`));
  };

  const listDbs = () => {
    if (connectionId === null) {
      note.set("没有 connectionId");
      return;
    }
    listDatabases({ connectionId })
      .then((items) => note.set(JSON.stringify(items, null, 2)))
      .catch((error: unknown) => note.set(`列库失败: ${String(error)}`));
  };

  const listTablesOfCurrent = () => {
    if (connectionId === null) {
      note.set("没有 connectionId");
      return;
    }
    listTables({ connectionId })
      .then((items) => note.set(JSON.stringify(items.slice(0, 20), null, 2)))
      .catch((error: unknown) => note.set(`列表失败: ${String(error)}`));
  };

  const preview = () => {
    if (connectionId === null || !tableName) {
      note.set("预览需要 connectionId 与表名");
      return;
    }
    const quoted = tableName.includes(".") ? tableName : tableName;
    openSession(connectionId)
      .then((sessionId) =>
        execute(sessionId, `SELECT * FROM ${quoted} LIMIT 20`, { maxRows: 20 })
          .then((batch) => {
            note.set(JSON.stringify(batch, null, 2));
            return sessionId;
          })
          .catch((error: unknown) => {
            note.set(`查询失败: ${String(error)}`);
            return sessionId;
          }),
      )
      .catch((error: unknown) => note.set(`开会话失败: ${String(error)}`));
  };

  return (
    <Scroll style={{ flex: 1, minHeight: 0, padding: 16 }}>
      <View style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <View style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text style={t.h2}>表详情</Text>
          <Text style={t.meta}>
            能力面：Db.listDatabases / listTables / describeTable / execute
          </Text>
        </View>

        <View style={{ ...panel(), display: "flex", flexDirection: "column", gap: 6 }}>
          <Text style={t.label}>启动上下文（host.params.context）</Text>
          <View style={hairline()} />
          <Text style={t.mono}>{`connectionId: ${String(connectionId ?? "null")}`}</Text>
          <Text style={t.mono}>{`databaseType: ${context.databaseType ?? "null"}`}</Text>
          <Text style={t.mono}>
            {`node: ${context.node?.type ?? "null"} / ${tableName ?? "null"}`}
          </Text>
        </View>

        <View style={{ display: "flex", flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {actionButton("列出数据库", listDbs)}
          {actionButton("列出当前库的表", listTablesOfCurrent)}
          {actionButton("描述这张表", describe)}
          {actionButton("预览 20 行", preview)}
        </View>

        <View style={{ ...panel(), display: "flex", flexDirection: "column", gap: 8 }}>
          <Text style={t.label}>结果</Text>
          <View style={hairline()} />
          <Text style={t.mono}>{note()}</Text>
        </View>
      </View>
    </Scroll>
  );
}
