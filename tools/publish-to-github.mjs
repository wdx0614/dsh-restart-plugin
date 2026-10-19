/** 创建 GitHub 私有仓库并推送本仓库（不打印任何凭据）。 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const REPO = process.env.REPO_NAME ?? 'dsh-restart-plugin'
const CWD = 'G:\\file\\deepseek\\20261019重启功能插件开发'

/** 从 git credential helper 取 token。 */
async function getToken() {
  const { spawn } = await import('node:child_process')
  return await new Promise((resolve, reject) => {
    const child = spawn('git', ['credential', 'fill'], { cwd: CWD })
    let out = ''
    child.stdout.on('data', chunk => { out += chunk.toString() })
    child.on('exit', () => {
      const match = out.match(/^password=(.+)$/m)
      if (match) resolve(match[1].trim())
      else reject(new Error('未能从凭据助手取到 token'))
    })
    child.stdin.end('protocol=https\nhost=github.com\n\n')
  })
}

const token = await getToken()
console.log('已取得 token（长度 %d），不显示内容', token.length)

/** 调用 GitHub API。 */
async function api(path, method = 'GET', body) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'dsh-restart-plugin-setup',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  })
  const text = await response.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* 非 JSON */ }
  return { status: response.status, json, text }
}

// 1. 确认当前账号
const me = await api('/user')
if (me.status !== 200) {
  console.error('取账号信息失败:', me.status, me.text.slice(0, 300))
  process.exit(1)
}
const owner = me.json.login
console.log('GitHub 账号:', owner)

// 2. 看仓库是否已存在
const existing = await api(`/repos/${owner}/${REPO}`)
if (existing.status === 200) {
  console.log(`仓库已存在: ${existing.json.full_name} (private=${String(existing.json.private)})`)
  if (existing.json.private !== true) {
    console.error('注意：已存在的仓库不是私有的，停止推送。请先手动确认。')
    process.exit(2)
  }
} else if (existing.status === 404) {
  // 3. 创建私有仓库
  const created = await api('/user/repos', 'POST', {
    name: REPO,
    private: true,
    description: '为 DeepSeek Harness 桌面版提供「重启」入口的 cordis 插件：一键关闭并自动重新打开应用。',
    has_issues: true,
    has_wiki: false,
    auto_init: false,
  })
  if (created.status !== 201) {
    console.error('创建仓库失败:', created.status, created.text.slice(0, 400))
    process.exit(3)
  }
  console.log('已创建私有仓库:', created.json.full_name, 'private=', created.json.private)
} else {
  console.error('查询仓库失败:', existing.status, existing.text.slice(0, 300))
  process.exit(4)
}

// 4. 配置 remote（token 只用于本次推送，不写入仓库配置）
const remoteUrl = `https://github.com/${owner}/${REPO}.git`
try { await run('git', ['remote', 'remove', 'origin'], { cwd: CWD }) } catch { /* 没有 origin */ }
await run('git', ['remote', 'add', 'origin', remoteUrl], { cwd: CWD })
console.log('remote origin =', remoteUrl)

// 5. 推送（用 extraheader 临时带凭据，不写入 .git/config）
const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
await run('git', [
  '-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`,
  'push', '-u', 'origin', 'HEAD:main',
], { cwd: CWD, maxBuffer: 1e8 })
console.log('推送完成')

const verify = await api(`/repos/${owner}/${REPO}`)
if (verify.status === 200) {
  console.log('仓库确认: %s  private=%s  default_branch=%s',
    verify.json.html_url, String(verify.json.private), String(verify.json.default_branch))
  if (verify.json.private !== true) {
    console.error('警告：仓库不是私有的！')
    process.exit(5)
  }
}
