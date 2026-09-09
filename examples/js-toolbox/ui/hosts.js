import { readFile, writeFile } from 'fs/promises';
import { View, div } from 'gpui';
import { v_flex, h_flex, Input, InputState } from 'gpui-base';
import { Button, ErrorAlert } from 'gpui-component';
import { info, error as logError } from 'navop.log';

const HOSTS_PATH = '/etc/hosts';

export default class HostsEditor extends View {
  /** @type {any} */
  content;
  /** @type {boolean} */
  loaded = false;
  /** @type {string | null} */
  error = null;
  /** @type {boolean} */
  saving = false;

  /**
   * @param {unknown} _props
   * @param {import('gpui').AsyncContext} cx
   */
  init(_props, cx) {
    this.content = InputState.new({ placeholder: 'hosts content' });
    cx.spawn(async (cx) => this.load(cx));
  }

  /**
   * @param {import('gpui').AsyncContext} cx
   */
  async load(cx) {
    try {
      this.content.set_value(await readFile(HOSTS_PATH, 'utf8'));
      this.loaded = true;
      this.error = null;
    } catch (e) {
      this.error = `读取 ${HOSTS_PATH} 失败：${e instanceof Error ? e.message : String(e)}`;
    }
    cx.notify();
  }

  /**
   * @param {import('gpui').AsyncContext} cx
   */
  async save(cx) {
    this.saving = true;
    cx.notify();
    try {
      await writeFile(HOSTS_PATH, this.content.value());
      this.error = null;
      info('hosts saved');
    } catch (e) {
      this.error = `写入 ${HOSTS_PATH} 失败：${e instanceof Error ? e.message : String(e)}`;
      logError(`hosts save failed: ${this.error}`);
    }
    this.saving = false;
    cx.notify();
  }

  /**
   * @param {import('gpui').Context} cx
   */
  render(cx) {
    const theme = cx.theme();
    return v_flex()
      .size_full()
      .p(20)
      .gap(14)
      .child(
        h_flex()
          .items_center()
          .gap(8)
          .child(div().text_lg().font_semibold().child('Hosts Editor'))
          .child(
            div()
              .text_xs()
              .font_family(theme.typography.mono)
              .text_color(theme.muted_foreground)
              .child(HOSTS_PATH),
          )
          .child(div().flex_1())
          .child(
            new Button('hosts-reload')
              .label('重新加载')
              .outline()
              .size('small')
              .on_click((_e, cx) => cx.spawn(async (cx) => this.load(cx))),
          )
          .child(
            new Button('hosts-save')
              .label(this.saving ? '保存中…' : '保存')
              .primary()
              .size('small')
              .loading(this.saving)
              .disabled(this.saving || !this.loaded)
              .on_click((_e, cx) => cx.spawn(async (cx) => this.save(cx))),
          ),
      )
      .when(this.error, (el) => el.child(new ErrorAlert('hosts-error', String(this.error)).banner()))
      .child(
        div()
          .flex_1()
          .min_h_0()
          .border_1()
          .border_color(theme.border)
          .rounded(8)
          .p(8)
          .when(this.loaded, (el) =>
            el.child(Input.new(this.content).size_full()),
          )
          .when(!this.loaded && !this.error, (el) =>
            el.child(div().text_sm().text_color(theme.muted_foreground).child('加载中…')),
          ),
      );
  }
}
