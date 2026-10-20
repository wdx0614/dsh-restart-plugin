/**
 * dsh-restart-plugin — Client half.
 *
 * 在侧边栏底部渲染一个「重启」按钮；点击后弹出确认框，
 * 确认后调用 Host 的 `/dsh-restart-plugin/api/restart`。
 *
 * 布局要点（2026-10-19 改）：侧边栏底部 `sidebar.footer.action` 是横排 flex 容器，
 * 但同排的「会话与工作区」（dsh-session-manager）按钮声明了 `flex: 1 1 100%`，
 * 独占一整行，并给容器注入了 `flex-wrap: wrap`。所以「重启」若仍在文档流里且
 * 占满宽度，必然被挤成单独一行。现在改成 28px 纯图标按钮、绝对定位到底部
 * 最后一行的右端，并给容器右侧留 40px 空白，避免压住左边的文字。
 *
 * 不做构建：DSH 直接以 cordis client bundle 的形式加载本文件
 * （见 package.json 的 dsh.client 声明与 ./client 导出）。
 */

window.__ModuleLoader__.load({
  id: 'dsh-restart-plugin',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    /** locale 命名空间，和 ctx.locale.register 的第一个参数一致。 */
    const NS = 'restart-plugin'

    /** HTTP 前缀，与 Host 半的 API_PREFIX 一致。 */
    const API = '/dsh-restart-plugin/api'

    /** 中文文案。 */
    const zh = {
      'action.label': '开/关',
      'action.aria': '电源：重启或关闭 DeepSeek Harness',
      'menu.restart': '重启 DSH',
      'menu.shutdown': '关闭 DSH',
      'dialog.title': '重启 DeepSeek Harness？',
      'dialog.body': '应用会关闭，并在几秒后自动重新打开。插件、配置的改动会在重启后生效。',
      'dialog.activeTasks': '正在运行的任务会被中断。',
      'dialog.scheduledTasks': '排期的定时任务在重启期间不会运行。',
      'dialog.activeAndScheduled': '正在运行的任务会被中断，排期的定时任务在重启期间不会运行。',
      'dialog.cancel': '取消',
      'dialog.confirm': '重启',
      'dialog.force': '仍然重启',
      'dialog.unsupported': '当前环境不支持自动重启（只能在桌面版中使用）。请手动关闭并重新打开应用。',
      'dialog.notDesktop': '没有识别到桌面版外壳，无法自动重启。请手动关闭并重新打开应用。',
      'dialog.checking': '正在检查当前状态…',
      'dialog.checkFailed': '无法读取重启状态，请稍后再试。',
      'dialog.starting': '正在重启…',
      'dialog.failed': '重启没有启动成功。请手动关闭并重新打开应用。如果应用已经关闭，请从开始菜单重新打开。',
      'toast.restarting': '正在重启，请稍候…',
      'shutdown.title': '关闭 DeepSeek Harness？',
      'shutdown.body': '应用会被完全关闭，不会自动重新打开。下次使用需要从开始菜单或桌面图标手动启动。',
      'shutdown.activeTasks': '正在运行的任务会被中断。',
      'shutdown.scheduledTasks': '排期的定时任务在关闭期间不会运行。',
      'shutdown.activeAndScheduled': '正在运行的任务会被中断，排期的定时任务在关闭期间不会运行。',
      'shutdown.confirm': '关闭',
      'shutdown.force': '仍然关闭',
      'shutdown.starting': '正在关闭…',
      'shutdown.failed': '关闭没有启动成功。请从托盘菜单退出，或手动关闭窗口。',
    }

    /** 英文文案。 */
    const en = {
      'action.label': 'On/Off',
      'action.aria': 'Power: restart or close DeepSeek Harness',
      'menu.restart': 'Restart DSH',
      'menu.shutdown': 'Close DSH',
      'dialog.title': 'Restart DeepSeek Harness?',
      'dialog.body': 'The app will close and reopen automatically in a few seconds. Plugin and configuration changes take effect after the restart.',
      'dialog.activeTasks': 'Running tasks will be interrupted.',
      'dialog.scheduledTasks': 'Scheduled tasks will not run while the app restarts.',
      'dialog.activeAndScheduled': 'Running tasks will be interrupted, and scheduled tasks will not run while the app restarts.',
      'dialog.cancel': 'Cancel',
      'dialog.confirm': 'Restart',
      'dialog.force': 'Restart anyway',
      'dialog.unsupported': 'Automatic restart is only available in the desktop app. Close and reopen the app manually.',
      'dialog.notDesktop': 'No desktop shell was detected, so the app cannot restart itself. Close and reopen it manually.',
      'dialog.checking': 'Checking the current state…',
      'dialog.checkFailed': 'Could not read the restart state. Try again later.',
      'dialog.starting': 'Restarting…',
      'dialog.failed': 'The restart did not start. Close and reopen the app manually. If it already closed, open it from the Start menu.',
      'toast.restarting': 'Restarting, please wait…',
      'shutdown.title': 'Close DeepSeek Harness?',
      'shutdown.body': 'The app will close completely and will not reopen by itself. Start it again from the Start menu or desktop shortcut.',
      'shutdown.activeTasks': 'Running tasks will be interrupted.',
      'shutdown.scheduledTasks': 'Scheduled tasks will not run while the app is closed.',
      'shutdown.activeAndScheduled': 'Running tasks will be interrupted, and scheduled tasks will not run while the app is closed.',
      'shutdown.confirm': 'Close',
      'shutdown.force': 'Close anyway',
      'shutdown.starting': 'Closing…',
      'shutdown.failed': 'The app did not close. Quit it from the tray menu, or close the window manually.',
    }

    /** 重启图标：环形箭头 + 断开的一端，表示「重新开始」。 */
    function RestartIcon({ size }) {
      const s = typeof size === 'number' ? size : 18
      return h('svg', {
        viewBox: '0 0 24 24', width: s, height: s, 'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      },
      // 主弧：约 300°，留出右上缺口。
        h('path', { d: 'M20.2 8.5A8.5 8.5 0 1 0 20.5 13' }),
        // 缺口处的箭头尖。
        h('path', { d: 'M21 3.5v5.2h-5.2' }),
      )
    }

    /**
     * 电源开关图标：顶部一条竖线 + 下方缺口圆弧，是通用的「电源」符号。
     *
     * 为什么自绘：DSH 自带图标库（ui-primitives/icons）里没有电源符号
     * （实测逐个查过 Power / Shutdown / Exit / Switch / Toggle，全部不存在），
     * 所以只能内联画。参数沿用自带图标的约定（24 网格、1.8 描边、currentColor），
     * 和旁边其它图标放在一起不会显得突兀。
     */
    function PowerIcon({ size }) {
      const s = typeof size === 'number' ? size : 18
      return h('svg', {
        viewBox: '0 0 24 24', width: s, height: s, 'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      },
        // 竖线：从圆外穿进圆心上方。
        h('path', { d: 'M12 3.2v8.4' }),
        // 缺口圆环：左右各留一段，形成上方开口。
        h('path', { d: 'M6.15 6.55a8 8 0 1 0 11.7 0' }),
      )
    }

    /**
     * 关闭图标：直接复刻 DSH 自带的「退出登录」图标
     * （`packages/client/ui-settings-account/src/client/LogoutIcon.tsx`，
     * Figma IcDsLogOutOutline16）。门框 + 向右箭头 = 「离开」。
     *
     * 为什么用这个：用户明确要求复用头像菜单里「退出登录」那个图标，省一份资源，
     * 也让「关闭应用」和系统里已有的「退出」语义保持一致。
     * 图形按原样缩放到 24 网格，只保留轮廓路径。
     */
    function SignOutIcon({ size }) {
      const s = typeof size === 'number' ? size : 18
      return h('svg', {
        viewBox: '0 0 16 16', width: s, height: s, 'aria-hidden': true,
        style: { display: 'block', flex: 'none' },
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.2,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      },
        // 门框：左侧竖边 + 上下边框。
        h('path', { d: 'M5.6 2.1H3.2a1.3 1.3 0 0 0-1.3 1.3v9.2a1.3 1.3 0 0 0 1.3 1.3h2.4' }),
        // 出口箭头：横线 + 上下两个箭头尖。
        h('path', { d: 'M8.2 8h5.6' }),
        h('path', { d: 'M11.2 5.4 13.9 8l-2.7 2.6' }),
      )
    }

    /** 读取一次状态，返回 { supported, reason, activeTasks, scheduledTasks }。 */
    async function fetchStatus() {
      const response = await fetch(`${API}/status`, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`status ${String(response.status)}`)
      return await response.json()
    }

    /** 发起重启。force 表示用户已经明确接受「打断正在运行的任务」。 */
    async function requestRestart(force) {
      const response = await fetch(`${API}/restart`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(force === true ? { force: true } : {}),
      })
      let payload = null
      try { payload = await response.json() } catch { payload = null }
      return { status: response.status, payload }
    }

    /** 关闭整个应用（不重新打开）。force 含义同重启。 */
    async function requestShutdown(force) {
      const response = await fetch(`${API}/shutdown`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(force === true ? { force: true } : {}),
      })
      let payload = null
      try { payload = await response.json() } catch { payload = null }
      return { status: response.status, payload }
    }

    /** 把插件内联样式一次性插进文档；返回清理函数。 */
    function useStyles() {
      useEffect(() => {
        const STYLE_ID = 'dsh-restart-plugin-styles'
        if (document.getElementById(STYLE_ID) !== null) return undefined
        const style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = `
[data-dsh-restart-plugin]{flex:none;display:flex;align-items:center;margin:0;padding:0}
[data-dsh-restart-plugin] .rsp-btn{display:flex;align-items:center;justify-content:flex-start;gap:4px;box-sizing:border-box;border:0;background:transparent;color:var(--dsw-alias-label-primary,#fff);cursor:pointer;font:inherit;font-size:13px;line-height:18px;height:28px;padding:0 6px;margin:0;border-radius:8px;overflow:hidden;white-space:nowrap}
[data-dsh-restart-plugin] .rsp-btn:hover,[data-dsh-restart-plugin] .rsp-btn:focus-visible{color:var(--dsw-alias-label-primary,#fff);background:var(--dsw-alias-interactive-bg-hover)}
[data-dsh-restart-plugin] .rsp-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
[data-dsh-restart-plugin] .rsp-btn[data-rail]{width:36px;height:36px;padding:0;justify-content:center;gap:0;border-radius:12px;margin:0 auto}
[data-dsh-restart-plugin] .rsp-label{flex:none}
[data-dsh-restart-plugin] .rsp-btn[aria-expanded="true"]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
/* 二级菜单：向上弹出、贴按钮右侧对齐，视觉沿用 DSH 自带的浮层语言
   （圆角、层级填充、悬浮阴影、--dsw-* 主题 token），所以深色/浅色主题都自动跟随。 */
[data-dsh-restart-plugin] .rsp-menu{position:fixed;z-index:1300;min-width:164px;box-sizing:border-box;padding:6px;border-radius:12px;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-layer-1,#fff));border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));box-shadow:0 12px 32px rgba(0,0,0,.28);display:flex;flex-direction:column;gap:2px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
[data-dsh-restart-plugin] .rsp-menuItem{display:flex;align-items:center;gap:10px;box-sizing:border-box;width:100%;height:32px;padding:0 10px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;white-space:nowrap}
[data-dsh-restart-plugin] .rsp-menuItem:hover,[data-dsh-restart-plugin] .rsp-menuItem:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}
[data-dsh-restart-plugin] .rsp-menuItem:focus-visible{box-shadow:inset 0 0 0 2px var(--dsw-alias-state-business-primary)}
[data-dsh-restart-plugin] .rsp-menuItem[data-danger]{color:var(--dsw-alias-state-error-primary,#d92d20)}
[data-dsh-restart-plugin] .rsp-menuItem[data-danger]:hover,[data-dsh-restart-plugin] .rsp-menuItem[data-danger]:focus-visible{background:var(--dsw-alias-interactive-bg-hover-danger,var(--dsw-alias-interactive-bg-hover))}
[data-dsh-restart-plugin] .rsp-menuIcon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px}
[data-dsh-restart-plugin] .rsp-menuLabel{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
/* 目标位置：侧边栏最底层那一行（头像 wx_ 那行）的最右端。
   该行的容器是 ui-settings-general 的 triggerRow，它是 footArea 的最后一个子元素。
   sidebar.footer.action 只能往 footerActions 里加东西，而 footerActions 在
   triggerRow 之上、且被「会话与工作区」的 flex:1 1 100% 独占成一行，
   所以这里把整块 footArea 变成定位上下文，再把重启按钮绝对定位到它的右下角。
   按钮保留「图标 + 重启」两个字，作为显著标识。 */
div[class*="footArea"]{position:relative}
div[class*="footerActions"]{position:static}
[data-dsh-restart-plugin]{position:absolute;right:0;bottom:6px;z-index:1}
/* 给最底层那一行右侧留出按钮宽度，让头像/连接状态/更新提示不会压到「开/关」下面
   （按钮约 74px：图标 16 + 间距 4 + 三字符「开/关」约 42 + 左右内边距 12，取 78px 留余量）。 */
[class*="triggerRow"]{box-sizing:border-box;padding-right:78px}
[data-dsh-restart-plugin] .rsp-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.32);display:flex;align-items:center;justify-content:center;z-index:1200}
[data-dsh-restart-plugin] .rsp-dialog{box-sizing:border-box;width:min(420px,calc(100vw - 32px));background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:14px;padding:20px;box-shadow:0 18px 48px rgba(0,0,0,.24);font-size:14px;line-height:22px}
[data-dsh-restart-plugin] .rsp-dialogTitle{margin:0 0 10px;font-size:16px;line-height:24px;font-weight:600}
[data-dsh-restart-plugin] .rsp-dialogBody{margin:0;color:var(--dsw-alias-label-secondary,#555)}
[data-dsh-restart-plugin] .rsp-warn{margin:10px 0 0;padding:8px 10px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.05));color:var(--dsw-alias-label-primary,#111)}
[data-dsh-restart-plugin] .rsp-error{margin:10px 0 0;color:var(--dsw-alias-state-error-primary,#c62828)}
[data-dsh-restart-plugin] .rsp-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
[data-dsh-restart-plugin] .rsp-action{height:32px;padding:0 14px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.16));background:transparent;color:inherit;font:inherit;cursor:pointer}
[data-dsh-restart-plugin] .rsp-action:hover{background:var(--dsw-alias-interactive-bg-hover)}
[data-dsh-restart-plugin] .rsp-action[data-primary]{background:var(--dsw-alias-state-business-primary,#356ae6);border-color:transparent;color:#fff}
[data-dsh-restart-plugin] .rsp-action[data-primary]:hover{filter:brightness(1.06)}
[data-dsh-restart-plugin] .rsp-action:disabled{opacity:.5;cursor:default}
`
        document.head.append(style)
        return () => { style.remove() }
      }, [])
    }

    /**
     * 确认对话框。variant 决定文案与语气：
     * - `restart`：应用会自己回来，常规主色按钮。
     * - `shutdown`：应用不会自己回来，用危险色提示，避免误点。
     */
    function RestartDialog({ t, status, busy, error, variant, onCancel, onConfirm }) {
      const shuttingDown = variant === 'shutdown'
      const key = shuttingDown ? 'shutdown' : 'dialog'
      const messages = []
      if (status !== null) {
        if (status.activeTasks === true && status.scheduledTasks === true) messages.push(t(`${key}.activeAndScheduled`))
        else if (status.activeTasks === true) messages.push(t(`${key}.activeTasks`))
        else if (status.scheduledTasks === true) messages.push(t(`${key}.scheduledTasks`))
      }
      const needsForce = status !== null && (status.activeTasks === true || status.scheduledTasks === true)
      const primaryText = busy === true
        ? t(shuttingDown ? 'shutdown.starting' : 'dialog.starting')
        : needsForce
          ? t(shuttingDown ? 'shutdown.force' : 'dialog.force')
          : t(shuttingDown ? 'shutdown.confirm' : 'dialog.confirm')
      return h('div', {
        className: 'rsp-backdrop',
        role: 'presentation',
        onMouseDown: (event) => { if (event.target === event.currentTarget && busy !== true) onCancel() },
      },
        h('div', {
          className: 'rsp-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rsp-dialog-title',
          onMouseDown: (event) => { event.stopPropagation() },
        },
          h('h2', { className: 'rsp-dialogTitle', id: 'rsp-dialog-title' }, t(`${key}.title`)),
          h('p', { className: 'rsp-dialogBody' }, t(`${key}.body`)),
          messages.map((text, index) => h('p', { className: 'rsp-warn', key: `warn-${String(index)}` }, text)),
          error === null ? null : h('p', { className: 'rsp-error' }, error),
          h('div', { className: 'rsp-actions' },
            h('button', {
              type: 'button', className: 'rsp-action', disabled: busy === true, onClick: onCancel,
            }, t('dialog.cancel')),
            h('button', {
              type: 'button',
              className: 'rsp-action',
              'data-primary': true,
              ...(shuttingDown ? { 'data-danger': '' } : {}),
              disabled: busy === true,
              onClick: () => onConfirm(needsForce),
            }, primaryText),
          ),
        ),
      )
    }

    /**
     * 二级菜单：向上弹出的小卡片，两行「重启 DSH / 关闭 DSH」，每行图标 + 文字。
     *
     * 交互与系统菜单一致：Esc 关闭、点菜单外关闭、打开时把焦点放到第一行、
     * 上下方向键在两行间移动、Enter / 空格执行。
     */
    function RestartMenu({ t, anchorRect, onPick, onDismiss }) {
      const menuRef = useRef(null)
      const itemRefs = useRef([])
      const [activeIndex, setActiveIndex] = useState(0)

      const items = [
        { id: 'restart', label: t('menu.restart'), icon: h(RestartIcon, { size: 16 }) },
        { id: 'shutdown', label: t('menu.shutdown'), icon: h(SignOutIcon, { size: 16 }), danger: true },
      ]

      // 定位：贴着按钮上沿往上弹，右边缘与按钮右边缘对齐。
      useEffect(() => {
        if (anchorRect === null || menuRef.current === null) return
        const el = menuRef.current
        const height = el.offsetHeight
        const width = el.offsetWidth
        const gap = 6
        const viewportW = window.innerWidth
        const viewportH = window.innerHeight
        // 默认放在按钮上方；上方空间不够就翻到下方。
        let top = anchorRect.top - height - gap
        if (top < 8) top = Math.min(anchorRect.bottom + gap, viewportH - height - 8)
        let left = anchorRect.right - width
        if (left < 8) left = 8
        if (left + width > viewportW - 8) left = viewportW - width - 8
        el.style.top = `${String(Math.round(top))}px`
        el.style.left = `${String(Math.round(left))}px`
      }, [anchorRect])

      // 打开即聚焦第一行，键盘操作才有起点。
      useEffect(() => {
        itemRefs.current[0]?.focus?.()
      }, [])

      useEffect(() => {
        const onPointerDown = (event) => {
          if (menuRef.current !== null && !menuRef.current.contains(event.target)) onDismiss()
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') { event.preventDefault(); onDismiss(); return }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActiveIndex(index => {
              const next = (index + 1) % items.length
              itemRefs.current[next]?.focus?.()
              return next
            })
            return
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActiveIndex(index => {
              const next = (index - 1 + items.length) % items.length
              itemRefs.current[next]?.focus?.()
              return next
            })
          }
        }
        document.addEventListener('mousedown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
          document.removeEventListener('mousedown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
        }
      }, [items.length, onDismiss])

      return h('div', {
        className: 'rsp-menu',
        role: 'menu',
        ref: menuRef,
        'aria-label': t('action.aria'),
        onMouseDown: event => { event.stopPropagation() },
      },
        items.map((item, index) => h('button', {
          key: item.id,
          type: 'button',
          role: 'menuitem',
          className: 'rsp-menuItem',
          ...(item.danger === true ? { 'data-danger': '' } : {}),
          tabIndex: index === activeIndex ? 0 : -1,
          ref: (node) => { itemRefs.current[index] = node },
          onFocus: () => { setActiveIndex(index) },
          onClick: () => { onPick(item.id) },
        },
          h('span', { className: 'rsp-menuIcon' }, item.icon),
          h('span', { className: 'rsp-menuLabel' }, item.label),
        )),
      )
    }

    /** 侧边栏底部的电源入口（一级按钮 -> 二级菜单 -> 确认框）。 */
    function RestartFooterAction(props) {
      const t = typeof props.t === 'function' ? props.t : (key => key)
      const wide = props.wide === true
      const [menuOpen, setMenuOpen] = useState(false)
      const [anchorRect, setAnchorRect] = useState(null)
      // 当前要执行的动作为 'restart' | 'shutdown' | null；null 表示对话框没开。
      const [action, setAction] = useState(null)
      const [status, setStatus] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const triggerRef = useRef(null)
      const mounted = useRef(true)
      useStyles()

      useEffect(() => {
        mounted.current = true
        return () => { mounted.current = false }
      }, [])

      const dismissMenu = useCallback(() => { setMenuOpen(false) }, [])

      const toggleMenu = useCallback(() => {
        setMenuOpen(value => {
          if (value) return false
          const rect = triggerRef.current?.getBoundingClientRect?.()
          if (rect !== undefined && rect !== null) {
            setAnchorRect({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right })
          }
          return true
        })
      }, [])

      const closeDialog = useCallback(() => {
        if (busy === true) return
        setAction(null)
        setError(null)
      }, [busy])

      // 选中菜单项：先关菜单，再读状态、开确认框。
      const pick = useCallback(async (id) => {
        setMenuOpen(false)
        setAction(id === 'shutdown' ? 'shutdown' : 'restart')
        setError(null)
        setStatus(null)
        try {
          const next = await fetchStatus()
          if (!mounted.current) return
          setStatus(next)
          if (next.supported !== true) {
            setError(next.reason === 'not-desktop' ? t('dialog.notDesktop') : t('dialog.unsupported'))
          }
        } catch {
          if (mounted.current) setError(t('dialog.checkFailed'))
        }
      }, [t])

      const confirm = useCallback(async (force) => {
        setBusy(true)
        setError(null)
        const isShutdown = action === 'shutdown'
        const failedText = isShutdown ? t('shutdown.failed') : t('dialog.failed')
        try {
          const result = isShutdown ? await requestShutdown(force) : await requestRestart(force)
          if (!mounted.current) return
          if (result.status === 409 && result.payload !== null && result.payload.reason === 'active-tasks') {
            // Host 说有活动任务：把状态补全，让按钮变成「仍然重启 / 仍然关闭」。
            setStatus(previous => ({
              ...(previous ?? {}),
              supported: true,
              activeTasks: result.payload.activeTasks === true,
              scheduledTasks: result.payload.scheduledTasks === true,
            }))
            setBusy(false)
            return
          }
          if (result.payload === null || result.payload.ok !== true) {
            setError(failedText)
            setBusy(false)
            return
          }
          // 成功：应用即将关闭，保持「正在重启/正在关闭」直到本页面消失。
        } catch {
          if (!mounted.current) return
          setError(failedText)
          setBusy(false)
        }
      }, [action, t])

      // 菜单开着时点按钮以外的地方由菜单自己处理；这里只保留 Esc 关闭对话框。
      useEffect(() => {
        if (action === null) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape' && busy !== true) { event.preventDefault(); closeDialog() }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => { document.removeEventListener('keydown', onKeyDown, true) }
      }, [action, busy, closeDialog])

      const aria = t('action.aria')
      const isShutdown = action === 'shutdown'

      return h('div', { 'data-dsh-restart-plugin': '' },
        h('button', {
          type: 'button',
          className: 'rsp-btn',
          ref: triggerRef,
          ...(wide ? {} : { 'data-rail': '' }),
          'aria-label': aria,
          'aria-haspopup': 'menu',
          'aria-expanded': menuOpen,
          title: aria,
          onClick: toggleMenu,
        },
          h(PowerIcon, { size: wide ? 16 : 18 }),
          // 展开态保留「重启」两字作为显著标识；收起成轨道时只有图标。
          wide ? h('span', { className: 'rsp-label' }, t('action.label')) : null,
        ),
        menuOpen
          ? h(RestartMenu, { t, anchorRect, onPick: pick, onDismiss: dismissMenu })
          : null,
        action !== null
          ? h(RestartDialog, {
            t,
            status,
            busy,
            error,
            variant: isShutdown ? 'shutdown' : 'restart',
            onCancel: closeDialog,
            onConfirm: confirm,
          })
          : null,
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-restart-plugin: dictionaries')
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'dsh-restart-plugin',
          order: 20,
          locale: NS,
        }, RestartFooterAction))
      },
    }
  },
})
