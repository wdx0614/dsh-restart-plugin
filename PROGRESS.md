# 进度（PROGRESS）

> 每完成一个阶段就更新本文件。新会话接手时先读 README / DECISIONS / 本文件 / HANDOVER。
> 最后更新：2026-10-19 13:05

## 当前状态：功能完成，已通过 3 次真机验证，进入交付与推送阶段

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

---

## 下一步

1. [ ] 提交全部改动
2. [ ] 建 GitHub 私有仓库并推送
3. [ ] 写 HANDOVER.md（便于后续接手）

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
