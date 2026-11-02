/** Compact model-facing projections; desktop responses and saved research records stay untouched. */
const TEXT_LIMIT = 24000
const PROJECT_ACTIONS = new Set(['companyGet', 'companyCreate', 'companyPublish', 'companyAddMaterial'])

function fields(value, names) {
  const result = {}
  for (const name of names) if (value?.[name] !== undefined && (value[name] === null || ['string', 'number', 'boolean'].includes(typeof value[name]))) result[name] = value[name]
  return result
}

function lines(value, maximum = 20) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(0, maximum).map(item => item.slice(0, 1200)) : []
}

function audit(value, version = false) {
  if (!value || typeof value !== 'object') return null
  const errors = [...lines(value.errors || value.report?.errors, version ? 6 : 20), ...lines(value.hostMetadataIssues, version ? 6 : 20)]
  const warnings = lines(value.warnings || value.report?.warnings, version ? 6 : 20)
  const result = { ...fields(value, ['passed', 'exitCode', 'signal', 'version', 'checkedAt']), errors: [...new Set(errors)], warnings }
  if (!errors.length && !warnings.length && typeof value.output === 'string' && value.output.trim()) result.diagnostic = value.output.slice(0, version ? 1200 : 4000)
  return result
}

function source(value) {
  return fields(value, ['id', 'title', 'url', 'requestedUrl', 'fetchedAt', 'accessedAt', 'publishedAt', 'publisher', 'contentType', 'wordCount', 'path', 'pdfPath', 'kind', 'truncated', 'readable', 'warning'])
}

function material(value) { return fields(value, ['id', 'name', 'path', 'addedAt', 'size', 'kind']) }

function project(value) {
  const result = fields(value, ['id', 'subject', 'name', 'mode', 'depth', 'asOf', 'region', 'competitors', 'purpose', 'website', 'chatId', 'status', 'createdAt', 'updatedAt', 'model', 'versionCount'])
  if (result.status === undefined && typeof value?.chat?.status === 'string') result.status = value.chat.status
  if (value?.draft) result.draft = fields(value.draft, ['name', 'path', 'exists', 'size'])
  if (Array.isArray(value?.sources)) result.sources = value.sources.map(source)
  if (Array.isArray(value?.materials)) result.materials = value.materials.map(material)
  if (Array.isArray(value?.versions)) result.versions = value.versions.map(item => ({ ...fields(item, ['version', 'name', 'createdAt', 'markdownPath', 'htmlPath', 'sha256']), audit: audit(item.audit, true) }))
  if (value?.lastAudit) result.lastAudit = audit(value.lastAudit)
  return result
}

function excerpt(value, key) {
  const full = typeof value?.[key] === 'string' ? value[key] : ''
  return { [key]: full.slice(0, TEXT_LIMIT), excerpted: full.length > TEXT_LIMIT, fullContentChars: full.length, ...(full.length > TEXT_LIMIT ? { excerptNote: '本次仅返回前 24,000 字符，完整正文已归档在 path 指向的本机文件。请用 read 的 offset/limit 或 grep 继续查阅；摘录不表示后文已读完。' } : {}) }
}

/**
 * Remove recursive chat history and large presentation scripts from Pi tool responses.
 * @param {string} action Workbench method name.
 * @param {*} result Original desktop service result, never mutated.
 * @returns {*} Compact research result, or the original value for unrelated methods.
 */
export function companyModelResult(action, result) {
  if (result === null || result === undefined) return result
  if (PROJECT_ACTIONS.has(action)) {
    if (result.project) return { project: project(result.project), ...(result.audit ? { audit: audit(result.audit) } : {}) }
    return project(result)
  }
  if (action === 'companyList' && Array.isArray(result)) return result.map(project)
  if (action === 'companyFetch') return { ...source(result), ...excerpt(result, 'text'), ...(Array.isArray(result.links) ? { links: result.links.map(item => fields(item, ['title', 'url'])) } : {}) }
  if (action === 'companyRead') {
    const metadata = fields(result, ['name', 'path', 'kind', 'version'])
    if (result.kind === 'html' || typeof result.name === 'string' && /\.html?$/i.test(result.name)) return { ...metadata, kind: 'html', contentOmitted: true, note: 'HTML 是展示文件，脚本源码不返回模型。请通过 path 预览文件，或读取同版本 Markdown 获取报告正文。', audit: audit(result.audit) }
    return { ...metadata, content: typeof result.content === 'string' ? result.content : '', audit: audit(result.audit), sources: (result.sources || []).map(source), materials: (result.materials || []).map(material) }
  }
  if (action === 'companyReadLibrary') return { ...fields(result, ['name', 'path']), ...excerpt(result, 'content') }
  if (action === 'companyLibrary' && Array.isArray(result)) return result.map(item => fields(item, ['name', 'path', 'size', 'kind']))
  return result
}
