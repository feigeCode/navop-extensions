import { View, div } from 'gpui';
import { v_flex, h_flex } from 'gpui-base';
import { Button } from 'gpui-component';
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
  /** @type {string | null} */
  selectedRoot = null;
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
    this.refresh(cx);
    this.startPickPolling(cx);
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
    try {
      this.logLines = logs(root, 200);
      this.logRoot = root;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
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
      .p(16)
      .gap(12)
      .child(div().font_semibold().text_size(18).child('开发者工具'))
      .child(div().text_sm().text_color(cx.theme().muted_foreground).child('扩展工程调试'))
      .child(
        h_flex()
          .gap(8)
          .child(
            new Button('dev-pick-dir')
              .label(this.picking ? '选择目录中…' : '添加工程…')
              .primary()
              .on_click((_e, cx) => this.chooseDirectory(cx))
              .disabled(this.picking),
          )
          .child(
            new Button('dev-refresh')
              .label('刷新')
              .ghost()
              .on_click((_e, cx) => this.refresh(cx)),
          ),
      )
      .when(this.error, (el) => el.child(div().text_color(cx.theme().destructive).child(this.error)))
      .when(this.status, (el) => el.child(div().text_sm().text_color(cx.theme().accent).child(this.status)))
      .child(this.renderWorkspace(cx));
  }

  /** @param {import('gpui').Context} cx */
  renderWorkspace(cx) {
    const selected = this.projects.find((project) => project.root === this.selectedRoot);
    return h_flex()
      .flex_1()
      .min_h_0()
      .gap(16)
      .child(this.renderProjectList(cx))
      .child(selected ? this.renderProjectDetails(selected, cx) : div().flex_1().child('请选择一个开发工程。'));
  }

  /** @param {import('gpui').Context} cx */
  renderProjectList(cx) {
    return v_flex()
      .w(260)
      .flex_shrink_0()
      .gap(6)
      .children(this.projects.map((project) =>
        new Button(`dev-select-${project.root}`)
          .label(`${project.name || '未命名工程'}${project.error ? ' · 加载失败' : ''}`)
          .ghost()
          .on_click((_event, cx) => {
            this.selectedRoot = project.root;
            cx.notify();
          }),
      ));
  }

  /**
   * @param {any} project
   * @param {import('gpui').Context} cx
   */
  renderProjectDetails(project, cx) {
    const views = project.views || [];
    return v_flex()
      .flex_1()
      .min_w_0()
      .min_h_0()
      .gap(10)
      .child(h_flex().gap(8).child(div().font_semibold().child(project.name)).child(div().text_color(cx.theme().muted_foreground).child(`v${project.version}`)))
      .child(div().text_sm().text_color(cx.theme().muted_foreground).child(project.root))
      .child(div().text_sm().child(project.error ? `状态：加载失败 · ${project.error}` : `状态：${project.watching ? '监听中' : '就绪'}`))
      .child(h_flex().gap(8)
        .child(new Button(`dev-watch-${project.root}`).label(project.watching ? '停止监听' : '开启监听').ghost().on_click((_event, cx) => this.toggleWatch(project.root, cx)))
        .child(new Button(`dev-reload-${project.root}`).label('重新加载').ghost().on_click((_event, cx) => this.reloadProject(project.root, cx)))
        .child(new Button(`dev-remove-${project.root}`).label('移除工程').ghost().on_click((_event, cx) => this.removeProject(project.root, cx)))
        .child(new Button(`dev-logs-${project.root}`).label('刷新日志').ghost().on_click((_event, cx) => this.showLogs(project.root, cx))))
      .child(div().font_semibold().child('扩展视图'))
      .child(v_flex().gap(6).children(views.map(
        /** @param {any} view */ (view) =>
        h_flex().gap(8).child(div().flex_1().child(`${view.title} · ${view.surface}`)).child(
          new Button(`dev-open-${project.id}-${view.id}`).label('打开').on_click((_event, cx) => this.launchView(project.id, view.id, cx)).disabled(Boolean(project.error)),
        ),
      )))
      .when(this.logRoot === project.root, (el) => el.child(div().max_h(180).overflow_y_scroll().child(this.logLines.length ? div().children(this.logLines.map((line) => div().text_xs().child(line))) : div().text_xs().child('（无日志）'))));
  }
}
