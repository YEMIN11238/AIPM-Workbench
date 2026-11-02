/** Convert only an owned, actually captured image into a bounded model attachment. */
import { lstatSync, realpathSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import sharp from 'sharp'
import { modelCapabilities } from './model-api.mjs'

export async function withPiImage(result, { model, root, file, signal }) {
  if (!modelCapabilities(model).vision) return result
  try {
    if (signal?.aborted) throw new Error('任务已停止')
    if (typeof file !== 'string' || !file) throw new Error('未返回实际截图文件')
    const base = realpathSync(root), target = resolve(base, file)
    if (!target.startsWith(base + '/')) throw new Error('截图不在本次操作所属目录内')
    let cursor = base
    for (const part of target.slice(base.length + 1).split('/')) { cursor = join(cursor, part); if (lstatSync(cursor).isSymbolicLink()) throw new Error('截图不能经过符号链接') }
    const stat = lstatSync(target)
    if (!stat.isFile() || stat.size > 30000000) throw new Error('截图不是30MB内的普通文件')
    const input = readFileSync(target), metadata = await sharp(input, { limitInputPixels: 16000000 }).metadata()
    if (!['png', 'jpeg', 'webp'].includes(metadata.format)) throw new Error('截图不是支持的本地图像')
    let converted
    for (const quality of [80, 65, 50]) {
      converted = await sharp(input, { limitInputPixels: 16000000 }).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality }).toBuffer({ resolveWithObject: true })
      if (converted.data.length <= 2000000) break
    }
    if (signal?.aborted) throw new Error('任务已停止')
    if (!converted || converted.data.length > 2000000) throw new Error('截图无法压缩到模型附件上限内')
    return { ...result, image: { type: 'image', mimeType: 'image/jpeg', data: converted.data.toString('base64') }, vision: { attached: true, width: converted.info.width, height: converted.info.height }, note: '已附上本次实际截图及辅助功能/OCR信息；图像附件在本次模型工具结果中提供' }
  } catch (error) { return { ...result, vision: { attached: false, reason: error.message }, note: '图片未送入模型：' + error.message + '。只能根据已返回的辅助功能/OCR说明，不能声称已看过画面' } }
}
