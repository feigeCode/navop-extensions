// 关于页（app 内路由 `about`）：模板的结构说明与下一步。
import { Scroll, Text, View } from "nsh";
import { c, hairline, panel, t } from "../../lib/theme";

const STRUCTURE = [
  ["extension.json", "扩展身份、权限与 shellApp（唯一的 app 入口）"],
  ["ui/App.tsx", "shell：侧栏 + 路由表；这里 mount(App)"],
  ["ui/pages/<route>/App.tsx", "路由组件：export default，不 mount、不读 nsh.json"],
  ["ui/lib/navop.ts", "宿主 ABI 绑定（params / connection / invoke / log）"],
  ["ui/dist/bundle.js", "nsh build 产物，入库并随扩展分发"],
];

const STEPS = [
  "改 extension.json 的 id / name / shellApp.title",
  "加页面：新建 ui/pages/<route>/App.tsx，并登记到 ui/App.tsx 的 ROUTES",
  "接 provider：补 runtime.ipc、connections、shellApp.backends 与 resource 模块",
  "跑 nsh check / nsh test / bash scripts/build.sh，再安装到宿主里看效果",
];

function line(label: string, value: string) {
  return (
    <View style={{ display: "flex", flexDirection: "row", gap: 12, alignItems: "baseline" }}>
      <Text style={{ ...t.mono, width: 168, flexShrink: 0 }}>{label}</Text>
      <Text style={{ ...t.body, flex: 1, color: c.muted() }}>{value}</Text>
    </View>
  );
}

export default function About() {
  return (
    <Scroll style={{ flex: 1, minHeight: 0, padding: 18 }}>
      <View style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 760 }}>
        <View style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text style={t.h1}>这个模板演示什么</Text>
          <Text style={t.meta}>
            一个插件一个 nsh app：宿主只下发一次 route，页面切换全在 app 内完成。
          </Text>
        </View>

        <View style={{ ...panel(), display: "flex", flexDirection: "column", gap: 8 }}>
          <Text style={t.label}>目录结构</Text>
          <View style={hairline()} />
          {STRUCTURE.map(([label, value]) => line(label, value))}
        </View>

        <View style={{ ...panel(), display: "flex", flexDirection: "column", gap: 8 }}>
          <Text style={t.label}>接下来</Text>
          <View style={hairline()} />
          {STEPS.map((step, index) => line(`${index + 1}.`, step))}
        </View>

        <Text style={t.meta}>
          契约：docs/extension-resource-plugins/plugin-app.md；ABI：host-abi-v2.md。
        </Text>
      </View>
    </Scroll>
  );
}
