# 决策记录（DECISIONS）

> 本文件记录"定了什么、否掉了什么、为什么"。改动前先读这里，避免重提已否掉的方案。

## D1 —— 不在 Web 界面里加原生菜单项，而是走 cordis 插件（2026-10-19）

**背景**：需求原话是在原生「应用」菜单里加「重启」，位置在「退出」上方，并且要分区隔开。

**调研（实测）**：
- 桌面版 0.2.1-rc.2，「应用」菜单由 `apps/desktop/src/main.ts` 的 `applicationItems()` 生成，
  是 Electron 主进程 `Menu` 原生菜单。
- 整个壳只有 4 处 `Menu.buildFromTemplate` / 1 处 `Menu.setApplicationMenu`，全部由壳自己持有。
- Windows 上该菜单通过 `DESKTOP_IPC.windowsMenu` 由 `preload-menu.ts` 在页面里画菜单栏按钮，
  再调主进程弹原生 `Menu`。**页面侧只负责按钮文字与坐标，菜单内容完全由主进程决定**，
  没有任何插件可注册的扩展点。

**决定**：走 cordis 插件机制，把「重启」入口放在 **Web 界面**（侧边栏底部、设置齿轮旁）。

**否掉的方案**：
- **A. 打补丁改已安装的 `app.asar`**（把壳的 `applicationItems()` 改掉）——技术上可行，
  能 100% 满足原位置要求；但用户明确否决（"基于 A 路线的取消"），因为要改已安装的软件本体。
  **这个方案没有被证伪，只是被用户否决。** 若以后用户改主意，本仓库的调研笔记仍可用。
- **B. 只交付源码补丁等官方合并**——同样能改原生菜单，但用户看不到效果，且本机构建整个
  Electron 应用门槛高、网络慢。

## D2 —— 重启 = 看门狗 + 优雅关闭，而不是简单 process.exit（2026-10-19）

**背景**：纯插件无法调用 `app.relaunch()`；`app.exit()` 只有 Electron 主进程能用。

**决定**：
1. 拉一个**脱离的**看门狗子进程（`detached: true` + `stdio: ignore` + `unref()`），
   它只做一件事：等 Host 进程退出 → 重新 `spawn` `DeepSeek Harness.exe`。
2. Host 侧走 cordis 正规关闭通道（`ctx.get('appExit')` / `shutdown.shutdown(0)`），
   让会话、存储、日志都能正常落盘，而不是硬杀。
3. 看门狗启动应用时**不带** `--type=` 之类参数，直接启动用户当初用的那个 exe。

**否掉的方案**：
- **直接 `process.exit()`**：会打断正在写盘的会话/终端，可能丢数据。只作为最后兜底。
- **`taskkill /IM "DeepSeek Harness.exe" /F` 整棵杀**：更暴力，且会连带杀掉用户其他 DSH 进程
  （如果同时开了 `dsh web`）。只在用户明确选择"强制重启"时用。

## D3 —— 拒绝在有活动任务时静默重启（2026-10-19）

**背景**：DSH 自己退出时会检查"有没有正在跑的任务"，有就弹确认框。

**决定**：插件重启前也做同样的检查（读 `ctx.agents` 的活动情况），
如果有活动任务，确认框里明确写"正在运行的任务会被中断"，并要求二次确认。
**绝不静默重启**。

## D4 —— 沿用 DSH 既有的 UI 语言与主题（2026-10-19）

**决定**：
- 文本走 Client locale 服务（`ctx.locale.register`），提供 zh + en 两套。
- 颜色只用 `--dsw-*` 主题 token，不硬编码颜色，自动跟随浅色/深色主题。
- 图标用 SVG，原创（一个环形箭头 + 断开方块，表示"重启"）。

## D5 —— 插件 ID 与包名（2026-10-19）

- 包名：`dsh-restart-plugin`（不带 scope，便于本地目录安装与后续 npm 发布）
- Loader 行 id：`dsh-restart-plugin`
- Client module id：`dsh-restart-plugin`

理由：DSH 的 client 模块以包名为 id，三者统一最不容易出错。

## D6 —— 关于 `engines.dsh` 版本护栏（2026-10-19）

**实测结论**（来自 `dsh-plugin-dev` skill 的版本兼容清单）：
- 不写版本声明 → 运行时直接认为兼容，护栏形同虚设。
- `engines.dsh` 存在时会**完全覆盖** `peerDependencies`。
- `engines.dsh` 里不能用 `workspace:*`。

**决定**：写 `"engines": { "dsh": "^0.2.1-rc.2" }`。基准版本 = 本机
`runtime.json` 的 `desktopVersion`（0.2.1-rc.2，已实测）。
