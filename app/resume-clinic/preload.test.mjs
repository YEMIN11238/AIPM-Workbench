/** The clinic preload exposes model operations and trusted HTTPS clicks only. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('./preload.cjs', import.meta.url), 'utf8')

function fixture() {
  const calls = [], subscriptions = new Map(), errors = [], documentListeners = new Map()
  let bridge
  const ipcRenderer = {
    invoke: async (...args) => { calls.push(args); return { model: 'deepseek-flash' } },
    on: (name, callback) => subscriptions.set(name, callback),
    removeListener: (name, callback) => { if (subscriptions.get(name) === callback) subscriptions.delete(name) },
  }
  runInNewContext(source, {
    require(name) { assert.equal(name, 'electron'); return { ipcRenderer, contextBridge: { exposeInMainWorld(name, api) { bridge = { name, api } } } } },
    document: { addEventListener: (name, callback) => documentListeners.set(name, callback) },
    location: { href: 'file:///app/integrations/ai-pm-resume-clinic-upstream/dist/index.html#/editor' },
    URL, console: { error: message => errors.push(message) },
  })
  function click(href, { trusted = true, download = false } = {}) {
    let prevented = false
    const anchor = { getAttribute: () => href, hasAttribute: name => name === 'download' && download }
    documentListeners.get('click')({ target: { closest: () => anchor }, isTrusted: trusted, preventDefault() { prevented = true } })
    return prevented
  }
  return { ...bridge, calls, subscriptions, errors, click }
}

test('the isolated API forwards five explicit operations without generic desktop IPC', async () => {
  const f = fixture()
  assert.equal(f.name, 'aipmResumeClinic')
  assert.deepEqual(Object.keys(f.api), ['status', 'selectModel', 'complete', 'exportPdf', 'onModelUpdate'])
  assert.equal(Object.isFrozen(f.api), true)
  await f.api.status(); await f.api.selectModel('deepseek-flash')
  await f.api.complete({ messages: [{ role: 'user', content: '检查简历' }] })
  await f.api.exportPdf({ html: '<html><head></head><body>简历</body></html>' })
  assert.deepEqual(f.calls.map(call => call[0]), ['aipm-resume-clinic:status', 'aipm-resume-clinic:select-model', 'aipm-resume-clinic:complete', 'aipm-resume-clinic:export-pdf'])
})

test('model listeners contain callback exceptions and their disposer removes the subscription', () => {
  const f = fixture()
  assert.throws(() => f.api.onModelUpdate(null), /模型更新需要回调/)
  const off = f.api.onModelUpdate(() => { throw new Error('listener') })
  assert.doesNotThrow(() => f.subscriptions.get('aipm-resume-clinic:model-update')({}, { model: 'deepseek-flash' }))
  assert.equal(f.errors.length, 1)
  off(); assert.equal(f.subscriptions.size, 0)
})

test('only trusted HTTPS anchor clicks reach the separate external-link channel', () => {
  const f = fixture()
  assert.equal(f.click('https://example.com/resume'), true)
  assert.deepEqual(f.calls[0], ['aipm-resume-clinic:open-link', 'https://example.com/resume'])
  assert.equal(f.click('https://example.com/automatic', { trusted: false }), true)
  assert.equal(f.click('javascript:alert(1)'), true)
  assert.equal(f.click('http://example.com/'), true)
  assert.equal(f.click('file:///etc/passwd'), true)
  assert.equal(f.calls.length, 1)
})

test('hash navigation and generated PDF downloads remain inside the clinic', () => {
  const f = fixture()
  assert.equal(f.click('#/templates'), false)
  assert.equal(f.click('blob:null/pdf', { trusted: false, download: true }), false)
  assert.equal(f.calls.length, 0)
})
