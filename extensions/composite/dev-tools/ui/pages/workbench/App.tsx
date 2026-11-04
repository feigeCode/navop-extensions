// 开发者工具页（app 内路由 `workbench`）：扩展工程调试工作台。
//
// 一个插件一个 nsh app 之后，页面不再自己 mount：app 外壳见 ui/App.tsx，
// 这里只 export default 组件。模块仍是 dev + log，宿主只放行 navop.dev.*
// 与 navop.log（见 extension.json），数据全部经 host.call(name, payload) 取。
//
// 响应式约定（nsh 0.3）：组件函数体只在挂载时跑一次，所以根节点只搭骨架；
// 三态与各面板都拆成 body()/headerBar()/listPane()/detailPane()/logSection()
// 这样的普通函数，写成 `{fn()}` 子表达式（各领一个 effect、各自响应）。
// 不要把动态面板当组件 prop 传（props 在挂载时求值一次，会冻住）。
import { host, Scroll, signal, Text, View } from "nsh";
import { log } from "../../lib/navop";
import type { JSX } from "nsh";
import { arr, errorMessage, str } from "../../lib/format";
import {
  Badge,
  Button,
  ConfirmBar,
  Empty,
  LoadError,
  Loading,
  Notice,
  Row,
  SearchField,
  SectionTitle,
} from "../../lib/ui";
import { c, hairline, r, t } from "../../lib/theme";

/** `navop.dev.list` 的一项；宿主字段可能有缺省（未加载的工程 id/name/app 都是空的）。 */
type Project = Record<string, unknown>;

/** 日志面板的行数档位。 */
const LOG_TAILS = [100, 200, 500];

const projectRoot = (project: Project): string => str(project, "root", "");

const projectName = (project: Project): string => {
  const name = str(project, "name", "");
  return name.length > 0 ? name : "未命名工程";
};

/** `navop.dev.list` 的一项里 app 的面貌；`null` 表示这个工程的 extension.json 没有 shellApp。 */
const projectApp = (project: Project): { title: string } | null => {
  const app = project["app"];
  if (app === null || app === undefined || typeof app !== "object" || Array.isArray(app)) return null;
  const title = str(app as Record<string, unknown>, "title", "");
  return { title: title.length > 0 ? title : "未命名应用" };
};

const projectWatching = (project: Project): boolean => project.watching === true;

/** `{error: string | null}` 里的失败信息；没有失败就是 null。 */
function failureOf(result: unknown): string | null {
  const text = str(result, "error", "");
  return text.length > 0 && text !== "null" ? text : null;
}

/** 宿主超时/拒绝都要能变成一句人话。 */
async function callHost(name: string, payload?: unknown): Promise<unknown> {
  try {
    return await host.call(name, payload ?? {});
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}

/** 宿主日志通道是单向通知：不等应答，也不会因为写不进去而拖住页面。 */
function logInfo(message: string): void {
  log("info", message);
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => resolve(), ms);
  });
}

export default function DevWorkbench() {
  const projects = signal<Project[]>([]);
  const selectedRoot = signal<string | null>(null);
  const query = signal("");
  const loading = signal(true);
  const refreshing = signal(false);
  const error = signal<string | null>(null);
  const status = signal<string | null>(null);
  const picking = signal(false);
  const busy = signal(false);
  const confirmRemove = signal(false);
  const openingApp = signal<string | null>(null);
  const logRoot = signal<string | null>(null);
  const logLines = signal<string[]>([]);
  const logTail = signal(200);
  const logAuto = signal(false);
  const logLoading = signal(false);

  /** 自动刷新的 interval；组件只挂载一次，闭包变量就够了。 */
  let logTimer: number | null = null;
  /** 上一次「取列表」失败的信息：只有它还挂在 error 上时才由成功的刷新清除，
   *  避免把「打开工程失败」这类操作错误的提示顺手抹掉。 */
  let listError: string | null = null;

  // ---- 数据 ---------------------------------------------------------

  async function refresh() {
    if (refreshing()) return;
    refreshing.set(true);
    try {
      const result = await callHost("navop.dev.list");
      const list = Array.isArray(result) ? (result as Project[]) : (arr(result, "projects") as Project[]);
      projects.set(list);
      if (listError !== null && error() === listError) error.set(null);
      listError = null;
      const roots = list.map(projectRoot).filter((root) => root.length > 0);
      const current = selectedRoot();
      if (current === null || !roots.includes(current)) {
        selectedRoot.set(roots.length > 0 ? roots[0]! : null);
      }
      const openLog = logRoot();
      if (openLog !== null && !roots.includes(openLog)) closeLogs();
    } catch (failure) {
      listError = errorMessage(failure);
      error.set(listError);
    } finally {
      loading.set(false);
      refreshing.set(false);
    }
  }

  function visibleProjects(): Project[] {
    const needle = query().trim().toLowerCase();
    if (needle.length === 0) return projects();
    return projects().filter((project) =>
      `${projectName(project)} ${projectRoot(project)}`.toLowerCase().includes(needle),
    );
  }

  function currentProject(): Project | null {
    const root = selectedRoot();
    if (root === null) return null;
    return projects().find((project) => projectRoot(project) === root) ?? null;
  }

  function summaryLine(): string {
    const list = projects();
    const watching = list.filter(projectWatching).length;
    return `${list.length} 个工程 · ${watching} 个监听中`;
  }

  // ---- 操作 ---------------------------------------------------------

  /** 添加工程：宿主先开系统目录选择器（立刻返回 pending），再轮询取结果。 */
  async function addProject() {
    if (picking()) return;
    picking.set(true);
    status.set(null);
    try {
      await callHost("navop.dev.pickDirectory");
      const picked = await waitForPick();
      if (picked === null) {
        status.set("等待目录选择超时，可以再点一次「添加工程…」。");
        return;
      }
      if (picked.trim().length === 0) return; // 用户取消了选择
      await openProjectPath(picked);
    } catch (failure) {
      error.set(errorMessage(failure));
    } finally {
      picking.set(false);
    }
  }

  /** 每 250ms 问一次 pickResult（最多约两分钟）；取消时宿主给的是空字符串。 */
  async function waitForPick(): Promise<string | null> {
    for (let attempt = 0; attempt < 480; attempt += 1) {
      if (attempt > 0) await delay(250);
      const picked = await callHost("navop.dev.pickResult");
      if (picked === null || picked === undefined) continue;
      return typeof picked === "string" ? picked : String(picked);
    }
    return null;
  }

  async function openProjectPath(root: string) {
    status.set(null);
    try {
      const result = await callHost("navop.dev.open", { root });
      const reason = failureOf(result);
      if (reason !== null) {
        error.set(reason);
      } else {
        error.set(null);
        selectedRoot.set(root);
        status.set(`已加载工程 ${root}`);
        void logInfo(`dev project loaded: ${root}`);
      }
    } catch (failure) {
      error.set(errorMessage(failure));
    }
    await refresh();
  }

  async function reloadProject(project: Project) {
    const root = projectRoot(project);
    if (root.length === 0 || busy()) return;
    busy.set(true);
    status.set(null);
    try {
      const result = await callHost("navop.dev.reload", { root });
      const reason = failureOf(result);
      if (reason !== null) {
        error.set(reason);
      } else {
        error.set(null);
        status.set(`已重新加载 ${projectName(project)}`);
        void logInfo(`dev project reloaded: ${root}`);
      }
    } catch (failure) {
      error.set(errorMessage(failure));
    } finally {
      busy.set(false);
    }
    await refresh();
  }

  async function toggleWatch(project: Project) {
    const root = projectRoot(project);
    if (root.length === 0 || busy()) return;
    busy.set(true);
    status.set(null);
    try {
      const result = await callHost("navop.dev.watch", { root });
      const reason = failureOf(result);
      if (reason !== null) {
        error.set(reason);
      } else {
        const watching = result !== null && typeof result === "object" && (result as Project).watching === true;
        error.set(null);
        status.set(watching ? `已开始监听 ${projectName(project)} 的文件变化` : `已停止监听 ${projectName(project)}`);
        void logInfo(`dev watch ${watching ? "started" : "stopped"}: ${root}`);
      }
    } catch (failure) {
      error.set(errorMessage(failure));
    } finally {
      busy.set(false);
    }
    await refresh();
  }

  async function removeProject(project: Project) {
    const root = projectRoot(project);
    if (root.length === 0 || busy()) return;
    busy.set(true);
    try {
      const result = await callHost("navop.dev.remove", { root });
      const reason = failureOf(result);
      if (reason !== null) {
        error.set(reason);
      } else {
        error.set(null);
        status.set(`已移除工程 ${root}`);
        if (selectedRoot() === root) selectedRoot.set(null);
        if (logRoot() === root) closeLogs();
        void logInfo(`dev project removed: ${root}`);
      }
    } catch (failure) {
      error.set(errorMessage(failure));
    } finally {
      busy.set(false);
      confirmRemove.set(false);
    }
    await refresh();
  }

  /**
   * 打开工程的 nsh app。新契约里一个工程只有一个 app，没有视图 id：
   * `navop.dev.openApp` 只收 extensionId（route 由 app 自己解释，这里不指定）。
   * 注意 ABI 的坑：宿主把 `root` 优先当第一个参数，但 dev::open_app 要的是
   * **extensionId**（它会自己补 dev 前缀），所以必须按字段名传 extensionId。
   */
  async function openAppOf(project: Project) {
    const extensionId = str(project, "id", "");
    if (extensionId.length === 0) {
      error.set("这个工程还没有加载成功，先点「重新加载」再打开应用。");
      return;
    }
    const app = projectApp(project);
    const title = app === null ? extensionId : app.title;
    openingApp.set(extensionId);
    status.set(null);
    try {
      await callHost("navop.dev.openApp", { extensionId });
      error.set(null);
      status.set(`已请求打开应用 ${title}`);
      void logInfo(`dev app opened: ${extensionId}`);
    } catch (failure) {
      error.set(errorMessage(failure));
    } finally {
      openingApp.set(null);
    }
  }

  // ---- 日志 ---------------------------------------------------------

  async function loadLogs(root: string, tail: number) {
    logLoading.set(true);
    try {
      const result = await callHost("navop.dev.logs", { root, tail });
      logLines.set(Array.isArray(result) ? result.map((line) => String(line)) : []);
    } catch (failure) {
      error.set(errorMessage(failure));
    } finally {
      logLoading.set(false);
    }
  }

  function showLogs(root: string) {
    logRoot.set(root);
    void loadLogs(root, logTail());
  }

  function closeLogs() {
    logRoot.set(null);
    logLines.set([]);
    logAuto.set(false);
    stopLogTimer();
  }

  function stopLogTimer() {
    if (logTimer !== null) {
      clearInterval(logTimer);
      logTimer = null;
    }
  }

  function setAutoRefresh(root: string, value: boolean) {
    logAuto.set(value);
    stopLogTimer();
    if (!value) return;
    void loadLogs(root, logTail());
    logTimer = setInterval(() => {
      const current = logRoot();
      if (current !== null) void loadLogs(current, logTail());
    }, 1000);
  }

  function selectProject(root: string) {
    if (selectedRoot() === root) return;
    const openLog = logRoot();
    if (openLog !== null && openLog !== root) closeLogs();
    selectedRoot.set(root);
  }

  // ---- 片段 ---------------------------------------------------------

  function feedback(): JSX.Element | null {
    if (error() !== null && projects().length > 0) {
      return (
        <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
          <Notice tone="danger" message={`操作失败：${error() ?? ""}`} />
        </View>
      );
    }
    if (status() !== null) {
      return (
        <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
          <Notice tone="ok" message={status() ?? ""} />
        </View>
      );
    }
    return null;
  }

  function headerBar(): JSX.Element {
    return (
      <Row
        wrap
        gap={8}
        style={{
          paddingHorizontal: 14,
          paddingVertical: 10,
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <Row gap={8}>
          <Text style={t.h1}>开发者工具</Text>
          <Text style={t.meta}>本地扩展工程调试</Text>
          <Text style={t.meta}>{summaryLine()}</Text>
        </Row>
        <Row gap={6}>
          {refreshing() ? <Text style={t.meta}>正在读取…</Text> : null}
          <Button
            label={picking() ? "选择目录中…" : "添加工程…"}
            tone="primary"
            small
            disabled={picking()}
            onPress={() => void addProject()}
          />
          <Button label="刷新" small onPress={() => void refresh()} />
        </Row>
      </Row>
    );
  }

  /**
   * 工程搜索框单独放这里：它不读 query()，只有 Input 的 value 属性自己
   * 跟随 query——这样每次输入不会重挂输入框（不会丢焦点/光标）。
   */
  function searchSlot(): JSX.Element {
    return (
      <View style={{ paddingHorizontal: 10, paddingTop: 10, paddingBottom: 6, display: "flex", flexDirection: "column", gap: 6 }}>
        <SearchField value={query()} onChange={(value) => query.set(value)} placeholder="按名称 / 路径过滤工程" />
        <Text style={t.meta}>{countLine()}</Text>
      </View>
    );
  }

  function countLine(): string {
    const list = visibleProjects().length;
    const total = projects().length;
    return list === total ? `共 ${total} 个工程` : `${list} / ${total} 个工程`;
  }

  function projectList(): JSX.Element {
    const list = visibleProjects();
    if (list.length === 0) {
      const filtering = query().trim().length > 0;
      return (
        <Empty
          title={filtering ? "没有匹配的工程" : "还没有加载开发工程"}
          hint={
            filtering
              ? "清空搜索词，或换一段名称 / 路径再试。"
              : "点右上角「添加工程…」，选一个包含 extension.json 的本地目录。"
          }
          action={filtering ? undefined : <Button label="添加工程…" small onPress={() => void addProject()} />}
        />
      );
    }
    return (
      <Scroll style={{ flex: 1, minHeight: 0, paddingHorizontal: 6, paddingBottom: 8 }}>
        <View style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {list.map((project) => projectRow(project))}
        </View>
      </Scroll>
    );
  }

  function projectRow(project: Project): JSX.Element {
    const root = projectRoot(project);
    const failed = failureOf(project) !== null;
    const app = projectApp(project);
    return (
      <View
        onPress={() => selectProject(root)}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 3,
          paddingHorizontal: 9,
          paddingVertical: 7,
          borderRadius: r.control,
          backgroundColor: selectedRoot() === root ? c.hover() : "transparent",
        }}
      >
        <Row gap={6}>
          <Text
            numberOfLines={1}
            style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: "500", color: failed ? c.danger() : c.text() }}
          >
            {projectName(project)}
          </Text>
          {failed ? <Badge text="加载失败" tone="danger" /> : null}
          {projectWatching(project) ? <Badge text="监听中" tone="ok" /> : null}
          {app === null ? <Badge text="无 nsh app" /> : <Badge text="nsh app" />}
        </Row>
        <Text numberOfLines={1} ellipsizeMode="middle" style={{ ...t.mono, fontSize: 11, color: c.muted() }}>
          {root.length > 0 ? root : "（未加载）"}
        </Text>
      </View>
    );
  }

  function actions(project: Project): JSX.Element {
    const root = projectRoot(project);
    const watching = projectWatching(project);
    const logsOpen = logRoot() === root;
    return (
      <Row wrap gap={6}>
        <Button label="重新加载" small disabled={busy()} onPress={() => void reloadProject(project)} />
        <Button
          label={watching ? "停止监听" : "开始监听"}
          small
          disabled={busy()}
          onPress={() => void toggleWatch(project)}
        />
        <Button
          label={logsOpen ? "隐藏日志" : "查看日志"}
          small
          onPress={() => {
            if (logsOpen) closeLogs();
            else showLogs(root);
          }}
        />
        <View style={{ flex: 1 }} />
        <Button label="移除工程" small tone="danger" disabled={busy()} onPress={() => confirmRemove.set(true)} />
      </Row>
    );
  }

  function appSection(project: Project): JSX.Element {
    const app = projectApp(project);
    return (
      <View style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SectionTitle title="nsh 应用" hint={app === null ? "未声明" : "1 个"} />
        {app === null ? (
          <Text style={t.meta}>
            {failureOf(project) === null
              ? "这个工程的 extension.json 里没有声明 shellApp。"
              : "工程还没加载成功：先点「重新加载」，再打开应用。"}
          </Text>
        ) : (
          appRow(project, app)
        )}
      </View>
    );
  }

  function appRow(project: Project, app: { title: string }): JSX.Element {
    const extensionId = str(project, "id", "");
    const opening = openingApp() === extensionId;
    return (
      <Row
        gap={10}
        style={{ paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: c.line(), borderRadius: r.control }}
      >
        <View style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "500", color: c.text() }}>
            {app.title}
          </Text>
          <Text numberOfLines={1} style={{ ...t.mono, fontSize: 11, color: c.muted() }}>
            {`${extensionId} · 单应用，route 由 app 自己解释`}
          </Text>
        </View>
        <Button
          label={opening ? "打开中…" : "打开"}
          tone="primary"
          small
          disabled={opening || extensionId.length === 0}
          onPress={() => void openAppOf(project)}
        />
      </Row>
    );
  }

  function detailPane(): JSX.Element {
    const project = currentProject();
    if (project === null) {
      return (
        <Empty
          title="从左侧选择一个开发工程"
          hint="选中后可以查看 nsh 应用、重新加载、监听文件变化，并查看宿主的操作日志。"
        />
      );
    }
    const root = projectRoot(project);
    const failed = failureOf(project);
    const version = str(project, "version", "");
    return (
      <Scroll style={{ flex: 1, minHeight: 0 }}>
        <View style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <Row wrap gap={8}>
            <Text style={t.h2}>{projectName(project)}</Text>
            {version.length > 0 ? <Badge text={`v${version}`} /> : null}
            {failed !== null ? (
              <Badge text="加载失败" tone="danger" />
            ) : projectWatching(project) ? (
              <Badge text="监听中" tone="ok" />
            ) : (
              <Badge text="就绪" />
            )}
          </Row>
          <Text selectable numberOfLines={2} style={{ ...t.mono, fontSize: 12, color: c.muted() }}>
            {root}
          </Text>
          {failed === null ? null : <Notice tone="danger" message={failed} />}
          {actions(project)}
          {confirmRemove() ? (
            <ConfirmBar
              message={`移除开发工程 ${root}？只从工作台卸载，不会删除磁盘上的文件。`}
              confirmLabel="确认移除"
              busy={busy()}
              onConfirm={() => void removeProject(project)}
              onCancel={() => confirmRemove.set(false)}
            />
          ) : null}
          <View style={hairline()} />
          {appSection(project)}
          {logRoot() === root ? logSection(project) : null}
        </View>
      </Scroll>
    );
  }

  function logSection(project: Project): JSX.Element {
    const root = projectRoot(project);
    const lines = logLines();
    return (
      <View style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SectionTitle title="操作日志" hint={`${lines.length} 行`} right={logControls(root)} />
        <View
          style={{
            height: 240,
            borderRadius: r.control,
            backgroundColor: c.panel(),
            borderWidth: 1,
            borderColor: c.line(),
            padding: 8,
          }}
        >
          <Scroll style={{ flex: 1, minHeight: 0 }}>
            {lines.length === 0 ? (
              <Text style={t.meta}>{logLoading() ? "正在读取日志…" : "（暂无日志：打开或重新加载工程后这里会有记录）"}</Text>
            ) : (
              lines.map((line) => (
                <Text selectable numberOfLines={1} style={{ ...t.mono, fontSize: 11, color: c.text() }}>
                  {line}
                </Text>
              ))
            )}
          </Scroll>
        </View>
        <Text style={t.meta}>
          日志来自宿主的 DevLogRing；「自动刷新」每秒按当前档位拉一次，只保留最近 tail 行。
        </Text>
      </View>
    );
  }

  function logControls(root: string): JSX.Element {
    return (
      <Row wrap gap={4}>
        {LOG_TAILS.map((size) => (
          <Button
            label={String(size)}
            small
            tone={logTail() === size ? "primary" : "ghost"}
            onPress={() => {
              logTail.set(size);
              void loadLogs(root, size);
            }}
          />
        ))}
        <Button label="刷新日志" small onPress={() => void loadLogs(root, logTail())} />
        {autoRefreshToggle(root)}
        <Button label="关闭" small onPress={() => closeLogs()} />
      </Row>
    );
  }

  /** 开关形状的胶囊；函数调用（不是组件），这样 on 变化会重建、标签才跟得上。 */
  function autoRefreshToggle(root: string): JSX.Element {
    const on = logAuto();
    return (
      <View
        onPress={() => setAutoRefresh(root, !on)}
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: r.pill,
          borderWidth: 1,
          borderColor: on ? c.accent() : c.line(),
        }}
      >
        <View
          style={{
            width: 22,
            height: 12,
            borderRadius: r.pill,
            backgroundColor: on ? c.accent() : c.line(),
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: on ? "flex-end" : "flex-start",
            padding: 2,
          }}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: r.pill,
              backgroundColor: on ? c.accentText() : c.panel(),
            }}
          />
        </View>
        <Text style={{ fontSize: 11, color: on ? c.text() : c.muted() }}>{`自动刷新${on ? "开" : "关"}`}</Text>
      </View>
    );
  }

  function body(): JSX.Element {
    if (loading() && error() === null) {
      return <Loading label="正在读取开发工程…" />;
    }
    if (error() !== null && projects().length === 0) {
      return (
        <View
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <LoadError message={error() ?? ""} onRetry={() => void refresh()} />
        </View>
      );
    }
    return (
      <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "row" }}>
        <View
          style={{
            width: 300,
            flexShrink: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            borderRightWidth: 1,
            borderRightColor: c.line(),
          }}
        >
          {searchSlot()}
          {projectList()}
        </View>
        <View style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {detailPane()}
        </View>
      </View>
    );
  }

  void refresh();

  return (
    <View style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", backgroundColor: c.bg() }}>
      {headerBar()}
      <View style={hairline()} />
      {feedback()}
      {body()}
    </View>
  );
}
