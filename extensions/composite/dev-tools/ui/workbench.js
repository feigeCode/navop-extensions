import { View, div } from 'gpui';
import { v_flex, h_flex } from 'gpui-base';
import { Button, Input, InputState } from 'gpui-component';
import { list, open, remove, openView, reload } from 'navop.dev';
import { info, error as logError } from 'navop.log';

export default class DevWorkbench extends View {
  /** @type {any} */
  pathInput;
  /** @type {any[]} */
  projects = [];
  /** @type {string | null} */
  error = null;

  /**
   * @param {unknown} _props
   * @param {import('gpui').AsyncContext} cx
   */
  init(_props, cx) {
    this.pathInput = InputState('本地工程目录（含 extension.json）');
    this.refresh(cx);
  }

  /**
   * @param {import('gpui').AsyncContext} cx
   */
  refresh(cx) {
    try {
      this.projects = list();
      this.error = null;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      logError(`dev list failed: ${this.error}`);
    }
    cx.notify();
  }

  /**
   * @param {import('gpui').AsyncContext} cx
   */
  loadProject(cx) {
    const root = this.pathInput.value().trim();
    if (!root) {
      this.error = '请输入工程目录';
      cx.notify();
      return;
    }
    try {
      const result = open(root);
      if (result && result.error) {
        this.error = result.error;
      } else {
        this.error = null;
        info(`dev project loaded: ${result && result.id}`);
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
    try {
      openView(extensionId, viewId);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      cx.notify();
    }
  }

  /**
   * @param {string} root
   * @param {import('gpui').AsyncContext} cx
   */
  reloadProject(root, cx) {
    try {
      const result = reload(root);
      if (result && result.error) {
        this.error = result.error;
      } else {
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
  removeProject(root, cx) {
    try {
      remove(root);
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
      .child(div().font_semibold().text_size(16).child('开发者工具 · 扩展工程调试'))
      .child(
        h_flex()
          .gap(8)
          .child(new Input(this.pathInput).aria_label('project root').flex_1())
          .child(
            new Button('dev-load')
              .label('加载')
              .on_click((_e, cx) => cx.spawn(async (cx) => this.loadProject(cx))),
          )
          .child(
            new Button('dev-refresh')
              .label('刷新')
              .on_click((_e, cx) => cx.spawn(async (cx) => this.refresh(cx))),
          ),
      )
      .when(this.error, (el) =>
        el.child(div().text_color('#cc0000').whitespace_nowrap().child(this.error)),
      )
      .children(
        this.projects.map(
          /** @param {any} project */ (project) => this.renderProject(project, cx),
        ),
      );
  }

  /**
   * @param {any} project
   * @param {import('gpui').Context} cx
   */
  renderProject(project, cx) {
    const views = project.views || [];
    return v_flex()
      .id(`dev-project-${project.root}`)
      .border_1()
      .border_color(cx.theme().border ?? '#888888')
      .rounded(8)
      .p(12)
      .gap(8)
      .child(
        h_flex()
          .gap(8)
          .child(div().font_semibold().child(project.error ? '⚠︎ ' + project.name : project.name))
          .child(div().text_color('#888888').child(`v${project.version}`))
          .child(div().text_color('#888888').child(project.root))
          .child(
            new Button(`dev-reload-${project.root}`)
              .label('Reload')
              .ghost()
              .on_click((_e, cx) => cx.spawn(async (cx) => this.reloadProject(project.root, cx))),
          )
          .child(
            new Button(`dev-remove-${project.root}`)
              .label('移除')
              .ghost()
              .on_click((_e, cx) => cx.spawn(async (cx) => this.removeProject(project.root, cx))),
          ),
      )
      .when(project.error, (el) =>
        el
          .child(div().text_color('#cc0000').whitespace_nowrap().child(project.error))
          .child(
            new Button(`dev-reload-${project.root}`)
              .label('重试加载')
              .on_click((_e, cx) => cx.spawn(async (cx) => this.loadProject(cx))),
          ),
      )
      .when(views.length > 0, (el) =>
        el.child(
          h_flex()
            .gap(8)
            .children(
              views.map(
                /** @param {any} view */ (view) =>
                  new Button(`dev-open-${project.id}-${view.id}`)
                    .label(`打开 ${view.title}`)
                    .on_click((_e, cx) =>
                      cx.spawn(async (cx) => this.launchView(project.id, view.id, cx)),
                    ),
              ),
            ),
        ),
      );
  }
}
