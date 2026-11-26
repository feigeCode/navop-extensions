// 面板共用的目标选择与状态区：多个已连接会话时给一排切换按钮。
import { Scroll, Text, View } from "nsh";
import { Button, Empty, Row } from "./ui";
import { c, t } from "./theme";
import type { ServerTarget } from "./server";

export function TargetBar(props: {
  targets: ServerTarget[];
  currentId: string | null;
  onSelect: (id: string) => void;
}) {
  if (props.targets.length <= 1) return null;
  return (
    <Scroll horizontal style={{ flexShrink: 0, maxHeight: 40 }}>
      <Row gap={6} style={{ paddingHorizontal: 12, paddingVertical: 6 }}>
        {props.targets.map((item) => (
          <Button
            label={item.label}
            small
            tone={item.sessionId === props.currentId ? "primary" : "ghost"}
            onPress={() => props.onSelect(item.sessionId)}
          />
        ))}
      </Row>
    </Scroll>
  );
}

export function NoTarget(props: { onRetry: () => void; hint: string }) {
  return (
    <Empty
      title="没有已连接的终端会话"
      hint={props.hint}
      action={<Button label="重试" small onPress={props.onRetry} />}
    />
  );
}

export function PanelFooter(props: { left: string; right: string }) {
  return (
    <Row
      style={{
        paddingHorizontal: 12,
        paddingVertical: 6,
        flexShrink: 0,
        justifyContent: "space-between",
        borderTopWidth: 1,
        borderTopColor: c.line(),
      }}
    >
      <Text style={t.meta}>{props.left}</Text>
      <Text style={t.meta}>{props.right}</Text>
    </Row>
  );
}

/** 面板根容器：统一背景与纵向布局边界。 */
export function PanelBody(props: { children: unknown }) {
  return (
    <View
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        flexDirection: "column",
        backgroundColor: c.bg(),
      }}
    >
      {props.children as never}
    </View>
  );
}
