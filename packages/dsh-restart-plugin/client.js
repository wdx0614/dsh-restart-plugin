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
      'action.label': '重启',
      'action.aria': '重启 DeepSeek Harness',
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
    }

    /** 英文文案。 */
    const en = {
      'action.label': 'Restart',
      'action.aria': 'Restart DeepSeek Harness',
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

    /** 把插件内联样式一次性插进文档；返回清理函数。 */
    function useStyles() {
      useEffect(() => {
        const STYLE_ID = 'dsh-restart-plugin-styles'
        if (document.getElementById(STYLE_ID) !== null) return undefined
        const style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = `
[data-dsh-restart-plugin]{flex:none;display:flex;align-items:center;margin:0;padding:0}
[data-dsh-restart-plugin] .rsp-btn{display:flex;align-items:center;justify-content:flex-start;gap:4px;box-sizing:border-box;border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font:inherit;font-size:13px;line-height:18px;height:28px;padding:0 6px;margin:0;border-radius:8px;overflow:hidden;white-space:nowrap}
[data-dsh-restart-plugin] .rsp-btn:hover,[data-dsh-restart-plugin] .rsp-btn:focus-visible{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
[data-dsh-restart-plugin] .rsp-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-2px}
[data-dsh-restart-plugin] .rsp-btn[data-rail]{width:36px;height:36px;padding:0;justify-content:center;gap:0;border-radius:12px;margin:0 auto}
[data-dsh-restart-plugin] .rsp-label{flex:none}
/* 目标位置：侧边栏最底层那一行（头像 wx_ 那行）的最右端。
   该行的容器是 ui-settings-general 的 triggerRow，它是 footArea 的最后一个子元素。
   sidebar.footer.action 只能往 footerActions 里加东西，而 footerActions 在
   triggerRow 之上、且被「会话与工作区」的 flex:1 1 100% 独占成一行，
   所以这里把整块 footArea 变成定位上下文，再把重启按钮绝对定位到它的右下角。
   按钮保留「图标 + 重启」两个字，作为显著标识。 */
div[class*="footArea"]{position:relative}
div[class*="footerActions"]{position:static}
[data-dsh-restart-plugin]{position:absolute;right:0;bottom:6px;z-index:1}
/* 给最底层那一行右侧留出按钮宽度，让头像/连接状态/更新提示不会压到「重启」下面
   （重启按钮约 62px 宽：图标 16 + 间距 4 + 两字 26 + 左右内边距 12，取 66px 留余量）。 */
[class*="triggerRow"]{box-sizing:border-box;padding-right:66px}
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

    /** 确认对话框。 */
    function RestartDialog({ t, status, busy, error, onCancel, onConfirm }) {
      const messages = []
      if (status !== null) {
        if (status.activeTasks === true && status.scheduledTasks === true) messages.push(t('dialog.activeAndScheduled'))
        else if (status.activeTasks === true) messages.push(t('dialog.activeTasks'))
        else if (status.scheduledTasks === true) messages.push(t('dialog.scheduledTasks'))
      }
      const needsForce = status !== null && (status.activeTasks === true || status.scheduledTasks === true)
      return h('div', {
        className: 'rsp-backdrop',
        role: 'presentation',
        onMouseDown: (event) => { if (event.target === event.currentTarget && busy !== true) onCancel() },
      },
        h('div', {
          className: 'rsp-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'rsp-dialog-title',
          onMouseDown: (event) => { event.stopPropagation() },
        },
          h('h2', { className: 'rsp-dialogTitle', id: 'rsp-dialog-title' }, t('dialog.title')),
          h('p', { className: 'rsp-dialogBody' }, t('dialog.body')),
          messages.map((text, index) => h('p', { className: 'rsp-warn', key: `warn-${String(index)}` }, text)),
          error === null ? null : h('p', { className: 'rsp-error' }, error),
          h('div', { className: 'rsp-actions' },
            h('button', {
              type: 'button', className: 'rsp-action', disabled: busy === true, onClick: onCancel,
            }, t('dialog.cancel')),
            h('button', {
              type: 'button', className: 'rsp-action', 'data-primary': true, disabled: busy === true,
              onClick: () => onConfirm(needsForce),
            }, busy === true ? t('dialog.starting') : needsForce ? t('dialog.force') : t('dialog.confirm')),
          ),
        ),
      )
    }

    /** 侧边栏底部的重启入口。 */
    function RestartFooterAction(props) {
      const t = typeof props.t === 'function' ? props.t : (key => key)
      const wide = props.wide === true
      const [open, setOpen] = useState(false)
      const [status, setStatus] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const mounted = useRef(true)
      useStyles()

      useEffect(() => {
        mounted.current = true
        return () => { mounted.current = false }
      }, [])

      const close = useCallback(() => {
        if (busy === true) return
        setOpen(false)
        setError(null)
      }, [busy])

      const openDialog = useCallback(async () => {
        setOpen(true)
        setError(null)
        setStatus(null)
        try {
          const next = await fetchStatus()
          if (!mounted.current) return
          setStatus(next)
          // 环境不支持时直接把原因作为错误文案展示，省掉一步点击。
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
        try {
          const result = await requestRestart(force)
          if (!mounted.current) return
          if (result.status === 409 && result.payload !== null && result.payload.reason === 'active-tasks') {
            // Host 说有活动任务：把状态补全，让按钮变成「仍然重启」。
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
            setError(t('dialog.failed'))
            setBusy(false)
            return
          }
          // 成功：应用即将关闭，保持「正在重启」直到本页面消失。
        } catch {
          if (!mounted.current) return
          setError(t('dialog.failed'))
          setBusy(false)
        }
      }, [t])

      // Esc 关闭。
      useEffect(() => {
        if (!open) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape' && busy !== true) { event.preventDefault(); close() }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => { document.removeEventListener('keydown', onKeyDown, true) }
      }, [open, busy, close])

      const label = t('action.label')
      const aria = t('action.aria')

      return h('div', { 'data-dsh-restart-plugin': '' },
        h('button', {
          type: 'button',
          className: 'rsp-btn',
          ...(wide ? {} : { 'data-rail': '' }),
          'aria-label': aria,
          title: aria,
          onClick: () => { void openDialog() },
        },
          h(RestartIcon, { size: wide ? 16 : 18 }),
          // 展开态保留「重启」两字作为显著标识；收起成轨道时只有图标。
          wide ? h('span', { className: 'rsp-label' }, label) : null,
        ),
        open
          ? h(RestartDialog, { t, status, busy, error, onCancel: close, onConfirm: confirm })
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
