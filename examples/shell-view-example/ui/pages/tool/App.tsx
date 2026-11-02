// Shell View 示例：演示 nsh 页面的能力平面。
//
// 页面只通过 `host.call` 与宿主交互：
// - `navop.context.current` 拿到页面上下文（扩展、视图、后端别名、借来的连接）；
// - `navop.resource.open / invoke / ping / close` 直接驱动 provider 资源；
// - `navop.log.info` 上报一条日志。
// 失败时把宿主错误信封里的稳定 code（BACKEND_NOT_FOUND / INVALID_HANDLE …）
// 原样展示出来，方便排查能力声明或句柄问题。
import { host, mount, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
import { Input } from "nsh/base";
import { errorMessage } from "../../lib/format";
import { Badge, Button, Card, Empty, KeyValue, Loading, LoadError, Notice, Row, Stack } from "../../lib/ui";
import { c, r, t } from "../../lib/theme";

/** 宿主错误信封：`message\n__NAVOP_ERROR__<base64url-json>`。 */
const ERROR_MARKER = "__NAVOP_ERROR__";

type HostFailure = { code: string; message: string };

type Connection = {
  connectionId?: unknown;
  name?: unknown;
  contributionId?: unknown;
  resourceType?: unknown;
  resourceHandle?: unknown;
  alias?: unknown;
};

type PageContext = {
  extensionId?: unknown;
  viewId?: unknown;
  backends?: unknown;
  connection?: Connection | null;
};

function textOf(value: unknown, fallback = "—"): string {
  if (typeof value === "string") return value.length > 0 ? value : fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

/** 解出宿主错误的 code 与 message；没有信封时整个消息按页面错误处理。 */
function decodeHostFailure(failure: unknown): HostFailure {
  const rendered = errorMessage(failure);
  const at = rendered.lastIndexOf(ERROR_MARKER);
  if (at < 0) return { code: "PAGE_ERROR", message: rendered };
  const head = rendered.slice(0, at).trim();
  const payload = rendered.slice(at + ERROR_MARKER.length).trim();
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const filled = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const decoded = JSON.parse(atob(filled)) as { code?: unknown; message?: unknown };
    return {
      code: textOf(decoded.code, "UNKNOWN"),
      message: textOf(decoded.message, head.length > 0 ? head : "调用失败"),
    };
  } catch {
    return { code: "UNKNOWN", message: head.length > 0 ? head : rendered };
  }
}

/** 把结果引用（inline / blob / event_stream）转成可展示的 JSON 文本。 */
function describeResult(result: unknown): string {
  const record = result as { kind?: unknown; value?: unknown; handle?: unknown } | null;
  if (record === null || record === undefined) return JSON.stringify(result, null, 2);
  if (record.kind === "inline") return JSON.stringify(record.value, null, 2);
  if (record.kind === "blob" || record.kind === "event_stream") {
    return JSON.stringify({ kind: record.kind, handle: record.handle }, null, 2);
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
  const context = signal<PageContext | null>(null);
  const contextLoading = signal(true);
  const contextError = signal<string | null>(null);

  const alias = signal("");
  const resourceType = signal("demo-item");
  const config = signal("{}");

  const handle = signal<string | null>(null);
  const capabilities = signal<string[]>([]);

  const method = signal("demo/list");
  const params = signal("{}");

  const result = signal<string | null>(null);
  const failure = signal<HostFailure | null>(null);
  const notice = signal<string | null>(null);
  const busy = signal(false);

  const connection = (): Connection | null => {
    const current = context();
    if (current === null) return null;
    const borrowed = current.connection;
    return borrowed === undefined || borrowed === null ? null : borrowed;
  };

  const backends = (): string[] => {
    const current = context();
    if (current === null) return [];
    const list = current.backends;
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
  };

  async function loadContext() {
    contextLoading.set(true);
    contextError.set(null);
    try {
      const current = (await host.call("navop.context.current")) as PageContext | null;
      context.set(current ?? null);
      const names = Array.isArray(current?.backends)
        ? (current?.backends as unknown[]).filter((item): item is string => typeof item === "string")
        : [];
      if (alias().length === 0 && names.length > 0) alias.set(names[0]);
      await host.call("navop.log.info", { message: `tool 页面上下文已读取（${names.length} 个后端别名）` });
    } catch (error) {
      contextError.set(decodeHostFailure(error).message);
    } finally {
      contextLoading.set(false);
    }
  }

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
      const opened = (await host.call("navop.resource.open", {
        backend,
        resourceType: resourceType(),
        config: configValue,
      })) as { handle?: unknown; capabilities?: unknown; metadata?: unknown } | null;
      const next = typeof opened?.handle === "string" ? opened.handle : "";
      if (next.length === 0) {
        failure.set({ code: "PROTOCOL_ERROR", message: "open 返回里没有 handle 字段。" });
        return;
      }
      handle.set(next);
      const caps = Array.isArray(opened?.capabilities)
        ? (opened?.capabilities as unknown[]).filter((item): item is string => typeof item === "string")
        : [];
      capabilities.set(caps);
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
      const response = await host.call("navop.resource.invoke", {
        handle: resourceHandle,
        method: callMethod,
        params: paramsValue,
      });
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
      await host.call("navop.resource.ping", { handle: current });
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
      await host.call("navop.resource.close", { handle: current });
      handle.set(null);
      capabilities.set([]);
      notice.set("已关闭资源，句柄作废；再次 invoke 会得到 INVALID_HANDLE。");
    } catch (error) {
      failure.set(decodeHostFailure(error));
    } finally {
      busy.set(false);
    }
  }

  function contextRows(): [string, string][] {
    const current = context();
    if (current === null) return [];
    const rows: [string, string][] = [
      ["扩展 ID", textOf(current.extensionId)],
      ["视图 ID", textOf(current.viewId)],
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

  void loadContext();

  return (
    <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", backgroundColor: c.bg() }}>
      <Row wrap gap={8} style={{ paddingHorizontal: 14, paddingVertical: 10, justifyContent: "space-between" }}>
        <Row gap={8} align="center">
          <Text style={t.h1}>资源调用示例</Text>
          <Badge text="能力平面" tone="info" />
          <Badge text={busy() ? "调用中…" : "空闲"} tone={busy() ? "warn" : "ok"} />
        </Row>
        <Row gap={6} align="center">
          <Button label="重新读取上下文" small onPress={() => void loadContext()} />
        </Row>
      </Row>

      <Stack scroll padding={14} gap={12}>
        {() => (notice() === null ? null : <Notice message={notice() ?? ""} />)}
        {() => failureBox()}

        <Card title="页面上下文" hint="navop.context.current">
          {() => {
            if (contextLoading() && context() === null) return <Loading label="正在读取页面上下文…" />;
            if (contextError() !== null && context() === null) {
              return <LoadError message={contextError() ?? ""} onRetry={() => void loadContext()} />;
            }
            return <KeyValue rows={contextRows()} columns={2} />;
          }}
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
              {() =>
                handle() === null ? null : (
                  <Row gap={6}>
                    {capabilities().map((item) => (
                      <Badge text={item} />
                    ))}
                  </Row>
                )
              }
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
          PERMISSION_DENIED（能力声明不足）、RUNTIME_UNAVAILABLE（后端运行时没起来）。
        </Text>
      </Stack>
    </View>
  );
}

mount(Tool);
