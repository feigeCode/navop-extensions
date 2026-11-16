// 面板形态（终端侧边栏）：`surface == "panel"` 时的入口。
//
// 宿主按 `contributes.panels[].anchor = "terminal-sidebar"` 在侧栏挂一个按钮，
// 点开就是本页。面板空间小，建议只留「一眼能用」的动作。
import { signal, Scroll, Text, View } from "nsh";
import { execInTerminal, listTerminals, readTerminal } from "@navop/extension-kit/api";
import { params } from "../../lib/navop";
import { c, hairline, panel, t } from "../../lib/theme";

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
  const note = signal("点上面两个按钮试试");

  const readLast = () => {
    listTerminals()
      .then((items) => {
        const target = items.find((item) => item.connected) ?? items[0];
        if (!target) {
          note.set("没有终端会话");
          return;
        }
        return readTerminal(target.sessionId, 12).then((snapshot) =>
          note.set(snapshot.text.slice(-600)),
        );
      })
      .catch((error: unknown) => note.set(`失败: ${String(error)}`));
  };

  const runPwd = () => {
    execInTerminal({ command: "pwd", waitForOutput: true, timeoutMs: 5000 })
      .then((result) => note.set(`exit ${result.exitCode ?? "?"}：${result.output.trim()}`))
      .catch((error: unknown) => note.set(`失败: ${String(error)}`));
  };

  return (
    <Scroll style={{ flex: 1, minHeight: 0, padding: 12 }}>
      <View style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Text style={t.h2}>终端工作台</Text>
        <Text style={t.meta}>
          {`surface: ${params.surface ?? "tab"} · panel: ${params.panel ?? "null"}`}
        </Text>

        <View style={{ display: "flex", flexDirection: "row", gap: 6 }}>
          {actionButton("读最近 12 行", readLast)}
          {actionButton("执行 pwd", runPwd)}
        </View>

        <View style={{ ...panel(), display: "flex", flexDirection: "column", gap: 6 }}>
          <View style={hairline()} />
          <Text style={t.mono}>{note()}</Text>
        </View>
      </View>
    </Scroll>
  );
}
