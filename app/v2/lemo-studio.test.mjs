/** Keyless Lemo interactions distinguish local preparation, shared chat, jobs and real output. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { mountLemoStudio } from './lemo-studio.mjs'

const tick = () => new Promise(resolve => setTimeout(resolve, 5))
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const project = id => ({ id, title: id === 'p1' ? 'AIPM 动效' : '第二支动效', brief: '真实品牌介绍', style: 'style-0', mode: 'library', duration: 10, width: 1920, height: 1080, fps: 30, cwd: '/safe/' + id, chatId: 'chat-' + id, prompt: '请读取完整制作方法，再制作动效。', jobs: [] })
function fixture(t, overrides = {}) {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true }), container = dom.window.document.getElementById('root'), calls = [], toasts = [], chats = []
  globalThis.window = dom.window; globalThis.document = dom.window.document
  let update, unsubscribed = false
  const styles = Array.from({ length: 59 }, (_, index) => ({ id: 'style-' + index, name: 'Style ' + index, nameZh: index === 0 ? '瑞士大字' : '风格 ' + index, category: index < 30 ? '文字' : '插画', description: '本机风格说明 ' + index }))
  const defaults = {
    lemoInfo: () => ({ ready: true, sourceReady: true, runtime: { ready: true, messages: [] }, resources: [{ path: 'DIRECTOR.md', title: '导演方法' }], operations: ['stills', 'render', 'events', 'readcheck', 'mux', 'voice', 'subtitles'].map(id => ({ id })) }),
    lemoStyles: () => styles, lemoList: () => [project('p1'), project('p2')], lemoGet: id => project(id), lemoPrepare: input => ({ ...project('new'), ...input }), lemoOpenChat: id => project(id), lemoRead: ({ path }) => ({ path, text: '# 完整说明\n\n<script>bad()</script>原版方法', kind: 'text' }), lemoJob: () => null,
    lemoOutput: () => ({ files: [] }), lemoRun: (_id, input) => ({ id: 'job1', ...input, status: 'running' }), lemoCancel: () => ({ id: 'job1', status: 'cancelled' }), lemoPreview: () => true, lemoExport: () => ({ folder: '/safe/export' }), lemoOpenFolder: () => true, lemoSaveStyle: () => ({ id: 'saved-style' }), copyText: () => true, openLink: () => true,
  }
  const api = async (name, ...args) => { calls.push([name, ...args]); const fn = overrides[name] || defaults[name]; assert.equal(typeof fn, 'function', 'unexpected API ' + name); return fn(...args) }
  const view = mountLemoStudio({ container, api, events: { onLemoUpdate: fn => { update = fn; return () => { unsubscribed = true } } }, toast: text => toasts.push(text), openChat: async (id, draft) => { chats.push([id, draft]); return overrides.openChat ? overrides.openChat(id, draft, view) : true } })
  const button = (label, scope = container) => { const n = [...scope.querySelectorAll('button')].find(n => n.textContent === label); assert.ok(n, 'button ' + label); return n }
  const input = (label, value) => { const n = container.querySelector('[aria-label="' + label + '"]'); assert.ok(n, 'input ' + label); if (value !== undefined) { n.value = value; n.dispatchEvent(new dom.window.Event(n.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) }; return n }
  t.after(() => { view.dispose(); dom.window.close(); delete globalThis.window; delete globalThis.document })
  return { dom, container, calls, toasts, chats, styles, view, button, input, emit: value => update(value), get unsubscribed() { return unsubscribed } }
}

test('full searchable style library and four modes remain local until an explicit project preparation', async t => {
  const f = fixture(t); await f.view.show()
  assert.match(f.container.textContent, /59 种本机可用风格/); assert.equal(f.container.querySelectorAll('.ls-style').length, 12)
  assert.deepEqual([...f.input('创作方式').options].map(n => n.value), ['library', 'customize', 'blank', 'saved'])
  assert.ok(f.container.querySelector('form[data-model-composer]')); assert.match(f.container.textContent, /独立于原 5 元/)
  f.input('搜索动效风格', '风格 58'); assert.equal(f.container.querySelectorAll('.ls-style').length, 1); f.button('风格 58').click()
  assert.match(f.container.querySelector('.ls-create').textContent, /当前风格：风格 58/)
  f.input('搜索动效风格', ''); f.input('风格分类', '插画'); assert.equal(f.container.querySelectorAll('.ls-style').length, 12)
  assert.equal(f.calls.some(([name]) => ['piSend', 'lemoPrepare', 'lemoRun'].includes(name)), false)
})

test('preparation creates an engineering project and only prefills the same shared chat', async t => {
  const f = fixture(t); await f.view.show(); f.input('动效名称', '工作台介绍'); f.input('描述你想做的动效', '用动态大字介绍 AIPM')
  f.button('建立工程并打开聊天').click(); await tick()
  assert.deepEqual(f.calls.find(([name]) => name === 'lemoPrepare')[1], { title: '工作台介绍', brief: '用动态大字介绍 AIPM', duration: 10, style: 'style-0', mode: 'library', width: 1920, height: 1080, fps: 30 })
  assert.deepEqual(f.chats, [['chat-new', '请读取完整制作方法，再制作动效。']]); assert.equal(f.view.canLeave(), true)
  assert.equal(f.calls.some(([name]) => ['piSend', 'lemoRun', 'videoSend'].includes(name)), false)
})

test('failed preparation preserves the brief and focus, while pending preparation prevents duplicate local projects', async t => {
  const pending = deferred(), f = fixture(t, { lemoPrepare: () => pending.promise }); await f.view.show()
  const draft = f.input('描述你想做的动效', '尚未建立的需求'); draft.focus(); draft.setSelectionRange(3, 3); f.button('建立工程并打开聊天').click(); await tick()
  assert.equal(f.view.canLeave(), false); assert.equal(f.calls.filter(([name]) => name === 'lemoPrepare').length, 1)
  pending.reject(new Error('本机工程无法保存')); await tick()
  assert.equal(f.input('描述你想做的动效').value, '尚未建立的需求'); assert.equal(f.input('描述你想做的动效').selectionStart, 3); assert.equal(f.dom.window.document.activeElement, f.input('描述你想做的动效'))
  assert.match(f.container.textContent, /本机工程无法保存/); assert.equal(f.chats.length, 0)
})

test('new text typed during project preparation survives and a newer local selection prevents late chat navigation', async t => {
  const pending = deferred(), f = fixture(t, { lemoPrepare: () => pending.promise }); await f.view.show(); f.input('描述你想做的动效', '第一版需求'); f.button('建立工程并打开聊天').click(); await tick()
  f.input('描述你想做的动效', '随后补充的新草稿'); f.button('＋ 新建动效').click(); pending.resolve(project('new')); await tick()
  assert.equal(f.input('描述你想做的动效').value, '随后补充的新草稿'); assert.equal(f.chats.length, 0); assert.equal(f.view.canLeave(), false)
  f.button('清空草稿').click(); assert.equal(f.view.canLeave(), true)
})

test('saved projects expose preview and export only for an actual lastVideo, with truthful local output status', async t => {
  let ready = false
  const f = fixture(t, { lemoOutput: () => ready ? { files: [{ name: 'film.mp4', path: '/safe/p1/film.mp4', kind: 'video' }], lastVideo: { path: '/safe/p1/film.mp4', duration: 10, width: 1920, height: 1080, fps: 30, audio: false } } : { files: [{ name: 'draft.html', path: '/safe/p1/draft.html', kind: 'html' }] } }); await f.view.open('p1')
  assert.equal([...f.container.querySelectorAll('button')].some(n => n.textContent === '预览成片'), false)
  ready = true; f.button('刷新工程与产物').click(); await tick(); f.button('预览成片').click(); f.button('导出成片与工程').click(); await tick()
  assert.deepEqual(f.calls.find(([name]) => name === 'lemoPreview'), ['lemoPreview', 'p1']); assert.deepEqual(f.calls.find(([name]) => name === 'lemoExport'), ['lemoExport', 'p1']); assert.match(f.container.textContent, /无音轨/); assert.match(f.container.textContent, /不代表已经完成人工画面验收/)
})

test('local tool requests use validated JSON examples, retain edits during job events and allow explicit cancellation', async t => {
  const f = fixture(t); await f.view.open('p1')
  assert.equal(f.input('本地操作').options.length, 7); f.input('本地操作', 'render'); assert.deepEqual(JSON.parse(f.input('本地操作参数（JSON）').value), { workers: 2 })
  f.input('本地操作参数（JSON）', '{bad'); f.button('执行本地操作').click(); await tick(); assert.equal(f.calls.some(([name]) => name === 'lemoRun'), false)
  f.input('本地操作参数（JSON）', '{"workers":1}'); f.button('执行本地操作').click(); await tick(); assert.deepEqual(f.calls.find(([name]) => name === 'lemoRun'), ['lemoRun', 'p1', { workers: 1, operation: 'render' }])
  const draft = f.input('本地操作参数（JSON）', '{"workers":3}'); draft.focus(); draft.setSelectionRange(4, 4)
  f.emit({ ...project('p1'), currentJob: { id: 'job1', operation: 'render', status: 'running', progress: { ratio: .4 }, stdout: '已渲染真实帧' } })
  assert.equal(f.input('本地操作参数（JSON）').value, '{"workers":3}'); assert.equal(f.input('本地操作参数（JSON）').selectionStart, 4)
  f.button('停止本地任务').click(); await tick(); assert.deepEqual(f.calls.find(([name]) => name === 'lemoCancel'), ['lemoCancel', 'p1']); assert.match(f.container.textContent, /已停止/)
  assert.equal(f.calls.some(([name]) => name === 'piSend'), false)
})

test('late project and output responses cannot replace a newer selected project or claim a video exists', async t => {
  const slow = deferred(), f = fixture(t, { lemoGet: id => id === 'p1' ? slow.promise : project(id) }); await f.view.show()
  const first = f.view.open('p1'); await tick(); await f.view.open('p2'); slow.resolve(project('p1')); await first
  assert.equal(f.container.querySelector('.ls-title').textContent, '第二支动效'); assert.equal(f.calls.some(([name, id]) => name === 'lemoOutput' && id === 'p1'), false)
})

test('a fresh streamed project snapshot wins over a delayed get and old task status', async t => {
  const slow = deferred(), f = fixture(t, { lemoGet: () => slow.promise }); await f.view.show(); const opening = f.view.open('p1'); await tick()
  f.emit({ ...project('p1'), title: '已更新工程名', currentJob: { id: 'live', status: 'running', operation: 'render' } }); slow.resolve(project('p1')); await opening
  assert.equal(f.container.querySelector('.ls-title').textContent, '已更新工程名'); assert.match(f.container.textContent, /正在执行/)
})

test('source reading uses the bounded object API and safe markdown; custom styles save explicitly without overwrite', async t => {
  const f = fixture(t); await f.view.show(); f.button('导演方法').click(); await tick()
  assert.deepEqual(f.calls.find(([name]) => name === 'lemoRead'), ['lemoRead', { path: 'DIRECTOR.md' }]); assert.match(f.container.querySelector('.ls-document').textContent, /原版方法/); assert.equal(f.container.querySelectorAll('script').length, 0)
  f.input('自定义风格名称', '我的大字风格'); f.input('自定义风格内容（Markdown）', '# 风格\n米白底与黑色大字'); assert.equal(f.view.canLeave(), false)
  f.button('保存自定义风格').click(); await tick(); assert.deepEqual(f.calls.find(([name]) => name === 'lemoSaveStyle'), ['lemoSaveStyle', { name: '我的大字风格', content: '# 风格\n米白底与黑色大字', overwrite: false }]); assert.equal(f.view.canLeave(), true)
  await f.view.open('p1'); f.input('自定义风格名称', '工程风格'); f.button('从当前工程保存风格与演示').click(); await tick(); assert.deepEqual(f.calls.filter(([name]) => name === 'lemoSaveStyle').at(-1), ['lemoSaveStyle', { name: '工程风格', overwrite: false, projectId: 'p1' }])
})

test('hidden leaves retain drafts, unknown errors do not create output and dispose removes the subscription', async t => {
  const f = fixture(t, { lemoOutput: () => { throw '产物检查失败' } }); await f.view.show(); f.input('描述你想做的动效', '保留的需求'); f.view.hide(); await f.view.show(); assert.equal(f.input('描述你想做的动效').value, '保留的需求')
  await f.view.open('p1'); assert.match(f.container.textContent, /产物检查失败/); assert.equal([...f.container.querySelectorAll('button')].some(n => n.textContent === '预览成片'), false)
  f.view.dispose(); assert.equal(f.unsubscribed, true); assert.equal(f.container.children.length, 0)
})

test('a saved project releases its preparation guard before actual host chat navigation checks canLeave', async t => {
  let navigated = false
  const f = fixture(t, { openChat: (_id, _draft, leaf) => { navigated = leaf.canLeave(); return navigated } }); await f.view.show(); f.input('描述你想做的动效', '建立后进入制作聊天')
  f.button('建立工程并打开聊天').click(); await tick(); assert.equal(navigated, true); assert.equal(f.view.canLeave(), true)
})

test('online voice consent is an explicit per-project human action, restores from memory and never launches voice work', async t => {
  let approved = false
  const f = fixture(t, { lemoGet: id => ({ ...project(id), onlineVoiceConsent: approved }), lemoVoiceConsent: (id, value) => { assert.equal(id, 'p1'); approved = value; return { ...project(id), onlineVoiceConsent: approved } } }); await f.view.open('p1')
  let checkbox = f.input('允许本工程使用 Edge 在线配音'); assert.equal(checkbox.checked, false); assert.match(f.container.textContent, /旁白文本发送给微软/); assert.equal(f.calls.some(([name]) => name === 'lemoVoiceConsent'), false)
  checkbox.checked = true; checkbox.dispatchEvent(new f.dom.window.Event('change')); await tick(); assert.deepEqual(f.calls.find(([name]) => name === 'lemoVoiceConsent'), ['lemoVoiceConsent', 'p1', true]); assert.equal(f.input('允许本工程使用 Edge 在线配音').checked, true)
  await f.view.open('p1'); checkbox = f.input('允许本工程使用 Edge 在线配音'); assert.equal(checkbox.checked, true); checkbox.checked = false; checkbox.dispatchEvent(new f.dom.window.Event('change')); await tick(); assert.equal(approved, false)
  assert.equal(f.calls.some(([name]) => ['lemoRun', 'piSend'].includes(name)), false)
})

test('a rejected online voice consent action rolls the checkbox back and preserves local parameter drafts', async t => {
  const f = fixture(t, { lemoVoiceConsent: () => { throw new Error('授权未保存') } }); await f.view.open('p1'); f.input('本地操作参数（JSON）', '{"times":[0,3]}')
  const checkbox = f.input('允许本工程使用 Edge 在线配音'); checkbox.checked = true; checkbox.dispatchEvent(new f.dom.window.Event('change')); await tick()
  assert.equal(f.input('允许本工程使用 Edge 在线配音').checked, false); assert.equal(f.input('本地操作参数（JSON）').value, '{"times":[0,3]}'); assert.match(f.container.textContent, /授权未保存/)
})

test('full engine duration and frame bounds remain available and saved styles use their declared source paths', async t => {
  const custom = { id: 'custom:mine', nameZh: '我保存的风格', category: '自定义', stylePath: 'MY-STYLES/mine/STYLE.md' }
  const f = fixture(t, { lemoStyles: () => [{ id: 'built-in', nameZh: '内置风格' }, custom] }); await f.view.show()
  assert.equal(f.input('动效时长（秒）').max, '3600'); assert.equal(f.input('画面宽度').max, '8192'); assert.equal(f.input('画面宽度').step, '2')
  f.input('创作方式', 'saved'); assert.equal(f.container.querySelectorAll('.ls-style').length, 1); assert.match(f.container.querySelector('.ls-create').textContent, /当前风格：我保存的风格/)
  f.button('阅读风格说明').click(); await tick(); assert.deepEqual(f.calls.find(([name]) => name === 'lemoRead'), ['lemoRead', { path: 'MY-STYLES/mine/STYLE.md' }])
  f.input('动效时长（秒）', '1800'); f.input('画面宽度', '8192'); f.input('描述你想做的动效', '长时自定义风格工程'); f.button('建立工程并打开聊天').click(); await tick()
  const prepared = f.calls.find(([name]) => name === 'lemoPrepare')[1]; assert.equal(prepared.duration, 1800); assert.equal(prepared.width, 8192); assert.equal(prepared.style, 'custom:mine')
})

test('late local job acknowledgements cannot replace a completed streamed task or newer parameter edits', async t => {
  const pending = deferred(), f = fixture(t, { lemoRun: () => pending.promise }); await f.view.open('p1'); f.input('本地操作', 'render'); f.button('执行本地操作').click(); await tick()
  f.input('本地操作参数（JSON）', '{"workers":4}')
  f.emit({ ...project('p1'), currentJob: { id: 'job1', operation: 'render', status: 'completed', log: '本机渲染完成' } }); pending.resolve({ id: 'job1', status: 'queued', operation: 'render' }); await tick()
  assert.match(f.container.querySelector('.ls-job').textContent, /执行完成/); assert.equal(f.input('本地操作参数（JSON）').value, '{"workers":4}'); assert.equal(f.view.canLeave(), false)
})

test('declared audio, subtitle and offline ASR operations expose the service examples without launching work', async t => {
  const f = fixture(t, { lemoInfo: () => ({ ready: true, resources: [], operations: ['audio', 'subtitles', 'asr'].map(id => ({ id })) }) }); await f.view.open('p1')
  f.input('本地操作', 'audio'); assert.equal(JSON.parse(f.input('本地操作参数（JSON）').value).cues[0].type, 'ding')
  f.input('本地操作', 'subtitles'); assert.deepEqual(JSON.parse(f.input('本地操作参数（JSON）').value).cues, [{ t0: 0, t1: 3, text: '你好' }])
  f.input('本地操作', 'asr'); assert.equal(JSON.parse(f.input('本地操作参数（JSON）').value).lang, 'zh'); assert.equal(f.calls.some(([name]) => name === 'lemoRun'), false)
})
