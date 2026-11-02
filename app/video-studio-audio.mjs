/** Owned, local-only audio imports and exact source-range clips for video projects. */
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { constants, lstatSync, realpathSync, existsSync, mkdirSync, openSync, fstatSync, readFileSync, readSync, closeSync, writeFileSync, unlinkSync, renameSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'

const EXTENSIONS = new Set(['.mp3', '.wav', '.m4a', '.flac'])
const MAX_BYTES = 256_000_000
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const cancelled = () => Object.assign(new Error('音频处理已停止，原音频和已有影片均保留'), { name: 'AbortError' })
function check(signal) { if (signal?.aborted) throw cancelled() }
function owned(root, input, folder = false, maxBytes = MAX_BYTES) {
  const base = realpathSync(root), path = resolve(base, input), part = relative(base, path)
  if (!part || part === '..' || part.startsWith('../') || isAbsolute(part)) throw new Error('音频文件必须位于当前视频工程内')
  let at = base
  for (const name of part.split('/')) { at = join(at, name); if (lstatSync(at).isSymbolicLink()) throw new Error('音频路径不能经过符号链接') }
  const stat = lstatSync(path)
  if (folder ? !stat.isDirectory() : !stat.isFile() || stat.size > maxBytes) throw new Error('音频文件类型或大小无效')
  return path
}
function fingerprint(path) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0)), hash = createHash('sha256'), buffer = Buffer.allocUnsafe(65536)
  try {
    const before = fstatSync(fd); let bytes = 0, size
    while ((size = readSync(fd, buffer, 0, buffer.length, null)) > 0) { hash.update(buffer.subarray(0, size)); bytes += size }
    const after = fstatSync(fd)
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes !== before.size) throw new Error('音频在读取时发生变化')
    return { sha256: hash.digest('hex'), bytes }
  } finally { closeSync(fd) }
}
function privateDirectory(root, part) {
  let folder = realpathSync(root)
  for (const name of part.split('/')) {
    folder = join(folder, name)
    if (!existsSync(folder)) mkdirSync(folder, { mode: 0o700 })
    const stat = lstatSync(folder)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('音频素材目录不能经过符号链接')
  }
  return folder
}
function sourceBytes(path) {
  const selected = resolve(path), stat = lstatSync(selected)
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0 || stat.size > MAX_BYTES) throw new Error('请选择256MB以内的普通音频文件')
  const canonical = realpathSync(selected), fd = openSync(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
  try {
    const before = fstatSync(fd)
    if (!before.isFile() || before.dev !== stat.dev || before.ino !== stat.ino || before.size !== stat.size || before.mtimeMs !== stat.mtimeMs) throw new Error('音频在导入前发生变化，请重新选择')
    const bytes = readFileSync(fd), after = fstatSync(fd)
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || bytes.length !== before.size) throw new Error('音频在导入时发生变化，请重新选择')
    return bytes
  } finally { closeSync(fd) }
}
function run(command, args, { signal, timeout = 0, maxBytes = 1_000_000 } = {}) {
  check(signal)
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', HOME: '/tmp' }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let failure, timer, size = 0; const out = [], errors = []
    const kill = () => { if (child.pid) try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') failure ||= error } }
    const abort = () => { failure = cancelled(); kill() }
    signal?.addEventListener('abort', abort, { once: true })
    if (timeout) timer = setTimeout(() => { failure = new Error('音频信息读取超时'); kill() }, timeout)
    for (const [stream, target] of [[child.stdout, out], [child.stderr, errors]]) stream.on('data', bytes => { size += bytes.length; if (size > maxBytes) { failure = new Error('音频工具输出过大'); kill() } else target.push(bytes) })
    child.on('error', error => { failure = error })
    child.once('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort)
      if (failure) return reject(failure)
      const stderr = Buffer.concat(errors).toString('utf8')
      if (code !== 0) return reject(new Error(stderr.slice(-2000) || '本地音频处理失败'))
      resolveResult(Buffer.concat(out).toString('utf8'))
    })
    if (signal?.aborted) abort()
  })
}
async function probe(path, runtime, signal) {
  if (typeof runtime?.ffprobe !== 'string' || typeof runtime?.ffmpeg !== 'string') throw new Error('本地音频工具尚未就绪')
  const result = JSON.parse(await run(runtime.ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries', 'format=duration:stream=codec_type,sample_rate,channels:stream_disposition=attached_pic', '-of', 'json', path], { signal, timeout: 20000 }))
  const streams = result.streams || [], audio = streams.find(stream => stream.codec_type === 'audio'), duration = Number(result.format?.duration), sampleRate = Number(audio?.sample_rate), channels = audio?.channels
  if (!audio || streams.some(stream => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1) || !Number.isFinite(duration) || duration <= 0 || duration > 86400 || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000 || !Number.isInteger(channels) || channels < 1 || channels > 8) throw new Error('文件没有可用的独立音频或时长信息')
  return { duration, sampleRate, channels }
}

/** Import selected audio as an immutable project-owned copy; no model or network request occurs. */
export async function importVideoAudio({ project, file, runtime, signal } = {}) {
  check(signal)
  if (typeof file?.path !== 'string' || !EXTENSIONS.has(extname(file.path).toLowerCase())) throw new Error('请选择MP3、WAV、M4A或FLAC音频')
  const bytes = sourceBytes(file.path), id = randomUUID(), folder = privateDirectory(project.cwd, 'assets/audio/' + id), path = join(folder, 'source' + extname(file.path).toLowerCase())
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 })
  try {
    const info = await probe(path, runtime, signal); check(signal)
    return { source: { id, name: basename(file.name || file.path).slice(0, 200), path, bytes: bytes.length, sha256: digest(bytes), ...info, importedAt: new Date().toISOString() }, selection: null }
  } catch (error) { unlinkSync(path); throw error }
}

/** Validate source ownership and integrity before reading or cutting an imported recording. */
export function checkedVideoAudioSource(project, audio) {
  if (!audio?.source?.path || !/^[a-f\d]{64}$/.test(audio.source.sha256 || '')) throw new Error('请先导入本地音频')
  const path = owned(project.cwd, audio.source.path), bytes = readFileSync(path)
  if (bytes.length !== audio.source.bytes || digest(bytes) !== audio.source.sha256) throw new Error('导入的原音频已变化，请重新导入后再选择片段')
  return path
}

/** Resolve only the unchanged selected clip from the separately retained host audio selection. */
export function checkedVideoAudioSelection(project, audio) {
  checkedVideoAudioSource(project, audio)
  const selection = audio.selection
  if (!selection || !/^[a-f\d]{64}$/.test(selection.sha256 || '') || ![selection.start, selection.end, selection.duration].every(Number.isFinite) || selection.start < 0 || selection.end > audio.source.duration + .001 || selection.duration < 1 || selection.duration > 3600 || selection.sampleRate !== 48000 || selection.channels !== 2 || Math.abs(selection.end - selection.start - selection.duration) > .001 || Math.abs(selection.duration - project.duration) > Math.max(.001, 1 / (project.fps || 30))) throw new Error('请先选择与当前影片时长一致的音频片段')
  const path = owned(project.cwd, selection.path, false, 750_000_000), actual = fingerprint(path)
  if (actual.bytes !== selection.bytes || actual.sha256 !== selection.sha256) throw new Error('所选音频片段已变化，请重新选择片段')
  return path
}

/** Produce a stereo 48kHz WAV for an explicit range, retaining the original recording. */
export async function selectVideoAudio({ project, audio, start, end, fadeMs = 60, runtime, signal } = {}) {
  check(signal)
  const path = checkedVideoAudioSource(project, audio), duration = end - start
  if (![start, end, duration, fadeMs].every(Number.isFinite) || start < 0 || end <= start || end > audio.source.duration + .001 || duration < 1 || duration > 3600 || fadeMs < 0 || fadeMs > 2000 || fadeMs / 1000 > duration / 2) throw new Error('请选择原音频范围内1至3600秒的片段，淡入淡出须不超过片段一半')
  const info = await probe(path, runtime, signal)
  if (Math.abs(info.duration - audio.source.duration) > .05) throw new Error('原音频时长已变化，请重新导入')
  const clipId = randomUUID(), folder = dirname(path), temp = join(folder, '.clip-' + clipId + '.wav'), output = join(folder, 'clip-' + clipId + '.wav'), fades = fadeMs / 1000
  const filters = [`atrim=start=${start}:end=${end}`, 'asetpts=PTS-STARTPTS', ...(fades ? [`afade=t=in:d=${fades}`, `afade=t=out:st=${duration - fades}:d=${fades}`] : [])]
  try {
    await run(runtime.ffmpeg, ['-v', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-i', path, '-map', '0:a:0', '-vn', '-af', filters.join(','), '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', '-n', temp], { signal })
    check(signal); checkedVideoAudioSource(project, audio)
    const actual = await probe(temp, runtime, signal)
    if (Math.abs(actual.duration - duration) > .025 || actual.sampleRate !== 48000 || actual.channels !== 2) throw new Error('实际音频片段与所选时长不一致，未替换已有片段')
    check(signal); renameSync(temp, output)
    return { start, end, duration, path: output, ...fingerprint(output), sampleRate: actual.sampleRate, channels: actual.channels, fadeMs, createdAt: new Date().toISOString() }
  } catch (error) { try { if (lstatSync(temp).isFile()) unlinkSync(temp) } catch (cleanup) { if (cleanup.code !== 'ENOENT') console.error('音频临时片段清理失败') } throw error }
}
