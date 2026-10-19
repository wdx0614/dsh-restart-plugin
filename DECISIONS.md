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

## D7 —— 「重启」按钮位置：侧边栏最底层右侧，必须保留「重启」二字（2026-10-19 晚）

**背景**：用户要求「重启按钮不必占据一行的位置，放到最下方的右边挤一挤」。
最初实现是占满整行宽的按钮（`width: calc(100% + 8px)`），因此独占一行。

**调研（读源码 `deepseek-harness 0.2.1-rc.2`，与桌面版版本一致）**：
侧边栏底部是三层结构（`packages/client/ui-sidebar/src/client/SidebarRoot.module.css`）：

```
footArea (flex-direction: column)
├─ footerActions  ← list 槽位 sidebar.footer.action（插件面板 / 重启 / 会话与工作区）
└─ settingsArea   ← single 槽位 sidebar.settings → 头像那一行（triggerRow）
```

关键约束（读源码 + 实测）：
- `.footerActions` 只是普通 `display:flex`，**自身没有 flex-wrap**；
  是 `dsh-session-manager` 的宽按钮声明了 `flex: 1 1 100%` 并给容器注入了
  `flex-wrap: wrap`，才让同排每项各占一行。
- `settings.launcher` 是 **single 槽位、且已被头像按钮占用**，注册进去会
  **替换掉头像**，不能作为落点。
- `footerActions` 在 DOM 上位于 `triggerRow` **之上**，所以往 `footerActions`
  里加的内容不可能自然排到头像那一行。

**决定**：注册位置保持 `sidebar.footer.action` 不变（不动槽位），用 CSS 把按钮
绝对定位到 `footArea` 的右下角 —— 那正好是头像行（`triggerRow`）的右端：

```css
div[class*="footArea"]{position:relative}
[data-dsh-restart-plugin]{position:absolute;right:0;bottom:6px;z-index:1}
[class*="triggerRow"]{padding-right:66px}   /* 给按钮让位，不压住头像/连接状态 */
```

- 展开态：`↻ 重启`（图标 16px + 文字 13px，高 28px）。
- 收起态（56px 轨道）：只留 36×36 图标。
- 颜色仍只用 `--dsw-*` 主题 token。

**用户明确要求（一次返工）**：曾为「挤一挤」去掉文字只留图标，被要求加回 ——
**「重启」这两个字必须保留，作为显著标识**。已改回并在单元测试里锁定
（`wide` 形态必须包含 `action.label`）。

**否掉的方案**：
- 注册进 `settings.launcher` —— 会替换掉头像（single 槽位）。
- `:has()` + 绝对定位到 footerActions 右端 —— 首版把按钮挤出了可视区域。
- flex `order:99` + `nowrap` 让两者共行 —— 能与「会话与工作区」同行，但用户要的是
  **更下面**的头像那一行，位置不对。
