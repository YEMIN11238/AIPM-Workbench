/** Keyless native-view and IPC recordings for the embedded resume clinic. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerResumeClinic } from './host.mjs'

const channel = name => 'aipm-resume-clinic:' + name
const bounds = { x: 260, y: 72, width: 900, height: 650 }
const request = { messages: [{ role: 'system', content: '检查简历，按原文给建议。' }, { role: 'user', content: '张同学的测试简历。' }], max_tokens: 6000 }
const reply = (content = '{"ok":true}', finish = 'stop') => ({ ok: true, status: 200, async json() { return { choices: [{ message: { content }, finish_reason: finish }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } } } })
const tick = () => new Promise(resolve => setImmediate(resolve))

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'aipm-resume-clinic-test-'))
  const dist = join(directory, 'integrations/ai-pm-resume-clinic-upstream/dist')
  await mkdir(dist, { recursive: true }); await writeFile(join(dist, 'index.html'), '<!doctype html><html><body>clinic fixture</body></html>')
  const handlers = new Map(), created = [], attached = new Set(), fetchCalls = [], opened = [], saves = []
  let model = 'deepseek-v4-pro', configured = true, saveResult = { canceled: true }, loadDeferred = options.deferLoad, releaseLoad
  const status = () => ({ configured, model, choices: [{ id: 'deepseek-v4-pro', label: 'Pro' }, { id: 'deepseek-flash', label: 'Flash' }], apiKey: 'must-not-leak' })
  const parent = { getContentBounds: () => ({ width: 1400, height: 900 }), isDestroyed: () => false, contentView: { addChildView(view) { attached.add(view) }, removeChildView(view) { attached.delete(view) } } }
  class Session extends EventEmitter {
    constructor() { super(); this.filters = []; this.webRequest = { onBeforeRequest: (...args) => { this.filter = args.at(-1); if (typeof this.filter === 'function') this.filters.push(this.filter) } } }
    setPermissionRequestHandler(handler) { this.permissionRequest = handler }
    setPermissionCheckHandler(handler) { this.permissionCheck = handler }
    setDevicePermissionHandler(handler) { this.devicePermission = handler }
  }
  class Contents extends EventEmitter {
    constructor(owner) { super(); this.owner = owner; this.session = new Session(); this.mainFrame = { owner }; this.sent = []; this.loadFiles = []; this.loadUrls = []; this.prints = []; this.closed = false }
    setWindowOpenHandler(handler) { this.openWindow = handler }
    async loadFile(path) { this.loadFiles.push(path); if (loadDeferred) await new Promise(resolve => { releaseLoad = resolve }) }
    async loadURL(url) { this.loadUrls.push(url) }
    send(name, ...args) { this.sent.push([name, ...args]) }
    isDestroyed() { return this.closed }
    close() { this.closed = true; this.emit('destroyed') }
    async printToPDF(value) { this.prints.push(value); if (options.printFailure) throw new Error('printing failed'); return Buffer.from('%PDF-fixture\n') }
  }
  class View {
    constructor(value) { this.options = value; this.webContents = new Contents(this); created.push(this) }
    setBounds(value) { this.bounds = value }
    setVisible(value) { this.visible = value }
  }
  class PrintWindow extends EventEmitter {
    constructor(value) { super(); this.options = value; this.webContents = new Contents(this); this.destroyed = false; created.push(this) }
    loadURL(url) { return this.webContents.loadURL(url) }
    isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true; this.webContents.close(); this.emit('closed') }
    close() { this.destroy() }
    setMenu() {}
    removeMenu() {}
  }
  const ipcMain = { handle(name, callback) { if (handlers.has(name)) throw new Error('duplicate IPC ' + name); handlers.set(name, callback) }, removeHandler(name) { handlers.delete(name) } }
  const fetcher = async (url, init) => { fetchCalls.push({ url, init, body: JSON.parse(init.body) }); return options.fetcher ? options.fetcher(url, init) : reply() }
  const host = registerResumeClinic({ ipcMain, WebContentsView: View, BrowserWindow: PrintWindow, window: () => parent, directory, shell: { async openExternal(url) { opened.push(url) } }, getApi: () => ({ model, apiKey: configured ? 'fixture-private-key' : '', baseUrl: 'https://model.example/v1' }), modelStatus: status, selectModel: value => { model = value; return status() }, dialog: { async showSaveDialog(...args) { saves.push(args); if (options.deferSaveDialog) return new Promise(resolve => { args[0].once('closed', () => resolve({ canceled: true })); options.onSaveDialog?.() }); return saveResult } }, fetcher, requestTimeoutMs: options.requestTimeoutMs || 10000 })
  const event = () => ({ sender: created[0]?.webContents, senderFrame: created[0]?.webContents.mainFrame })
  const invoke = (name, ...args) => Promise.resolve().then(() => { const handler = handlers.get(channel(name)); if (!handler) throw new Error('Missing IPC ' + name); return handler(event(), ...args) })
  t.after(async () => { if (releaseLoad) releaseLoad(); await host.close(); await rm(directory, { recursive: true, force: true }) })
  return { host, directory, dist, handlers, created, attached, fetchCalls, opened, saves, invoke, event, setConfigured(value) { configured = value }, setModel(value) { model = value }, setSaveResult(value) { saveResult = value }, releaseLoad() { loadDeferred = false; releaseLoad?.() }, status }
}

test('the local clinic has a private preload, no remote navigation and no popup access', async t => {
  const f = await fixture(t); assert.equal(await f.host.show(bounds), true)
  const view = f.created[0], contents = view.webContents, preferences = view.options.webPreferences
  assert.equal(preferences.contextIsolation, true); assert.equal(preferences.nodeIntegration, false); assert.equal(preferences.sandbox, true)
  assert.equal(preferences.partition, 'persist:aipm-resume-clinic'); assert.match(preferences.preload, /resume-clinic[/\\]preload\.cjs$/)
  assert.equal(contents.loadFiles[0], join(f.dist, 'index.html')); assert.equal(f.attached.has(view), true)
  assert.equal(contents.openWindow({ url: 'https://github.com/Innate-Labs/ai-pm-resume-clinic' }).action, 'deny')
  for (const name of ['will-navigate', 'will-redirect']) {
    let denied = false; const event = { preventDefault() { denied = true } }
    contents.emit(name, event, pathToFileURL(join(f.dist, 'index.html')).href + '#/editor'); assert.equal(denied, false)
    contents.emit(name, event, 'https://outside.example/'); assert.equal(denied, true)
    denied = false; contents.emit(name, event, pathToFileURL(join(f.directory, 'private.txt')).href); assert.equal(denied, true)
  }
  assert.equal(contents.session.permissionCheck(), false)
})

test('hiding detaches the view and reopening preserves its loaded React state', async t => {
  const f = await fixture(t); await f.host.show(bounds)
  const first = f.created[0]; first.webContents.draftMarker = '未保存的真实草稿'
  f.host.hide(); assert.equal(f.attached.size, 0)
  await f.host.show({ ...bounds, width: 850 }); assert.equal(f.created.length, 1); assert.equal(first.webContents.loadFiles.length, 1)
  assert.equal(first.webContents.draftMarker, '未保存的真实草稿'); assert.equal(f.attached.has(first), true)
  f.host.resize({ ...bounds, width: 100000 }); assert.ok(first.bounds.width <= 1400)
})

test('a view finishing its initial load after hide remains detached', async t => {
  const f = await fixture(t, { deferLoad: true }), opening = f.host.show(bounds)
  await tick(); f.host.hide(); f.releaseLoad(); assert.equal(await opening, false); assert.equal(f.attached.size, 0)
  await f.host.show(bounds); assert.equal(f.created[0].webContents.loadFiles.length, 1); assert.equal(f.attached.size, 1)
})

test('all child IPC methods reject other web contents and subframes', async t => {
  const f = await fixture(t); await f.host.show(bounds)
  for (const name of ['status', 'select-model', 'complete', 'open-link', 'export-pdf']) {
    const handler = f.handlers.get(channel(name)); assert.equal(typeof handler, 'function', name)
    const arg = name === 'complete' ? request : name === 'export-pdf' ? { html: '<html><body>简历</body></html>' } : name === 'select-model' ? 'deepseek-flash' : 'https://example.com/'
    await assert.rejects(Promise.resolve().then(() => handler({ sender: {}, senderFrame: {} }, arg)))
    await assert.rejects(Promise.resolve().then(() => handler({ sender: f.event().sender, senderFrame: {} }, arg)))
  }
  assert.equal(f.fetchCalls.length, 0); assert.equal(f.opened.length, 0); assert.equal(f.created.length, 1)
})

test('model status exposes choices but no credential and completion captures the current model', async t => {
  const f = await fixture(t); await f.host.show(bounds)
  const first = await f.invoke('status'); assert.equal(first.model, 'deepseek-v4-pro'); assert.equal(first.configured, true)
  assert.equal(JSON.stringify(first).includes('must-not-leak'), false); assert.equal('apiKey' in first, false)
  const next = await f.invoke('select-model', 'deepseek-flash'); assert.equal(next.model, 'deepseek-flash')
  const result = await f.invoke('complete', request)
  assert.equal(result.model, 'deepseek-flash'); assert.equal(result.choices[0].message.content, '{"ok":true}'); assert.equal(result.choices[0].finish_reason, 'stop')
  assert.equal(f.fetchCalls[0].body.model, 'deepseek-flash'); assert.equal(f.fetchCalls[0].init.headers.Authorization, 'Bearer fixture-private-key')
  assert.equal(JSON.stringify(result).includes('fixture-private-key'), false)
  f.host.publishModel({ ...f.status(), apiKey: 'must-not-leak' }); const sent = f.created[0].webContents.sent.at(-1)
  assert.equal(sent[0], channel('model-update')); assert.equal(JSON.stringify(sent).includes('must-not-leak'), false)
  await assert.rejects(f.invoke('select-model', 'custom-model')); f.setConfigured(false); await assert.rejects(f.invoke('complete', request)); assert.equal(f.fetchCalls.length, 1)
})

test('completion rejects invalid and oversized requests before contacting the provider', async t => {
  const f = await fixture(t); await f.host.show(bounds)
  for (const payload of [null, {}, { ...request, apiKey: 'user-secret' }, { ...request, endpoint: 'https://outside.example' }, { ...request, model: 'custom' }, { ...request, max_tokens: 0 }, { ...request, max_tokens: 24001 }, { ...request, max_tokens: 1.5 }, { ...request, stream: true }, { ...request, messages: Array.from({ length: 41 }, () => ({ role: 'user', content: 'a' })) }, { ...request, messages: [{ role: 'tool', content: 'a' }] }, { ...request, messages: [{ role: 'user', content: 'a'.repeat(200001) }] }]) await assert.rejects(f.invoke('complete', payload))
  assert.equal(f.fetchCalls.length, 0)
})

test('changing the global model leaves a running request on its original model', async t => {
  let started, release
  const beginning = new Promise(resolve => { started = resolve })
  const f = await fixture(t, { fetcher: async () => { if (!release) return new Promise(resolve => { release = () => resolve(reply()); started() }); return reply() } })
  await f.host.show(bounds); const first = f.invoke('complete', request); await beginning
  f.setModel('deepseek-flash'); release()
  assert.equal((await first).model, 'deepseek-v4-pro')
  assert.equal((await f.invoke('complete', request)).model, 'deepseek-flash')
  assert.deepEqual(f.fetchCalls.map(call => call.body.model), ['deepseek-v4-pro', 'deepseek-flash'])
})

test('JSON mode carries explicit structure instructions and rejects malformed model JSON', async t => {
  const f = await fixture(t); await f.host.show(bounds)
  await f.invoke('complete', { ...request, response_format: { type: 'json_schema', json_schema: { name: 'review', strict: true, schema: { type: 'object', properties: { overallScore: { type: 'number' } } } } } })
  assert.match(f.fetchCalls[0].body.messages.map(m => m.content).join('\n'), /JSON/)
  assert.match(f.fetchCalls[0].body.messages.map(m => m.content).join('\n'), /overallScore/)
  const bad = await fixture(t, { fetcher: async () => reply('not JSON') }); await bad.host.show(bounds)
  await assert.rejects(bad.invoke('complete', { ...request, response_format: { type: 'json_object' } }), /JSON/i)
})

test('HTTP failures and truncated responses remain errors instead of fabricated reviews', async t => {
  const rejected = await fixture(t, { fetcher: async () => ({ ok: false, status: 429 }) }); await rejected.host.show(bounds)
  await assert.rejects(rejected.invoke('complete', request), /429/)
  const truncated = await fixture(t, { fetcher: async () => reply('{"partial":', 'length') }); await truncated.host.show(bounds)
  await assert.rejects(truncated.invoke('complete', request), /完整|truncat/i)
  const network = await fixture(t, { fetcher: async () => { throw new Error('network failed') } }); await network.host.show(bounds)
  await assert.rejects(network.invoke('complete', request), /network|模型|连接/i)
})

test('close aborts active model work and waits for it to settle before completing', async t => {
  let started, finishAbort, signal
  const startedPromise = new Promise(resolve => { started = resolve })
  const f = await fixture(t, { fetcher: async (_url, init) => new Promise((_resolve, reject) => { signal = init.signal; init.signal.addEventListener('abort', () => { finishAbort = () => reject(new Error('request aborted')) }, { once: true }); started() }) })
  await f.host.show(bounds); const checking = f.invoke('complete', request); const rejected = assert.rejects(checking)
  await startedPromise; let closed = false; const closing = f.host.close().then(() => { closed = true })
  await tick(); assert.equal(signal.aborted, true); assert.equal(closed, false); finishAbort(); await rejected; await closing
  assert.equal(f.created[0].webContents.closed, true); assert.equal(f.handlers.size, 0); assert.equal(f.attached.size, 0)
})

test('ordinary link bridge accepts HTTPS destinations and rejects privileged or credential URLs', async t => {
  const f = await fixture(t); await f.host.show(bounds)
  await f.invoke('open-link', 'https://example.com/resume'); assert.deepEqual(f.opened, ['https://example.com/resume'])
  for (const url of ['http://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user:pass@example.com/', 'https://example.com:8443/']) await assert.rejects(f.invoke('open-link', url))
  assert.equal(f.opened.length, 1)
})

function decodeDataPage(url) { const comma = url.indexOf(','); return url.slice(0, comma).includes(';base64') ? Buffer.from(url.slice(comma + 1), 'base64').toString() : decodeURIComponent(url.slice(comma + 1)) }

test('PDF export uses an isolated non-scripted print view and writes only the chosen PDF destination', async t => {
  const f = await fixture(t); await f.host.show(bounds)
  const destination = join(f.directory, 'chosen-resume.pdf'); f.setSaveResult({ canceled: false, filePath: destination })
  assert.deepEqual(await f.invoke('export-pdf', { html: '<!doctype html><html><head><style>body{color:#222}</style></head><body><h1>测试简历</h1></body></html>' }), { saved: true })
  assert.equal((await readFile(destination)).toString(), '%PDF-fixture\n')
  const printer = f.created[1], prefs = printer.options.webPreferences
  assert.equal(prefs.javascript, false); assert.equal(prefs.nodeIntegration, false); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.sandbox, true); assert.equal(prefs.preload, undefined)
  assert.equal(prefs.partition.startsWith('persist:'), false); assert.equal(printer.webContents.closed, true)
  const rendered = decodeDataPage(printer.webContents.loadUrls[0])
  assert.match(rendered, /Content-Security-Policy/i); assert.match(rendered, /default-src\s+'none'/); assert.match(rendered, /style-src[^;]*'unsafe-inline'/); assert.match(rendered, /img-src[^;]*data:/)
  assert.ok(rendered.indexOf('Content-Security-Policy') < rendered.indexOf('<style>'))
  assert.equal(printer.webContents.prints[0].printBackground, true)
  for (const url of ['https://outside.example/font.woff', 'file:///etc/passwd']) { let result; printer.webContents.session.filters.at(-1)({ url }, value => { result = value }); assert.equal(result.cancel, true) }
})

test('cancelled and failed PDF export leaves no file and closes its temporary view', async t => {
  const f = await fixture(t); await f.host.show(bounds)
  assert.deepEqual(await f.invoke('export-pdf', { html: '<html><head></head><body>测试简历</body></html>' }), { saved: false }); assert.equal(f.created[1].webContents.closed, true)
  const broken = await fixture(t, { printFailure: true }); await broken.host.show(bounds)
  await assert.rejects(broken.invoke('export-pdf', { html: '<html><head></head><body>测试简历</body></html>' })); assert.equal(broken.created[1].webContents.closed, true)
  for (const payload of [null, {}, { html: '' }, { html: 42 }, { html: 'x'.repeat(2_000_001) }]) await assert.rejects(f.invoke('export-pdf', payload))
})

test('closing the clinic dismisses an outstanding PDF save owner and waits for export cleanup', async t => {
  let entered
  const saving = new Promise(resolve => { entered = resolve })
  const f = await fixture(t, { deferSaveDialog: true, onSaveDialog: entered }); await f.host.show(bounds)
  const exporting = f.invoke('export-pdf', { html: '<html><head></head><body>测试简历</body></html>' }); await saving
  await f.host.close(); assert.deepEqual(await exporting, { saved: false })
  assert.equal(f.created[1].destroyed, true); assert.equal(f.created[1].webContents.closed, true); assert.equal(f.handlers.size, 0)
})
