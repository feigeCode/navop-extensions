import { View, div } from 'gpui';
import { v_flex } from 'gpui-base';
import { current } from 'navop.context';
import { invoke } from 'navop.resource';
import { info } from 'navop.log';

export default class ToolView extends View {
  /**
   * @param {unknown} _props
   * @param {import('gpui').AsyncContext} cx
   */
  init(_props, cx) {
    this.context = current();
    this.data = null;
    this.error = null;
    cx.spawn(async (cx) => {
      try {
        const connection = this.context.connection;
        if (!connection) {
          this.error = 'no connection';
        } else {
          const result = await invoke(
            connection.resource.handle,
            'my-provider/item/list',
            {},
          );
          this.data = result.kind === 'inline' ? result.value : result;
        }
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
      }
      info('tool view loaded');
      cx.notify();
    });
  }

  /** @param {import('gpui').Context} cx */
  render(cx) {
    return v_flex()
      .size_full()
      .p(16)
      .gap(12)
      .child(div().font_semibold().child(this.context.connection?.name || 'Tool'))
      .child(this.error || JSON.stringify(this.data, null, 2));
  }
}
