/** Native host for the complete starter-kit module and encrypted deployment credentials. */
import { join } from 'node:path'
import { readFile, writeFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { StarterService } from './starter-service.mjs'
import { StarterPreview } from './starter-preview.mjs'

/** Register only local-renderer IPC through the application's checked handler. */
export function registerStarter({ handle, directory, workspace, python, getApi, safeStorage, BrowserWindow, dialog, shell, window, products, blueprint, publish }) {
  const cloud = new Map(), windows = new Set()
  const validUrl = value => { const u = new URL(value); if (u.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(u.hostname) || u.username || u.password) throw new Error('只允许本机项目预览'); return u.href }
  async function page(url, viewport, capture) {
    url = validUrl(url)
    const w = new BrowserWindow({ ...viewport, show: !capture, title: '产品预览', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'starter-preview-' + randomUUID() } }); windows.add(w)
    w.on('closed', () => windows.delete(w)); w.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); w.webContents.session.setPermissionRequestHandler((_wc, _permission, cb) => cb(false))
    for (const eventName of ['will-navigate', 'will-redirect']) w.webContents.on(eventName, (event, target) => { try { const next = new URL(validUrl(target)), base = new URL(url); if (next.port !== base.port) event.preventDefault() } catch (error) { event.preventDefault() } })
    try { await w.loadURL(url); if (!capture) return true; await new Promise(resolve => setTimeout(resolve, 350)); return { bytes: (await w.webContents.capturePage()).toPNG(), text: await w.webContents.executeJavaScript('document.body.innerText') } }
    finally { if (capture && !w.isDestroyed()) w.destroy() }
  }
  let service
  const preview = new StarterPreview({ capturePage: (url, size) => page(url, size, true), getExtraEnv: () => ({ PATH: '/Users/example/.local/node/bin:' + process.env.PATH }), onChange: id => { if (service) publish(service.get(id)) } })
  service = new StarterService({ root: join(workspace, '产品开发'), kitRoot: join(directory, 'integrations/ai-product-starter-kit'), manualsRoot: join(directory, 'integrations/product-manuals/2026-10-21'), python, getApi, preview, getCloudCredentials: id => cloud.get(id) || {}, onUpdate: publish })
  const cloudFile = id => { service.folder(id); return join(workspace, '.app-data', 'cloud-' + id + '.bin') }
  async function loadCloud(id) { try { const saved = await readFile(cloudFile(id)); if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用'); cloud.set(id, JSON.parse(safeStorage.decryptString(saved))) } catch (error) { if (error.code !== 'ENOENT') throw error } }
  for (const [name, method] of Object.entries({ starterList: 'list', starterGet: 'get', starterCreate: 'create', starterCancel: 'cancel', starterReply: 'reply', starterRead: 'read', starterRate: 'rate', starterReview: 'review', starterAdvance: 'advance', starterLibrary: 'library', starterReadLibrary: 'readLibrary' })) handle(name, (...args) => service[method](...args))
  handle('starterSend', async (id, prompt) => { await loadCloud(id); return service.send(id, prompt) })
  handle('starterFolder', async id => { const error = await shell.openPath(service.folder(id)); if (error) throw new Error(error) })
  handle('starterImport', async id => { service.folder(id); const picked = await dialog.showOpenDialog(window(), { title: '导入产品需求', properties: ['openFile'], filters: [{ name: '需求文档', extensions: ['md', 'txt', 'docx', 'pdf'] }] }); return picked.canceled ? null : service.importPrd(id, picked.filePaths[0]) })
  handle('starterSources', () => [...products.list().map(p => ({ kind: 'product', id: p.id, name: p.name, label: 'Blueprint 产品' })), ...blueprint.list().filter(p => p.mode === 'plan').map(p => ({ kind: 'task', id: p.id, name: p.title, label: '已有方案' }))])
  handle('starterFromSource', (kind, id) => {
    if (kind === 'product') { const p = products.get(id); return service.create({ name: p.name, prd: products.read(id, 'PRD.md').content, linkedProductId: id }) }
    if (kind === 'task') { const p = blueprint.get(id); return service.create({ name: p.title, idea: blueprint.sourceInput(id), linkedProductId: id }) }
    throw new Error('请选择已有产品或方案')
  })
  handle('starterOpenPreview', (id, url) => { const u = new URL(validUrl(url)); if (!preview.list(id).some(p => p.port === Number(u.port))) throw new Error('当前项目预览未运行'); return page(url, { width: 1200, height: 850 }, false) })
  handle('starterCapture', (id, url, mobile) => service.capture(id, url, mobile === true))
  handle('starterStopPreview', (id, port) => preview.stop(id, port))
  handle('starterRemoveCloud', async id => { if (service.active?.id === id) throw new Error('请先停止当前操作'); await rm(cloudFile(id), { force: true }); cloud.delete(id); return true })
  handle('starterSaveCloud', async (id, input) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用')
    if (!input || typeof input.accessKey !== 'string' || typeof input.secretKey !== 'string' || !input.accessKey.trim() || !input.secretKey.trim() || input.accessKey.length > 1000 || input.secretKey.length > 2000 || !/^[a-z0-9-]{1,60}$/.test(input.region || 'cn-beijing')) throw new Error('请填写有效的火山引擎凭证和地域')
    const value = { VOLCENGINE_ACCESS_KEY_ID: input.accessKey.trim(), VOLCENGINE_ACCESS_KEY_SECRET: input.secretKey.trim(), VOLCENGINE_REGION: input.region || 'cn-beijing' }, path = cloudFile(id), temporary = path + '.' + randomUUID()
    await writeFile(temporary, safeStorage.encryptString(JSON.stringify(value)), { flag: 'wx', mode: 0o600 }); await rename(temporary, path); cloud.set(id, value); return true
  })
  return { service, capturePage: (url, size) => page(url, size, true), async close() { for (const w of windows) if (!w.isDestroyed()) w.destroy(); await service.close(); cloud.clear() } }
}
