// 面板形态（数据库侧边栏）：`surface == "panel"` 时的入口。
//
// 宿主按 `contributes.panels[].anchor = "db-sidebar"` 在库侧栏挂一个按钮；
// 面板上下文（`host.params.context`）是当前连接：{ connectionId, connectionType, params }。
// 点表名 → `openApp` 跳到本插件的 tab 页，把表的上下文一起带过去。
import { signal, Scroll, Text, View } from "nsh";
import { listDatabases, listTables } from "@navop/extension-kit/db";
import type { DbTable } from "@navop/extension-kit/db";
import { openApp } from "@navop/extension-kit/api";
import { params } from "../../lib/navop";
import { c, hairline, panel, t } from "../../lib/theme";

type PanelContext = { connectionId?: number | string; connectionType?: string };

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

export default function Panel() {
  const context = (params.context ?? {}) as PanelContext;
  const connectionId = context.connectionId ?? null;
  const databases = signal<string[]>([]);
  const tables = signal<DbTable[]>([]);
  const note = signal("点上面按钮加载");

  const load = () => {
    if (connectionId === null) {
      note.set("面板上下文里没有 connectionId");
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

  const openInTab = (item: DbTable) => {
    openApp({
      route: "table",
      context: {
        connectionId,
        databaseType: context.connectionType ?? "database",
        node: { id: item.name, name: item.name, type: "table" },
      },
    }).catch((error: unknown) => note.set(`打开失败: ${String(error)}`));
  };

  return (
    <Scroll style={{ flex: 1, minHeight: 0, padding: 12 }}>
      <View style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Text style={t.h2}>库表速览</Text>
        <Text style={t.meta}>
          {`surface: ${params.surface ?? "tab"} · panel: ${params.panel ?? "null"}`}
        </Text>

        <View style={{ display: "flex", flexDirection: "row", gap: 6 }}>
          {actionButton("加载库与表", load)}
          {actionButton("刷新", load)}
        </View>

        <View style={{ ...panel(), display: "flex", flexDirection: "column", gap: 6 }}>
          <Text style={t.label}>表</Text>
          <View style={hairline()} />
          {tables().length === 0 ? (
            <Text style={t.meta}>{note()}</Text>
          ) : (
            tables().slice(0, 40).map((item) => (
              <View
                role="button"
                onPress={() => openInTab(item)}
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
      </View>
    </Scroll>
  );
}
