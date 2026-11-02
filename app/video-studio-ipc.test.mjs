/** Video previews stay inside the workbench and retain the selected history version. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { registerVideoStudio } from './video-studio-ipc.mjs'
import { VideoMedia } from './video-media.mjs'

function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'video-studio-ipc-'))), owner = join(base, 'project'); mkdirSync(owner)
  const versions = [1, 2].map(n => { const videoPath = join(owner, 'film' + n + '.mp4'); writeFileSync(videoPath, 'film' + n); return { id: 'v' + n, version: 'v' + n, owner, videoPath, ready: true, duration: 10, width: 1920, height: 1080, fps: 30 } })
  writeFileSync(join(owner, 'film.js'), 'editable animation'); symlinkSync('/tmp', join(owner, 'node_modules'))
  const handlers = new Map(), calls = [], media = new VideoMedia(), project = { id: 'lemo:example', title: '视频介绍', versions }, service = { get: () => project, close: async () => calls.push('close'), folder: () => owner }
  const dialog = { showOpenDialog: async () => ({ canceled: false, filePaths: [base] }) }
  const host = registerVideoStudio({ handle: (name, fn) => handlers.set(name, fn), service, media, dialog, window: () => null, shell: { openPath: path => { calls.push(path); return '' } } })
  t.after(() => { media.close(); rmSync(base, { recursive: true, force: true }) })
  return { base, owner, versions, project, service, media, handlers, host, calls, dialog }
}
test('preview returns an owned seekable URL for the selected version without opening external software', async t => {
  const f = fixture(t), preview = await f.handlers.get('videoStudioPreview')('lemo:example', 'v1')
  assert.equal(preview.version, 'v1'); assert.match(preview.url, /^aipm-media:/)
  assert.equal(await (await f.media.respond(new Request(preview.url))).text(), 'film1'); assert.deepEqual(f.calls, [])
  f.versions[1].ready = false
  assert.equal((await f.handlers.get('videoStudioPreview')('lemo:example')).version, 'v1')
  await assert.rejects(f.handlers.get('videoStudioPreview')('lemo:example', 'v2'), /还没有可以播放/)
})
test('export keeps the chosen video and editable code, rejects self-export, and does not copy a runtime link', async t => {
  const f = fixture(t), saved = await f.handlers.get('videoStudioExport')('lemo:example', 'v1', 'bundle')
  assert.equal(readFileSync(join(saved.folder, '视频介绍.mp4'), 'utf8'), 'film1'); assert.equal(readFileSync(join(saved.folder, '可编辑工程/film.js'), 'utf8'), 'editable animation')
  assert.equal(JSON.parse(readFileSync(join(saved.folder, '制作记录.json'))).version.id, 'v1')
  f.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f.owner] })
  await assert.rejects(f.handlers.get('videoStudioExport')('lemo:example', 'v2'), /工程目录之外/)
  await assert.rejects(f.handlers.get('videoStudioExport')('lemo:example', 'v1', 'bad'), /请选择成片/)
})
test('closing rejects new native actions and waits for an existing preparation', async t => {
  const f = fixture(t); let resolveCreate
  f.service.create = () => new Promise(resolve => { resolveCreate = resolve })
  const create = f.handlers.get('videoStudioCreate')({ brief: 'brief' }); await Promise.resolve()
  const close = f.host.close(); await assert.rejects(f.handlers.get('videoStudioGet')('id'), /正在关闭/)
  assert.equal(f.calls.includes('close'), false); resolveCreate(f.project); await create; await close; assert.equal(f.calls.includes('close'), true)
})
test('missing optional posters do not prevent a valid film from playing or exporting', async t => {
  const f = fixture(t); f.versions[1].posterPath = join(f.owner, 'missing.png')
  const preview = await f.handlers.get('videoStudioPreview')(f.project.id)
  assert.ok(preview.url); assert.equal(preview.posterUrl, undefined); assert.match(preview.posterWarning, /仍可播放/)
  const saved = await f.handlers.get('videoStudioExport')(f.project.id, 'v2', 'bundle')
  assert.equal(readFileSync(join(saved.folder, '视频介绍.mp4'), 'utf8'), 'film2')
  assert.equal(JSON.parse(readFileSync(join(saved.folder, '制作记录.json'))).warnings.length, 1)
})

test('audio import and range selection use native manual actions and owned inline media URLs', async t=>{
 const f=fixture(t),path=join(f.owner,'song.wav');writeFileSync(path,'local recording');let imported,selection
 f.dialog.showOpenDialog=async(_window,options)=>{assert.deepEqual(options.properties,['openFile']);assert.ok(options.filters[0].extensions.includes('mp3'));return{canceled:false,filePaths:[path]}}
 f.service.importAudio=async(id,file)=>{imported={id,file};return{...f.project,audio:{source:{name:file.name}}}}
 f.service.selectAudio=async(id,options)=>{selection={id,options};return f.project}
 const audioMedia={register:async value=>{assert.deepEqual(value,{owner:f.owner,path});return'aipm-media://local/audio-fixture'}}
 const handlers=new Map();registerVideoStudio({handle:(name,fn)=>handlers.set(name,fn),service:f.service,media:audioMedia,dialog:f.dialog,window:()=>null,shell:{}})
 const result=await handlers.get('videoStudioAudioImport')(f.project.id);assert.equal(result.audio.source.name,'song.wav');assert.equal(imported.file.path,path)
 await handlers.get('videoStudioAudioSelect')(f.project.id,{start:12,end:15,resizeVideo:true});assert.deepEqual(selection,{id:f.project.id,options:{start:12,end:15,resizeVideo:true}})
 f.service.audioFile=(id,options)=>{assert.equal(id,f.project.id);assert.equal(options.source,true);return{owner:f.owner,path,name:'song.wav',duration:40,start:0,end:40,source:true}}
 const preview=await handlers.get('videoStudioAudioPreview')(f.project.id,{source:true});assert.equal(preview.url,'aipm-media://local/audio-fixture');assert.equal(preview.duration,40);assert.equal(preview.path,undefined);assert.equal(preview.owner,undefined)
})

test('native close stops an in-flight audio child before waiting for its IPC response', async t=>{
 const f=fixture(t);let rejectAudio,entered=false
 f.service.selectAudio=()=>new Promise((_resolve,reject)=>{rejectAudio=reject;entered=true})
 f.service.stopAudio=async()=>{assert.equal(entered,true);f.calls.push('stopAudio');rejectAudio(Object.assign(new Error('audio cancelled'),{name:'AbortError'}))}
 const request=f.handlers.get('videoStudioAudioSelect')(f.project.id,{start:0,end:10}),stopped=assert.rejects(request,/audio cancelled/);await Promise.resolve();await f.host.close();await stopped
 assert.deepEqual(f.calls,['stopAudio','close'])
})
