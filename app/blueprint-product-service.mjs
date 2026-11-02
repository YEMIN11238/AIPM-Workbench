/** Complete upstream product workspaces, teaching library and owned JSONL jobs. */
import { spawn } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, lstatSync, realpathSync, existsSync } from 'node:fs'
import { join, resolve, relative, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const hash = value => createHash('sha256').update(value).digest('hex')
const clone = value => JSON.parse(JSON.stringify(value))
const OMIT = new Set(['.git', '.venv', '__pycache__', 'node_modules', '.build-history', '.trajectories'])
const ACTIONS = ['init', 'plan', 'revise', 'verify', 'build', 'template', 'eval', 'demo', 'run', 'package']

/** Refuse linked directories/files, traversal and secret/configuration files in public reads. */
function contained(root, name, { directory = false, missing = false } = {}) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.split('/').some(p => p === '..' || p === '.' || !p)) throw new Error('文件路径无效')
  const path = resolve(root, name)
  if (!path.startsWith(root + '/')) throw new Error('文件超出产品目录')
  let current = root
  for (const part of relative(root, path).split('/')) {
    current = join(current, part)
    if (existsSync(current)) { if (lstatSync(current).isSymbolicLink()) throw new Error('不读取符号链接') }
    else if (!missing) throw new Error('文件尚未生成')
  }
  if (!missing && directory !== lstatSync(path).isDirectory()) throw new Error('文件类型无效')
  return path
}

/** Own one child process group; credentials travel through stdin and never enter public job state. */
export class BlueprintProductService {
  constructor({ root, engineRoot, python, getCredentials, onUpdate = () => {}, bridgePath, deadlineMs = 15 * 60 * 1000 }) {
    mkdirSync(root, { recursive: true, mode: 0o700 })
    if (lstatSync(root).isSymbolicLink()) throw new Error('产品目录不能是链接')
    this.root = realpathSync(root); this.engineRoot = realpathSync(engineRoot); this.python = python
    this.bridgePath = bridgePath || fileURLToPath(new URL('./blueprint-product-bridge.py', import.meta.url))
    this.getCredentials = getCredentials; this.onUpdate = onUpdate; this.deadlineMs = deadlineMs
    this.products = join(this.root, 'products'); this.jobs = join(this.root, 'jobs')
    for (const path of [this.products, this.jobs]) { mkdirSync(path, { mode: 0o700, recursive: true }); if (lstatSync(path).isSymbolicLink()) throw new Error('产品目录不能是链接') }
    this.active = null; this.secrets = new Set(); this.closed = false
    this.manifest = JSON.parse(readFileSync(join(this.engineRoot, 'UPSTREAM.json'), 'utf8'))
    for (const job of this.listJobs()) if (job.status === 'running' || job.status === 'waiting') {
      job.status = 'interrupted'; job.waiting = null; job.error = '上次运行已中断。已保存文件保留，可重推方案或重新验证。'
      this.#saveJob(job)
    }
  }

  #clean(value) {
    let text = String(value || '')
    for (const secret of this.secrets) if (secret) text = text.split(secret).join('[已隐藏]')
    return text.replace(/sk-[A-Za-z0-9_-]{8,}/g, '[已隐藏]')
  }
  #atomic(path, data) { const temp = join(dirname(path), '.save-' + randomUUID()); writeFileSync(temp, data, { flag: 'wx', mode: 0o600 }); renameSync(temp, path) }
  #jobPath(id) { if (!ID.test(id)) throw new Error('任务编号无效'); return contained(this.jobs, id, { directory: true }) }
  #saveJob(job) { this.#atomic(join(this.#jobPath(job.id), 'job.json'), JSON.stringify(job, null, 2) + '\n') }
  #notify(job) { this.#saveJob(job); try { this.onUpdate(clone(job)) } catch (error) { console.error('产品任务通知失败', this.#clean(error.message)) } }
  #productPath(id) { if (!ID.test(id)) throw new Error('产品编号无效'); return contained(this.products, id, { directory: true }) }
  #metadata(id) { return JSON.parse(readFileSync(contained(this.#productPath(id), 'product.json'), 'utf8')) }

  /** Return actual installed upstream revision and discoverable modules. */
  status() { return { revision: this.manifest.revision, components: 17, activeId: this.active?.job.id || null } }
  /** List products without returning credentials or absolute internal paths. */
  list() {
    return readdirSync(this.products).filter(id => ID.test(id)).flatMap(id => {
      try { const meta = this.#metadata(id); return [{ ...meta, version: this.#version(id), hasPlan: existsSync(join(this.#productPath(id), '方案.md')) }] }
      catch (error) { return [] }
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  #version(id) { try { return Number(readFileSync(contained(this.#productPath(id), 'PRD.md'), 'utf8').match(/\|\s*当前版本\s*\|\s*V(\d+)/)?.[1] || 1) } catch (error) { return 0 } }
  /** Read a product's visible file tree, with secrets and build backups excluded. */
  get(id) {
    const meta = this.#metadata(id), base = this.#productPath(id), files = []
    const visit = (folder, prefix = '') => {
      for (const name of readdirSync(folder).sort()) {
        if (OMIT.has(name) || name.startsWith('.') && name !== '.env.example' || name === 'product.json' || name.endsWith('.pyc')) continue
        const path = join(folder, name), stat = lstatSync(path)
        if (stat.isSymbolicLink()) continue
        if (stat.isDirectory()) { if (files.length < 500) visit(path, prefix + name + '/') }
        else if (stat.isFile() && stat.size <= 2000000 && files.length < 500) files.push({ name: prefix + name, size: stat.size })
      }
    }
    visit(base)
    return { ...meta, version: this.#version(id), files, jobs: this.listJobs().filter(job => job.productId === id) }
  }
  #visibleFile(id, name) {
    if (typeof name !== 'string' || name.split('/').some(p => p.startsWith('.') && p !== '.env.example' || OMIT.has(p)) || name === 'product.json') throw new Error('此文件不在可编辑范围')
    if (name.split('/').pop() !== '.env.example' && !['.md', '.txt', '.json', '.py', '.yaml', '.yml', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.html', '.css', '.toml', '.csv'].includes(extname(name))) throw new Error('此文件请在本地打开')
    return contained(this.#productPath(id), name)
  }
  /** Read text together with a hash for conflict-aware editing. */
  read(id, name) { const path = this.#visibleFile(id, name); if (lstatSync(path).size > 2000000) throw new Error('文件过大'); const content = readFileSync(path, 'utf8'); return { name, content: this.#clean(content), hash: hash(content) } }
  /** Save user edits only when the file has not changed since reading it. */
  save(id, name, content, expectedHash) {
    if (this.active?.job.productId === id) throw new Error('产品任务执行中，请结束后再保存')
    if (typeof content !== 'string' || content.length > 200000) throw new Error('文件过长')
    if (!['PRD.md', '迭代记录.md'].includes(name) && !name.startsWith('skeleton/')) throw new Error('报告和历史快照只读，请编辑 PRD 或骨架代码')
    const path = this.#visibleFile(id, name), previous = readFileSync(path, 'utf8')
    if (hash(previous) !== expectedHash) throw new Error('文件已被其他操作修改，请重新打开后保存')
    if (name === 'PRD.md') {
      const version = text => text.match(/\|\s*当前版本\s*\|\s*V(\d+)/)?.[1]
      if (version(content) !== version(previous)) throw new Error('请通过“增加新需求”升版，不能直接改版本号')
    }
    const folder = join(this.#productPath(id), '.build-history', randomUUID()); mkdirSync(folder, { recursive: true, mode: 0o700 })
    writeFileSync(join(folder, 'before.txt'), previous, { mode: 0o600 }); writeFileSync(join(folder, 'file.json'), JSON.stringify({ name }), { mode: 0o600 })
    this.#atomic(path, content); return this.read(id, name)
  }
  /** List durable jobs, retaining failed and cancelled work. */
  listJobs() { return readdirSync(this.jobs).filter(id => ID.test(id)).flatMap(id => { try { return [JSON.parse(readFileSync(contained(this.#jobPath(id), 'job.json'), 'utf8'))] } catch (error) { return [] } }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }
  /** Return an allowlisted immutable job report or console transcript. */
  readJob(id, name) {
    if (!['结果.md', '结果.json', '运行记录.txt', 'agent-blueprint-student.zip'].includes(name)) throw new Error('任务文件名称无效')
    const path = contained(this.#jobPath(id), name)
    if (name.endsWith('.zip')) return { path }
    return { name, content: this.#clean(readFileSync(path, 'utf8')) }
  }
  /** Start a product action. Renderer destinations are never accepted. */
  start(input) {
    if (this.closed || this.active) throw new Error('请先结束当前产品任务')
    if (!input || !ACTIONS.includes(input.action)) throw new Error('产品操作无效')
    const action = input.action, request = { action, mock: input.mock === true }
    let productId = input.productId || null
    if (action === 'init') {
      if (typeof input.name !== 'string' || !input.name.trim() || typeof input.idea !== 'string' || !input.idea.trim() || input.idea.length > 60000) throw new Error('请填写产品名和想法')
      productId = randomUUID(); const folder = join(this.products, productId); mkdirSync(folder, { mode: 0o700 })
      const meta = { id: productId, name: input.name.trim().slice(0, 100), createdAt: new Date().toISOString() }
      writeFileSync(join(folder, 'product.json'), JSON.stringify(meta, null, 2), { mode: 0o600 })
      Object.assign(request, { name: meta.name, idea: input.idea.trim() })
    } else if (!['eval', 'demo', 'package'].includes(action)) this.#metadata(productId)
    if (productId) request.workspace = this.#productPath(productId)
    if (action === 'revise') {
      if (typeof input.requirement !== 'string' || !input.requirement.trim() || input.requirement.length > 60000) throw new Error('请填写新需求')
      if (!['full', 'quick', 'none'].includes(input.strategy)) throw new Error('请选择重推方式')
      Object.assign(request, { requirement: input.requirement.trim(), strategy: input.strategy })
    }
    if (action === 'template') { if (!Number.isInteger(input.level) || input.level < 0 || input.level > 4) throw new Error('模板层级无效'); request.level = input.level }
    if (action === 'eval') request.real = input.real === true
    if (action === 'demo') {
      if (typeof input.component !== 'string' || !/^s\d\d_[a-z_]+$/.test(input.component) || !readdirSync(this.engineRoot).includes(input.component)) throw new Error('组件无效')
      request.component = input.component
    }
    const id = randomUUID(), folder = join(this.jobs, id); mkdirSync(folder, { mode: 0o700 })
    const job = { id, action, productId, title: input.name || (productId ? this.#metadata(productId).name : input.component || action), status: 'running', createdAt: new Date().toISOString(), stage: '准备执行', logs: [], usage: {}, mock: request.mock, waiting: null }
    let resolveDone
    const current = { job, child: null, cancelled: false, timedOut: false, done: new Promise(resolve => { resolveDone = resolve }), resolveDone: () => resolveDone(), completed: false }
    this.active = current; this.#notify(job)
    current.timer = setTimeout(() => { current.timedOut = true; this.#kill(current) }, this.deadlineMs)
    void this.#launch(current, { ...request, out: folder }).catch(error => { current.error = this.#clean(error.message); this.#finish(current, null, null) })
    return clone(job)
  }
  async #launch(current, request) {
    const credentials = await this.getCredentials() || {}
    if (credentials.apiKey) this.secrets.add(credentials.apiKey)
    if (current.cancelled || current.timedOut) { this.#finish(current, null, null); return }
    const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG'].filter(key => process.env[key]).map(key => [key, process.env[key]]))
    Object.assign(env, { PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' })
    const child = spawn(this.python, ['-I', this.bridgePath], { cwd: this.engineRoot, env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
    current.child = child
    let pending = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      pending += chunk
      if (pending.length > 2000000) { current.error = '引擎输出过长'; this.#kill(current); return }
      let index
      while ((index = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, index); pending = pending.slice(index + 1)
        if (!line.trim()) continue
        try { this.#event(current, JSON.parse(line, (_key, value) => typeof value === 'string' ? this.#clean(value) : value)) }
        catch (error) { current.error = '引擎返回无效消息'; this.#kill(current) }
      }
    })
    child.stderr.on('data', chunk => { current.stderr = this.#clean((current.stderr || '') + chunk).slice(-4000) })
    child.stdin.on('error', () => { /* close owns completion */ })
    child.once('error', error => { current.error = this.#clean(error.message) })
    child.once('close', (code, signal) => this.#finish(current, code, signal))
    child.stdin.write(JSON.stringify({ ...request, engineRoot: this.engineRoot, credentials, maxCalls: 8, maxTokens: 90000 }) + '\n')
  }
  #event(current, event) {
    if (current.completed || current.cancelled || current.timedOut) return
    const job = current.job
    if (event.type === 'progress') { job.stage = event.message.slice(0, 250); job.logs.push(event.message) }
    if (event.type === 'console') job.logs.push(event.text)
    if (event.type === 'usage') job.usage = event.usage
    if (event.type === 'waiting') { job.waiting = event.prompt; job.status = 'waiting'; job.stage = '等待你的输入' }
    if (event.type === 'error') current.error = event.message
    if (event.type === 'result') { current.result = event; job.result = event.summary || {}; job.stage = '已完成' }
    job.logs = job.logs.slice(-250); this.#notify(job)
  }
  #finish(current, code, signal) {
    if (current.completed) return
    current.completed = true; clearTimeout(current.timer); clearTimeout(current.killTimer)
    // Reap any background descendants still in the owned process group.
    if (current.child && process.platform !== 'win32') { try { process.kill(-current.child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') console.error('结束产品后台任务失败', error.code) } }
    const job = current.job
    Object.assign(job, { exitCode: code, signal, timedOut: current.timedOut, waiting: null, finishedAt: new Date().toISOString() })
    job.status = current.cancelled ? 'cancelled' : current.timedOut || current.error || code !== 0 || !current.result ? 'failed' : current.result.needsReview ? 'needs_review' : 'completed'
    job.error = current.cancelled ? null : current.timedOut ? '已达到运行时间上限；文件保留，可以重新推导或验证。' : current.error || (job.status === 'failed' ? current.stderr || '任务未生成结果' : null)
    if (this.active === current) this.active = null
    this.#notify(job); current.resolveDone()
  }
  #kill(current) {
    if (!current.child) { this.#finish(current, null, null); return }
    const signal = name => { try { if (process.platform !== 'win32') process.kill(-current.child.pid, name); else current.child.kill(name) } catch (error) { if (error.code !== 'ESRCH') current.error = error.message } }
    signal('SIGTERM'); current.killTimer ||= setTimeout(() => signal('SIGKILL'), 1500)
  }
  /** Relay a user's exact reply to a live original component's input prompt. */
  reply(id, text) {
    const current = this.active
    if (current?.job.id !== id || !current.job.waiting) throw new Error('任务当前没有等待输入')
    if (typeof text !== 'string' || text.length > 60000) throw new Error('输入过长')
    current.job.waiting = null; current.job.status = 'running'; current.child.stdin.write(JSON.stringify({ text }) + '\n'); this.#notify(current.job)
  }
  /** Stop and await the entire owned process group. */
  async cancel(id) { const current = this.active; if (current?.job.id !== id) return; current.cancelled = true; this.#kill(current); await current.done }
  /** Return a known product or job directory for the native file opener. */
  folder(id, kind = 'product') { return kind === 'job' ? this.#jobPath(id) : this.#productPath(id) }
  /** Enumerate all upstream teaching files without exposing machine configuration. */
  library() {
    return Object.keys(this.manifest.files).filter(name => /\.(md|py|svg|json|ya?ml|txt)$/.test(name) && !name.startsWith('.')).map(name => ({ name, component: name.match(/^(s\d\d_[^/]+)\//)?.[1] || null }))
  }
  /** Return one pinned source, document or image, after verifying its upstream checksum. */
  readLibrary(name) {
    if (!this.library().some(file => file.name === name)) throw new Error('资料不存在')
    const path = contained(this.engineRoot, name), bytes = readFileSync(path)
    if (hash(bytes) !== this.manifest.files[name]) throw new Error('原版资料已被修改，请恢复后阅读或运行')
    return name.endsWith('.svg') ? { name, image: 'data:image/svg+xml;base64,' + bytes.toString('base64') } : { name, content: bytes.toString('utf8') }
  }
  /** Await child teardown before app exit. */
  async close() { this.closed = true; this.onUpdate = () => {}; if (this.active) await this.cancel(this.active.job.id) }
}
