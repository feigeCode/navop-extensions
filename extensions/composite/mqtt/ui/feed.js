// MQTT 消息增量轮询引擎:消息页与主题树页共用同一套水位 / 去重 / 换代 / 退避逻辑。
//
// 嵌入式工作台页面不能使用 navop.event(CustomPageHost 契约),
// 因此以 queryByWindow 增量轮询代替事件流。
//
// **水位为什么不能只用序号**:宿主重启 provider 进程后,新进程的缓冲是空的、
// 合成 ID 的序号也从 0 重来。若把 `seq > lastSeq` 当成唯一去重条件,重启后所有
// 新消息都会被判成"已读"而永久消失(这正是"点几下消息就没了"的成因之一)。
// 现在:
//   1. 游标用**时间**(begin_unix_ms = 上一批最大的 received_at_ms),跨重启有效;
//   2. 同一批内按 `message_id` 去重,不再依赖跨代次可比的序号;
//   3. 序号**倒退**即判定 provider 换代 → 清空重读。
// 另:嵌入式页面**不允许**声明 navop.runtime 模块(见 shell_page_host
// ::ensure_embeddable),所以拿不到 generation,只能靠这两条信号。
import { dispatch } from "navop.workbench";
import { parseError, props } from "./shared.js";

export const DEFAULT_POLL_MS = 1000;
export const DEFAULT_PAGE_SIZE = 200;
export const DEFAULT_MAX_ROWS = 2000;
/** 出错后的退避下限/上限:1s 无退避轮询在 provider 已死时会刷屏报错。 */
export const DEFAULT_BACKOFF_MIN_MS = 1000;
export const DEFAULT_BACKOFF_MAX_MS = 15000;
/** 换代提示的停留时间(到时自动消失,不要求用户手动关)。 */
export const DEFAULT_NOTICE_MS = 5000;

/** `mqtt-<seq>` → 序号;合成 ID 之外的形态返回 -1(不参与换代判定)。 */
export function seqOf(message) {
  const match = /^mqtt-(\d+)$/.exec(message?.message_id || "");
  return match ? Number(match[1]) : -1;
}

/** 时间线上"更新"的排序键:接收时间优先,同毫秒再比序号。 */
export function orderKey(message) {
  return [Number(props(message).received_at_ms) || 0, seqOf(message)];
}

export class MessageFeed {
  /**
   * @param {object} [options]
   * @param {(cx: unknown) => void} [options.onUpdate] 每轮轮询后回调(页面负责 notify)
   * @param {() => void} [options.onReset] 水位作废、旧行丢弃时回调(页面清理选中态)
   */
  constructor(options) {
    const opts = options || {};
    this.pageSize = opts.pageSize || DEFAULT_PAGE_SIZE;
    this.maxRows = opts.maxRows || DEFAULT_MAX_ROWS;
    this.pollMs = opts.pollMs || DEFAULT_POLL_MS;
    this.backoffMinMs = opts.backoffMinMs || DEFAULT_BACKOFF_MIN_MS;
    this.backoffMaxMs = opts.backoffMaxMs || DEFAULT_BACKOFF_MAX_MS;
    this.noticeMs = opts.noticeMs == null ? DEFAULT_NOTICE_MS : opts.noticeMs;
    this.topic = opts.topic || "#";
    this.onUpdate = opts.onUpdate || null;
    this.onReset = opts.onReset || null;

    this.rows = [];
    this.lastSeq = -1;
    this.lastMs = 0;
    this.paused = false;
    this.error = null;
    this.errorTransient = false;
    this.notice = null;
    this.noticeUntil = 0;
    this.halted = false;
    this.failures = 0;
    this.nextAttemptAt = 0;
    this.needsResync = false;
    this.polling = false;
  }

  /** 首页加载 + 定时器;定时器归页面世代所有,页面卸载时由宿主回收。 */
  start(cx) {
    cx.spawn(async (cx) => this.poll(cx));
    this.timer = cx.timer.every(this.pollMs, (cx) => {
      if (!this.paused) return this.poll(cx);
    });
    return this.timer;
  }

  /** 拉取 `beginMs` 之后的消息(最多 10 页),并报告是否发现序号倒退。 */
  async fetchSince(beginMs) {
    let page = 1;
    const messages = [];
    let regression = false;
    for (;;) {
      const result = await dispatch("queryByWindow", {
        ByTimeWindow: {
          topic: this.topic,
          begin_unix_ms: beginMs,
          // 上界取当前时间:2^53-1 这种哨兵值没有意义,时间窗口也无法作为索引下推
          end_unix_ms: Date.now(),
          page,
          page_size: this.pageSize,
        },
      });
      for (const message of result?.messages || []) {
        // 序号比水位小 ⇒ provider 换了进程(新缓冲从 0 开始)
        if (seqOf(message) >= 0 && seqOf(message) < this.lastSeq) regression = true;
        messages.push(message);
      }
      if (!result?.has_more || page >= 10) break;
      page += 1;
    }
    return { messages, regression };
  }

  /** 丢水位:换代后序号从头开始,旧行与新行不可比,整段重读。 */
  resetWatermarks() {
    this.rows = [];
    this.lastSeq = -1;
    this.lastMs = 0;
    if (this.onReset) this.onReset();
  }

  /** 把一批消息并进列表(按 message_id 去重,不再用跨代次的序号水位)。 */
  merge(messages, position) {
    if (!messages.length) return 0;
    const seen = new Set(this.rows.map((message) => message.message_id));
    const fresh = [];
    for (const message of messages) {
      if (seen.has(message.message_id)) continue;
      seen.add(message.message_id);
      fresh.push(message);
    }
    if (fresh.length) {
      fresh.sort((a, b) => {
        const [at, as] = orderKey(a);
        const [bt, bs] = orderKey(b);
        return at - bt || as - bs;
      });
      // 默认**新在前**(倒序时间线);position="append" 时保持远端顺序,
      // 供主题树这类按主题分组、行序无关的页面使用。
      const incoming = position === "append" ? fresh : fresh.reverse();
      this.rows = incoming.concat(this.rows).slice(0, this.maxRows);
    }
    // 水位始终向前推进,便于下一轮把窗口收窄
    for (const message of messages) {
      this.lastSeq = Math.max(this.lastSeq, seqOf(message));
      this.lastMs = Math.max(this.lastMs, Number(props(message).received_at_ms) || 0);
    }
    return fresh.length;
  }

  async poll(cx) {
    if (this.polling || this.halted) return;
    if (Date.now() < this.nextAttemptAt) return;
    this.polling = true;
    try {
      // 上一次是传输中断:旧行属于已死的那个进程,而新进程的 ID 会与它撞车
      // (又从 `mqtt-0` 开始),所以先清空再从 0 重读一次。
      let resynced = this.needsResync;
      if (resynced) {
        this.resetWatermarks();
        this.needsResync = false;
      }
      let { messages, regression } = await this.fetchSince(this.lastMs);
      if (regression) {
        // 序号倒退 = 换代:旧行与新行不可比,清空后从 0 重读整个缓冲
        this.resetWatermarks();
        messages = (await this.fetchSince(0)).messages;
        resynced = true;
      }
      if (resynced) {
        this.notice = "provider 已重启,消息缓冲已重建(重启前的缓冲无法恢复)";
        this.noticeUntil = Date.now() + this.noticeMs;
      } else if (Date.now() >= (this.noticeUntil || 0)) {
        this.notice = null;
      }
      this.merge(messages);
      this.error = null;
      this.errorTransient = false;
      this.failures = 0;
      this.nextAttemptAt = 0;
    } catch (error) {
      const info = parseError(error);
      this.error = info.message;
      this.errorTransient = info.transient;
      this.failures += 1;
      if (info.transient) {
        // 传输断了:几乎一定是 provider 进程被换掉了,水位与缓冲一起作废
        this.needsResync = true;
        this.notice = `provider 连接已断开,正在自动重连…(第 ${this.failures} 次)`;
        this.noticeUntil = 0;
        this.nextAttemptAt = Date.now() + Math.min(
          this.backoffMinMs * 2 ** Math.min(this.failures - 1, 4),
          this.backoffMaxMs,
        );
      } else {
        // 参数/权限这类错误重试没有意义:停下来把控制权交回用户
        this.halted = true;
      }
    }
    this.polling = false;
    if (this.onUpdate) this.onUpdate(cx);
  }

  /** 用户点的"重试":从头再来一遍(含换代重读)。 */
  retry(cx) {
    this.halted = false;
    this.failures = 0;
    this.nextAttemptAt = 0;
    this.needsResync = true;
    return this.poll(cx);
  }

  clear() {
    this.resetWatermarks();
    this.notice = null;
    this.noticeUntil = 0;
  }
}
