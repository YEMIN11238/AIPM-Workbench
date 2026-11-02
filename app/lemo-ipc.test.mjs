/** The native Lemo bridge preserves conversations and exports only owned media. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, symlinkSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerLemo } from './lemo-ipc.mjs'
import { modelCallableMethods } from './capabilities.mjs'

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'lemo-ipc-'))), cwd = join(root, 'project')
  mkdirSync(cwd); writeFileSync(join(cwd, 'film.html'), '<canvas></canvas>'); writeFileSync(join(cwd, 'movie.mp4'), 'fixture-film')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  let project = { id: 'p', title: 'AIPM 介绍', cwd, prompt: '原始创作要求' }, output = { files: [] }, chats = 0
  const handlers = new Map(), calls = [], dialog = { showOpenDialog: async () => ({ canceled: false, filePaths: [root] }) }, service = {
    get: id => { assert.equal(id, 'p'); return structuredClone(project) },
    prepare: input => { calls.push(['prepare', input]); return project },
    setChat: async (_id, chatId) => { await Promise.resolve(); project = { ...project, chatId } },
    output: () => output, run: (...args) => calls.push(['run', ...args]), setOnlineVoiceConsent: (id, approved) => { calls.push(['voiceConsent', id, approved]); return { approved } }, close: async () => { calls.push(['close']) },
  }
  const registered = registerLemo({ handle: (name, action) => handlers.set(name, action), root, service,
    pi: { create: input => { calls.push(['chat', input]); return { id: 'chat' + ++chats } }, get: id => ({ id }) },
    window: () => null, dialog,
  })
  return { root, cwd, service, handlers, calls, registered, dialog, setOutput: value => { output = value } }
}

test('prepare and concurrent reopen reuse a real unsent Pi chat without a model request', async t => {
  const { handlers, calls } = fixture(t), input = { title: 'AIPM', brief: '10秒介绍', style: 'swiss' }
  const prepared = await handlers.get('lemoPrepare')(input)
  assert.equal(prepared.chatId, 'chat1'); assert.equal(prepared.prompt, '原始创作要求')
  const reopened = await Promise.all([handlers.get('lemoOpenChat')('p'), handlers.get('lemoOpenChat')('p')])
  assert.deepEqual(reopened.map(item => item.chatId), ['chat1', 'chat1'])
  assert.deepEqual(calls.map(item => item[0]), ['prepare', 'chat'])
  assert.equal(modelCallableMethods.has('lemoRun'), true)
  for (const manual of ['lemoExport', 'lemoPreview', 'lemoSaveStyle', 'lemoOpenChat', 'lemoVoiceConsent']) assert.equal(modelCallableMethods.has(manual), false)
})

test('export requires probed media, copies code and media, and omits local runtime links', async t => {
  const f = fixture(t)
  await assert.rejects(f.handlers.get('lemoExport')('p'), /先完成本地成片/)
  symlinkSync('/tmp', join(f.cwd, 'node_modules'))
  f.setOutput({ files: [{ path: join(f.cwd, 'movie.mp4'), name: 'movie.mp4', kind: 'video' }], lastVideo: { path: join(f.cwd, 'movie.mp4'), duration: 10, width: 1920, height: 1080, fps: 30, audio: true } })
  const first = await f.handlers.get('lemoExport')('p'), second = await f.handlers.get('lemoExport')('p')
  assert.notEqual(first.folder, second.folder)
  assert.equal(readFileSync(join(first.folder, 'AIPM 介绍.mp4'), 'utf8'), 'fixture-film')
  assert.equal(readFileSync(join(first.folder, '可编辑工程/film.html'), 'utf8'), '<canvas></canvas>')
  assert.equal(existsSync(join(first.folder, '可编辑工程/node_modules')), false)
  assert.equal(JSON.parse(readFileSync(join(first.folder, '制作记录.json'))).output.lastVideo.audio, true)
  assert.match(readFileSync(join(first.folder, '使用说明.txt'), 'utf8'), /MIT/)
  await f.registered.close(); assert.deepEqual(f.calls.at(-1), ['close'])
})

test('export rejects links and foreign output paths even when metadata claims ready', async t => {
  const f = fixture(t), foreign = join(f.root, 'foreign.mp4'); writeFileSync(foreign, 'outside')
  f.setOutput({ lastVideo: { path: foreign } })
  await assert.rejects(f.handlers.get('lemoExport')('p'), /不在当前项目/)
  symlinkSync(foreign, join(f.cwd, 'linked.mp4')); f.setOutput({ lastVideo: { path: join(f.cwd, 'linked.mp4') } })
  await assert.rejects(f.handlers.get('lemoExport')('p'), /符号链接/)
})

test('export cannot recursively include its own destination inside the source project', async t => {
  const f = fixture(t), nested = join(f.cwd, 'exports'); mkdirSync(nested)
  f.setOutput({ lastVideo: { path: join(f.cwd, 'movie.mp4') } })
  for (const path of [f.cwd, nested]) {
    f.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    await assert.rejects(f.handlers.get('lemoExport')('p'), /工程文件夹之外/)
  }
})

test('closing blocks new work and waits for a pending preparation before closing its service', async t => {
  const f = fixture(t); let resolvePrepare, closed = false
  f.service.prepare = () => new Promise(resolve => { resolvePrepare = resolve })
  const preparing = f.handlers.get('lemoPrepare')({ title: 'pending' }); await Promise.resolve()
  const closing = f.registered.close().then(() => { closed = true }); await Promise.resolve()
  assert.equal(closed, false)
  await assert.rejects(f.handlers.get('lemoOpenChat')('p'), /正在关闭/)
  resolvePrepare(f.service.get('p')); await preparing; await closing
  assert.deepEqual(f.calls.map(item => item[0]), ['chat', 'close'])
  assert.equal(closed, true)
})

test('online voice consent requires an explicit renderer boolean and remains outside the model gateway', async t => {
  const f = fixture(t), consent = f.handlers.get('lemoVoiceConsent')
  await assert.rejects(consent('p', 'true'), /明确选择/)
  assert.deepEqual(await consent('p', true), { approved: true })
  assert.deepEqual(await consent('p', false), { approved: false })
  assert.equal(modelCallableMethods.has('lemoVoiceConsent'), false)
})
