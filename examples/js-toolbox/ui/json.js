import { View, div } from 'gpui';
import { v_flex, h_flex, Input, InputState } from 'gpui-base';
import { Button, ErrorAlert, Separator } from 'gpui-component';
import { info, error as logError } from 'navop.log';

export default class JsonTools extends View {
  /** @type {any} */
  input;
  /** @type {string} */
  result = '';
  /** @type {string | null} */
  error = null;

  /**
   * @param {unknown} _props
   * @param {import('gpui').AsyncContext} _cx
   */
  init(_props, _cx) {
    this.input = InputState.new({ placeholder: '粘贴或输入 JSON…' });
  }

  /**
   * @param {string} kind
   * @param {import('gpui').Context} cx
   */
  run(kind, cx) {
    const source = this.input.value();
    try {
      if (kind === 'format') {
        this.result = JSON.stringify(JSON.parse(source), null, 2);
      } else if (kind === 'minify') {
        this.result = JSON.stringify(JSON.parse(source));
      } else if (kind === 'escape') {
        this.result = JSON.stringify(source);
      } else if (kind === 'unescape') {
        this.result = String(JSON.parse(source));
      }
      this.error = null;
      info(`json ${kind} ok`);
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.result = '';
      logError(`json ${kind} failed: ${this.error}`);
    }
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
        v_flex()
          .gap(4)
          .child(div().text_lg().font_semibold().child('JSON Tools'))
          .child(
            div()
              .text_sm()
              .text_color(theme.muted_foreground)
              .child('格式化、压缩与转义 JSON 文本'),
          ),
      )
      .child(
        v_flex()
          .flex_1()
          .min_h_0()
          .gap(6)
          .child(div().text_xs().font_medium().text_color(theme.muted_foreground).child('输入'))
          .child(Input.new(this.input).flex_1().min_h_0()),
      )
      .child(
        h_flex()
          .gap(8)
          .child(new Button('json-format').label('格式化').primary().size('small').on_click((_e, cx) => this.run('format', cx)))
          .child(new Button('json-minify').label('压缩').outline().size('small').on_click((_e, cx) => this.run('minify', cx)))
          .child(new Button('json-escape').label('转义').outline().size('small').on_click((_e, cx) => this.run('escape', cx)))
          .child(new Button('json-unescape').label('反转义').outline().size('small').on_click((_e, cx) => this.run('unescape', cx))),
      )
      .when(this.error, (el) => el.child(new ErrorAlert('json-error', String(this.error)).banner()))
      .child(new Separator())
      .child(
        v_flex()
          .flex_1()
          .min_h_0()
          .gap(6)
          .child(div().text_xs().font_medium().text_color(theme.muted_foreground).child('结果'))
          .child(
            div()
              .flex_1()
              .min_h_0()
              .rounded(8)
              .bg(theme.muted)
              .p(10)
              .overflow_y_scroll()
              .child(
                div()
                  .text_xs()
                  .font_family(theme.typography.mono)
                  .whitespace_nowrap()
                  .child(this.result || '—'),
              ),
          ),
      );
  }
}
