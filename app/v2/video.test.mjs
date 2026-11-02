/** Unified video interactions keep chat, original histories and real playback on one surface. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { mountVideo } from './video.mjs'

const tick = () => new Promise(resolve => setTimeout(resolve, 10))
const clone = value => structuredClone(value)
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const version = (key = 'lemo:job1') => ({ version: key, id: key, name: '第一个版本', duration: 10, width: 1920, height: 1080, fps: 30, ready: true, videoPath: '/safe/film.mp4', createdAt: '2026-10-26T10:00:00Z' })
function project(id = 'lemo:p1', patch = {}) { return { id, source: id.split(':')[0], title: id === 'quick:old' ? '原有页面介绍' : 'AIPM 介绍视频', brief: '真实产品介绍', duration: 10, width: 1920, height: 1080, fps: 30, status: 'idle', chatId: 'chat-' + id, chat: { id: 'chat-' + id, status: 'idle', messages: [], runs: [] }, messages: [], assets: [], versions: [], output: { files: [] }, production: { status: 'idle' }, ...patch } }
function fixture(t, overrides = {}) {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true, url: 'file:///fixture/v2/index.html' }); globalThis.window = dom.window; globalThis.document = dom.window.document
  const mediaCalls = []
  dom.window.HTMLMediaElement.prototype.pause = function () { mediaCalls.push({ action: 'pause', tag: this.tagName, src: this.getAttribute('src') }) }; dom.window.HTMLMediaElement.prototype.load = function () {}
  dom.window.HTMLMediaElement.prototype.play = function () { mediaCalls.push({ action: 'play', tag: this.tagName, src: this.getAttribute('src') }); return Promise.resolve() }
  const container = document.getElementById('root'), calls = [], toasts = [], projects = new Map([['lemo:p1', project()], ['quick:old', project('quick:old', { legacy: true, messages: [{ role: 'assistant', content: '旧版方案仍完整保留' }] })], ['motion:old', project('motion:old', { legacy: true, title: '原有动态文字短片' })]])
  let update, unsubscribed = false
  const defaults = {
    videoStudioList: () => [...projects.values()], videoStudioGet: id => projects.get(id), videoStudioCreate: input => { const p = project('lemo:new', input); projects.set(p.id, p); return p },
    videoStudioSend: (id, text) => { const p = projects.get(id); p.status = 'running'; p.chat.status = 'running'; p.messages.push({ id: 'u1', role: 'user', content: text }); return p },
    videoStudioCancel: id => { const p = projects.get(id); p.status = 'cancelled'; p.chat.status = 'cancelled'; p.production.status = 'cancelled'; return p },
    videoStudioReply: (id, token) => { const p = projects.get(id); assert.equal(p.pending.token, token); p.pending = null; p.chat.pending = null; p.status = 'running'; p.chat.status = 'running'; return p },
    videoStudioPreview: (id, selected) => ({ url: 'aipm-media://local/' + encodeURIComponent(id + (selected || 'latest')), version: selected || 'latest' }),
    videoStudioExport: () => ({ folder: '/safe/export' }), videoStudioImport: id => { const p = projects.get(id); p.assets.push({ id: 'image1', name: '真实页面.png', path: '/safe/page.png', type: 'image' }); return p },
    videoStudioRender: id => project(id, { production: { status: 'needs_work', message: '请先完善制作内容' } }), videoStudioSave: (id, input) => { const p = projects.get(id); p.storyboard = input.storyboard; return p }, videoStudioUpgrade: id => { const p = projects.get(id); p.linkedLemoId = 'linked'; return p },
    videoStudioRead: (_id, path) => ({ name: path.split('/').at(-1), path, kind: 'markdown', content: '# 实际生成的说明\n\n<script>bad()</script>本地文件内容' }), videoStudioOpenFolder: () => true, copyText: () => true, openLink: () => true,
  }
  const api = async (name, ...args) => { calls.push([name, ...args]); const fn = overrides[name] || defaults[name]; assert.equal(typeof fn, 'function', 'unexpected API ' + name); return clone(await fn(...args)) }
  const view = mountVideo({ container, api, toast: text => toasts.push(text), openChat: () => { throw new Error('unified video must not leave for main chat') }, events: { onVideoStudioUpdate: callback => { update = callback; return () => { update = undefined; unsubscribed = true } } } })
  const button = (label, scope = container) => { const n = [...scope.querySelectorAll('button')].find(n => n.textContent === label || n.getAttribute('aria-label') === label); assert.ok(n, 'button ' + label); return n }
  const input = (label, value) => { const n = container.querySelector('[aria-label="' + label + '"]'); assert.ok(n, 'input ' + label); if (value !== undefined) { n.value = value; n.dispatchEvent(new dom.window.Event(n.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) }; return n }
  const emit = value => { projects.set(value.id, clone(value)); update?.(clone(value)) }
  t.after(() => { view.destroy(); dom.window.close(); delete globalThis.window; delete globalThis.document })
  return { dom, view, container, api, calls, toasts, projects, mediaCalls, button, input, emit, get unsubscribed() { return unsubscribed } }
}

const song = () => ({ source: { id: 'song-source', name: '雨爱.mp3', duration: 258.856, path: '/owned/audio/source.mp3' } })

test('a music project is created locally before song import without a paid send', async t => {
  const f=fixture(t);await f.view.open();f.input('视频名称','雨爱高潮');f.input('视频制作要求','做插画手绘音乐视频，先选歌曲片段');f.button('先建音乐视频项目').click();await tick()
  assert.equal(f.calls.filter(([name])=>name==='videoStudioCreate').length,1)
  assert.equal(f.calls.some(([name])=>name==='videoStudioSend'),false)
  assert.equal(f.container.querySelector('.sv-audio-pane').open,true)
  assert.equal(f.container.querySelector('.sv-create-pane').hidden,true)
  assert.equal(f.input('视频制作对话').value,'做插画手绘音乐视频，先选歌曲片段')
  assert.ok(f.toasts.some(text=>text.includes('先导入歌曲')))
})

test('painted animation is a drawing choice in the same project and its model budget is shown as an estimate',async t=>{
  const f=fixture(t);await f.view.open();f.input('视频制作要求','制作抒情水彩插画 MV');f.input('画面风格','painted-animation');f.button('先建音乐视频项目').click();await tick()
  assert.equal(f.calls.find(([name])=>name==='videoStudioCreate')[1].visualEngine,'painted-animation');assert.equal(f.calls.some(([name])=>name==='videoStudioSend'),false)
  f.emit(project('lemo:new',{visualEngine:'painted-animation',animationMethod:{name:'水彩角色动画',ready:true},billing:{executionBudgetYuan:2},chat:{status:'idle',runs:[]}}))
  assert.match(f.container.querySelector('.sv-header').textContent,/水彩角色动画/);assert.match(f.container.querySelector('.sv-budget-status').textContent,/预算 ¥2/)
  f.emit(project('lemo:new',{visualEngine:'painted-animation',animationMethod:{name:'水彩角色动画'},chat:{status:'running',runs:[{usage:{cost:{currency:'CNY',limitYuan:2,spentUpperBoundYuan:.0312,reservedYuan:.2}}}]}}))
  assert.match(f.container.querySelector('.sv-budget-status').textContent,/费用上界 ¥0.0312/);assert.match(f.container.querySelector('.sv-budget-status').textContent,/待结算预留 ¥0.2000/)
})

test('song import and mm:ss selection save the exact range and explicit video-duration synchronization', async t => {
  let f;f=fixture(t,{videoStudioAudioImport:id=>{const p=project(id,{audio:song()});f.projects.set(id,p);return p},videoStudioAudioSelect:(id,input)=>{const p=f.projects.get(id),duration=Number((input.end-input.start).toFixed(3));p.audio.selection={...input,duration};if(input.resizeVideo)p.duration=duration;return p}})
  await f.view.open({id:'lemo:p1'});f.button('♫ 歌曲').click();await tick()
  assert.deepEqual(f.calls.find(([name])=>name==='videoStudioAudioImport'),['videoStudioAudioImport','lemo:p1'])
  assert.equal(f.container.querySelector('.sv-audio-pane').open,true)
  f.input('歌曲开始时间','0:47.24');f.input('歌曲结束时间','1:14.24');f.button('应用歌曲片段').click();await tick()
  assert.deepEqual(f.calls.find(([name])=>name==='videoStudioAudioSelect'),['videoStudioAudioSelect','lemo:p1',{start:47.24,end:74.24,resizeVideo:true,fadeMs:60}])
  assert.match(f.container.querySelector('.sv-header').textContent,/27 秒/)
  const resize=f.input('将视频时长同步为歌曲片段时长');resize.checked=false;resize.dispatchEvent(new f.dom.window.Event('change',{bubbles:true}))
  f.input('歌曲开始时间','50.24');f.input('歌曲结束时间','77.24');f.button('应用歌曲片段').click();await tick()
  assert.equal(f.calls.filter(([name])=>name==='videoStudioAudioSelect').at(-1)[2].resizeVideo,false)
  assert.equal(f.calls.some(([name])=>name==='videoStudioSend'),false)
})

test('invalid song times never reach audio selection or start model work', async t => {
  const f=fixture(t);f.projects.set('lemo:p1',project('lemo:p1',{audio:song()}));await f.view.open({id:'lemo:p1'})
  for(const [start,end]of [['-1','1:14.24'],['0:47.24','1:74.24'],['1:14.24','0:47.24'],['0:47.24','9:00'],['1:2:03','1:14.24'],['not a time','1:14.24']]){
    f.input('歌曲开始时间',start);f.input('歌曲结束时间',end);f.button('应用歌曲片段').click();await tick()
    assert.equal(f.container.querySelector('.sv-error').hidden,false)
  }
  assert.equal(f.calls.some(([name])=>name==='videoStudioAudioSelect'||name==='videoStudioSend'),false)
})

test('an invalid unsaved song range is rejected before preview lookup or playback', async t => {
  const f=fixture(t,{videoStudioAudioPreview:()=>({url:'aipm-media://local/source-song'})});f.projects.set('lemo:p1',project('lemo:p1',{audio:song()}));await f.view.open({id:'lemo:p1'})
  for(const [start,end]of [['bad','1:14.24'],['1:14.24','0:47.24'],['0:47.24','9:00']]){
    f.input('歌曲开始时间',start);f.input('歌曲结束时间',end);f.button('试听这个范围').click();await tick()
  }
  assert.equal(f.calls.some(([name])=>name==='videoStudioAudioPreview'),false)
  assert.equal(f.mediaCalls.some(call=>call.action==='play'&&call.tag==='AUDIO'),false)
})

test('owned source audio previews seek and stop within the requested range, while HTTPS media is refused', async t => {
  const f=fixture(t,{videoStudioAudioPreview:()=>({url:'aipm-media://local/song-source'})});f.projects.set('lemo:p1',project('lemo:p1',{audio:song()}));await f.view.open({id:'lemo:p1'})
  f.input('歌曲开始时间','0:47.24');f.input('歌曲结束时间','1:14.24');f.button('试听这个范围').click();await tick()
  const player=f.container.querySelector('audio');assert.equal(player.controls,true);assert.equal(player.hidden,false);assert.match(player.src,/^aipm-media:\/\//)
  player.dispatchEvent(new f.dom.window.Event('loadedmetadata'));assert.equal(player.currentTime,47.24)
  const before=f.mediaCalls.filter(call=>call.action==='pause'&&call.tag==='AUDIO').length;player.currentTime=74.3;player.dispatchEvent(new f.dom.window.Event('timeupdate'));assert.equal(f.mediaCalls.filter(call=>call.action==='pause'&&call.tag==='AUDIO').length,before+1)
  assert.deepEqual(f.calls.find(([name])=>name==='videoStudioAudioPreview'),['videoStudioAudioPreview','lemo:p1',{source:true}])
  f.view.destroy()
  const unsafe=fixture(t,{videoStudioAudioPreview:()=>({url:'https://untrusted.example/song.mp3'})});unsafe.projects.set('lemo:p1',project('lemo:p1',{audio:song()}));await unsafe.view.open({id:'lemo:p1'});unsafe.button('试听这个范围').click();await tick()
  assert.equal(unsafe.container.querySelector('audio').getAttribute('src'),null);assert.equal(unsafe.mediaCalls.some(call=>call.action==='play'),false);assert.match(unsafe.container.querySelector('.sv-error').textContent,/本机歌曲地址/)
})

test('the applied song clip uses its own preview and is paused when film playback starts', async t => {
  const p=project('lemo:p1',{audio:{...song(),selection:{start:47.24,end:74.24,duration:27}},versions:[version()],output:{files:[],lastVideo:version()}}),f=fixture(t,{videoStudioAudioPreview:()=>({url:'aipm-media://local/selected-song'})});f.projects.set(p.id,p);await f.view.open({id:p.id});f.button('试听所选片段').click();await tick()
  assert.deepEqual(f.calls.find(([name])=>name==='videoStudioAudioPreview'),['videoStudioAudioPreview',p.id,{source:false}]);assert.equal(f.mediaCalls.filter(call=>call.action==='play'&&call.tag==='AUDIO').length,1)
  const before=f.mediaCalls.filter(call=>call.action==='pause'&&call.tag==='AUDIO').length;f.container.querySelector('video').dispatchEvent(new f.dom.window.Event('play'));assert.equal(f.mediaCalls.filter(call=>call.action==='pause'&&call.tag==='AUDIO').length,before+1)
})

test('late song previews cannot begin playback after leaving a project or hiding the module', async t => {
  for(const leave of ['route','hide']){
    const pending=deferred(),f=fixture(t,{videoStudioAudioPreview:()=>pending.promise});f.projects.set('lemo:p1',project('lemo:p1',{audio:song()}));await f.view.open({id:'lemo:p1'});f.button('试听这个范围').click();await tick()
    if(leave==='route')await f.view.open({id:'quick:old'});else f.view.hide()
    pending.resolve({url:'aipm-media://local/late-song'});await tick();assert.equal(f.mediaCalls.some(call=>call.action==='play'&&call.tag==='AUDIO'),false)
    f.view.destroy()
  }
})

test('stopping video creation invalidates an outstanding song preview before it can play', async t => {
  const pending=deferred(),p=project('lemo:p1',{audio:song()}),f=fixture(t,{videoStudioAudioPreview:()=>pending.promise});f.projects.set(p.id,p);await f.view.open({id:p.id});f.button('试听这个范围').click();await tick()
  f.emit({...p,status:'running',chat:{...p.chat,status:'running'}});f.button('停止视频制作').click();await tick();pending.resolve({url:'aipm-media://local/late-after-stop'});await tick()
  assert.equal(f.calls.filter(([name])=>name==='videoStudioCancel').length,1)
  assert.equal(f.mediaCalls.some(call=>call.action==='play'&&call.tag==='AUDIO'),false)
})

test('native shot prompts can be read, copied and edited without losing source metadata or legacy editing', async t => {
  const original={schema:1,title:'雨爱高潮分镜',style:'米白纸纹与蓝灰水彩',audio:{sourceStart:47.24,sourceEnd:74.24},scenes:[{id:'s1',title:'窗上雨滴',prompt:'近景雨滴沿玻璃滑落，浅焦手绘线条。',transition:'沿雨滴匹配剪辑',duration:3},{id:'s2',title:'雨中背影',prompt:'蓝灰长街和人物背影，红围巾轻动。',transition:'纸页展开',duration:24}]},f=fixture(t)
  f.projects.set('lemo:p1',project('lemo:p1',{storyboard:clone(original)}));f.projects.set('quick:old',project('quick:old',{storyboard:{title:'原分镜',voiceover:'原旁白',scenes:[{id:'old',title:'原镜头',body:'原说明',duration:10}]}}));await f.view.open({id:'lemo:p1'});f.button('分镜').click()
  assert.equal(f.container.querySelectorAll('.sv-shot-prompt').length,2)
  f.button('复制镜头提示词',f.container.querySelector('.sv-scene')).click();await tick();assert.deepEqual(f.calls.find(([name])=>name==='copyText'),['copyText',original.scenes[0].prompt])
  f.button('复制完整分镜提示词').click();await tick();const whole=f.calls.filter(([name])=>name==='copyText').at(-1)[1];assert.match(whole,/米白纸纹/);assert.match(whole,/镜头 2 · 24 秒/);assert.match(whole,/纸页展开/)
  f.button('编辑分镜提示词').click();const prompt=f.input('镜头提示词','保持人物比例，雨滴沿镜头前景滑落。');prompt.focus();prompt.setSelectionRange(4,4);f.emit(project('lemo:p1',{storyboard:clone(original),messages:[{role:'assistant',content:'制作文件已读取'}]}));assert.equal(f.input('镜头提示词').selectionStart,4);assert.equal(f.view.canLeave(),false)
  f.button('保存分镜修改').click();await tick();const saved=f.calls.find(([name])=>name==='videoStudioSave');assert.equal(saved[2].storyboard.scenes[0].prompt,'保持人物比例，雨滴沿镜头前景滑落。');assert.deepEqual(saved[2].storyboard.audio,original.audio);assert.deepEqual(saved[2].storyboard.scenes[1],original.scenes[1]);assert.equal(f.view.canLeave(),true)
  assert.equal(f.calls.some(([name])=>name==='videoStudioSend'),false)
  await f.view.open({id:'quick:old'});f.button('分镜').click();f.button('编辑原有分镜').click();assert.equal(f.input('旁白文案').value,'原旁白');assert.equal(f.input('镜头说明').value,'原说明')
})

test('one workbench lists original and new projects and starts only after the user explicitly clicks Start', async t => {
  const f = fixture(t); await f.view.open()
  assert.equal(f.container.querySelectorAll('.sv-project').length, 3); assert.equal(f.container.querySelectorAll('.vs-hub-tab,.lemo-studio').length, 0)
  assert.equal(f.input('视频时长（秒）').value, '10'); assert.match(f.container.textContent, /统一 API 计费/); assert.doesNotMatch(f.container.textContent, /3 次|5 元|JSON|Lemo Studio/)
  assert.equal(f.calls.some(([name]) => name === 'videoStudioSend'), false)
  f.input('视频制作要求', '制作一支真实 AIPM 产品视频'); f.button('开始制作').click(); await tick()
  assert.equal(f.calls.filter(([name]) => name === 'videoStudioCreate').length, 1)
  assert.deepEqual(f.calls.find(([name]) => name === 'videoStudioSend'), ['videoStudioSend', 'lemo:new', '制作一支真实 AIPM 产品视频', { intent: 'create' }])
  assert.equal(f.container.querySelector('.sv-create-pane').hidden, true); assert.match(f.container.querySelector('.sv-messages').textContent, /真实 AIPM/)
  assert.equal(f.container.querySelector('[data-model-composer]').className, 'sv-model')
})

test('a failed first send keeps the already-created project and original instruction for retry without duplicate creation', async t => {
  let fail = true; const f = fixture(t, { videoStudioSend: (id, text) => { if (fail) throw new Error('统一模型暂时失败'); return project(id, { messages: [{ role: 'user', content: text }] }) } }); await f.view.open()
  f.input('视频制作要求', '失败后保留这段'); f.button('开始制作').click(); await tick()
  assert.equal(f.input('视频制作对话').value, '失败后保留这段'); assert.match(f.container.textContent, /统一模型暂时失败/); fail = false
  f.button('发送制作指令').click(); await tick(); assert.equal(f.calls.filter(([name]) => name === 'videoStudioCreate').length, 1); assert.equal(f.calls.filter(([name]) => name === 'videoStudioSend').length, 2); assert.equal(f.calls.filter(([name]) => name === 'videoStudioSend').at(-1)[3].intent, 'create')
})

test('pending creation and sending reject duplicate clicks and preserve a newly typed next message', async t => {
  const create = deferred(), send = deferred(), f = fixture(t, { videoStudioCreate: () => create.promise, videoStudioSend: () => send.promise }); await f.view.open()
  f.input('视频制作要求', '第一条要求'); const start = f.button('开始制作'); start.click(); start.click(); await tick(); assert.equal(f.calls.filter(([name]) => name === 'videoStudioCreate').length, 1)
  create.resolve(project('lemo:new')); await tick(); assert.equal(f.calls.filter(([name]) => name === 'videoStudioSend').length, 1)
  const input = f.input('视频制作对话', '后续补充'); input.focus(); input.setSelectionRange(2, 2)
  send.resolve(project('lemo:new', { status: 'running', chat: { status: 'running', messages: [], runs: [] } })); await tick()
  assert.equal(f.input('视频制作对话'), input); assert.equal(input.value, '后续补充'); assert.equal(input.selectionStart, 2)
})

test('real embedded video keeps its DOM node, playback position and URL through streamed chat and rendering progress', async t => {
  const p = project('lemo:p1', { versions: [version()], output: { files: [], lastVideo: version() } }), f = fixture(t, { videoStudioGet: () => p }); await f.view.open({ id: p.id }); await tick()
  const video = f.container.querySelector('video'); assert.equal(video.controls, true); assert.equal(video.playsInline, true); assert.match(video.src, /^aipm-media:/)
  video.currentTime = 4.25
  const input = f.input('视频制作对话', '改完后解释一下'); input.focus(); input.setSelectionRange(3, 3)
  f.emit({ ...p, status: 'running', chat: { status: 'running', messages: [], runs: [] }, messages: [{ role: 'assistant', content: '正在修改真实文件' }], production: { status: 'running', message: '正在生成新版画面' } })
  assert.equal(f.container.querySelector('video'), video); assert.equal(video.currentTime, 4.25); assert.equal(f.calls.filter(([name]) => name === 'videoStudioPreview').length, 1)
  assert.match(f.container.querySelector('.sv-preview-notice').textContent, /保留上一次成片/); assert.equal(input.value, '改完后解释一下'); assert.equal(input.selectionStart, 3)
  f.button('放大预览').click(); assert.equal(f.container.querySelector('.sv-chat').hidden, true); assert.equal(f.container.querySelector('video'), video); f.button('返回对话').click()
})

test('a locally recovered movie plays without stale pause and error prompts while a newer failure stays visible', async t => {
  const p=project('lemo:p1',{status:'completed',recoveredChat:true,error:null,chat:{status:'paused',error:'旧轮次上限',pause:{reason:'旧轮次已暂停'},messages:[],runs:[]},versions:[version()],output:{files:[],lastVideo:version()},production:{status:'completed',message:'影片已完成'}})
  const f=fixture(t,{videoStudioGet:()=>p});await f.view.open({id:p.id});await tick()
  assert.equal(f.container.querySelector('.sv-error').hidden,true)
  assert.equal([...f.container.querySelectorAll('button')].some(n=>n.textContent==='继续制作'),false)
  assert.match(f.container.querySelector('video').src,/^aipm-media:/)
  f.emit({...p,status:'failed',recoveredChat:false,error:'新轮次真实失败',chat:{...p.chat,status:'failed',error:'新轮次真实失败'}})
  assert.match(f.container.querySelector('.sv-error').textContent,/新轮次真实失败/)
})

test('new output versions replace the media only after a controlled preview URL is returned, and export follows the selection', async t => {
  const first = version(), second = version('lemo:job2'), f = fixture(t); f.projects.set('lemo:p1', project('lemo:p1', { versions: [first], output: { files: [], lastVideo: first } })); await f.view.open({ id: 'lemo:p1' }); await tick()
  const video = f.container.querySelector('video'), prior = video.src
  f.emit(project('lemo:p1', { versions: [first, second], output: { files: [], lastVideo: second } })); await tick(); assert.equal(f.calls.filter(([name]) => name === 'videoStudioPreview').length, 2)
  f.input('预览版本', 'lemo:job1'); await tick(); assert.deepEqual(f.calls.filter(([name]) => name === 'videoStudioPreview').at(-1), ['videoStudioPreview', 'lemo:p1', 'lemo:job1'])
  f.input('导出内容', 'project'); f.button('导出').click(); await tick(); assert.deepEqual(f.calls.find(([name]) => name === 'videoStudioExport'), ['videoStudioExport', 'lemo:p1', 'lemo:job1', 'project']); assert.ok(prior)
})

test('a retained invalid version is visible but cannot preview or export, without deleting its history', async t => {
  const failed = { ...version('quick:v1'), ready: false, validation: { state: 'failed', message: '画面重复，原版本保留' } }, good = version('quick:v2'), f = fixture(t); f.projects.set('quick:old', project('quick:old', { versions: [failed, good], output: { files: [], lastVideo: good } })); await f.view.open({ id: 'quick:old' }); await tick()
  f.input('预览版本', 'quick:v1'); assert.match(f.container.textContent, /画面重复，原版本保留/); assert.equal(f.button('导出').disabled, true); assert.equal(f.container.querySelector('video').getAttribute('src'), null)
  assert.equal(f.calls.some(([name, , selected]) => name === 'videoStudioPreview' && selected === 'quick:v1'), false)
  f.button('历史版本').click(); assert.equal(f.container.querySelectorAll('.sv-version').length, 2)
})

test('unsafe or unavailable preview URLs never become media sources and retry remains explicit', async t => {
  let previews = 0; const f = fixture(t, { videoStudioPreview: () => { previews++; return { url: 'https://untrusted.example/video.mp4' } } }); const p = project('lemo:p1', { versions: [version()], output: { files: [], lastVideo: version() } }); f.projects.set(p.id, p)
  await f.view.open({ id: p.id }); await tick(); assert.equal(f.container.querySelector('video').getAttribute('src'), null); assert.match(f.container.textContent, /受控成片地址/)
  f.emit({ ...p, messages: [{ role: 'assistant', content: '继续显示消息' }] }); await tick(); assert.equal(previews, 1)
  f.button('重新加载成片').click(); await tick(); assert.equal(previews, 2)
})

test('late project and preview reads cannot replace a newly selected project or steal its draft', async t => {
  const read = deferred(), preview = deferred(), f = fixture(t, { videoStudioGet: id => id === 'quick:old' ? read.promise : project(id, { output: { files: [], lastVideo: version() } }), videoStudioPreview: () => preview.promise }); await f.view.open()
  const older = f.view.open({ id: 'quick:old' }); await tick(); await f.view.open({ id: 'motion:old' }); f.input('视频制作对话', '当前项目草稿')
  read.resolve(project('quick:old')); await older; preview.resolve({ url: 'aipm-media://local/current', version: 'v1' }); await tick()
  assert.equal(f.input('视频制作对话').value, '当前项目草稿'); assert.equal(f.container.querySelector('.sv-title').textContent, 'AIPM 介绍视频'); assert.equal(f.calls.some(([name, id]) => name === 'videoStudioPreview' && id === 'quick:old'), false)
})

test('inline approvals and cancellation target the same Pi-backed video project without leaving for main chat', async t => {
  const p = project('lemo:p1', { status: 'waiting', pending: { token: 'approval1', reason: '核对操作范围', command: '保存已确认的项目文件' }, chat: { status: 'waiting', runs: [] } }), f = fixture(t); f.projects.set(p.id, p); await f.view.open({ id: p.id })
  f.button('不执行').click(); await tick(); assert.deepEqual(f.calls.find(([name]) => name === 'videoStudioReply'), ['videoStudioReply', p.id, 'approval1', false])
  f.button('停止视频制作').click(); await tick(); assert.deepEqual(f.calls.find(([name]) => name === 'videoStudioCancel'), ['videoStudioCancel', p.id]); assert.match(f.container.querySelector('.sv-status').textContent, /已停止/)
})

test('assets and actual files remain in the same workspace; source HTML is never injected as an application page', async t => {
  const f = fixture(t); f.projects.set('lemo:p1', project('lemo:p1', { output: { files: [{ name: '制作说明.md', kind: 'text', path: '/safe/制作说明.md' }] } })); await f.view.open({ id: 'lemo:p1' }); f.button('素材与文件').click(); f.button('导入素材').click(); await tick()
  assert.match(f.container.textContent, /真实页面.png/); f.button('阅读').click(); await tick(); assert.match(f.container.querySelector('.sv-output-detail').textContent, /本地文件内容/); assert.equal(f.container.querySelectorAll('script,iframe').length, 0)
  assert.deepEqual(f.calls.find(([name]) => name === 'videoStudioRead'), ['videoStudioRead', 'lemo:p1', '/safe/制作说明.md'])
})

test('legacy storyboard editing survives progress and only explicit save changes the project', async t => {
  const p = project('quick:old', { storyboard: { title: '原有脚本', scenes: [{ id: 's1', title: '原镜头', body: '原说明', duration: 10 }] } }), f = fixture(t); f.projects.set(p.id, p); await f.view.open({ id: p.id }); f.button('分镜').click(); f.button('编辑原有分镜').click()
  const field = f.input('镜头标题', '保留的新标题'); field.focus(); field.setSelectionRange(2, 2); f.emit({ ...p, messages: [{ role: 'assistant', content: '读取完成' }] })
  assert.equal(f.input('镜头标题').value, '保留的新标题'); assert.equal(f.input('镜头标题').selectionStart, 2); assert.equal(f.view.canLeave(), false); assert.equal(f.calls.some(([name]) => name === 'videoStudioSave'), false)
  f.button('保存分镜修改').click(); await tick(); assert.equal(f.calls.find(([name]) => name === 'videoStudioSave')[2].storyboard.scenes[0].title, '保留的新标题'); assert.equal(f.view.canLeave(), true)
})

test('ordinary follow-ups use backend intent inference while Generate New Version is an explicit revise action', async t => {
  const p = project('lemo:p1', { versions: [version()], output: { files: [], lastVideo: version() } }), f = fixture(t, { videoStudioSend: id => project(id, { versions: [version()], output: { files: [], lastVideo: version() } }) }); f.projects.set(p.id, p); await f.view.open({ id: p.id }); await tick()
  f.input('视频制作对话', '你生成了什么？'); f.button('发送制作指令').click(); await tick(); assert.deepEqual(f.calls.find(([name]) => name === 'videoStudioSend'), ['videoStudioSend', p.id, '你生成了什么？'])
  f.button('生成新版本').click(); await tick(); assert.equal(f.calls.filter(([name]) => name === 'videoStudioSend').at(-1)[3].intent, 'revise')
})

test('route compatibility opens old plain ids in the unified catalog, and hide preserves drafts without cancelling work', async t => {
  const f = fixture(t); await f.view.open({ mode: 'lemo', id: 'p1' }); assert.deepEqual(f.calls.find(([name]) => name === 'videoStudioGet'), ['videoStudioGet', 'lemo:p1'])
  f.input('视频制作对话', '留到稍后发送'); f.view.hide(); await f.view.open(); assert.equal(f.input('视频制作对话').value, '留到稍后发送'); assert.equal(f.view.canLeave(), false)
  assert.equal(f.calls.some(([name]) => name === 'videoStudioCancel'), false); f.view.destroy(); assert.equal(f.unsubscribed, true)
})

test('local output inspection and the original storyboard renderer remain explicit operations without model requests', async t => {
  const p = project('quick:old', { storyboard: { scenes: [{ id: 's1', title: '原镜头', duration: 10 }] } }), f = fixture(t); f.projects.set(p.id, p); await f.view.open({ id: p.id })
  f.button('检查本地成片').click(); await tick(); assert.deepEqual(f.calls.find(([name]) => name === 'videoStudioRender'), ['videoStudioRender', p.id])
  f.projects.set(p.id, p); f.emit(p); f.button('分镜').click(); f.button('按分镜渲染').click(); await tick(); assert.deepEqual(f.calls.filter(([name]) => name === 'videoStudioRender').at(-1), ['videoStudioRender', p.id, { storyboard: true }])
  assert.equal(f.calls.some(([name]) => name === 'videoStudioSend'), false)
})

test('a late send failure belongs to its original project and cannot mark a newly selected project failed', async t => {
  const pending = deferred(), f = fixture(t, { videoStudioSend: () => pending.promise }); await f.view.open({ id: 'quick:old' }); f.input('视频制作对话', '保留给原项目'); f.button('发送制作指令').click(); await tick()
  await f.view.open({ id: 'motion:old' }); f.input('视频制作对话', '当前项目新草稿'); pending.reject(new Error('原请求失败')); await tick()
  assert.equal(f.input('视频制作对话').value, '当前项目新草稿'); assert.equal(f.container.querySelector('.sv-error').hidden, true); assert.match(f.toasts.at(-1), /原有页面介绍.*原请求失败/)
})

test('original storyboard palettes, narration, visual types, bullets and imported-image assignment remain editable', async t => {
  const board = { title: '旧标题', voiceover: '旧旁白', palette: { background: '#10131d', accent: '#8eb9ff', text: '#ffffff' }, scenes: [{ id: 's1', title: '镜头', duration: 10, kind: 'showcase', accent: '#ffcc00', assetId: 'a1', bullets: ['旧要点'] }] }
  const p = project('quick:old', { storyboard: board, assets: [{ id: 'a1', name: '真实页面.png' }] }), f = fixture(t); f.projects.set(p.id, p); await f.view.open({ id: p.id }); f.button('分镜').click(); f.button('编辑原有分镜').click()
  f.input('旁白文案', '新的旁白'); f.input('背景色', '#f4f0e7'); f.input('镜头类型 1', 'hero'); f.input('镜头要点 1', '第一点\n第二点'); f.input('画面素材 1', ''); f.button('保存分镜修改').click(); await tick()
  const saved = f.calls.find(([name]) => name === 'videoStudioSave')[2].storyboard
  assert.equal(saved.voiceover, '新的旁白'); assert.equal(saved.palette.background, '#f4f0e7'); assert.equal(saved.scenes[0].kind, 'hero'); assert.deepEqual(saved.scenes[0].bullets, ['第一点', '第二点']); assert.equal(Object.hasOwn(saved.scenes[0], 'assetId'), false)
})

test('empty chat welcomes ready historical films as playable while unfinished projects retain the creation guidance', async t => {
  const f = fixture(t); f.projects.set('motion:old', project('motion:old', { versions: [version('motion:current')], output: { files: [], lastVideo: version('motion:current') } }))
  await f.view.open({ id: 'motion:old' }); assert.match(f.container.querySelector('.sv-chat-welcome').textContent, /这支影片已可播放.*提出修改/)
  await f.view.open({ id: 'lemo:p1' }); assert.match(f.container.querySelector('.sv-chat-welcome').textContent, /项目已建立.*导入页面截图/)
  assert.equal(f.calls.some(([name]) => name === 'videoStudioSend'), false)
})
