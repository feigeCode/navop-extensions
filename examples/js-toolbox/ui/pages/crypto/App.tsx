// 本地文本工具箱：摘要、Base64 与 UUID。
//
// 全部运算都在页面进程内完成（llrt 的 crypto / buffer 模块），不需要
// 任何 network / host 能力；复制结果用系统剪贴板。
import { Clipboard, mount, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
import { Input } from "nsh/base";
import { createHash, randomUUID } from "crypto";
import { Buffer } from "buffer";
import { errorMessage } from "../../lib/format";
import { Badge, Button, Card, Empty, KeyValue, Notice, Row, Stack } from "../../lib/ui";
import { c, r, t } from "../../lib/theme";

const ALGORITHMS = ["md5", "sha1", "sha256", "sha512"] as const;
type Algorithm = (typeof ALGORITHMS)[number];

type Result = { text: string; label: string } | null;

/** Base64 只认标准字母表与可选的 `=` 补位，空格换行先去掉。 */
function normalizeBase64(source: string): string | null {
  const compact = source.replace(/\s+/g, "");
  if (compact.length === 0) return "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  if (compact.length % 4 !== 0) return null;
  return compact;
}

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function decodeBase64(source: string): string | null {
  const compact = normalizeBase64(source);
  if (compact === null) return null;
  const decoded = Buffer.from(compact, "base64").toString("utf8");
  // 反向编码必须对上，才能把「看着像 Base64 但其实是乱码」挡掉。
  if (Buffer.from(decoded, "utf8").toString("base64") !== compact) return null;
  return decoded;
}

/** 多行输入框：Input 的 multiline，外层给一个固定高度的边框。 */
function TextArea(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  height: number;
  mono?: boolean;
}) {
  return (
    <View
      style={{
        height: props.height,
        paddingHorizontal: 9,
        paddingVertical: 7,
        borderRadius: r.control,
        borderWidth: 1,
        borderColor: c.line(),
        backgroundColor: c.bg(),
      }}
    >
      <Input
        value={props.value}
        placeholder={props.placeholder ?? ""}
        multiline
        onChange={(text) => props.onChange(text)}
        style={{
          flex: 1,
          fontSize: 12,
          paddingHorizontal: 0,
          borderWidth: 0,
          backgroundColor: "transparent",
        }}
      />
    </View>
  );
}

export default function Crypto() {
  const input = signal("");
  const algorithm = signal<Algorithm>("sha256");
  const result = signal<Result>(null);
  const error = signal<string | null>(null);
  const notice = signal<string | null>(null);

  function digest() {
    const text = input();
    const source = utf8Bytes(text);
    const bytes = createHash(algorithm()).update(source).digest("hex");
    result.set({ text: bytes, label: `${algorithm().toUpperCase()} 摘要` });
    error.set(null);
    notice.set(null);
  }

  function base64Encode() {
    result.set({ text: Buffer.from(input(), "utf8").toString("base64"), label: "Base64 编码结果" });
    error.set(null);
    notice.set(null);
  }

  function base64Decode() {
    const decoded = decodeBase64(input());
    if (decoded === null) {
      result.set(null);
      error.set("不是合法的 Base64 文本：只接受标准字母表（A-Z a-z 0-9 + /）与结尾的 = 补位。");
      notice.set(null);
      return;
    }
    result.set({ text: decoded, label: "Base64 解码结果" });
    error.set(null);
    notice.set(null);
  }

  function uuid() {
    result.set({ text: randomUUID(), label: "随机 UUID（v4）" });
    error.set(null);
    notice.set(null);
  }

  async function copy() {
    const current = result();
    if (current === null) return;
    try {
      await Clipboard.writeText(current.text);
      notice.set("已复制到剪贴板。");
    } catch (failure) {
      notice.set(`复制失败：${errorMessage(failure)}`);
    }
  }

  function clear() {
    input.set("");
    result.set(null);
    error.set(null);
    notice.set(null);
  }

  function resultPane(): JSX.Element {
    const current = result();
    if (current === null) {
      return <Empty title="还没有结果" hint="在上方输入文本，再点一个操作（摘要 / Base64 / UUID）。" />;
    }
    return (
      <View style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Row gap={8} align="center">
          <Badge text={current.label} tone="info" />
          <Text style={t.meta}>{`${current.text.length} 字符`}</Text>
        </Row>
        <View
          style={{
            padding: 10,
            borderRadius: r.control,
            borderWidth: 1,
            borderColor: c.line(),
            backgroundColor: c.panel(),
            maxHeight: 240,
          }}
        >
          <Text selectable style={{ ...t.mono, lineHeight: 18 }}>
            {current.text}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", backgroundColor: c.bg() }}>
      <Row wrap gap={8} style={{ paddingHorizontal: 14, paddingVertical: 10, justifyContent: "space-between" }}>
        <Row gap={8} align="center">
          <Text style={t.h1}>Crypto 工具箱</Text>
          <Badge text="本地计算" tone="ok" />
          <Text style={t.meta}>不上传任何内容</Text>
        </Row>
        <Row gap={6}>
          <Button label="清空" small onPress={clear} />
          <Button label="复制结果" small tone="primary" onPress={() => void copy()} />
        </Row>
      </Row>

      {() =>
        error() === null ? null : (
          <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
            <Notice message={error() ?? ""} tone="danger" />
          </View>
        )
      }

      {() =>
        notice() === null ? null : (
          <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
            <Notice message={notice() ?? ""} />
          </View>
        )
      }

      <Stack scroll padding={14} gap={12}>
        <Card title="输入" hint="要处理的原文；解码时贴 Base64 文本">
          <TextArea
            value={input()}
            onChange={(text) => input.set(text)}
            placeholder="例如 hello，或粘贴一段 Base64"
            height={96}
          />
        </Card>

        <Card title="操作" hint="摘要算法可切换">
          <View style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Row gap={6} wrap align="center">
              <Text style={t.label}>摘要算法</Text>
              {ALGORITHMS.map((item) => (
                <Button
                  label={item}
                  small
                  tone={algorithm() === item ? "primary" : "ghost"}
                  onPress={() => algorithm.set(item)}
                />
              ))}
            </Row>
            <Row gap={8} wrap align="center">
              <Button label="计算摘要" small tone="primary" onPress={digest} />
              <Button label="Base64 编码" small onPress={base64Encode} />
              <Button label="Base64 解码" small onPress={base64Decode} />
              <Button label="生成 UUID" small onPress={uuid} />
            </Row>
          </View>
        </Card>

        <Card title="结果" hint="可选中复制，或点右上角「复制结果」">
          <View style={{ display: "flex", flexDirection: "column" }}>{() => resultPane()}</View>
        </Card>

        <Card title="说明" hint="全部在页面内计算">
          <KeyValue
            columns={1}
            rows={[
              ["MD5", "128 位摘要，仅用于校验，不用于安全场景"],
              ["SHA-1", "160 位摘要，兼容旧系统"],
              ["SHA-256", "256 位摘要，常用默认值"],
              ["SHA-512", "512 位摘要，输出最长"],
              ["Base64", "UTF-8 文本与 Base64 互转；非法输入会直接报错"],
              ["UUID", "生成随机 v4 UUID"],
            ]}
          />
        </Card>
      </Stack>
    </View>
  );
}

mount(Crypto);
