/** Complete starter-kit workflow, executable coding turns, evidence and human stage gates. */
import { spawn } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, lstatSync, realpathSync, existsSync, copyFileSync } from 'node:fs'
import { join, resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { piPackage, nodeExecutable } from './pi-service.mjs'
import { runLocalCommand } from './local-command.mjs'
import { completeWithSharedApi } from './model-api.mjs'
import { validateCommand, validateDecisions, validateStageReport } from './pi-runtime-policy.mjs'
import { resolveExecutionLimits } from './pi-execution-limits.mjs'

export const starterPhases = ['PRD 体检', '技术适配', '后端 MVP', '正式前端', '上线部署', '收尾']
const ID = /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/
const clone = value => structuredClone(value)
const digest = value => createHash('sha256').update(value).digest('hex')
const omit = new Set(['.git', '.venv', 'node_modules', '__pycache__', '.next', '.starter', '.env', 'SOURCE.json'])
const commonManual = 'docs/手册/AI产品Vibe Coding通用技术栈手册.md'
const frontManual = 'docs/手册/AI产品Vibe Coding通用前端技术栈手册.md'
const deployManual = 'docs/手册/AI产品 Vibe Coding 通用上线部署手册.md'

/** Resolve visible paths without following links or reading credentials. */
function safe(base, name, missing = false) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.split('/').some(x => !x || x === '..' || x === '.')) throw new Error('项目文件路径无效')
  const path = resolve(base, name)
  if (!path.startsWith(base + '/')) throw new Error('文件不在当前项目内')
  let current = base
  for (const part of name.split('/')) { current = join(current, part); if (existsSync(current)) { if (lstatSync(current).isSymbolicLink()) throw new Error('项目文件不能为符号链接') } else if (!missing) throw new Error('文件尚未生成') }
  return path
}

/** Persist all six phases and own one model worker; no total-runtime deadline applies by default. */
export class StarterService {
  constructor({ root, kitRoot, python, getApi, getCloudCredentials = () => ({}), onUpdate = () => {}, preview, workerPath, manualsRoot, deadlineMs = null, executionLimits = {} }) {
    if (deadlineMs !== null && (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > 2147483647)) throw new Error('任务时限须为正整数毫秒，或设为null表示不限制总时长')
    mkdirSync(root, { recursive: true, mode: 0o700 }); if (lstatSync(root).isSymbolicLink()) throw new Error('开发目录不能为链接')
    this.root = realpathSync(root); this.kitRoot = realpathSync(kitRoot); this.python = python; this.getApi = getApi; this.getCloudCredentials = getCloudCredentials; this.onUpdate = onUpdate; this.preview = preview; this.deadlineMs = deadlineMs
    this.usePi = !workerPath; this.manualsRoot = manualsRoot; this.workerPath = workerPath || fileURLToPath(new URL('./pi-worker.mjs', import.meta.url)); this.active = null; this.closed = false; this.secrets = new Set()
    this.executionLimits = resolveExecutionLimits(executionLimits)
    this.source = JSON.parse(readFileSync(join(this.kitRoot, 'SOURCE.json'), 'utf8'))
    for (const p of this.list()) if (p.status === 'running' || p.status === 'waiting') { const project = this.#load(p.id); project.status = 'interrupted'; project.pending = null; project.error = '上次执行已中断，已保存文件和对话保留，可以继续。'; this.#save(project) }
  }
  #folder(id) { if (!ID.test(id || '')) throw new Error('开发项目编号无效'); return safe(this.root, id) }
  #workspace(id) { return safe(this.#folder(id), 'workspace') }
  #load(id) { const p = JSON.parse(readFileSync(safe(this.#folder(id), 'project.json'), 'utf8')); p.rubric ||= ['覆盖要求', '结构合规', '语言质量', '事实无误', '长度合适']; return p }
  #clean(value) { let text = String(value || ''); for (const secret of this.secrets) if (secret) text = text.split(secret).join('[已隐藏]'); return text }
  #atomic(path, text) { const temp = join(dirname(path), '.save-' + randomUUID()); writeFileSync(temp, text, { flag: 'wx', mode: 0o600 }); renameSync(temp, path) }
  #save(project) { project.updatedAt = new Date().toISOString(); this.#atomic(join(this.#folder(project.id), 'project.json'), JSON.stringify(project, null, 2) + '\n'); this.#writeStatus(project) }
  #writeStatus(p) {
    const status = `# 项目状态\n\n## 当前阶段\n\n${p.phase} · ${starterPhases[p.phase]}\n\n## 决策台账\n\n| 问题 | 答案 | 状态 |\n|---|---|---|\n${p.decisions.map(x => `| ${x.question.replaceAll('|', '/')} | ${x.answer.replaceAll('|', '/')} | ${x.status} |`).join('\n')}\n\n## 待确认问题\n\n${(p.report?.unresolved || []).map(x => '- ' + x).join('\n') || '见当前阶段对话。'}\n\n## 阶段历史\n\n${p.history.map(x => `- ${starterPhases[x.phase]}：${x.confirmedAt} 人工确认`).join('\n')}\n`
    this.#atomic(join(this.#workspace(p.id), 'docs/项目状态.md'), status)
    const samples = '# 真实样例与人工评分\n\n维度：' + (p.rubric || []).join('、') + '；每项 1–3 分，另标记不能接受的样例。\n\n' + p.samples.map((s, i) => `## 样例 ${i + 1}\n\n输入：${s.input}\n\n输出：${s.output}\n\n人工评分：${p.ratings[s.id] ? JSON.stringify(p.ratings[s.id]) : '尚未评分'}\n`).join('\n')
    this.#atomic(join(this.#workspace(p.id), 'docs/样例评分.md'), samples)
  }
  #notify(p) { this.#save(p); try { this.onUpdate(this.get(p.id)) } catch (error) { console.error('开发流程更新通知失败', this.#clean(error.message)) } }
  /** List projects without reading user code or secrets. */
  list() { return readdirSync(this.root).filter(id => ID.test(id)).flatMap(id => { try { const p = this.#load(id); return [{ id, name: p.name, phase: p.phase, status: p.status, createdAt: p.createdAt, updatedAt: p.updatedAt, linkedProductId: p.linkedProductId }] } catch (error) { return [] } }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }
  /** Create a full original-kit project and preserve its source files. */
  create({ name, idea = '', prd = '', linkedProductId = null, demo = false }) {
    if (typeof name !== 'string' || !name.trim() || typeof idea !== 'string' || typeof prd !== 'string' || idea.length + prd.length > 150000) throw new Error('请填写产品名和有效需求')
    const id = randomUUID(), folder = join(this.root, id), workspace = join(folder, 'workspace')
    mkdirSync(workspace, { recursive: true, mode: 0o700 })
    for (const [file, expected] of Object.entries(this.source.files)) { const src = safe(this.kitRoot, file), bytes = readFileSync(src); if (digest(bytes) !== expected) throw new Error('工具包原始文件已被修改'); const dest = safe(workspace, file, true); mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, bytes, { mode: 0o600 }) }
    for (const name of ['docs/阶段文档', 'docs/evidence', '.starter/runs', '.starter/home']) mkdirSync(join(workspace, name), { recursive: true, mode: 0o700 })
    if (prd || idea) writeFileSync(join(workspace, 'docs/PRD/PRD.md'), prd || `# ${name}\n\n## 用户原始需求\n\n${idea}\n`, { mode: 0o600 })
    const p = { schemaVersion: 1, id, name: name.trim().slice(0, 100), phase: 0, status: 'idle', createdAt: new Date().toISOString(), messages: [], decisions: [], report: null, history: [], samples: [], rubric: ['覆盖要求', '结构合规', '语言质量', '事实无误', '长度合适'], ratings: {}, evidence: [], commands: [], runs: [], pending: null, completed: false, linkedProductId, demo }
    this.#installManuals(workspace); this.#save(p); return this.get(id)
  }
  #installManuals(workspace) { if (!this.manualsRoot) return; const source = JSON.parse(readFileSync(join(this.manualsRoot, 'SOURCE.json'), 'utf8')); for (const name of Object.keys(source.files)) { const dest = join(workspace, 'docs/手册/用户提供', name); mkdirSync(dirname(dest), { recursive: true }); if (!existsSync(dest)) copyFileSync(join(this.manualsRoot, name), dest) } }
  #files(id) {
    const base = this.#workspace(id), result = []
    const walk = (folder, prefix = '') => { for (const name of readdirSync(folder)) { if (omit.has(name) || name.startsWith('.') && name !== '.env.example') continue; const path = join(folder, name), stat = lstatSync(path); if (stat.isSymbolicLink()) continue; if (stat.isDirectory() && result.length < 500) walk(path, prefix + name + '/'); else if (stat.isFile() && result.length < 500) result.push({ name: prefix + name, size: stat.size }) } }
    walk(base); return result.sort((a, b) => a.name.localeCompare(b.name))
  }
  /** Read current stage, chat, results and evidence; credentials are never included. */
  get(id) { return { ...this.#load(id), files: this.#files(id), active: this.active?.id === id, preview: this.preview?.list(id) || [], phaseName: starterPhases[this.#load(id).phase] } }
  /** Read visible source, reports or screenshot bytes by project identity. */
  read(id, name) {
    if (typeof name !== 'string') throw new Error('文件名无效')
    if (name.split('/').some(p => omit.has(p) || p.startsWith('.') && p !== '.env.example')) throw new Error('此文件不可读取')
    const path = safe(this.#workspace(id), name)
    if (lstatSync(path).size > 5000000) throw new Error('文件过大，请在本地打开')
    if (/\.(png|jpe?g|webp)$/.test(name)) return { name, image: 'data:image/' + (extname(name) === '.png' ? 'png' : 'jpeg') + ';base64,' + readFileSync(path).toString('base64') }
    if (/\.(pdf|docx|zip)$/.test(name)) throw new Error('二进制资料已导入，可在对话中要求提取内容')
    return { name, content: this.#clean(readFileSync(path, 'utf8')) }
  }
  /** Read the complete unchanged kit, including all three manuals. */
  library() { return Object.keys(this.source.files).map(name => ({ name })) }
  readLibrary(name) { if (!Object.hasOwn(this.source.files, name)) throw new Error('工具包文件无效'); return { name, content: readFileSync(safe(this.kitRoot, name), 'utf8') } }
  /** Store an actual user-requested preview screenshot as project evidence. */
  async capture(id, url, mobile) { if (this.active?.id === id) throw new Error('请在本轮结束后截图'); const p = this.#load(id), result = await this.preview.capture(id, this.#workspace(id), { url, mobile, phase: p.phase }); p.evidence.push({ ...result, phase: p.phase, createdAt: new Date().toISOString() }); this.#notify(p); return result }
  /** Import a native-selected PRD without executing its contents. */
  importPrd(id, source) {
    if (this.active?.id === id) throw new Error('请等待当前操作结束')
    const ext = extname(source).toLowerCase()
    if (!['.md', '.txt', '.pdf', '.docx'].includes(ext) || lstatSync(source).size > 20000000 || lstatSync(source).isSymbolicLink()) throw new Error('支持 20MB 内的 Markdown、文本、PDF 或 Word')
    const path = `docs/PRD/导入-${randomUUID()}${ext}`; copyFileSync(source, join(this.#workspace(id), path)); return this.get(id)
  }
  #manual(phase) {
    const read = name => readFileSync(safe(this.kitRoot, name), 'utf8')
    let manual = read(commonManual)
    if (phase === 0) manual = manual.slice(manual.indexOf('## 二、与 PRD'), manual.indexOf('## 三、默认后端'))
    if (phase === 1) manual = manual.slice(manual.indexOf('# 第一部分'), manual.indexOf('# 第二部分'))
    if (phase === 2) manual = manual.slice(manual.indexOf('# 第二部分'), manual.indexOf('# 第四部分'))
    if (phase === 3) manual = read(frontManual)
    if (phase === 4) manual = read(deployManual)
    if (phase === 5) manual = read(deployManual).slice(read(deployManual).indexOf('# 第七部分'))
    let supplemental = ''; if (this.manualsRoot) { const files = Object.keys(JSON.parse(readFileSync(join(this.manualsRoot, 'SOURCE.json'), 'utf8')).files); const file = files.find(name => name.startsWith(phase === 3 ? '2.' : phase >= 4 ? '3.' : '1.')); let content = readFileSync(join(this.manualsRoot, file), 'utf8'); if (phase < 2) content = content.slice(0, content.indexOf('# 第二部分')); else if (phase === 2) content = content.slice(content.indexOf('# 第二部分'), content.indexOf('# 第四部分')); supplemental = '\n这三份手册共同构成一个AI产品开发功能，覆盖后端、前端、部署；保留原包的PRD体检、人工评分与闸门。当前阶段补充手册：\n' + content }
    return read('AGENTS.md') + supplemental + '\n\n' + read('docs/PRD/PRD模板.md') + '\n\n' + manual
  }
  /** Start an actual coding-agent turn, not a text-only chat completion. */
  send(id, prompt) {
    if (this.closed || this.active) throw new Error('请等待当前开发操作结束，或先停止')
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 18000) throw new Error('请输入 18000 字以内的消息')
    const api = this.getApi(); if (!api.apiKey) throw new Error('请先在统一 API 设置中配置密钥')
    this.secrets.add(api.apiKey)
    const p = this.#load(id); this.#installManuals(this.#workspace(id)); if (p.completed) throw new Error('当前流程已收尾，请查看历史或新建一轮产品')
    p.messages.push({ id: randomUUID(), role: 'user', phase: p.phase, content: prompt.trim(), time: new Date().toISOString() }, { id: randomUUID(), role: 'assistant', phase: p.phase, content: '', time: new Date().toISOString(), status: 'running' })
    p.status = 'running'; p.error = null; p.pending = null; p.report = null; p.pause = null
    const runId = randomUUID(), out = join(this.#workspace(id), '.starter/runs', runId); mkdirSync(out, { mode: 0o700 })
    const run = { id: runId, phase: p.phase, startedAt: new Date().toISOString(), usage: {}, tools: [], status: 'running' }; p.runs.push(run)
    let doneResolve
    const current = { id, project: p, run, out, controller: new AbortController(), child: null, children: new Set(), cancelled: false, timedOut: false, done: new Promise(resolve => { doneResolve = resolve }), doneResolve: () => doneResolve(), finished: false }
    this.active = current; this.#notify(p)
    current.api = api; current.tasks = new Set(); current.hostQueue = Promise.resolve()
    if (this.deadlineMs !== null) current.timer = setTimeout(() => { current.timedOut = true; this.#kill(current) }, this.deadlineMs)
    const cloud = p.phase >= 4 ? this.getCloudCredentials(id) : {}; current.cloud = cloud; Object.values(cloud).forEach(v => this.secrets.add(v))
    const system = `你是面向不懂代码产品经理的开发搭档。当前只能执行阶段 ${p.phase}：${starterPhases[p.phase]}。用户已授权使用这套工具包，不需要重复问是否启动。一次最多追问五个必要问题，给推荐和影响。所有文件操作只在当前项目。\n优先规则：共享模型配置由工作台提供，不能要求重复填 Key，不能把密钥写文件或日志。云凭证只来自工作台安全配置；手册里要求聊天粘贴密钥或泛开 FullAccess 的段落改为受控输入和按需授权。云资源创建、发布、删除经 request approval，由用户确认费用和命令后执行。\n可以实际读取、增量修改、测试和预览。先读 PRD、状态与已有代码再动手。不能伪造执行、截图、测试、真人打分或验收通过。report_stage 是建议报告，阶段推进由工作台确定性闸门与用户确认。真实样例需 5–10 条，由用户按不超过五个维度每项1–3分打分，并标记不能接受项；用 record_rubric 按产品类型设定维度，实际评分在 docs/样例评分.md，可读取后提炼验收标准；sample工具证明真实模型调用，不等于产品端到端测试。\n阶段0/1可以将效果标准等后续才验证的决策记为 deferred 并注明 revisitPhase=2，云资源在部署时确认可记 revisitPhase=4。只把当前阶段必须解决的问题放进 report_stage.unresolved，不能因未来事项造成阶段死锁。docs/项目状态.md 在每次事件后自动同步，不能直接改写；这不是错误或待解决项。report_stage 自动生成 docs/evidence/阶段N/验收说明.md，截图仍要实际 capture_preview，不能声称自动生成了截图。不能越阶段开发，不改原版规则和三份手册。不擅自替换本工作台；开发目标是当前项目中的产品。预览必须用 start_preview，截图用 capture_preview，不能在命令里用 & 启动无人管理服务。不得在网络、文件或命令中回显 API Key。生成的产品从环境 DEEPSEEK_API_KEY/OPENAI_API_KEY、OPENAI_BASE_URL、MODEL_ID 读取统一配置。\n每轮最后用简短中文说明实际做了什么、还缺什么、下一步用户怎么操作。\n\n原版当前阶段规则和手册：\n${this.#manual(p.phase)}`
    const request = { mode: 'starter', piPackage, sessionDir: join(this.#workspace(id), '.starter/pi', 'phase-' + p.phase), workspace: this.#workspace(id), out, phase: p.phase, api, cloudCredentials: cloud, system, prompt: `项目：${p.name}\n当前状态与已确认决策：\n${readFileSync(join(this.#workspace(id), 'docs/项目状态.md'), 'utf8')}\n用户本轮消息：\n${prompt}`, ...this.executionLimits }; run.limits = this.executionLimits
    this.#atomic(join(out, 'request.json'), JSON.stringify({ ...request, api: { ...api, apiKey: '[统一密钥，不落盘]' }, cloudCredentials: Object.keys(cloud) }, null, 2))
    const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG'].filter(k => process.env[k]).map(k => [k, process.env[k]])); env.PATH = '/Users/example/.local/node/bin:' + (env.PATH || '/usr/bin:/bin'); env.PYTHONUNBUFFERED = '1'; env.PYTHONDONTWRITEBYTECODE = '1'
    const child = spawn(this.usePi ? nodeExecutable : this.python, this.usePi ? [this.workerPath] : ['-I', this.workerPath], { cwd: this.#workspace(id), env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' }); current.child = child
    let pending = ''
    child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => {
      pending += chunk; if (pending.length > 3000000) { current.error = '执行消息过大'; this.#kill(current); return }
      let i
      while ((i = pending.indexOf('\n')) >= 0) { const line = pending.slice(0, i); pending = pending.slice(i + 1); if (!line.trim()) continue; try { const e = JSON.parse(this.#clean(line)); writeFileSync(join(out, 'events.jsonl'), JSON.stringify(e) + '\n', { flag: 'a', mode: 0o600 }); this.#event(current, e) } catch (error) { current.error = '执行消息无效'; this.#kill(current) } }
    })
    child.stderr.on('data', chunk => { current.stderr = this.#clean((current.stderr || '') + chunk).slice(-4000) })
    child.stdin.on('error', () => { /* close settles the run */ }); child.once('error', error => { current.error = this.#clean(error.message) }); child.once('close', (code, signal) => { void this.#finish(current, code, signal) }); child.stdin.write(JSON.stringify(request) + '\n')
    return this.get(id)
  }
  #event(current, e) {
    if (current.finished || current.cancelled || current.timedOut) return
    const p = current.project, reply = p.messages.at(-1)
    if (e.type === 'text') reply.content += (reply.content ? '\n\n' : '') + e.text
    if (e.type === 'progress') p.activity = e.message
    if (e.type === 'engine') current.run.engine = e
    if (e.type === 'tool') { current.run.tools.push(e.name); p.activity = ({ read_file: '读取项目资料', write_file: '保存文件', edit_file: '修改文件', run_command: '执行与测试', model_samples: '生成真实样例', capture_preview: '记录预览证据', start_preview: '启动本地预览' })[e.name] || '更新当前阶段' }
    if (e.type === 'child' && Number.isInteger(e.pid) && e.pid > 0) current.children.add(e.pid)
    if (e.type === 'usage') current.run.usage = e.usage
    if (e.type === 'limit') { if (typeof e.reason !== 'string' || !e.reason.trim() || !['call_limit','output_token_limit','input_token_limit'].includes(e.kind)) throw new Error('Pi暂停记录无效'); current.pause = {kind:e.kind,reason:e.reason,usage:e.usage || current.run.usage,limits:e.limits || this.executionLimits} }
    if (e.type === 'decisions') p.decisions = validateDecisions(e.items)
    if (e.type === 'report') { p.report = validateStageReport(e.report); this.#evidencePacket(p) }
    if (e.type === 'sample') p.samples.push({ ...e.sample, phase: p.phase, runId: current.run.id })
    if (e.type === 'command') p.commands.push({ ...validateCommand(e), phase: p.phase, runId: current.run.id, time: new Date().toISOString() })
    if (e.type === 'request') {
      const task = current.hostQueue.then(() => this.#request(current, e)); current.hostQueue = task.catch(error => { current.error = this.#clean(error.message); this.#kill(current) }); current.tasks.add(task); void task.finally(() => current.tasks.delete(task)).catch(() => {})
    }
    if (e.type === 'result') { current.result = e; if (!reply.content.trim()) reply.content = e.reply }
    if (e.type === 'error') current.error = e.message
    p.commands = p.commands.slice(-100); this.#notify(p)
  }
  async #approve(current, command, reason, token = randomUUID()) {
    if (current.finished || current.cancelled || current.timedOut) return false
    const answer = new Promise(resolve => { current.approval = { token, resolve } })
    current.project.pending = { token, command, reason }; current.project.status = 'waiting'; this.#notify(current.project)
    return answer
  }
  async #request(current, e) {
    if (current.finished || current.cancelled || current.timedOut) return
    let result, error
    try {
      if (e.kind === 'approval') result = await this.#approve(current, e.command, e.reason, e.token)
      else if (e.kind === 'run_api') {
        if (current.project.phase < 2) throw new Error('阶段2才开始运行产品代码')
        if (current.project.phase >= 4 && await this.#approve(current, e.command, '部署命令将获得当前项目云凭证，请核对目标与费用后执行') !== true) throw new Error('用户未批准此部署命令')
        result = await runLocalCommand({ ...e, workspace: this.#workspace(current.id), api: current.api, cloud: current.cloud, restrictWrites: true, signal: current.controller.signal, onChild: pid => current.children.add(pid) }); current.project.commands.push({ ...result, phase: current.project.phase, runId: current.run.id, time: new Date().toISOString() })
      } else if (e.kind === 'samples') {
        if (!Array.isArray(e.prompts) || !e.prompts.length || typeof e.system !== 'string' || e.system.length > 60000 || e.prompts.some(text => typeof text !== 'string' || !text.trim() || text.length > 18000) || e.prompts.length > Math.min(10, e.remainingCalls ?? 10)) throw new Error('样例数量超过当前预算')
        const samples = [], usage = { calls: 0, input_tokens: 0, output_tokens: 0 }
        let sampleError
        for (const input of e.prompts) { usage.calls++; try { const r = await completeWithSharedApi(current.api, [{ role: 'system', content: e.system }, { role: 'user', content: input }], { signal: current.controller.signal, maxTokens: 3000 }); const sample = { id: randomUUID(), input, output: r.text, source: 'real_shared_api', phase: current.project.phase, runId: current.run.id }; samples.push(sample); current.project.samples.push(sample); usage.input_tokens += r.usage.prompt_tokens || 0; usage.output_tokens += r.usage.completion_tokens || 0; this.#notify(current.project) } catch (failure) { sampleError = this.#clean(failure.message); break } }
        result = { samples, usage, ...(sampleError ? { error: sampleError } : {}) }
      } else if (e.kind === 'extract') {
        const path = safe(this.#workspace(current.id), e.path)
        result = (await promisify(execFile)(this.python, ['-I', fileURLToPath(new URL('./extract-document.py', import.meta.url)), path], { timeout: 30000, maxBuffer: 500000, signal: current.controller.signal, env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1' } })).stdout
      } else if (e.kind === 'workbench') throw new Error('当前开发阶段请使用项目工具；其他功能从主聊天进入')
      else if (e.kind === 'rubric') {
        const dimensions = e.dimensions; if (!Array.isArray(dimensions) || !dimensions.length || dimensions.length > 5 || dimensions.some(v => typeof v !== 'string' || !v.trim() || v.length > 40) || new Set(dimensions).size !== dimensions.length) throw new Error('评分维度须为1至5个不重复的名称')
        if (Object.keys(current.project.ratings).length && JSON.stringify(dimensions) !== JSON.stringify(current.project.rubric)) throw new Error('已有人工评分，不能自动改变维度；请保留当前评分标准')
        current.project.rubric = dimensions; result = dimensions
      } else if (!this.preview) throw new Error('预览服务未就绪')
      else if (e.kind === 'preview') result = await this.preview.start(current.id, this.#workspace(current.id), e, current.api)
      else if (e.kind === 'capture') {
        result = await this.preview.capture(current.id, this.#workspace(current.id), { ...e, phase: current.project.phase })
        current.project.evidence.push({ ...result, phase: current.project.phase, runId: current.run.id, createdAt: new Date().toISOString() })
      }
    } catch (exc) { error = this.#clean(exc.message) }
    if (current.finished || current.cancelled || !current.child || current.child.stdin.destroyed) return
    current.child.stdin.write(JSON.stringify({ token: e.token, result, error }) + '\n'); this.#notify(current.project)
  }
  /** Approve exactly the visible cloud command, never blanket future operations. */
  reply(id, token, approved) { const current = this.active; if (current?.id !== id || current.project.pending?.token !== token) throw new Error('此操作已失效'); current.project.pending = null; current.project.status = 'running'; if (current.approval?.token === token) { const approval = current.approval; current.approval = null; approval.resolve(approved === true) } else throw new Error('此确认已失效'); this.#notify(current.project); return this.get(id) }
  async #finish(current, code, signal) {
    if (current.finished) return
    current.finished = true; current.controller.abort(); current.approval?.resolve(false); clearTimeout(current.timer); clearTimeout(current.killTimer)
    for (const pid of [current.child?.pid, ...current.children]) if (pid && process.platform !== 'win32') { try { process.kill(-pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') console.error('停止开发子进程失败', error.code) } }
    if (current.cancelled || current.timedOut) { try { await this.preview?.stop?.(current.id) } catch (error) { current.error ||= this.#clean(error.message) } }
    await Promise.allSettled([...current.tasks])
    const p = current.project
    p.status = current.cancelled ? 'cancelled' : current.timedOut ? 'failed' : current.pause ? 'paused' : current.error || code !== 0 || !current.result ? 'failed' : 'idle'
    p.pause = p.status === 'paused' ? current.pause : null
    p.error = current.cancelled || p.status === 'paused' ? null : current.timedOut ? '达到本轮时间上限，已保存文件与进度。' : current.error || (p.status === 'failed' ? current.stderr || '开发执行未正常结束' : null)
    p.pending = null; p.messages.at(-1).status = p.status; Object.assign(current.run, { status: p.status, finishedAt: new Date().toISOString(), exitCode: code, signal, timedOut: current.timedOut })
    if (this.active === current) this.active = null
    try { this.#evidencePacket(p); this.#notify(p) } catch (error) { console.error('开发流程收尾记录失败', this.#clean(error.message)) } finally { current.doneResolve() }
  }
  #evidencePacket(p) {
    const dir = join(this.#workspace(p.id), 'docs/evidence', '阶段' + p.phase); mkdirSync(dir, { recursive: true })
    const text = `# ${starterPhases[p.phase]} · 证据包\n\n${p.report?.summary || '本轮尚未提交完整阶段报告。'}\n\n## 用户可验证入口\n\n${(this.preview?.list(p.id) || []).map(v => '- ' + v.url).join('\n') || p.report?.nextStep || '查看当前阶段对话中的操作步骤。'}\n\n## 建议是否表（需人工核验）\n\n| 检查项 | 建议状态 | 依据 |\n|---|---|---|\n${(p.report?.checks || []).map(x => `| ${x.item.replaceAll('|', '/')} | ${x.status} | ${x.evidence.replaceAll('|', '/')} |`).join('\n')}\n\n## 待解决事项\n\n${(p.report?.unresolved || []).map(x => '- ' + x).join('\n') || '请人工核对，不代表自动验收通过。'}\n`
    this.#atomic(join(dir, '验收说明.md'), text)
  }
  #kill(current) { current.controller.abort(); current.approval?.resolve(false); if (!current.child) return; try { process.kill(-current.child.pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') current.error = error.message }; current.killTimer ||= setTimeout(() => { if (!current.finished) { try { process.kill(-current.child.pid, 'SIGKILL') } catch (error) { /* close owns completion */ } } }, 1500) }
  /** Cancel and await the active worker and its commands. */
  async cancel(id) { if (this.active?.id === id) { const current = this.active; current.cancelled = true; this.#kill(current); await current.done } return this.get(id) }
  /** Save a human's original-kit rubric: 1–3 per dimension plus unacceptable flag. */
  rate(id, sampleId, input) {
    const p = this.#load(id), dimensions = p.rubric || ['覆盖要求', '结构合规', '语言质量', '事实无误', '长度合适']
    if (this.active?.id === id) throw new Error('请在本轮结束后打分')
    if (!p.samples.some(x => x.id === sampleId) || !input || !input.scores || typeof input.unacceptable !== 'boolean' || !dimensions.every(d => Number.isInteger(input.scores[d]) && input.scores[d] >= 1 && input.scores[d] <= 3)) throw new Error('请逐项打1–3分，并标记是否不能接受')
    p.ratings[sampleId] = { scores: Object.fromEntries(dimensions.map(d => [d, input.scores[d]])), unacceptable: input.unacceptable, comment: String(input.comment || '').slice(0, 1000), at: new Date().toISOString() }; this.#notify(p); return this.get(id)
  }
  #fingerprint(id) { const p = this.#load(id); return digest(JSON.stringify({ phase: p.phase, report: p.report, decisions: p.decisions, ratings: p.ratings, commands: p.commands, evidence: p.evidence }) + '\n' + this.#files(id).filter(f => f.name !== 'docs/项目状态.md').map(f => f.name + ':' + digest(readFileSync(safe(this.#workspace(id), f.name)))).join('\n')) }
  /** Human stage confirmation checks actual reports, commands, samples and screenshots before advancing. */
  advance(id, { confirmed, checks, comment = '', expectedHash }) {
    if (this.active?.id === id) throw new Error('请先结束当前开发操作')
    const p = this.#load(id)
    if (confirmed !== true || expectedHash !== this.#fingerprint(id)) throw new Error('文件已变更或尚未确认，请重新核对当前验收包')
    if (p.completed) throw new Error('此流程已收尾')
    if (!p.report || !p.report.checks?.length || p.report.unresolved?.length || p.decisions.some(x => x.status !== 'confirmed' && !(x.status === 'deferred' && Number.isInteger(x.revisitPhase) && x.revisitPhase > p.phase))) throw new Error('先在对话中解决待确认问题与决策，不能跳过阶段')
    if (p.report.checks?.some(x => ['no', 'pending'].includes(x.status))) throw new Error('阶段是否表仍有未通过项，请先修复')
    if (!checks || !['scope', 'evidence', 'functional', 'secrets', 'persistence'].every(k => checks[k] === true)) throw new Error('请逐项完成当前阶段的人工验收')
    if ([2, 3].includes(p.phase)) {
      if (!p.commands.some(c => c.phase === p.phase && c.exitCode === 0 && !c.timedOut && !c.aborted && /pytest|npm (?:run )?test|node --test|unittest/.test(c.command))) throw new Error('还没有本阶段实际通过的测试记录')
      const scored = p.samples.filter(s => s.phase === 2 && p.ratings[s.id])
      if (scored.length < 5) throw new Error('请先给至少五条真实模型样例评分')
      if (!p.commands.some(c => c.phase === 2 && c.exitCode === 0 && !c.timedOut && !c.aborted && c.usedSharedApi)) throw new Error('需要实际产品代码使用统一 API 的运行或测试记录，样例调用不能代替端到端测试')
      if (p.phase === 3 && (!p.evidence.some(e => e.phase === 3 && e.mobile) || !p.evidence.some(e => e.phase === 3 && !e.mobile))) throw new Error('请先生成桌面和移动端的真实预览截图')
    }
    p.history.push({ phase: p.phase, confirmedAt: new Date().toISOString(), checks, comment: String(comment).slice(0, 2000), hash: expectedHash })
    if (p.phase < 5) p.phase += 1; else p.completed = true
    p.report = null; p.status = 'idle'
    const history = join(this.#workspace(id), '.starter/history.json'); if (existsSync(history)) renameSync(history, join(this.#workspace(id), '.starter', 'history-before-phase-' + p.history.at(-1).phase + '-' + randomUUID() + '.json'))
    this.#notify(p); return this.get(id)
  }
  /** Return current file hash for a concrete, conflict-aware manual review. */
  review(id) { const p = this.get(id); return { hash: this.#fingerprint(id), phase: p.phase, report: p.report, decisions: p.decisions, sampleRatings: Object.keys(p.ratings).length } }
  /** Return the known local project folder for native opening. */
  folder(id) { return this.#workspace(id) }
  /** Stop callbacks and all owned work on application exit. */
  async close() { this.closed = true; this.onUpdate = () => {}; if (this.active) await this.cancel(this.active.id); await this.preview?.close() }
}
