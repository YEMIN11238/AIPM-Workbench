/** Manage an owned SSH connection to the dedicated AstrBot deployment. */
import { accessSync, chmodSync, constants, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { createServer, isIP } from 'node:net'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const cloudPorts = Object.freeze({ astrbot: Object.freeze({ local: 16185, remote: 6185 }), snowluma: Object.freeze({ local: 15099, remote: 5099 }), novnc: Object.freeze({ local: 16081, remote: 6081 }) })
const directoryPath = '/opt/aipm-dafeiyu'
const assetNames = ['compose.yaml', 'prepare.py', 'deploy.sh', 'README.md']
const modelName = 'deepseek-flash'
const engine = { name: 'AstrBot + SnowLuma', versions: { astrbot: '4.29.3', snowluma: '2.2.0' }, source: 'https://github.com/AstrBotDevs/AstrBot' }
const emptyConnection = () => ({ host: '', port: 22, user: '', identityFile: '' })
const fingerprint = value => createHash('sha256').update(value).digest('hex')
const connectionId = value => fingerprint(JSON.stringify(value))

function atomic(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp'
  writeFileSync(temporary, value, { flag: 'wx', mode: 0o600 })
  renameSync(temporary, path)
}

/** Validate SSH arguments and private-key metadata without reading key contents. */
export function validateConnection(input) {
  if (!input || typeof input.host !== 'string' || typeof input.user !== 'string' || typeof input.identityFile !== 'string') throw new Error('请填写服务器地址、SSH 用户名和私钥位置')
  const host = input.host.trim().toLowerCase(), user = input.user.trim(), identityFile = input.identityFile
  const domain = host.length <= 253 && host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  if (!isIP(host) && !domain) throw new Error('服务器地址必须是有效 IP 或域名，不能包含 SSH 参数或命令')
  if (!/^[a-z_][a-z0-9_-]{0,31}$/i.test(user)) throw new Error('SSH 用户名格式无效')
  const port = Number(input.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SSH 端口必须是 1 到 65535 的整数')
  if (!identityFile || identityFile.length > 4096 || !isAbsolute(identityFile) || /[\x00-\x1f\x7f]/.test(identityFile)) throw new Error('请选择绝对路径的 SSH 私钥文件')
  let stat
  try { stat = lstatSync(identityFile); accessSync(identityFile, constants.R_OK) }
  catch { throw new Error('SSH 私钥文件不存在或当前用户不可读') }
  if (!stat.isFile() || ![0o400, 0o600].includes(stat.mode & 0o777)) throw new Error('SSH 私钥必须是普通文件，权限应为 400 或 600')
  return { host, port, user, identityFile }
}

function cleanEnvironment(environment) {
  const allowed = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'SSH_AUTH_SOCK']
  return Object.fromEntries(allowed.filter(name => typeof environment[name] === 'string').map(name => [name, environment[name]]))
}

async function availablePorts() {
  const servers = []
  try {
    for (const port of Object.values(cloudPorts)) {
      const server = createServer(); servers.push(server)
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port: port.local, exclusive: true }, resolve) })
    }
  } catch { throw new Error('本机管理端口已被占用或无法绑定，请先关闭占用程序') }
  finally { await Promise.all(servers.filter(server => server.listening).map(server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())))) }
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const done = error => { clearTimeout(timer); signal.removeEventListener('abort', abort); if (error) reject(error); else resolve() }
    const abort = () => done(new Error('管理连接已取消'))
    const timer = setTimeout(() => done(), milliseconds)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

/** Keep cloud credentials independent of workbench and inherited model settings. */
export class CompanionService {
  constructor({ root, directory, safeStorage, spawnProcess = spawn, killProcess = process.kill.bind(process), fetcher = fetch, checkPorts = availablePorts, environment = process.env, assetDirectory, commandTimeoutMs = 60000, deploymentTimeoutMs = 900000, readyTimeoutMs = 20000, pollIntervalMs = 350, stopTimeoutMs = 5000 }) {
    Object.assign(this, { root, safeStorage, spawnProcess, killProcess, fetcher, checkPorts, environment, commandTimeoutMs, deploymentTimeoutMs, readyTimeoutMs, pollIntervalMs, stopTimeoutMs })
    this.assetDirectory = assetDirectory || join(directory || fileURLToPath(new URL('..', import.meta.url)), 'companion/cloud')
    this.knownHostsPath = join(homedir(), '.ssh/known_hosts')
    mkdirSync(root, { recursive: true, mode: 0o700 }); chmodSync(root, 0o700)
    this.settingsPath = join(root, 'cloud-settings.json'); this.secretPath = join(root, 'credentials.bin')
    let stored = {}, secrets = {}
    try { if (existsSync(this.settingsPath)) stored = JSON.parse(readFileSync(this.settingsPath, 'utf8')) }
    catch { throw new Error('云端连接配置无法读取，请检查 cloud-settings.json') }
    if (existsSync(this.secretPath)) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，无法读取大肥鱼独立凭据')
      try { secrets = JSON.parse(safeStorage.decryptString(readFileSync(this.secretPath))) }
      catch { throw new Error('大肥鱼独立凭据无法解密') }
    }
    if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets)) throw new Error('大肥鱼独立凭据格式无效')
    this.secretRecord = secrets
    this.modelApiKey = typeof secrets.modelApiKey === 'string' ? secrets.modelApiKey : ''
    this.connection = { ...emptyConnection(), ...Object.fromEntries(Object.keys(emptyConnection()).filter(key => stored?.connection?.[key] !== undefined).map(key => [key, stored.connection[key]])) }
    this.deployment = stored?.deployment && ['assets', 'prepared', 'deployed'].includes(stored.deployment.phase) ? stored.deployment : null
    this.children = new Set(); this.actions = Promise.resolve(); this.closed = false; this.backendState = 'stopped'; this.lastError = ''; this.abort = new AbortController()
  }

  ensureOpen() { if (this.closed) throw new Error('后台正在关闭') }
  exclusive(action) { const work = this.actions.then(() => { this.ensureOpen(); return action() }); this.actions = work.catch(() => undefined); return work }
  writeSettings(connection = this.connection, deployment = this.deployment) { atomic(this.settingsPath, JSON.stringify({ version: 1, connection, deployment }, null, 2) + '\n') }
  currentDeployment() { return this.deployment?.connectionId === connectionId(this.connection) ? this.deployment : null }
  requireConnection() { const value = validateConnection(this.connection); this.connection = value; return value }

  /** Save a complete connection, disconnecting the old target before replacement. */
  async saveConnection(input) {
    const next = validateConnection(input)
    if (connectionId(next) !== connectionId(this.connection)) this.tunnelAbort?.abort()
    return this.exclusive(async () => {
      const changed = connectionId(next) !== connectionId(this.connection)
      if (changed) await this.stopTunnel()
      this.writeSettings(next, changed ? null : this.deployment)
      this.connection = next; if (changed) this.deployment = null
      this.lastError = ''; return this.snapshot()
    })
  }

  /** Encrypt only the dedicated model key; blank input retains the saved value. */
  async saveModelKey(value) {
    return this.exclusive(async () => {
      if (typeof value !== 'string' || value.length > 1000 || /[\s\x00-\x1f\x7f]/.test(value.trim()) || value.trim().startsWith('$')) throw new Error('请输入有效的大肥鱼独立 API Key')
      if (!value.trim()) { if (!this.modelApiKey) throw new Error('请填写大肥鱼专用 API Key'); return this.snapshot() }
      if (!this.safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，无法保存大肥鱼独立 API Key')
      const secrets = { ...this.secretRecord, modelApiKey: value.trim() }
      atomic(this.secretPath, this.safeStorage.encryptString(JSON.stringify(secrets)))
      this.secretRecord = secrets; this.modelApiKey = value.trim()
      return this.snapshot()
    })
  }

  sshOptions(connection, scp = false) {
    return ['-F', '/dev/null', scp ? '-P' : '-p', String(connection.port), '-i', connection.identityFile, '-o', 'StrictHostKeyChecking=yes', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3', '-o', 'ConnectTimeout=10', '-o', 'ConnectionAttempts=1', '-o', 'ForwardAgent=no', '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'PermitLocalCommand=no', '-o', 'UserKnownHostsFile=' + this.knownHostsPath]
  }
  sshArguments(connection, command) { return [...this.sshOptions(connection), '-T', connection.user + '@' + connection.host, command] }

  launch(command, args, pipeInput = false) {
    this.ensureOpen()
    const child = this.spawnProcess(command, args, { env: cleanEnvironment(this.environment), shell: false, detached: true, stdio: [pipeInput ? 'pipe' : 'ignore', 'ignore', 'pipe'] })
    const record = { child, exited: false, error: false, stderr: '', timedOut: false }
    record.done = new Promise(resolveDone => {
      child.once('error', () => { record.error = true })
      child.stderr?.on('data', data => { if (record.stderr.length < 16000) record.stderr += String(data).slice(0, 16000 - record.stderr.length) })
      child.stdin?.on('error', () => { record.inputFailed = true })
      child.once('close', (code, signal) => { record.exited = true; this.children.delete(record); resolveDone({ code, signal }) })
    })
    this.children.add(record); return record
  }

  async terminate(record) {
    if (!record) return
    if (record.stopping) return record.stopping
    record.stopping = (async () => {
      const signal = kind => {
        if (record.exited || !record.child.pid) return
        try { this.killProcess(-record.child.pid, kind) }
        catch (error) { if (error.code !== 'ESRCH') record.killFailed = true }
      }
      signal('SIGTERM')
      const timer = setTimeout(() => signal('SIGKILL'), this.stopTimeoutMs)
      try { await record.done } finally { clearTimeout(timer) }
      if (record.killFailed) throw new Error('未能终止本机管理进程')
    })()
    return record.stopping
  }

  failure(record, stage, result) {
    if (this.closed) return new Error('后台正在关闭')
    if (/host key verification failed|host identification has changed|no .* host key is known/i.test(record.stderr)) return new Error('SSH 主机指纹尚未受信任或已变化，请在系统终端核验并正常信任服务器后重试；不会跳过主机核验')
    if (/permission denied.*publickey/i.test(record.stderr)) return new Error('SSH 密钥验证未成功，请核对用户名、私钥和 SSH 密钥代理')
    if (record.timedOut) return new Error(stage + '超时；未确认操作完成')
    if (result.code === 73) return new Error('部署目录已有内容或私有配置，不能初始化；不会覆盖现有部署')
    const errors = { preflight: '云端环境检查未通过：需要 Ubuntu 22.04/24.04 x64、Python 3、Docker Engine 和 Compose，且 SSH 用户有 Docker 权限；不会自动安装或 sudo', prepare: '独立配置初始化未成功；不会覆盖已有私有配置', verify: '已初始化配置与当前独立密钥或部署身份不符，不能自动恢复', up: '云端容器启动未完成；独立配置已初始化，可在相同连接和相同密钥下重试部署', scp: '部署资产复制未成功，请检查服务器目录权限和 SSH 连接', directory: '云端专用目录无法准备，请确认 SSH 用户可写 /opt/aipm-dafeiyu；不会自动 sudo', ssh: 'SSH 连接未成功，请核对服务器、安全组和密钥', tunnel: 'SSH 管理连接已退出，请核对端口占用、服务器和密钥' }
    return new Error(errors[stage] || '云端管理操作未成功')
  }

  async run(command, args, { stage, input, timeout = this.commandTimeoutMs } = {}) {
    const record = this.launch(command, args, input !== undefined)
    const timer = setTimeout(() => { record.timedOut = true; void this.terminate(record).catch(() => undefined) }, timeout)
    try {
      if (input !== undefined) {
        if (!record.child.stdin) { await this.terminate(record); throw new Error('管理进程无法接收独立配置') }
        record.child.stdin.end(input)
      }
      const result = await record.done
      if (this.closed || record.error || record.inputFailed || record.timedOut || result.code !== 0 || result.signal) throw this.failure(record, stage, result)
    } finally { clearTimeout(timer) }
  }

  /** Initialize an empty dedicated directory, or resume a verified prepared deployment. */
  async deploy() {
    return this.exclusive(async () => {
      const connection = this.requireConnection(), id = connectionId(connection), keyHash = fingerprint(this.modelApiKey)
      if (!this.modelApiKey) throw new Error('请先保存大肥鱼自己的独立 API Key')
      const existing = this.currentDeployment()
      if (existing?.phase === 'deployed') throw new Error('该服务器已完成初始化；不会重复初始化或覆盖已有配置，请使用原版后台管理')
      if (existing?.phase === 'prepared' && existing.keyHash !== keyHash) throw new Error('独立密钥已变更，不能自动覆盖已初始化的云端配置；请先在原版后台核对')
      for (const name of assetNames) if (!existsSync(join(this.assetDirectory, name)) || !lstatSync(join(this.assetDirectory, name)).isFile()) throw new Error('固定版本的云端部署资产缺失')
      this.lastError = ''
      try {
        await this.run('/usr/bin/ssh', this.sshArguments(connection, 'true'), { stage: 'ssh' })
        if (existing?.phase !== 'prepared') {
          const emptyCheck = existing?.phase === 'assets'
            ? `test -d ${directoryPath} && test ! -L ${directoryPath} || exit 73; for entry in ${directoryPath}/* ${directoryPath}/.[!.]* ${directoryPath}/..?*; do test -e "$entry" || test -L "$entry" || continue; case "$entry" in ${assetNames.map(name => directoryPath + '/' + name).join('|')}) test -f "$entry" && test ! -L "$entry" || exit 73;; *) exit 73;; esac; done`
            : `test ! -L ${directoryPath} || exit 73; if test -e ${directoryPath}; then test -d ${directoryPath} && test -z "$(find ${directoryPath} -mindepth 1 -maxdepth 1 -print -quit)" || exit 73; fi`
          await this.run('/usr/bin/ssh', this.sshArguments(connection, emptyCheck + `; mkdir -p -m 700 ${directoryPath} && chmod 700 ${directoryPath}`), { stage: 'directory' })
          this.writeSettings(connection, { phase: 'assets', connectionId: id }); this.deployment = { phase: 'assets', connectionId: id }
          const host = isIP(connection.host) === 6 ? '[' + connection.host + ']' : connection.host
          await this.run('/usr/bin/scp', [...this.sshOptions(connection, true), ...assetNames.map(name => join(this.assetDirectory, name)), `${connection.user}@${host}:${directoryPath}/`], { stage: 'scp' })
        }
        await this.run('/usr/bin/ssh', this.sshArguments(connection, `bash ${directoryPath}/deploy.sh preflight ${directoryPath}`), { stage: 'preflight' })
        if (existing?.phase === 'prepared') {
          await this.run('/usr/bin/ssh', this.sshArguments(connection, `python3 ${directoryPath}/prepare.py --directory ${directoryPath} --verify --expected-key-sha256 ${keyHash}`), { stage: 'verify' })
        } else {
          await this.run('/usr/bin/ssh', this.sshArguments(connection, `python3 ${directoryPath}/prepare.py --directory ${directoryPath} --model ${modelName}`), { stage: 'prepare', input: JSON.stringify({ deepseekApiKey: this.modelApiKey }) })
          const prepared = { phase: 'prepared', connectionId: id, keyHash }
          this.writeSettings(connection, prepared); this.deployment = prepared
        }
        await this.run('/usr/bin/ssh', this.sshArguments(connection, `bash ${directoryPath}/deploy.sh up ${directoryPath}`), { stage: 'up', timeout: this.deploymentTimeoutMs })
        this.ensureOpen()
        const deployed = { phase: 'deployed', connectionId: id, keyHash }
        this.writeSettings(connection, deployed); this.deployment = deployed
        return this.snapshot()
      } catch (error) { if (!this.closed) this.lastError = error.message; throw error }
    })
  }

  /** Open only owned local forwards; HTTP readiness does not establish QQ login. */
  async start() {
    return this.exclusive(async () => {
      const connection = this.requireConnection()
      if (this.currentDeployment()?.phase !== 'deployed') throw new Error('请先在指定服务器完成独立部署')
      if (this.tunnel && !this.tunnel.exited && this.backendState === 'ready') return this.snapshot()
      await this.stopTunnel(); this.ensureOpen()
      try { await this.checkPorts() } catch (error) { this.backendState = 'failed'; this.lastError = error.message; throw error }
      this.ensureOpen()
      this.backendState = 'connecting'; this.lastError = ''; this.tunnelAbort = new AbortController()
      const controller = this.tunnelAbort, record = this.launch('/usr/bin/ssh', [...this.sshOptions(connection), '-N', '-T', ...Object.values(cloudPorts).flatMap(port => ['-L', `127.0.0.1:${port.local}:127.0.0.1:${port.remote}`]), connection.user + '@' + connection.host])
      this.tunnel = record
      void record.done.then(result => { if (this.tunnel !== record) return; this.tunnel = undefined; if (!this.closed && !controller.signal.aborted) { this.backendState = 'failed'; this.lastError = this.failure(record, 'tunnel', result).message } })
      try {
        const deadline = Date.now() + this.readyTimeoutMs
        while (Date.now() < deadline) {
          this.ensureOpen()
          if (controller.signal.aborted) throw new Error('管理连接已取消')
          if (record.exited) throw this.failure(record, 'tunnel', await record.done)
          let response
          try { response = await this.fetcher('http://127.0.0.1:16185/', { redirect: 'error', signal: AbortSignal.any([this.abort.signal, controller.signal, AbortSignal.timeout(1500)]) }) }
          catch { /* Retry transient local connection failures while the owned tunnel is alive. */ }
          this.ensureOpen()
          if (controller.signal.aborted) throw new Error('管理连接已取消')
          if (record.exited) throw this.failure(record, 'tunnel', await record.done)
          if (response?.status === 200 || response?.status === 401) { this.backendState = 'ready'; return this.snapshot() }
          await delay(this.pollIntervalMs, controller.signal)
        }
        throw new Error('云端后台就绪检查超时，请核对部署和本机端口；未确认 QQ 登录')
      } catch (error) {
        const cancelled = this.closed || controller.signal.aborted
        await this.stopTunnel()
        if (!cancelled) { this.backendState = 'failed'; this.lastError = error.message }
        throw error
      }
    })
  }

  async stopTunnel() { this.tunnelAbort?.abort(); const record = this.tunnel; this.tunnel = undefined; this.backendState = 'stopped'; await this.terminate(record) }
  /** Disconnect the Mac's tunnel without stopping any cloud service. */
  async stop() { this.tunnelAbort?.abort(); return this.exclusive(async () => { await this.stopTunnel(); this.lastError = ''; return this.snapshot() }) }

  /** Return a server-specific native browser descriptor without authentication secrets. */
  async consoleUrl() {
    this.ensureOpen()
    if (this.backendState !== 'ready' || !this.tunnel || this.tunnel.exited) throw new Error('请先连接云端后台')
    return { url: 'http://127.0.0.1:16185/', allowedOrigin: 'http://127.0.0.1:16185', partition: 'persist:aipm-companion-astrbot-' + connectionId(this.connection) }
  }

  /** Project local management state only; cloud model calls and QQ delivery remain unverified. */
  async snapshot() {
    let configured = false
    try { validateConnection(this.connection); configured = true } catch { /* Missing or inaccessible key metadata leaves configuration editable. */ }
    const deployment = this.currentDeployment(), deployed = deployment?.phase === 'deployed', prepared = deployment?.phase === 'prepared'
    return { engine: structuredClone(engine), settings: { botQQ: '872713341', owner: { qq: '3202619225' } }, connection: { ...this.connection, configured }, model: { name: modelName, configured: !!this.modelApiKey, independent: true, remoteSync: deployed && deployment.keyHash === fingerprint(this.modelApiKey) ? 'synced' : 'pending' }, backend: { running: !!this.tunnel && !this.tunnel.exited && this.backendState === 'ready', state: configured ? this.backendState : 'waiting_server', error: this.lastError }, qq: { connected: false, state: 'unknown', error: '' }, deployment: { state: deployed ? 'deployed' : 'not_deployed', directory: directoryPath, prepared, note: prepared ? '独立配置已初始化但容器尚未确认启动；使用同一连接和密钥重试部署即可恢复。' : deployed ? '独立配置已写入并提交容器启动；仍需在原版界面确认协议、登录和 QQ 收发。' : '' } }
  }

  /** Reach local-process quiescence and prevent queued deployment steps from launching. */
  async close() {
    if (this.closePromise) return this.closePromise
    this.closed = true; this.abort.abort(); this.tunnelAbort?.abort()
    this.closePromise = (async () => { await Promise.all([...this.children].map(record => this.terminate(record))); await this.actions; this.tunnel = undefined; this.backendState = 'stopped' })()
    return this.closePromise
  }
}
