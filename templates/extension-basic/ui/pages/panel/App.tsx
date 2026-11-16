// 面板页（终端侧边栏 surface）：演示 `contributes.panels` 的第二形态。
//
// 清单里声明 `"panels": [{ "id": "demo", "anchor": "terminal-sidebar" }]`
// 之后，宿主在终端侧边栏挂一个本扩展的按钮；点开时以
// `host.params.surface == "panel"` + `host.params.panel == "demo"` 启动
// **同一份 bundle** 的独立 AppView 实例 —— 不是新 app，也没有新入口。
//
// 面板实例的职责建议保持轻：它是侧边栏工具，不是第二个工作台。
// 需要完整 UI 时用 `openApp({ route })` 跳回 tab 形态（见下方按钮）。
import { Scroll, Text, View } from "nsh";
import { openApp } from "@navop/extension-kit/api";
import { params } from "../../lib/navop";
import { c, hairline, panel, t } from "../../lib/theme";

function field(label: string, value: string) {
  return (
    <View style={{ display: "flex", flexDirection: "row", gap: 10, alignItems: "baseline" }}>
      <Text style={{ ...t.label, width: 72 }}>{label}</Text>
      <Text style={{ ...t.mono, flex: 1 }}>{value}</Text>
    </View>
  );
}

export default function Panel() {
  const panelId = params.panel ?? "（null）";

  return (
    <Scroll style={{ flex: 1, minHeight: 0, padding: 14 }}>
      <View style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <View style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text style={t.h2}>终端侧边栏面板</Text>
          <Text style={t.meta}>surface: panel · 同一 bundle 的第二实例</Text>
        </View>

        <View style={{ ...panel(), display: "flex", flexDirection: "column", gap: 8 }}>
          <Text style={t.label}>启动事实（面板形态）</Text>
          <View style={hairline()} />
          {field("surface", params.surface ?? "tab")}
          {field("panel", String(panelId))}
          {field("context", params.context ? "（见宿主下发）" : "null")}
        </View>

        <View
          role="button"
          onPress={() => void openApp({ route: "home" })}
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 6,
            backgroundColor: c.accent(),
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: "600", color: c.accentText() }}>
            打开完整 app（tab 形态）
          </Text>
        </View>

        <Text style={{ ...t.meta, color: c.muted() }}>
          清单声明见 extension.json 的 contributes.panels；权限与入口复用 shellApp。
        </Text>
      </View>
    </Scroll>
  );
}
