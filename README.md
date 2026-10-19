# DSH 重启插件（dsh-restart-plugin）

## 这是什么

给 **DeepSeek Harness（DSH）桌面版** 加一个「重启」入口的 cordis 插件。

安装插件、启用/禁用插件、卸载插件后，常常要重启 DSH 才生效；
而 DSH 桌面版关掉后不会自己再打开，用户得手动去开始菜单或桌面图标重新启动。
本插件把「退出 + 自动重启」合成一个动作。

## 为什么不是原生「应用」菜单

原始需求是：在原生菜单栏的「应用」里、软件自带「退出」的上方加一项「重启」，并用分区线隔开。

**调研结论（已实测源码）：做不到。** DSH 0.2.1-rc.2 的「应用」菜单是 Electron 壳在主进程
`apps/desktop/src/main.ts` 的 `applicationItems()` 里写死的原生菜单，整个壳内只有 4 处
`Menu.buildFromTemplate`，全部由壳自己持有；cordis 插件只能扩展 Host 与 Web 客户端，
**没有任何注册进原生菜单的扩展点**。

所以本插件把重启入口放在 **Web 界面**里（侧边栏底部、设置齿轮旁边），
这是插件机制能到达的、最接近原需求的位置。详见 [DECISIONS.md](DECISIONS.md)。

## 目录结构

```
packages/dsh-restart-plugin/   插件源码（可安装的 cordis bundle）
  package.json                 包清单（dsh.bundle.patch + dsh.client）
  cordis.patch.yml             Loader 补丁，插入 Host 行
  index.js                     Host 半：重启控制器 + HTTP 路由
  client.js                    Client 半：侧边栏按钮 + 确认框
  locale/{en,zh}.json          显示元数据（插件列表里的标题/描述）
  icon.svg                     插件图标
tools/                         安装/卸载/打包脚本
docs/                          文档
```

## 怎么用

见 [docs/安装与使用.md](docs/安装与使用.md)。

## 重要事实：它怎么实现「重启」

Host 是 Electron 的子进程（实测进程树：Host pid 12168 → 父进程 Electron 主进程 11756）。
纯插件**没法**让 Electron 主进程调用 `app.relaunch()`——那需要改壳。

因此本插件用「**看门狗 + 优雅关闭**」实现：

1. 用户点「重启」并确认；
2. Host 用 cordis 正规的 `shutdown.shutdown(0)` 优雅关闭自己（等于正常退出 DSH）；
3. 关闭前先拉起一个**脱离的看门狗子进程**，它等待 Host 进程真正退出；
4. 看门狗随后重新启动 `DeepSeek Harness.exe`，并把用户带回。

这条链路**会**真正重启整个应用（壳 + Host 都会重开），因为壳在 Host 退出后会跟着退出。
详见 [docs/实现原理与风险.md](docs/实现原理与风险.md)，其中有实测与未验证之分的标注。

## 验证状态（截至 2026-10-19）

| 项目 | 状态 |
|---|---|
| 单元测试 27 项 | ✅ 全通过（实测） |
| 看门狗端到端 4/4 | ✅ 全通过（实测） |
| 完整重启链路 8/8 | ✅ 全通过（假进程仿真，实测） |
| **真机重启（3 次）** | ✅ 应用确实关闭并自动重开（实测，见 [测试记录](docs/真机重启测试记录.md)） |
| 窗口自动置顶 | ✅ 已修复并真机验证（实测） |
| 有任务时二次确认 | ✅ 实测返回 409 要求确认 |
| 非桌面环境拒绝重启 | ✅ 实测返回 409 `not-desktop` |
| 托盘残留一个幽灵图标 | ⚠️ **已知缺陷，接受**（无 CPU/内存开销，悬停即消失，彻底修需改 Electron 壳） |

## 文档索引

| 文件 | 内容 |
|---|---|
| [docs/安装与使用.md](docs/安装与使用.md) | **小白向**：怎么装、怎么用、出问题怎么办 |
| [docs/实现原理与风险.md](docs/实现原理与风险.md) | 原理、实测证据、已知缺陷与风险评估 |
| [docs/真机重启测试记录.md](docs/真机重启测试记录.md) | 3 次真机测试的完整过程与证据 |
| [DECISIONS.md](DECISIONS.md) | 决策记录：定了什么、否掉了什么、为什么 |
| [PROGRESS.md](PROGRESS.md) | 当前进度 |
| [HANDOVER.md](HANDOVER.md) | 长任务交接文档 |

## 许可

MIT
