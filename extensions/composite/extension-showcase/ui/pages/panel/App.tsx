// 演示面板（宿主侧栏 surface）。同一段代码被两个锚点复用：
//
// - `anchor: "terminal-sidebar"`（panel id `quick-tools`）：读当前终端；
// - `anchor: "db-sidebar"`（panel id `db-inspector`）：读当前连接的库列表。
//
// 宿主以 `host.params.surface == "panel"` + `panel` + `anchor` 启动独立的
// AppView 实例，页面按 `params.anchor` 分支渲染——这演示了“一个 app、
// 多个 surface”里同页面适配不同挂载点。
import { Scroll, signal, Text, View } from "nsh";
import { closeSession, listConnections, listDatabases, openSession } from "../../lib/navop";
import { listTerminals, notify, openApp, readTerminal } from "../../lib/navop";
import { params } from "../../lib/navop";
import { c, hairline, panel, t } from "../../lib/theme";

export default function Panel() {
  const host = params.anchor === "db-sidebar" ? "database" : "terminal";
  const snapshot = signal("（未读取）");

  const readLatestTerminal = () => {
    void (async () => {
      try {
        const sessions = await listTerminals();
        const target = sessions.find((item) => item.connected) ?? sessions[0];
        if (!target) {
          snapshot.set("没有终端会话");
          return;
        }
        const result = await readTerminal(target.sessionId, 12);
        snapshot.set(`#${target.sessionId} ${target.title}\n${result.text.slice(-300)}`);
      } catch (error) {
        snapshot.set(error instanceof Error ? error.message : String(error));
      }
    })();
  };

  const readDatabases = () => {
    void (async () => {
      try {
        const connections = await listConnections();
        const target = connections[0];
        if (!target) {
          snapshot.set("没有数据库连接");
          return;
        }
        const sessionId = await openSession(target.id);
        try {
          const databases = await listDatabases(sessionId);
          snapshot.set(`${target.name}：${databases.join("、") || "（空）"}`);
        } finally {
          void closeSession(sessionId);
        }
      } catch (error) {
        snapshot.set(error instanceof Error ? error.message : String(error));
      }
    })();
  };

  return (
    <Scroll style={{ flex: 1, minHeight: 0, padding: 14 }}>
      <View style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <View style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text style={t.h2}>{host === "database" ? "库表速览" : "演示面板"}</Text>
          <Text style={t.meta}>
            panel: {params.panel ?? "?"} · anchor: {params.anchor ?? "?"} · surface:{" "}
            {params.surface ?? "tab"}
          </Text>
        </View>

        <View style={{ ...panel(), display: "flex", flexDirection: "column", gap: 8 }}>
          <Text style={t.label}>{host === "database" ? "库列表" : "终端快照"}</Text>
          <View style={hairline()} />
          <Text style={{ ...t.mono, color: c.muted(), fontSize: 11 }}>{snapshot()}</Text>
          <View
            role="button"
            onPress={host === "database" ? readDatabases : readLatestTerminal}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 7,
              borderRadius: 6,
              backgroundColor: c.hover(),
            }}
          >
            <Text style={{ fontSize: 12.5, color: c.text() }}>
              {host === "database" ? "读第一个连接的库列表" : "读当前终端（最近 12 行）"}
            </Text>
          </View>
        </View>

        <View
          role="button"
          onPress={() => notify("来自演示面板", `锚点 ${params.anchor ?? "?"} 也能弹通知`, "info")}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 7,
            borderRadius: 6,
            backgroundColor: c.hover(),
          }}
        >
          <Text style={{ fontSize: 12.5, color: c.text() }}>弹一条 info 通知</Text>
        </View>

        <View
          role="button"
          onPress={() => void openApp({ route: "explorer" })}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 6,
            backgroundColor: c.accent(),
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: "600", color: c.accentText() }}>
            打开完整演示（tab）
          </Text>
        </View>
      </View>
    </Scroll>
  );
}
