/**
 * 真机重启测试：调用插件 REST 接口触发一次真实重启。
 *
 * 这个脚本会让 DSH 关闭并自动重开。运行前请确认：
 *  1. 没有重要的、正在跑的对话任务；
 *  2. 你接受应用短暂关闭。
 *
 * 运行：node tools/trigger-restart-test.mjs [--force]
 */
const force = process.argv.includes('--force')
const base = process.argv.find(arg => arg.startsWith('http')) ?? 'http://127.0.0.1:59307'
const url = `${base}/dsh-restart-plugin/api/restart`

console.log(`POST ${url} force=${String(force)}`)
try {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(force ? { force: true } : {}),
    signal: AbortSignal.timeout(15000),
  })
  const text = await response.text()
  console.log('status:', response.status)
  console.log('body:', text)
} catch (error) {
  // 应用关闭时连接会断，这是预期行为之一。
  console.log('request ended early (expected when the app closes):', error.message)
}
