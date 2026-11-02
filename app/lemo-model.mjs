/** Compact Pi-only Lemo results; renderer responses and saved source files stay complete. */
import { isAbsolute, resolve } from 'node:path'

const TEXT_LIMIT = 24000, LOG_LIMIT = 6000, FILE_LIMIT = 200
const PROJECT_FIELDS = ['schema', 'id', 'title', 'style', 'mode', 'duration', 'width', 'height', 'fps', 'cwd', 'chatId', 'status', 'createdAt', 'updatedAt', 'onlineVoiceConsent']
const JOB_FIELDS = ['id', 'projectId', 'operation', 'status', 'logPath', 'exitCode', 'signal', 'createdAt', 'startedAt', 'finishedAt']

function fields(value, names) {
  const result = {}
  for (const name of names) if (value?.[name] !== undefined && (value[name] === null || ['string', 'number', 'boolean'].includes(typeof value[name]))) result[name] = value[name]
  return result
}

function jobIndex(value, { details = false } = {}) {
  if (!value || typeof value !== 'object') return value
  const result = fields(value, JOB_FIELDS)
  if (details && typeof value.error === 'string') result.error = value.error.slice(0, 2000)
  if (value.progress && typeof value.progress === 'object') {
    result.progress = fields(value.progress, ['phase', 'ratio'])
    if (details && typeof value.progress.message === 'string') result.progress.message = value.progress.message.slice(0, 2000)
  }
  if (Array.isArray(value.files)) result.fileCount = value.files.length
  return result
}

function project(value, { prompt = false, list = false } = {}) {
  if (!value || typeof value !== 'object') return value
  const result = fields(value, PROJECT_FIELDS)
  if (!list && typeof value.brief === 'string') result.brief = value.brief
  if (!list && value.source) result.source = fields(value.source, ['repository', 'commit', 'license'])
  if (prompt && typeof value.prompt === 'string') result.prompt = value.prompt
  const jobs = Array.isArray(value.jobs) ? [...value.jobs] : []
  if (value.currentJob && !jobs.some(job => job?.id === value.currentJob.id)) jobs.push(value.currentJob)
  result.jobs = jobs.map(value => jobIndex(value))
  result.jobCount = jobs.length
  const latest = value.currentJob || jobs.at(-1)
  if (latest?.id) result.currentJobId = latest.id
  return result
}

function absoluteLogPath(job, service) {
  if (typeof job.logPath !== 'string' || !job.logPath) return undefined
  if (isAbsolute(job.logPath)) return resolve(job.logPath)
  return service?.folder && job.projectId ? resolve(service.folder(job.projectId), job.logPath) : undefined
}

function job(value, service) {
  if (!value || typeof value !== 'object') return value
  const result = jobIndex(value, { details: true }), full = typeof value.log === 'string' ? value.log : ''
  result.log = full.slice(-LOG_LIMIT)
  result.logExcerpted = full.length > LOG_LIMIT
  result.fullLogChars = full.length
  const path = absoluteLogPath(value, service)
  if (path) result.fullLogPath = path
  if (result.logExcerpted) result.logExcerptNote = '仅返回日志末尾 6,000 字符；完整日志保存在 fullLogPath/logPath。请用 read 的 offset/limit 或 grep 查阅未返回的部分。'
  return result
}

function readPath(value, service, args) {
  const input = typeof args[0] === 'string' ? { path: args[0] } : args[0] || {}
  let path = typeof value.path === 'string' ? value.path : input.path
  if (typeof path !== 'string' || !path) return undefined
  if (isAbsolute(path)) return resolve(path)
  let base
  if (input.projectId && service?.folder) base = service.folder(input.projectId)
  else if (typeof input.path === 'string' && input.path.startsWith('custom/')) { base = service?.customRoot; if (path.startsWith('custom/')) path = path.slice(7) }
  else base = service?.sourceRoot
  return typeof base === 'string' ? resolve(base, path) : undefined
}

function read(value, service, args) {
  const full = typeof value.text === 'string' ? value.text : '', result = fields(value, ['path', 'kind'])
  result.text = full.slice(0, TEXT_LIMIT)
  result.excerpted = full.length > TEXT_LIMIT
  result.fullContentChars = full.length
  const path = readPath(value, service, args)
  if (path) result.fullPath = path
  if (result.excerpted) result.excerptNote = '仅返回正文前 24,000 字符；完整文件保存在 fullPath。请用 read 的 offset/limit 或 grep 继续查阅，摘录不表示后文已经读完。'
  return result
}

function output(value) {
  const files = Array.isArray(value.files) ? value.files : []
  const result = { files: files.slice(0, FILE_LIMIT).map(file => fields(file, ['path', 'name', 'kind', 'size'])), totalFiles: files.length, omittedFiles: Math.max(0, files.length - FILE_LIMIT) }
  if (value.lastVideo) result.lastVideo = fields(value.lastVideo, ['path', 'duration', 'width', 'height', 'fps', 'audio'])
  if (Array.isArray(value.diagnostics)) {
    result.diagnostics = value.diagnostics.slice(0, FILE_LIMIT).map(item => ({ ...fields(item, ['path']), ...(typeof item?.message === 'string' ? { message: item.message.slice(0, 1000) } : {}) }))
    result.omittedDiagnostics = Math.max(0, value.diagnostics.length - FILE_LIMIT)
  }
  if (result.omittedFiles) result.fileExcerptNote = '文件索引仅返回前 200 项，省略数量见 omittedFiles；完整文件保留在工程中，可用 ls/find 查看。'
  return result
}

/**
 * Project Lemo tool data for the model after the service has validated access.
 * @param {string} action Workbench method name; other methods retain their original result.
 * @param {*} result Complete service value, never mutated.
 * @param {{service?:object,args?:Array}} options Lemo service roots/folder resolver and original positional arguments for full text paths.
 * @returns {*} Metadata, a bounded log/text excerpt, a bounded file index, or the original unrelated value.
 */
export function lemoModelResult(action, result, { service, args = [] } = {}) {
  if (result === null || result === undefined || typeof result !== 'object') return result
  if (action === 'lemoList' && Array.isArray(result)) return result.map(value => project(value, { list: true }))
  if (action === 'lemoGet') return project(result)
  if (action === 'lemoPrepare') return project(result, { prompt: true })
  if (action === 'lemoCancel') return Array.isArray(result.jobs) || result.currentJob ? project(result) : job(result, service)
  if (action === 'lemoJob' || action === 'lemoRun') return job(result, service)
  if (action === 'lemoRead') return read(result, service, args)
  if (action === 'lemoOutput') return output(result)
  return result
}
