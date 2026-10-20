/**
 * Client 半的加载测试：用最小的浏览器替身执行 client.js，
 * 确认它注册出正确的 slot 条目、locale 词典与按钮组件。
 *
 * 不测视觉效果（那需要真浏览器），只测「注册是否正确、能否渲染出节点」。
 *
 * 运行：node --test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 极简 React 替身：只要能把 createElement 的调用记录成树即可。 */
function createFakeReact() {
  const createElement = (type, props, ...children) => ({
    type,
    props: props ?? {},
    children: children.flat(),
  })
  return {
    createElement,
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useRef: (value) => ({ current: value }),
  }
}

/** 装配浏览器替身并执行 client.js，返回加载器拿到的东西。 */
function loadClient() {
  const loaded = []
  const react = createFakeReact()
  const modules = {
    react,
  }
  const factoryRequire = (id) => {
    if (id in modules) return modules[id]
    throw new Error(`unexpected require: ${id}`)
  }
  const document = {
    getElementById: () => null,
    createElement: () => ({ set textContent(value) {}, remove() {} }),
    head: { append() {} },
    addEventListener() {},
    removeEventListener() {},
  }
  const window = {
    __ModuleLoader__: {
      load(definition) {
        loaded.push(definition)
      },
    },
  }
  const source = readFileSync(`${ROOT}client.js`, 'utf8')
  // 用 Function 构造器执行，把 window / document 作为自由变量注入。
  const run = new Function('window', 'document', 'fetch', source)
  run(window, document, async () => { throw new Error('fetch should not run during load') })
  return { loaded, factoryRequire, window, document }
}

test('client.js 用包名作为模块 id 注册', () => {
  const { loaded } = loadClient()
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, 'dsh-restart-plugin')
  assert.equal(typeof loaded[0].factory, 'function')
})

test('factory 产出的插件注入 slots 与 locale', () => {
  const { loaded, factoryRequire } = loadClient()
  const plugin = loaded[0].factory(factoryRequire)
  assert.deepEqual(plugin.inject, ['slots', 'locale'])
  assert.equal(typeof plugin.apply, 'function')
})

test('apply 注册 locale 词典与 sidebar.footer.action 条目', () => {
  const { loaded, factoryRequire } = loadClient()
  const plugin = loaded[0].factory(factoryRequire)

  const registered = []
  const dictionaryCalls = []
  const ctx = {
    effect: (factory) => { factory(); return () => {} },
    locale: {
      register: (ns, dicts) => {
        dictionaryCalls.push({ ns, dicts })
        return () => {}
      },
    },
    slots: {
      inject: (_name, callback) => { callback(); return () => {} },
      register: (options, component) => {
        registered.push({ options, component })
        return () => {}
      },
    },
  }
  plugin.apply(ctx)

  assert.equal(dictionaryCalls.length, 1)
  assert.equal(dictionaryCalls[0].ns, 'restart-plugin')
  assert.ok(dictionaryCalls[0].dicts.zh['action.label'])
  assert.ok(dictionaryCalls[0].dicts.en['action.label'])

  assert.equal(registered.length, 1)
  assert.equal(registered[0].options.name, 'sidebar.footer.action')
  assert.equal(registered[0].options.id, 'dsh-restart-plugin')
  assert.equal(registered[0].options.locale, 'restart-plugin')
  assert.equal(typeof registered[0].component, 'function')
})

test('zh 与 en 词典的键集合完全一致', () => {
  const { loaded, factoryRequire } = loadClient()
  const plugin = loaded[0].factory(factoryRequire)
  let dicts = null
  plugin.apply({
    effect: (factory) => { factory(); return () => {} },
    locale: { register: (_ns, value) => { dicts = value; return () => {} } },
    slots: { inject: () => () => {}, register: () => () => {} },
  })
  const zhKeys = Object.keys(dicts.zh).sort()
  const enKeys = Object.keys(dicts.en).sort()
  assert.deepEqual(zhKeys, enKeys)
})

test('宽栏与收起栏两种形态都能渲染出按钮节点', () => {
  const { loaded, factoryRequire } = loadClient()
  const plugin = loaded[0].factory(factoryRequire)
  let component = null
  plugin.apply({
    effect: (factory) => { factory(); return () => {} },
    locale: { register: () => () => {} },
    slots: {
      inject: (_name, callback) => { callback(); return () => {} },
      register: (_options, value) => { component = value; return () => {} },
    },
  })
  const t = (key) => `T:${key}`

  const wide = component({ t, wide: true })
  assert.equal(wide.props['data-dsh-restart-plugin'], '')
  // 宽栏下保留「重启」文字作为显著标识（2026-10-19：最初去掉文字后用户要求加回）。
  const wideButton = wide.children.find(child => child?.props?.className === 'rsp-btn')
  assert.ok(wideButton)
  assert.equal(wideButton.props['aria-label'], 'T:action.aria')
  assert.equal(wideButton.props['title'], 'T:action.aria')
  assert.equal(wideButton.props['data-rail'], undefined)
  const hasLabel = JSON.stringify(wideButton.children).includes('T:action.label')
  assert.equal(hasLabel, true)

  const rail = component({ t, wide: false })
  const railButton = rail.children.find(child => child?.props?.className === 'rsp-btn')
  assert.ok(railButton)
  // 收起成轨道时同样只显示图标。
  assert.equal(railButton.props['data-rail'], '')
  assert.equal(railButton.props['title'], 'T:action.aria')
  assert.equal(JSON.stringify(railButton.children).includes('T:action.label'), false)
})

test('没有 t 函数时退化为直接显示 key，不抛异常', () => {
  const { loaded, factoryRequire } = loadClient()
  const plugin = loaded[0].factory(factoryRequire)
  let component = null
  plugin.apply({
    effect: (factory) => { factory(); return () => {} },
    locale: { register: () => () => {} },
    slots: {
      inject: (_name, callback) => { callback(); return () => {} },
      register: (_options, value) => { component = value; return () => {} },
    },
  })
  assert.doesNotThrow(() => component({ wide: true }))
})
