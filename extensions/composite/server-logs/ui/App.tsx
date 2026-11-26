// 服务器日志：单页 app。面板形态直接渲染日志页，tab 形态同一份页面。
import { mount } from "nsh";
import ServerLogs from "./pages/logs/App";

export default function App() {
  return <ServerLogs />;
}

mount(App);
