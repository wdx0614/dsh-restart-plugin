/**
 * 真机重启测试的「事后核对」脚本。
 *
 * 用法：
 *   node tools/check-after-restart.mjs <旧HostPid> <旧端口> <测试开始时间ISO>
 *
 * 它会：
 *  1. 确认旧 Host pid 已经不在了；
 *  2. 找到新的 DSH 进程与新的监听端口；
 *  3. 用新端口调用插件的 /status，确认插件在新进程里也活着。
 *
 * 退出码 0 = 全部符合预期。
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

const [oldHostPidRaw, oldPortRaw, startedAtRaw] = process.argv.slice(2)
const oldHostPid = Number(oldHostPidRaw)
const oldPort = Number(oldPortRaw)
const startedAt = startedAtRaw === undefined ? null : new Date(startedAtRaw)

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `  (${detail})`}`)
}

/** 进程是否还活着。 */
function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return Boolean(error) && error.code === 'EPERM' }
}

/** 列出当前所有 DSH 相关进程。 */
async function listDshProcesses() {
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-Command',
    'Get-CimInstance Win32_Process -Filter "Name = \'DeepSeek Harness.exe\'" | ' +
    'Select-Object ProcessId,ParentProcessId,CreationDate,CommandLine | ConvertTo-Json -Compress'])
  const text = stdout.trim()
  if (text === '' || text === 'null') return []
  const parsed = JSON.parse(text)
  return Array.isArray(parsed) ? parsed : [parsed]
}

/** 查找当前监听的端口及其进程。 */
async function listListeners() {
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-Command',
    'Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ' +
    'Where-Object { $_.LocalAddress -in @("127.0.0.1","0.0.0.0","::1","::") } | ' +
    'Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress'])
  const text = stdout.trim()
  if (text === '' || text === 'null') return []
  const parsed = JSON.parse(text)
  return Array.isArray(parsed) ? parsed : [parsed]
}

check('旧 Host 进程已不存在', !isAlive(oldHostPid), `oldHostPid=${String(oldHostPid)}`)

const processes = await listDshProcesses()
const afterStart = startedAt === null
  ? processes
  : processes.filter(proc => new Date(proc.CreationDate) >= startedAt)
check('存在测试开始之后启动的新 DSH 进程', afterStart.length > 0,
  afterStart.map(proc => String(proc.ProcessId)).join(',') || '无')

const listeners = await listListeners()
const candidates = listeners
  .map(item => Number(item.LocalPort))
  .filter(port => Number.isInteger(port) && port > 0 && port !== oldPort)

let verified = null
for (const port of [...new Set(candidates)]) {
  for (const host of ['127.0.0.1']) {
    try {
      const response = await fetch(`http://${host}:${String(port)}/dsh-restart-plugin/api/status`, {
        signal: AbortSignal.timeout(2500),
      })
      if (response.status !== 200) continue
      const body = await response.json()
      if (body?.ok === true) { verified = { port, host, body }; break }
    } catch { /* 不是 DSH 的端口 */ }
  }
  if (verified !== null) break
}

check('在新进程中找到了本插件（说明插件随应用一起恢复）', verified !== null,
  verified === null ? '未找到' : `${verified.host}:${String(verified.port)} pid=${String(verified.body.environment?.pid)}`)

if (verified !== null) {
  check('新进程仍然自认为可重启（环境识别正确）', verified.body.supported === true,
    `supported=${String(verified.body.supported)} reason=${String(verified.body.reason)}`)
  const newPid = Number(verified.body.environment?.pid)
  check('Host pid 与重启前不同（确实是新进程）', newPid !== oldHostPid,
    `old=${String(oldHostPid)} new=${String(newPid)}`)
}

const failed = results.filter(item => !item.ok)
console.log(`\n${String(results.length - failed.length)}/${String(results.length)} 通过`)
process.exitCode = failed.length === 0 ? 0 : 1
