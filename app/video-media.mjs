/** Opaque, bounded local media URLs for the in-workbench player. */
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { open, lstat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { ownedVideoPath } from './video-ipc.mjs'

const types = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.flac': 'audio/flac' }
function interval(value, size) {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || !size || !match[1] && !match[2]) throw new Error('range')
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2])), end = match[1] ? (match[2] ? Math.min(size - 1, Number(match[2])) : size - 1) : size - 1
  if (![start, end].every(Number.isSafeInteger) || start < 0 || start > end || start >= size || !match[1] && Number(match[2]) <= 0) throw new Error('range')
  return { start, end }
}

/** Register only checked project outputs; requests can never supply a filesystem path. */
export class VideoMedia {
  constructor() { this.assets = new Map(); this.files = new Map(); this.streams = new Set(); this.closed = false }
  async register({ owner, path }) {
    if (this.closed) throw new Error('本地视频预览已关闭')
    const file = await ownedVideoPath(owner, path), mime = types[extname(file).toLowerCase()]
    if (!mime) throw new Error('此文件不能在视频预览中打开')
    const stat = await lstat(file), stamp = { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs }
    const key = owner + '\0' + file + '\0' + JSON.stringify(stamp)
    if (this.files.has(key)) return this.files.get(key)
    const token = randomUUID(), url = 'aipm-media://local/' + token
    this.assets.set(token, { owner, file, mime, stamp }); this.files.set(key, url)
    return url
  }
  async respond(request) {
    if (this.closed) return new Response(null, { status: 410 })
    const url = new URL(request.url), asset = url.host === 'local' && !url.search && this.assets.get(url.pathname.slice(1))
    if (!asset) return new Response(null, { status: 404 })
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } })
    let file
    try {
      await ownedVideoPath(asset.owner, asset.file)
      file = await open(asset.file, constants.O_RDONLY | constants.O_NOFOLLOW)
      const stat = await file.stat()
      if (!stat.isFile()) throw new Error('invalid file')
      if (Object.keys(asset.stamp).some(key => stat[key] !== asset.stamp[key])) throw new Error('media changed since registration')
      let range
      try { range = interval(request.headers.get('range'), stat.size) }
      catch { await file.close(); file = null; return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + stat.size } }) }
      const headers = { 'Content-Type': asset.mime, 'Accept-Ranges': 'bytes', 'Content-Length': String(range ? range.end - range.start + 1 : stat.size), 'Cache-Control': 'no-store', 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff' }
      if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`
      if (request.method === 'HEAD' || !stat.size) { await file.close(); file = null; return new Response(null, { status: range ? 206 : 200, headers }) }
      const stream = file.createReadStream({ ...(range || {}), autoClose: true }); file = null
      const abort = () => stream.destroy(); this.streams.add(stream)
      stream.once('close', () => { this.streams.delete(stream); request.signal?.removeEventListener('abort', abort) })
      if (request.signal) { if (request.signal.aborted) abort(); else request.signal.addEventListener('abort', abort, { once: true }) }
      return new Response(Readable.toWeb(stream), { status: range ? 206 : 200, headers })
    } catch (error) { if (file) await file.close(); return new Response(null, { status: 404 }) }
  }
  close() { this.closed = true; for (const stream of this.streams) stream.destroy(); this.streams.clear(); this.assets.clear(); this.files.clear() }
}
