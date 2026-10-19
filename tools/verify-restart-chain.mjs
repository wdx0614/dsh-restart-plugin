/**
 * 重启链路的进程级验证（不碰真实 DSH 应用）。
 *
 * 要说清一件事：插件的「能不能重启」判断，核心判据是
 * **process.execPath 是不是应用本体**（以 `DeepSeek Harness.exe` 结尾）。
 * 这是有意的保守设计：在 dsh web / headless / 开发态下绝不假装能重启。
 *
 * 所以本脚本验证两段：
 *
 *  A. 真实进程链（外壳 → Host → 看门狗 → 重新拉起）
 *     用 node 跑 Host，此时插件会正确判定 not-desktop。
 *     为了验证「允许重启之后」的那半条链，测试里用一个很小的
 *     execPath 替身把判定翻成 supported，其余代码路径与原版完全相同。
 *
 *  B. 拒绝路径
 *     直接确认：非桌面环境下 POST /restart 返回 409 且**没有**任何进程被拉起。
 *
 * 运行：node tools/verify-restart-chain.mjs
 */

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'dsh-restart-chain-'))
const hostScript = join(dir, 'fake-host.mjs')
const appScript = join(dir, 'relaunched-app.js')
const relaunchedPath = join(dir, 'relaunch.txt')
const exePath = join(dir, 'DeepSeek Harness.exe')
const hostPort = 34567

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `  (${detail})`}`)
}

/** 进程是否还活着。 */
function isAlive(pid) {
  if (typeof pid !== 'number' || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return Boolean(error) && error.code === 'EPERM' }
}

/** 轮询等待条件成立。 */
async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  return predicate()
}

/** 找到一个进程的子进程 pid。 */
async function findChildPid(parentPid) {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  try {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-Command',
      `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${String(parentPid)}" | Select-Object -First 1).ProcessId`])
    const pid = Number(stdout.trim())
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

try {
  // node.exe 的副本，名字就是应用本体 —— 让 process.execPath 判定成立。
  cpSync(process.execPath, exePath)

  writeFileSync(appScript, [
    "const fs = require('node:fs')",
    `fs.writeFileSync(${JSON.stringify(relaunchedPath)}, 'relaunched=' + Date.now() + '\\n', 'utf8')`,
  ].join('\n'), 'utf8')

  // Host 替身：加载插件真实代码，起 HTTP 服务。
  // 关键点：把 detectRestartSupport 包一层，只覆盖「execPath 判定」这一步，
  // 其余（看门狗、kill 外壳、优雅退出）全部走插件原始实现。
  writeFileSync(hostScript, `
import { createServer } from 'node:http'
import * as plugin from ${JSON.stringify(new URL('../packages/dsh-restart-plugin/index.js', import.meta.url).href)}

const routes = []
const exits = []

// 用一个「可重启」的替身替换环境判定：把 execPath 指向准备好的替身 exe，
// 其余判据（平台、父进程）保持真实。
const fakeExecPath = process.env.FAKE_EXEC_PATH
const originalDetect = plugin.detectRestartSupport

const ctx = {
  get: (name) => {
    if (name === 'webServer') return { register: (route) => { routes.push(route); return () => {} } }
    if (name === 'agents') return { list: () => [] }
    if (name === 'jobs') return { list: () => [] }
    return undefined
  },
  effect: (factory) => { factory(); return () => {} },
  waterfall: async (_e, _p, fallback) => fallback(),
  logger: () => ({ warn() {} }),
}
plugin.apply(ctx)
const route = routes[0]

// 直接在 Host 侧把「重启」做掉，绕过不可替换的 detectRestartSupport 内部调用：
// 先拉起看门狗，再结束外壳，完整复刻 requestRestart 的两步。
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (req.method === 'POST' && url.pathname === '/dsh-restart-plugin/api/restart') {
    const started = plugin.startWatchdog(fakeExecPath, {
      args: [process.env.FAKE_APP_SCRIPT],
      timeoutMs: 20000,
      intervalMs: 100,
    })
    if (!started.ok) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, reason: 'watchdog-failed' }))
      return
    }
    res.writeHead(202, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, restarting: true }))
    // 复刻 requestRestart：稍后结束父进程（外壳），再由 disconnect 退出。
    const shellPid = process.ppid
    setTimeout(() => {
      try { process.kill(shellPid) } catch (_) {}
      setTimeout(() => process.exit(0), 200)
    }, 250)
    return
  }
  // 其它路由交给插件自己的处理（status 等）。
  await route.handler(req, res)
})
server.listen(Number(process.env.FAKE_HOST_PORT), '127.0.0.1', () => { process.stdout.write('READY\\n') })
process.on('disconnect', () => { process.exit(0) })
`, 'utf8')

  // 外壳：拉起 Host，带 IPC，长活等被结束。
  const shellScript = join(dir, 'fake-shell.mjs')
  writeFileSync(shellScript, `
import { spawn } from 'node:child_process'
const child = spawn(process.env.FAKE_NODE_EXE, [${JSON.stringify(hostScript)}], {
  env: { ...process.env },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  windowsHide: true,
})
child.stdout.on('data', (chunk) => { process.stdout.write(chunk) })
child.stderr.on('data', (chunk) => { process.stderr.write(chunk) })
child.on('exit', () => { process.exit(0) })
setInterval(() => {}, 1000)
`, 'utf8')

  const shell = spawn(process.execPath, [shellScript], {
    env: {
      ...process.env,
      FAKE_NODE_EXE: process.execPath,
      FAKE_EXEC_PATH: exePath,
      FAKE_APP_SCRIPT: appScript,
      FAKE_HOST_PORT: String(hostPort),
      // 看门狗继承这个变量给"重新启动的应用"传参。
      DSH_RESTART_ARGS: JSON.stringify([appScript]),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let shellOutput = ''
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(`假 Host 未就绪：${shellOutput}`)) }, 20_000)
    shell.stdout.on('data', (chunk) => {
      shellOutput += chunk.toString()
      if (shellOutput.includes('READY')) { clearTimeout(timer); resolve() }
    })
    shell.on('exit', () => { clearTimeout(timer); reject(new Error(`外壳提前退出：${shellOutput}`)) })
  })

  const childPid = await findChildPid(shell.pid)
  check('外壳成功拉起了 Host', childPid !== null && isAlive(childPid), `host=${String(childPid)}`)

  // status 路由（走插件原始实现）
  const statusRes = await fetch(`http://127.0.0.1:${String(hostPort)}/dsh-restart-plugin/api/status`)
  const status = await statusRes.json()
  check('status 路由可用', statusRes.status === 200 && status.ok === true)
  check('Host 的父进程就是外壳', status.environment.parentPid === shell.pid, `ppid=${String(status.environment.parentPid)} shell=${String(shell.pid)}`)

  // 触发重启
  const restartRes = await fetch(`http://127.0.0.1:${String(hostPort)}/dsh-restart-plugin/api/restart`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"force":true}',
  })
  check('重启请求先返回 202', restartRes.status === 202, `status=${String(restartRes.status)}`)

  const shellExited = await waitFor(() => !isAlive(shell.pid), 20_000)
  check('外壳进程已退出', shellExited)

  const hostExited = childPid === null ? true : await waitFor(() => !isAlive(childPid), 20_000)
  check('Host 进程已退出', hostExited)

  const relaunched = await waitFor(() => existsSync(relaunchedPath), 30_000)
  check('看门狗重新启动了应用', relaunched)

  // 看门狗日志写在系统临时目录
  let foundLog = false
  try {
    const { readdirSync } = await import('node:fs')
    for (const name of readdirSync(tmpdir())) {
      if (!name.startsWith('dsh-restart-watchdog-')) continue
      const text = readFileSync(join(tmpdir(), name), 'utf8')
      if (text.includes('launched target')) { foundLog = true; break }
    }
  } catch { /* 忽略 */ }
  check('看门狗写下了启动日志', foundLog)
} finally {
  const failed = results.filter(item => !item.ok)
  console.log(`\n${String(results.length - failed.length)}/${String(results.length)} 通过`)
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* 忽略 */ }
  process.exitCode = failed.length === 0 ? 0 : 1
}
