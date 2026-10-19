/**
 * dsh-restart-plugin 的 Host 半测试。
 *
 * 设计原则（照 dsh-plugin-dev skill 的教训）：
 *  - 假 ctx 不能「返回空」把危险路径绕过去，要用 Proxy 让未提供的服务抛错，
 *    这样才测得到 `ctx.get()` 的真实行为；
 *  - 事件回调必须异常自愈，所以要专门测「服务抛错时插件不崩」；
 *  - 看门狗这种依赖真实 OS 进程的部分只做「是否拉起 / 参数是否正确」的验证，
 *    端到端重启由真机手工验证，不能靠单元测试冒充。
 *
 * 运行：node --test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  API_PREFIX,
  name,
  detectRestartSupport,
  resolveLaunchTarget,
  describeEnvironment,
  inspectActiveWork,
  startWatchdog,
  requestRestart,
  apply,
} from '../index.js'

/** 一个未 inject 就访问属性会抛错的 ctx，用来暴露「静默返回空」类的 bug。 */
function throwingContext(base = {}) {
  return new Proxy(base, {
    get(target, property, receiver) {
      if (property in target) return Reflect.get(target, property, receiver)
      if (typeof property !== 'string') return undefined
      throw new Error(`cannot get property "${property}" without inject ${property}`)
    },
  })
}

/** 记录注册结果的假 webServer。 */
function fakeWebServer() {
  const routes = []
  return {
    routes,
    register(route) {
      routes.push(route)
      return () => {
        const at = routes.indexOf(route)
        if (at !== -1) routes.splice(at, 1)
      }
    },
  }
}

/** 收集 effect 清理函数的假 ctx。 */
function fakeContext({ webServer = fakeWebServer(), services = {} } = {}) {
  const cleanups = []
  const ctx = {
    effect(factory) {
      const cleanup = factory()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
      return () => {}
    },
    get(service) {
      if (service === 'webServer') return webServer
      return services[service]
    },
    waterfall: async (_event, _payload, fallback) => fallback(),
    logger: () => ({ warn() {}, info() {}, error() {} }),
  }
  return { ctx, webServer, cleanups }
}

test('插件导出预期的名字与路由前缀', () => {
  assert.equal(name, 'dsh-restart-plugin')
  assert.equal(API_PREFIX, '/dsh-restart-plugin/api')
})

test('非 Windows/macOS 平台报告 unsupported-platform', () => {
  const result = detectRestartSupport({}, 'linux', '/usr/bin/node')
  assert.equal(result.supported, false)
  assert.equal(result.reason, 'unsupported-platform')
})

test('可执行文件不是应用本体时报告 not-desktop', () => {
  const result = detectRestartSupport({}, 'win32', 'C:\\Windows\\System32\\notepad.exe')
  assert.equal(result.supported, false)
  assert.equal(result.reason, 'not-desktop')
})

test('开发态（带 DSH_DESKTOP_DSH_DIR）不认作打包桌面版', () => {
  const result = resolveLaunchTarget({ DSH_DESKTOP_DSH_DIR: 'C:\\dev\\dsh' }, 'G:\\App\\DeepSeek Harness.exe')
  assert.equal(result, undefined)
})

test('不存在的可执行文件不算可重启目标', () => {
  const result = resolveLaunchTarget({}, join(tmpdir(), 'definitely-not-here', 'DeepSeek Harness.exe'))
  assert.equal(result, undefined)
})

test('真实的 DeepSeek Harness.exe 会被认作可重启目标', () => {
  const exe = 'G:\\Program Files\\DSH\\DeepSeekHarnessDesktop\\DeepSeek Harness.exe'
  if (!existsSync(exe)) return // 换机器时跳过，不算失败
  assert.equal(resolveLaunchTarget({}, exe), exe)
})

test('describeEnvironment 不泄漏任何凭据类字段', () => {
  const env = {
    ELECTRON_RUN_AS_NODE: '1',
    DEEPSEEK_API_KEY: 'sk-should-not-appear',
    GITHUB_TOKEN: 'ghp-should-not-appear',
  }
  const text = JSON.stringify(describeEnvironment(env))
  assert.equal(text.includes('sk-should-not-appear'), false)
  assert.equal(text.includes('ghp-should-not-appear'), false)
})

test('inspectActiveWork：拿不到服务时按「有活动任务」保守处理', async () => {
  const ctx = throwingContext({
    get: () => undefined,
  })
  const work = await inspectActiveWork(ctx)
  assert.equal(work.available, false)
  assert.equal(work.activeTasks, true)
})

test('inspectActiveWork：服务抛错时不抛出，退回保守结果', async () => {
  const ctx = {
    get: (service) => {
      if (service === 'agents') return { list: () => { throw new Error('boom') } }
      return { list: () => [] }
    },
    waterfall: async () => { throw new Error('waterfall down') },
  }
  const work = await inspectActiveWork(ctx)
  assert.equal(work.activeTasks, true)
})

test('inspectActiveWork：正在运行的 agent 计为活动任务', async () => {
  const ctx = {
    get: (service) => {
      if (service === 'agents') {
        return { list: () => [{ id: 'a1', status: 'running', inbox: { nextTurn: [], nextStep: [] } }] }
      }
      return { list: () => [] }
    },
    waterfall: async () => [],
  }
  const work = await inspectActiveWork(ctx)
  assert.equal(work.available, true)
  assert.equal(work.activeTasks, true)
})

test('inspectActiveWork：空闲时报告没有活动任务', async () => {
  const ctx = {
    get: (service) => {
      if (service === 'agents') {
        return { list: () => [{ id: 'a1', status: 'idle', inbox: { nextTurn: [], nextStep: [] } }] }
      }
      return { list: () => [] }
    },
    waterfall: async () => [],
  }
  const work = await inspectActiveWork(ctx)
  assert.equal(work.available, true)
  assert.equal(work.activeTasks, false)
  assert.equal(work.scheduledTasks, false)
})

test('inspectActiveWork：运行中的后台任务计为活动任务', async () => {
  const ctx = {
    get: (service) => {
      if (service === 'agents') {
        return { list: () => [{ id: 'a1', status: 'idle', inbox: { nextTurn: [], nextStep: [] } }] }
      }
      return { list: () => [{ status: 'running' }] }
    },
    waterfall: async () => [],
  }
  const work = await inspectActiveWork(ctx)
  assert.equal(work.activeTasks, true)
})

test('inspectActiveWork：排期任务被单独识别', async () => {
  const ctx = {
    get: (service) => {
      if (service === 'agents') {
        return { list: () => [{ id: 'a1', status: 'idle', inbox: { nextTurn: [], nextStep: [] } }] }
      }
      return { list: () => [] }
    },
    waterfall: async () => [{ kind: 'schedule' }],
  }
  const work = await inspectActiveWork(ctx)
  assert.equal(work.activeTasks, false)
  assert.equal(work.scheduledTasks, true)
})

test('apply 注册一条 prefix 路由，并且注册可撤销', () => {
  const { ctx, webServer, cleanups } = fakeContext()
  apply(ctx)
  assert.equal(webServer.routes.length, 1)
  assert.equal(webServer.routes[0].kind, 'prefix')
  assert.equal(webServer.routes[0].path, API_PREFIX)
  assert.equal(typeof webServer.routes[0].handler, 'function')
  for (const cleanup of cleanups) cleanup()
})

test('apply 在 webServer 缺失时静默降级，不抛异常打断宿主启动', () => {
  // 未 inject 的属性访问会抛错；apply 若写成 ctx.webServer 就会在这里炸。
  // 正确行为是 ctx.get() 拿到 undefined 后只记一条警告，宿主照常启动。
  const warnings = []
  const ctx = throwingContext({
    effect: (factory) => { factory(); return () => {} },
    get: () => undefined,
    logger: () => ({ warn: (...args) => warnings.push(args) }),
  })
  assert.doesNotThrow(() => apply(ctx))
  assert.equal(warnings.length, 1)
})

test('watchdog 脚本是自包含的，不 import 本包任何东西', async () => {
  const { WATCHDOG_SOURCE } = await import('../index.js')
  assert.equal(WATCHDOG_SOURCE.includes('import '), false)
  assert.equal(WATCHDOG_SOURCE.includes('DSH_RESTART_PID'), true)
  // 必须剥掉 ELECTRON_RUN_AS_NODE，否则新实例会以 Node 模式启动（关键 bug）。
  assert.equal(WATCHDOG_SOURCE.includes('delete env.ELECTRON_RUN_AS_NODE'), true)
})

test('requestRestart 在没有桌面环境时拒绝，不拉起任何进程', () => {
  const ctx = { logger: () => ({ warn() {} }) }
  const result = requestRestart(ctx, { timeoutMs: 1000 })
  assert.equal(result.ok, false)
  assert.ok(['not-desktop', 'unsupported-platform', 'no-parent'].includes(result.reason))
})

test('startWatchdog 会真的拉起一个独立进程并写入日志', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-restart-test-'))
  const logPath = join(dir, 'watchdog.log')
  t.after(() => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* 忽略清理失败 */ } })
  // 指向一个不可能存在的 pid，让看门狗立刻判定「目标已退出」并走启动分支。
  const fakeTarget = join(dir, 'Fake Target.exe')
  const result = startWatchdog(fakeTarget, { logPath, timeoutMs: 5_000, intervalMs: 50, cwd: dir })
  assert.equal(result.ok, true)
  assert.ok(Number.isInteger(result.pid))
  // 等它写日志（最多 3 秒）。
  const deadline = Date.now() + 3_000
  let text = ''
  while (Date.now() < deadline) {
    try { text = readFileSync(logPath, 'utf8') } catch { text = '' }
    if (text.includes('launched') || text.includes('launch')) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(text.includes('watchdog started'), `日志应记录启动，实际：${text}`)
})
