/** Recorded shell interactions for the rebuilt Pi workbench. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { mountWorkbench } from './app.mjs'

const settle = () => new Promise(resolve => setTimeout(resolve, 15))
function fixture(options = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'file:///fixture/v2/index.html', pretendToBeVisual: true })
  const { window } = dom; globalThis.window = window; globalThis.document = window.document
  const chats = new Map(), calls = [], modules = [], listeners = {}; let id = 0, allowLeave = true
  const status = { engine: 'Pi Agent', version: '1.3.0', model: 'deepseek-v4-pro', configured: true, permissions: { accessibility: false, screenRecording: false } }
  const projects = [{ kind: 'discovery', id: 'd1', name: '已有需求项目', status: 'idle' }, { kind: 'blueprint', id: 'b1', name: '酒水助手', status: 'needs_review' }, { kind: 'task', id: 't1', name: '已有方案任务', status: 'completed' }, { kind: 'starter', id: 's1', name: '会议待办助手', status: 'idle' }, { kind: 'geo', id: 'g1', name: 'GEO历史项目', status: 'reviewed' }]
  const emit = chat => { chats.set(chat.id, structuredClone(chat)); listeners.pi?.(structuredClone(chat)) }
  const api = async (name, ...args) => {
    calls.push([name, ...args])
    if (options.api) { const value = await options.api(name, args, { chats, emit }); if (value !== undefined) return value }
    if (name === 'boot') return { appearance: 'system', theme: 'system', transparency: 85, systemTheme: 'light', hasKey: true, model: status.model }
    if (name === 'piStatus') return status
    if (name === 'modelStatus') return { schema: 1, model: status.model, choices: [{ id: 'deepseek-v4-pro', label: 'Pro' }, { id: 'deepseek-flash', label: 'Flash（V4.1）' }] }
    if (name === 'modelSelect') { status.model = args[0]; const value = { schema: 1, model: status.model, choices: [{ id: 'deepseek-v4-pro', label: 'Pro' }, { id: 'deepseek-flash', label: 'Flash（V4.1）' }] }; listeners.model?.(value); return value }
    if (name === 'piList') return [...chats.values()]
    if (name === 'piCatalog') return { projects, capabilities: [], manuals: [{ name: '通用手册' }, { name: '前端手册' }, { name: '部署手册' }] }
    if (name === 'piCreate') { const p = { id: 'c' + ++id, title: '新对话', cwd: args[0]?.cwd || '/safe/project', status: 'idle', messages: [], runs: [], artifacts: [] }; chats.set(p.id, p); return structuredClone(p) }
    if (name === 'piGet') return structuredClone(chats.get(args[0]))
    if (name === 'piSend') { const p = chats.get(args[0]); p.title = args[1].slice(0, 12); p.status = 'running'; p.messages = [...p.messages, { id: 'u' + id, role: 'user', content: args[1] }, { id: 'a' + id, role: 'assistant', content: '' }]; p.runs = [{ id: 'r', tools: [{ name: 'read', args: { path: 'README.md' }, callId: 'read1', status: 'running' }], status: 'running' }]; emit(p); return structuredClone(p) }
    if (name === 'piReply') { const p = chats.get(args[0]); p.pending = null; p.status = 'running'; emit(p); return structuredClone(p) }
    if (name === 'piCancel') { const p = chats.get(args[0]); p.status = 'cancelled'; emit(p); return structuredClone(p) }
    if (name === 'piPermissions') return status.permissions
    if (name === 'piRequestPermission') return status.permissions
    if (name === 'piPickFolder') return '/Users/example/Documents/已有项目'
    if (name === 'appearance' || name === 'theme' || name === 'transparency') return args[0]
    if (name === 'key') return true
  }
  const events = { onModelUpdate: fn => { listeners.model = fn; return () => { listeners.model = undefined } }, onPiUpdate: fn => { listeners.pi = fn; return () => { listeners.pi = undefined } }, onSystemTheme: fn => { listeners.theme = fn; return () => { listeners.theme = undefined } } }
  const moduleFactory = () => ({ async open(selection) { modules.push(selection) }, hide() {}, canLeave() { return allowLeave }, destroy() {} })
  const container = document.getElementById('root')
  const button = (label, root = container) => [...root.querySelectorAll('button')].find(n => !n.closest('[hidden]') && (n.textContent.trim() === label || n.getAttribute('aria-label') === label))
  return { dom, window, api, events, moduleFactory, container, button, emit, calls, chats, modules, listeners, status, leave: value => { allowLeave = value }, close() { dom.window.close(); delete globalThis.window; delete globalThis.document } }
}

test('new shell starts with a quiet Pi conversation; all original project families remain reachable', async () => {
  const f = fixture(); const view = await mountWorkbench(f)
  try {
    assert.match(f.container.textContent, /今天想完成什么/)
    assert.equal(f.container.querySelectorAll('.v2-nav-button[aria-current=page]').length, 1)
    assert.equal(f.calls.some(([n]) => n === 'piSend'), false)
    assert.equal(f.container.querySelector('.v2-model select').value, 'deepseek-v4-pro')
    await view.show('projects'); assert.equal(f.container.querySelectorAll('.v2-project-row').length, 5)
    f.button('酒水助手').click(); await settle(); assert.deepEqual(f.modules.at(-1), { kind: 'blueprint', id: 'b1', mode: 'product' })
    await view.show('tools'); assert.equal(f.container.querySelectorAll('.v2-tool').length, 4)
    assert.equal([...f.container.querySelectorAll('.v2-tool h2')].some(n => /AI 产品开发|Agent Blueprint/.test(n.textContent)), false)
    for (const [label, expected] of [['开始公司调研', { kind: 'company' }], ['打开内容运营', { kind: 'geo' }], ['打开产品空间', { kind: 'discovery' }]]) { await view.show('tools'); f.button(label).click(); await settle(); assert.deepEqual(f.modules.at(-1), expected) }
    for (const [label, expected] of [['Agent Blueprint', { kind: 'blueprint', mode: 'product' }], ['AI 产品开发', { kind: 'starter' }]]) { f.button(label).click(); await settle(); assert.deepEqual(f.modules.at(-1), expected); assert.equal(f.button(label).getAttribute('aria-current'), 'page'); assert.equal(f.container.querySelector('.v2-back').hidden, true) }
    f.button('视频生成').click(); await settle(); assert.deepEqual(f.modules.at(-1), { kind: 'video' }); assert.equal(f.button('视频生成').getAttribute('aria-current'), 'page'); assert.equal(f.container.querySelector('.v2-back').hidden, true)
    f.leave(false); await view.show('projects'); assert.equal(f.container.querySelector('.v2-workbench').dataset.page, 'module')
  } finally { view.destroy(); f.close() }
})

test('resume review opens from the sidebar, preserves the chat draft and yields native display to settings', async () => {
  const f = fixture(), rect = f.window.HTMLElement.prototype.getBoundingClientRect
  f.window.HTMLElement.prototype.getBoundingClientRect = function () { return this.classList.contains('resume-clinic-slot') ? { x: 240, y: 64, width: 960, height: 700 } : rect.call(this) }
  const view = await mountWorkbench(f)
  try {
    const input = f.container.querySelector('.v2-composer textarea'); input.value = '尚未发送的产品需求'; input.dispatchEvent(new f.window.Event('input'))
    f.button('简历检查').click(); await settle()
    assert.equal(f.container.querySelector('.v2-workbench').dataset.page, 'resume')
    assert.equal(f.button('简历检查').getAttribute('aria-current'), 'page')
    assert.equal(f.container.querySelector('.v2-page-name').textContent, '简历检查')
    assert.equal(f.calls.some(([name]) => name === 'resumeShow'), true)
    assert.equal(f.calls.some(([name]) => name === 'piSend'), false)
    f.button('设置').click(); await settle(); assert.equal(f.calls.at(-1)[0], 'resumeHide')
    f.button('关闭', f.container.querySelector('dialog')).click(); await settle(); assert.equal(f.calls.at(-1)[0], 'resumeShow')
    for (const label of ['设置', '电脑权限']) {
      f.button(label).click(); await settle(); assert.equal(f.calls.some(([name]) => name === 'resumeHide'), true)
      const modal = f.container.querySelector('dialog'), cancel = new f.window.Event('cancel', { cancelable: true })
      assert.equal(modal.dispatchEvent(cancel), false); await settle()
      assert.equal(f.container.querySelector('dialog'), null); assert.equal(f.calls.at(-1)[0], 'resumeShow')
    }
    await view.show('chat'); await settle(); assert.equal(input.value, '尚未发送的产品需求'); assert.equal(f.calls.at(-1)[0], 'resumeHide')
  } finally { view.destroy(); f.close() }
})

test('streamed Pi results preserve a typed next draft, expose real steps on demand and await explicit approval', async () => {
  const f = fixture(), view = await mountWorkbench(f)
  try {
    const input = f.container.querySelector('.v2-composer textarea'), form = f.container.querySelector('.v2-composer')
    input.value = '查看这个项目'; input.dispatchEvent(new f.window.Event('input')); form.dispatchEvent(new f.window.Event('submit', { cancelable: true })); await settle()
    assert.deepEqual(f.calls.find(([n]) => n === 'piSend'), ['piSend', 'c1', '查看这个项目'])
    input.value = '完成后解释结果'; input.dispatchEvent(new f.window.Event('input')); input.setSelectionRange(3, 3)
    const p = structuredClone(f.chats.get('c1')); p.messages.at(-1).content = '**项目已读取**，代码尚未修改。<img src=x onerror=alert(1)>'; f.emit(p)
    assert.equal(f.container.querySelector('.v2-composer textarea'), input); assert.equal(input.value, '完成后解释结果'); assert.equal(input.selectionStart, 3)
    assert.match(f.container.querySelector('.v2-messages').textContent, /代码尚未修改/); assert.equal(f.container.querySelectorAll('.v2-messages img').length, 0)
    assert.equal(f.container.querySelector('.v2-drawer').hidden, true)
    f.button('执行记录').click(); await settle(); assert.equal(f.container.querySelector('.v2-drawer').hidden, false); assert.match(f.container.querySelector('.v2-drawer').textContent, /读取文件/)
    p.status = 'waiting'; p.pending = { token: 'confirm1', command: '发布项目到指定测试站点', reason: '此操作会对外发布，请核对目标' }; f.emit(p)
    assert.match(f.container.querySelector('.v2-approval').textContent, /发布项目到指定测试站点/)
    assert.equal(f.calls.some(([n]) => n === 'piReply'), false)
    f.button('不执行').click(); await settle(); assert.deepEqual(f.calls.find(([n]) => n === 'piReply'), ['piReply', 'c1', 'confirm1', false])
    assert.equal(input.value, '完成后解释结果')
  } finally { view.destroy(); f.close() }
})

test('appearance preferences share model configuration, retain encrypted key unless edited and show actual OS permission needs', async () => {
  const f = fixture(), view = await mountWorkbench(f)
  try {
    f.button('设置').click(); await settle()
    const d = f.container.querySelector('dialog'); assert.match(d.textContent, /deepseek-v4-pro/)
    f.button('毛玻璃', d).click(); await settle(); assert.equal(document.documentElement.dataset.appearance, 'frosted')
    f.button('深色', d).click(); await settle(); assert.equal(document.documentElement.dataset.theme, 'dark')
    const slider = d.querySelector('input[type=range]'); slider.value = '65'; slider.dispatchEvent(new f.window.Event('input')); await settle(); assert.deepEqual(f.calls.find(([n]) => n === 'transparency'), ['transparency', 65])
    f.button('完成', d).click(); await settle(); assert.equal(f.calls.some(([n]) => n === 'key'), false)
    f.button('电脑权限').click(); await settle(); const permissionDialog = f.container.querySelector('dialog')
    assert.match(permissionDialog.textContent, /辅助功能/); assert.match(permissionDialog.textContent, /屏幕录制/); assert.match(permissionDialog.textContent, /未授权/)
    const requests = [...permissionDialog.querySelectorAll('button')].filter(n => n.textContent === '前往系统设置'); requests[0].click(); await settle(); assert.deepEqual(f.calls.find(([n]) => n === 'piRequestPermission'), ['piRequestPermission', 'accessibility'])
    assert.equal(f.calls.some(([n]) => n === 'piSend'), false)
  } finally { view.destroy(); f.close() }
})

test('choosing another folder starts a new scoped conversation and changing chats restores unsent drafts', async () => {
  const f = fixture(), view = await mountWorkbench(f)
  try {
    const input = f.container.querySelector('.v2-composer textarea')
    input.value = '检查这个目录'; input.dispatchEvent(new f.window.Event('input')); f.button('选择工作目录').click(); await settle()
    assert.match(f.container.querySelector('.v2-folder').textContent, /已有项目/)
    f.container.querySelector('.v2-composer').dispatchEvent(new f.window.Event('submit', { cancelable: true })); await settle()
    assert.deepEqual(f.calls.find(([n]) => n === 'piCreate'), ['piCreate', { cwd: '/Users/example/Documents/已有项目' }])
    const p = structuredClone(f.chats.get('c1')); p.status = 'idle'; p.messages.at(-1).content = '检查完成'; f.emit(p)
    input.value = '尚未发送的修改意见'; input.dispatchEvent(new f.window.Event('input')); await view.newChat(); assert.equal(input.value, '')
    const history = f.container.querySelector('.v2-session'); history.click(); await settle(); assert.equal(input.value, '尚未发送的修改意见')
  } finally { view.destroy(); f.close() }
})

test('a delayed new-session response cannot replace a different selected conversation or its draft', async () => {
  let releaseCreate, defer = false
  const f = fixture({ api: async (name, args) => {
    if (name === 'piCreate' && defer) return new Promise(resolve => { releaseCreate = () => { const p = { id: 'background', title: '新对话', cwd: '/safe/second', status: 'idle', messages: [], runs: [], artifacts: [] }; f.chats.set(p.id, p); resolve(structuredClone(p)) } })
  } })
  await f.api('piCreate', {})
  const view = await mountWorkbench(f)
  try {
    defer = true
    const input = f.container.querySelector('.v2-composer textarea')
    input.value = '开始新的任务'; input.dispatchEvent(new f.window.Event('input')); f.container.querySelector('.v2-composer').dispatchEvent(new f.window.Event('submit', { cancelable: true })); await settle()
    f.container.querySelector('.v2-session').click(); await settle()
    input.value = '另一对话的未发送文字'; input.dispatchEvent(new f.window.Event('input')); releaseCreate(); await settle(); await settle()
    assert.equal(input.value, '另一对话的未发送文字')
    assert.equal(f.container.querySelector('.v2-session[aria-current=true]').textContent.trim(), '新对话')
    assert.deepEqual(f.calls.find(([name]) => name === 'piSend'), ['piSend', 'background', '开始新的任务'])
  } finally { view.destroy(); f.close() }
})

test('failed submission leaves the original instruction editable for retry', async () => {
  const f = fixture({ api: async name => { if (name === 'piSend') throw new Error('连接暂时不可用') } }), view = await mountWorkbench(f)
  try {
    const input = f.container.querySelector('.v2-composer textarea'); input.value = '不能丢掉的任务描述'; input.dispatchEvent(new f.window.Event('input'))
    f.container.querySelector('.v2-composer').dispatchEvent(new f.window.Event('submit', { cancelable: true })); await settle()
    assert.equal(input.value, '不能丢掉的任务描述'); assert.equal(input.disabled, false)
    assert.match(f.container.querySelector('.v2-toast').textContent, /连接暂时不可用/)
    assert.equal(f.container.querySelector('button[aria-label="发送指令"]').disabled, false)
  } finally { view.destroy(); f.close() }
})

test('an execution limit pauses neutrally, shows measured usage and resumes only on a click', async () => {
  const f = fixture(), view = await mountWorkbench(f)
  try {
    const input = f.container.querySelector('.v2-composer textarea'); input.value = '继续开发当前产品'; input.dispatchEvent(new f.window.Event('input')); f.container.querySelector('.v2-composer').dispatchEvent(new f.window.Event('submit', { cancelable: true })); await settle()
    const p = structuredClone(f.chats.get('c1')); p.status = 'paused'; p.messages.at(-1).content = '代码已保存，测试尚未完成。'; p.runs[0].status = 'paused'; p.runs[0].tools[0].status = 'paused'; p.runs[0].tools.push({ name: 'bash', status: 'cancelled' }); p.pause = { reason: '本轮达到 120 次模型请求上限。', kind: 'call_limit', usage: { calls: 120, input_tokens: 950000, output_tokens: 25000 }, limits: { maxCalls: 120, maxOutputTokens: 120000 } }; f.emit(p)
    const card = f.container.querySelector('.v2-pause'); assert.equal(card.getAttribute('role'), 'status'); assert.match(card.textContent, /不是 API 余额提示/); assert.match(card.textContent, /120 次模型请求/); assert.match(card.textContent, /25000 tokens \/ 上限 120000 tokens/); assert.match(card.textContent, /含重复发送的历史/)
    assert.equal(f.container.querySelectorAll('.v2-error').length, 0); assert.equal(f.calls.filter(([n]) => n === 'piSend').length, 1)
    f.button('执行记录').click(); assert.match(f.container.querySelector('.v2-drawer').textContent, /已暂停，可继续/); const steps = [...f.container.querySelectorAll('.v2-tool-step>summary')].map(n => n.textContent); assert.match(steps[0], /Ⅱ读取文件已暂停/); assert.match(steps[1], /–执行命令已停止/); assert.ok(steps.every(text => !text.includes('已完成') && !text.includes('✓')))
    f.button('继续执行').click(); await settle()
    assert.deepEqual(f.calls.filter(([n]) => n === 'piSend').at(-1), ['piSend', 'c1', '继续完成刚才的任务。先核对已保存文件与执行记录，从未完成处接着做，不重复已完成操作。'])
    assert.equal(f.calls.some(([n]) => n === 'piReply'), false); assert.equal(input.value, ''); assert.equal(f.container.querySelectorAll('.v2-pause').length, 0)
  } finally { view.destroy(); f.close() }
})

test('resume preserves an unsent draft and never substitutes for a pending human approval', async () => {
  const f = fixture(), view = await mountWorkbench(f)
  try {
    const input = f.container.querySelector('.v2-composer textarea'); input.value = '执行当前任务'; input.dispatchEvent(new f.window.Event('input')); f.container.querySelector('.v2-composer').dispatchEvent(new f.window.Event('submit', { cancelable: true })); await settle()
    const p = structuredClone(f.chats.get('c1')); p.status = 'paused'; p.pause = { reason: '已到连续执行上限。' }; f.emit(p)
    input.value = '先等一下，我要改需求'; input.dispatchEvent(new f.window.Event('input')); input.setSelectionRange(5, 5)
    f.button('继续执行').click(); await settle(); assert.equal(input.value, '先等一下，我要改需求'); assert.equal(input.selectionStart, 5); assert.equal(f.calls.filter(([n]) => n === 'piSend').length, 1); assert.match(f.container.querySelector('.v2-toast').textContent, /未发送的内容，已保留/)
    p.status = 'waiting'; p.pending = { token: 'approval-only', command: '上线目标产品', reason: '发布前需要用户确认' }; f.emit(p)
    assert.equal(f.container.querySelectorAll('.v2-pause').length, 0); assert.match(f.container.querySelector('.v2-approval').textContent, /上线目标产品/); assert.equal(f.calls.some(([n]) => n === 'piReply'), false)
  } finally { view.destroy(); f.close() }
})

for (const switchChat of [false, true]) test(`a delayed resume response preserves the next draft ${switchChat ? 'after switching chats' : 'and its caret'}`, async () => {
  let releaseSend
  const f = fixture({ api: async (name, args, { chats, emit }) => {
    if (name === 'piSend') return new Promise(resolve => { releaseSend = () => { const p = { ...chats.get(args[0]), status: 'running', pause: null, messages: [{ id: 'resume-user', role: 'user', content: args[1] }, { id: 'resume-assistant', role: 'assistant', content: '' }] }; emit(p); resolve(structuredClone(p)) } })
  } })
  const p = await f.api('piCreate', {}); p.title = '等待续跑的项目'; p.status = 'paused'; p.pause = { reason: '连续执行已暂停' }; p.messages = [{ id: 'prior', role: 'assistant', content: '已有文件已保存。' }]; f.chats.set(p.id, p)
  const view = await mountWorkbench(f)
  try {
    f.button('等待续跑的项目').click(); await settle(); f.button('继续执行').click(); await settle()
    const input = f.container.querySelector('.v2-composer textarea'); input.value = '下一条补充需求不能被吞掉'; input.dispatchEvent(new f.window.Event('input')); input.setSelectionRange(4, 4)
    if (switchChat) { await view.newChat(); input.value = '其他对话的未发送草稿'; input.dispatchEvent(new f.window.Event('input')); input.setSelectionRange(3, 3) }
    releaseSend(); await settle(); await settle()
    assert.equal(f.container.querySelector('.v2-composer textarea'), input)
    assert.equal(input.value, switchChat ? '其他对话的未发送草稿' : '下一条补充需求不能被吞掉'); assert.equal(input.selectionStart, switchChat ? 3 : 4)
    if (switchChat) { f.button('等待续跑的项目').click(); await settle(); assert.equal(input.value, '下一条补充需求不能被吞掉') }
    else { await view.newChat(); f.button('等待续跑的项目').click(); await settle(); assert.equal(input.value, '下一条补充需求不能被吞掉') }
    assert.equal(f.calls.filter(([name]) => name === 'piSend').length, 1)
  } finally { view.destroy(); f.close() }
})

for (const destination of ['module', 'tools']) test(`a delayed chat read cannot replace a newer ${destination} navigation`, async () => {
  let resolveGet
  const f = fixture({ api: async (name, args, { chats }) => name === 'piGet' ? new Promise(resolve => { resolveGet = () => resolve(structuredClone(chats.get(args[0]))) }) : undefined })
  await f.api('piCreate', {})
  const view = await mountWorkbench(f)
  try {
    const selecting = view.openChat('c1'); await Promise.resolve()
    if (destination === 'module') await view.openModule({ kind: 'company', id: 'research1' }); else await view.show('tools')
    resolveGet(); await selecting
    assert.equal(f.container.querySelector('.v2-workbench').dataset.page, destination)
    assert.equal(f.container.querySelector('.v2-module-host').hidden, destination !== 'module')
  } finally { view.destroy(); f.close() }
})

test('Pi completion and cancellation updates preserve the open research module route', async () => {
  const f = fixture(); const chat = await f.api('piCreate', {}), view = await mountWorkbench(f)
  try {
    await view.openChat(chat.id)
    chat.status = 'running'; f.emit(chat)
    await view.openModule({ kind: 'company', id: 'research1' })
    for (const status of ['idle', 'running', 'cancelled']) {
      chat.status = status; f.emit(chat); await settle()
      assert.equal(f.container.querySelector('.v2-workbench').dataset.page, 'module')
      assert.equal(f.container.querySelector('.v2-module-host').hidden, false)
      assert.equal(f.container.querySelector('.v2-page-name').textContent, '公司与客户调研')
    }
  } finally { view.destroy(); f.close() }
})

test('opening a prepared motion chat only prefills its draft and preserves existing unsent text in both chats', async () => {
  const f = fixture(); const target = await f.api('piCreate', {}), view = await mountWorkbench(f)
  try {
    const input = f.container.querySelector('.v2-composer textarea'); input.value = '原来新对话的草稿'; input.dispatchEvent(new f.window.Event('input'))
    assert.equal(await view.openChat(target.id, '按完整 Skill 制作动效'), true); assert.equal(input.value, '按完整 Skill 制作动效')
    assert.equal(f.calls.some(([name]) => name === 'piSend'), false)
    input.value = '动效聊天里已有的未发送修改'; input.dispatchEvent(new f.window.Event('input'))
    await view.openChat(target.id, '不要覆盖原草稿的新动效指令')
    assert.equal(input.value, '动效聊天里已有的未发送修改'); assert.match(f.container.querySelector('.v2-toast').textContent, /已保留原文/)
    await view.newChat(); assert.equal(input.value, '原来新对话的草稿')
  } finally { view.destroy(); f.close() }
})

test('prepared motion chat prefilling honors unsaved-module guards and a newer route after a delayed read', async () => {
  let resolveRead, delayed = false
  const f = fixture({ api: async (name, args, { chats }) => name === 'piGet' && delayed ? new Promise(resolve => { resolveRead = () => resolve(structuredClone(chats.get(args[0]))) }) : undefined })
  const target = await f.api('piCreate', {}), view = await mountWorkbench(f)
  try {
    await view.openModule({ kind: 'video' }); f.leave(false)
    const before = f.calls.filter(([name]) => name === 'piGet').length
    assert.equal(await view.openChat(target.id, '准备好的动效指令'), false); assert.equal(f.calls.filter(([name]) => name === 'piGet').length, before)
    assert.equal(f.container.querySelector('.v2-workbench').dataset.page, 'module')
    f.leave(true); delayed = true; const opening = view.openChat(target.id, '迟到的动效指令'); await Promise.resolve(); await view.show('tools'); resolveRead()
    assert.equal(await opening, false); assert.equal(f.container.querySelector('.v2-workbench').dataset.page, 'tools')
    assert.notEqual(f.container.querySelector('.v2-composer textarea').value, '迟到的动效指令'); assert.equal(f.calls.some(([name]) => name === 'piSend'), false)
  } finally { view.destroy(); f.close() }
})

test('sidebar workflows keep existing projects reachable without duplicate tools cards and respect unsaved input', async () => {
  const f = fixture(), view = await mountWorkbench(f)
  try {
    for (const [page, label, selection] of [['video', '视频生成', { kind: 'video' }], ['blueprint', 'Agent Blueprint', { kind: 'blueprint', mode: 'product' }], ['starter', 'AI 产品开发', { kind: 'starter' }]]) { await view.show(page); assert.deepEqual(f.modules.at(-1), selection); assert.equal(f.button(label).getAttribute('aria-current'), 'page') }
    await view.show('tools'); assert.equal([...f.container.querySelectorAll('.v2-tool h2')].some(node => /视频|Agent Blueprint|AI 产品开发/.test(node.textContent)), false)
    for (const selection of [{ kind: 'blueprint', id: 'b1', mode: 'library' }, { kind: 'task', id: 't1' }]) { await view.openModule(selection); assert.deepEqual(f.modules.at(-1), selection); assert.equal(f.button('Agent Blueprint').getAttribute('aria-current'), 'page'); assert.equal(f.container.querySelector('.v2-page-name').textContent, 'Agent Blueprint'); assert.equal(f.container.querySelector('.v2-back').hidden, true) }
    await view.openModule({ kind: 'company' }); const opened = f.modules.length; f.leave(false)
    for (const label of ['视频生成', 'Agent Blueprint', 'AI 产品开发']) { f.button(label).click(); await settle(); assert.equal(f.modules.length, opened); assert.equal(f.button('工具').getAttribute('aria-current'), 'page') }
  } finally { view.destroy(); f.close() }
})

test('main chat waits for the saved global model before sending and preserves its draft while the menu changes', async () => {
  let finishSave, storedModel = 'deepseek-v4-pro', requestedModel
  const pending = new Promise(resolve => { finishSave = resolve })
  const f = fixture({ api: async (name, args) => {
    if (name === 'modelSelect') { await pending; storedModel = args[0]; return { schema: 1, model: storedModel, choices: [{ id: 'deepseek-v4-pro', label: 'Pro' }, { id: 'deepseek-flash', label: 'Flash（V4.1）' }] } }
    if (name === 'piSend') requestedModel = storedModel
  } }), view = await mountWorkbench(f)
  try {
    const input = f.container.querySelector('.v2-composer textarea'), picker = f.container.querySelector('.v2-model select')
    input.value = '用新模型继续'; input.dispatchEvent(new f.window.Event('input')); input.focus(); input.setSelectionRange(3, 3)
    picker.value = 'deepseek-flash'; picker.dispatchEvent(new f.window.Event('change', { bubbles: true }))
    assert.equal(input.value, '用新模型继续'); assert.equal(input.selectionStart, 3)
    f.container.querySelector('.v2-composer').dispatchEvent(new f.window.Event('submit', { cancelable: true })); await settle()
    assert.equal(f.calls.some(([name]) => name === 'piSend'), false)
    finishSave(); await settle(); assert.equal(requestedModel, 'deepseek-flash'); assert.equal(picker.value, 'deepseek-flash')
    assert.equal(f.calls.filter(([name]) => name === 'piSend').length, 1)
  } finally { view.destroy(); f.close() }
})

test('a failed model switch blocks a waiting send, restores Pro, and retains the unsent main-chat text', async () => {
  let failSave; const pending = new Promise((resolve, reject) => { failSave = reject })
  const f = fixture({ api: async name => { if (name === 'modelSelect') return pending } }), view = await mountWorkbench(f)
  try {
    const input = f.container.querySelector('.v2-composer textarea'), picker = f.container.querySelector('.v2-model select')
    input.value = '失败后保留这段'; input.dispatchEvent(new f.window.Event('input')); picker.value = 'deepseek-flash'; picker.dispatchEvent(new f.window.Event('change'))
    f.container.querySelector('.v2-composer').dispatchEvent(new f.window.Event('submit', { cancelable: true })); await settle()
    failSave(new Error('模型配置写入失败')); await settle()
    assert.equal(input.value, '失败后保留这段'); assert.equal(picker.value, 'deepseek-v4-pro'); assert.equal(f.calls.some(([name]) => name === 'piSend'), false)
    assert.match(f.container.querySelector('.v2-toast').textContent, /本次请求尚未发送/)
  } finally { view.destroy(); f.close() }
})

test('saved Lemo catalog items route into their exact Lemo project rather than the older video store', async () => {
  const f = fixture({ api: async name => name === 'piCatalog' ? { projects: [{ kind: 'lemo', id: 'lemo1', name: '我的 Lemo 品牌片', status: 'idle' }] } : undefined }), view = await mountWorkbench(f)
  try {
    await view.show('projects'); f.button('视频创作').click(); f.button('我的 Lemo 品牌片').click(); await settle()
    assert.deepEqual(f.modules.at(-1), { kind: 'video', mode: 'lemo', id: 'lemo1' }); assert.equal(f.button('视频生成').getAttribute('aria-current'), 'page')
  } finally { view.destroy(); f.close() }
})
