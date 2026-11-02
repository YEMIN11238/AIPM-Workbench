/** Keyless recordings of video drafts, host events, budgets and native output actions. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { mountVideo } from './video-legacy.mjs'

const settle = () => new Promise(resolve => setTimeout(resolve, 12))
const clone = value => structuredClone(value)
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const storyboard = () => ({ title: 'AIPM 工作台', voiceover: '用一句话开始工作。', palette: { background: '#121624', accent: '#91baff', text: '#ffffff' }, scenes: [
  { id: 's1', duration: 3, title: 'AIPM 工作台', subtitle: '想法变为行动', body: '开场介绍', kind: 'hero', accent: '#91baff' },
  { id: 's2', duration: 4, title: '在同一工作区推进', subtitle: '聊天与项目', body: '展示实际页面', kind: 'showcase', accent: '#91baff', bullets: ['真实执行', '保留资料'] },
  { id: 's3', duration: 3, title: '从今天开始', subtitle: '', body: '收尾', kind: 'outro', accent: '#91baff' },
] })
const project = (id = 'video1') => ({ id, title: id === 'video1' ? 'AIPM 工作台介绍' : '另一支视频', brief: '介绍产品界面与真实功能', duration: 10, style: 'glass', width: 1920, height: 1080, status: 'idle', messages: [], storyboard: null, versions: [], assets: [], budget: { limitYuan: 5, reservedYuan: 0, spentUpperBoundYuan: 0, entries: [], trial: { limitYuan: 5, reservedYuan: 0, spentUpperBoundYuan: 0, remainingYuan: 5, requestsUsed: 0, maxRequests: 3 } }, updatedAt: '2026-10-26T09:00:00Z' })
function fixture(t, overrides = {}) {
  const dom = new JSDOM('<main id="video"></main>', { pretendToBeVisual: true }); globalThis.window = dom.window; globalThis.document = dom.window.document
  const projects = new Map([['video1', project()], ['video2', project('video2')]]), calls = [], toasts = [], openedChats = []; let listener, unsubscribed = 0
  const defaults = {
    videoList: () => [...projects.values()], videoGet: id => projects.get(id),
    videoCreate: input => { const p = { ...project('video3'), ...input }; projects.set(p.id, p); return p },
    videoSend: (id, text) => { const p = projects.get(id); p.messages.push({ role: 'user', content: text }); p.status = 'generating'; return p },
    videoSaveStoryboard: (id, { storyboard }) => { const p = projects.get(id); p.storyboard = storyboard; return p },
    videoRender: id => { const p = projects.get(id); p.status = 'rendering'; p.progress = { phase: 'render', ratio: .05, message: '准备渲染' }; return p },
    videoCancel: id => { const p = projects.get(id); p.status = 'cancelled'; return p },
    videoImport: id => { const p = projects.get(id); p.assets.push({ id: 'a1', path: '/safe/assets/page.png', type: 'image', name: '页面截图' }); return p },
    motionProjects: () => [],
    motionSkillInfo: () => ({ name: 'motion-design-prompt-generator', ready: true, designSystems: ['swiss-kinetic', 'bold-poster', 'data-instrument', 'drafting-table', 'editorial-ink', 'riso-halftone', 'storybook-scene'].map(id => ({ id, name: id })), capabilities: ['完整动画代码', '形变与音效'], limitations: ['实际效果需要逐帧检查。'] }),
    motionSkillRead: name => ({ name, content: '# 完整动效 Skill\n\n先建立艺术方向，再编写动画代码。<script>bad()</script>' }),
    motionPrepare: () => ({ id: 'motion-project', chatId: 'motion-chat', cwd: '/safe/motion', prompt: '请按完整 Skill 制作动效。' }), openLink: () => true,
    motionOutput: () => ({ status: 'pending', message: '尚无本机成片' }), motionPreview: () => true,
    motionGenerate: () => ({ status: 'completed', requestId: 'generation1', responsePath: '/safe/motion/response.md', budget: { spentUpperBoundYuan: .24, remainingYuan: 4.76 }, files: [] }),
    videoPreview: () => true, videoExport: () => ({ folder: '/safe/export' }), videoOpenFolder: () => true, copyText: () => true,
  }
  const api = async (name, ...args) => { calls.push([name, ...args]); const fn = overrides[name] || defaults[name]; assert.equal(typeof fn, 'function', 'unexpected API ' + name); return clone(await fn(...args)) }
  const view = mountVideo({ container: document.querySelector('#video'), api, lemoFactory: overrides.lemoFactory, openChat: (id, draft) => { openedChats.push([id, draft]); return overrides.openChat ? overrides.openChat(id, draft) : true }, events: { onVideoUpdate: callback => { listener = callback; return () => { unsubscribed++; listener = null } } }, toast: text => toasts.push(text) })
  const button = label => { const node = [...document.querySelectorAll('button')].find(node => node.textContent === label); assert.ok(node, 'button ' + label); return node }
  const input = (label, value) => { const node = document.querySelector(`[aria-label="${label}"]`); assert.ok(node, 'input ' + label); if (value !== undefined) { node.value = value; node.dispatchEvent(new dom.window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) } return node }
  t.after(() => { view.destroy(); dom.window.close(); delete globalThis.window; delete globalThis.document })
  return { view, projects, calls, toasts, openedChats, dom, button, input, emit: value => listener?.(clone(value)), get unsubscribed() { return unsubscribed } }
}

test('new video defaults to the authorized ten-second five-yuan glass project and never generates automatically', async t => {
  const { view, input, button, calls } = fixture(t); await view.open()
  assert.match(document.body.textContent, /动效参考 · motion-design-prompt-generator/); assert.equal(input('时长（秒）').value, '10'); assert.equal(input('预算上限（元）').value, '5')
  input('视频名称', 'AIPM 宣传片'); input('视频想介绍什么', '介绍玻璃页面和已验证功能'); button('建立视频项目').click(); await settle()
  assert.deepEqual(calls.find(([name]) => name === 'videoCreate').slice(1), [{ title: 'AIPM 宣传片', brief: '介绍玻璃页面和已验证功能', duration: 10, budgetYuan: 5, style: 'glass', width: 1920, height: 1080 }])
  assert.equal(calls.some(([name]) => ['videoSend', 'videoRender'].includes(name)), false); assert.ok(button('生成分镜')); assert.equal(view.canLeave(), true)
  assert.match(document.body.textContent, /本次试做总预算 ¥5/)
})

test('explicit generation blocks duplicate paid requests, streams actual progress, and preserves the next message draft and caret', async t => {
  const { view, projects, button, input, calls, emit } = fixture(t); await view.open({ id: 'video1' })
  button('生成分镜').click(); await settle(); assert.equal(calls.filter(([name]) => name === 'videoSend').length, 1)
  assert.equal(button('发送').disabled, true); button('发送').click(); await settle(); assert.equal(calls.filter(([name]) => name === 'videoSend').length, 1)
  const area = input('继续修改视频', '背景再透明一点'); area.focus(); area.setSelectionRange(2, 5)
  const p = clone(projects.get('video1')); p.messages.push({ role: 'assistant', content: '正在构思分镜。' }); p.progress = { phase: 'storyboard', ratio: .4, message: '整理镜头' }; emit(p)
  const restored = input('继续修改视频'); assert.equal(restored.value, '背景再透明一点'); assert.equal(restored.selectionStart, 2); assert.equal(document.activeElement, restored)
  assert.equal(document.querySelector('progress').value, .4); assert.match(document.body.textContent, /40%/)
  p.status = 'idle'; p.storyboard = storyboard(); p.messages.at(-1).content = '**分镜已生成**。<img src=x onerror=bad()>'; emit(p)
  assert.match(document.body.textContent, /在同一工作区推进/); assert.equal(document.querySelector('.vs-messages img'), null)
  button('发送').click(); await settle(); assert.deepEqual(calls.filter(([name]) => name === 'videoSend').at(-1).slice(1), ['video1', '背景再透明一点']); assert.equal(input('继续修改视频').value, '')
})

test('failed or unknown request errors leave the submitted draft available and do not claim completion', async t => {
  const { view, input, button, toasts } = fixture(t, { videoSend: () => { throw {} } }); await view.open({ id: 'video1' })
  input('继续修改视频', '不能丢掉的分镜要求'); button('发送').click(); await settle()
  assert.equal(input('继续修改视频').value, '不能丢掉的分镜要求'); assert.match(document.body.textContent, /操作未完成，请重试/); assert.match(toasts.at(-1), /操作未完成/)
  assert.equal(view.canLeave(), false); assert.equal(button('发送').disabled, false); assert.doesNotMatch(document.body.textContent, /成片已生成/)
})

test('storyboard edits survive asynchronous updates and require an explicit save before render', async t => {
  const { view, projects, input, button, calls, emit } = fixture(t); const p = projects.get('video1'); p.storyboard = storyboard(); await view.open({ id: p.id })
  button('编辑分镜').click(); input('镜头标题 1', '让想法真正落地'); input('镜头时长 1', '3'); input('旁白文案', '这是新的旁白。')
  assert.equal(button('渲染视频').disabled, true); assert.equal(view.canLeave(), false)
  const next = clone(p); next.storyboard.scenes[0].title = '后台另一个版本'; next.updatedAt = '2026-10-26T09:01:00Z'; emit(next)
  assert.equal(input('镜头标题 1').value, '让想法真正落地'); assert.match(document.body.textContent, /你正在编辑的内容已保留/)
  button('保存分镜修改').click(); await settle()
  const saved = calls.find(([name]) => name === 'videoSaveStoryboard')[2].storyboard; assert.equal(saved.scenes[0].title, '让想法真正落地'); assert.equal(saved.voiceover, '这是新的旁白。')
  assert.equal(view.canLeave(), true); assert.equal(button('渲染视频').disabled, false)
})

test('an in-flight storyboard save does not erase newer edits', async t => {
  const saving = deferred(); const { view, projects, input, button } = fixture(t, { videoSaveStoryboard: () => saving.promise })
  const p = projects.get('video1'); p.storyboard = storyboard(); await view.open({ id: p.id }); button('编辑分镜').click(); input('镜头标题 1', '第一次编辑'); button('保存分镜修改').click(); await Promise.resolve()
  input('镜头标题 1', '保存期间的新编辑'); saving.resolve({ ...p, storyboard: storyboard() }); await settle()
  assert.equal(input('镜头标题 1').value, '保存期间的新编辑'); assert.equal(view.canLeave(), false)
})

test('render cancellation, native preview and each export target the selected real output version', async t => {
  const { view, projects, button, input, calls, emit } = fixture(t); const p = projects.get('video1'); p.storyboard = storyboard(); await view.open({ id: p.id })
  button('渲染视频').click(); await settle(); assert.match(document.body.textContent, /正在渲染/); assert.equal(button('渲染视频').disabled, true)
  button('停止当前任务').click(); await settle(); assert.deepEqual(calls.find(([name]) => name === 'videoCancel').slice(1), ['video1']); assert.match(document.body.textContent, /任务已停止/)
  p.status = 'completed'; p.versions = [{ version: 'v1', videoPath: '/safe/v1.mp4', duration: 10, width: 1920, height: 1080, createdAt: '2026-10-26T09:00:00Z' }, { version: 'v2', videoPath: '/safe/v2.mp4', duration: 10, width: 1920, height: 1080, createdAt: '2026-10-26T09:01:00Z' }]; emit(p)
  button('预览与导出').click(); input('成片版本', 'v1'); button('打开视频预览').click(); await settle(); assert.deepEqual(calls.find(([name]) => name === 'videoPreview').slice(1), ['video1', 'v1'])
  for (const [label, kind] of [['导出 MP4', 'video'], ['导出可编辑工程', 'project'], ['导出视频与工程', 'bundle']]) { button(label).click(); await settle(); assert.deepEqual(calls.filter(([name]) => name === 'videoExport').at(-1).slice(1), ['video1', 'v1', kind]) }
  button('复制视频路径').click(); await settle(); assert.deepEqual(calls.find(([name]) => name === 'copyText').slice(1), ['/safe/v1.mp4'])
  assert.equal(document.querySelector('video'), null)
})

test('budget shows a trial-wide conservative upper bound and uncertain charges without asserting a paid bill', async t => {
  const { view, projects, button } = fixture(t); const p = projects.get('video1'); p.budget.spentUpperBoundYuan = .35; p.budget.reservedYuan = .2; p.budget.trial = { limitYuan: 5, remainingYuan: 4.45, requestsUsed: 2, maxRequests: 3 }
  p.budget.entries = [{ id: 'request1', model: '统一模型', status: 'uncertain', reservedYuan: .35, chargedUpperBoundYuan: .35, usage: { input_tokens: 100 }, note: '请求失联，未重发' }]
  await view.open({ id: p.id }); button('预算用量').click()
  assert.match(document.body.textContent, /累计上界 ¥0.35/); assert.match(document.body.textContent, /本轮预留 ¥0.2/); assert.match(document.body.textContent, /模型请求 2\/3/); assert.match(document.body.textContent, /不是供应商账单/)
  assert.match(document.body.textContent, /用量未完全确认，按预留计入上界/); assert.match(document.body.textContent, /请求失联，未重发/)
})

test('image import is available before generation and imported material can be assigned to a scene', async t => {
  const { view, projects, button, input, calls, emit } = fixture(t); await view.open({ id: 'video1' }); button('导入图片素材').click(); await settle()
  assert.deepEqual(calls.find(([name]) => name === 'videoImport').slice(1), ['video1'])
  const p = projects.get('video1'); p.storyboard = storyboard(); emit(p); button('编辑分镜').click(); input('画面素材 1', 'a1'); button('保存分镜修改').click(); await settle()
  assert.equal(calls.find(([name]) => name === 'videoSaveStoryboard')[2].storyboard.scenes[0].assetId, 'a1')
})

test('late project reads and action results cannot replace a newer project or its draft', async t => {
  const read = deferred(), send = deferred(); let count = 0
  const { view, input, button, projects } = fixture(t, { videoGet: id => ++count === 1 ? read.promise : project(id), videoSend: () => send.promise })
  const first = view.open({ id: 'video1' }); await Promise.resolve(); await view.open({ id: 'video2' }); input('继续修改视频', '第二个项目的草稿')
  read.resolve(project('video1')); await first; assert.equal(input('继续修改视频').value, '第二个项目的草稿'); assert.match(document.querySelector('.vs-title').textContent, /另一支视频/)
  button('发送').click(); await Promise.resolve(); document.querySelector('[data-video-id="video1"]').click(); await settle(); input('继续修改视频', '第一个项目的新草稿')
  send.resolve({ ...projects.get('video2'), status: 'generating' }); await settle(); assert.equal(input('继续修改视频').value, '第一个项目的新草稿'); assert.equal(document.querySelector('.vs-title').textContent, 'AIPM 工作台介绍')
})

test('project switches and hide preserve drafts; reopening fetches saved progress and destroy unsubscribes', async t => {
  const f = fixture(t); const { view, input, projects } = f; await view.open({ id: 'video1' }); input('继续修改视频', '稍后再发送')
  document.querySelector('[data-video-id="video2"]').click(); await settle(); document.querySelector('[data-video-id="video1"]').click(); await settle(); assert.equal(input('继续修改视频').value, '稍后再发送')
  view.hide(); projects.get('video1').status = 'rendering'; projects.get('video1').progress = { ratio: .7, message: '编码中' }; await view.open({ id: 'video1' })
  assert.equal(input('继续修改视频').value, '稍后再发送'); assert.match(document.body.textContent, /编码中/); assert.equal(document.querySelector('progress').value, .7)
  view.destroy(); assert.equal(f.unsubscribed, 1); assert.equal(document.querySelector('.video-studio'), null); assert.equal(await view.open(), false)
})

test('the shared trial request cap disables generation while keeping local storyboard editing and render available', async t => {
  const { view, projects, button, calls, input } = fixture(t); const p = projects.get('video1'); p.storyboard = storyboard(); p.budget.trial.requestsUsed = 3
  await view.open({ id: p.id }); assert.equal(button('发送').disabled, true); assert.equal(button('生成分镜').disabled, true)
  assert.equal(button('编辑分镜').disabled, false); assert.equal(button('渲染视频').disabled, false)
  input('继续修改视频', '不要再收费生成'); button('发送').click(); await settle(); assert.equal(calls.some(([name]) => name === 'videoSend'), false)
  assert.match(document.body.textContent, /已达到模型请求次数或预算上限/)
})

test('removing a scene image omits its asset reference rather than saving an invalid empty identifier', async t => {
  const { view, projects, button, input, calls } = fixture(t); const p = projects.get('video1'); p.storyboard = storyboard(); p.assets = [{ id: 'a1', name: '实际页面', path: '/safe/page.png', type: 'image' }]; p.storyboard.scenes[0].assetId = 'a1'
  await view.open({ id: p.id }); button('编辑分镜').click(); input('画面素材 1', ''); button('保存分镜修改').click(); await settle()
  assert.equal('assetId' in calls.find(([name]) => name === 'videoSaveStoryboard')[2].storyboard.scenes[0], false)
})

test('a failed visual check labels the retained version and blocks its preview and exports without blocking a new render', async t => {
  const { view, projects, button, input, calls } = fixture(t); const p = projects.get('video1'); p.storyboard = storyboard(); p.status = 'completed'
  p.versions = [
    { version: 'v1', videoPath: '/safe/v1.mp4', validation: { state: 'failed', message: '展示镜头出现画面重复，已由新版本修复' } },
    { version: 'v2', videoPath: '/safe/v2.mp4' },
  ]
  await view.open({ id: p.id }); button('预览与导出').click()
  assert.equal(button('打开视频预览').disabled, false)
  input('成片版本', 'v1'); assert.match(input('成片版本').selectedOptions[0].textContent, /画面检查未通过/)
  assert.match(document.body.textContent, /展示镜头出现画面重复，已由新版本修复/)
  for (const label of ['打开视频预览', '导出 MP4', '导出可编辑工程', '导出视频与工程']) { assert.equal(button(label).disabled, true); button(label).click() }
  await settle(); assert.equal(calls.some(([name]) => ['videoPreview', 'videoExport'].includes(name)), false)
  input('成片版本', 'v2'); for (const label of ['打开视频预览', '导出 MP4', '导出可编辑工程', '导出视频与工程']) assert.equal(button(label).disabled, false)
  assert.doesNotMatch(document.querySelector('.vs-output').querySelector('[role="alert"]')?.textContent || '', /画面重复/)
  button('分镜').click(); assert.equal(button('渲染视频').disabled, false); assert.equal(button('编辑分镜').disabled, false)
})

test('the full Motion Skill is an optional in-page mode that prepares one-sentence projects and only prefills a chat', async t => {
  const { view, button, input, calls, openedChats } = fixture(t); await view.open()
  assert.equal(calls.some(([name]) => name === 'motionSkillInfo'), false)
  document.querySelector('[data-video-details="full-motion-skill"] > summary').click(); await settle()
  assert.match(document.body.textContent, /完整动画代码/); assert.match(document.body.textContent, /7 种设计风格/); assert.match(document.body.textContent, /独立于快速视频试做额度/)
  assert.equal(input('动效设计风格').value, 'swiss-kinetic'); assert.equal(input('动效时长（秒）').value, '10')
  input('用一句话描述动效', '用形变和字体介绍 AIPM'); button('新建动效工程并打开聊天').click(); await settle()
  assert.deepEqual(calls.find(([name]) => name === 'motionPrepare').slice(1), [{ title: '用形变和字体介绍 AIPM', brief: '用形变和字体介绍 AIPM', duration: 10, designSystem: 'swiss-kinetic' }])
  assert.deepEqual(openedChats, [['motion-chat', '请按完整 Skill 制作动效。']]); assert.equal(calls.some(([name]) => ['piSend', 'videoSend', 'videoRender'].includes(name)), false)
  assert.equal(view.canLeave(), true)
  button('查看完整 Skill').click(); await settle(); assert.deepEqual(calls.find(([name]) => name === 'motionSkillRead').slice(1), ['SKILL.md']); assert.match(document.body.textContent, /先建立艺术方向/); assert.equal(document.querySelector('.vs-details script'), null)
})

test('Motion Skill preparation errors preserve input and an existing prepared chat can be reopened without creating again', async t => {
  let attempts = 0
  const { view, button, input, calls, openedChats } = fixture(t, { motionPrepare: () => { if (++attempts === 1) throw new Error('工程暂时无法建立'); return { chatId: 'saved-motion', prompt: '待发送指令' } }, openChat: () => false })
  await view.open({ id: 'video1' }); document.querySelector('[data-video-details="full-motion-skill"] > summary').click(); await settle()
  input('用一句话描述动效', '一支数据故事'); button('新建动效工程并打开聊天').click(); await settle()
  assert.equal(input('用一句话描述动效').value, '一支数据故事'); assert.match(document.body.textContent, /工程暂时无法建立/); assert.equal(openedChats.length, 0)
  button('新建动效工程并打开聊天').click(); await settle(); button('打开已建立的动效聊天').click(); await settle()
  assert.equal(calls.filter(([name]) => name === 'motionPrepare').length, 2); assert.deepEqual(openedChats, [['saved-motion', '待发送指令'], ['saved-motion', '待发送指令']])
})

test('a delayed Motion Skill preparation preserves new input and never steals a newer project route', async t => {
  const preparing = deferred(); const { view, button, input, openedChats, calls } = fixture(t, { motionPrepare: () => preparing.promise })
  await view.open(); document.querySelector('[data-video-details="full-motion-skill"] > summary').click(); await settle(); input('用一句话描述动效', '原始制作要求')
  button('新建动效工程并打开聊天').click(); await Promise.resolve(); input('用一句话描述动效', '等待期间的新要求')
  document.querySelector('[data-video-id="video2"]').click(); await settle(); preparing.resolve({ chatId: 'prepared-late', prompt: '较早的指令' }); await settle()
  assert.equal(openedChats.length, 0); assert.equal(input('用一句话描述动效').value, '等待期间的新要求'); assert.equal(document.querySelector('.vs-title').textContent, '另一支视频')
  assert.equal(calls.filter(([name]) => name === 'motionPrepare').length, 1)
})

test('budgeted motion drafts reuse the same prepared project and do not open chat, execute or render', async t => {
  let prepared = 0
  const { view, button, input, calls, openedChats } = fixture(t, { motionPrepare: () => ({ id: 'prepared-' + ++prepared, chatId: 'chat-' + prepared, prompt: '未发送指令' }) })
  await view.open(); document.querySelector('[data-video-details="full-motion-skill"] > summary').click(); await settle()
  input('用一句话描述动效', '米白黑字与荧光黄的 AIPM 短片'); button('生成动效草稿（预算内）').click(); await settle()
  assert.deepEqual(calls.find(([name]) => name === 'motionGenerate'), ['motionGenerate', { projectId: 'prepared-1' }]); assert.equal(openedChats.length, 0)
  assert.equal(input('用一句话描述动效').value, '米白黑字与荧光黄的 AIPM 短片'); assert.match(document.body.textContent, /动效草稿已保存，待检查后渲染/)
  assert.match(document.body.textContent, /尚未执行或覆盖工程源码/); assert.match(document.body.textContent, /\/safe\/motion\/response.md/); assert.match(document.body.textContent, /累计费用上界 ¥0.24/)
  assert.equal(view.canLeave(), true)
  button('生成动效草稿（预算内）').click(); await settle(); assert.equal(calls.filter(([name]) => name === 'motionPrepare').length, 1); assert.equal(calls.filter(([name]) => name === 'motionGenerate').length, 2)
  input('动效名称（可选）', '另一份动效草稿'); button('生成动效草稿（预算内）').click(); await settle(); assert.equal(calls.filter(([name]) => name === 'motionPrepare').length, 2); assert.deepEqual(calls.filter(([name]) => name === 'motionGenerate').at(-1), ['motionGenerate', { projectId: 'prepared-2' }])
  assert.equal(calls.some(([name]) => ['piSend', 'videoSend', 'videoRender'].includes(name)), false)
  button('打开已建立的动效聊天').click(); await settle(); assert.deepEqual(openedChats, [['chat-2', '未发送指令']])
})

test('pending budgeted generation blocks duplicates and leaving, while newer unsaved form edits remain intact', async t => {
  const generating = deferred(); const { view, button, input, calls } = fixture(t, { motionGenerate: () => generating.promise })
  await view.open(); document.querySelector('[data-video-details="full-motion-skill"] > summary').click(); await settle()
  input('用一句话描述动效', '提交的草稿要求'); button('生成动效草稿（预算内）').click(); await settle()
  assert.equal(button('正在生成动效草稿…').disabled, true); assert.equal(button('新建动效工程并打开聊天').disabled, true); assert.equal(view.canLeave(), false)
  button('正在生成动效草稿…').click(); await settle(); assert.equal(calls.filter(([name]) => name === 'motionGenerate').length, 1)
  input('用一句话描述动效', '请求期间的新要求'); generating.resolve({ status: 'completed', responsePath: '/safe/saved-response.md', budget: { spentUpperBoundYuan: .2 } }); await settle()
  assert.equal(input('用一句话描述动效').value, '请求期间的新要求'); assert.equal(view.canLeave(), false)
})

test('a failed budgeted request preserves its prepared project for an explicit retry without automatic resubmission', async t => {
  let attempt = 0
  const { view, button, input, calls } = fixture(t, { motionGenerate: () => { if (++attempt === 1) throw new Error('本次试做预算不足，未发送请求'); return { status: 'completed', responsePath: '/safe/retry.md', budget: { spentUpperBoundYuan: .3 } } } })
  await view.open(); document.querySelector('[data-video-details="full-motion-skill"] > summary').click(); await settle(); input('用一句话描述动效', '保留我的要求')
  button('生成动效草稿（预算内）').click(); await settle(); assert.match(document.body.textContent, /本次试做预算不足/); assert.equal(input('用一句话描述动效').value, '保留我的要求')
  assert.equal(calls.filter(([name]) => name === 'motionGenerate').length, 1); assert.ok(button('打开已建立的动效聊天'))
  button('生成动效草稿（预算内）').click(); await settle(); assert.equal(calls.filter(([name]) => name === 'motionPrepare').length, 1); assert.equal(calls.filter(([name]) => name === 'motionGenerate').length, 2)
})

test('budgeted drafts reject non-ten-second requests locally while ordinary Pi preparation keeps other durations', async t => {
  const { view, button, input, calls } = fixture(t); await view.open(); document.querySelector('[data-video-details="full-motion-skill"] > summary').click(); await settle()
  assert.match(document.body.textContent, /当前仅 10 秒/); input('用一句话描述动效', '一支十二秒的动效'); input('动效时长（秒）', '12')
  button('生成动效草稿（预算内）').click(); await settle()
  assert.match(document.body.textContent, /当前仅支持 10 秒/); assert.equal(calls.some(([name]) => ['motionPrepare', 'motionGenerate'].includes(name)), false)
  button('新建动效工程并打开聊天').click(); await settle(); assert.equal(calls.find(([name]) => name === 'motionPrepare')[1].duration, 12)
  assert.equal(calls.some(([name]) => ['motionGenerate', 'piSend'].includes(name)), false)
})

test('local motion output can become previewable while a failed model-generation record remains visible', async t => {
  const { view, button, input, calls } = fixture(t, {
    motionGenerate: () => { throw new Error('源码响应被截断，生成未完成') },
    motionOutput: () => ({ status: 'ready', duration: 10, width: 1920, height: 1080, fps: 30, videoPath: '/safe/local-film.mp4', budget: { spentUpperBoundYuan: .894735 } }),
  })
  await view.open(); document.querySelector('[data-video-details="full-motion-skill"] > summary').click(); await settle(); input('用一句话描述动效', 'AIPM 米白黑字短片')
  button('生成动效草稿（预算内）').click(); await settle(); assert.match(document.body.textContent, /源码响应被截断/)
  button('检查本机成片').click(); await settle()
  assert.match(document.body.textContent, /本机成片已就绪，可预览/); assert.match(document.body.textContent, /10 秒 · 1920 × 1080 · 30fps/); assert.match(document.body.textContent, /源码响应被截断/)
  assert.match(document.body.textContent, /\/safe\/local-film.mp4/); assert.doesNotMatch(document.body.textContent, /上次请求的动效草稿已保存/)
  button('预览动效成片').click(); await settle(); assert.deepEqual(calls.find(([name]) => name === 'motionPreview'), ['motionPreview', { projectId: 'motion-project' }])
  assert.equal(calls.filter(([name]) => name === 'motionGenerate').length, 1); assert.equal(calls.some(([name]) => ['videoRender', 'piSend'].includes(name)), false)
})

test('pending, unknown and failed local output checks never present an available film', async t => {
  let check = 0
  const { view, button, input } = fixture(t, { motionOutput: () => {
    if (++check === 1) return { status: 'pending', message: '尚未找到实际视频' }
    if (check === 2) throw new Error('无法核对本机文件')
    return { status: 'completed', message: '未确认的返回状态' }
  } })
  await view.open(); document.querySelector('[data-video-details="full-motion-skill"] > summary').click(); await settle(); input('用一句话描述动效', '需要本机检查的短片'); button('生成动效草稿（预算内）').click(); await settle()
  for (const expected of ['尚未找到实际视频', '无法核对本机文件', '未确认的返回状态']) {
    button('检查本机成片').click(); await settle(); assert.match(document.body.textContent, new RegExp(expected))
    assert.equal([...document.querySelectorAll('button')].some(node => node.textContent === '预览动效成片'), false); assert.doesNotMatch(document.body.textContent, /本机成片已就绪/)
  }
})

test('a late local-output response cannot label a newly prepared motion project ready', async t => {
  const checking = deferred(); let prepared = 0
  const { view, button, input, calls } = fixture(t, { motionPrepare: () => ({ id: 'motion-' + ++prepared, chatId: 'chat-' + prepared, prompt: '待发送动效要求' }), motionOutput: () => checking.promise, openChat: () => false })
  await view.open(); document.querySelector('[data-video-details="full-motion-skill"] > summary').click(); await settle(); input('用一句话描述动效', '第一个项目'); button('生成动效草稿（预算内）').click(); await settle()
  button('检查本机成片').click(); await Promise.resolve(); input('用一句话描述动效', '第二个项目'); button('新建动效工程并打开聊天').click(); await settle()
  checking.resolve({ status: 'ready', duration: 10, width: 1920, height: 1080, videoPath: '/old-project.mp4' }); await settle()
  assert.doesNotMatch(document.body.textContent, /本机成片已就绪|old-project.mp4/); assert.ok(button('检查本机成片')); assert.equal(calls.filter(([name]) => name === 'motionGenerate').length, 1)
})

test('saved motion projects can be selected after reopening without rebuilding, generating or opening an undefined chat', async t => {
  const { view, button, input, calls, openedChats } = fixture(t, {
    motionProjects: () => [{ id: 'saved-film', title: '已保存的 AIPM 正式短片' }],
    motionOutput: () => ({ status: 'ready', duration: 10, width: 1920, height: 1080, fps: 30, videoPath: '/safe/saved-film.mp4' }),
  })
  await view.open(); assert.equal(calls.some(([name]) => name === 'motionProjects'), false)
  document.querySelector('[data-video-details="full-motion-skill"] > summary').click(); await settle()
  assert.equal(calls.filter(([name]) => name === 'motionProjects').length, 1); input('已有动效工程', 'saved-film')
  assert.match(document.body.textContent, /已选择本机已有动效工程/)
  assert.equal([...document.querySelectorAll('button')].some(node => node.textContent === '打开已建立的动效聊天'), false)
  assert.equal(calls.some(([name]) => ['motionPrepare', 'motionGenerate', 'piSend'].includes(name)), false); assert.equal(openedChats.length, 0)
  button('检查本机成片').click(); await settle(); assert.deepEqual(calls.find(([name]) => name === 'motionOutput'), ['motionOutput', { projectId: 'saved-film' }])
  button('预览动效成片').click(); await settle(); assert.deepEqual(calls.find(([name]) => name === 'motionPreview'), ['motionPreview', { projectId: 'saved-film' }]); assert.equal(openedChats.length, 0)
})

test('Lemo and preserved video projects use stable tabs, keep independent drafts, and open history links on the project page', async t => {
  let mounts = 0, disposed = 0, allowLeave = true, options
  const f = fixture(t, { lemoFactory: supplied => {
    mounts++; options = supplied
    const draft = supplied.container.ownerDocument.createElement('textarea'); draft.setAttribute('aria-label', 'Lemo 动效需求'); supplied.container.append(draft)
    return { canLeave: () => allowLeave, dispose: () => { disposed++ } }
  } }); await f.view.open()
  assert.equal(mounts, 1); assert.equal(document.querySelector('.vs-lemo-host').hidden, false); assert.equal(document.querySelector('.video-studio').hidden, true)
  assert.equal(document.querySelector('.vs-hub-tab[aria-selected=true]').textContent, 'Lemo Studio')
  const lemoDraft = document.querySelector('[aria-label="Lemo 动效需求"]'); lemoDraft.value = '我的新动效需求'
  f.button('视频项目').click(); f.input('视频名称', '尚未建立的视频')
  f.button('Lemo Studio').click(); assert.equal(document.querySelector('[aria-label="Lemo 动效需求"]'), lemoDraft); assert.equal(lemoDraft.value, '我的新动效需求')
  f.button('视频项目').click(); assert.equal(f.input('视频名称').value, '尚未建立的视频'); f.input('视频名称', '')
  allowLeave = false; assert.equal(f.view.canLeave(), false); allowLeave = true
  await options.openChat('lemo-chat', '尚未发送的 Lemo 指令'); assert.deepEqual(f.openedChats.at(-1), ['lemo-chat', '尚未发送的 Lemo 指令'])
  await f.view.open({ id: 'video1' }); assert.equal(document.querySelector('.video-studio').hidden, false); assert.equal(document.querySelector('.vs-hub-tab[aria-selected=true]').textContent, '视频项目')
  f.emit({ ...f.projects.get('video1'), status: 'completed' }); assert.equal(document.querySelector('.vs-lemo-host').hidden, true)
  assert.equal(f.calls.some(([name]) => ['piSend', 'videoSend', 'videoRender'].includes(name)), false)
  f.view.hide(); assert.equal(document.querySelector('.vs-hub').hidden, true); f.view.destroy(); assert.equal(disposed, 1)
})

test('a minimal Lemo leaf cleanup function is called once when the video hub is destroyed', async t => {
  let disposals = 0; const f = fixture(t, { lemoFactory: () => () => { disposals++ } }); await f.view.open()
  f.view.destroy(); f.view.destroy(); assert.equal(disposals, 1)
})

test('a Lemo history route opens its own leaf project and never reads that id from the quick-video store', async t => {
  const opened = [], f = fixture(t, { lemoFactory: () => ({ open: id => opened.push(id), dispose() {} }) }); await f.view.open({ mode: 'lemo', id: 'lemo-saved' })
  assert.deepEqual(opened, ['lemo-saved']); assert.equal(document.querySelector('.vs-lemo-host').hidden, false)
  assert.equal(f.calls.some(([name, id]) => name === 'videoGet' && id === 'lemo-saved'), false)
})
