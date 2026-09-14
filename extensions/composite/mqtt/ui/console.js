// MQTT 中间件控制台入口(薄壳)。
//
// 依据 middleware-standard §5.1:共享控制台库 `./console/base.js` 中的
// `MiddlewareConsole` 基类负责 capabilities 探测、四页渲染与刷新防护;
// 本入口仅做 MQTT 品牌定制(标题/副标题),不得覆盖 init/render。
// `ui/console/base.js` 为本扩展自持有的共享控制台基类(middleware-standard v1,§5.1),
// 与 rocketmq 侧副本需保持同步。
import { MiddlewareConsole } from "./console/base.js";

export default class ConsoleView extends MiddlewareConsole {
  // 品牌标识:控制台标题栏(副标题取连接名)
  brand() {
    return { title: "MQTT", subtitle: this.context.connection?.name || "" };
  }

  // 可选:Topic 列表追加实现特有列(MQTT 无额外列,默认实现)
  extraTopicColumns() {
    return [];
  }

  // 可选:概览页实现特有指标的展示顺序提示(MQTT 无固定顺序要求,默认实现;
  // provider 的 MiddlewareMetrics.extras 键为 received_total/sent_total/buffered_messages)
  metricsExtrasOrder() {
    return [];
  }
}
