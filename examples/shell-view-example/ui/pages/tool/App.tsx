// Shell View 示例：演示 nsh 页面的能力平面（宿主 ABI v2）。
//
// 页面只通过 nsh 的宿主通道与宿主交互：
// - `host.params` 是启动事实：扩展信息、启动路由、后端别名、借来的连接（连接型页面才有）；
// - `host.call("navop.resource.open / invoke / ping / close", …)` 驱动 provider 资源，
//   第三参显式给页面侧超时（毫秒；不传就是 nsh 的 30 秒默认）；
// - `host.post("navop.log", …)` 上报日志，没有 Promise、不用等。
// 失败时宿主错误的 `code` / `message` 就在异常对象上，直接展示出来，方便排查
// 能力声明或句柄问题（v1 的 `__NAVOP_ERROR__` 信封随 ABI v2 一起删掉了）。
//
// 清单里的 `demo` provider 只是占位、未随示例提供：在宿主里打开会看到错误页
// （BACKEND_START_FAILED，provider 未就绪时的预期表现）；换成自己的二进制才能真的调到资源。
// 细节见示例根目录的 README.md，测试用 stub handler 验证调用形状。
import { host, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
import { Input } from "nsh/base";
import { errorMessage } from "../../lib/format";
import { Badge, Button, Card, Empty, KeyValue, Notice, Row, Stack } from "../../lib/ui";
import { c, r, t } from "../../lib/theme";

/** 页面侧超时（毫秒）：查询类 30 秒够用，open 可能带建连，放宽到 60 秒。 */
const CALL_TIMEOUT_MS = 30_000;
const OPEN_TIMEOUT_MS = 60_000;

type HostFailure = { code: string; message: string };

type Connection = {
  connectionId?: unknown;
  name?: unknown;
  contributionId?: unknown;
  resourceType?: unknown;
  resourceHandle?: unknown;
  alias?: unknown;
};

/** `host.params` 的启动事实：首帧前由宿主写入，页面生命周期内不会变。 */
type StartupParams = {
  apiVersion?: unknown;
  /** 启动路由：app 外壳从 `connections[].route` 读到的值，工具箱打开为 null。 */
  route?: unknown;
  extension?: {
    id?: unknown;
    title?: unknown;
  };
  backends?: unknown;
  connection?: Connection | null;
};

/** 模块加载时读一次即可：页面不 await，也没有重新取上下文的接口。 */
const startup = host.params as unknown as StartupParams;
const extensionInfo: NonNullable<StartupParams["extension"]> = startup.extension ?? {};
const backendAliases: string[] = Array.isArray(startup.backends)
  ? startup.backends.filter((item): item is string => typeof item === "string")
  : [];
const borrowedConnection: Connection | null = startup.connection ?? null;

host.post("navop.log", {
  level: "info",
  message: `tool 页面已加载（${backendAliases.length} 个后端别名）`,
});

function textOf(value: unknown, fallback = "—"): string {
  if (typeof value === "string") return value.length > 0 ? value : fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

/** 宿主错误直接带 `code` / `message`；页面自己的错误没有 code，落 PAGE_ERROR。 */
function decodeHostFailure(failure: unknown): HostFailure {
  const record = (failure ?? null) as { code?: unknown } | null;
  const raw = record === null ? undefined : record.code;
  const code = typeof raw === "string" && raw.length > 0 ? raw : "PAGE_ERROR";
  return { code, message: errorMessage(failure) };
}

/** 结果可能是 inline 值，也可能是 `{ blob: handle }` 引用；后者原样展示句柄。 */
function describeResult(result: unknown): string {
  const record = (result ?? null) as { blob?: unknown } | null;
  if (record !== null && typeof record === "object" && typeof record.blob === "string") {
    return JSON.stringify({ blob: record.blob }, null, 2);
  }
  return JSON.stringify(result, null, 2);
}

/** 带标签的输入框；多行时给一个等宽区域。 */
function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
  height?: number;
}) {
  const multiline = props.multiline === true;
  return (
    <View style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 160 }}>
      <Row gap={6} align="center">
        <Text style={t.label}>{props.label}</Text>
        {props.hint === undefined ? null : <Text style={t.meta}>{props.hint}</Text>}
      </Row>
      <View
        style={{
          minHeight: multiline ? props.height ?? 84 : undefined,
          paddingHorizontal: 9,
          paddingVertical: multiline ? 7 : 0,
          borderRadius: r.control,
          borderWidth: 1,
          borderColor: c.line(),
          backgroundColor: c.bg(),
        }}
      >
        <Input
          value={props.value}
          multiline={multiline}
          placeholder={props.placeholder ?? ""}
          onChange={(text) => props.onChange(text)}
          style={{ fontSize: 12, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent" }}
        />
      </View>
    </View>
  );
}

export default function Tool() {
  const alias = signal(backendAliases.length > 0 ? backendAliases[0] : "");
  const resourceType = signal("demo-item");
  const config = signal("{}");

  const handle = signal<string | null>(null);

  const method = signal("demo/list");
  const params = signal("{}");

  const result = signal<string | null>(null);
  const failure = signal<HostFailure | null>(null);
  const notice = signal<string | null>(null);
  const busy = signal(false);

  /** 宿主借给这个页面的连接：只有连接型 shell view 才有。 */
  const connection = (): Connection | null => borrowedConnection;

  /** 清单声明的后端别名（`backends` 的 key，顺序同 extension.json）。 */
  const backends = (): string[] => backendAliases;

  function parseJson(source: string, label: string): unknown | undefined {
    if (source.trim().length === 0) return undefined;
    try {
      return JSON.parse(source);
    } catch (error) {
      failure.set({ code: "INVALID_JSON", message: `${label}不是合法 JSON：${errorMessage(error)}` });
      return undefined;
    }
  }

  async function openResource(backend: string) {
    if (busy()) return;
    const configValue = parseJson(config(), "config ");
    if (configValue === undefined) return;
    busy.set(true);
    failure.set(null);
    notice.set(null);
    try {
      const opened = (await host.call(
        "navop.resource.open",
        {
          backend,
          resourceType: resourceType(),
          config: configValue,
        },
        { timeout: OPEN_TIMEOUT_MS },
      )) as { handle?: unknown } | null;
      const next = typeof opened?.handle === "string" ? opened.handle : "";
      if (next.length === 0) {
        failure.set({ code: "PROTOCOL_ERROR", message: "open 返回里没有 handle 字段。" });
        return;
      }
      handle.set(next);
      notice.set(`已打开资源 ${resourceType()}（句柄 ${next}）。`);
    } catch (error) {
      failure.set(decodeHostFailure(error));
    } finally {
      busy.set(false);
    }
  }

  async function invoke(resourceHandle: string, callMethod: string, rawParams: string, label: string) {
    if (busy()) return;
    const paramsValue = parseJson(rawParams, "params ");
    if (paramsValue === undefined) return;
    busy.set(true);
    failure.set(null);
    notice.set(null);
    try {
      const response = await host.call(
        "navop.resource.invoke",
        {
          handle: resourceHandle,
          method: callMethod,
          params: paramsValue,
        },
        { timeout: CALL_TIMEOUT_MS },
      );
      result.set(describeResult(response));
      notice.set(`${label}调用成功（${callMethod}）。`);
    } catch (error) {
      failure.set(decodeHostFailure(error));
      result.set(null);
    } finally {
      busy.set(false);
    }
  }

  async function ping() {
    const current = handle();
    if (current === null || busy()) return;
    busy.set(true);
    failure.set(null);
    try {
      await host.call("navop.resource.ping", { handle: current }, { timeout: CALL_TIMEOUT_MS });
      notice.set("ping 成功，句柄仍然有效。");
    } catch (error) {
      failure.set(decodeHostFailure(error));
    } finally {
      busy.set(false);
    }
  }

  async function close() {
    const current = handle();
    if (current === null || busy()) return;
    busy.set(true);
    failure.set(null);
    try {
      await host.call("navop.resource.close", { handle: current }, { timeout: CALL_TIMEOUT_MS });
      handle.set(null);
      notice.set("已关闭资源，句柄作废；再次 invoke 会得到 INVALID_HANDLE。");
    } catch (error) {
      failure.set(decodeHostFailure(error));
    } finally {
      busy.set(false);
    }
  }

  function contextRows(): [string, string][] {
    const rows: [string, string][] = [
      ["扩展 ID", textOf(extensionInfo.id)],
      ["启动路由", textOf(startup.route)],
      ["后端别名", backends().length === 0 ? "（未声明）" : backends().join("、")],
    ];
    const borrowed = connection();
    rows.push(["借来的连接", borrowed === null ? "没有（当前不是连接型页面）" : textOf(borrowed.name)]);
    if (borrowed !== null) {
      rows.push(["连接别名", textOf(borrowed.alias)]);
      rows.push(["资源类型", textOf(borrowed.resourceType)]);
      rows.push(["资源句柄", textOf(borrowed.resourceHandle)]);
    }
    return rows;
  }

  function failureBox(): JSX.Element | null {
    const current = failure();
    if (current === null) return null;
    return (
      <Notice message={`${current.code}：${current.message}`} tone="danger" />
    );
  }

  return (
    <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", backgroundColor: c.bg() }}>
      <Row wrap gap={8} align="center" style={{ paddingHorizontal: 14, paddingVertical: 10 }}>
        <Text style={t.h1}>资源调用示例</Text>
        <Badge text="能力平面" tone="info" />
        <Badge text={busy() ? "调用中…" : "空闲"} tone={busy() ? "warn" : "ok"} />
      </Row>

      <Stack scroll padding={14} gap={12}>
        {() => (notice() === null ? null : <Notice message={notice() ?? ""} />)}
        {() => failureBox()}

        <Card title="页面上下文" hint="host.params">
          <KeyValue rows={contextRows()} columns={2} />
        </Card>

        <Card
          title="借用连接"
          hint="宿主把连接资源打开后借给页面，句柄可以直接 invoke"
          right={<Badge text={connection() === null ? "无连接" : "已借到"} tone={connection() === null ? "neutral" : "ok"} />}
        >
          {() => {
            const borrowed = connection();
            if (borrowed === null) {
              return (
                <Text style={t.meta}>
                  当前页面不是连接型 shell view，没有借来的连接。可以在下面的「打开资源」里用后端别名自己打开一个资源。
                </Text>
              );
            }
            return (
              <View style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <KeyValue
                  rows={[
                    ["连接", textOf(borrowed.name)],
                    ["别名", textOf(borrowed.alias)],
                    ["资源类型", textOf(borrowed.resourceType)],
                    ["句柄", textOf(borrowed.resourceHandle)],
                  ]}
                  columns={2}
                />
                <Row gap={6}>
                  <Button
                    small
                    tone="primary"
                    label="用借用资源调用"
                    onPress={() => void invoke(textOf(borrowed.resourceHandle, ""), method(), params(), "借用资源")}
                  />
                </Row>
              </View>
            );
          }}
        </Card>

        <Card title="打开资源" hint="navop.resource.open / ping / close">
          <View style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Row gap={10} wrap>
              <Field
                label="后端别名"
                hint={backends().length === 0 ? "shellView 没有声明 backends" : `可选：${backends().join(" / ")}`}
                value={alias()}
                onChange={(value) => alias.set(value)}
                placeholder="例如 demo"
              />
              <Field
                label="资源类型"
                value={resourceType()}
                onChange={(value) => resourceType.set(value)}
                placeholder="例如 demo-item"
              />
            </Row>
            <Field
              label="配置"
              multiline
              height={84}
              value={config()}
              onChange={(value) => config.set(value)}
              placeholder='{}'
            />
            <Row gap={6} align="center" wrap>
              <Button label="打开资源" tone="primary" small onPress={() => void openResource(alias())} />
              <Button label="ping" small onPress={() => void ping()} />
              <Button label="关闭资源" small onPress={() => void close()} />
              <Text style={t.meta}>当前句柄：{handle() ?? "无"}</Text>
            </Row>
          </View>
        </Card>

        <Card title="调用方法" hint="navop.resource.invoke">
          <View style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Row gap={10} wrap>
              <Field label="方法" value={method()} onChange={(value) => method.set(value)} placeholder="namespace/method" />
            </Row>
            <Field label="params" multiline height={96} value={params()} onChange={(value) => params.set(value)} placeholder='{}' />
            <Row gap={6} align="center">
              <Button
                label="调用当前句柄"
                tone="primary"
                small
                onPress={() => {
                  const current = handle();
                  if (current === null) {
                    failure.set({ code: "NO_HANDLE", message: "还没有打开的句柄：先在上面「打开资源」，或使用借来的连接。" });
                    return;
                  }
                  void invoke(current, method(), params(), "资源");
                }}
              />
              <Text style={t.meta}>失败时会显示宿主返回的稳定错误码。</Text>
            </Row>
          </View>
        </Card>

        <Card title="调用结果" right={<Badge text={result() === null ? "空" : "有结果"} tone={result() === null ? "neutral" : "ok"} />}>
          {() => {
            const current = result();
            if (current === null) {
              return (
                <Empty
                  title="还没有调用结果"
                  hint="打开资源（或使用借来的连接）后，在「调用方法」里点一次调用，结果会显示在这里。"
                />
              );
            }
            return (
              <View
                style={{
                  padding: 10,
                  borderRadius: r.control,
                  borderWidth: 1,
                  borderColor: c.line(),
                  backgroundColor: c.panel(),
                  maxHeight: 320,
                }}
              >
                <Stack scroll padding={0} gap={0}>
                  <Text selectable style={{ ...t.mono, lineHeight: 18 }}>
                    {current}
                  </Text>
                </Stack>
              </View>
            );
          }}
        </Card>

        <Text style={t.meta}>
          常见错误码：BACKEND_NOT_FOUND（别名没在 backends 里注册）、INVALID_HANDLE / STALE_HANDLE（句柄作废或来自其它会话）、
          PERMISSION_DENIED（extension.json 的 modules 没声明对应模块）、RUNTIME_UNAVAILABLE（后端运行时没起来）。
        </Text>
      </Stack>
    </View>
  );
}

