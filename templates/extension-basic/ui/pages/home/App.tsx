// 首页（app 内路由 `home`）：展示宿主下发的启动事实，外加一个本地信号示例。
//
// 页面不 mount、不读自己的 nsh.json：外壳见 ui/App.tsx，这里只 export default。
import { Scroll, signal, Text, View } from "nsh";
import { backends, extension, params } from "../../lib/navop";
import { c, hairline, panel, r, t } from "../../lib/theme";

function field(label: string, value: string) {
  return (
    <View style={{ display: "flex", flexDirection: "row", gap: 10, alignItems: "baseline" }}>
      <Text style={{ ...t.label, width: 96 }}>{label}</Text>
      <Text style={{ ...t.mono, flex: 1 }}>{value}</Text>
    </View>
  );
}

export default function Home() {
  const clicks = signal(0);
  const connection = params.connection ?? null;

  return (
    <Scroll style={{ flex: 1, minHeight: 0, padding: 18 }}>
      <View style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 720 }}>
        <View style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text style={t.h1}>欢迎使用 Navop 扩展模板</Text>
          <Text style={t.meta}>
            一个插件 = 一个 nsh app；侧栏在 ui/App.tsx，页面在 ui/pages/。
          </Text>
        </View>

        <View style={{ ...panel(), display: "flex", flexDirection: "column", gap: 8 }}>
          <Text style={t.label}>宿主下发的启动事实（host.params）</Text>
          <View style={hairline()} />
          {field("apiVersion", String(params.apiVersion ?? "?"))}
          {field("扩展", `${extension.title || "（未命名）"} · ${extension.id || "?"}`)}
          {field("初始 route", String(params.route ?? "null"))}
          {field("backends", backends.length > 0 ? backends.join(", ") : "（无）")}
          {field(
            "连接",
            connection === null
              ? "null（工具箱打开 / 连接未建立）"
              : `${connection.name ?? "已连接"} · ${connection.resourceType ?? "?"} · ${connection.resourceHandle}`,
          )}
        </View>

        <View style={{ ...panel(), display: "flex", flexDirection: "column", gap: 10 }}>
          <Text style={t.label}>本地状态（signal）</Text>
          <Text style={t.body}>{`点了 ${clicks()} 次`}</Text>
          <View
            role="button"
            onPress={() => clicks.update((value) => value + 1)}
            style={{
              alignSelf: "flex-start",
              paddingHorizontal: 12,
              paddingVertical: 7,
              borderRadius: r.control,
              backgroundColor: c.accent(),
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: "500", color: c.accentText() }}>点一下</Text>
          </View>
        </View>

        <View style={{ ...panel(12), backgroundColor: c.panel() }}>
          <Text style={t.body}>
            下一步：在 extension.json 里加 connections 与 runtime.ipc，然后把页面里的
            invoke() 接到自己的 provider 方法上。
          </Text>
        </View>
      </View>
    </Scroll>
  );
}
