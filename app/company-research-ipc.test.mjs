/** Filesystem delivery and unprivileged report previews, without a model or user data. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { registerCompanyResearch, openResearchPreview } from './company-research-ipc.mjs'

test('exporting an old report carries that version of the evidence and never overwrites an earlier export', async t => {
  const root = mkdtempSync(join(tmpdir(), 'company-export-')); t.after(() => rmSync(root, { recursive: true, force: true }))
  const md = join(root, '示例_公司调研_v1.md'), html = md.replace(/\.md$/, '.html')
  writeFileSync(md, '# 旧版报告'); writeFileSync(html, '<h1>旧版报告</h1>')
  const handlers = new Map(), service = {
    read: () => ({ version: 'v1', name: '示例_公司调研_v1.md', audit: { passed: true } }),
    reportPath: (_id, _version, kind) => kind === 'markdown' ? md : html,
    get: () => ({ subject: '示例', mode: 'company', depth: 'quick', sources: [{ id: 'S01', title: '后来来源' }], materials: [], versions: [{ version: 'v1', sources: [{ id: 'S01', title: '原始来源', path: '/private/archive.txt' }], materials: [] }] }),
    close: async () => {},
  }
  registerCompanyResearch({ handle: (name, action) => handlers.set(name, action), service, dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [root] }) }, window: () => null })
  const first = await handlers.get('companyExport')('id', 'v1'), second = await handlers.get('companyExport')('id', 'v1')
  assert.notEqual(first.folder, second.folder)
  assert.deepEqual(readdirSync(first.folder).sort(), ['来源与检查.json', '示例_公司调研_v1.html', '示例_公司调研_v1.md'].sort())
  const ledger = JSON.parse(readFileSync(join(first.folder, '来源与检查.json')))
  assert.equal(ledger.sources[0].title, '原始来源'); assert.equal(ledger.sources[0].path, undefined)
  assert.equal(readFileSync(join(first.folder, '示例_公司调研_v1.md'), 'utf8'), '# 旧版报告')
})

test('selected Chinese text materials are imported as data and their original file is retained', async t => {
  const root = mkdtempSync(join(tmpdir(), 'company-import-')); t.after(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, '会后纪要.txt'); writeFileSync(file, '客户实际需求，与公开预测存在差异。')
  const handlers = new Map(); let imported
  const service = { get: () => ({ id: 'research' }), folder: () => root, addMaterial: (_id, material) => { imported = material; return { id: 'research', materials: [material] } }, close: async () => {} }
  registerCompanyResearch({ handle: (name, action) => handlers.set(name, action), service, python: '/usr/bin/python3', directory: fileURLToPath(new URL('.', import.meta.url)), dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [file] }) }, window: () => null })
  const result = await handlers.get('companyImport')('research')
  assert.equal(result.id, 'research'); assert.equal(imported.name, '会后纪要.txt'); assert.equal(imported.content, '客户实际需求，与公开预测存在差异。')
  assert.equal(readdirSync(join(root, '导入原件')).length, 1)
})

test('report windows have no preload, refuse permission/network requests and never expose the workbench API', () => {
  let options, instance, opened
  class Preview extends EventEmitter {
    constructor(value) {
      super(); options = value; instance = this
      const session = new EventEmitter()
      session.setPermissionRequestHandler = fn => { this.permissions = fn }; session.setPermissionCheckHandler = fn => { this.permissionCheck = fn }
      session.webRequest = { onBeforeRequest: (_filter, fn) => { this.network = fn } }
      this.webContents = new EventEmitter(); this.webContents.session = session; this.webContents.setWindowOpenHandler = fn => { this.newWindow = fn }
    }
    loadFile(path) { this.path = path; return Promise.resolve() }
  }
  openResearchPreview({ path: '/fixture/report.html', BrowserWindow: Preview, shell: { openExternal: async url => { opened = url } } })
  assert.equal(options.webPreferences.nodeIntegration, false); assert.equal(options.webPreferences.contextIsolation, true); assert.equal(options.webPreferences.sandbox, true); assert.equal(options.webPreferences.preload, undefined)
  let decision; instance.network({ url: 'https://tracker.invalid/pixel' }, result => { decision = result }); assert.deepEqual(decision, { cancel: true })
  instance.permissions(null, 'camera', result => { decision = result }); assert.equal(decision, false); assert.equal(instance.permissionCheck(), false)
  assert.deepEqual(instance.newWindow({ url: 'javascript:alert(1)' }), { action: 'deny' }); assert.equal(opened, undefined)
  assert.deepEqual(instance.newWindow({ url: 'https://example.com/source' }), { action: 'deny' }); assert.equal(opened, 'https://example.com/source')
})
