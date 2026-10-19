/**
 * 看门狗端到端验证（不触发真实重启）。
 *
 * 用一个真 .exe 的副本当「假应用」（node.exe 副本，跑一个写 marker 的脚本），
 * 验证：
 *   1. 目标 pid 退出前，看门狗不会提前启动；
 *   2. 目标退出后，看门狗真的启动了目标程序；
 *   3. 新进程环境里 ELECTRON_RUN_AS_NODE 已被剥掉（否则会出现
 *      「点了重启，应用没起来」这种最难查的问题）。
 *
 * 注意：Windows 上不能直接 spawn .cmd（会 EINVAL），所以用真 exe。
 *
 * 运行：node tools/verify-watchdog.mjs
 */

import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { WATCHDOG_SOURCE } from '../packages/dsh-restart-plugin/index.js'

const dir = mkdtempSync(join(tmpdir(), 'dsh-watchdog-verify-'))
const logPath = join(dir, 'watchdog.log')
const markerPath = join(dir, 'launched.txt')
const exePath = join(dir, 'FakeApp.exe')
const scriptPath = join(dir, 'app.js')

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `  (${detail})`}`)
}

try {
  copyFileSync(process.execPath, exePath)
  writeFileSync(scriptPath, [
    "const fs = require('node:fs')",
    "const flag = process.env.ELECTRON_RUN_AS_NODE === undefined ? '<absent>' : process.env.ELECTRON_RUN_AS_NODE",
    `fs.writeFileSync(${JSON.stringify(markerPath)}, 'ELECTRON_RUN_AS_NODE=' + flag + '\\n', 'utf8')`,
  ].join('\n'), 'utf8')

  const victim = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 1200)'], {
    stdio: 'ignore', windowsHide: true,
  })
  const startedAt = Date.now()

  const watchdog = spawn(process.execPath, ['-e', WATCHDOG_SOURCE], {
    env: {
      ...process.env,
      DSH_RESTART_PID: String(victim.pid),
      DSH_RESTART_TARGET: exePath,
      DSH_RESTART_ARGS: JSON.stringify([scriptPath]),
      DSH_RESTART_CWD: dir,
      DSH_RESTART_LOG: logPath,
      DSH_RESTART_TIMEOUT: '20000',
      DSH_RESTART_INTERVAL: '100',
      // 故意带上：看门狗必须剥掉它，否则新应用会以 Node 模式启动。
      ELECTRON_RUN_AS_NODE: '1',
    },
    detached: true, stdio: 'ignore', windowsHide: true,
  })
  watchdog.unref()

  const deadline = Date.now() + 25_000
  while (Date.now() < deadline && !existsSync(markerPath)) {
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  const elapsed = Date.now() - startedAt

  check('目标退出前没有提前启动', elapsed >= 1000, `${String(elapsed)}ms`)
  check('目标程序最终被启动', existsSync(markerPath))

  let log = ''
  try { log = readFileSync(logPath, 'utf8') } catch { log = '' }
  check('看门狗写下了启动日志', log.includes('launched target'))

  if (existsSync(markerPath)) {
    const marker = readFileSync(markerPath, 'utf8').trim()
    check('新进程不再带 ELECTRON_RUN_AS_NODE', marker.includes('<absent>'), marker)
  } else {
    check('新进程不再带 ELECTRON_RUN_AS_NODE', false, '未产生 marker')
  }

  try { victim.kill() } catch { /* 已退出 */ }
} finally {
  const failed = results.filter(item => !item.ok)
  console.log(`\n${String(results.length - failed.length)}/${String(results.length)} 通过`)
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  process.exitCode = failed.length === 0 ? 0 : 1
}
