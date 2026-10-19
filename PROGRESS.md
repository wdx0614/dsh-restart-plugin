# 进度（PROGRESS）

> 每完成一个阶段就更新本文件。新会话接手时先读 README / DECISIONS / 本文件 / HANDOVER。
> 最后更新：2026-10-19 23:10

## 当前状态：✅ 已交付 —— 功能完成、3 次真机验证、界面布局按用户要求改造完成、已推送 GitHub 私有仓库

---

## 已完成

### 阶段 1：侦察（2026-10-19 上午）

- [x] 读源码 + 解包已安装 `app.asar` 双向核对架构
- [x] 确认「应用」菜单是 Electron 壳写死的原生菜单，**无插件扩展点**（实测源码）
- [x] 确认 Host 是 Electron 子进程（实测进程树：Host 12168 → 父 Electron 11756）
- [x] 确认第三方插件可行模式：Host `ctx.webServer.register()` + Client `fetch`
      （参照已安装的 dsh-session-manager 真实实现）
- [x] 确认 Client 挂载点 `sidebar.footer.action`（list / scope root，用
      `cordis_inspect_query` 的 `Slots.listSubTree` 查得）
- [x] 确认运行时基准版本 0.2.1-rc.2

### 阶段 2：与用户确认路线

- [x] 向用户说明「原生菜单做不到」，提供 A/B/C 三条路
- [x] 用户选择 **C：Web 界面内的重启入口**，并明确否决 A（改 app.asar）

### 阶段 3：实现

- [x] `package.json`：包清单 + `dsh.bundle.patch` + `dsh.client` + `engines.dsh`
- [x] `cordis.patch.yml`：插入 Host 行
- [x] `index.js`（Host 半）：环境识别 / 活动任务检查 / 看门狗 / 优雅关闭
- [x] `client.js`（Client 半）：侧边栏按钮 + 确认框 + zh/en 双语 + 主题化样式
- [x] `locale/{zh,en}.json`：插件列表显示元数据
- [x] `icon.svg`：原创图标

### 阶段 4：验证

- [x] 单元测试 **27 项全通过**（`tests/host.test.mjs` 21 项 + `tests/client.test.mjs` 6 项）
- [x] 看门狗端到端 **4/4**（`tools/verify-watchdog.mjs`）
- [x] 完整重启链路 **8/8**（`tools/verify-restart-chain.mjs`，假进程仿真）
- [x] 真实安装：`application: applied`，Host 路由返回 200
- [x] Client 注册确认：`Slots.listSubTree` 显示 `dsh-restart-plugin` active
- [x] **3 次真机重启测试**（详见 `docs/真机重启测试记录.md`）

### 阶段 5：修缺陷

- [x] 缺陷 1「窗口不自动弹出」→ 已修复并真机验证
      （根因：`windowsHide:true` 让 Electron 以 SW_HIDE 启动；
      修复：`windowsHide:false` + 带 `--updated` 参数让窗口置顶）
- [x] 缺陷 2「两个托盘图标」→ **已定位根因，评估后决定接受**
      （根因：`process.kill` 在 Windows 上强杀外壳，跳过 `tray.dispose()`；
      无资源开销、不影响功能，彻底修需改外壳，超出插件边界）

### 阶段 6：文档与工具

- [x] `README.md` / `DECISIONS.md` / `PROGRESS.md`
- [x] `docs/安装与使用.md`（小白向，含"点哪里"）
- [x] `docs/实现原理与风险.md`（含可信度标注）
- [x] `docs/真机重启测试记录.md`（3 次测试全过程 + 证据）
- [x] `tools/diagnose-tray.ps1`：重启体检工具（进程角色 / 托盘图标 / 资源占用）

### 阶段 7：界面布局改造（2026-10-19 晚）

用户要求：「重启按钮不必占据一行的位置，放到最下方的右边挤一挤」，
并在中途明确要求**保留「重启」二字作为显著标识**。

- [x] 读同版本源码定位底部三层结构（`footArea` → `footerActions` / `settingsArea`）
- [x] 确认 `settings.launcher` 是 single 槽位且已被头像占用，不能作落点
- [x] 改为绝对定位到 `footArea` 右下角 = 头像 `wx_` 那一行的最右端
- [x] 恢复「↻ 重启」图标 + 文字，收起态只留图标
- [x] 单元测试同步更新（宽栏必须含文字）+ 27 项全过
- [x] 真机确认：截图核对，位置/文案符合要求
- [x] 决策与踩坑写入 `DECISIONS.md` D7、`HANDOVER.md` 坑 7–10

**返工记录（值得记）**：第一版去掉了文字只留图标（为「挤一挤」），
被用户要求加回；第二版位置只到「会话与工作区」那一行，也非用户所要。
共 3 版才定稿。教训见 `HANDOVER.md` 坑 7（有源码就别反推 asar）。

---

## 下一步

全部完成。后续可选方向见 HANDOVER.md 第 7 节。

---

## 未决问题

- 无功能性未决问题。
- ⚠️ 若以后想彻底消除幽灵托盘图标，需要改 Electron 外壳
  （提供 `app.relaunch()` 级别的插件接口），不是本插件能做的。

---

## 已知风险（已评估，可接受）

- 幽灵托盘图标（详见 `docs/实现原理与风险.md` 第四节）
- 重启会中断正在运行的任务（设计如此，已加二次确认）
- 只在桌面版可用（非桌面环境明确拒绝，不假装支持）
