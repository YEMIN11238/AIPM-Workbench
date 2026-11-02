/** Native media delivery tests use fixtures, with no model calls or desktop permission. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, symlinkSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { registerVideo, ownedVideoPath, openVideoPreview } from './video-ipc.mjs'

test('预算内动效生成IPC复用VideoService，参数透传且没有新凭证入口', async () => {
  const handlers = new Map(), seen = [], service = { generateMotion: async value => { seen.push(['generate', value]); return { status: 'completed', requestId: 'request' } }, motionGeneration: value => { seen.push(['get', value]); return { status: 'idle' } }, motionProjects: () => [{ id: 'existing', title: '已有工程' }] }
  registerVideo({ handle: (name, action) => handlers.set(name, action), service })
  assert.equal((await handlers.get('motionGenerate')({ projectId: 'id' })).requestId, 'request')
  assert.equal(handlers.get('motionGeneration')({ projectId: 'id' }).status, 'idle')
  assert.deepEqual(seen, [['generate', { projectId: 'id' }], ['get', { projectId: 'id' }]])
  assert.deepEqual(handlers.get('motionProjects')(), [{ id: 'existing', title: '已有工程' }])
})

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'aipm-video-ipc-'))); t.after(() => rmSync(root, { recursive: true, force: true }))
  const project = join(root, 'project'); mkdirSync(project)
  const versions = ['v1', 'v2'].map(version => {
    const folder = join(project, version); mkdirSync(folder)
    const projectPath = join(folder, 'engineering'); mkdirSync(projectPath)
    writeFileSync(join(projectPath, 'project.json'), JSON.stringify({ title: version }))
    symlinkSync('/tmp', join(projectPath, 'node_modules'))
    const videoPath = join(folder, 'film.mp4'), posterPath = join(folder, 'poster.png')
    writeFileSync(videoPath, version); writeFileSync(posterPath, 'poster')
    return { version, videoPath, posterPath, projectPath, duration: 10 }
  })
  return { root, project, versions }
}

test('exports selected version into a unique directory with portable code and no linked runtime', async t => {
  const { root, project, versions } = fixture(t), handlers = new Map()
  const service = { get: () => ({ title: 'AIPM / 介绍', duration: 10, versions, budget: { spentUpperBoundYuan: .03 } }), folder: () => project, close: async () => {} }
  registerVideo({ handle: (name, action) => handlers.set(name, action), service, window: () => null, dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [root] }) } })
  const first = await handlers.get('videoExport')('id', 'v1'), second = await handlers.get('videoExport')('id', 'v1')
  assert.notEqual(first.folder, second.folder)
  assert.equal(readFileSync(join(first.folder, 'AIPM _ 介绍.mp4'), 'utf8'), 'v1')
  assert.equal(JSON.parse(readFileSync(join(first.folder, '可编辑工程/project.json'))).title, 'v1')
  assert.equal(existsSync(join(first.folder, '可编辑工程/node_modules')), false)
  assert.match(readFileSync(join(first.folder, '可编辑工程/导出说明.txt'), 'utf8'), /npm ci/)
  assert.equal(JSON.parse(readFileSync(join(first.folder, '制作记录.json'))).budget.spentUpperBoundYuan, .03)
  await assert.rejects(handlers.get('videoExport')('id', '../v1'), /版本无效/)
  versions[0].validation = { state: 'failed', message: '画面重复' }
  await assert.rejects(handlers.get('videoExport')('id', 'v1'), /未通过画面检查/)
})

test('rejects output paths outside the project or passing through symbolic links', async t => {
  const { root, project, versions } = fixture(t)
  symlinkSync(root, join(project, 'escape'))
  await assert.rejects(ownedVideoPath(project, root, true), /不在当前项目/)
  await assert.rejects(ownedVideoPath(project, join(project, 'escape/project/v1/film.mp4')), /符号链接/)
  assert.equal(await ownedVideoPath(project, versions[0].videoPath), versions[0].videoPath)
})

test('native media preview has no workbench bridge, denies permissions/network and escapes titles', async t => {
  const { project, versions } = fixture(t); let options, view
  class Preview extends EventEmitter {
    constructor(value) {
      super(); options = value; view = this
      const session = new EventEmitter()
      session.setPermissionRequestHandler = fn => { this.permission = fn }; session.setPermissionCheckHandler = fn => { this.check = fn }
      session.webRequest = { onBeforeRequest: (_filter, fn) => { this.network = fn } }
      this.webContents = new EventEmitter(); this.webContents.session = session; this.webContents.setWindowOpenHandler = fn => { this.open = fn }
    }
    async loadFile(path) { this.path = path }
  }
  await openVideoPreview({ root: project, project: { title: '<script>alert(1)</script>', duration: 10 }, version: versions[0], BrowserWindow: Preview })
  assert.equal(options.webPreferences.preload, undefined); assert.equal(options.webPreferences.sandbox, true); assert.equal(options.webPreferences.nodeIntegration, false)
  let result; view.network({}, value => { result = value }); assert.deepEqual(result, { cancel: true })
  view.permission(null, 'camera', value => { result = value }); assert.equal(result, false); assert.equal(view.check(), false)
  assert.deepEqual(view.open(), { action: 'deny' })
  const html = readFileSync(view.path, 'utf8'); assert.ok(html.includes('&lt;script&gt;')); assert.ok(html.includes("default-src 'none'")); assert.ok(html.includes('controls autoplay loop'))
})

test('motionPreview只接受ready成片，复用原生播放器并在服务关闭时销毁', async t => {
  const { project, versions } = fixture(t), handlers = new Map(); let state = 'pending', views = 0, destroyed = false, serviceClosed = false
  const output = () => ({ projectId: 'motion', title: '动效成片', status: state, duration: 10, message: '尚未检查', ...(state === 'ready' ? { videoPath: versions[0].videoPath } : {}) })
  const service = { motionOutput: output, close: async () => { serviceClosed = true } }
  class Preview extends EventEmitter {
    constructor() { super(); views++; const session = new EventEmitter(); session.setPermissionRequestHandler = () => {}; session.setPermissionCheckHandler = () => {}; session.webRequest = { onBeforeRequest() {} }; this.webContents = new EventEmitter(); this.webContents.session = session; this.webContents.setWindowOpenHandler = () => {} }
    async loadFile(path) { this.path = path }
    isDestroyed() { return destroyed }
    destroy() { destroyed = true; this.emit('closed') }
  }
  const registered = registerVideo({ handle: (name, action) => handlers.set(name, action), service, BrowserWindow: Preview, window: () => null })
  assert.equal(handlers.get('motionOutput')({ projectId: 'motion' }).status, 'pending')
  await assert.rejects(handlers.get('motionPreview')({ projectId: 'motion' }), /尚未检查/); assert.equal(views, 0)
  state = 'ready'; assert.equal(await handlers.get('motionPreview')({ projectId: 'motion' }), true); assert.equal(views, 1)
  await registered.close(); assert.equal(destroyed, true); assert.equal(serviceClosed, true)
})

test('image picker validates file content and passes approved image paths to service', async t => {
  const { root, project } = fixture(t), image = join(root, '真实页面.png'), handlers = new Map(); let imported
  await sharp({ create: { width: 4, height: 4, channels: 3, background: '#334455' } }).png().toFile(image)
  const service = { get: () => ({ id: 'id' }), folder: () => project, addAssets: (_id, files) => { imported = files; return { id: 'id', assets: files } }, close: async () => {} }
  let selected = image
  registerVideo({ handle: (name, action) => handlers.set(name, action), service, window: () => null, dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [selected] }) } })
  const result = await handlers.get('videoImport')('id'); assert.equal(result.assets.length, 1); assert.equal(imported[0].path, image)
  selected = join(root, 'fake.png'); writeFileSync(selected, 'not an image')
  await assert.rejects(handlers.get('videoImport')('id'))
  selected = join(root, 'linked.png'); symlinkSync(image, selected)
  await assert.rejects(handlers.get('videoImport')('id'), /请选择/)
})
