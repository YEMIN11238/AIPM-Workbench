/** Conservative trial accounting for the explicitly priced official DeepSeek routes. */
import { validateModelId, modelPricing } from './model-api.mjs'
export const VIDEO_TRIAL_LIMIT_YUAN = 5
export const VIDEO_TRIAL_MAX_REQUESTS = 3
export const VIDEO_MAX_OUTPUT_TOKENS = 6000
export const VIDEO_PROTOCOL_TOKEN_ALLOWANCE = 8192
const MICRO = 1000000

/** Validate the priced model and endpoint before creating any potentially billable request. */
export function pricedVideoApi(api) {
  try { validateModelId(api?.model) } catch (error) { throw new Error('无法核算当前模型的视频试做费用，仅支持已核价的 Flash 或 Pro，不会自动切换模型') }
  let base
  try { base = new URL(api.baseUrl) } catch (error) { throw new Error('无法核算当前模型端点的费用，未发送请求') }
  if (base.protocol !== 'https:' || base.hostname !== 'api.deepseek.com' || base.port && base.port !== '443' || base.username || base.password || base.search || base.hash || !['', '/', '/v1', '/v1/'].includes(base.pathname)) throw new Error('无法核算当前模型端点的费用，仅支持官方 DeepSeek HTTPS 端点，未发送请求')
  if (typeof api.apiKey !== 'string' || !api.apiKey.trim() || /[\r\n]/.test(api.apiKey)) throw new Error('请先在工作台设置中配置统一模型 API')
  return { model: api.model, apiKey: api.apiKey, endpoint: base.href.replace(/\/$/, '') + '/chat/completions' }
}

/** Reserve uncached peak-price input/output, with bytes bounding text tokens plus protocol margin. */
export function videoRequestQuote(body) {
  if (!body || body.max_tokens !== VIDEO_MAX_OUTPUT_TOKENS) throw new Error('视频请求不符合已核价的模型与输出上限')
  const pricing = modelPricing(body.model)
  const inputTokenUpperBound = Buffer.byteLength(JSON.stringify(body), 'utf8') + VIDEO_PROTOCOL_TOKEN_ALLOWANCE
  const outputTokenUpperBound = VIDEO_MAX_OUTPUT_TOKENS
  const reservedMicroYuan = inputTokenUpperBound * pricing.inputYuanPerMillion + outputTokenUpperBound * pricing.outputYuanPerMillion
  if (!Number.isSafeInteger(reservedMicroYuan)) throw new Error('请求过大，无法安全预留费用')
  return { inputTokenUpperBound, outputTokenUpperBound, reservedMicroYuan, reservedYuan: reservedMicroYuan / MICRO, pricing }
}

/** Derive retained reservation and conservative charged bounds from durable entries. */
export function videoBudgetTotals(entries, limitYuan) {
  const reservedMicro = entries.reduce((sum, entry) => sum + (entry.status === 'reserved' ? entry.reservedMicroYuan : 0), 0)
  const spentMicro = entries.reduce((sum, entry) => sum + (entry.status === 'reserved' ? 0 : entry.chargedUpperBoundMicroYuan ?? entry.reservedMicroYuan), 0)
  return { limitYuan, reservedYuan: reservedMicro / MICRO, spentUpperBoundYuan: spentMicro / MICRO, remainingYuan: Math.max(0, (Math.floor(limitYuan * MICRO) - reservedMicro - spentMicro) / MICRO) }
}

/** Settle only valid provider usage; unknown outcomes retain the complete reserved upper bound. */
export function settleVideoEntry(entry, usage, note) {
  const valid = usage && Number.isSafeInteger(usage.prompt_tokens) && usage.prompt_tokens >= 0 && Number.isSafeInteger(usage.completion_tokens) && usage.completion_tokens >= 0
  // Released Pro entries may predate the snapshot field. Never reprice them using today's selected model.
  const pricing = entry.pricing || (entry.model === 'deepseek-flash' ? null : { inputYuanPerMillion: 9, outputYuanPerMillion: 27 })
  const knownPrice = pricing && Number.isFinite(pricing.inputYuanPerMillion) && pricing.inputYuanPerMillion >= 0 && Number.isFinite(pricing.outputYuanPerMillion) && pricing.outputYuanPerMillion >= 0
  const observedMicro = valid && knownPrice ? usage.prompt_tokens * pricing.inputYuanPerMillion + usage.completion_tokens * pricing.outputYuanPerMillion : null
  const withinBound = valid && knownPrice && usage.prompt_tokens <= entry.inputTokenUpperBound && usage.completion_tokens <= entry.outputTokenUpperBound && Number.isSafeInteger(observedMicro)
  const chargedUpperBoundMicroYuan = withinBound ? observedMicro : Math.max(entry.reservedMicroYuan, Number.isSafeInteger(observedMicro) ? observedMicro : 0)
  return { ...entry, status: withinBound ? 'settled' : 'uncertain', chargedUpperBoundMicroYuan, chargedUpperBoundYuan: chargedUpperBoundMicroYuan / MICRO, ...(valid ? { usage: { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, ...(Number.isSafeInteger(usage.total_tokens) ? { total_tokens: usage.total_tokens } : {}) } } : {}), note: note || (withinBound ? '按供应商返回用量与高峰未缓存单价核算费用上界，实际账单可能更低' : '供应商用量缺失、越界或请求结果不明，整笔预留保留为支出上界，不退回可用预算'), finishedAt: new Date().toISOString() }
}
