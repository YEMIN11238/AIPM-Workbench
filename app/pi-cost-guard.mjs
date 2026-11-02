/** Conservative request reservations for explicitly budgeted shared-model turns. */
import { modelPricing } from './model-api.mjs'

const MICRO = 1_000_000
const PROTOCOL_TOKENS = 8192

/** Estimate input from encoded bytes and reserve the bounded output at peak uncached prices. */
export function piRequestCostQuote(payload, model) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Number.isSafeInteger(payload.max_tokens) || payload.max_tokens <= 0) throw new Error('模型请求缺少可核算的输出上限')
  const pricing = modelPricing(model), inputTokenUpperBound = Buffer.byteLength(JSON.stringify(payload), 'utf8') + PROTOCOL_TOKENS, outputTokenUpperBound = payload.max_tokens
  const reservedMicroYuan = Math.ceil(inputTokenUpperBound * pricing.inputYuanPerMillion + outputTokenUpperBound * pricing.outputYuanPerMillion)
  if (!Number.isSafeInteger(reservedMicroYuan) || reservedMicroYuan < 0) throw new Error('请求费用无法安全预留')
  return { inputTokenUpperBound, outputTokenUpperBound, reservedMicroYuan, pricing }
}

/** Validate a positive CNY limit at micro-yuan precision. */
export function validatePiCostLimit(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 10000 || Math.abs(value * MICRO - Math.round(value * MICRO)) > 0.000001 || !Number.isSafeInteger(Math.round(value * MICRO))) throw new Error('本轮费用上限须为大于0且不超过10000元的数值，最多六位小数')
  return value
}

/** Keep unknown requests fully reserved; complete nonzero provider usage may settle below the quote. */
export function createPiCostGuard({ model, maxCostYuan }) {
  const limit = Math.round(validatePiCostLimit(maxCostYuan) * MICRO), pricing = modelPricing(model), entries = []
  const totals = () => entries.reduce((sum, entry) => {
    if (entry.status === 'reserved') sum.reserved += entry.reservedMicroYuan
    else sum.spent += entry.chargedUpperBoundMicroYuan
    if (entry.status === 'uncertain') sum.uncertain++
    return sum
  }, { reserved: 0, spent: 0, uncertain: 0 })
  const snapshot = () => {
    const total = totals(), accounted = total.reserved + total.spent
    return { currency: 'CNY', limitYuan: limit / MICRO, spentUpperBoundYuan: total.spent / MICRO, reservedYuan: total.reserved / MICRO, accountedUpperBoundYuan: accounted / MICRO, remainingYuan: Math.max(0, limit - accounted) / MICRO, uncertainRequests: total.uncertain, requests: entries.length, pricing, note: '高峰单价预留与费用估算上界，不是实际账单；中断或用量不明的请求保留整笔预留' }
  }
  function reserve(payload) {
    const quote = piRequestCostQuote(payload, model), total = totals()
    if (quote.reservedMicroYuan + total.reserved + total.spent > limit) {
      const cost = snapshot()
      throw Object.assign(new Error(`本轮模型费用预算为 ¥${cost.limitYuan}，剩余预留额度 ¥${cost.remainingYuan.toFixed(6)} 不足以覆盖下一次请求；已暂停，进度已保存。这不代表 API 余额用完，费用估算不是实际账单。`), { name: 'PiCostLimitError', kind: 'cost_limit', cost, requiredUpperBoundYuan: quote.reservedMicroYuan / MICRO })
    }
    entries.push({ ...quote, status: 'reserved' })
    return snapshot()
  }
  function settle(usage, { completed = true } = {}) {
    const entry = entries.find(row => row.status === 'reserved'); if (!entry) return snapshot()
    const keys = ['input', 'cacheRead', 'cacheWrite', 'output'], valid = completed && usage && keys.every(key => Number.isSafeInteger(usage[key]) && usage[key] >= 0) && keys.some(key => usage[key] > 0)
    let observed
    if (valid) observed = Math.ceil((usage.input + usage.cacheWrite) * pricing.inputYuanPerMillion + usage.cacheRead * pricing.cacheHitYuanPerMillion + usage.output * pricing.outputYuanPerMillion)
    const within = valid && Number.isSafeInteger(observed) && usage.input + usage.cacheRead + usage.cacheWrite <= entry.inputTokenUpperBound && usage.output <= entry.outputTokenUpperBound && observed <= entry.reservedMicroYuan
    entry.status = within ? 'settled' : 'uncertain'
    entry.chargedUpperBoundMicroYuan = within ? observed : Math.max(entry.reservedMicroYuan, Number.isSafeInteger(observed) ? observed : 0)
    return snapshot()
  }
  return { reserve, settle, snapshot }
}
