/** Keyless desktop navigation and Blueprint integration against recorded local UI states. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'

test('home offers four explicit tasks, keeps existing projects, and transfers materials without submitting', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8')
  const dom = new JSDOM(html, { url: 'file:///fixture/index.html', pretendToBeVisual: true })
  const { window } = dom
  globalThis.window = window
  globalThis.document = window.document
  const calls = [], listeners = []
  const project = { id: 'product-one', name: '已有产品', stage: 0, completed: false, review: false, confirmed: [], documents: [], evidence: [{ id: 'e1', code: 'E01', title: '用户访谈', content: '需要更快整理笔记', kind: 'provided', source: '访谈记录' }], messages: [] }
  const boot = { projects: [project], hasKey: true, systemTheme: 'light', appearance: 'system', theme: 'light', transparency: 50 }
  const response = name => async (...args) => {
    calls.push([name, ...args])
    const values = { boot, geoList: [], geoStatus: { configured: true, model: 'test-model' }, blueprintList: [], blueprintStatus: { available: true, configured: true, model: 'test-model', activeId: null }, project }
    return { ok: true, value: values[name] }
  }
  window.aipm = new Proxy({ onSystemTheme: () => () => {}, onBlueprintUpdate: callback => { listeners.push(callback); return () => {} } }, { get: (target, name) => target[name] || response(name) })
  window.HTMLElement.prototype.scrollIntoView = () => {}
  const settle = async () => { await new Promise(resolve => setTimeout(resolve, 15)) }
  try {
    await import(`./renderer.js?studio-test=${Date.now()}`)
    await settle()
    const doc = window.document
    const home = () => ({ page: doc.getElementById('workspace').dataset.page, taskActions: [...doc.querySelectorAll('[data-studio-action]')].map(node => node.dataset.studioAction), projects: [...doc.querySelectorAll('#project-gallery [data-project]')].map(node => node.textContent.trim().replace(/\s+/g, ' ')) })
    assert.deepEqual(home(), { page: 'home', taskActions: ['geo', 'conversation', 'plan', 'audit'], projects: ['已有产品需求池0 / 5 阶段已确认还没有保存文档 ↗'] })
    doc.querySelector('[data-studio-action=geo]').click(); await settle()
    assert.equal(doc.getElementById('workspace').dataset.page, 'geo')
    assert.match(doc.getElementById('geo-view').textContent, /GEO 内容运营/)
    assert.equal(calls.some(([name]) => name === 'geoGenerate'), false)
    doc.getElementById('nav-home').click()
    doc.querySelector('[data-studio-action=audit]').click(); await settle()
    assert.equal(doc.getElementById('workspace').dataset.page, 'blueprint')
    assert.equal(doc.querySelector('.bp-mode[aria-selected=true]').dataset.mode, 'audit')
    assert.equal(calls.some(([name]) => name === 'blueprintStart'), false)
    doc.getElementById('nav-home').click()
    doc.querySelector('#project-gallery [data-project]').click(); await settle()
    assert.equal(doc.getElementById('workspace').dataset.page, 'project')
    doc.getElementById('project-blueprint').click(); await settle()
    assert.equal(doc.getElementById('workspace').dataset.page, 'blueprint')
    const input = doc.querySelector('textarea[name=idea]')
    assert.match(input.value, /已有产品/)
    assert.match(input.value, /E01 用户访谈/)
    assert.match(input.value, /需要更快整理笔记/)
    assert.equal(calls.some(([name]) => name === 'blueprintStart'), false)
    doc.getElementById('nav-home').click()
    assert.equal(doc.getElementById('workspace').dataset.page, 'home')
    assert.equal(doc.querySelector('#project-gallery [data-project]').dataset.project, 'product-one')
    assert.ok(listeners.length >= 2)
  } finally {
    dom.window.close()
    delete globalThis.window
    delete globalThis.document
  }
})
