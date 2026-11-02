// 复用 docker 扩展的页面设计系统（单一来源，见 docker/ui/lib）。
// 页面按 `../../lib/theme` 引入，跨扩展的共享不走复制。
export * from "../../../../extensions/composite/docker/ui/lib/theme";
