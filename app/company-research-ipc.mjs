/** User-owned research import, export and isolated report previews. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Worker } from 'node:worker_threads'
import { randomUUID } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { CompanyResearchService } from './company-research-service.mjs'

const execute = promisify(execFile)
const textExtensions = ['md', 'txt', 'csv', 'json', 'pdf', 'docx']
const imageExtensions = ['png', 'jpg', 'jpeg', 'webp']
const childEnvironment = () => Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG'].filter(name => process.env[name]).map(name => [name, process.env[name]]))

/** Extract selected images locally; this does not request desktop permissions. */
async function imageText(file, directory) {
  const bytes = await readFile(file)
  const source = `const{parentPort,workerData}=require('node:worker_threads');try{const native=require(workerData.nativePath);parentPort.postMessage({value:JSON.parse(native.ocr(Buffer.from(workerData.bytes)))})}catch(error){parentPort.postMessage({error:error.message})}`
  const worker = new Worker(source, { eval: true, workerData: { nativePath: join(directory, 'assets/native-computer.node'), bytes } })
  try {
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('图片文字识别超时，请提供文字材料')), 30000)
      worker.once('message', result => { clearTimeout(timer); result.error ? reject(new Error(result.error)) : resolve(result.value) })
      worker.once('error', error => { clearTimeout(timer); reject(error) })
      worker.once('exit', code => { if (code !== 0) { clearTimeout(timer); reject(new Error('图片文字识别未正常完成')) } })
    })
    const lines = Array.isArray(result) ? result : result.lines || []
    const text = lines.map(line => line.text || '').join('\n').trim()
    if (!text) throw new Error('图片中没有识别到文字，请补充说明')
    return '以下为本地OCR识别，可能有错字，不能直接视为已核验事实。\n\n' + text
  } finally { await worker.terminate() }
}

/** Open a generated HTML in a temporary session with no privileged preload or network. */
export function openResearchPreview({ path, BrowserWindow, shell, parent }) {
  const view = new BrowserWindow({ width: 1180, height: 840, minWidth: 390, minHeight: 600, parent,
    title: '公司调研报告', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, partition: 'research-preview-' + randomUUID() } })
  const session = view.webContents.session
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)
  session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }))
  session.on('will-download', event => event.preventDefault())
  const external = value => {
    try { const url = new URL(value); if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) void shell.openExternal(url.href) }
    catch (error) { /* Invalid report links remain inactive. */ }
  }
  view.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' } })
  view.webContents.on('will-navigate', (event, url) => { if (url.split('#')[0] !== pathToFileURL(path).href) { event.preventDefault(); external(url) } })
  void view.loadFile(path)
  return view
}

/** Register renderer operations; filesystem pickers and previews are never model tools. */
export function registerCompanyResearch({ handle, root, skillRoot, pi, getApi, onUpdate, python, directory, dialog, window, shell, BrowserWindow, service = new CompanyResearchService({ root, skillRoot, pi, getApi, onUpdate, python }) }) {
  for (const [name, method] of Object.entries({ companyList: 'list', companyGet: 'get', companyCreate: 'create', companySend: 'send', companyCancel: 'cancel', companyReply: 'reply', companyRead: 'read', companyPublish: 'publish', companyAddMaterial: 'addMaterial', companySearch: 'search', companyFetch: 'fetch', companyLibrary: 'library', companyReadLibrary: 'readLibrary' })) handle(name, (...args) => service[method](...args))
  handle('companyOpenFolder', async id => { const error = await shell.openPath(service.folder(id)); if (error) throw new Error(error) })
  handle('companyImport', async id => {
    service.get(id)
    const selected = await dialog.showOpenDialog(window(), { title: '导入公司调研资料', properties: ['openFile'], filters: [{ name: '文档或截图', extensions: [...textExtensions, ...imageExtensions] }] })
    if (selected.canceled) return null
    const file = selected.filePaths[0], info = await stat(file), extension = extname(file).slice(1).toLowerCase()
    if (!info.isFile() || info.size > 20_000_000) throw new Error('请选择20MB以内的资料文件')
    let content
    if (imageExtensions.includes(extension)) content = await imageText(file, directory)
    else {
      if (!textExtensions.includes(extension)) throw new Error('不支持此资料格式')
      try {
        const result = await execute(python, [join(directory, 'company-research-import.py'), file], { env: childEnvironment(), maxBuffer: 2_500_000, timeout: 45000 })
        content = result.stdout
      } catch (error) {
        const detail = String(error.stderr || '').trim().split('\n').at(-1)?.replace(/^[\w.]+Error:\s*/, '')
        throw new Error(detail || '资料读取失败，请选择可读的文档或文字版材料')
      }
    }
    const project = service.addMaterial(id, { name: basename(file), content })
    const originals = join(service.folder(id), '导入原件')
    await mkdir(originals, { recursive: true, mode: 0o700 })
    await copyFile(file, join(originals, randomUUID() + '-' + basename(file).slice(-160)))
    return project
  })
  const previews = new Set()
  handle('companyPreview', (id, version) => {
    const path = service.reportPath(id, version, 'html')
    const view = openResearchPreview({ path, BrowserWindow, shell, parent: window() })
    previews.add(view); view.once('closed', () => previews.delete(view))
    return true
  })
  handle('companyExport', async (id, version, kind = 'bundle') => {
    if (!['bundle', 'markdown', 'html'].includes(kind)) throw new Error('导出格式无效')
    const report = service.read(id, version, 'markdown'), project = service.get(id)
    const markdown = kind !== 'html' ? service.reportPath(id, version, 'markdown') : null
    const html = kind !== 'markdown' ? service.reportPath(id, version, 'html') : null
    const selected = await dialog.showOpenDialog(window(), { title: '选择报告保存位置', properties: ['openDirectory', 'createDirectory'] })
    if (selected.canceled) return null
    const name = project.subject.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 60)
    const folder = join(selected.filePaths[0], name + '_调研_' + (report.version || '报告') + '_' + randomUUID().slice(0, 8))
    await mkdir(folder, { mode: 0o700 })
    if (kind !== 'html') await copyFile(markdown, join(folder, basename(markdown)))
    if (kind !== 'markdown') await copyFile(html, join(folder, basename(html)))
    if (kind === 'bundle') {
      const archived = project.versions.find(item => item.version === report.version)
      const sources = (archived?.sources || project.sources).map(({ path, pdfPath, ...source }) => source)
      const materials = (archived?.materials || project.materials).map(({ path, ...material }) => material)
      await writeFile(join(folder, '来源与检查.json'), JSON.stringify({ subject: project.subject, mode: project.mode, depth: project.depth, version: report.version, sources, materials, audit: report.audit, note: '结构检查不代表来源事实已核实。' }, null, 2), { mode: 0o600, flag: 'wx' })
    }
    return { folder }
  })
  return { service, async close() { for (const view of previews) if (!view.isDestroyed()) view.destroy(); previews.clear(); await service.close() } }
}
