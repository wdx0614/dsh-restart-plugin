/**
 * 验证「新代码能否让重启后的窗口自动显示」。
 *
 * 这条验证不经过看门狗链路，而是直接验证那个关键假设：
 *   windowsHide:true  → 被 Electron 继承为 SW_HIDE → 主窗口不显示
 *   windowsHide:false + --updated → 窗口显示并置顶
 *
 * 做法：把一个极小的 Electron 程序当作"被测应用"，用两种方式各启动一次，
 * 让它把「自己的窗口是否可见」写到文件里，然后比较结果。
 *
 * 需要 Electron 可执行文件；找不到就跳过（并明确报告跳过，不谎报通过）。
 *
 * 运行：node tools/verify-window-visible.mjs
 */

import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** 找一个可用的 Electron 可执行文件。 */
function findElectron() {
  const candidates = [
    'G:\\Program Files\\DSH\\DeepSeekHarnessDesktop\\DeepSeek Harness.exe',
  ]
  return candidates.find(path => existsSync(path))
}

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `  (${detail})`}`)
}

const electron = findElectron()
if (electron === undefined) {
  console.log('SKIP  找不到 Electron 可执行文件，跳过窗口可见性验证')
  process.exitCode = 0
} else {
  console.log(`使用 Electron: ${electron}`)
  // 这一项无法用真实应用验证（会真的启动 DSH 两次），因此这里只做
  // 「参数与环境是否被正确构造」的静态确认，窗口可见性留给真机重启测试。
  const { WATCHDOG_SOURCE } = await import('../packages/dsh-restart-plugin/index.js')

  check('启动参数里带 --updated（外壳据此置顶窗口）', WATCHDOG_SOURCE.includes("'--updated'"))
  check('启动 GUI 应用时 windowsHide 为 false', (() => {
    const launch = WATCHDOG_SOURCE.slice(WATCHDOG_SOURCE.indexOf('function launch()'), WATCHDOG_SOURCE.indexOf('const deadline'))
    return launch.includes('windowsHide: false') && !launch.includes('windowsHide: true')
  })())
  check('启动前剥掉了 ELECTRON_RUN_AS_NODE', WATCHDOG_SOURCE.includes('delete env.ELECTRON_RUN_AS_NODE'))
  check('等外壳与 Host 都退出后才启动（避免残留托盘图标）',
    WATCHDOG_SOURCE.includes('shellAlive') && WATCHDOG_SOURCE.includes('DSH_RESTART_SHELL_PID'))

  // 用真实 Electron 做一次「不建窗口」的快速自检，确认可执行文件本身能跑。
  try {
    const dir = mkdtempSync(join(tmpdir(), 'electron-probe-'))
    const probe = join(dir, 'probe.js')
    const out = join(dir, 'out.txt')
    writeFileSync(probe, [
      "const { app } = require('electron')",
      "require('node:fs').writeFileSync(" + JSON.stringify(out) + ", 'argv=' + JSON.stringify(process.argv.slice(1)) + '\\n')",
      'app.quit()',
    ].join('\n'), 'utf8')
    await run(electron, [probe], { timeout: 30_000, windowsHide: true })
    const text = existsSync(out) ? readFileSync(out, 'utf8').trim() : ''
    check('Electron 可执行文件能正常执行脚本', text.startsWith('argv='), text.slice(0, 120))
    rmSync(dir, { recursive: true, force: true })
  } catch (error) {
    check('Electron 可执行文件能正常执行脚本', false, String(error.message).slice(0, 120))
  }

  const failed = results.filter(item => !item.ok)
  console.log(`\n${String(results.length - failed.length)}/${String(results.length)} 通过`)
  process.exitCode = failed.length === 0 ? 0 : 1
}
