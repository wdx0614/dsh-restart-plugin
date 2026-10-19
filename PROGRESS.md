# 进度（PROGRESS）

> 每完成一个阶段就更新本文件。新会话接手时先读 README / DECISIONS / 本文件。

## 当前阶段

阶段 2：编写插件代码

## 已完成

- [x] 侦察 DSH 0.2.1-rc.2 架构（源码 + 已安装 app.asar 双向核对）
  - 确认「应用」菜单是壳的写死原生菜单，无插件扩展点（实测）
  - 确认 Host 是 Electron 子进程（实测进程树：Host 12168 → 父 Electron 11756）
  - 确认第三方插件可行模式：Host `ctx.webServer.register()` 路由 + Client `fetch` 调用
    （参照已安装的 dsh-session-manager 真实实现）
  - 确认 Client 侧挂载点：`sidebar.footer.action`（list，scope root，可注册）
- [x] 确认路线（用户在 A/B/C 三选项中选 C：Web 界面内的重启入口）
- [x] 确认运行时版本 0.2.1-rc.2（`runtime.json` desktopVersion，已实测）
- [x] 项目骨架 + git init + .gitignore
- [x] README.md / DECISIONS.md
- [ ] 插件代码（package.json / patch / index.js / client.js / locale / icon）
- [ ] 本地语法与清单校验
- [ ] 试装到 desktop profile 并验证
- [ ] 交付文档
- [ ] 推送 GitHub 私有仓库

## 下一步

1. 写插件五个文件
2. 本地校验：`node --check`、manifest JSON 合法性、patch YAML 合法性
3. 用 `plugin_manager install_bundle` 试装
4. 新建会话/刷新页面，实际点一次「重启」验证
5. 写交付文档（小白可执行）
6. 建 GitHub 私有仓库并推送

## 未决问题

- **重启链路需真机验证**：看门狗方案设计上成立（类似 VS Code 的 restart 机制），
  但"DETACHED 子进程能否在父进程退出后存活并拉起应用"必须实测，不能只靠推理。
- 需要确认：从 profile 安装的插件，其 `client.js` 是否会被 client-modules 正确扫描并加载
  （依据：dsh-session-manager/dshmarket 等真实插件都是这个结构，⚠️ 未在本机装过自研插件验证）。
- 需要确认点「重启」时如果有活动任务，检查逻辑取哪个 API 最准确。

## 已知风险

- 重启失败可能导致用户"应用关掉了但没起来"，需要提供兜底提示与手动启动方法。
- 不能影响用户已有的其他插件。
