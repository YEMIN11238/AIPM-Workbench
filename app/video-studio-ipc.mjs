/** One video workspace with an embedded local player and versioned native exports. */
import { randomUUID } from 'node:crypto'
import { basename, extname, join, relative, sep } from 'node:path'
import { copyFile, lstat, mkdir, realpath, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { ownedVideoPath } from './video-ipc.mjs'
import { copySource } from './lemo-ipc.mjs'

function selected(project, id) {
  const versions = project.versions || [], version = id ? versions.find(item => item.id === id || item.version === id) : versions.findLast(item => item.ready)
  if (!version?.ready || !version.videoPath || !version.owner) throw new Error('这支视频还没有可以播放的成片，请先完成制作')
  return version
}

/** Preparing, viewing and exporting never issue a model request. */
export function registerVideoStudio({ handle, service, media, dialog, window, shell }) {
  let closing = false
  const pending = new Set()
  const register = (name, action) => handle(name, async (...args) => {
    if (closing) throw new Error('视频工作区正在关闭')
    const task = Promise.resolve().then(() => action(...args)); pending.add(task)
    try { return await task } finally { pending.delete(task) }
  })
  for (const [name, method] of Object.entries({ videoStudioList: 'list', videoStudioGet: 'get', videoStudioCreate: 'create', videoStudioSend: 'send', videoStudioCancel: 'cancel', videoStudioOutput: 'output', videoStudioRead: 'read', videoStudioReply: 'reply', videoStudioSave: 'saveStoryboard', videoStudioUpgrade: 'upgrade', videoStudioRender: 'render', videoStudioAudioSelect: 'selectAudio' })) register(name, (...args) => service[method](...args))
  register('videoStudioPreview', async (id, versionId) => {
    const project = await service.get(id), version = selected(project, versionId), url = await media.register({ owner: version.owner, path: version.videoPath })
    let posterUrl, posterWarning
    if (version.posterPath) try { posterUrl = await media.register({ owner: version.owner, path: version.posterPath }) } catch (error) { posterWarning = '封面暂不可用，仍可播放实际视频' }
    return { url, posterUrl, posterWarning, version: version.id || version.version, duration: version.duration, width: version.width, height: version.height, fps: version.fps }
  })
  register('videoStudioImport', async id => {
    await service.get(id)
    const result = await dialog.showOpenDialog(window(), { title: '添加视频图片素材', properties: ['openFile', 'multiSelections'], filters: [{ name: '图片与产品截图', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })
    if (result.canceled) return null
    if (!result.filePaths.length || result.filePaths.length > 12) throw new Error('每次请选择 1–12 张图片')
    for (const path of result.filePaths) {
      const stat = await lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 30_000_000) throw new Error('请选择 30MB 以内的普通图片文件')
      const metadata = await sharp(path, { limitInputPixels: 80_000_000 }).metadata()
      if (!['png', 'jpeg', 'webp'].includes(metadata.format)) throw new Error('请选择 PNG、JPEG 或 WebP 图片')
    }
    return service.addAssets(id, result.filePaths.map(path => ({ path, name: basename(path) })))
  })
  register('videoStudioAudioImport', async id => {
    await service.get(id)
    const result = await dialog.showOpenDialog(window(), { title: '选择歌曲或视频原声音频', properties: ['openFile'], filters: [{ name: '本地音频', extensions: ['mp3', 'wav', 'm4a', 'flac'] }] })
    if (result.canceled) return null
    if (result.filePaths.length !== 1) throw new Error('每次请选择一首本地音频')
    return service.importAudio(id, { path: result.filePaths[0], name: basename(result.filePaths[0]) })
  })
  register('videoStudioAudioPreview', async (id, options = {}) => {
    const { owner, path, ...metadata } = service.audioFile(id, options)
    return { ...metadata, url: await media.register({ owner, path }) }
  })
  register('videoStudioOpenFolder', async id => {
    const project = await service.get(id), path = service.folder ? service.folder(id) : project.cwd
    if (typeof path !== 'string' || !path) throw new Error('没有找到这支视频的工程目录')
    const error = await shell.openPath(path); if (error) throw new Error(error)
  })
  register('videoStudioExport', async (id, versionId, kind = 'bundle') => {
    if (!['bundle', 'video', 'project'].includes(kind)) throw new Error('请选择成片、工程或完整包')
    const project = await service.get(id), version = selected(project, versionId), owner = await realpath(version.owner), video = await ownedVideoPath(owner, version.videoPath)
    const result = await dialog.showOpenDialog(window(), { title: '保存这支视频', properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled) return null
    const parent = await realpath(result.filePaths[0]), part = relative(owner, parent)
    if (!part || part !== '..' && !part.startsWith('..' + sep) && !part.startsWith(sep)) throw new Error('请选择工程目录之外的位置保存')
    const name = String(project.title || '视频').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 60), folder = join(parent, name + '_' + randomUUID().slice(0, 8))
    await mkdir(folder, { mode: 0o700 })
    try {
      if (kind !== 'project') await copyFile(video, join(folder, name + '.mp4'))
      if (kind !== 'video') {
        const source = version.projectPath ? await ownedVideoPath(owner, version.projectPath, true) : owner
        await copySource(owner, source, join(folder, '可编辑工程'))
      }
      const warnings = []
      if (version.posterPath && kind === 'bundle') try { await copyFile(await ownedVideoPath(owner, version.posterPath), join(folder, '封面' + extname(version.posterPath))) } catch (error) { warnings.push('可选封面未导出：' + error.message) }
      await writeFile(join(folder, '制作记录.json'), JSON.stringify({ title: project.title, projectId: project.id, version, warnings, exportedAt: new Date().toISOString() }, null, 2), { flag: 'wx', mode: 0o600 })
      await writeFile(join(folder, '说明.txt'), '这是本次选中版本的真实视频与可编辑源文件。工程未包含本机浏览器、Python、FFmpeg、node_modules或运行环境链接。请依据工程说明恢复对应运行环境。\n原版工具及第三方素材许可见工程记录和CREDITS。文件规格检查不代替画面验收。\n', { flag: 'wx', mode: 0o600 })
      return { folder }
    } catch (error) { await writeFile(join(folder, '导出未完成.txt'), error.message, { mode: 0o600 }); throw error }
  })
  return { service, async close() { closing = true; await service.stopAudio?.(); await Promise.allSettled([...pending]); await service.close() } }
}
