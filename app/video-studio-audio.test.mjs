/** Actual local audio decoding and cancellation; no provider calls or user recordings. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { importVideoAudio, selectVideoAudio, checkedVideoAudioSource, checkedVideoAudioSelection } from './video-studio-audio.mjs'

const APP = dirname(fileURLToPath(import.meta.url)), runtime = { ffmpeg: join(APP, 'lemo-engine/bin/ffmpeg'), ffprobe: join(APP, 'lemo-engine/bin/ffprobe') }, available = existsSync(runtime.ffmpeg) && existsSync(runtime.ffprobe)
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'studio-audio-')), cwd = join(root, 'project'), source = join(root, 'original.wav'); mkdirSync(cwd)
  execFileSync(runtime.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=4', '-ac', '1', source])
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, project: { id: 'audio-fixture', cwd, duration: 2, fps: 30 }, source }
}
function samples(path) {
  const bytes = execFileSync(runtime.ffmpeg, ['-v', 'error', '-i', path, '-f', 'f32le', '-acodec', 'pcm_f32le', '-'])
  const values = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4)
  return { length: values.length, peak: values.reduce((max, value) => Math.max(max, Math.abs(value)), 0) }
}
async function waitFor(path) { const until = Date.now() + 4000; while (!existsSync(path) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(existsSync(path), 'audio child never started') }

test('imports an owned immutable recording and cuts a real audible nonzero source range', { skip: !available }, async t => {
  const f = fixture(t), original = readFileSync(f.source), audio = await importVideoAudio({ project: f.project, file: { path: f.source, name: '歌曲.wav' }, runtime })
  assert.equal(audio.source.name, '歌曲.wav'); assert.equal(audio.source.duration, 4); assert.equal(audio.source.sampleRate, 44100); assert.equal(audio.selection, null)
  assert.notEqual(audio.source.path, f.source); assert.deepEqual(readFileSync(audio.source.path), original)
  const selection = await selectVideoAudio({ project: f.project, audio, start: 1.25, end: 3.25, runtime })
  assert.equal(selection.duration, 2); assert.equal(selection.sampleRate, 48000); assert.equal(selection.channels, 2); assert.equal(selection.fadeMs, 60)
  const decoded = samples(selection.path); assert.equal(decoded.length, 2 * 48000 * 2); assert.ok(decoded.peak > .05, 'source range accidentally became silent')
  assert.deepEqual(readFileSync(f.source), original); assert.equal(checkedVideoAudioSelection(f.project, { ...audio, selection }), selection.path)
  const second = await selectVideoAudio({ project: f.project, audio, start: 0, end: 2, fadeMs: 0, runtime })
  assert.notEqual(second.path, selection.path); assert.ok(existsSync(selection.path), 'former clip must remain with its historical version')
})

test('invalid ranges, linked imports, changed sources and foreign clips cannot replace audio', { skip: !available }, async t => {
  const f = fixture(t), linked = join(f.root, 'linked.wav'); symlinkSync(f.source, linked)
  await assert.rejects(importVideoAudio({ project: f.project, file: { path: linked }, runtime }), /普通音频/)
  const audio = await importVideoAudio({ project: f.project, file: { path: f.source }, runtime })
  for (const range of [{ start: -1, end: 1 }, { start: 0, end: 5 }, { start: 1, end: 1.1 }, { start: NaN, end: 3 }, { start: 0, end: 2, fadeMs: 1100 }]) await assert.rejects(selectVideoAudio({ project: f.project, audio, ...range, runtime }), /片段|淡入/)
  assert.throws(() => checkedVideoAudioSource(f.project, { source: { ...audio.source, path: f.source } }), /当前视频工程/)
  const selection = await selectVideoAudio({ project: f.project, audio, start: 1, end: 3, runtime })
  assert.throws(() => checkedVideoAudioSelection({ ...f.project, duration: 3 }, { ...audio, selection }), /时长一致/)
  writeFileSync(selection.path, 'changed'); assert.throws(() => checkedVideoAudioSelection(f.project, { ...audio, selection }), /片段已变化/)
  writeFileSync(audio.source.path, 'changed'); assert.throws(() => checkedVideoAudioSource(f.project, audio), /原音频已变化/)
})

test('an assets directory link is rejected before creating any foreign folder', { skip: !available }, async t=>{
  const f=fixture(t),outside=join(f.root,'outside');mkdirSync(outside);symlinkSync(outside,join(f.project.cwd,'assets'))
  await assert.rejects(importVideoAudio({project:f.project,file:{path:f.source},runtime}),/符号链接/)
  assert.deepEqual(readdirSync(outside),[])
})

test('abort waits for its owned audio child and never leaves a usable partial clip', { skip: !available }, async t => {
  const f = fixture(t), audio = await importVideoAudio({ project: f.project, file: { path: f.source }, runtime }), marker = join(f.root, 'child.json'), fake = join(f.root, 'ffmpeg')
  writeFileSync(fake, '#!' + process.execPath + '\n' + `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,secret:process.env.AIPM_AUDIO_TEST_SECRET||null}));setInterval(()=>{},1000);`, { mode: 0o755 })
  process.env.AIPM_AUDIO_TEST_SECRET = 'fixture-must-not-inherit'; t.after(() => delete process.env.AIPM_AUDIO_TEST_SECRET)
  const controller = new AbortController(), operation = selectVideoAudio({ project: f.project, audio, start: 1, end: 3, runtime: { ...runtime, ffmpeg: fake }, signal: controller.signal })
  await waitFor(marker); const child = JSON.parse(readFileSync(marker)); assert.equal(child.secret, null); controller.abort()
  await assert.rejects(operation, error => error.name === 'AbortError'); assert.throws(() => process.kill(child.pid, 0), error => error.code === 'ESRCH')
  assert.equal(readdirSync(dirname(audio.source.path)).some(name => name.startsWith('clip-') || name.startsWith('.clip-')), false)
})

test('a source edited during decoding cannot be committed as the selected recording', { skip: !available }, async t => {
  const f = fixture(t), audio = await importVideoAudio({ project: f.project, file: { path: f.source }, runtime }), marker = join(f.root, 'started'), fake = join(f.root, 'ffmpeg'), decoded = join(f.root, 'two-seconds.wav')
  execFileSync(runtime.ffmpeg, ['-v', 'error', '-i', f.source, '-t', '2', '-ar', '48000', '-ac', '2', decoded])
  writeFileSync(fake, '#!' + process.execPath + '\n' + `import{writeFileSync,copyFileSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},'started');setTimeout(()=>{copyFileSync(${JSON.stringify(decoded)},process.argv.at(-1));},200);`, { mode: 0o755 })
  const operation = selectVideoAudio({ project: f.project, audio, start: 1, end: 3, runtime: { ...runtime, ffmpeg: fake } })
  await waitFor(marker); writeFileSync(audio.source.path, 'source changed')
  await assert.rejects(operation, /原音频已变化/); assert.equal(readdirSync(dirname(audio.source.path)).some(name => name.startsWith('clip-') || name.startsWith('.clip-')), false)
})
