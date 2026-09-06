import { createHash, randomUUID } from 'crypto';
import { Buffer } from 'buffer';
import { View, div } from 'gpui';
import { v_flex, h_flex } from 'gpui-base';
import { Button, Input, InputState } from 'gpui-component';

export default class CryptoTools extends View {
  /**
   * @param {unknown} _props
   * @param {import('gpui').AsyncContext} _cx
   */
  init(_props, _cx) {
    /** @type {any} */
    this.text = InputState('text to transform');
    this.result = '';
    this.algorithm = 'sha256';
  }

  /**
   * @param {string} kind
   */
  run(kind) {
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
  }
  render() {
    return v_flex()
      .size_full()
      .p(16)
      .gap(12)
      .child(div().font_semibold().child('Crypto Tools'))
      .child(new Input(this.text).aria_label('text'))
      .child(
        /** @type {any} */ (
          h_flex()
            .gap(8)
            .children(
              ['md5', 'sha1', 'sha256', 'sha512'].map(
                (algorithm) =>
                  new Button(`hash-${algorithm}`)
                    .label(algorithm)
                    .on_click(() => {
                      this.algorithm = algorithm;
                      this.run('hash');
                    }),
              ),
            )
            .children([
              new Button('b64-encode').label('Base64 encode').on_click(() => this.run('base64-encode')),
              new Button('b64-decode').label('Base64 decode').on_click(() => this.run('base64-decode')),
              new Button('uuid').label('UUID').on_click(() => this.run('uuid')),
            ])
        ),
      )
      .child(
        div()
          .flex_1()
          .min_h_0()
          .overflow_y_scroll()
          .whitespace_nowrap()
          .child(this.result || '—'),
      );
  }
}
