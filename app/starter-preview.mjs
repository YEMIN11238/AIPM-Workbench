/** Own local preview servers and capture actual browser evidence through the desktop host. */
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Manage preview process groups; BrowserWindow construction is supplied by the main process. */
export class StarterPreview {
  constructor({ capturePage, getExtraEnv = () => ({}), onChange = () => {} }) { this.servers = new Map(); this.capturePage = capturePage; this.getExtraEnv = getExtraEnv; this.onChange = onChange }
  list(id) { return [...this.servers.values()].filter(s => s.id === id).map(s => ({ url: s.url, port: s.port, status: s.status, output: s.output.slice(-3000) })) }
  /** Start only loopback previews, with model configuration injected into the child environment. */
  async start(id, workspace, { command, cwd = '.', port, use_api = false }, config) {
    if (typeof command !== 'string' || command.length > 12000 || !Number.isInteger(port) || port < 1024 || port > 65535 || /0\.0\.0\.0|--public|--tunnel|ngrok|cloudflared/i.test(command)) throw new Error('预览必须使用本机地址和有效端口，不自动对公网暴露')
    const folder = realpathSync(resolve(workspace, cwd)); if (folder !== workspace && !folder.startsWith(workspace + '/')) throw new Error('预览目录不在当前开发项目内')
    const identity = id + ':' + port
    if (this.servers.has(identity)) await this.stop(id, port)
    await new Promise((resolve, reject) => { const probe = createServer(); probe.once('error', () => reject(new Error('端口已占用，请换一个预览端口'))); probe.listen(port, '127.0.0.1', () => probe.close(resolve)) })
    const home = join(workspace, '.starter/home'); mkdirSync(home, { recursive: true })
    const env = { ...Object.fromEntries(['PATH', 'TMPDIR', 'LANG'].filter(k => process.env[k]).map(k => [k, process.env[k]])), HOME: home, HOST: '127.0.0.1', PORT: String(port), PYTHONDONTWRITEBYTECODE: '1', ...this.getExtraEnv() }
    if (use_api) Object.assign(env, { DEEPSEEK_API_KEY: config.apiKey, OPENAI_API_KEY: config.apiKey, ANTHROPIC_API_KEY: config.apiKey, OPENAI_BASE_URL: config.baseUrl, ANTHROPIC_BASE_URL: config.anthropicBaseUrl, MODEL_ID: config.model })
    let args = ['/bin/bash', '-c', command]
    if (process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec')) { const profile = `(version 1)(allow default)(deny file-write*)(allow file-write* (subpath ${JSON.stringify(workspace)}) (subpath "/private/tmp") (subpath "/private/var/folders") (literal "/dev/null"))`; args = ['/usr/bin/sandbox-exec', '-p', profile, ...args] }
    const child = spawn(args[0], args.slice(1), { cwd: folder, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
    let resolveDone
    const server = { id, port, url: `http://127.0.0.1:${port}`, child, status: 'starting', output: '', done: new Promise(resolve => { resolveDone = resolve }) }
    this.servers.set(identity, server)
    const log = chunk => { server.output = (server.output + String(chunk).split(config.apiKey || '\0').join('[已隐藏]')).slice(-20000) }
    child.stdout.on('data', log); child.stderr.on('data', log)
    child.once('error', error => { server.output += error.message; server.status = 'failed' })
    child.once('close', code => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL') } catch (error) { /* group already reaped */ } } server.status = code === 0 ? 'stopped' : 'failed'; if (this.servers.get(identity) === server) this.servers.delete(identity); resolveDone(); try { this.onChange(id) } catch (error) { /* presentation cannot prevent teardown */ } })
    const deadline = Date.now() + 40000
    while (Date.now() < deadline) {
      if (['failed', 'stopped'].includes(server.status)) throw new Error('预览启动失败：' + server.output.slice(-1000))
      try { const response = await fetch(server.url, { signal: AbortSignal.timeout(1000) }); if (response.status < 500) { server.status = 'running'; return { url: server.url, status: server.status } } }
      catch (error) { /* Wait for the local server to bind its port. */ }
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    await this.stop(id, port); throw new Error('本地预览启动超时，请检查端口、依赖和启动命令')
  }
  /** Capture only an owned local server; screenshots are separate from human visual acceptance. */
  async capture(id, workspace, { url, mobile = false, phase = 3 }) {
    const target = new URL(url)
    if (!['127.0.0.1', 'localhost'].includes(target.hostname) || !this.list(id).some(s => s.port === Number(target.port)) || target.username || target.password) throw new Error('只能记录当前项目已启动的本地预览')
    const directory = join(workspace, 'docs/evidence', '阶段' + phase); mkdirSync(directory, { recursive: true })
    const file = `docs/evidence/阶段${phase}/${mobile ? '手机' : '桌面'}-${randomUUID()}.png`
    const result = await this.capturePage(url, mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 })
    writeFileSync(join(workspace, file), result.bytes, { mode: 0o600 })
    return { file, url, mobile, pageText: result.text.slice(0, 10000), viewport: mobile ? '390×844' : '1440×960' }
  }
  /** Stop one or every owned preview for a project and await process exit. */
  async stop(id, port) {
    for (const server of [...this.servers.values()].filter(s => s.id === id && (port === undefined || s.port === port))) {
      try { process.kill(-server.child.pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error }
      const timer = setTimeout(() => { try { process.kill(-server.child.pid, 'SIGKILL') } catch (error) { /* close owns completion */ } }, 1500)
      try { await server.done } finally { clearTimeout(timer) }
    }
  }
  /** Reap all preview groups on app exit. */
  async close() { await Promise.all([...new Set([...this.servers.values()].map(s => s.id))].map(id => this.stop(id))) }
}
