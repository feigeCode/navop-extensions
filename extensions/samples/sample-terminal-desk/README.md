# 终端工作台（示例插件）

演示 **终端能力面** 与 **面板形态**：

- tab 形态：列终端会话（`Terminal.list`）、读屏幕快照（`Terminal.read`）、
  往活动终端执行命令（`Terminal.exec`）；
- 面板形态：`contributes.panels[].anchor = "terminal-sidebar"`，在终端侧边栏
  挂「终端工作台」按钮，点开是同一个 bundle 的第二个实例。

## 清单要点

```json
{
  "permissions": ["shell:exec"],
  "contributes": {
    "shellApp": { "modules": ["terminal", "ui"] },
    "panels": [{ "id": "desk", "anchor": "terminal-sidebar", "order": 210 }]
  }
}
```

`modules` 声明 `terminal` 才能调用 `Terminal.*`；没声明时宿主会以
`PERMISSION_DENIED:` 开头的信息拒绝（错误信息会带上缺哪个能力面）。

## 开发

```bash
./scripts/check.sh   # nsh check
./scripts/test.sh    # nsh test（2 条：tab 形态 / 面板形态）
./scripts/build.sh   # nsh build . --out dist → ui/dist/bundle.js
```

## 安装（开发版）

把整个目录复制到扩展目录即可（宿主扫描 `composite/*/extension.json`）：

```bash
cp -R . ~/.config/navop/extensions/composite/com.navop.sample.terminal-desk
```

然后在「扩展」页刷新/重新加载，或重启应用。
