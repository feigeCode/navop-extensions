// tab 形态：从面板跳过来时带着连接上下文，列库/表/字段。
import { signal, Scroll, Text, View } from "nsh";
import { describeTable, listDatabases, listTables } from "@navop/extension-kit/db";
import type { DbColumnMetadata, DbTable } from "@navop/extension-kit/db";
import { params } from "../../lib/navop";
import { c, hairline, panel, t } from "../../lib/theme";

type TabContext = { connectionId?: number | string; databaseType?: string };

function actionButton(label: string, onPress: () => void) {
  return (
    <View
      role="button"
      onPress={onPress}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: c.hover(),
      }}
    >
      <Text style={{ fontSize: 12, color: c.text() }}>{label}</Text>
    </View>
  );
}

export default function SchemaPage() {
  const context = (params.context ?? {}) as TabContext;
  const connectionId = context.connectionId ?? null;
  const databases = signal<string[]>([]);
  const tables = signal<DbTable[]>([]);
  const columns = signal<DbColumnMetadata[]>([]);
  const current = signal<string | null>(null);
  const note = signal("先列库，再点表看字段");

  const loadTables = () => {
    if (connectionId === null) {
      note.set("启动上下文里没有 connectionId");
      return;
    }
    listDatabases({ connectionId })
      .then((items) => {
        databases.set(items);
        const database = items[0];
        if (!database) {
          note.set("连接下没有库");
          return;
        }
        return listTables({ connectionId, database }).then((rows) => {
          tables.set(rows);
          note.set(`${database}：${rows.length} 张表`);
        });
      })
      .catch((error: unknown) => note.set(`失败: ${String(error)}`));
  };

  const loadColumns = (item: DbTable) => {
    if (connectionId === null) return;
    describeTable(
      { connectionId, database: databases()[0], schema: item.schema ?? undefined },
      item.name,
    )
      .then((detail) => {
        columns.set(detail.columns);
        current.set(item.name);
        note.set(`${item.name}：${detail.columns.length} 列 / ${detail.indexes.length} 索引`);
      })
      .catch((error: unknown) => note.set(`失败: ${String(error)}`));
  };

  return (
    <Scroll style={{ flex: 1, minHeight: 0, padding: 14 }}>
      <View style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Text style={t.h2}>字段速览</Text>
        <Text style={t.meta}>
          {`connection: ${connectionId ?? "null"} · type: ${context.databaseType ?? "unknown"}`}
        </Text>

        <View style={{ display: "flex", flexDirection: "row", gap: 6 }}>
          {actionButton("列库与表", loadTables)}
        </View>

        <View style={{ ...panel(), display: "flex", flexDirection: "column", gap: 4 }}>
          <Text style={t.label}>表</Text>
          <View style={hairline()} />
          {tables().length === 0 ? (
            <Text style={t.meta}>{note()}</Text>
          ) : (
            tables().slice(0, 40).map((item) => (
              <View
                role="button"
                onPress={() => loadColumns(item)}
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "baseline",
                  gap: 8,
                  paddingVertical: 3,
                }}
              >
                <Text style={{ ...t.mono, flex: 1 }} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={t.meta}>{item.kind}</Text>
              </View>
            ))
          )}
        </View>

        <View style={{ ...panel(), display: "flex", flexDirection: "column", gap: 4 }}>
          <Text style={t.label}>{current() === null ? "字段" : `${current()} 的字段`}</Text>
          <View style={hairline()} />
          {columns().length === 0 ? (
            <Text style={t.meta}>{note()}</Text>
          ) : (
            columns().map((column) => (
              <View
                style={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "baseline",
                  gap: 8,
                  paddingVertical: 2,
                }}
              >
                <Text style={{ ...t.mono, width: 160 }} numberOfLines={1}>
                  {column.name}
                </Text>
                <Text style={{ ...t.meta, flex: 1 }} numberOfLines={1}>
                  {column.typeName}
                </Text>
                <Text style={t.meta}>
                  {`${column.primaryKey ? "PK " : ""}${column.nullable ? "null" : "not null"}`}
                </Text>
              </View>
            ))
          )}
        </View>
      </View>
    </Scroll>
  );
}
