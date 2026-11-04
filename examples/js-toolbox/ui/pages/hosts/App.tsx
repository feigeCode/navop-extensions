// 本机 hosts 编辑器：把 /etc/hosts 解析成条目，支持启用/禁用、增删与保存。
//
// 文件读写走 `fs/promises`：能力来自扩展 permissions（`fs:read:/etc` /
// `fs:write:/etc`）与 nsh.json 的 fs 声明，两条都要有。保存是破坏性写操作，
// 必须再点一次确认。日志走 `host.post("navop.log", …)`（无应答）。
import { host, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
import { Input } from "nsh/base";
import { readFile, writeFile } from "fs/promises";
import { errorMessage, shortTime } from "../../lib/format";
import { Badge, Button, Card, ConfirmBar, Empty, LoadError, Loading, Notice, Row, SearchField, Stack } from "../../lib/ui";
import { c, r, t } from "../../lib/theme";

const HOSTS_PATH = "/etc/hosts";

/** 一行 hosts：注释与空行按原样保留，条目带解析结果。 */
type HostLine =
  | { kind: "blank"; raw: string }
  | { kind: "comment"; raw: string }
  | { kind: "entry"; raw: string; enabled: boolean; ip: string; names: string[] };

type Entry = Extract<HostLine, { kind: "entry" }>;

/** IPv4 / IPv6 的粗判：只要够区分注释即可，不做完整校验。 */
function looksLikeIp(token: string): boolean {
  if (token.length === 0) return false;
  if (!/^[0-9a-fA-F:.]+$/.test(token)) return false;
  return token.includes(":") || token.split(".").length === 4;
}

function parseLine(raw: string): HostLine {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: "blank", raw };
  if (trimmed.startsWith("#")) {
    // `#127.0.0.1 api.local` 视为停用的条目，保留在条目区里可再启用。
    const rest = trimmed.replace(/^#+\s*/, "");
    const parts = rest.split(/\s+/).filter((part) => part.length > 0);
    if (parts.length >= 2 && looksLikeIp(parts[0])) {
      return { kind: "entry", raw, enabled: false, ip: parts[0], names: parts.slice(1) };
    }
    return { kind: "comment", raw };
  }
  const parts = trimmed.split(/\s+/).filter((part) => part.length > 0);
  return { kind: "entry", raw, enabled: true, ip: parts[0], names: parts.slice(1) };
}

/** 条目 → 写回文件的一行；停用靠行首 `# `。 */
function composeLine(line: HostLine): string {
  if (line.kind !== "entry") return line.raw;
  const body = [line.ip, ...line.names].join(" ");
  return line.enabled ? body : `# ${body}`;
}

/** 单行输入框（SearchField 带放大镜，这里不合适）。 */
function Field(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  width?: number;
  onSubmit?: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        height: 28,
        width: props.width ?? 200,
        paddingHorizontal: 9,
        borderRadius: r.control,
        borderWidth: 1,
        borderColor: c.line(),
        backgroundColor: c.bg(),
      }}
    >
      <Input
        value={props.value}
        placeholder={props.placeholder ?? ""}
        onChange={(text) => props.onChange(text)}
        onSubmit={() => props.onSubmit?.()}
        style={{ flex: 1, fontSize: 12, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent" }}
      />
    </View>
  );
}

/** 上报一条宿主日志：`navop.log` 是无应答的 post，不会影响页面主流程。 */
function log(level: "info" | "error", message: string): void {
  host.post("navop.log", { level, message });
}

export default function Hosts() {
  const lines = signal<HostLine[]>([]);
  const loading = signal(true);
  const error = signal<string | null>(null);
  const notice = signal<string | null>(null);
  const saving = signal(false);
  const pendingSave = signal(false);
  const loadedAt = signal("");
  const filter = signal("");
  const dirty = signal(false);
  const addOpen = signal(false);
  const addIp = signal("");
  const addNames = signal("");
  const showComments = signal(false);
  const trailingNewline = signal(true);

  const entries = () => lines().filter((line): line is Entry => line.kind === "entry");
  const comments = () => lines().filter((line) => line.kind !== "entry");

  const visible = () => {
    const needle = filter().trim().toLowerCase();
    const all = entries();
    if (needle.length === 0) return all;
    return all.filter((line) => [line.ip, ...line.names].join(" ").toLowerCase().includes(needle));
  };

  async function load() {
    loading.set(true);
    error.set(null);
    try {
      const text = String(await readFile(HOSTS_PATH, "utf8"));
      const endsWithNewline = text.endsWith("\n");
      trailingNewline.set(endsWithNewline);
      const parsed = text.split("\n").map(parseLine);
      // 结尾换行会多切出一个空串，保存时按原始结尾重新拼。
      if (endsWithNewline && parsed.length > 0) parsed.pop();
      lines.set(parsed);
      loadedAt.set(shortTime(new Date().toISOString()));
      dirty.set(false);
      notice.set(null);
    } catch (failure) {
      error.set(`读取 ${HOSTS_PATH} 失败：${errorMessage(failure)}`);
    } finally {
      loading.set(false);
    }
  }

  async function save() {
    saving.set(true);
    try {
      const body = lines().map(composeLine).join("\n") + (trailingNewline() ? "\n" : "");
      await writeFile(HOSTS_PATH, body);
      pendingSave.set(false);
      loadedAt.set(shortTime(new Date().toISOString()));
      notice.set(`已保存 ${HOSTS_PATH}（${entries().length} 条条目）`);
      dirty.set(false);
      log("info", "hosts saved");
    } catch (failure) {
      const message = `写入 ${HOSTS_PATH} 失败：${errorMessage(failure)}`;
      notice.set(message);
      log("error", `hosts save failed: ${message}`);
    } finally {
      saving.set(false);
    }
  }

  function toggle(target: Entry) {
    lines.set(
      lines().map((line) => {
        if (line !== target) return line;
        const enabled = !target.enabled;
        return { ...target, enabled, raw: composeLine({ ...target, enabled }) };
      }),
    );
    dirty.set(true);
  }

  function remove(target: Entry) {
    lines.set(lines().filter((line) => line !== target));
    dirty.set(true);
  }

  function add() {
    const ip = addIp().trim();
    const names = addNames()
      .trim()
      .split(/\s+/)
      .filter((name) => name.length > 0);
    if (ip.length === 0 || names.length === 0) {
      notice.set("新增条目需要 IP 地址和至少一个主机名。");
      return;
    }
    if (!looksLikeIp(ip)) {
      notice.set(`「${ip}」不像 IPv4 / IPv6 地址。`);
      return;
    }
    const line: HostLine = { kind: "entry", raw: `${ip} ${names.join(" ")}`, enabled: true, ip, names };
    lines.set([...lines(), line]);
    addIp.set("");
    addNames.set("");
    addOpen.set(false);
    dirty.set(true);
    notice.set(`已添加 ${ip} ${names.join(" ")}，点「保存」写入文件。`);
  }

  void load();

  // ---- 片段 ---------------------------------------------------------

  function entryRow(line: Entry): JSX.Element {
    return (
      <Row gap={10} align="center" style={{ paddingVertical: 7, borderBottomWidth: 1, borderColor: c.line() }}>
        <Badge text={line.enabled ? "启用" : "禁用"} tone={line.enabled ? "ok" : "neutral"} />
        <Text numberOfLines={1} style={{ ...t.mono, width: 140 }}>{line.ip}</Text>
        <Text numberOfLines={1} style={{ ...t.mono, flex: 1, color: line.enabled ? c.text() : c.muted() }}>
          {line.names.join(" ") || "-"}
        </Text>
        <Button label={line.enabled ? "禁用" : "启用"} small onPress={() => toggle(line)} />
        <Button label="删除" small tone="danger" onPress={() => remove(line)} />
      </Row>
    );
  }

  function content(): JSX.Element {
    return (
      <Stack scroll padding={14} gap={12}>
        <Card title="主机条目" hint="启用 / 禁用 / 删除后点保存写回文件">
          <View style={{ display: "flex", flexDirection: "column" }}>
            {() =>
              <Row gap={8} align="center" style={{ paddingBottom: 6 }}>
                <Badge text={`${visible().length} / ${entries().length} 条`} />
                <Text style={t.meta}>{filter().trim().length === 0 ? "整份文件里的主机条目" : `过滤词：${filter()}`}</Text>
              </Row>
            }
            {() =>
              visible().length === 0 ? (
                <Empty
                  title={filter().trim().length === 0 ? "还没有主机条目" : "没有匹配的条目"}
                  hint={
                    filter().trim().length === 0
                      ? "点上方「新增条目」加一行 IP 与主机名，保存后写入 /etc/hosts。"
                      : "清空搜索词，或换一个 IP / 主机名再试。"
                  }
                />
              ) : (
                visible().map((line) => entryRow(line))
              )
            }
          </View>
        </Card>

        <Card
          title="注释与空行"
          hint="原样保留，保存时按原位置写回"
          right={<Button label={showComments() ? "收起" : "展开"} small onPress={() => showComments.set(!showComments())} />}
        >
          <View style={{ display: "flex", flexDirection: "column" }}>
            {() =>
              showComments() ? (
                comments().length === 0 ? (
                  <Text style={t.meta}>文件里没有注释或空行。</Text>
                ) : (
                  comments().map((line) => (
                    <Text numberOfLines={1} style={{ ...t.mono, color: c.muted() }}>
                      {line.raw.length === 0 ? "（空行）" : line.raw}
                    </Text>
                  ))
                )
              ) : (
                <Text style={t.meta}>注释不会丢：保存时按原位置写回。</Text>
              )
            }
          </View>
        </Card>

        {() =>
          !addOpen() ? null : (
            <Card title="新增条目" hint="保存后才会写入文件">
              <Row wrap gap={8} align="center">
                <Field value={addIp()} onChange={(text) => addIp.set(text)} placeholder="IP，如 127.0.0.1" width={170} />
                <Field
                  value={addNames()}
                  onChange={(text) => addNames.set(text)}
                  placeholder="主机名，多个用空格分隔"
                  width={280}
                  onSubmit={() => add()}
                />
                <Button label="加入列表" small tone="primary" onPress={() => add()} />
                <Button label="取消" small onPress={() => addOpen.set(false)} />
              </Row>
            </Card>
          )
        }
      </Stack>
    );
  }

  // ---- 页面 ---------------------------------------------------------

  return (
    <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", backgroundColor: c.bg() }}>
      <Row wrap gap={8} style={{ paddingHorizontal: 14, paddingVertical: 10, justifyContent: "space-between" }}>
        <Row gap={8} align="center">
          <Text style={t.h1}>Hosts 编辑器</Text>
          <Badge text={`${entries().length} 条条目`} />
          <Text style={t.mono}>{HOSTS_PATH}</Text>
          {() => (dirty() ? <Badge text="有未保存修改" tone="warn" /> : null)}
          <SearchField
            value={filter()}
            onChange={(value) => filter.set(value)}
            placeholder="按 IP / 主机名过滤"
            width={220}
          />
        </Row>
        {() =>
          loading() || error() !== null ? (
            <Row gap={6}>
              <Button label="重新读取" small disabled />
              <Button label="保存" small disabled />
            </Row>
          ) : (
            <Row gap={6}>
              <Button label="重新读取" small onPress={() => void load()} />
              <Button label={addOpen() ? "取消新增" : "新增条目"} small onPress={() => addOpen.set(!addOpen())} />
              <Button
                label={saving() ? "保存中…" : "保存"}
                tone="primary"
                small
                onPress={() => {
                  if (saving()) return;
                  pendingSave.set(true);
                }}
              />
            </Row>
          )
        }
      </Row>

      <Row gap={8} style={{ paddingHorizontal: 14, paddingBottom: 6 }}>
        <Text style={t.meta}>{loadedAt().length === 0 ? "尚未读取" : `上次读取：${loadedAt()}`}</Text>
        <Text style={t.meta}>·</Text>
        <Text style={t.meta}>保存前会二次确认</Text>
      </Row>

      {() =>
        notice() === null ? null : (
          <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
            <Notice message={notice() ?? ""} />
          </View>
        )
      }

      {() =>
        !pendingSave() ? null : (
          <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
            <ConfirmBar
              message={`把 ${entries().length} 条条目写回 ${HOSTS_PATH}？写错可能影响本机域名解析。`}
              confirmLabel="写入"
              busy={saving()}
              onConfirm={() => void save()}
              onCancel={() => pendingSave.set(false)}
            />
          </View>
        )
      }

      {() => (loading() && lines().length === 0 && error() === null ? <Loading label="正在读取 /etc/hosts…" /> : null)}
      {() =>
        error() !== null && lines().length === 0 ? <LoadError message={error() ?? ""} onRetry={() => void load()} /> : null
      }
      {() =>
        loading() && lines().length === 0 && error() === null
          ? null
          : error() !== null && lines().length === 0
            ? null
            : content()
      }
    </View>
  );
}

