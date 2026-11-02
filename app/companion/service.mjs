import { nodeExecutable } from '../runtime-paths.mjs'
/** Launch the tutorial's existing QQ Bridge; conversation and memory stay upstream. */
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, chmodSync, openSync, closeSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

export const engine = Object.freeze({ name: 'QQ Bridge', version: '0.3.3', mode: 'reserved2', source: 'https://github.com/leonathan369-droid/qq-bridge', original: 'https://github.com/Derpyu520/qq-bridge', revision: '966ef411ce4508c31151b98cf64d8150493cdcdc' })
export const defaultSettings = () => ({ version: 2, persona: '你叫大肥鱼，是用户熟悉的 AI 朋友。说话自然、简短，不编造经历。', botQQ: '', owner: { qq: '', bilibili: '', douyin: '' }, model: { name: 'deepseek-v4-pro', baseUrl: 'https://api.deepseek.com' }, runtimePath: '' })
function atomic(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = path + '.' + randomUUID() + '.tmp'
  writeFileSync(temporary, value, { flag: 'wx', mode: 0o600 }); renameSync(temporary, path)
}
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Only explicitly selected runtime variables cross into the isolated DSH process. */
export function runtimeEnvironment(environment, home, sourceRoot, modelKey) {
  const allowed = ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'SSL_CERT_DIR']
  const result = Object.fromEntries(allowed.filter(name => typeof environment[name] === 'string').map(name => [name, environment[name]]))
  result.DSH_HOME = home
  result.TSX_TSCONFIG_PATH = join(sourceRoot, 'tsconfig.json')
  if (modelKey) result.DEEPSEEK_API_KEY = modelKey
  return result
}

export class CompanionService {
  constructor({ root, directory, safeStorage, spawnProcess = spawn, killProcess = process.kill.bind(process), fetcher = fetch, nodePath = nodeExecutable, bridgeRoot }) {
    Object.assign(this, { root, safeStorage, spawnProcess, killProcess, fetcher, nodePath })
    this.sourceRoot = resolve(directory || fileURLToPath(new URL('..', import.meta.url)), '../..')
    this.bridgeRoot = bridgeRoot || join(dirname(root), '.app-data/companion-runtime/qq-bridge-0.3.3')
    this.home = join(root, 'dsh-home'); this.cwd = join(root, 'workspace')
    for (const dir of [root, this.home, this.cwd]) { mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700) }
    this.settingsPath = join(root, 'settings.json'); this.secretPath = join(root, 'credentials.bin')
    this.settings = { ...defaultSettings(), ...(existsSync(this.settingsPath) ? json(this.settingsPath) : {}) }
    this.secrets = { qqToken: randomBytes(32).toString('hex'), authToken: '', modelApiKey: '', ...(existsSync(this.secretPath) ? JSON.parse(safeStorage.decryptString(readFileSync(this.secretPath))) : {}) }
    this.children = new Map(); this.actions = Promise.resolve(); this.backendState = 'stopped'; this.lastError = ''; this.runtimeError = ''; this.closed = false
  }
  exclusive(action) { const work = this.actions.then(action); this.actions = work.catch(() => undefined); return work }
  saveSecrets(secrets) {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，无法保存大肥鱼凭证')
    atomic(this.secretPath, this.safeStorage.encryptString(JSON.stringify(secrets))); this.secrets = secrets
  }
  async saveModelKey(value) {
    return this.exclusive(async () => {
      if (typeof value !== 'string' || value.length > 1000 || /[\s\x00-\x1f]/.test(value.trim())) throw new Error('请输入有效的 DeepSeek API Key')
      if (!value.trim() && !this.secrets.modelApiKey) throw new Error('请填写大肥鱼专用 API Key')
      if (value.trim()) {
        const running = this.children.has('dsh')
        if (running) await this.stopBackend()
        this.saveSecrets({ ...this.secrets, modelApiKey: value.trim() })
        if (running) await this.startBackend()
      }
      return this.snapshot()
    })
  }
  /** Configure existing upstream files, without replacing its prompts or algorithms. */
  prepare() {
    const path = join(this.bridgeRoot, 'config.json')
    if (!existsSync(path)) {
      const config = json(join(this.bridgeRoot, 'config.example.json'))
      Object.assign(config.dsh, { baseUrl: 'http://127.0.0.1:19387', model: this.settings.model.name, reasoningEffort: 'off', modelScope: 'session', authToken: '', allowRemote: false })
      Object.assign(config.snowluma, { wsUrl: 'ws://127.0.0.1:3001', httpUrl: 'http://127.0.0.1:3000', accessToken: this.secrets.qqToken, followDiscoveredEndpoint: false, homeDir: this.settings.runtimePath ? dirname(this.settings.runtimePath) : '', webuiUrl: 'http://127.0.0.1:5099' })
      config.ownerQQ = Number(this.settings.owner.qq); config.allow = { private: [Number(this.settings.owner.qq)], groups: [] }; config.allowAllWhenEmpty = false
      config.sessionCwd = this.cwd; config.workspaceTitle = '大肥鱼 QQ 聊天'; config.consolePort = 3101; config.consoleToken = randomBytes(32).toString('hex')
      config.panel = { llbotCommand: this.settings.runtimePath ? [this.settings.runtimePath, '--qq=' + this.settings.botQQ] : [], llbotCwd: this.settings.runtimePath ? dirname(this.settings.runtimePath) : '', llbotQq: this.settings.botQQ }
      config.role = { ...config.role, injectPerMessage: true }
      // Existing optional autonomous research/proactive sending can be enabled in the original console.
      config.slang.autoResearch = false; config.social.proactiveEnabled = false; config.socialV2.proactive.enabled = false
      atomic(path, JSON.stringify(config, null, 2) + '\n')
      atomic(join(this.bridgeRoot, 'roles/大肥鱼.md'), this.settings.persona + '\n')
      atomic(join(this.bridgeRoot, 'state/current-role.json'), JSON.stringify({ role: '大肥鱼' }))
    }
    const config = json(path)
    if (this.settings.runtimePath && !config.snowluma.webuiPasswordFile) {
      config.snowluma.webuiPasswordFile = join(dirname(this.settings.runtimePath), 'bin/llbot/data/webui_token.txt')
      atomic(path, JSON.stringify(config, null, 2) + '\n')
    }
    if (config.dsh.baseUrl !== 'http://127.0.0.1:19387' || config.consolePort !== 3101) throw new Error('桥接端口配置已变更，请先在原配置中核对')
    return config
  }
  launch(name, command, args, cwd, env) {
    if (this.children.has(name)) return this.children.get(name)
    const fd = openSync(join(this.root, name + '.log'), 'a', 0o600)
    let child
    try { child = this.spawnProcess(command, args, { cwd, env, detached: true, stdio: ['ignore', fd, fd] }) } finally { closeSync(fd) }
    const record = { child, exited: false, error: null }
    record.done = new Promise(resolveDone => {
      child.once('error', () => { record.error = '程序启动失败'; record.exited = true })
      child.once('close', (code, signal) => { record.exited = true; if (this.children.get(name) === record) this.children.delete(name); resolveDone({ code, signal }); if (code && !this.closed) { if (name === 'qq') this.runtimeError = 'QQ 程序已退出，请核对授权码和登录状态'; else { this.backendState = 'failed'; this.lastError = '后台程序已退出，请检查本机运行日志' } } })
    })
    this.children.set(name, record); return record
  }
  async stopChild(name) {
    const record = this.children.get(name); if (!record) return
    const signal = kind => { if (record.exited) return; try { this.killProcess(-record.child.pid, kind) } catch (error) { if (error.code !== 'ESRCH') throw error } }
    signal('SIGTERM'); const timer = setTimeout(() => signal('SIGKILL'), 5000)
    try { await record.done } finally { clearTimeout(timer); this.children.delete(name) }
  }
  async waitFor(name, check, maxMs = 45000) {
    const deadline = Date.now() + maxMs
    while (Date.now() < deadline) {
      if (this.closed) throw new Error('后台正在关闭')
      const record = this.children.get(name)
      if (!record || record.exited) throw new Error(name === 'dsh' ? '独立 DSH 未启动成功，请查看运行日志' : '原版桥接未启动成功，请查看运行日志')
      try { if (await check()) return } catch (error) { if (Date.now() >= deadline) throw error }
      await pause(350)
    }
    throw new Error('后台启动等待超时，请检查本机运行日志')
  }
  async bridgeApi(path, { method = 'GET', body } = {}) {
    const config = this.prepare()
    const response = await this.fetcher('http://127.0.0.1:3101' + path, { method, headers: { 'x-console-token': config.consoleToken, 'content-type': 'application/json', origin: 'http://127.0.0.1:3101' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(2000) })
    if (!response.ok) throw new Error('原版控制台暂不可用（HTTP ' + response.status + '）')
    return response.json()
  }
  async startBackend() {
    if (this.closed) throw new Error('后台正在关闭')
    if (!this.secrets.modelApiKey) throw new Error('请先配置大肥鱼自己的 API Key')
    if (this.children.has('dsh') && this.children.has('bridge')) return
    if (this.children.has('dsh') || this.children.has('bridge')) await this.stopBackend()
    this.prepare(); this.backendState = 'starting'; this.lastError = ''
    const environment = runtimeEnvironment(process.env, this.home, this.sourceRoot)
    try {
      this.launch('dsh', this.nodePath, ['--import', fileURLToPath(import.meta.resolve('tsx/esm')), join(this.sourceRoot, 'apps/cli/src/bin.ts'), '--profile', 'web', '--host', '127.0.0.1', '--port', '19387', '--no-open'], this.cwd, { ...environment, DEEPSEEK_API_KEY: this.secrets.modelApiKey })
      await this.waitFor('dsh', async () => { const response = await this.fetcher('http://127.0.0.1:19387/', { signal: AbortSignal.timeout(1500) }); return response.ok || response.status === 401 })
      this.launch('bridge', this.nodePath, [join(this.bridgeRoot, 'src/bridge.js')], this.bridgeRoot, environment)
      await this.waitFor('bridge', async () => { const status = await this.bridgeApi('/api/status'); return typeof status.mode === 'string' && status.dshReady === true })
      this.backendState = 'ready'
    } catch (error) { await this.stopBackend(); this.backendState = 'failed'; this.lastError = error.message; throw error }
  }
  async start() { return this.exclusive(async () => { await this.startBackend(); return this.snapshot() }) }
  async stopBackend() { await this.stopChild('bridge'); await this.stopChild('dsh'); this.backendState = 'stopped' }
  async stop() { return this.exclusive(async () => { await this.stopBackend(); await this.stopChild('qq'); return this.snapshot() }) }
  async startQQ(value = '') {
    return this.exclusive(async () => {
      if (typeof value !== 'string' || value.length > 8000) throw new Error('QQ 授权码格式不正确')
      if (value.trim()) this.saveSecrets({ ...this.secrets, authToken: value.trim() })
      if (!this.secrets.authToken) throw new Error('请先取得 LuckyLillia AuthToken，再完成 QQ 登录')
      if (!this.settings.runtimePath || !existsSync(this.settings.runtimePath)) throw new Error('未找到现成 QQ 网关程序')
      if (!this.settings.botQQ || !this.settings.owner.qq) throw new Error('请先配置机器人和本人 QQ')
      const runtime = dirname(this.settings.runtimePath), data = join(runtime, 'bin/llbot/data'), config = json(join(runtime, 'bin/llbot/default_config.json'))
      config.webui = { enable: true, host: '127.0.0.1', port: 5099 }; config.ob11.enable = true
      for (const connection of config.ob11.connect) { connection.enable = ['ws', 'http'].includes(connection.type); if (connection.enable) Object.assign(connection, { host: '127.0.0.1', port: connection.type === 'ws' ? 3001 : 3000, token: this.secrets.qqToken, reportSelfMessage: false, reportOfflineMessage: false, debug: false }) }
      atomic(join(data, 'auth_token.txt'), this.secrets.authToken)
      atomic(join(runtime, 'bin/llbot/default_config.json'), JSON.stringify(config, null, 2))
      atomic(join(data, 'config_' + this.settings.botQQ + '.json'), JSON.stringify(config, null, 2))
      this.prepare(); this.runtimeError = ''
      this.launch('qq', this.settings.runtimePath, ['--qq=' + this.settings.botQQ], runtime, runtimeEnvironment(process.env, this.home, this.sourceRoot))
      return this.snapshot()
    })
  }
  async stopQQ() { return this.exclusive(async () => { await this.stopChild('qq'); this.runtimeError = ''; return this.snapshot() }) }
  async consoleUrl() {
    const result = await this.bridgeApi('/api/console/ticket', { method: 'POST', body: {} })
    if (!result.ok || typeof result.ticket !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(result.ticket)) throw new Error('未取得原版控制台的一次性登录票据')
    return 'http://127.0.0.1:3101/auth/ticket?t=' + encodeURIComponent(result.ticket)
  }
  async snapshot() {
    let status = null
    if (this.children.has('bridge')) { try { status = await this.bridgeApi('/api/status') } catch (error) { this.lastError = '原版桥接暂未就绪' } }
    const connected = status?.snowluma?.connected === true && status.snowluma.accountOnline === true && status.snowluma.good !== false
    const state = status && !status.dshReady && this.backendState === 'ready' ? 'starting' : this.backendState
    return { engine: { ...engine, installed: existsSync(join(this.bridgeRoot, 'src/bridge.js')) }, settings: { botQQ: this.settings.botQQ, owner: this.settings.owner }, model: { name: this.settings.model.name, configured: !!this.secrets.modelApiKey, independent: true }, backend: { running: !!status, state, error: this.lastError }, qq: { connected, state: connected ? 'connected' : !this.secrets.authToken ? 'waiting_auth' : this.children.has('qq') ? 'waiting_login' : 'stopped', error: this.runtimeError }, runtime: { installed: !!this.settings.runtimePath && existsSync(this.settings.runtimePath), authConfigured: !!this.secrets.authToken, state: this.children.has('qq') ? 'running' : 'stopped', error: this.runtimeError }, platforms: { bilibili: 'not_connected', douyin: 'windows_only' } }
  }
  async close() { this.closed = true; await this.exclusive(async () => { await this.stopBackend(); await this.stopChild('qq') }) }
}
