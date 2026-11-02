/** Asynchronous local Blueprint tasks with private subprocess credentials and durable state. */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, lstatSync, realpathSync, accessSync, constants } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const REPORTS = { plan: ['方案.md', 'plan.json'], audit: ['差距报告.md', '本该有的PRD.md', 'audit.json'] }
const stages = { extract: '需求拆解', model: '领域建模', design: '架构设计', review: '独立审稿', design_retry: '修订方案', review_retry: '复审', infer: '反推项目意图', audit_review: '独立复核' }
const clone = value => JSON.parse(JSON.stringify(value))

/** Remove ambient credentials before launching the explicitly configured model bridge. */
function privateEnvironment() {
  const names = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'SYSTEMROOT', 'WINDIR']
  return { ...Object.fromEntries(names.filter(name => process.env[name]).map(name => [name, process.env[name]])), PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1' }
}

/** Validate persisted task input without accepting a renderer-provided file destination. */
function inputSpec(input) {
  if (!input || !['plan', 'audit'].includes(input.mode)) throw new Error('请选择生成方案或检查项目')
  const result = { mode: input.mode, title: String(input.title || (input.mode === 'plan' ? '新的产品方案' : '项目差距检查')).slice(0, 100), mock: input.mock === true }
  if (input.mode === 'plan') {
    if (typeof input.input !== 'string' || !input.input.trim()) throw new Error('请先填写产品想法或需求')
    if (input.input.length > 200000) throw new Error('需求内容过长，请控制在 20 万字以内')
    result.input = input.input.trim()
  } else {
    if (typeof input.projectPath !== 'string' || !input.projectPath) throw new Error('请先选择项目文件夹')
    result.projectPath = realpathSync(resolve(input.projectPath))
    if (!lstatSync(result.projectPath).isDirectory()) throw new Error('请选择项目文件夹')
    if (input.prdText != null) {
      if (typeof input.prdText !== 'string' || input.prdText.length > 200000) throw new Error('对照需求内容过长')
      result.prdText = input.prdText
    }
  }
  return result
}

/**
 * Owns one model subprocess at a time. All public task reads use opaque UUIDs.
 * @param {object} options Root, vendored engine, Python executable, configuration and callbacks.
 */
export class BlueprintService {
  constructor({ root, engineRoot, python, configPath, getCredentials = () => ({}), onUpdate = () => {}, bridgePath, deadlineMs = 15 * 60 * 1000, modelTimeout = 120, maxCalls = 8, maxTokens = 90000 }) {
    if (!root || !engineRoot || !python) throw new Error('Blueprint 路径配置不完整')
    this.root = resolve(root)
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    if (lstatSync(this.root).isSymbolicLink()) throw new Error('任务目录不能是符号链接')
    this.root = realpathSync(this.root)
    this.engineRoot = resolve(engineRoot)
    this.python = resolve(python)
    this.configPath = configPath ? resolve(configPath) : undefined
    this.bridgePath = bridgePath || fileURLToPath(new URL('./blueprint-bridge.py', import.meta.url))
    this.getCredentials = getCredentials
    this.onUpdate = onUpdate
    if (!Number.isFinite(deadlineMs) || deadlineMs < 100 || !Number.isFinite(modelTimeout) || modelTimeout <= 0) throw new Error('执行超时设置无效')
    if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 8 || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 90000) throw new Error('模型预算必须在调用 8 次及 90000 token 内')
    this.limits = { deadlineMs, modelTimeout, maxCalls, maxTokens }
    this.tasks = new Map()
    this.active = null
    this.secrets = new Set()
    this.lastProbe = { phase: 'not_checked' }
    for (const name of readdirSync(this.root)) {
      if (!ID.test(name)) continue
      try {
        const dir = this.#folder(name)
        const file = this.#regular(dir, 'task.json')
        if (lstatSync(file).size > 2000000) continue
        const task = JSON.parse(readFileSync(file, 'utf8'))
        if (task.id !== name || !['plan', 'audit'].includes(task.mode) || !Array.isArray(task.events)) continue
        this.tasks.set(name, task)
        if (['running', 'queued'].includes(task.status)) {
          task.status = 'interrupted'
          task.stage = '上次运行已中断，可继续'
          task.error = '工作台已重启，已保存的阶段可以继续执行'
          this.#save(task)
        }
      } catch (error) {
        // Invalid or linked task files are never exposed as tasks.
      }
    }
  }

  #redact(value) {
    let text = String(value || '')
    for (const secret of this.secrets) if (secret) text = text.split(secret).join('[已隐藏]')
    return text.replace(/sk-[A-Za-z0-9_-]{8,}|(?:api[_-]?key|authorization|auth[_-]?token)\s*[:=]\s*[^\s,;]+/gi, '[已隐藏]')
  }

  #folder(id) {
    if (!ID.test(String(id))) throw new Error('任务编号无效')
    const folder = join(this.root, id)
    if (lstatSync(folder).isSymbolicLink() || !lstatSync(folder).isDirectory() || dirname(realpathSync(folder)) !== this.root) throw new Error('任务目录无效')
    return folder
  }

  #regular(folder, name) {
    const path = join(folder, name)
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || dirname(realpathSync(path)) !== realpathSync(folder)) throw new Error('任务文件无效')
    return path
  }

  #save(task) {
    task.updatedAt = new Date().toISOString()
    const folder = this.#folder(task.id)
    const temp = join(folder, `.task-${randomUUID()}.json`)
    writeFileSync(temp, JSON.stringify(task, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    renameSync(temp, join(folder, 'task.json'))
  }

  #notify(task) {
    this.#save(task)
    try { this.onUpdate(this.#public(task)) }
    catch (error) { console.error('Blueprint 更新通知失败:', this.#redact(error.message)) }
  }

  #public(task) {
    const { spec, ...visible } = task
    return clone(visible)
  }

  #trace(phase, details = {}) {
    if (phase === 'preflight') this.lastProbe = { phase, startedAt: new Date().toISOString() }
    else this.lastProbe = { ...this.lastProbe, phase, ...details, updatedAt: new Date().toISOString() }
    this.lastProbe.elapsedMs = Date.now() - Date.parse(this.lastProbe.startedAt || new Date().toISOString())
    const temp = join(this.root, `.engine-status-${randomUUID()}.json`)
    try {
      writeFileSync(temp, JSON.stringify(this.diagnostics(), null, 2) + '\n', { flag: 'wx', mode: 0o600 })
      renameSync(temp, join(this.root, '.runtime-status.json'))
    } catch (error) { console.error('Blueprint 环境诊断保存失败:', this.#redact(error.message)) }
  }

  /** Return paths and subprocess lifecycle facts only, never configuration contents. */
  diagnostics() {
    return { root: this.root, engineRoot: this.engineRoot, python: this.python, bridgePath: this.bridgePath, configPath: this.configPath, lastProbe: clone(this.lastProbe) }
  }

  /** Return interpreter readiness and configuration presence, without credential values. */
  async status() {
    this.#trace('preflight')
    try {
      accessSync(this.python, constants.X_OK)
      this.#regular(this.engineRoot, 'LICENSE')
      this.#trace('credentials')
      const credentials = await this.getCredentials() || {}
      if (credentials.apiKey) this.secrets.add(credentials.apiKey)
      const result = await this.#probe(credentials)
      this.#trace('ready', { model: result.model, configured: result.configured })
      return { ...result, activeId: this.active?.id || null }
    } catch (error) {
      this.#trace('failed', { reason: this.#redact(error.message) })
      return { available: false, configured: false, model: '', activeId: this.active?.id || null, reason: this.#redact(error.message) }
    }
  }

  #probe(credentials) {
    return new Promise((resolveProbe, reject) => {
      this.#trace('spawning')
      const child = spawn(this.python, ['-I', this.bridgePath], { cwd: this.engineRoot, shell: false, env: privateEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] })
      this.#trace('spawned', { pid: child.pid || null })
      let output = '', errorText = '', ended = false
      const timer = setTimeout(() => { this.#trace('timed_out', { stdoutBytes: output.length, stderrBytes: errorText.length }); child.kill('SIGKILL'); reject(new Error('检查 Python 环境超时')) }, 10000)
      child.stdout.on('data', chunk => {
        if (output.length < 100000) output += chunk
        let bridgePhase = this.lastProbe.bridgePhase
        for (const line of output.split('\n')) {
          try { const event = JSON.parse(line); if (event.type === 'diagnostic') bridgePhase = String(event.phase || '').slice(0, 80) }
          catch (error) { /* Partial JSONL is parsed after the next chunk. */ }
        }
        this.#trace('stdout', { stdoutBytes: output.length, bridgePhase })
      })
      child.stderr.on('data', chunk => { if (errorText.length < 4000) errorText += chunk; this.#trace('stderr', { stderrBytes: errorText.length }) })
      child.stdin.on('error', () => { /* Child exit is reported by close. */ })
      child.once('error', error => { clearTimeout(timer); ended = true; this.#trace('spawn_error', { reason: this.#redact(error.message) }); reject(error) })
      child.once('close', (code, signal) => {
        clearTimeout(timer)
        this.#trace('exited', { exitCode: code, signal: signal || null, stdoutBytes: output.length, stderrBytes: errorText.length })
        if (ended) return
        try {
          const events = output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
          const status = events.find(event => event.type === 'status')
          if (code !== 0 || !status) throw new Error(events.find(event => event.type === 'error')?.message || errorText || 'Python 环境不可用')
          resolveProbe({ available: status.available === true, configured: status.configured === true, model: String(status.model || '') })
        } catch (error) { reject(error) }
      })
      child.once('exit', (code, signal) => { this.#trace('exit', { exitCode: code, signal: signal || null }) })
      child.stdin.end(JSON.stringify({ action: 'probe', engineRoot: this.engineRoot, configPath: this.configPath, credentials }) + '\n', () => this.#trace('input_sent', { inputSent: true }))
    })
  }

  /** List persisted tasks newest first. */
  list() { return [...this.tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(task => this.#public(task)) }

  /** Read one task by its generated UUID. */
  get(id) {
    if (!ID.test(String(id)) || !this.tasks.has(id)) throw new Error('找不到这个任务')
    this.#folder(id)
    return this.#public(this.tasks.get(id))
  }

  /** Return the user's original task input for an explicitly requested product workspace. */
  sourceInput(id) { this.get(id); const spec = this.tasks.get(id).spec; return spec.mode === 'plan' ? spec.input : spec.prdText || '检查已有项目：' + spec.projectPath }

  /** Start a plan or a static project audit; returns before the model call completes. */
  start(input) {
    if (this.active) throw new Error('请等待当前方案任务结束，或先停止它')
    const spec = inputSpec(input)
    const id = randomUUID()
    mkdirSync(join(this.root, id), { mode: 0o700 })
    const now = new Date().toISOString()
    const task = { id, title: spec.title, mode: spec.mode, status: 'running', stage: '准备运行环境', createdAt: now, updatedAt: now, events: [], reports: [], usage: {}, review: null, mock: spec.mock, attempts: 0, spec }
    this.tasks.set(id, task)
    this.#launch(task, false)
    return this.#public(task)
  }

  /** Resume a stopped task using only validated, unchanged cached stages. */
  resume(id) {
    this.get(id)
    if (this.active) throw new Error('请先等待当前方案任务结束')
    const task = this.tasks.get(id)
    if (!['cancelled', 'interrupted', 'failed'].includes(task.status)) throw new Error('这个任务无需续跑，请创建新任务')
    // Validate durable input on every resumed execution.
    task.spec = inputSpec(task.spec)
    task.status = 'running'
    task.error = null
    task.stage = '正在读取已保存的阶段'
    task.reports = []
    this.#launch(task, true)
    return this.#public(task)
  }

  #launch(task, resume) {
    let doneResolve
    const current = { id: task.id, child: null, cancelled: false, timedOut: false, result: null, error: '', done: new Promise(resolveDone => { doneResolve = resolveDone }), resolveDone: () => doneResolve(), stderr: '', closed: false }
    this.active = current
    task.attempts += 1
    this.#notify(task)
    current.timer = setTimeout(() => { current.timedOut = true; this.#kill(current) }, this.limits.deadlineMs)
    this.#run(task, resume, current).catch(error => {
      current.error = this.#redact(error.message)
      this.#finish(task, current, null, null)
    })
  }

  async #run(task, resume, current) {
    const credentials = await this.getCredentials() || {}
    if (credentials.apiKey) this.secrets.add(credentials.apiKey)
    if (current.cancelled || current.timedOut) { this.#finish(task, current, null, null); return }
    const child = spawn(this.python, ['-I', this.bridgePath], { cwd: this.engineRoot, shell: false, env: privateEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] })
    current.child = child
    let pending = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      pending += chunk
      if (pending.length > 1000000) { current.error = '引擎响应过长，任务已停止'; this.#kill(current); return }
      let index
      while ((index = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, index)
        pending = pending.slice(index + 1)
        if (line.trim()) {
          try { this.#event(task, current, JSON.parse(line, (_key, value) => typeof value === 'string' ? this.#redact(value) : value)) }
          catch (error) { current.error = '引擎返回格式错误'; this.#kill(current); return }
        }
      }
    })
    child.stderr.on('data', chunk => { current.stderr = this.#redact(current.stderr + chunk).slice(-4000) })
    child.stdin.on('error', () => { /* Child exit is reported by close. */ })
    child.once('error', error => { current.error = this.#redact(error.message) })
    child.once('close', (code, signal) => { this.#finish(task, current, code, signal) })
    child.stdin.end(JSON.stringify({ ...task.spec, resume, action: 'run', engineRoot: this.engineRoot, configPath: this.configPath, credentials, out: this.#folder(task.id), maxCalls: this.limits.maxCalls, maxTokens: this.limits.maxTokens, modelTimeout: this.limits.modelTimeout }) + '\n')
  }

  #event(task, current, event) {
    if (current.closed || current.cancelled || current.timedOut || event.type === 'diagnostic') return
    if (event.type === 'stage') task.stage = stages[event.stage] || String(event.stage || '处理中').slice(0, 100)
    if (event.type === 'progress') {
      task.stage = String(event.message || '').slice(0, 200).replace(/^\s*[▶↻]\s*/, '')
      task.events.push({ time: new Date().toISOString(), message: task.stage })
      task.events = task.events.slice(-100)
    }
    if (event.type === 'usage') task.usage = event.usage || {}
    if (event.type === 'error') current.error = String(event.message || '任务执行失败').slice(0, 2000)
    if (event.type === 'result') current.result = event
    this.#notify(task)
  }

  #finish(task, current, code, signal) {
    if (current.closed) return
    current.closed = true
    clearTimeout(current.timer)
    clearTimeout(current.killTimer)
    task.exitCode = code
    task.signal = signal
    task.timedOut = current.timedOut
    if (current.cancelled) {
      task.status = 'cancelled'; task.stage = '已停止，可继续'; task.error = null
    } else if (current.timedOut) {
      task.status = 'failed'; task.stage = '执行超时'; task.error = '任务已达到时间上限，已保存的阶段可以继续'
    } else if (code !== 0 || !current.result || current.error) {
      task.status = 'failed'; task.stage = '运行失败'; task.error = current.error || current.stderr || '引擎未生成完整结果'
    } else {
      try {
        const folder = this.#folder(task.id)
        const name = task.mode === 'plan' ? 'plan.json' : 'audit.json'
        const jsonFile = this.#regular(folder, name)
        if (lstatSync(jsonFile).size > 10000000) throw new Error('报告数据过大')
        const data = JSON.parse(readFileSync(jsonFile, 'utf8'))
        const review = data.review
        const issues = Array.isArray(review?.issues) ? review.issues : []
        const critical = issues.some(issue => ['high', 'critical', 'p0', 'p1'].includes(String(issue.severity).toLowerCase()))
        task.status = review?.ok !== true || critical ? 'needs_review' : 'completed'
        task.stage = task.status === 'needs_review' ? '已生成，请核对审稿意见' : '报告已生成'
        task.review = review || null
        task.usage = data.budget || {}
        task.summary = { title: data.title || task.title, unknowns: data.unknowns || data.intent?.unknowns || [], completion: data.completion ?? null }
        task.reports = REPORTS[task.mode].filter(report => {
          try { this.#regular(folder, report); return true }
          catch (error) { return false }
        }).map(report => ({ name: report }))
        if (!task.reports.some(report => report.name.endsWith('.md'))) throw new Error('未找到报告正文')
        task.error = null
      } catch (error) { task.status = 'failed'; task.stage = '报告读取失败'; task.error = this.#redact(error.message) }
    }
    if (this.active === current) this.active = null
    this.#notify(task)
    current.resolveDone()
  }

  #kill(current) {
    if (!current.child) return
    current.child.kill('SIGTERM')
    current.killTimer ||= setTimeout(() => { if (!current.closed) current.child.kill('SIGKILL') }, 2000)
  }

  /** Cancel and wait until the child has exited, preserving completed stage files. */
  async cancel(id) {
    this.get(id)
    if (this.active?.id !== id) return this.get(id)
    const current = this.active
    current.cancelled = true
    this.#kill(current)
    if (!current.child) this.#finish(this.tasks.get(id), current, null, null)
    await current.done
    return this.get(id)
  }

  /** Read one allowlisted generated report, refusing links and arbitrary paths. */
  readReport(id, name) {
    const task = this.get(id)
    if (!name || name === 'primary') name = REPORTS[task.mode][0]
    if (!REPORTS[task.mode].includes(name) || !task.reports.some(report => report.name === name)) throw new Error('报告名称无效')
    const file = this.#regular(this.#folder(id), name)
    if (lstatSync(file).size > 10000000) throw new Error('报告过大，请在文件夹中打开')
    return { name, content: this.#redact(readFileSync(file, 'utf8')) }
  }

  /** Resolve a known task folder for the main process native open action. */
  resolveFolder(id) { this.get(id); return this.#folder(id) }

  /** Stop owned child work before closing the application. */
  async close() { if (this.active) await this.cancel(this.active.id) }
}
