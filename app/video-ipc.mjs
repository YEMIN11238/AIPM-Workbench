/** Native video delivery; paid generation remains a user action in the video panel. */
import { randomUUID } from 'node:crypto'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { copyFile, lstat, mkdir, readdir, realpath, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { VideoService } from './video-service.mjs'
import { renderVideo } from './video-renderer.mjs'

const escape = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))

/** Resolve an existing output without following links outside its owning project. */
export async function ownedVideoPath(root, file, directory = false) {
  if (typeof file !== 'string' || !file) throw new Error('视频产物路径无效')
  const base = await realpath(root), target = resolve(file), part = relative(base, target)
  if (!part || part === '..' || part.startsWith('..' + sep) || resolve(base, part) !== target) throw new Error('视频产物不在当前项目内')
  let current = base
  for (const item of part.split(sep)) {
    current = join(current, item)
    if ((await lstat(current)).isSymbolicLink()) throw new Error('视频产物不能使用符号链接')
  }
  const info = await lstat(target)
  if (directory ? !info.isDirectory() : !info.isFile()) throw new Error('视频产物不存在或格式无效')
  return target
}

function selectedVersion(project, version) {
  if (version !== undefined && (typeof version !== 'string' || !/^v[1-9]\d*$/.test(version))) throw new Error('视频版本无效')
  const item = version === undefined ? project.versions?.at(-1) : project.versions?.find(item => item.version === version)
  if (item?.validation?.state === 'failed') throw new Error('此版本未通过画面检查，请渲染或选择新的成片版本：' + item.validation.message)
  if (!item?.videoPath) throw new Error('请先渲染视频，再预览或导出')
  return item
}

async function copyProjectTree(source, destination, owner) {
  await ownedVideoPath(owner, source, true)
  await mkdir(destination, { mode: 0o700 })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const from = join(source, entry.name), to = join(destination, entry.name)
    if (entry.isSymbolicLink()) throw new Error('工程中含符号链接，导出已停止')
    if (entry.isDirectory()) {
      await copyProjectTree(from, to, owner)
    } else if (entry.isFile()) { await ownedVideoPath(owner, from); await copyFile(from, to) }
    else throw new Error('工程含不支持的文件类型')
  }
}

/** Play a registered MP4 locally without preload, scripts, network, or app credentials. */
export async function openVideoPreview({ root, project, version, BrowserWindow, parent }) {
  const video = await ownedVideoPath(root, version.videoPath)
  const previews = join(root, 'previews'); await mkdir(previews, { recursive: true, mode: 0o700 })
  const path = join(previews, randomUUID() + '.html')
  await writeFile(path, `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src file:; style-src 'unsafe-inline'"><title>${escape(project.title)} · ${escape(version.version)}</title><style>html,body{margin:0;background:#111318;color:#f4f5f8;font-family:system-ui}main{height:100vh;display:grid;grid-template-rows:1fr auto}video{width:100%;height:100%;min-height:0;object-fit:contain}footer{padding:12px 20px;color:#b9becb;font-size:13px}</style><main><video controls autoplay loop playsinline src="${escape(pathToFileURL(video).href)}"></video><footer>${escape(project.title)} · ${escape(version.version)} · ${escape(version.duration ?? project.duration)} 秒</footer></main></html>`, { mode: 0o600, flag: 'wx' })
  const view = new BrowserWindow({ width: 1180, height: 730, minWidth: 640, minHeight: 400, parent, title: '视频预览', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, autoplayPolicy: 'no-user-gesture-required', partition: 'video-preview-' + randomUUID() } })
  const session = view.webContents.session
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)
  session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }))
  session.on('will-download', event => event.preventDefault())
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  view.webContents.on('will-navigate', (event, url) => { if (url !== pathToFileURL(path).href) event.preventDefault() })
  await view.loadFile(path)
  return view
}

/** Register checked video-panel actions using the workbench's one credential source. */
export function registerVideo({ handle, root, getApi, onUpdate, dialog, window, shell, BrowserWindow, service = new VideoService({ root, getApi, onUpdate, renderVideo }) }) {
  for (const [name, method] of Object.entries({ videoList: 'list', videoGet: 'get', videoCreate: 'create', videoSend: 'send', videoSaveStoryboard: 'saveStoryboard', videoRender: 'render', videoCancel: 'cancel', motionGenerate: 'generateMotion', motionGeneration: 'motionGeneration', motionProjects: 'motionProjects', motionOutput: 'motionOutput' })) handle(name, (...args) => service[method](...args))
  handle('videoOpenFolder', async id => { const error = await shell.openPath(service.folder(id)); if (error) throw new Error(error) })
  handle('videoImport', async id => {
    service.get(id)
    const selected = await dialog.showOpenDialog(window(), { title: '导入视频图片素材', properties: ['openFile', 'multiSelections'], filters: [{ name: '图片或页面截图', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })
    if (selected.canceled) return null
    if (!selected.filePaths.length || selected.filePaths.length > 12) throw new Error('每次请选择 1 至 12 张图片')
    const files = []
    for (const path of selected.filePaths) {
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink() || info.size > 30_000_000 || !/\.(png|jpe?g|webp)$/i.test(path)) throw new Error('请选择 30MB 以内的 PNG、JPEG 或 WebP 图片')
      const metadata = await sharp(path, { limitInputPixels: 80_000_000 }).metadata()
      if (!['png', 'jpeg', 'webp'].includes(metadata.format)) throw new Error('素材不是支持的图像文件')
      files.push({ path, name: basename(path) })
    }
    return service.addAssets(id, files)
  })
  const previews = new Set()
  handle('motionPreview', async ({ projectId } = {}) => {
    const output = service.motionOutput({ projectId })
    if (output.status !== 'ready' || !output.videoPath) throw new Error(output.message || '本机动效成片检查尚未通过，不能预览')
    const owner = dirname(dirname(output.videoPath)), view = await openVideoPreview({ root: owner, project: output, version: { ...output, version: '本机成片' }, BrowserWindow, parent: window() })
    previews.add(view); view.once('closed', () => previews.delete(view)); return true
  })
  handle('videoPreview', async (id, version) => {
    const project = service.get(id), item = selectedVersion(project, version)
    const view = await openVideoPreview({ root: service.folder(id), project, version: item, BrowserWindow, parent: window() })
    previews.add(view); view.once('closed', () => previews.delete(view)); return true
  })
  handle('videoExport', async (id, version, kind = 'bundle') => {
    if (!['bundle', 'video', 'project'].includes(kind)) throw new Error('视频导出类型无效')
    const project = service.get(id), item = selectedVersion(project, version), owner = service.folder(id)
    const video = await ownedVideoPath(owner, item.videoPath)
    const engineering = kind !== 'video' ? await ownedVideoPath(owner, item.projectPath, true) : null
    const selected = await dialog.showOpenDialog(window(), { title: '选择视频保存位置', properties: ['openDirectory', 'createDirectory'] })
    if (selected.canceled) return null
    const name = project.title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 60) || '视频'
    const folder = join(selected.filePaths[0], `${name}_${item.version}_${randomUUID().slice(0, 8)}`)
    await mkdir(folder, { mode: 0o700 })
    if (kind !== 'project') await copyFile(video, join(folder, name + '.mp4'))
    if (engineering) {
      const portable = join(folder, '可编辑工程')
      await copyProjectTree(engineering, portable, owner)
      await writeFile(join(portable, '导出说明.txt'), '这是独立导出的可编辑工程，未包含 node_modules 或本机运行环境链接。\n首次在任何位置单独打开，包括本机导出目录，请先运行 npm ci 安装锁定依赖，再运行 npm run studio 或 npm run render。\nproject.json 可编辑分镜文字、时长、颜色与素材；src/ 是动画源码，public/ 是本地素材。\nRemotion 依赖使用其自己的许可证：https://www.remotion.dev/license 。\n', { flag: 'wx', mode: 0o600 })
    }
    if (item.posterPath && kind === 'bundle') await copyFile(await ownedVideoPath(owner, item.posterPath), join(folder, '封面' + (extname(item.posterPath) || '.png')))
    await writeFile(join(folder, '制作记录.json'), JSON.stringify({ title: project.title, version: item.version, duration: item.duration ?? project.duration, width: item.width ?? project.width, height: item.height ?? project.height, model: project.model ?? project.budget?.entries?.at(-1)?.model, motionSkill: item.motionSkill ?? project.motionSkill, budget: project.budget, note: '费用为按官方高峰价保守核算的 API 上界，以供应商账单为准。本地渲染没有额外模型调用。' }, null, 2), { flag: 'wx', mode: 0o600 })
    return { folder }
  })
  return { service, async close() { for (const view of previews) if (!view.isDestroyed()) view.destroy(); previews.clear(); await service.close() } }
}
