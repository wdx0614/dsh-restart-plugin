# DSH 电源菜单（dsh-restart-plugin）

给 **DeepSeek Harness（DSH）桌面版** 加一个电源按钮：点一下，可以**重启 DSH** 或**关闭 DSH**。

安装/启用/禁用/卸载插件后，常常要重启 DSH 才生效；而 DSH 桌面版关掉窗口只是收进托盘，
真正退出或重启要去托盘菜单里翻。这个插件把这两个动作搬到侧边栏底部，一步到位。

Windows / macOS 桌面版 · 纯本地 · 无遥测 · MIT

## 功能

- **电源按钮**在侧边栏最底部一行的右侧（头像右边）。点击向上弹出菜单。
- **二级菜单**两项，图标 + 文字：
  - **重启 DSH**（环形箭头）— 关闭应用，几秒后自动重新打开。
  - **关闭 DSH**（门 + 箭头）— 完全退出应用，不重新打开；下次需手动启动。
- **有任务时会拦一次**：如果有正在运行或已排期的任务，会明确提示「任务会被中断」，
  需要再点一次「仍然重启 / 仍然关闭」才执行。绝不静默中断。
- **非桌面环境明确拒绝**：`dsh web` 之类环境里会说明无法自动重启，而不是假装成功。
- **跟随主题**：颜色只用 `--dsw-*` 主题变量，浅色/深色自动适配。
- **键盘可用**：菜单里 ↑/↓ 移动、Enter/空格执行、Esc 关闭、点菜单外也能关。

## 安装

> **重要**：装完必须再运行一次 `enable.ps1`，把插件补进 profile 的 `dsh.profile.bundles`，
> 然后重启 DSH。少了这一步，按钮不会出现——这是 DSH 插件管理器只写 `dependencies`、
> 不写 `bundles` 的已知行为，不是插件本身的问题。

### 方式 A：通过 DSH 插件管理器（图形界面，推荐新手）

1. 打开 DSH 桌面版 → **设置** → **插件**（或「插件市场」）。
2. 点 **添加插件**。
3. 在输入框里粘贴这一行（**注意开头必须带 `github:`**）：

   ```
   github:wdx0614/dsh-restart-plugin
   ```

4. 点 **安装**，等它跑完。这一步需要本机能连上 GitHub
   （在命令行里 `git ls-remote https://github.com/wdx0614/dsh-restart-plugin` 能成功即可）。
5. 下载本仓库（或 `git clone`），在仓库目录里运行一次：

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\enable.ps1
   ```

6. **重启 DSH**。之后左侧边栏最底部右侧会出现电源按钮。

### 方式 B：命令行安装

```powershell
dsh plugin --profile desktop add github:wdx0614/dsh-restart-plugin
powershell -ExecutionPolicy Bypass -File .\enable.ps1
```

`dsh` 是 DSH 自带的命令行工具；如果系统 PATH 里没有，用安装目录下的
`<安装目录>\resources\runtime\cli\bin\dsh.cmd`。

### 方式 C：从本机克隆的源码安装（改代码调试时用）

```powershell
git clone https://github.com/wdx0614/dsh-restart-plugin.git
dsh plugin --profile desktop add file:<克隆下来的目录>
powershell -ExecutionPolicy Bypass -File .\enable.ps1
```

### 装完按钮不出来？

按顺序查这三件事：

| 现象 | 原因 | 怎么办 |
|---|---|---|
| 提示「这个包没有声明组合包」 | 仓库根目录缺 `package.json`，或 `package.json` 里没有 `dsh.bundle` 声明 | 升级到 1.1.0+（包已放到仓库根目录）；旧结构装不了 |
| 提示 `not a package name the registry accepts` | 输入框里只写了 `wdx0614/dsh-restart-plugin`，少了 `github:` 前缀 | 改成 `github:wdx0614/dsh-restart-plugin` |
| 插件「已启用」但按钮不出现 / 点了 404 | 只进了 `dependencies`，没进 `dsh.profile.bundles` | 运行 `enable.ps1`，然后重启 DSH |
| 运行 `enable.ps1` 后仍不出现 | Host 半要重启进程才加载 | 完全退出 DSH（托盘右键退出），再重新打开 |

详细步骤见 [docs/安装与使用.md](docs/安装与使用.md)。

## 它是怎么实现「重启」的

Host 是 Electron 的子进程，纯插件**没法**让 Electron 主进程调用 `app.relaunch()`——那需要改壳。
所以本插件用「**看门狗 + 优雅关闭**」：

1. 用户选「重启 DSH」并确认；
2. 关闭前先拉起一个**脱离的看门狗子进程**，它等待 Host 真正退出；
3. Host 走 cordis 正规的关闭通道退出（等于正常退出 DSH）；
4. 看门狗随后用原可执行文件重新启动 `DeepSeek Harness.exe`。

「关闭 DSH」走同一套退出流程，只是**不拉看门狗**——没有人去重新打开应用。

详见 [docs/实现原理与风险.md](docs/实现原理与风险.md)，其中有实测与未验证之分的标注。

## 验证状态

| 项目 | 状态 |
|---|---|
| 单元测试 27 项 | ✅ 全通过（实测） |
| 看门狗端到端 4/4 | ✅ 全通过（实测） |
| 完整重启链路 8/8 | ✅ 全通过（假进程仿真，实测） |
| 真机重启（3 次） | ✅ 应用确实关闭并自动重开（实测，见 [测试记录](docs/真机重启测试记录.md)） |
| 窗口自动置顶 | ✅ 已修复并真机验证（实测） |
| 有任务时二次确认 | ✅ 实测返回 409 要求确认 |
| 非桌面环境拒绝 | ✅ 实测返回 409 `not-desktop` |
| 电源按钮 + 二级菜单 | ✅ 已实现；界面观感待真机确认（未验证） |
| 托盘残留一个幽灵图标 | ⚠️ **已知缺陷，接受**（无 CPU/内存开销，悬停即消失；彻底修需改 Electron 壳） |

## 目录结构

插件包就在**仓库根目录**（这样 `github:` 安装才能识别），不是放在子目录里：

```
package.json          包清单（dsh.bundle.patch + dsh.client），必须在根目录
cordis.patch.yml      Loader 补丁，插入 Host 行
index.js              Host 半：重启/关闭控制器 + HTTP 路由 + 看门狗
client.js             Client 半：电源按钮 + 二级菜单 + 确认框
locale/{en,zh}.json   插件列表里的显示元数据
icon.svg              插件图标
enable.ps1            装完后补 dsh.profile.bundles 的脚本（必跑一次）
tests/                单元测试
tools/                验证与诊断脚本
docs/                 使用说明与原理文档
```

## 文档

| 文件 | 内容 |
|---|---|
| [docs/安装与使用.md](docs/安装与使用.md) | **小白向**：怎么装、怎么用、出问题怎么办 |
| [docs/实现原理与风险.md](docs/实现原理与风险.md) | 原理、实测证据、已知缺陷与风险评估 |
| [docs/真机重启测试记录.md](docs/真机重启测试记录.md) | 3 次真机测试的完整过程与证据 |

## 许可

MIT，见 [LICENSE](LICENSE)。
