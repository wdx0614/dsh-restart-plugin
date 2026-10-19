# 交接文档（HANDOVER）

> 给"下一个接手这个项目的人/会话"看的。先读 README → DECISIONS → PROGRESS → 本文件。
> 最后更新：2026-10-19 23:10

## 1. 一句话现状

**做完了。** 一个可用的 DSH 插件，能把「重启」放到**侧边栏最底层（头像那一行）的最右端**，
显示为「↻ 重启」，点击后应用关闭并自动重开。
已过 27 项单元测试 + 12 项进程级验证 + **3 次真机重启测试** + 界面位置/文案真机确认。

## 2. 这个项目解决什么问题

用户诉求原文：在原生「应用」菜单里加「重启」，位置在「退出」上方并分区隔开，
实现"退出软件再自动重启"，因为装/启/停/卸载插件后常需重启才生效，
而 DSH 关掉后不会自己再打开。

**关键事实**：原生「应用」菜单改不了。
DSH 0.2.1-rc.2 的该菜单是 Electron 壳在 `apps/desktop/src/main.ts` 的
`applicationItems()` 里写死的原生菜单，**没有任何插件扩展点**
（全壳只有 4 处 `Menu.buildFromTemplate`，全由壳自己持有）。
用户在知情后选择了「放在 Web 界面里」这条路（选项 C），并明确否决了改 `app.asar`（选项 A）。

## 3. 代码在哪、怎么跑

```
packages/dsh-restart-plugin/
  package.json          包清单（dsh.bundle.patch + dsh.client + engines.dsh）
  cordis.patch.yml      插入 Host 行
  index.js              Host 半（约 470 行，核心逻辑都在这）
  client.js             Client 半（侧边栏按钮 + 确认框）
  locale/{zh,en}.json   插件列表显示元数据
  icon.svg              原创图标
  tests/                27 项单元测试
tools/                  验证与诊断工具
docs/                   面向用户的文档
```

跑测试：

```bash
node --test packages/dsh-restart-plugin/tests/host.test.mjs packages/dsh-restart-plugin/tests/client.test.mjs
node tools/verify-watchdog.mjs        # 4 项，不重启你的应用
node tools/verify-restart-chain.mjs   # 8 项，用假进程仿真
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tools/diagnose-tray.ps1
```

## 4. 已定约束（不要再改）

1. **必须走 cordis 插件机制**，不修改已安装的 `app.asar`（用户明确否决）。
2. **不静默中断任务**：有活动任务时必须二次确认（`force: true` 才继续）。
3. **非桌面环境必须明确拒绝**，不许假装能重启。判据是 `process.execPath`
   是否以 `DeepSeek Harness.exe` 结尾。
4. **不硬杀整棵进程树**：只结束外壳主进程，让 Host 走自带优雅退出。
5. 视图文本走 locale（zh + en），颜色只用 `--dsw-*` 主题 token。

## 5. 已否掉的方案（别重提）

| 方案 | 为什么否 |
|---|---|
| A. 补丁 `app.asar` 改原生菜单 | 能 100% 满足原位置要求，但用户明确否决（改已安装软件本体） |
| B. 只交源码补丁等官方合并 | 用户看不到效果，且本机构建整个 Electron 应用门槛高 |
| 直接 `process.exit()` | 会打断写盘，可能丢数据，只作最后兜底 |
| `taskkill /IM ... /F` 整棵杀 | 会连带杀掉用户其他 DSH 进程 |
| 用 `app.relaunch()` | 只有 Electron 主进程能用，插件够不到 |

## 6. 踩过的最有价值的坑（务必读）

### 坑 1：改完插件代码，真机测试跑的还是旧代码

插件模块常驻 Host 进程内存，改磁盘文件不影响正在运行的进程。
**我第一次修完缺陷做真机测试，测的是旧代码，白排查一轮。**

排查方法（已固化）：
- `/status` 里加了 `watchdogVersion` 字段，缺失=旧代码
- 看门狗日志格式也是判据：新代码写 `waiting for host X and shell Y`

### 坑 2：`windowsHide: true` 会让 Electron 窗口不显示

用 `windowsHide: true` 拉起 GUI 应用，Windows 以 `SW_HIDE` 启动它，
结果应用起来了但只在托盘，看起来像重启失败。
**修法**：启动 GUI 应用用 `windowsHide: false`；并带 `--updated`
（外壳自己认的重启标记，会让窗口 `moveTop()+focus()`）。

### 坑 3：`process.kill` 在 Windows 上等于强杀

没有 SIGTERM 语义。强杀外壳会跳过它的 `finishQuit()` → `tray.dispose()` 被跳过
→ 留下幽灵托盘图标。**这是目前唯一未修的缺陷，已评估决定接受。**

### 坑 4：`ctx.<服务名>` 在未 inject 时是抛异常，不是 undefined

按 `dsh-plugin-dev` skill 的实测结论：可选服务一律 `ctx.get('name')`。
我第一次写的 `apply()` 用了 `ctx.webServer`，被自己的测试抓出来。

### 坑 5：Windows 上不能直接 spawn `.cmd`

会 `EINVAL`。要测看门狗得用真 `.exe`。

### 坑 6：PowerShell 5.1 按 GBK 读脚本

含中文的 `.ps1` 必须存成 **UTF-8 with BOM**，否则中文乱码导致语法错误。

### 坑 7：改客户端布局前先读源码，别从 asar 反推（2026-10-19 晚实测）

本机有与桌面版**同版本**的源码：
`G:\file\deepseek\20261017 deepseek harness 源码克隆\deepseek-harness 0.2.1-rc.2`
（`package.json` 的 version = `0.2.1-rc.2`，与 `runtime.json` 的 `desktopVersion` 一致）。

侧边栏底部结构与样式直接看这两处，一眼就懂：
- `packages/client/ui-sidebar/src/client/SidebarRoot.module.css`
  （`.footArea` / `.footerActions` / `.settingsArea`，约 555–600 行）
- `packages/client/ui-settings-general/src/client/SettingsRoot.module.css`
  （`.triggerRow` —— 头像那一行的容器）

**我踩的弯路**：从 `app.asar` 里解出打包后的 CSS、靠猜类名写选择器，
连错三版（`:has()` 绝对定位 → `order:99` 共行 → 最后才对）。有源码时这一步纯属浪费。

注意 CSS Modules 的类名形如 `_2H3hWW_footArea`，插件里只能用
`[class*="footArea"]` 这种子串选择器命中。

### 坑 8：不要在用户正开着的界面上按 F12 / Ctrl+R 做验证（2026-10-19 晚实测）

两次把用户界面弄成黑屏：
- 按 **F12** 开 DevTools 截图 → 页面资源 `net::ERR_FAILED` 刷屏，界面黑掉。
- 连按 **Ctrl+R** 刷新 → 窗口从最大化缩成小窗，页面渲染异常。

**正确做法**：改完只部署文件，明确告诉用户「重启应用后可见」，由用户自己决定何时重启。
需要看效果就让用户看，不要自己上手操作别人正在用的窗口。

### 坑 9：profile 里装的是 git 副本，不是软链（2026-10-19 实测）

`node_modules/dsh-restart-plugin` 是普通目录（`LinkType` 为空），
因为它是按 `git+https://...#path:...` 装的副本。**改工作区源码不会同步过去。**
每次验证前必须先复制并核对哈希：

```powershell
Copy-Item packages\dsh-restart-plugin\client.js `
  C:\Users\Administrator\.dsh\profiles\desktop\node_modules\dsh-restart-plugin\client.js -Force
(Get-FileHash packages\dsh-restart-plugin\client.js).Hash -eq `
  (Get-FileHash C:\Users\Administrator\.dsh\profiles\desktop\node_modules\dsh-restart-plugin\client.js).Hash
```

### 坑 10：Client 半改动刷新即可，Host 半改动必须重启

`client.js` 只跑在页面里，改完重载页面／重启应用都会重新加载；
`index.js`（Host 半）常驻 Host 进程内存，**必须重启应用**才生效（见坑 1）。

## 7. 如果还要继续做（可选方向）

1. **彻底消除幽灵托盘图标**：需要改 Electron 外壳，给插件一个
   「优雅重启」入口（类似 `app.relaunch()`）。这已经超出插件边界，
   属于给 DSH 官方提需求的范畴。
2. 把「重启」加进命令面板（`ctx.commands.register`），而不只是侧边栏按钮。
3. 发布到 npm，让别人也能 `dsh plugin add dsh-restart-plugin`。
4. 加一个「重启后自动回到原会话」的体验优化（目前重开后是默认界面）。

## 8. 关键文件索引

| 想知道什么 | 看哪里 |
|---|---|
| 怎么装、怎么用（小白向） | `docs/安装与使用.md` |
| 原理、实测证据、风险评估 | `docs/实现原理与风险.md` |
| 3 次真机测试全过程 | `docs/真机重启测试记录.md` |
| 为什么这么设计 | `DECISIONS.md` |
| 核心逻辑 | `packages/dsh-restart-plugin/index.js`（看 `requestRestart` 与 `WATCHDOG_SOURCE`） |
| 界面 | `packages/dsh-restart-plugin/client.js`（看 `RestartFooterAction` 与 `useStyles` 里的定位规则） |
| 侧边栏底部为什么这么排 | `DECISIONS.md` 的 D7 |

## 9. 备份与还原

- profile 原始文件备份：`.ai_backup/install-asm-bundle/20261019-121114/`
  （`cordis.patch.yml` / `package.json` / `pnpm-lock.yaml` + SHA256）
- **布局改动前的 client.js 备份**：`.ai_backup/layout-restart-right-20261019-223416/client.js`
  （SHA256 `045C45AE954EABE6086859B6450C33AC245BBF99196B1036002910805927CB0B`，14167 字节；
  还原即得到「重启独占一整行」的旧布局）
- 卸载插件：设置 → 插件 → 卸载「重启（Restart）」，然后重启应用
- 彻底还原 profile：用上面的备份覆盖回去
