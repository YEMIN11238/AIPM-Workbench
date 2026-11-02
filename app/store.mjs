/** Personal project storage; all writes stay in the selected workbench root. */
import { mkdir, readFile, open, rename, link, unlink, readdir, realpath, lstat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'

export const stages = ['需求池', '竞品分析', 'MVP 范围', '立项报告', 'PRD']
const digest = text => createHash('sha256').update(text).digest('hex')
const versionIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const documentName = stage => `${String(stage + 1).padStart(2, '0')}-${stages[stage]}.md`
const text = (value, limit = 100000) => {
  if (typeof value !== 'string' || value.length > limit) throw new Error('输入内容无效或过长')
  return value
}

/** Owns serialized project changes and optimistic document updates. */
export class ProjectStore {
  constructor(root) { this.root = resolve(root); this.queue = Promise.resolve() }
  async init() { await mkdir(this.root, { recursive: true }); this.root = await realpath(this.root) }
  serial(action) {
    const result = this.queue.then(action)
    this.queue = result.catch(() => {}) // A rejected operation does not block subsequent edits.
    return result
  }
  async safe(...parts) {
    const target = resolve(this.root, ...parts)
    if (!target.startsWith(this.root + sep)) throw new Error('路径超出产品目录')
    let path = this.root
    for (const part of target.slice(this.root.length + 1).split(sep)) {
      path = join(path, part)
      try { if ((await lstat(path)).isSymbolicLink()) throw new Error('产品目录内不支持符号链接') }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    return target
  }
  async atomic(path, value, { replace = true, mode = 0o600 } = {}) {
    const temporary = `${path}.${randomUUID()}.tmp`
    const file = await open(temporary, 'wx', mode)
    let closed = false
    try {
      await file.writeFile(value)
      await file.close(); closed = true
      if (replace) await rename(temporary, path)
      else await link(temporary, path) // Exclusive publication never replaces an existing file.
    } finally {
      try { if (!closed) await file.close() }
      finally {
        try { await unlink(temporary) }
        catch (error) { if (error.code !== 'ENOENT') throw error } // Rename already removed the owned temporary.
      }
    }
  }
  async list() {
    const entries = await readdir(this.root, { withFileTypes: true })
    const projects = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const metadata = await this.safe(entry.name, '.aipm.json')
      try { const project = JSON.parse(await readFile(metadata, 'utf8')); projects.push(project) }
      catch (error) { if (error.code !== 'ENOENT') throw new Error(`读取产品 ${entry.name} 失败：${error.message}`) }
    }
    return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  async get(id) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('产品标识无效')
    const project = (await this.list()).find(item => item.id === id)
    if (!project) throw new Error('找不到产品')
    return project
  }
  async persist(project) {
    project.updatedAt = new Date().toISOString()
    await this.atomic(await this.safe(project.folder, '.aipm.json'), JSON.stringify(project, null, 2) + '\n')
    return project
  }
  create(name) { return this.serial(async () => {
    name = text(name, 80).trim()
    if (!name) throw new Error('请输入产品名称')
    const id = randomUUID()
    const folder = `${name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/^\.+/, '').slice(0, 60) || '产品'}-${id.slice(0, 8)}`
    await mkdir(await this.safe(folder, '产出物'), { recursive: true })
    const project = { id, name, folder, stage: 0, review: false, completed: false, confirmed: [], evidence: [], messages: [], documents: [], sessionId: `session-${id.replaceAll('-', '')}` }
    return this.persist(project)
  }) }
  mutate(id, action) { return this.serial(async () => { const project = await this.get(id); await action(project); return this.persist(project) }) }
  addEvidence(id, input) { return this.mutate(id, project => {
    const title = text(input.title, 300).trim(), content = text(input.content, 12000).trim(), source = text(input.source, 2000).trim()
    if (!title || !content) throw new Error('请填写证据名称和内容')
    if (!['provided', 'verified', 'hypothesis'].includes(input.kind)) throw new Error('证据类型无效')
    if (input.kind === 'verified' && !source) throw new Error('已核验证据需要填写来源')
    project.nextEvidence = (project.nextEvidence ?? 0) + 1
    project.evidence.push({ id: randomUUID(), code: `E${String(project.nextEvidence).padStart(2, '0')}`, title, content, source, kind: input.kind, stage: project.stage, createdAt: new Date().toISOString() })
  }) }
  removeEvidence(id, evidenceId) { return this.mutate(id, project => { project.evidence = project.evidence.filter(item => item.id !== evidenceId) }) }
  document(project, name) {
    text(name, 120)
    const stage = stages.findIndex((_value, index) => documentName(index) === name)
    if (stage < 0) throw new Error('文档名称无效')
    const document = project.documents.find(item => item.name === name)
    if (!document) throw new Error('文档不存在')
    if (document.stage !== stage) throw new Error('文档阶段记录无效')
    return { name, stage }
  }
  async readDocument(id, name) {
    const project = await this.get(id)
    this.document(project, name)
    const content = await readFile(await this.safe(project.folder, '产出物', name), 'utf8')
    return { content, hash: digest(content), name }
  }
  async archiveDocument(project, document, content) {
    text(content, 100001)
    const version = { formatVersion: 1, projectId: project.id, id: randomUUID(), ...document, createdAt: new Date().toISOString(), hash: digest(content), content }
    await mkdir(await this.safe(project.folder, '.history', String(document.stage)), { recursive: true, mode: 0o700 })
    const path = await this.safe(project.folder, '.history', String(document.stage), `${version.id}.json`)
    await this.atomic(path, JSON.stringify(version, null, 2) + '\n', { replace: false, mode: 0o400 })
  }
  async loadVersion(project, document, versionId) {
    if (typeof versionId !== 'string' || !versionIdPattern.test(versionId)) throw new Error('历史版本标识无效')
    const path = await this.safe(project.folder, '.history', String(document.stage), `${versionId}.json`)
    let version
    try { version = JSON.parse(await readFile(path, 'utf8')) }
    catch (error) {
      if (error.code === 'ENOENT') throw new Error('历史版本不存在')
      throw new Error(`读取历史版本失败：${error.message}`)
    }
    if (!version || version.formatVersion !== 1 || version.projectId !== project.id || version.id !== versionId
      || version.name !== document.name || version.stage !== document.stage
      || typeof version.createdAt !== 'string' || !Number.isFinite(Date.parse(version.createdAt))
      || new Date(version.createdAt).toISOString() !== version.createdAt
      || typeof version.hash !== 'string' || !/^[a-f0-9]{64}$/.test(version.hash)) throw new Error('历史版本数据无效')
    const content = text(version.content, 100001)
    if (digest(content) !== version.hash) throw new Error('历史版本内容校验失败')
    return { id: version.id, name: version.name, stage: version.stage, createdAt: version.createdAt, hash: version.hash, content }
  }
  /**
   * Lists immutable snapshots of the document's previous contents, newest first.
   * @param {string} id Product id.
   * @param {string} name Registered stage document filename.
   * @returns {Promise<Array<{id:string,name:string,stage:number,createdAt:string,hash:string}>>} Snapshot metadata without content.
   */
  async listVersions(id, name) {
    const project = await this.get(id), document = this.document(project, name)
    const directory = await this.safe(project.folder, '.history', String(document.stage))
    let entries
    try { entries = await readdir(directory) }
    catch (error) { if (error.code === 'ENOENT') return []; throw error }
    const versions = []
    for (const entry of entries) {
      if (!entry.endsWith('.json') || !versionIdPattern.test(entry.slice(0, -5))) continue
      const { content, ...metadata } = await this.loadVersion(project, document, entry.slice(0, -5))
      versions.push(metadata)
    }
    return versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  }
  /**
   * Reads a snapshot for a draft; it never changes the current document.
   * @param {string} id Product id.
   * @param {string} name Registered stage document filename.
   * @param {string} versionId Snapshot UUID returned by listVersions.
   * @returns {Promise<{id:string,name:string,stage:number,createdAt:string,hash:string,content:string}>} Verified snapshot and its content.
   */
  async readVersion(id, name, versionId) {
    const project = await this.get(id)
    return this.loadVersion(project, this.document(project, name), versionId)
  }
  saveDocument(id, input) { return this.mutate(id, async project => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('文档输入无效')
    const content = text(input.content).trim()
    if (!content) throw new Error('文档内容不能为空')
    const stage = input.stage ?? project.stage
    if (!Number.isInteger(stage) || stage < 0 || stage >= stages.length || stage > project.stage) throw new Error('文档阶段无效')
    const name = documentName(stage)
    const path = await this.safe(project.folder, '产出物', name)
    const existing = project.documents.find(item => item.name === name)
    if (existing) {
      const old = await readFile(path, 'utf8')
      if (input.hash !== digest(old)) throw new Error('文档已发生变化，请重新打开后编辑，避免覆盖外部修改')
      await this.archiveDocument(project, this.document(project, name), old)
      const current = await readFile(await this.safe(project.folder, '产出物', name), 'utf8')
      if (digest(current) !== input.hash) throw new Error('文档已发生变化，请重新打开后编辑，避免覆盖外部修改')
    } else {
      try { await lstat(path); throw new Error('目标文档已存在但未登记，无法覆盖，请先检查本地文件') }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    try { await this.atomic(await this.safe(project.folder, '产出物', name), content + '\n', { replace: !!existing }) }
    catch (error) {
      if (!existing && error.code === 'EEXIST') throw new Error('目标文档已存在但未登记，无法覆盖，请先检查本地文件')
      throw error
    }
    if (!existing) project.documents.push({ name, stage })
    if (stage === project.stage) project.review = !project.confirmed.includes(stage)
  }) }
  confirm(id) { return this.mutate(id, project => {
    if (!project.review || project.completed || !project.documents.some(item => item.stage === project.stage)) throw new Error('请先保存当前阶段文档，再确认')
    project.confirmed.push(project.stage)
    project.review = false
    if (project.stage === stages.length - 1) project.completed = true
    else project.stage++
  }) }
}
