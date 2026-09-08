import { readFile, writeFile } from 'fs/promises';
import { View, div } from 'gpui';
import { v_flex, h_flex, Input, InputState } from 'gpui-base';
import { Button } from 'gpui-component';
import { info, error as logError } from 'navop.log';

const HOSTS_PATH = '/etc/hosts';

/**
 * @param {any} el
 * @param {unknown} error
 */
function renderError(el, error) {
  return el.child(
    div().text_color('#cc0000').child(error === null || error === undefined ? '' : String(error)),
  );
}

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
      this.error = `read ${HOSTS_PATH} failed: ${e instanceof Error ? e.message : String(e)}`;
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
      this.error = `write ${HOSTS_PATH} failed: ${e instanceof Error ? e.message : String(e)}`;
      logError(`hosts save failed: ${this.error}`);
    }
    this.saving = false;
    cx.notify();
  }

  /**
   * @param {import('gpui').Context} cx
   */
  render(cx) {
    return v_flex()
      .size_full()
      .p(16)
      .gap(12)
      .child(div().font_semibold().child(`Hosts — ${HOSTS_PATH}`))
      .when(this.error, (el) => renderError(el, this.error))
      .when(this.loaded, (el) => el.child(Input.new(this.content).flex_1().min_h_0()))
      .child(
        h_flex()
          .gap(8)
          .child(
            new Button('hosts-reload').label('Reload').on_click((_e, cx) =>
              cx.spawn(async (cx) => this.load(cx)),
            ),
          )
          .child(
            new Button('hosts-save')
              .label('Save')
              .disabled(this.saving)
              .on_click((_e, cx) => cx.spawn(async (cx) => this.save(cx))),
          ),
      );
  }
}
