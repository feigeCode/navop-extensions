// 能力面演示页（route `explorer`）：逐个演示 navop.ui / navop.app /
// navop.terminal / navop.db，以及 DB 菜单带来的启动上下文。
//
// 每一块都可以独立点击尝试；失败的调用把错误信息显示在结果区，
// 不弹模态——方便对着宿主日志排查。
import { Scroll, signal, Text, View } from "nsh";
import type { JSX } from "nsh";
import {
  listTables,
  describeTable,
  listConnections,
  listDatabases,
  openSession,
  closeSession,
  refreshTree,
} from "../../lib/navop";
import {
  notify,
  openApp,
  execInTerminal,
  listTerminals,
  readTerminal,
  sshExec,
  waitTerminal,
  subscribeHostEvents,
} from "../../lib/navop";
import { params } from "../../lib/navop";
import { c, hairline, panel, t } from "../../lib/theme";

type DemoResult = { ok: boolean; text: string } | null;

function actionButton(label: string, onPress: () => void) {
  return (
    <View
      role="button"
      onPress={onPress}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 6,
        backgroundColor: c.hover(),
      }}
    >
      <Text style={{ fontSize: 12.5, color: c.text() }}>{label}</Text>
    </View>
  );
}

function section(title: string, desc: string, children: JSX.Element[]) {
  return (
    <View style={{ ...panel(), display: "flex", flexDirection: "column", gap: 8 }}>
      <View style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Text style={t.label}>{title}</Text>
        <Text style={{ ...t.meta, color: c.muted() }}>{desc}</Text>
      </View>
      <View style={hairline()} />
      <View style={{ display: "flex", flexDirection: "column", gap: 6 }}>{children}</View>
    </View>
  );
}

export default function Explorer() {
  const result = signal<DemoResult>(null);
  const dbState = signal("（未查询）");
  const events = signal("（未订阅）");
  let stopEvents: (() => void) | null = null;

  const run = (label: string, action: () => Promise<unknown>) => {
    void action()
      .then((value) => result.set({ ok: true, text: JSON.stringify(value, null, 2) ?? "null" }))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        result.set({ ok: false, text: `${label} 失败：${message}` });
      });
  };

  const context = params.context as Record<string, unknown> | null;
  const node = (context?.node ?? null) as Record<string, unknown> | null;

  const demoDb = () =>
    run("navop.db", async () => {
      const connections = await listConnections();
      if (connections.length === 0) return { connections, note: "工作区里没有数据库连接" };
      const first = connections[0];
      const sessionId = await openSession(first.id);
      const databases = await listDatabases(sessionId);
      await closeSession(sessionId);
      return { connections, databases };
    });

  // 元数据：列库里的表/视图，再描述第一张表（列、索引、外键一次取全）。
  const demoMetadata = () =>
    run("navop.db metadata", async () => {
      const connections = await listConnections();
      if (connections.length === 0) return { note: "工作区里没有数据库连接" };
      const connection = connections[0];
      const databases = await listDatabases({ connectionId: connection.id });
      const database = databases[0];
      if (!database) return { note: "连接下没有可用的库" };
      const tables = await listTables({ connectionId: connection.id, database });
      const table = tables[0];
      if (!table) return { connection: connection.name, database, tables, note: "库里没有表" };
      const description = await describeTable(
        { connectionId: connection.id, database, schema: table.schema ?? undefined },
        table.name,
      );
      return {
        connection: connection.name,
        database,
        tables: tables.slice(0, 10),
        tableCount: tables.length,
        table: table.name,
        columns: description.columns,
        indexes: description.indexes,
        foreignKeys: description.foreignKeys,
      };
    });

  // 让宿主把已打开的 DB 树重载一遍（`refreshed` 是刷新的连接根数量，
  // 0 表示这棵树没打开——宿主不会假装成功）。
  const demoRefreshTree = () =>
    run("navop.db.refreshTree", async () => {
      const connections = await listConnections();
      if (connections.length === 0) return { refreshed: 0, note: "工作区里没有数据库连接" };
      const refreshed = await refreshTree(connections[0].id);
      return {
        refreshed,
        note: refreshed === 0 ? "这棵树没打开（或该连接不在树上）" : undefined,
      };
    });

  // 宿主事件：与 provider 事件共用 `navop.event` 通道，订阅时 handle 写 "host"。
  // 宿主事件没有回放，订阅之前发生的收不到；组件卸载前记得退订。
  const demoSubscribeHostEvents = () =>
    run("navop.event.subscribe(host)", async () => {
      stopEvents?.();
      stopEvents = await subscribeHostEvents("db.treeChanged", (data) => {
        events.set(JSON.stringify(data));
      });
      events.set("已订阅 db.treeChanged（执行 DDL 或刷新树时会有事件）");
      return { subscribed: "db.treeChanged" };
    });

  return (
    <Scroll style={{ flex: 1, minHeight: 0, padding: 18 }}>
      <View style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 780 }}>
        <View style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Text style={t.h1}>扩展能力演示</Text>
          <Text style={t.meta}>
            面板（终端侧栏）· DB 菜单（右键打开）· ui / app / terminal / db 能力面
          </Text>
        </View>

        {context !== null ? (
          <View style={{ ...panel(), display: "flex", flexDirection: "column", gap: 6 }}>
            <Text style={t.label}>启动上下文（DB 菜单 kind:"nsh" 下发）</Text>
            <View style={hairline()} />
            <Text style={t.mono}>{`commandId: ${String(context.commandId ?? "?")}`}</Text>
            <Text style={t.mono}>{`connectionId: ${String(context.connectionId ?? "?")} · databaseType: ${String(context.databaseType ?? "?")}`}</Text>
            <Text style={t.mono}>{`node: ${node ? `${String(node.name)}（${String(node.type)}）` : "（无）"}`}</Text>
          </View>
        ) : null}

        {section(
          "navop.ui — 宿主通知",
          "modules:[\"ui\"]；右下角 toast，四种级别。",
          [
            actionButton("弹 success 通知", () =>
              notify("来自扩展能力演示", "navop.ui.notify 打通啦", "success"),
            ),
            actionButton("弹 error 通知", () => notify("演示错误样式", undefined, "error")),
          ],
        )}

        {section(
          "navop.app — 跨 surface 导航",
          "modules:[\"app\"]；打开 tab 形态的自己（带新 context）。",
          [
            actionButton("openApp({ route, context })", () =>
              openApp({ route: "explorer", context: { via: "showcase-demo" } }),
            ),
          ],
        )}

        {section(
          "navop.terminal — 终端会话",
          "modules:[\"terminal\"]；列会话、读最近文本。",
          [
            actionButton("listTerminals()", () => run("terminal.list", () => listTerminals())),
            actionButton("readTerminal(最近 40 行)", () =>
              run("terminal.read", async () => {
                const sessions = await listTerminals();
                const target = sessions.find((item) => item.connected) ?? sessions[0];
                if (!target) return { note: "没有终端会话（先开一个终端 tab）" };
                const snapshot = await readTerminal(target.sessionId, 40);
                return {
                  sessionId: snapshot.sessionId,
                  cursor: `${snapshot.cursorRow}:${snapshot.cursorColumn}`,
                  text: snapshot.text.slice(-400),
                };
              }),
            ),
            // 执行命令：命令打进活动终端（经过用户 shell），等输出静止或
            // shell 集成报退出码。本地终端和 SSH 终端都能用。
            actionButton("execInTerminal(uname -a)", () =>
              run("terminal.exec", async () => {
                const result = await execInTerminal({
                  command: "uname -a",
                  waitForOutput: true,
                  timeoutMs: 8000,
                });
                return {
                  sessionId: result.sessionId,
                  completion: result.completion,
                  exitCode: result.exitCode,
                  output: result.output.slice(-400),
                  durationMs: result.durationMs,
                };
              }),
            ),
            // SSH 专用：独立调用、stdout/stderr 分开、可后台跑，拿 commandId 轮询。
            actionButton("sshExec(whoami，需 SSH 终端)", () =>
              run("terminal.sshExec", async () => {
                const sessions = await listTerminals();
                const target = sessions.find(
                  (item) => item.connected && item.kind === "Ssh",
                );
                if (!target) return { note: "没有 SSH 终端会话（先连一个 SSH 终端）" };
                const result = await sshExec({
                  sessionId: target.sessionId,
                  command: "whoami && pwd",
                  timeoutMs: 8000,
                });
                return {
                  sessionId: result.sessionId,
                  status: result.status,
                  exitCode: result.exitCode,
                  stdout: result.stdout.slice(-300),
                  stderr: result.stderr.slice(-300),
                };
              }),
            ),
            // 长轮询：给 previous 就等它变；不给就拿当前快照当基线再等
            // （`tail -f` 语义）。等满 timeoutMs 没新输出回 changed:false。
            actionButton("等终端输出变化（最长 3 秒）", () =>
              run("terminal.wait", async () => {
                const sessions = await listTerminals();
                const target = sessions.find((item) => item.connected) ?? sessions[0];
                if (!target) return { note: "没有终端会话（先开一个终端 tab）" };
                const snapshot = await waitTerminal({ sessionId: target.sessionId, lines: 40, timeoutMs: 3000 });
                return {
                  changed: snapshot.changed,
                  note: snapshot.changed ? "有新输出" : "3 秒内没有新输出（可以再点一次）",
                  text: snapshot.text.slice(-200),
                };
              }),
            ),
          ],
        )}

        {section(
          "navop.db — 数据库会话",
          "modules:[\"db\"] + 权限 db:connections:list / db:read:*。",
          [
            actionButton("列连接 → 开会话 → 列库 → 关会话", demoDb),
            actionButton("刷新宿主里的数据库树", demoRefreshTree),
            actionButton("列出表并描述第一张表", demoMetadata),
            actionButton("订阅宿主事件 db.treeChanged", demoSubscribeHostEvents),
            <Text style={{ ...t.mono, color: c.muted() }}>{dbState()}</Text>,
            <Text style={{ ...t.mono, color: c.muted() }}>{`事件：${events()}`}</Text>,
          ],
        )}

        <View style={{ ...panel(), display: "flex", flexDirection: "column", gap: 6 }}>
          <Text style={t.label}>调用结果</Text>
          <View style={hairline()} />
          {result() === null ? (
            <Text style={{ ...t.meta, color: c.muted() }}>（还没有调用）</Text>
          ) : (
            <Text style={{ ...t.mono, color: (result() as { ok: boolean }).ok ? c.text() : "#E5484D" }}>
              {(result() as { text: string }).text}
            </Text>
          )}
        </View>
      </View>
    </Scroll>
  );
}
