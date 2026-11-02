/** Lemo's local production tools and its persistent Pi conversation. */
import { randomUUID } from 'node:crypto'
import { basename, join, relative, sep } from 'node:path'
import { copyFile, mkdir, readdir, realpath, writeFile } from 'node:fs/promises'
import { ownedVideoPath, openVideoPreview } from './video-ipc.mjs'

export async function copySource(owner, source, destination) {
  await mkdir(destination, { mode: 0o700 })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (['node_modules', '.git', '.venv', 'runtime', 'previews'].includes(entry.name)) continue
    const from = join(source, entry.name), to = join(destination, entry.name)
    if (entry.isSymbolicLink()) throw new Error('工程包含未支持的素材链接，请先复制为普通文件再导出')
    await ownedVideoPath(owner, from, entry.isDirectory())
    if (entry.isDirectory()) await copySource(owner, from, to)
    else if (entry.isFile()) await copyFile(from, to)
    else throw new Error('工程包含无法导出的文件类型')
  }
}

/** Register the full local engine; preparing a project never sends a model request. */
export function registerLemo({ handle, service, pi, root, dialog, window, shell, BrowserWindow }) {
  const previews = new Set(), opening = new Map(), pending = new Set()
  let closing = false
  const register = (name, action) => handle(name, async (...args) => {
    if (closing) throw new Error('Lemo 正在关闭，请等待工作台重新打开')
    const task = Promise.resolve().then(() => action(...args))
    pending.add(task)
    try { return await task } finally { pending.delete(task) }
  })
  const owner = id => ownedVideoPath(root, service.get(id).cwd, true)
  async function conversation(id) {
    if (opening.has(id)) return opening.get(id)
    const pending = (async () => {
      const project = service.get(id), cwd = await owner(id)
      if (project.chatId) {
        try {
          const chat = pi.get(project.chatId)
          if (chat.cwd && chat.cwd !== cwd) throw new Error('此聊天与 Lemo 工程目录不一致，请检查工程记录')
          return project
        }
        catch (error) { if (!/不存在|未找到|not found/i.test(error.message)) throw error }
      }
      const chat = pi.create({ title: ('Lemo · ' + project.title).slice(0, 100), cwd })
      await service.setChat(id, chat.id)
      return service.get(id)
    })()
    opening.set(id, pending)
    try { return await pending } finally { opening.delete(id) }
  }
  for (const [name, method] of Object.entries({ lemoInfo: 'info', lemoStyles: 'styles', lemoRead: 'read', lemoList: 'list', lemoGet: 'get', lemoRun: 'run', lemoJob: 'job', lemoCancel: 'cancel', lemoOutput: 'output', lemoSaveStyle: 'saveStyle' })) register(name, (...args) => service[method](...args))
  register('lemoPrepare', async input => { const project = await service.prepare(input); return conversation(project.id) })
  register('lemoOpenChat', id => conversation(id))
  register('lemoVoiceConsent', (id, approved) => {
    if (typeof approved !== 'boolean') throw new Error('请明确选择是否允许在线配音')
    return service.setOnlineVoiceConsent(id, approved)
  })
  register('lemoOpenFolder', async id => { const error = await shell.openPath(await owner(id)); if (error) throw new Error(error) })
  register('lemoPreview', async id => {
    const project = service.get(id), output = await service.output(id), video = output.lastVideo
    if (!video?.path) throw new Error('尚未找到检查通过的真实成片，请先渲染并合成')
    const view = await openVideoPreview({ root: await owner(id), project, version: { videoPath: video.path, duration: video.duration, version: 'Lemo 成片' }, BrowserWindow, parent: window() })
    previews.add(view); view.once('closed', () => previews.delete(view)); return true
  })
  register('lemoExport', async id => {
    const project = service.get(id), output = await service.output(id), video = output.lastVideo, cwd = await owner(id)
    if (!video?.path) throw new Error('请先完成本地成片，再导出视频与可编辑工程')
    const videoPath = await ownedVideoPath(cwd, video.path)
    const selected = await dialog.showOpenDialog(window(), { title: '选择 Lemo 视频保存位置', properties: ['openDirectory', 'createDirectory'] })
    if (selected.canceled) return null
    const parent = await realpath(selected.filePaths[0]), part = relative(cwd, parent)
    if (!part || part !== '..' && !part.startsWith('..' + sep) && !part.startsWith(sep)) throw new Error('请选择工程文件夹之外的位置，避免导出目录包含自身')
    const name = project.title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 60) || 'Lemo视频'
    const folder = join(parent, name + '_Lemo_' + randomUUID().slice(0, 8))
    await mkdir(folder, { mode: 0o700 })
    try {
      await copyFile(videoPath, join(folder, name + '.mp4'))
      await copySource(cwd, cwd, join(folder, '可编辑工程'))
      await writeFile(join(folder, '制作记录.json'), JSON.stringify({ ...project, output, exportedAt: new Date().toISOString() }, null, 2), { mode: 0o600, flag: 'wx' })
      await writeFile(join(folder, '使用说明.txt'), 'Lemo Opuscar 本地代码动效工程。MP4 是本次检查通过的真实文件。\n可编辑工程包含原始代码、制作资料与本次产物，不包含本机 Python、浏览器、node_modules 或运行环境链接。换机请依据工程说明和原版 README 恢复运行环境。\n原版源码与文档 MIT；上游演示媒体另受 CC BY 4.0 与个别声音排除条款约束。新片使用的第三方素材需核对工程中的 CREDITS。\n本地规格检查不代替画面验收；普通 Pi 聊天使用统一 API 并单独计费。\nhttps://github.com/lemomo-ai/lemo-opuscar\n', { mode: 0o600, flag: 'wx' })
      return { folder, name: basename(folder) }
    } catch (error) {
      await writeFile(join(folder, '导出未完成.txt'), '本次导出未完成：' + error.message + '\n源工程和成片未被修改。\n', { mode: 0o600 })
      throw error
    }
  })
  return { service, async close() { closing = true; await Promise.allSettled([...pending]); for (const view of previews) if (!view.isDestroyed()) view.destroy(); previews.clear(); await service.close() } }
}
