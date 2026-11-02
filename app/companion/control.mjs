/** Explicit local companion controls, forwarded to the owning Electron instance. */
import { chmodSync, existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

const actions = new Set(['status', 'save-connection', 'deploy', 'connect', 'disconnect', 'open-companion'])
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const invalid = () => new Error('大肥鱼控制请求无效：仅接受规定的动作、请求 ID 和非秘密连接字段')
const object = value => !!value && typeof value === 'object' && !Array.isArray(value)
const only = (value, keys) => Object.keys(value).every(key => keys.includes(key))

/** Validate a wire request without accepting credentials, commands, or file destinations. */
export function validateCompanionControl(value) {
  if (!object(value) || !only(value, ['requestId', 'action', 'connection']) || typeof value.requestId !== 'string' || !uuid.test(value.requestId) || !actions.has(value.action)) throw invalid()
  const result = { requestId: value.requestId, action: value.action }
  if (value.action === 'save-connection') {
    const c = value.connection
    if (!object(c) || !only(c, ['host', 'port', 'user', 'identityFile']) || !['host', 'user', 'identityFile'].every(key => typeof c[key] === 'string' && c[key].length > 0 && c[key].length <= 4096 && !/[\x00-\x1f\x7f]/.test(c[key])) || !Number.isInteger(c.port) || c.port < 1 || c.port > 65535 || !isAbsolute(c.identityFile)) throw invalid()
    result.connection = { host: c.host, port: c.port, user: c.user, identityFile: c.identityFile }
  } else if (value.connection !== undefined) throw invalid()
  return result
}

/** Parse the single explicit control flag; normal application arguments remain unchanged. */
export function parseCompanionControl(argv) {
  const flags = argv.map((arg, index) => ({ arg, index })).filter(({ arg }) => typeof arg === 'string' && arg.startsWith('--companion-'))
  if (!flags.length) return null
  if (flags.length !== 1) throw invalid()
  const { arg, index } = flags[0]
  const raw = arg === '--companion-control' ? argv[index + 1] : arg.startsWith('--companion-control=') ? arg.slice('--companion-control='.length) : undefined
  if (typeof raw !== 'string' || raw.length > 12000) throw invalid()
  let value
  try { value = JSON.parse(raw) } catch (error) { throw invalid() }
  return validateCompanionControl(value)
}

/** Forward only validated requests to the existing owner of the desktop instance. */
export function claimCompanionInstance({ app, request, submit, focus, rejected }) {
  const initial = request ? validateCompanionControl(request) : null
  if (!app.requestSingleInstanceLock(initial ? { companionControl: initial } : {})) { app.quit(); return false }
  app.on('second-instance', (_event, argv, _workingDirectory, additionalData) => {
    try {
      const forwarded = additionalData && Object.hasOwn(additionalData, 'companionControl') ? validateCompanionControl(additionalData.companionControl) : parseCompanionControl(argv)
      if (forwarded) submit(forwarded); else focus()
    } catch (error) { rejected() }
  })
  if (initial) submit(initial)
  return true
}

function privateDirectory(path) {
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 })
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('大肥鱼控制结果目录不安全')
  chmodSync(path, 0o700)
}

function status(snapshot) {
  return {
    engine: { name: snapshot.engine?.name, versions: { astrbot: snapshot.engine?.versions?.astrbot, snowluma: snapshot.engine?.versions?.snowluma } },
    connection: { configured: snapshot.connection?.configured === true },
    model: { name: snapshot.model?.name, configured: snapshot.model?.configured === true, independent: snapshot.model?.independent === true, remoteSync: snapshot.model?.remoteSync === 'synced' ? 'synced' : 'pending' },
    backend: { running: snapshot.backend?.running === true, state: snapshot.backend?.state },
    qq: { connected: snapshot.qq?.connected === true, state: snapshot.qq?.state },
    deployment: { state: snapshot.deployment?.state, prepared: snapshot.deployment?.prepared === true },
  }
}

function publicError(error) {
  const message = typeof error?.message === 'string' ? error.message : ''
  if (/主机指纹|host key/i.test(message)) return { code: 'ssh_host_key', message: 'SSH 主机指纹尚未受信任或已变化，请先核验服务器指纹；不会自动跳过核验。' }
  if (/SSH 密钥验证/.test(message)) return { code: 'ssh_auth', message: 'SSH 密钥验证未成功，请核对登录用户名、私钥和密钥代理。' }
  if (/系统加密|独立凭据|专用 API Key|独立 API Key/.test(message)) return { code: 'independent_key_required', message: '大肥鱼独立密钥未就绪，请在工作台检查独立 API 设置。' }
  if (/Docker|云端环境检查/.test(message)) return { code: 'server_environment', message: '服务器运行环境未就绪，请检查 Ubuntu、Docker、Compose 及当前 SSH 用户权限。' }
  if (/已有内容|不会重复初始化|不会覆盖现有部署/.test(message)) return { code: 'existing_deployment', message: '服务器已有部署或私有内容，控制入口不会重新初始化或覆盖。' }
  if (/不能自动恢复|独立密钥已变更/.test(message)) return { code: 'prepared_mismatch', message: '已初始化配置与当前连接或独立密钥不符，请在原版后台核对。' }
  if (/端口.*占用/.test(message)) return { code: 'port_in_use', message: '本机管理端口被占用，请先关闭占用程序。' }
  if (/关闭|已取消/.test(message)) return { code: 'closing', message: '工作台正在关闭或操作已取消。' }
  if (/超时/.test(message)) return { code: 'timeout', message: '管理操作等待超时，未确认完成，请检查工作台内的连接状态。' }
  if (/服务器地址|SSH 用户名|SSH 端口|SSH 私钥|私钥文件|私钥必须/.test(message)) return { code: 'invalid_connection', message: '服务器连接配置无效，请核对地址、端口、用户名和私钥文件权限。' }
  if (/界面|控制台.*显示|窗口/.test(message)) return { code: 'window_unavailable', message: '工作台界面尚未就绪，未确认已打开原版后台。' }
  return { code: 'operation_failed', message: '大肥鱼控制操作未完成，请在工作台核对状态；没有输出凭据或服务器原始内容。' }
}

/** Dispatch only explicit companion actions and write exclusive, owner-only result files. */
export class CompanionControl {
  constructor({ root, ready = Promise.resolve(), service, openCompanion }) { Object.assign(this, { root, ready, service, openCompanion }); this.closed = false }

  async submit(input) {
    const request = validateCompanionControl(input)
    if (this.closed) throw new Error('大肥鱼控制入口正在关闭')
    await this.ready
    if (this.closed) throw new Error('大肥鱼控制入口正在关闭')
    privateDirectory(this.root)
    const base = join(this.root, 'control-requests'); privateDirectory(base)
    const directory = join(base, request.requestId)
    // A UUID can be claimed once; existing directories and links are never reused.
    mkdirSync(directory, { mode: 0o700 })
    writeFileSync(join(directory, 'request.json'), JSON.stringify(request) + '\n', { flag: 'wx', mode: 0o600 })
    let result
    try {
      const service = this.service()
      if (!service) throw new Error('工作台界面尚未就绪')
      switch (request.action) {
        case 'status': break
        case 'save-connection': await service.saveConnection(request.connection); break
        case 'deploy': await service.deploy(); break
        case 'connect': await service.start(); break
        case 'disconnect': await service.stop(); break
        case 'open-companion': await this.openCompanion(request.requestId); break
      }
      result = { requestId: request.requestId, action: request.action, ok: true, completedAt: new Date().toISOString(), status: status(await service.snapshot()) }
    } catch (error) { result = { requestId: request.requestId, action: request.action, ok: false, completedAt: new Date().toISOString(), error: publicError(error) } }
    writeFileSync(join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    return result
  }

  close() { this.closed = true }
}
