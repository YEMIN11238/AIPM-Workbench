/** Keyless behavior checks through the real GEO service, including cancellation and export review. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GeoService } from './geo-service.mjs'
import { geoDemo } from './geo-copy.mjs'
import { diagnose, normalizeProfile, suggestKeywords, inspectArticle, csvCell } from './geo-core.mjs'
const body = '## 如何判断服务是否适合自己\n\n先看实际需要。品牌提供书桌整理服务 [F01]，去留决定由用户作出 [F03]。虚构品牌示例，仅供演示。'
const article = { title: '书桌整理服务怎么选', body }
function setup(t, fetcher, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'geo-service-'))
  const requests = []
  const service = new GeoService({ root, courseRoot: fileURLToPath(new URL('./integrations/geo-course/', import.meta.url)), getKey: () => 'test-secret', fetcher: fetcher || (async (_url, opts) => {
    const request = JSON.parse(opts.body); requests.push(request)
    const adapted = request.messages[1].content.includes('四个平台版本')
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(adapted ? Object.fromEntries(['toutiao', 'sohu', 'zhihu', '36kr'].map(name => [name, article])) : article) } }], usage: { prompt_tokens: 123, completion_tokens: 45 } }) }
  }), ...options })
  t.after(async () => { await service.close(); rmSync(root, { recursive: true, force: true }) })
  let c = service.create(); c = service.saveProfile(c.id, geoDemo); c = service.keywords(c.id); service.saveKeywords(c.id, c.keywords)
  return { service, root, id: c.id, requests }
}
async function finish(service) { await service.active?.done }
async function produce(service, id) { const c = service.get(id); service.generate(id, 'article', { keyword: c.keywords[0].text, type: '选择判断型' }); await finish(service); service.generate(id, 'adapt'); await finish(service) }

test('diagnosis requires sourced facts and keywords stay derived from the customer, without metrics', () => {
  const missing = normalizeProfile({ brand: '演示' }); assert.equal(diagnose(missing).ready, false)
  assert.ok(diagnose(missing).gaps.includes('行业'))
  const p = normalizeProfile(geoDemo), rows = suggestKeywords(p)
  assert.ok(rows.every(row => /书桌整理|居家收纳|青禾桌面整理/.test(row.text)))
  assert.equal(rows.some(row => 'searchVolume' in row), false)
  assert.equal(csvCell('=1+1'), '"\'=1+1"')
  assert.equal(diagnose(normalizeProfile({ ...geoDemo, facts: '没有来源的事实' })).ready, false)
})
test('model drafts remain reviewable, export requires exact reviewed contents and preserves old packages', async t => {
  const { service, id, root, requests } = setup(t)
  await produce(service, id)
  let c = service.get(id)
  assert.equal(c.usage.calls, 2); assert.equal(c.usage.inputTokens, 246); assert.equal(c.reviewed, false)
  assert.throws(() => service.export(id), /审阅/)
  assert.match(requests[0].messages[0].content, /虚构演示/)
  assert.ok(!JSON.stringify(c).includes('test-secret')); assert.equal('runs' in c, false)
  service.review(id, true); service.export(id)
  const first = service.exportFolder(id)
  assert.match(readFileSync(join(first, '主稿.md'), 'utf8'), /虚构品牌示例/)
  assert.match(readFileSync(join(first, '证据与审阅.md'), 'utf8'), /演示服务说明 A/)
  assert.equal(readdirSync(first).length, 9)
  service.export(id); assert.notEqual(service.exportFolder(id), first)
  service.saveContent(id, 'sohu', { ...article, title: '修改过的标题' })
  assert.equal(service.get(id).reviewed, false); assert.throws(() => service.export(id), /审阅/)
  const stored = readFileSync(join(root, id, 'campaign.json'), 'utf8')
  assert.ok(!stored.includes('test-secret')); assert.match(stored, /messages/)
})
test('profile edits invalidate generated content; a model error preserves earlier drafts', async t => {
  const { service, id } = setup(t); await produce(service, id)
  service.fetcher = async () => ({ ok: false, status: 429 })
  service.generate(id, 'article', { keyword: service.get(id).keywords[0].text, type: '选择判断型' }); await finish(service)
  assert.equal(service.get(id).status, 'failed'); assert.deepEqual(service.get(id).article, article)
  service.saveProfile(id, { ...geoDemo, city: '南京' })
  assert.equal(service.get(id).article, null); assert.deepEqual(service.get(id).variants, {})
})
test('cancel and timeout wait for the owned model request; concurrent edits are rejected', async t => {
  const fetcher = (_url, opts) => new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
  const { service, id } = setup(t, fetcher)
  const options = { keyword: service.get(id).keywords[0].text, type: '选择判断型' }
  service.generate(id, 'article', options)
  assert.throws(() => service.saveProfile(id, geoDemo), /等待/)
  await service.cancel(id); assert.equal(service.active, null); assert.equal(service.get(id).status, 'cancelled')
  service.timeoutMs = 20; service.generate(id, 'article', options); await finish(service)
  assert.equal(service.get(id).status, 'failed'); assert.match(service.get(id).error, /120 秒/)
})
test('review cannot approve invented source ids or unsafe promises; editing master invalidates all variants', async t => {
  const { service, id } = setup(t); await produce(service, id)
  service.saveContent(id, 'sohu', { title: '保证涨薪', body: body + '\n不存在的事实 [F99]' })
  assert.throws(() => service.review(id, true), /阻断/)
  const checks = inspectArticle({ title: 'test', body: body + '[F99]' }, geoDemo)
  assert.ok(checks.some(item => item.level === 'block'))
  assert.ok(inspectArticle({ title: 'test', body: body + '（F99）' }, geoDemo).some(item => item.level === 'block'))
  assert.equal(inspectArticle({ title: 'test', body: '用户提供服务（F01）。这里是说明文字，供演示检查。' }, geoDemo).some(item => /没有事实编号/.test(item.message)), false)
  service.saveContent(id, 'article', article); assert.deepEqual(service.get(id).variants, {})
})
test('restart preserves campaigns, marks interrupted requests and rejects linked task files', async t => {
  const { service, id, root } = setup(t); await produce(service, id)
  const path = join(root, id, 'campaign.json'), stored = JSON.parse(readFileSync(path, 'utf8')); stored.status = 'running'; writeFileSync(path, JSON.stringify(stored))
  const restored = new GeoService({ root, courseRoot: service.courseRoot, getKey: () => '' }); assert.equal(restored.get(id).status, 'interrupted')
  assert.equal(restored.get(id).article.title, article.title)
  rmSync(path); symlinkSync(join(root, 'outside.json'), path); assert.throws(() => restored.get(id))
  assert.throws(() => service.get('../elsewhere'))
})
test('truncated or malformed provider output never replaces saved content', async t => {
  const { service, id } = setup(t); await produce(service, id)
  service.fetcher = async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'length', message: { content: '{' } }], usage: {} }) })
  service.generate(id, 'article', { keyword: service.get(id).keywords[0].text, type: '选择判断型' }); await finish(service)
  assert.equal(service.get(id).status, 'failed'); assert.deepEqual(service.get(id).article, article)
})
