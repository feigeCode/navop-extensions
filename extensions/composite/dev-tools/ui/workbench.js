import { View, div } from 'gpui';
import { v_flex, h_flex, Input, InputState } from 'gpui-base';
import { Button, ErrorAlert, InfoAlert, Separator, Switch, Tag } from 'gpui-component';
import {
  list,
  logs,
  open,
  openView,
  pickDirectory,
  pickResult,
  reload,
  remove,
  watch,
} from 'navop.dev';
import { info, error as logError } from 'navop.log';

export default class DevWorkbench extends View {
  /** @type {any[]} */
  projects = [];
  /** @type {string | null} */
  error = null;
  /** @type {string | null} */
  logRoot = null;
  /** @type {string[]} */
  logLines = [];
  /** @type {boolean} */
  logAutoRefresh = false;
  /** @type {string | null} */
  selectedRoot = null;
  /** @type {import('gpui-base').InputState | null} */
  search = null;
  /** @type {boolean} */
  picking = false;
  /** @type {string | null} */
  openingView = null;
  /** @type {string | null} */
  status = null;

  /**
   * @param {unknown} _props
   * @param {import('gpui').AsyncContext} cx
   */
  init(_props, cx) {
    this.search = InputState.new({ placeholder: '搜索工程…' });
    this.search.on('change', (_event, cx) => cx.notify());
    this.refresh(cx);
    this.startPickPolling(cx);
    this.startLogPolling(cx);
  }

  /**
   * @param {import('gpui').AsyncContext} cx
   */
  startPickPolling(cx) {
    cx.timer.every(400, () => {
      const picked = pickResult();
      if (picked !== null && this.picking) {
        this.picking = false;
        if (String(picked).trim()) {
          this.loadProjectPath(String(picked), cx);
        } else {
          cx.notify();
        }
      }
    });
  }

  /**
   * 日志面板打开且自动刷新开启时，每秒拉取最新日志。
   * @param {import('gpui').AsyncContext} cx
   */
  startLogPolling(cx) {
    cx.timer.every(1000, () => {
      if (this.logAutoRefresh && this.logRoot) {
        this.refreshLogLines();
        cx.notify();
      }
    });
  }

  /** 重新读取当前日志面板的日志（不改变选中态）。 */
  refreshLogLines() {
    if (!this.logRoot) return;
    try {
      this.logLines = logs(this.logRoot, 200);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  /**
   * @param {boolean} enabled
   * @param {import('gpui').Context} cx
   */
  setLogAutoRefresh(enabled, cx) {
    this.logAutoRefresh = enabled;
    if (enabled) this.refreshLogLines();
    cx.notify();
  }

  /** @param {import('gpui').Context} cx */
  closeLogs(cx) {
    this.logRoot = null;
    this.logLines = [];
    this.logAutoRefresh = false;
    cx.notify();
  }

  /**
   * @param {import('gpui').AsyncContext} cx
   */
  refresh(cx) {
    try {
      this.projects = list();
      if (!this.selectedRoot || !this.projects.some((project) => project.root === this.selectedRoot)) {
        this.selectedRoot = this.projects[0]?.root ?? null;
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      logError(`dev list failed: ${this.error}`);
    }
    cx.notify();
  }

  /**
   * @param {import('gpui').AsyncContext} cx
   */
  chooseDirectory(cx) {
    try {
      pickDirectory();
      this.picking = true;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
    cx.notify();
  }

  /**
   * @param {string} root
   * @param {import('gpui').AsyncContext} cx
   */
  loadProjectPath(root, cx) {
    try {
      const result = open(root);
      if (!result?.error) {
        this.error = null;
        this.selectedRoot = root;
        info(`dev project loaded: ${result && result.id}`);
      } else {
        this.selectedRoot = root;
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
    this.refresh(cx);
  }

  /**
   * @param {string} extensionId
   * @param {string} viewId
   * @param {import('gpui').AsyncContext} cx
   */
  launchView(extensionId, viewId, cx) {
    const viewKey = `${extensionId}/${viewId}`;
    this.openingView = viewKey;
    this.status = null;
    try {
      openView(extensionId, viewId);
      this.status = `已请求打开 ${viewId}`;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
    this.openingView = null;
    cx.notify();
  }

  /**
   * @param {string} root
   * @param {import('gpui').AsyncContext} cx
   */
  reloadProject(root, cx) {
    try {
      const result = reload(root);
      if (!result?.error) {
        this.error = null;
        info(`dev project reloaded: ${root}`);
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
    this.refresh(cx);
  }

  /**
   * @param {string} root
   * @param {import('gpui').AsyncContext} cx
   */
  showLogs(root, cx) {
    this.logRoot = root;
    this.refreshLogLines();
    cx.notify();
  }

  /**
   * @param {string} root
   * @param {import('gpui').AsyncContext} cx
   */
  toggleWatch(root, cx) {
    try {
      const result = watch(root);
      if (result && result.error) this.error = result.error;
      else info(`watch ${result.watching ? 'started' : 'stopped'}: ${root}`);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
    this.refresh(cx);
  }

  /**
   * @param {string} root
   * @param {import('gpui').AsyncContext} cx
   */
  removeProject(root, cx) {
    try {
      const result = remove(root);
      if (!result?.error && this.selectedRoot === root) this.selectedRoot = null;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
    this.refresh(cx);
  }

  /**
   * @param {import('gpui').Context} cx
   */
  render(cx) {
    return v_flex()
      .size_full()
      .child(this.renderHeader(cx))
      .when(this.error, (el) => el.child(new ErrorAlert('dev-error', String(this.error)).banner()))
      .when(!this.error && this.status, (el) => el.child(new InfoAlert('dev-status', String(this.status)).banner()))
      .child(this.renderWorkspace(cx));
  }

  /** @param {import('gpui').Context} cx */
  renderHeader(cx) {
    const theme = cx.theme();
    return h_flex()
      .w_full()
      .flex_shrink_0()
      .px(20)
      .py(12)
      .gap(10)
      .items_center()
      .border_b(1)
      .border_color(theme.border)
      .child(div().text_lg().font_semibold().child('开发者工具'))
      .child(div().text_xs().text_color(theme.muted_foreground).child('本地扩展工程调试'))
      .child(div().flex_1())
      .child(
        new Button('dev-pick-dir')
          .label(this.picking ? '选择目录中…' : '添加工程…')
          .primary()
          .size('small')
          .on_click((_e, cx) => this.chooseDirectory(cx))
          .disabled(this.picking),
      )
      .child(
        new Button('dev-refresh')
          .label('刷新')
          .outline()
          .size('small')
          .on_click((_e, cx) => this.refresh(cx)),
      );
  }

  /** @param {import('gpui').Context} cx */
  renderWorkspace(cx) {
    const theme = cx.theme();
    const query = (this.search?.value() ?? '').trim().toLowerCase();
    const visible = query
      ? this.projects.filter((project) =>
          `${project.name} ${project.root}`.toLowerCase().includes(query),
        )
      : this.projects;
    const selected = this.projects.find((project) => project.root === this.selectedRoot);
    return h_flex()
      .flex_1()
      .min_h_0()
      .child(this.renderProjectList(visible, cx))
      .child(
        selected
          ? this.renderProjectDetails(selected, cx)
          : v_flex()
              .flex_1()
              .items_center()
              .justify_center()
              .gap(6)
              .child(div().text_sm().text_color(theme.muted_foreground).child('请从左侧选择一个开发工程')),
      );
  }

  /**
   * @param {any[]} visible
   * @param {import('gpui').Context} cx
   */
  renderProjectList(visible, cx) {
    const theme = cx.theme();
    return v_flex()
      .w(272)
      .flex_shrink_0()
      .h_full()
      .border_r(1)
      .border_color(theme.border)
      .p(12)
      .gap(8)
      .child(this.search ? Input.new(this.search) : div())
      .child(
        div()
          .text_xs()
          .text_color(theme.muted_foreground)
          .child(`${visible.length} / ${this.projects.length} 个工程`),
      )
      .child(
        v_flex()
          .flex_1()
          .min_h_0()
          .gap(2)
          .children(visible.map((project) => this.renderProjectItem(project, cx))),
      );
  }

  /**
   * @param {any} project
   * @param {import('gpui').Context} cx
   */
  renderProjectItem(project, cx) {
    const theme = cx.theme();
    const selected = project.root === this.selectedRoot;
    const nameColor = project.error
      ? theme.destructive
      : selected
        ? theme.accent_foreground
        : theme.foreground;
    const rootColor = selected ? theme.accent_foreground : theme.muted_foreground;
    return div()
      .w_full()
      .rounded(8)
      .px(10)
      .py(7)
      .gap(2)
      .cursor_pointer()
      .when(selected, (el) => el.bg(theme.accent))
      .when(!selected, (el) => el.hover((h) => h.bg(theme.muted)))
      .child(
        div()
          .text_sm()
          .font_medium()
          .whitespace_nowrap()
          .text_color(nameColor)
          .child(project.name || '未命名工程'),
      )
      .child(div().text_xs().whitespace_nowrap().text_color(rootColor).child(project.root))
      .on_click((_event, cx) => {
        if (this.selectedRoot !== project.root) {
          this.closeLogs(cx);
        }
        this.selectedRoot = project.root;
        cx.notify();
      });
  }

  /**
   * @param {any} project
   * @param {import('gpui').Context} cx
   */
  renderProjectDetails(project, cx) {
    const theme = cx.theme();
    const views = project.views || [];
    const statusTag = project.error
      ? new Tag().variant('danger').size('small').child('加载失败')
      : project.watching
        ? new Tag().variant('success').size('small').child('监听中')
        : new Tag().variant('secondary').size('small').child('就绪');
    return v_flex()
      .flex_1()
      .min_w_0()
      .min_h_0()
      .overflow_y_scroll()
      .p(20)
      .gap(14)
      .child(
        h_flex()
          .items_center()
          .gap(8)
          .child(div().text_lg().font_semibold().child(project.name || '未命名工程'))
          .child(new Tag().variant('secondary').outline().size('small').child(`v${project.version}`))
          .child(statusTag),
      )
      .child(
        div()
          .text_xs()
          .font_family(theme.typography.mono)
          .text_color(theme.muted_foreground)
          .child(project.root),
      )
      .when(project.error, (el) =>
        el.child(div().text_xs().text_color(theme.destructive).child(String(project.error))),
      )
      .child(this.renderActions(project, cx))
      .child(new Separator())
      .child(div().text_sm().font_semibold().child('扩展视图'))
      .when(views.length === 0, (el) =>
        el.child(div().text_xs().text_color(theme.muted_foreground).child('（此工程未声明视图）')),
      )
      .child(
        v_flex()
          .gap(8)
          .children(
            views.map(
              /** @param {any} view */ (view) => this.renderViewRow(project, view, cx),
            ),
          ),
      )
      .when(this.logRoot === project.root, (el) => el.child(this.renderLogPane(project, cx)));
  }

  /**
   * @param {any} project
   * @param {import('gpui').Context} cx
   */
  renderActions(project, cx) {
    return h_flex()
      .gap(8)
      .items_center()
      .child(
        new Button(`dev-watch-${project.root}`)
          .label(project.watching ? '停止监听' : '开启监听')
          .outline()
          .size('small')
          .disabled(Boolean(project.error))
          .on_click((_event, cx) => this.toggleWatch(project.root, cx)),
      )
      .child(
        new Button(`dev-reload-${project.root}`)
          .label('重新加载')
          .outline()
          .size('small')
          .on_click((_event, cx) => this.reloadProject(project.root, cx)),
      )
      .child(
        new Button(`dev-logs-${project.root}`)
          .label(this.logRoot === project.root ? '隐藏日志' : '查看日志')
          .ghost()
          .size('small')
          .on_click((_event, cx) => {
            if (this.logRoot === project.root) {
              this.closeLogs(cx);
            } else {
              this.showLogs(project.root, cx);
            }
          }),
      )
      .child(div().flex_1())
      .child(
        new Button(`dev-remove-${project.root}`)
          .label('移除')
          .danger()
          .size('small')
          .on_click((_event, cx) => this.removeProject(project.root, cx)),
      );
  }

  /**
   * @param {any} project
   * @param {any} view
   * @param {import('gpui').Context} cx
   */
  renderViewRow(project, view, cx) {
    const theme = cx.theme();
    const viewKey = `${project.id}/${view.id}`;
    return h_flex()
      .items_center()
      .gap(10)
      .px(12)
      .py(9)
      .border_1()
      .border_color(theme.border)
      .rounded(8)
      .child(
        v_flex()
          .flex_1()
          .min_w_0()
          .gap(2)
          .child(div().text_sm().font_medium().child(view.title))
          .child(
            div()
              .text_xs()
              .text_color(theme.muted_foreground)
              .child(`${view.id} · ${view.surface}`),
          ),
      )
      .child(
        new Button(`dev-open-${project.id}-${view.id}`)
          .label(this.openingView === viewKey ? '打开中…' : '打开')
          .primary()
          .size('small')
          .on_click((_event, cx) => this.launchView(project.id, view.id, cx))
          .disabled(Boolean(project.error)),
      );
  }

  /**
   * @param {any} project
   * @param {import('gpui').Context} cx
   */
  renderLogPane(project, cx) {
    const theme = cx.theme();
    return v_flex()
      .gap(6)
      .child(
        h_flex()
          .items_center()
          .gap(8)
          .child(div().text_sm().font_semibold().child('操作日志'))
          .child(
            div()
              .text_xs()
              .text_color(theme.muted_foreground)
              .child(`${this.logLines.length} 行`),
          )
          .child(div().flex_1())
          .child(
            new Switch('dev-log-auto')
              .label('自动刷新')
              .checked(this.logAutoRefresh)
              .size('xsmall')
              .on_change((checked, cx) => this.setLogAutoRefresh(checked, cx)),
          )
          .child(
            new Button('dev-log-refresh')
              .label('刷新')
              .ghost()
              .size('xsmall')
              .on_click((_event, cx) => {
                this.refreshLogLines();
                cx.notify();
              }),
          )
          .child(
            new Button('dev-log-close')
              .label('关闭')
              .ghost()
              .size('xsmall')
              .on_click((_event, cx) => this.closeLogs(cx)),
          ),
      )
      .child(
        div()
          .rounded(8)
          .bg(theme.muted)
          .p(10)
          .max_h(220)
          .overflow_y_scroll()
          .child(
            this.logLines.length
              ? v_flex()
                  .gap(2)
                  .children(
                    this.logLines.map((line) =>
                      div()
                        .text_xs()
                        .font_family(theme.typography.mono)
                        .whitespace_nowrap()
                        .child(line),
                    ),
                  )
              : div().text_xs().text_color(theme.muted_foreground).child('（暂无日志）'),
          ),
      );
  }
}
