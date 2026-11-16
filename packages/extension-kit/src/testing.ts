// 页面测试用的宿主桩（ABI v2）。扩展自己的 ui/lib/test-host.ts 从这里取通用件，
// 只把 extension / route / backends / connection 换成本扩展的值。

type Handler = (params: Record<string, unknown>) => unknown;

/** 连接上下文：测试里恒等于「连着一条连接，句柄叫 r-1」。 */
export const TEST_CONNECTION = {
  connectionId: 1,
  name: "test",
  contributionId: "test",
  resourceType: "test",
  resourceHandle: "r-1",
  alias: "main",
  config: {},
};

export type TestParamsInput = {
  /** `extension.json` 的 id 与 shellApp.title。 */
  extension: { id: string; title: string };
  /** 初始路由；默认 null（工具箱打开）。 */
  route?: string | null;
  /** `shellApp.backends` 的别名列表。 */
  backends?: string[];
  /** 连接的启动事实；默认 null（无连接）。 */
  connection?: unknown;
  /** 打开时的启动上下文（DB 菜单 kind:"nsh" 会带）；默认 null。 */
  context?: unknown;
  /** surface 形态："tab"（默认）或 "panel"（终端侧边栏面板）。 */
  surface?: "tab" | "panel";
  /** surface 为 "panel" 时的面板 id。 */
  panel?: string | null;
  /** surface 为 "panel" 时的宿主锚点；默认 "terminal-sidebar"。 */
  anchor?: "terminal-sidebar" | "db-sidebar" | null;
};

/** 造一份与宿主首帧前写进 `host.params` 形状一致的启动事实。 */
export function testParams(input: TestParamsInput): Record<string, unknown> {
  return {
    apiVersion: 2,
    extension: { id: input.extension.id, title: input.extension.title },
    route: input.route ?? null,
    backends: input.backends ?? [],
    connection: input.connection ?? null,
    context: input.context ?? null,
    surface: input.surface ?? "tab",
    panel: input.panel ?? null,
    anchor: input.anchor ?? (input.surface === "panel" ? "terminal-sidebar" : null),
  };
}

/** 把「方法名 → 返回值/抛错」映射成 `open(..., { host: { params, handlers } })` 要的 handlers。 */
export function hostHandlers(byMethod: Record<string, Handler>) {
  return {
    "navop.resource.invoke": (data: { method?: string; params?: Record<string, unknown> }) => {
      const method = data?.method ?? "";
      const handler = byMethod[method];
      if (!handler) throw new Error(`测试没有为 \`${method}\` 配置返回值`);
      return handler(data?.params ?? {});
    },
    "navop.resource.ping": () => ({ ok: true }),
    "navop.resource.close": () => null,
    "navop.resource.open": () => ({ handle: "r-1" }),
    "navop.log": () => null,
  };
}
