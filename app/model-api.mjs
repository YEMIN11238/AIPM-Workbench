/** One model route and credential source for every desktop feature. */
import { readFileSync, writeFileSync, renameSync, existsSync, lstatSync, chmodSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'

const catalog = [
  { id: 'deepseek-v4-pro', label: 'Pro', name: 'DeepSeek V4 Pro', version: 'DeepSeek-V4-Pro-0813', vision: false, pricing: { currency: 'CNY', inputYuanPerMillion: 9, outputYuanPerMillion: 27, cacheHitYuanPerMillion: .3 } },
  { id: 'deepseek-flash', label: 'Flash（V4.1）', name: 'DeepSeek V4.1 Flash', version: 'DeepSeek-V4.1-Flash-1017', vision: true, pricing: { currency: 'CNY', inputYuanPerMillion: 2, outputYuanPerMillion: 8, cacheHitYuanPerMillion: .04 } },
]
export const MODEL_CATALOG = Object.freeze(catalog.map(value => Object.freeze({ ...value, pricing: Object.freeze({ ...value.pricing }) })))
export function validateModelId(model) { if (!MODEL_CATALOG.some(choice => choice.id === model)) throw new Error('请选择已支持的 Flash（V4.1）或 Pro 模型'); return model }
export function modelCapabilities(model = 'deepseek-v4-pro') { const choice = MODEL_CATALOG.find(choice => choice.id === validateModelId(model)); return { vision: choice.vision, input: choice.vision ? ['text', 'image'] : ['text'] } }
export function modelPricing(model) { const choice = MODEL_CATALOG.find(choice => choice.id === validateModelId(model)); return { ...choice.pricing, model, source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/', verifiedAt: '2026-10-26', basis: '官方高峰价；全部输入按未缓存估算上界，不是实际账单' } }

/** Persist only the shared model choice. Credentials stay in the existing main-process store. */
export class ModelSettings {
  constructor({ path }) {
    if (typeof path !== 'string' || !path) throw new Error('缺少模型设置路径')
    this.path = resolve(path); this.state = { schema: 1, model: 'deepseek-v4-pro' }
    if (existsSync(this.path)) {
      const stat = lstatSync(this.path)
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 10000) throw new Error('模型设置文件无效，未重置现有配置')
      const saved = JSON.parse(readFileSync(this.path, 'utf8'))
      if (saved.schema !== 1) throw new Error('模型设置版本无效，未重置现有配置')
      validateModelId(saved.model); this.state = { schema: 1, model: saved.model, ...(typeof saved.updatedAt === 'string' ? { updatedAt: saved.updatedAt } : {}) }
    }
  }
  get() { return { ...this.state, choices: structuredClone(MODEL_CATALOG) } }
  select(model) {
    validateModelId(model)
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    if (lstatSync(dirname(this.path)).isSymbolicLink() || existsSync(this.path) && (lstatSync(this.path).isSymbolicLink() || !lstatSync(this.path).isFile())) throw new Error('模型设置路径无效')
    const state = { schema: 1, model, updatedAt: new Date().toISOString() }, temporary = join(dirname(this.path), '.model-' + randomUUID())
    writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); renameSync(temporary, this.path)
    this.state = state; return this.get()
  }
}

/** Resolve both protocol adapters from the same saved key and model. */
export function sharedModelApi(getKey, model = 'deepseek-v4-pro') {
  validateModelId(model)
  return { provider: 'DeepSeek', model, baseUrl: 'https://api.deepseek.com', anthropicBaseUrl: 'https://api.deepseek.com/anthropic', apiKey: getKey() || '', capabilities: modelCapabilities(model) }
}

/** Update an existing standalone project's ignored config without touching other fields. */
export function syncStandaloneApi(path, config) {
  validateModelId(config.model)
  if (!existsSync(path)) return false
  if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) throw new Error('独立项目 API 配置文件无效')
  let text = readFileSync(path, 'utf8')
  const values = { ANTHROPIC_API_KEY: config.apiKey, ANTHROPIC_BASE_URL: config.anthropicBaseUrl, MODEL_ID: config.model, ANTHROPIC_AUTH_TOKEN: '' }
  for (const [name, value] of Object.entries(values)) {
    const line = name + '=' + JSON.stringify(value)
    const pattern = new RegExp('^(?:export\\s+)?' + name + '\\s*=.*$', 'mg')
    text = pattern.test(text) ? text.replace(pattern, () => line) : text.trimEnd() + '\n' + line + '\n'
  }
  const temporary = join(dirname(path), '.api-sync-' + randomUUID())
  writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 }); renameSync(temporary, path); chmodSync(path, 0o600)
  return true
}

/** One bounded non-streaming request for the original product-discovery chat. */
export async function completeWithSharedApi(config, messages, { signal, fetcher = fetch, maxTokens = 6000 } = {}) {
  if (!config.apiKey) throw new Error('请先配置工作台 API Key')
  const response = await fetcher(config.baseUrl + '/chat/completions', { method: 'POST', signal, headers: { Authorization: 'Bearer ' + config.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: config.model, messages, max_tokens: maxTokens }) })
  if (!response.ok) throw new Error('模型服务返回 ' + response.status)
  const data = await response.json(), text = data.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text.trim() || data.choices?.[0]?.finish_reason !== 'stop') throw new Error('模型未完整返回结果，请重试')
  return { text: text.split(config.apiKey).join('[已隐藏]'), usage: data.usage || {} }
}
