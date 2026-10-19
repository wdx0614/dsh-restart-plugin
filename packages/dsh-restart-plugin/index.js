/**
 * dsh-restart-plugin — Host half.
 *
 * 职责：
 *  1. 判断当前能否重启（是不是桌面版、能不能找到可执行文件）；
 *  2. 重启前检查有没有正在运行的任务 / 已排期的定时任务；
 *  3. 拉起一个「脱离的看门狗」子进程，它等本进程退出后把应用重新打开；
 *  4. 优雅关闭：先让外壳退出（Host 会随之收到 disconnect 并正常落盘），
 *     看门狗再等 Host 真正退出后启动新实例。
 *
 * 为什么要看门狗：Host 是 Electron 外壳的子进程，「重新打开应用」必须发生在
 * 本进程已经死掉之后。任何活在本进程里的代码都做不到，只能交给独立的 OS 进程。
 *
 * @module dsh-restart-plugin
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** HTTP 路由前缀；Client 半以同样前缀调用。 */
export const API_PREFIX = '/dsh-restart-plugin/api'

/** 本插件的 loader 行 id，与 cordis.patch.yml 保持一致。 */
export const name = 'dsh-restart-plugin'

/**
 * 硬依赖：本插件的工作方式是注册一条 HTTP 路由，没有 webServer 就没有意义。
 * cordis 会等这个服务就绪再激活本插件。
 *
 * agents / jobs 是**可选**的（某些宿主没有），所以不写进 inject，
 * 一律通过 ctx.get() 访问——依据 dsh-plugin-dev skill 的实测结论：
 * 未 inject 时属性访问会抛异常，`?.` 挡不住。
 */
export const inject = ['webServer']

/** 从环境变量里判断是否为打包桌面版（开发态会带 DSH_DESKTOP_* 变量）。 */
function isDevelopmentShell(env) {
  return typeof env.DSH_DESKTOP_DSH_DIR === 'string' && env.DSH_DESKTOP_DSH_DIR !== ''
}

/**
 * 找出可以重新启动应用的可执行文件。
 *
 * 打包布局（实测）：
 *   <AppRoot>/DeepSeek Harness.exe        ← process.execPath（Host 以 Node 模式跑在它里面）
 *   <AppRoot>/resources/app.asar
 *
 * @returns 绝对路径，或 undefined。
 */
export function resolveLaunchTarget(env = process.env, execPath = process.execPath) {
  if (isDevelopmentShell(env)) return undefined
  if (typeof execPath !== 'string' || execPath === '') return undefined
  if (!existsSync(execPath)) return undefined
  // 只有应用本体才可作为重启入口；node.exe / dsh 终端命令都不行。
  const base = execPath.toLowerCase()
  if (!base.endsWith('deepseek harness.exe')) return undefined
  return execPath
}

/**
 * 判断当前环境是否支持「重启整个应用」。
 * @returns supported 与不可用时的原因码（Client 半负责翻译成中文）。
 */
export function detectRestartSupport(env = process.env, platform = process.platform, execPath = process.execPath) {
  if (platform !== 'win32' && platform !== 'darwin') return { supported: false, reason: 'unsupported-platform' }
  const launchTarget = resolveLaunchTarget(env, execPath)
  if (launchTarget === undefined) return { supported: false, reason: 'not-desktop' }
  if (typeof process.ppid !== 'number' || process.ppid <= 0) return { supported: false, reason: 'no-parent' }
  return { supported: true, launchTarget, reason: null }
}

/** 供诊断用的环境描述（不含任何凭据）。 */
export function describeEnvironment(env = process.env) {
  return {
    platform: process.platform,
    pid: process.pid,
    parentPid: typeof process.ppid === 'number' ? process.ppid : null,
    electronRunAsNode: env.ELECTRON_RUN_AS_NODE === '1',
    packagedShell: !isDevelopmentShell(env),
  }
}

/**
 * 检查重启会打断什么。
 * 与服务层的约定与 DSH 自带的退出检查保持一致：
 * 正在生成的 agent、排队中的消息、运行中的后台任务算「活动任务」；
 * 已装载会话里已排期的定时任务单独计一项。
 * @param ctx - Host 上下文。
 */
export async function inspectActiveWork(ctx) {
  const agents = ctx.get('agents')
  const jobs = ctx.get('jobs')
  if (agents === undefined || jobs === undefined) {
    // 服务缺失时不要谎报「没有任务」，按保守值处理。
    return { available: false, activeTasks: true, scheduledTasks: false }
  }
  let liveAgents
  try {
    liveAgents = agents.list()
  } catch {
    return { available: false, activeTasks: true, scheduledTasks: false }
  }
  let activeTasks
  try {
    activeTasks = liveAgents.some(agent => agent.status === 'running'
      || agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0)
      || [undefined, ...liveAgents].some(agent => jobs.list(agent?.id)
        .some(job => job.status === 'running' || job.status === 'stopping'))
  } catch {
    activeTasks = true
  }
  let scheduledTasks = false
  try {
    for (const agent of liveAgents) {
      const activity = await ctx.waterfall('workspace/session-activity', { sessionId: agent.id }, () => Promise.resolve([]))
      if (activity.some(entry => entry.kind === 'schedule')) { scheduledTasks = true; break }
    }
  } catch {
    // 排期查询失败不阻断重启，也不谎报结果。
    scheduledTasks = false
  }
  return { available: true, activeTasks, scheduledTasks }
}

/**
 * 看门狗脚本。以 `node -e` 方式运行，内容自包含，不依赖本包。
 *
 * 环境变量：
 *  - DSH_RESTART_PID      要等待退出的 Host 进程 pid
 *  - DSH_RESTART_TARGET   要重新启动的应用可执行文件绝对路径
 *  - DSH_RESTART_CWD      重启时的工作目录
 *  - DSH_RESTART_LOG      看门狗日志文件路径
 *  - DSH_RESTART_TIMEOUT  最长等待毫秒；超时会强制结束残留 Host 再启动
 *  - DSH_RESTART_INTERVAL 轮询间隔毫秒
 */
export const WATCHDOG_SOURCE = String.raw`
const { spawn } = require('node:child_process')
const { appendFileSync } = require('node:fs')

const pid = Number(process.env.DSH_RESTART_PID)
const target = process.env.DSH_RESTART_TARGET
const cwd = process.env.DSH_RESTART_CWD || undefined
const logPath = process.env.DSH_RESTART_LOG || ''
const timeout = Number(process.env.DSH_RESTART_TIMEOUT) || 60000
const interval = Number(process.env.DSH_RESTART_INTERVAL) || 200

/** 额外参数（JSON 数组）。真实应用不需要参数；保留给测试与特殊启动方式。 */
function readArgs() {
  const raw = process.env.DSH_RESTART_ARGS
  if (!raw || raw === '') return []
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
  } catch (_) {
    return []
  }
}

function log(line) {
  if (logPath === '') return
  try { appendFileSync(logPath, new Date().toISOString() + ' ' + line + '\n') } catch (_) {}
}

function alive(checkPid) {
  if (!Number.isInteger(checkPid) || checkPid <= 0) return false
  try {
    process.kill(checkPid, 0)
    return true
  } catch (error) {
    // EPERM = 进程还在，只是没有发信号的权限。
    return Boolean(error) && error.code === 'EPERM'
  }
}

function forceKill(checkPid) {
  try { process.kill(checkPid) } catch (error) { log('force kill failed: ' + String(error && error.message)) }
}

function launch() {
  // 关键：新实例必须在外壳模式下启动。继续带着 ELECTRON_RUN_AS_NODE=1
  // 会让应用以 Node 模式运行，表现就是「点了一下什么都没发生」。
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ELECTRON_NO_ATTACH_CONSOLE
  delete env.DSH_DESKTOP_DSH_DIR
  delete env.DSH_DESKTOP_PRIMARY_RUNTIME_DIR
  delete env.DSH_DESKTOP_HOST_INSPECT_PORT
  delete env.DSH_DESKTOP_DEV_APP
  delete env.NODE_OPTIONS
  try {
    const args = readArgs()
    const child = spawn(target, args, { cwd, detached: true, stdio: 'ignore', windowsHide: true, shell: false, env })
    child.on('error', (error) => log('launch failed: ' + String(error && error.message)))
    child.unref()
    log('launched target ' + target + (args.length === 0 ? '' : ' args ' + JSON.stringify(args)))
  } catch (error) {
    log('launch threw: ' + String(error && error.message))
    process.exitCode = 1
  }
}

const deadline = Date.now() + timeout
let announcedGiveUp = false

function poll() {
  if (!alive(pid)) {
    // 再等一会儿，让单实例锁、profile 写锁、端口都释放干净。
    setTimeout(() => { launch(); process.exit(0) }, 500)
    return
  }
  if (Date.now() > deadline) {
    if (!announcedGiveUp) {
      announcedGiveUp = true
      log('deadline reached; terminating lingering host pid ' + pid)
      forceKill(pid)
    }
    // 强制结束后再给它一点时间退出，然后无条件启动。
    setTimeout(() => {
      if (alive(pid)) log('host still alive after force kill')
      launch()
      process.exit(0)
    }, 1500)
    return
  }
  setTimeout(poll, interval)
}

log('watchdog started; waiting for pid ' + pid + ' (timeout ' + timeout + 'ms)')
poll()
`

/** 剥掉桌面/Electron 专属变量，供看门狗与子进程使用。 */
function childEnvironment(env) {
  const next = { ...env }
  delete next.ELECTRON_RUN_AS_NODE
  delete next.ELECTRON_NO_ATTACH_CONSOLE
  delete next.DSH_DESKTOP_DSH_DIR
  delete next.DSH_DESKTOP_PRIMARY_RUNTIME_DIR
  delete next.DSH_DESKTOP_HOST_INSPECT_PORT
  delete next.DSH_DESKTOP_DEV_APP
  return next
}

/**
 * 拉起看门狗。
 * @param target - 要重新启动的可执行文件。
 * @param options - 超时、轮询间隔、日志路径。
 * @returns 是否成功拉起。
 */
export function startWatchdog(target, options = {}) {
  const logPath = options.logPath ?? join(tmpdir(), `dsh-restart-watchdog-${String(Date.now())}.log`)
  const env = {
    ...process.env,
    DSH_RESTART_PID: String(process.pid),
    DSH_RESTART_TARGET: target,
    DSH_RESTART_CWD: options.cwd ?? process.cwd(),
    DSH_RESTART_LOG: logPath,
    DSH_RESTART_TIMEOUT: String(options.timeoutMs ?? 60_000),
    DSH_RESTART_INTERVAL: String(options.intervalMs ?? 200),
    ...(Array.isArray(options.args) && options.args.length > 0
      ? { DSH_RESTART_ARGS: JSON.stringify(options.args) }
      : {}),
  }
  try {
    // 用当前可执行文件（Electron 的 Node 模式）运行脚本，保证这个解释器一定存在。
    const child = spawn(process.execPath, ['-e', WATCHDOG_SOURCE], {
      env,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: false,
    })
    child.unref()
    return { ok: true, pid: child.pid, logPath }
  } catch (error) {
    return { ok: false, message: messageOf(error), logPath }
  }
}

/**
 * 执行重启：外壳先退出 → Host 收到 disconnect 后正常落盘并退出 → 看门狗拉起新实例。
 *
 * 顺序很重要：先拉起看门狗，再结束外壳；否则没人负责把应用带回来。
 * 结束外壳用 process.kill(ppid)（仅主进程，不整棵杀），
 * 这样 Host 的 IPC 通道断开后走的是 desktop-host 自带的优雅停止路径。
 *
 * @param ctx - Host 上下文。
 * @param options - 延迟、看门狗超时。
 * @returns 启动结果（用于立刻回给浏览器）。
 */
export function requestRestart(ctx, options = {}) {
  const support = detectRestartSupport()
  if (!support.supported) return { ok: false, reason: support.reason }
  const watchdog = startWatchdog(support.launchTarget, options)
  if (!watchdog.ok) return { ok: false, reason: 'watchdog-failed', message: watchdog.message, logPath: watchdog.logPath }
  const shellPid = typeof process.ppid === 'number' ? process.ppid : 0
  const delayMs = options.delayMs ?? 250
  const timer = setTimeout(() => {
    try {
      if (shellPid > 0) process.kill(shellPid)
    } catch (error) {
      ctx.logger?.('dsh-restart-plugin')?.warn?.('shell termination failed: %s', messageOf(error))
    }
    // 兜底：若 Host 没有因为 disconnect 自己退出，在宽限期后强制退出，
    // 保证看门狗等得到「本进程已消失」，从而能拉起新实例。
    const backstop = setTimeout(() => { process.exit(0) }, options.exitAfterMs ?? 8_000)
    backstop.unref?.()
  }, delayMs)
  timer.unref?.()
  return { ok: true, watchdogPid: watchdog.pid, logPath: watchdog.logPath }
}

/**
 * 注册 Host 半。
 * @param ctx - 已启动的 Host 上下文（已 inject webServer）。
 */
export function apply(ctx) {
  // 用 ctx.get 而不是 ctx.webServer：即使声明了 inject，get 也能在服务被撤下时
  // 返回 undefined，而不是抛异常。
  const webServer = ctx.get('webServer')
  if (webServer === undefined) {
    ctx.logger?.('dsh-restart-plugin')?.warn?.('webServer is unavailable; restart entry stays inert')
    return
  }
  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: async (req, res) => {
      try {
        await handleRequest(ctx, req, res)
      } catch (error) {
        send(res, 500, { ok: false, reason: 'internal', message: messageOf(error) })
      }
    },
  }), 'dsh-restart-plugin: api route')
}

/** 路由分发。 */
async function handleRequest(ctx, req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const route = url.pathname.startsWith(API_PREFIX)
    ? url.pathname.slice(API_PREFIX.length) || '/'
    : '/'

  if (req.method === 'GET' && route === '/status') {
    const support = detectRestartSupport()
    const work = support.supported
      ? await inspectActiveWork(ctx)
      : { available: false, activeTasks: false, scheduledTasks: false }
    return send(res, 200, {
      ok: true,
      supported: support.supported,
      reason: support.reason,
      activeTasks: work.activeTasks,
      scheduledTasks: work.scheduledTasks,
      environment: describeEnvironment(),
    })
  }

  if (req.method === 'POST' && route === '/restart') {
    const body = await readJson(req)
    const support = detectRestartSupport()
    if (!support.supported) return send(res, 409, { ok: false, reason: support.reason })
    const work = await inspectActiveWork(ctx)
    const force = body !== null && body.force === true
    // 有活动任务且用户还没确认过「就是要中断」时，先退回让界面弹确认。
    if ((work.activeTasks || work.scheduledTasks) && !force) {
      return send(res, 409, {
        ok: false,
        reason: 'active-tasks',
        activeTasks: work.activeTasks,
        scheduledTasks: work.scheduledTasks,
      })
    }
    const result = requestRestart(ctx)
    if (!result.ok) return send(res, 500, { ok: false, ...result })
    // 先把 202 写出去，界面才能显示「正在重启」，再真正动手。
    send(res, 202, { ok: true, restarting: true, logPath: result.logPath })
    return undefined
  }

  return send(res, 404, { ok: false, reason: 'not-found' })
}

/** 读一个小 JSON 请求体；空体或非法 JSON 返回 null。 */
async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return null
  try {
    const value = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

/** 写 JSON 响应；已发过响应时静默返回。 */
function send(res, status, payload) {
  if (res.headersSent) return
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

/** 任意错误转可读文本。 */
function messageOf(error) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try { return JSON.stringify(error) } catch { return String(error) }
}

void childEnvironment
