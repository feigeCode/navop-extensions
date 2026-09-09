// RocketMQ 中间件控制台入口薄壳(标准 §5.1)。
//
// 共享控制台库 `./console/base.js`(`MiddlewareConsole` 基类)由
// middleware-base 扩展经 scripts/sync-middleware-console.mjs 在构建期同步填充,
// 当前目录暂缺 base.js 属正常现象,打包前同步脚本会补齐。
// 子类不得覆盖 init/render;此处仅做品牌定制。

import { MiddlewareConsole } from "./console/base.js";

export default class ConsoleView extends MiddlewareConsole {
  // 品牌标识:控制台标题栏
  brand() {
    return { title: "RocketMQ", subtitle: this.context.connection?.name || "" };
  }

  // Topic 列表追加 RocketMQ 特有列提示:topic_type(RETRY/DLQ/SYSTEM/FIFO/DELAY/TRANSACTION/UNSPECIFIED)
  extraTopicColumns() {
    return [{ key: "topic_type", label: "类型" }];
  }

  // 概览页扩展指标(MiddlewareMetrics.extras)展示顺序:默认交由基类处理
  metricsExtrasOrder() {
    return [];
  }
}
