/** Recorded owner-local UI flow using the real service and a keyless provider fixture. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GeoService } from './geo-service.mjs'

test('GEO UI saves a customer, edits keywords and drafts, reviews four variants and exports', async t => {
  const dom = new JSDOM('<section id="geo"></section>', { url: 'file:///geo-test', pretendToBeVisual: true })
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.FormData = dom.window.FormData
  const root = mkdtempSync(join(tmpdir(), 'geo-ui-')), calls = [], notices = []
  const article = { title: '如何判断整理服务', body: '虚构品牌示例，仅供演示。\n\n## 先看边界\n\n整理前先沟通需求 [F02]，物品是否保留由用户决定 [F03]。这是供读者判断服务适配性的说明。' }
  const service = new GeoService({ root, courseRoot: fileURLToPath(new URL('./integrations/geo-course/', import.meta.url)), getKey: () => 'fixture-key', fetcher: async (_url, opts) => {
    const body = JSON.parse(opts.body), isAdapt = body.messages[1].content.includes('四个平台版本')
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(isAdapt ? Object.fromEntries(['toutiao','sohu','zhihu','36kr'].map(name => [name, article])) : article) } }], usage: { prompt_tokens: 123, completion_tokens: 45 } }) }
  } })
  const { mountGeo } = await import('./geo-view.mjs')
  const method = { geoList: 'list', geoStatus: 'status', geoCreate: 'create', geoGet: 'get', geoSaveProfile: 'saveProfile', geoKeywords: 'keywords', geoSaveKeywords: 'saveKeywords', geoGenerate: 'generate', geoSaveContent: 'saveContent', geoReview: 'review', geoExport: 'export' }
  const ui = mountGeo({ container: document.getElementById('geo'), toast: msg => notices.push(msg), api: async (name, ...args) => { calls.push(name); return service[method[name]](...args) } })
  t.after(async () => { ui.destroy(); await service.close(); dom.window.close(); delete globalThis.window; delete globalThis.document; delete globalThis.FormData; rmSync(root, { recursive: true, force: true }) })
  const settle = async () => { await new Promise(resolve => setTimeout(resolve, 25)) }
  const click = async selector => { const node = document.querySelector(selector); assert.ok(node, selector); node.click(); await settle() }
  const step = () => document.querySelector('[aria-current=step]')?.textContent.trim()
  await ui.show(); await click('[data-geo-action=example]')
  assert.equal(ui.hasUnsaved(), true); assert.match(document.getElementById('geo-brand').value, /虚构演示/)
  await click('[data-geo-action=profile]'); assert.equal(step(), '2关键词与选题'); assert.equal(ui.hasUnsaved(), false)
  const word = document.querySelector('[data-geo-word="0"]'); word.value = '杭州书桌整理适合谁'; word.dispatchEvent(new window.Event('input', { bubbles: true }))
  await click('[data-geo-action=keywords]'); assert.equal(step(), '3文章主稿'); assert.equal(calls.includes('geoGenerate'), false)
  await click('[data-geo-action=article]'); await service.active?.done; await ui.show()
  assert.match(document.querySelector('.geo-preview').textContent, /如何判断整理服务/)
  await click('[data-geo-action=edit]')
  const text = document.getElementById('geo-body'); text.value += '\n\n读者可以先整理一小块桌面。'; text.dispatchEvent(new window.Event('input', { bubbles: true }))
  await click('[data-geo-action=preview]'); assert.equal(ui.hasUnsaved(), true); assert.match(document.querySelector('.geo-preview').textContent, /一小块桌面/)
  await click('[data-geo-action=adapt]'); assert.ok(notices.some(msg => /未保存/.test(msg))); assert.equal(step(), '3文章主稿')
  await click('[data-geo-action=save-article]'); assert.equal(ui.hasUnsaved(), false)
  await click('[data-geo-action=adapt]'); await service.active?.done; await ui.show()
  assert.equal(step(), '4平台改写与审阅')
  for (const name of ['toutiao','sohu','zhihu','36kr']) { await click(`[data-geo-platform="${name}"]`); assert.ok(document.querySelector(`[data-geo-platform="${name}"][aria-pressed=true]`)) }
  await click('[data-geo-action=review]'); assert.equal(step(), '4平台改写与审阅')
  document.getElementById('geo-reviewed').checked = true; await click('[data-geo-action=review]')
  assert.equal(step(), '5导出'); await click('[data-geo-action=export]')
  const id = service.list()[0].id; assert.equal(service.get(id).exports.length, 1)
  assert.deepEqual({ step: step(), status: service.get(id).status, calls: service.get(id).usage.calls, platforms: Object.keys(service.get(id).variants), exported: Boolean(document.querySelector('[data-geo-action=open-export]')) }, { step: '5导出', status: 'reviewed', calls: 2, platforms: ['toutiao','sohu','zhihu','36kr'], exported: true })
})
