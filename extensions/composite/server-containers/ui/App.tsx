// 服务器容器：一个扩展、一个面板，多页签切换。页签集合参考 motty
// remote_tools（进程/容器/镜像/卷/网络/Compose），另保留 Kubernetes。
import { mount, Scroll, signal, Text, View } from "nsh";
import { params } from "./lib/navop";
import { c, t } from "./lib/theme";
import { Row } from "./lib/ui";
import DockerPanel from "./pages/docker/App";
import KubernetesPanel from "./pages/kubernetes/App";
import ResourcePanel from "./pages/resources/App";

const ROUTES = [
  { id: "processes", title: "进程" },
  { id: "containers", title: "容器" },
  { id: "images", title: "镜像" },
  { id: "volumes", title: "卷" },
  { id: "networks", title: "网络" },
  { id: "compose", title: "Compose" },
  { id: "kubernetes", title: "Kubernetes" },
] as const;

type RouteId = (typeof ROUTES)[number]["id"];

function resolveRoute(value: string | null | undefined): RouteId {
  if (value === "docker") return "containers";
  return ROUTES.some((item) => item.id === value) ? (value as RouteId) : "containers";
}

const ProcessesPage = () => <ResourcePanel kind="processes" />;
const ImagesPage = () => <ResourcePanel kind="images" />;
const VolumesPage = () => <ResourcePanel kind="volumes" />;
const NetworksPage = () => <ResourcePanel kind="networks" />;
const ComposePage = () => <ResourcePanel kind="compose" />;

export default function App() {
  const route = signal<RouteId>(resolveRoute(params.surface === "panel" ? params.panel : params.route));

  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        flexDirection: "column",
        backgroundColor: c.bg(),
      }}
    >
      <Scroll horizontal style={{ flexShrink: 0, maxHeight: 46, borderBottomWidth: 1, borderBottomColor: c.line() }}>
        <Row gap={4} style={{ padding: 8 }}>
          {ROUTES.map((item) => (
            <View
              role="button"
              accessibilityLabel={`页签 ${item.title}`}
              onPress={() => route.set(item.id)}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 6,
                backgroundColor: route() === item.id ? c.hover() : "transparent",
              }}
            >
              <Text style={{ ...t.label, color: route() === item.id ? c.text() : c.muted() }}>
                {item.title}
              </Text>
            </View>
          ))}
        </Row>
      </Scroll>
      <View style={{ flex: 1, minHeight: 0, flexDirection: "column" }}>
        {(() => {
          switch (route()) {
            case "processes":
              return <ProcessesPage />;
            case "images":
              return <ImagesPage />;
            case "volumes":
              return <VolumesPage />;
            case "networks":
              return <NetworksPage />;
            case "compose":
              return <ComposePage />;
            case "kubernetes":
              return <KubernetesPanel />;
            default:
              return <DockerPanel />;
          }
        })()}
      </View>
    </View>
  );
}

mount(App);
