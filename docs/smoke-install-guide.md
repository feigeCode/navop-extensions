# Navop 扩展「从零安装」冒烟手册（macOS · aarch64 · 离线包路径）

> 目标：在一台**未安装任何扩展**的机器上，走通「启动应用 → 新建连接页看到中间件/时序数据库空态 `+` → 跳转扩展管理页 → 离线导入三个扩展包 → 回到新建连接页看到 MQTT / RocketMQ / TDengine → 建连接」的完整链路。
>
> 结论先行：**三个离线包无需任何补产物，可直接经「本地安装」导入**（离线路径不校验 sha256，也不要求特定文件名）。校验和只在「市场清单」路径才是硬性要求，见附录 A。
>
> 本手册基于 dev 工作区代码调研，引用格式为 `文件:行号`（相对主仓根 `/Users/haijun/Work/work/navop`）。

---

## 0. 前置条件

| 项 | 值 |
| --- | --- |
| 平台 | macOS aarch64（Apple Silicon） |
| 应用 | dev 构建（`cargo run -p main --offline`，host 版本 = `crates/db` 的 0.15.2，见 `crates/db/src/ipc/registry.rs:401-408`） |
| 新建连接页类目 | 「中间件」「时序数据库」空态 `+` 入口由并行开发中的改动提供（主仓工作区未提交 diff：`main/src/new_connection/connection_kind.rs`、`connection_window.rs`）。冒烟前确认该改动已合入你的构建 |
| 扩展产物 | `navop-extensions/target/local-extension-artifacts/` |

三个离线包（`shasum -a 256` 实测值，附录 A 会用到）：

| 文件 | 内容 | sha256 |
| --- | --- | --- |
| `mqtt-composite-aarch64-apple-darwin.tar.gz` | MQTT 复合扩展 v0.1.0 | `e07af09751f827f308d524c2a68f390522f59260c7b58239334872d11bbacf91` |
| `rocketmq-composite-aarch64-apple-darwin.tar.gz` | RocketMQ 复合扩展 v0.1.0 | `b16d4f4d9cb8ff3566fab7fe1afa1c9d41199429e419e83893abab860b112a1e` |
| `tdengine-driver-aarch64-apple-darwin.tar.gz` | TDengine 数据库驱动 v0.1.0 | `6ce84f0a68e7d881244cde59a8cd2042e4f807a4b27d81b69d63fb1348a739fc` |

注意：该目录下的 `sha256sums.txt` / `extension-manifest.json` / `release-metadata.json` **只包含 rocketmq 一个条目**——这是发布流水线的单扩展清单产物，离线导入用不到它们，不影响冒烟；只有走附录 A 的本地市场路径才需要补全三个包的校验和（附录 A 已给出可直接粘贴的完整清单）。

### 从零状态自检

```bash
ls -la ~/.config/navop/extensions/
# 预期：只有空的 composite/ 与 database_drivers/ 两个目录（或整个 extensions/ 不存在）
ls ~/.config/navop/extensions/composite/ ~/.config/navop/extensions/database_drivers/
# 预期：均无输出
```

若有残留，按附录 C 清卸后再开始。

---

## 1. 启动应用

```bash
cd /Users/haijun/Work/work/navop
cargo run -p main --offline
```

**预期**：主窗口（首页）正常打开，工具栏可见「新建连接」按钮（`main/src/home_tab/toolbar.rs:76`）。

---

## 2. 打开「新建连接」——确认空态 `+`

操作：点击主窗口工具栏**「新建连接」**按钮（会弹出 1100×700 的独立选择窗口，`main/src/home_tab/connection_open.rs:60-79`）。

预期（已合入中间件/时序类目改动后）：

- 左侧类目列表出现**「时序数据库」**与**「中间件」**（`NewConnection.category_time_series` = 时序数据库，`main/locales/main.yml:1914-1917`；`category_middleware` = 中间件）。
- 因未装任何扩展/驱动：
  - 「时序数据库」类目为空 → 显示一张 **`+` 安装时序数据库扩展** 卡片（文案 `NewConnection.more_time_series`，`main/locales/main.yml:1942-1945`；`more_middleware` 在 1938-1941）。
  - 「中间件」类目为空 → 显示 **`+` 安装中间件扩展** 卡片（`NewConnection.more_middleware`）。
  - 「全部」视图末尾另有常驻的**「更多连接」**卡片（跳转目标相同）。
- 空态 `+` 的判定与追加逻辑：`main/src/new_connection/connection_kind.rs` 的 `append_empty_category_install_entries`（仅中间件/时序数据库两类可空；TDengine 卡片在 `tdengine` 驱动未安装时不出现，同一函数处的 `registry.find(TDENGINE_DRIVER_ID)` 过滤）。

> 若你的构建尚未合入该改动：「时序数据库」类目会**常显内置 TDengine 卡片**（旧逻辑 `connection_kind.rs:151`），且没有「中间件」类目——此时请先同步并行改动再冒烟，不要把差异当缺陷记录。

---

## 3. 点击 `+` 跳转扩展管理页

操作：单击「安装中间件扩展」（或「安装时序数据库扩展」/「更多连接」）卡片。

预期：

- 新建连接窗口关闭，主窗口 home 页签栏**新增/激活「扩展」页签**（`ExtensionManagerView`，`main/src/home/home_tabs.rs:1430-1447`；跳转判定 `opens_extensions_tab_on_click`）。
- 扩展页顶部工具栏三个按钮（`crates/extension_view/src/render.rs:48-74`）：
  1. **「离线包下载」**（地球图标）——**注意：这不是导入入口**。它只弹出一个「下载渠道」窗口，列出市场主页 / GitHub Releases / 国内镜像三个 URL 供你去找包（`crates/extension_view/src/offline_package_dialog.rs:13-31`，确认按钮为「确定」）。
  2. **「本地安装」**（文件图标）——**这才是离线 tar.gz 导入入口**。
  3. **「刷新」**。
- 页签两枚：「已安装」/「扩展市场」；「已安装」显示空态「尚未安装匹配的扩展」。

> 备选入口：home 侧边导航的「扩展」应用项（`main/src/home_tab/navigation.rs:26`）同样能打开扩展页，冒烟时用 `+` 卡片走主路径即可。

---

## 4. 离线安装 TDengine 驱动（database_driver 包）

操作：点「**本地安装**」→ 系统文件选择器（标题「选择扩展压缩包」，只允许选单个文件，`crates/extension_view/src/actions.rs:54-70`）→ 选中 `navop-extensions/target/local-extension-artifacts/tdengine-driver-aarch64-apple-darwin.tar.gz`。

内部流程（全部同步完成，无权限弹窗）：

1. 解包到临时 staging 目录并按内容识别类型：包根有 `driver.json` → 判定为数据库驱动（`crates/extension-runtime/src/extension_package_layout.rs:25-48`；tar 条目拒绝绝对路径/`..`/软链接，`crates/extension-runtime/src/extension_downloader.rs:445-458`）。
2. 读取 `driver.json` 的 `id`（= `tdengine`）作为安装目录名（`extension_downloader.rs:348-375`）；database_driver **不做权限审查**（`extension_view_host.rs:252-258` 空权限集）。
3. 校验入口二进制 `./tdengine-ipc-driver` 在包内存在（`crates/extension-runtime/src/extension/database_driver_provider.rs:48-66`）。
4. 拷贝落盘并注册（`extension_downloader.rs:50-94`）。

预期结果：

- 右上角通知「**扩展安装完成**」，状态行出现「已安装 tdengine」。
- 「已安装」列表出现卡片：徽标「数据库驱动」、名称 `tdengine`、v0.1.0，带「重新加载」「卸载」按钮。
- 落盘自检：

```bash
ls ~/.config/navop/extensions/database_drivers/
# 预期：tdengine
ls ~/.config/navop/extensions/database_drivers/tdengine/
# 预期：driver.json  tdengine-ipc-driver(可执行)  icons/  locales/
```

> 该目录正是应用启动时驱动发现的**唯一**扫描位置（`crates/db/src/ipc/registry/discovery.rs:7-18`），两者关系：扩展页安装 = 往这里写入一个驱动目录 + 注册表登记，与手工放目录等效。

---

## 5. 离线安装 MQTT（composite 包，会弹权限确认）

操作：再点「本地安装」→ 选 `mqtt-composite-aarch64-apple-darwin.tar.gz`。

预期：弹出**「确认安装 mqtt-composite-aarch64-apple-darwin.tar.gz」**权限对话框，正文：

- 「该扩展声明了 **4** 个高危权限。请确认你信任该扩展来源。」
- 权限清单逐条列出（`[HIGH] spawn:./bin/mqtt-provider`、`[HIGH] net:tcp:*:1883`、`[HIGH] net:tcp:*:8883`、`[HIGH] secrets:read:self.*`）。`net:`/`spawn:`/`secrets:` 一律高危（`crates/extension-runtime/src/extension/manifest/security_rules.rs:15-27`）；弹窗与按钮逻辑在 `crates/extension_view/src/permissions.rs:46-95`。

操作：点「**允许并安装**」。

预期结果：

- 通知「扩展安装完成」；「已安装」列表新增卡片：徽标「复合扩展」、名称 **`com.navop.middleware.mqtt`**（安装名取 `extension.json` 的 `id`，`extension_downloader.rs:348-375`；展示名同 id，`crates/extension-runtime/src/extension/composite_provider.rs:81-101`）、v0.1.0。
- 卡片上多一枚主按钮「**MQTT**」——用于直接打开扩展自带的控制台 shell 视图（`render.rs:312-331`）。
- 落盘自检：

```bash
ls ~/.config/navop/extensions/composite/
# 预期：com.navop.middleware.mqtt
```

---

## 6. 离线安装 RocketMQ（同上，5 个高危权限）

操作：「本地安装」→ 选 `rocketmq-composite-aarch64-apple-darwin.tar.gz` → 权限对话框显示 **5** 个高危权限（`shell:exec`、`spawn:./bin/rocketmq-provider`、`net:tcp:*:9876`、`net:tcp:*:10911`、`secrets:read:self.*`）→「允许并安装」。

预期：同 MQTT；已安装卡片名称 **`com.navop.middleware.rocketmq`**，shell 视图按钮「RocketMQ」。

> 「扩展市场」页签此时大概率加载失败（默认源是 GitHub raw 的 `manifest.json`，`crates/extension-runtime/src/extension_downloader/transfer.rs:14-18`；R2 亦未发布这三个扩展）——这是**预期现象**，冒烟主路径就是本地安装。想验证市场链路见附录 A。

---

## 7. 回到「新建连接」——三张卡片出现（注意 TDengine 的时机）

### 7.1 MQTT / RocketMQ：关闭旧窗口重开即见（无需重启）

操作：关掉此前打开的新建连接窗口（若还开着），重新点「新建连接」。

预期：

- 「**中间件**」类目出现 **MQTT** 与 **RocketMQ** 两张卡片（贡献项 `extension_id` 以 `com.navop.middleware.` 前缀分流到中间件类目，`main/src/new_connection/connection_kind.rs` 的 category 分支；卡片文案/图标来自包内 `extension.json` 的 `contributes.connections`，如 host 默认 `127.0.0.1:1883`）。
- 原理：安装完成回调里同步刷新 `GlobalExtensionRuntimeCatalog`（`permissions.rs:24-33` → `extension_view_host.rs:184-190` → `crates/extension-runtime/src/global.rs:57-84`），而新建连接窗口**每次点开都新建**、在构造时读取该全局 catalog（`main/src/new_connection/connection_window.rs:61-76`）——所以**重开窗口即可，不必重启应用**。若窗口一直开着不关，它不会自动刷新（这是窗口级快照，非缺陷但值得知道）。

### 7.2 TDengine：需要重启应用（当前实现的断点，见 §9-B）

时序数据库类目此刻**仍显示 `+` 空态**：TDengine 卡片的可见性走的是 HomePage **缓存的**驱动注册表（`show_new_connection_dialog` 传入 `self.external_driver_registry`，`main/src/home_tab/connection_open.rs:61-70`；该缓存只在 `load_connections` 时重扫，触发点为启动、主密钥解锁、任一连接增/删/改与最近使用更新，`main/src/home_tab/data.rs:46-56`、`lifecycle.rs:128,143,162,174`）——**扩展页安装驱动不会触发它**。

操作：**完全退出应用（⌘Q）并重新 `cargo run -p main --offline`**，再开「新建连接」→「时序数据库」。

预期：TDengine 卡片出现，`+` 空态卡片消失（判定即驱动注册表能 `find("tdengine")`）；双击卡片进入连接表单（主机/端口 6041/用户名 root/密码 taosdata 等默认值来自驱动的声明式表单，`driver.json → ui.form`）。

> 免重启的旁路（不推荐写进正式冒烟结论）：安装驱动后随便新建/编辑/删除任一连接（或让一条连接"最近使用"更新）也会触发 `load_connections` 重扫。冒烟时用重启路径最干净。

---

## 8. 建连接冒烟

### 8.1 MQTT（可用公共 broker 验证连通）

1. 新建连接 → 中间件 → 双击 **MQTT** → 表单默认 `127.0.0.1:1883`；改为公共测试 broker `broker.emqx.io:1883`（用户名/密码留空，Client ID 留空自动生成）。
2. 保存 → 打开连接 → 预期进入扩展自带的 MQTT 控制台（订阅浏览/消息查询/发送/指标），能订阅如 `navop/smoke` 并收发消息。
3. 连接记录会出现在首页连接列表（`ConnectionType::Extension`）。

### 8.2 RocketMQ（需自备 NameServer）

表单默认指向 NameServer `9876` 端口；无公共服务，本地若有 RocketMQ（`namesrv` 启动）填 `127.0.0.1:9876` 保存并打开控制台验证集群概览/Topic 列表。没有环境时至少完成**保存连接**并确认出现在连接列表。

### 8.3 TDengine（需自备 taosAdapter）

表单默认 `127.0.0.1:6041`、root/taosdata。本地有 TDengine（taosAdapter 监听 6041）则测试连接/打开；无环境时同样至少保存连接记录。打开连接时的驱动守卫用**实时扫描**的注册表（`crates/extension-runtime/src/database_driver_install.rs:153-166,215-218`），不会误弹"安装驱动"。

**通过标准**：三条连接均可保存入库、出现在首页列表；有服务环境的三条能打开各自的视图页面且无 panic。

---

## 9. 坑与断点汇总（冒烟时重点盯）

| # | 现象 | 根因（代码依据） | 定性 |
| --- | --- | --- | --- |
| A | 「离线包下载」按钮不是导入入口，只是三个下载 URL | `offline_package_dialog.rs:13-31` | 文案易误导，非缺陷；导入走「本地安装」 |
| B | **装完 TDengine 驱动后，新建连接页仍显示时序空态 `+`**，须重启（或触发一次连接 CRUD）才出现 TDengine 卡片 | 驱动卡片可见性读 HomePage 缓存注册表（`connection_open.rs:61-70` + `data.rs:46-56`），扩展安装链只刷新 composite catalog 与 DB 树菜单（`extension_view_host.rs:184-190`），不通知 HomePage 重扫 | **宿主缺陷（流程断点）**：建议给 database_driver 安装成功后广播一次 `load_connections`/注册表刷新 |
| C | MQTT/RocketMQ 装完但新建连接窗口还开着 → 看不到新卡片 | catalog 在窗口构造时快照（`connection_window.rs:61-76`），窗口不随安装事件自刷新 | 交互限制：重开窗口即可，手册已写入步骤 |
| D | 「扩展市场」页签加载失败/为空 | 默认源 GitHub raw manifest 未含三扩展、R2 未发布（`transfer.rs:14-18`） | 预期；用本地安装或附录 A |
| E | 权限弹窗的高危计数：MQTT=4、RocketMQ=5 | `security_rules.rs:15-27` | 预期，用于核对文案 |
| F | 本地导入**不校验 sha256、不要求文件名** | `extension_view_host.rs:75-102`（entry sha256=None）；仅市场下载强制校验（`transfer.rs` `download_marketplace_entry_to_staging_with_progress` 内 bail「缺少 sha256」） | 预期；sha256 仅附录 A 需要 |
| G | 安装复合扩展时若同名扩展的 shell 页签已打开，会先关闭这些页签再安装 | `permissions.rs:105-121` `close_shell_extension` 门控 | 预期行为 |
| H | 二进制可执行位：打包脚本 `chmod +x` + `tar czf` 保留权限，安装拷贝 `std::fs::copy` 保留权限位 | `package-composite-extension.sh:149-157`、`package-driver.sh:107-109`、`extension_downloader.rs:406-425` | 无需手工处理；若自建包忘记加执行位，驱动侧会在 `validate_packaged_entry` 只查存在性，运行期才报错——打包时务必 `chmod +x` |

---

## 附录 A：本地 HTTP 市场清单（可选，验证市场安装链路）

**结论**：宿主市场客户端**不支持 `file://` 本地源**——搜索框只认 `http(s)://…​.json`（`crates/extension_view/src/state.rs:66-72,98-109`），下载也走 gpui HttpClient。最小可行办法是**本地起一个 HTTP 服务**提供手写 manifest。两种用法任选：

1. **搜索框直连（最简）**：扩展页切到「扩展市场」，在搜索框粘贴 `http://127.0.0.1:8787/manifest.json` 回车，即从该 URL 加载清单（`actions.rs:302-307`、`view.rs:104-115`）。
2. **环境变量默认源**：以 `NAVOP_PUBLIC_BASE_URL=http://127.0.0.1:8787` 启动应用，默认市场源变为 `{base}/extensions/manifest.json`（`transfer.rs` `extension_manifest_url_from_public_base`，`crates/core/src/config.rs:46-49`）。

### A.1 目录布局（asset 相对路径约定 `{id}/{version}/{file}`）

```bash
mkdir -p /tmp/navop-market/{mqtt/0.1.0,rocketmq/0.1.0,tdengine/0.1.0}
cd /Users/haijun/Work/work/navop/navop-extensions/target/local-extension-artifacts
cp mqtt-composite-aarch64-apple-darwin.tar.gz        /tmp/navop-market/mqtt/0.1.0/
cp rocketmq-composite-aarch64-apple-darwin.tar.gz    /tmp/navop-market/rocketmq/0.1.0/
cp tdengine-driver-aarch64-apple-darwin.tar.gz       /tmp/navop-market/tdengine/0.1.0/
```

### A.2 `/tmp/navop-market/manifest.json`（可直接粘贴，sha256 已实测）

```json
{
  "schema_version": 2,
  "release_version": "local-smoke",
  "extensions": [
    {
      "id": "mqtt",
      "kind": "composite",
      "name": "MQTT",
      "version": "0.1.0",
      "release_tag": "mqtt-v0.1.0",
      "description": "MQTT 中间件管理扩展(本地冒烟源)",
      "engines": { "onetcli": ">=0.15.2" },
      "artifacts": {
        "aarch64-apple-darwin": {
          "file": "mqtt-composite-aarch64-apple-darwin.tar.gz",
          "sha256": "e07af09751f827f308d524c2a68f390522f59260c7b58239334872d11bbacf91"
        }
      }
    },
    {
      "id": "rocketmq",
      "kind": "composite",
      "name": "RocketMQ",
      "version": "0.1.0",
      "release_tag": "rocketmq-v0.1.0",
      "description": "RocketMQ 中间件管理扩展(本地冒烟源)",
      "engines": { "onetcli": ">=0.15.2" },
      "artifacts": {
        "aarch64-apple-darwin": {
          "file": "rocketmq-composite-aarch64-apple-darwin.tar.gz",
          "sha256": "b16d4f4d9cb8ff3566fab7fe1afa1c9d41199429e419e83893abab860b112a1e"
        }
      }
    },
    {
      "id": "tdengine",
      "kind": "database_driver",
      "name": "TDengine",
      "version": "0.1.0",
      "release_tag": "tdengine-v0.1.0",
      "description": "TDengine 时序数据库 IPC 驱动(本地冒烟源)",
      "engines": { "onetcli": ">=0.10.0" },
      "artifacts": {
        "aarch64-apple-darwin": {
          "file": "tdengine-driver-aarch64-apple-darwin.tar.gz",
          "sha256": "6ce84f0a68e7d881244cde59a8cd2042e4f807a4b27d81b69d63fb1348a739fc"
        }
      }
    }
  ]
}
```

### A.3 启动与安装

```bash
cd /tmp/navop-market && python3 -m http.server 8787
```

应用内：扩展市场 → 搜索框输入 `http://127.0.0.1:8787/manifest.json` 回车 → 列表出现三条 → 逐条点「安装」。composite 两条同样会走高危权限确认；marketplace 下载**强制校验 sha256**（清单缺 sha256 会直接报「缺少 sha256」），这是与离线导入的唯一差别。断点说明：`kind` 必须是 `database_driver`/`composite`（serde snake_case），artifact 键必须匹配平台（macOS aarch64 → `aarch64-apple-darwin`，`marketplace.rs:389-399`）；若改用官方生成器 `scripts/generate-marketplace-manifest.mjs`，需先补全 `sha256sums.txt`（当前只含 rocketmq），它一次只生成**单个扩展**的 `extension-manifest.json`，合并多扩展清单仍需手工（如上）。

---

## 附录 B：直装脚本兜底（绕过 UI，仅排障用）

子模块提供直接落盘脚本（与扩展页安装等效，均写入 `~/.config/navop/extensions/`）：

```bash
cd /Users/haijun/Work/work/navop/navop-extensions
bash scripts/install-local-composite-extensions.sh mqtt rocketmq   # 装入 extensions/composite/
bash scripts/install-local-drivers.sh tdengine                     # 装入 extensions/database_drivers/
```

脚本直装后**必须重启应用**（composite catalog 与驱动注册表都只在启动/扩展页操作时刷新）。当 UI 导入报错时可用它区分「包问题」还是「UI/宿主问题」。

---

## 附录 C：恢复从零（卸载）

优先走 UI：扩展页「已安装」→ 各卡片「卸载」（composite 会先关闭其 shell 页签，`actions.rs:99-186`）。或直接清目录：

```bash
rm -rf ~/.config/navop/extensions/composite/* ~/.config/navop/extensions/database_drivers/*
```

重启应用后即回到 §0 的从零状态。

---

## 附：调研结论速查（问题 → 答案 → 依据）

1. **安装入口**：三个。①「离线包下载」＝下载渠道 URL 弹窗，非导入（`render.rs:48-55`、`offline_package_dialog.rs:13-31`）；②「本地安装」＝tar.gz 文件选择器导入（`render.rs:56-64`、`actions.rs:54-70`）——**没有"本地目录"安装入口**（文件选择器 `directories:false`）；③「扩展市场」＝远程 manifest 列表 + 每条「安装」按钮（`render.rs:361-399`），搜索框可输入自定义 manifest URL。
2. **离线包格式要求**：tar.gz；标记文件在包根或唯一子目录均可（composite=`extension.json` 带 `id`，driver=`driver.json` 带 `id`）；禁止绝对路径/`..`/软链接；database_driver 需入口二进制随包；**无校验和、无文件名要求**。三个现有包实测全部满足，可直接导入；`sha256sums.txt` 缺条目只影响市场/发布路径。
3. **database_driver 落盘**：`~/.config/navop/extensions/database_drivers/<id>/`，与应用启动时的唯一驱动扫描目录是同一处（`discovery.rs:7-18`）。重启**当前是必须的**（断点 B）：新建连接卡片可见性依赖 HomePage 缓存注册表，安装不触发重扫；连接打开守卫倒是实时扫描（`database_driver_install.rs:215-218`）。
4. **composite 即装即见**：安装回调同步 `refresh_global_runtime_catalog`（`extension_view_host.rs:184-190`），新建连接窗口每次打开都新建并读 catalog（`connection_window.rs:61-76`）→ **重开新建连接窗口即见，无需重启**；已开着的窗口不会自刷新。
5. **本地市场清单**：`file://` 不可行（http(s) 白名单 + HttpClient）；最小办法＝本地 `python3 -m http.server` + 手写 manifest（附录 A 全量可粘贴），或 `NAVOP_PUBLIC_BASE_URL` 环境变量改默认源；marketplace 路径强制 sha256，且非 macOS aarch64 机器需更换 artifact 键。
