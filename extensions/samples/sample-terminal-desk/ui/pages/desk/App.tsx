// 工作台（tab 形态）：终端能力面的完整示例。
//
// 三个动作都通过 `nativeModule("navop").Terminal` 走宿主：
//   - `Terminal.list`     —— 列会话（sessionId / cwd / kind / connected）
//   - `Terminal.read`     —— 读屏幕快照（历史 + 可见区）
//   - `Terminal.exec`     —— 往活动终端里执行命令并等输出
// 能力面要在清单里声明 `contributes.shellApp.modules` 含 `terminal`，
// 否则宿主会以 `PERMISSION_DENIED:` 拒绝（错误信息带说明）。
import { signal, Scroll, Text, View } from "nsh";
import { execInTerminal, listTerminals, readTerminal } from "@navop/extension-kit/api";
import { c, hairline, panel, t } from "../../lib/theme";

type Session = {
  sessionId: string;
  title: string;
  kind: string;
  connected: boolean;
  cwd?: string | null;
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

export default function Desk() {
  const sessions = signal<Session[]>([]);
  const note = signal("（还没调用能力面）");

  const pick = (): Session | undefined => sessions().find((item) => item.connected) ?? sessions()[0];

  const refresh = () => {
    listTerminals()
      .then((items) => {
        sessions.set(items as Session[]);
        note.set(`会话 ${items.length} 个`);
      })
      .catch((error: unknown) => note.set(`列会话失败: ${String(error)}`));
  };

  const readLast = () => {
    const target = pick();
    if (!target) {
      note.set("没有终端会话（先开一个终端 tab）");
      return;
    }
    readTerminal(target.sessionId, 20)
      .then((snapshot) => note.set(snapshot.text.slice(-800)))
      .catch((error: unknown) => note.set(`读快照失败: ${String(error)}`));
  };

  const runCommand = () => {
    execInTerminal({ command: "pwd && date", waitForOutput: true, timeoutMs: 8000 })
      .then((result) =>
        note.set(
          [
            `completion: ${result.completion}`,
            `exitCode: ${result.exitCode ?? "null"}`,
            result.output.slice(-600),
          ].join("\n"),
        ),
      )
      .catch((error: unknown) => note.set(`执行失败: ${String(error)}`));
  };

  return (
    <Scroll style={{ flex: 1, minHeight: 0, padding: 16 }}>
      <View style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <View style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text style={t.h2}>终端工作台</Text>
          <Text style={t.meta}>
            能力面：Terminal.list / read / exec（终端侧边栏面板用的是同一份 bundle）
          </Text>
        </View>

        <View style={{ display: "flex", flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {actionButton("列终端会话", refresh)}
          {actionButton("读最近 20 行", readLast)}
          {actionButton("执行 pwd && date", runCommand)}
        </View>

        <View style={{ ...panel(), display: "flex", flexDirection: "column", gap: 8 }}>
          <Text style={t.label}>会话</Text>
          <View style={hairline()} />
          {sessions().length === 0 ? (
            <Text style={t.meta}>还没拉取（点「列终端会话」）</Text>
          ) : (
            sessions().map((item) => (
              <View
                style={{ display: "flex", flexDirection: "row", gap: 8, alignItems: "baseline" }}
              >
                <Text style={{ ...t.mono, width: 120 }} numberOfLines={1}>
                  {item.sessionId}
                </Text>
                <Text style={{ ...t.mono, width: 56 }}>{item.kind}</Text>
                <Text style={{ ...t.mono, flex: 1 }} numberOfLines={1}>
                  {item.cwd ?? "（无 cwd）"}
                </Text>
                <Text style={t.meta}>{item.connected ? "connected" : "closed"}</Text>
              </View>
            ))
          )}
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
