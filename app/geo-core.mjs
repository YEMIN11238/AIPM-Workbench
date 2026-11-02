/** Deterministic GEO draft validation and customer-derived keyword suggestions. */
import { createHash } from 'node:crypto'
export const platforms = ['toutiao', 'sohu', 'zhihu', '36kr']
export const platformNames = { toutiao: '今日头条', sohu: '搜狐号', zhihu: '知乎', '36kr': '36氪' }
export const articleTypes = ['选择判断型', '认知科普型', '行业观察型', '案例成果型', '人物机构型']
export const profileFields = ['brand', 'industry', 'businessType', 'city', 'services', 'audience', 'objective', 'facts', 'avoid']
const limits = { brand: 80, industry: 80, businessType: 30, city: 100, services: 1000, audience: 1000, objective: 1000, facts: 12000, avoid: 1500 }
/** Normalize a renderer-submitted profile with bounded plain-text fields. */
export function normalizeProfile(input) {
  if (!input || typeof input !== 'object') throw new Error('请填写客户资料')
  const result = { demo: input.demo === true }
  for (const key of profileFields) {
    const value = input[key] ?? ''
    if (typeof value !== 'string' || value.length > limits[key]) throw new Error('客户资料格式无效或内容过长')
    result[key] = value.trim()
  }
  if (!['local', 'national', 'b2b'].includes(result.businessType)) result.businessType = 'local'
  return result
}
/** Parse user-provided claims and their source descriptions; no independent verification is implied. */
export function evidence(profile) {
  return profile.facts.split('\n').map(line => line.trim()).filter(Boolean).map((line, i) => {
    const [claim, ...source] = line.split('|')
    return { id: `F${String(i + 1).padStart(2, '0')}`, claim: claim.trim(), source: source.join('|').trim(), status: profile.demo ? '虚构演示' : '用户提供，未独立核验' }
  })
}
/** Report required input gaps before any model request. */
export function diagnose(profile) {
  const required = { brand: '品牌或机构名称', industry: '行业', city: '服务地区', services: '核心业务', audience: '目标用户', objective: '本轮目标' }
  const gaps = Object.entries(required).filter(([key]) => !profile[key]).map(([, label]) => label)
  const facts = evidence(profile)
  if (!facts.length || facts.some(item => !item.claim || !item.source)) gaps.push('至少一条事实及来源（每行：事实 | 来源）')
  return { ready: !gaps.length, gaps, evidence: facts }
}
/** Suggest words using the course's regional/business formulas, without claiming demand data. */
export function suggestKeywords(profile) {
  const diagnostic = diagnose(profile)
  if (!diagnostic.ready) throw new Error(`请先补充：${diagnostic.gaps.join('、')}`)
  const subjects = [...new Set(profile.services.split(/[\n,，;；、]+/).map(x => x.trim()).filter(Boolean))].slice(0, 3)
  const region = profile.businessType === 'national' ? '' : profile.city
  const words = subjects.flatMap(subject => profile.businessType === 'b2b' ? [`${region}${subject}供应商怎么选`, `${region}${subject}采购注意什么`, `${subject}交付案例怎么看`] : [`${region}${subject}怎么选`, `${region}${subject}服务流程`, `${subject}适合哪些人`])
  words.push(`${profile.brand}提供哪些服务`, `${profile.brand}服务范围`)
  return [...new Set(words)].map((text, i) => ({ id: `K${i + 1}`, text, selected: i < 6, intent: text.includes(profile.brand) ? '品牌信息' : '场景与比选' }))
}
/** Validate an editable keyword table against bounded user input. */
export function normalizeKeywords(input) {
  if (!Array.isArray(input) || input.length > 30) throw new Error('关键词最多 30 个')
  const rows = input.map((row, i) => {
    if (typeof row.text !== 'string' || !row.text.trim() || row.text.length > 100) throw new Error('关键词不能为空，且不超过 100 字')
    return { id: `K${i + 1}`, text: row.text.trim(), selected: row.selected === true, intent: '人工筛选' }
  })
  if (!rows.some(row => row.selected)) throw new Error('请至少选择一个关键词')
  return rows
}
/** Validate model or editor content before it can become an article draft. */
export function normalizeArticle(input) {
  if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 180 || typeof input.body !== 'string' || input.body.trim().length < 30 || input.body.length > 30000) throw new Error('文章结构不完整，请重试或补充正文')
  return { title: input.title.trim(), body: input.body.trim() }
}
/** Content digest binds manual review to the exact saved versions. */
export function contentHash(campaign) { return createHash('sha256').update(JSON.stringify({ profile: campaign.profile, keywords: campaign.keywords, topic: campaign.topic, article: campaign.article, variants: campaign.variants })).digest('hex') }
/** Course-inspired checks are writing hints, never legal or platform approval. */
export function inspectArticle(article, profile, platform = '') {
  const text = `${article.title}\n${article.body}`, issues = []
  if (/(保证涨薪|保就业|包就业|包过|100%治愈|稳赚|全国第一|行业第一)/.test(text)) issues.push({ level: 'block', message: '存在结果承诺或无依据的绝对化表达，请修改。' })
  if (/(客户资料显示|补充材料显示|实体链|关键词布局|豆包优化|GEO优化)/.test(text)) issues.push({ level: 'warning', message: '发现内部运营用语，请检查是否应出现在公开稿。' })
  if (platform === 'sohu' && /(TOP|排行榜|权威|首选|头部)/i.test(article.title)) issues.push({ level: 'warning', message: '标题触发课程中的搜狐写作提示，需人工核对。' })
  if (platform === 'sohu' && /1[3-9]\d{9}/.test(text)) issues.push({ level: 'warning', message: '搜狐版本含电话号码，请核对是否应删除。' })
  const refs = [...text.matchAll(/[\[（(](F\d+)[\]）)]/g)].map(match => match[1]), ids = new Set(evidence(profile).map(item => item.id))
  if (!refs.length) issues.push({ level: 'warning', message: '正文没有事实编号引用，请核对品牌结论的来源。' })
  if (refs.some(id => !ids.has(id))) issues.push({ level: 'block', message: '文章引用了客户档案中不存在的事实编号。' })
  if (profile.demo) issues.push({ level: 'warning', message: '虚构品牌示例，仅供演示，不可当作真实客户材料发布。' })
  issues.push({ level: 'warning', message: '事实真实性、平台实时规则及引用效果仍需人工核验。' })
  return issues
}
/** CSV fields are quoted and neutralize spreadsheet formula prefixes. */
export function csvCell(value) { const text = String(value ?? ''); return `"${(/^[=+@\-\t\r]/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"` }
