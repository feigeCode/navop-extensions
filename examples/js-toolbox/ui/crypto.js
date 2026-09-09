import { createHash, randomUUID } from 'crypto';
import { Buffer } from 'buffer';
import { View, div } from 'gpui';
import { v_flex, h_flex, Input, InputState } from 'gpui-base';
import { Button, Separator, Toggle } from 'gpui-component';

const ALGORITHMS = ['md5', 'sha1', 'sha256', 'sha512'];

export default class CryptoTools extends View {
  /** @type {any} */
  text;
  /** @type {string} */
  result = '';
  /** @type {string} */
  algorithm = 'sha256';

  /**
   * @param {unknown} _props
   * @param {import('gpui').AsyncContext} _cx
   */
  init(_props, _cx) {
    this.text = InputState.new({ placeholder: '输入待处理文本…' });
  }

  /**
   * @param {string} kind
   * @param {import('gpui').Context} cx
   */
  run(kind, cx) {
    const value = this.text.value();
    if (kind === 'uuid') {
      this.result = randomUUID();
    } else if (kind === 'base64-encode') {
      this.result = Buffer.from(value, 'utf8').toString('base64');
    } else if (kind === 'base64-decode') {
      this.result = Buffer.from(value, 'base64').toString('utf8');
    } else {
      this.result = String(createHash(this.algorithm).update(value).digest('hex'));
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
          .child(div().text_lg().font_semibold().child('Crypto Tools'))
          .child(
            div()
              .text_sm()
              .text_color(theme.muted_foreground)
              .child('Hash、Base64 与 UUID 小工具'),
          ),
      )
      .child(
        v_flex()
          .gap(6)
          .child(div().text_xs().font_medium().text_color(theme.muted_foreground).child('输入'))
          .child(Input.new(this.text)),
      )
      .child(
        v_flex()
          .gap(6)
          .child(div().text_xs().font_medium().text_color(theme.muted_foreground).child('摘要算法'))
          .child(
            h_flex()
              .gap(8)
              .children(
                ALGORITHMS.map((algorithm) =>
                  new Toggle(`crypto-algo-${algorithm}`)
                    .label(algorithm)
                    .checked(this.algorithm === algorithm)
                    .size('small')
                    .on_change((_checked, cx) => {
                      this.algorithm = algorithm;
                      this.run('hash', cx);
                    }),
                ),
              ),
          ),
      )
      .child(
        h_flex()
          .gap(8)
          .child(new Button('b64-encode').label('Base64 编码').outline().size('small').on_click((_e, cx) => this.run('base64-encode', cx)))
          .child(new Button('b64-decode').label('Base64 解码').outline().size('small').on_click((_e, cx) => this.run('base64-decode', cx)))
          .child(new Button('uuid').label('生成 UUID').outline().size('small').on_click((_e, cx) => this.run('uuid', cx))),
      )
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
