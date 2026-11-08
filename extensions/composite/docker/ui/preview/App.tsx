// 设计预览入口：`nsh run --target web preview/App.tsx`（或 `nsh test --target web` 截图）。
// 它不是扩展的一部分（nsh.json 的入口仍是 ui/App.tsx），只是把真实页面挂到假 docker 上，
// 方便在没有容器的时候看排版、配色和边界态。
//
// 顺序要紧：`./mock` 先把 host.params / host.call 换成假的，`../App` 才会在模块末尾
// 带着假数据 mount。这里不能再 mount 一次 —— App.tsx 自己会 mount。
import "./mock";
import "../App";
