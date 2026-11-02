// Docker 引擎概览页（资源工作台嵌入的 nsh 页面）。
//
// 数据只有一条：`systemUsage` 一次汇总引擎状态与运行中容器的资源占用。
// 布局按"先结论、后细节"排：状态条 → 四个计数 → 磁盘 → 运行中资源。

import { mount, Scroll, signal, Text, View } from "nsh";
import { host } from "nsh";
import { c, card, dot, pill, r, t } from "./design";

type Usage = {
  engine?: boolean;
  server_version?: string;
  cpu_count?: number;
  containers_running?: number;
  containers_total?: number;
  images?: number;
  volumes?: number;
  networks?: number;
  disk_used_bytes?: number;
  disk_reclaimable_bytes?: number;
  containers_memory_bytes?: number;
  containers_cpu_percent?: number;
};

/** 字节 → 人类可读；非数字给 `-`，避免出现 NaN。 */
function human(bytes: number | undefined): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}

function share(part: number | undefined, whole: number | undefined): number {
  if (!whole || whole <= 0) return 0;
  return Math.min(100, Math.max(0, ((part ?? 0) / whole) * 100));
}

/** 一个计数块：大数字 + 小标题 + 补充说明。 */
function Tile(props: { label: string; value: string; hint: string; latest?: string }) {
  return (
    <View style={card({ flex: 1, minWidth: 150, gap: 6 })}>
      <Text style={{ ...t.label, color: c.muted }}>{props.label}</Text>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
        <Text style={{ ...t.num, color: c.cardFg }}>{props.value}</Text>
        {props.latest ? <Text style={{ ...t.meta, color: c.muted }}>{props.latest}</Text> : null}
      </View>
      <Text style={{ ...t.meta, color: c.muted }}>{props.hint}</Text>
    </View>
  );
}

/** 横向占用条。 */
function Meter(props: { value: number; tone: string }) {
  return (
    <View
      style={{
        height: 8,
        borderRadius: 999,
        backgroundColor: c.inset,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          width: `${props.value}%`,
          height: 8,
          borderRadius: 999,
          backgroundColor: props.tone,
        }}
      />
    </View>
  );
}

/** 图例里的一行：色块 + 名称 + 数值。 */
function Legend(props: { color: string; label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: props.color }} />
      <Text style={{ ...t.meta, color: c.muted }}>{props.label}</Text>
      <Text style={{ ...t.meta, color: c.cardFg, marginLeft: "auto" }}>{props.value}</Text>
    </View>
  );
}

/** 一个自绘按钮：nsh/base 的 Button 只提供按下语义，外观由页面拥有。 */
function Action(props: { label: string; busy?: boolean; onPress: () => void }) {
  return (
    <View
      onPress={props.onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 11,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: c.line,
        backgroundColor: c.card,
        opacity: props.busy ? 0.55 : 1,
      }}
    >
      <Text style={{ fontSize: 12, color: c.cardFg }}>{props.busy ? "刷新中…" : props.label}</Text>
    </View>
  );
}

export default function App() {
  const usage = signal<Usage | null>(null);
  const error = signal<string | null>(null);
  const loading = signal(true);
  const refreshed = signal("");

  const load = async () => {
    loading.set(true);
    error.set(null);
    try {
      const result = (await host.call("navop.workbench.dispatch", {
        operationId: "systemUsage",
      })) as Usage | null;
      usage.set(result ?? {});
      refreshed.set(new Date().toLocaleTimeString());
    } catch (failure) {
      error.set(String((failure as { message?: string })?.message ?? failure));
    } finally {
      loading.set(false);
    }
  };
  // 组件体只在挂载时跑一次：这里是"进页面就取一次数"的位置。
  void load();

  const u = usage() ?? {};
  const running = u.containers_running ?? 0;
  const total = u.containers_total ?? 0;
  const diskUsed = u.disk_used_bytes ?? 0;
  const reclaimable = u.disk_reclaimable_bytes ?? 0;
  const diskTotal = diskUsed + reclaimable;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 18,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderColor: c.line,
        }}
      >
        <Text style={{ ...t.h1, color: c.fg }}>Docker Engine</Text>
        <View style={pill(u.engine ? "transparent" : "transparent", c.fg)}>
          <View style={dot(u.engine ? c.ok : c.danger)} />
          <Text style={{ ...t.meta, color: u.engine ? c.ok : c.danger }}>
            {u.engine ? "运行中" : "不可用"}
          </Text>
        </View>
        <Text style={{ ...t.meta, color: c.muted }}>
          {u.server_version ? `Server ${u.server_version}` : "版本未知"} · {u.cpu_count ?? 0} CPUs
        </Text>
        <View style={{ flex: 1 }} />
        {refreshed() ? <Text style={{ ...t.meta, color: c.muted }}>{refreshed()} 更新</Text> : null}
        <Action label="刷新" busy={loading()} onPress={() => void load()} />
      </View>

      <Scroll style={{ flex: 1 }}>
        <View style={{ padding: 18, gap: 14 }}>
          {error() ? (
            <View style={card({ borderColor: c.danger })}>
              <Text style={{ fontSize: 13, color: c.danger }}>读取引擎用量失败</Text>
              <Text style={{ ...t.meta, color: c.muted }}>{error()}</Text>
              <View style={{ flexDirection: "row", marginTop: 4 }}>
                <Action label="重试" onPress={() => void load()} />
              </View>
            </View>
          ) : null}

          <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
            <Tile
              label="容器"
              value={String(running)}
              latest={`/ ${total}`}
              hint="运行中 / 总数"
            />
            <Tile label="镜像" value={String(u.images ?? 0)} hint="本地镜像" />
            <Tile label="卷" value={String(u.volumes ?? 0)} hint="逻辑卷" />
            <Tile label="网络" value={String(u.networks ?? 0)} hint="网络" />
          </View>

          <View style={card()}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: c.cardFg }}>磁盘占用</Text>
              <Text style={{ ...t.meta, color: c.muted }}>共 {human(diskTotal)}</Text>
              <View style={{ flex: 1 }} />
              <Text style={{ ...t.meta, color: c.warn }}>
                可回收 {share(reclaimable, diskTotal).toFixed(0)}%
              </Text>
            </View>
            <Meter value={share(diskUsed, diskTotal)} tone={c.accent} />
            <View style={{ gap: 6, marginTop: 2 }}>
              <Legend color={c.accent} label="已使用" value={human(diskUsed)} />
              <Legend color={c.warn} label="可回收" value={human(reclaimable)} />
            </View>
          </View>

          <View style={card()}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: c.cardFg }}>运行中容器资源</Text>
            <View style={{ flexDirection: "row", gap: 24, marginTop: 2 }}>
              <Legend color={c.ok} label="内存合计" value={human(u.containers_memory_bytes)} />
              <Legend
                color={c.accent}
                label="CPU 估计"
                value={`${(u.containers_cpu_percent ?? 0).toFixed(1)}%`}
              />
              <Legend color={c.muted} label="容器" value={`${running} / ${total}`} />
            </View>
          </View>

          <Text style={{ ...t.meta, color: c.muted, marginTop: 2 }}>
            数据来自 docker-provider 的 systemUsage 汇总；刷新只重取这一条。
          </Text>
        </View>
      </Scroll>
    </View>
  );
}

mount(App);
