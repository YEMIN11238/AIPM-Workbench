import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import { mountBlueprint } from './blueprint-view.mjs'
import { blueprintCopy as c } from './blueprint-copy.mjs'

const settle = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)) }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const task = (id, status = 'running', reports = []) => ({ id, title: `任务 ${id}`, mode: 'plan', status, stage: 'extract', reports, createdAt: '2026-10-20T05:00:00Z', updatedAt: '2026-10-20T05:00:00Z' })

function fixture(t, overrides = {}) {
  const dom = new JSDOM('<!doctype html><div id="host"></div>', { url: 'https://fixture.invalid/' })
  globalThis.window = dom.window
  const container = dom.window.document.querySelector('#host'), calls = [], notifications = []
  let receive
  const handlers = { blueprintStatus: () => ({ available: true, configured: true, model: 'deepseek-chat', activeId: null }), blueprintList: () => [], blueprintStart: () => task('new'), blueprintPick: () => null, blueprintGet: id => task(id, 'completed', [{ name: '方案.md' }]), blueprintReadReport: () => ({ name: '方案.md', content: '# 方案\n\n生成内容' }), blueprintCancel: id => task(id, 'cancelled'), blueprintResume: id => task(id), blueprintOpenFolder: () => true, copyText: () => true, ...overrides }
  const view = mountBlueprint({ container, api: async (name, ...args) => { calls.push({ name, args }); return handlers[name](...args) }, onUpdate: listener => { receive = listener; return () => { receive = null } }, toast: message => notifications.push(message) })
  const query = selector => container.querySelector(selector)
  const button = label => [...container.querySelectorAll('button')].find(node => node.textContent === label)
  const input = (selector, value) => { const node = query(selector); node.value = value; node.dispatchEvent(new dom.window.Event('input', { bubbles: true })) }
  const submit = () => query('form').dispatchEvent(new dom.window.Event('submit', { cancelable: true, bubbles: true }))
  t.after(() => { view.destroy(); dom.window.close(); delete globalThis.window })
  return { dom, container, query, button, input, submit, view, calls, notifications, update: value => receive?.(value), handlers }
}

test('navigation preserves separate mode drafts and imported initial content without a model call', async t => {
  const f = fixture(t, { blueprintPick: () => ({ path: '/Users/example/project' }) })
  await f.view.show('plan', '来自现有项目的需求')
  assert.equal(f.query('[name="idea"]').value, '来自现有项目的需求')
  f.input('[name="title"]', '我的助手')
  f.button(c.audit).click(); f.button(c.pickProject).click(); await settle()
  assert.equal(f.query('[name="projectPath"]').value, '/Users/example/project')
  f.input('[name="title"]', '已有项目检查')
  f.button(c.plan).click()
  assert.equal(f.query('[name="idea"]').value, '来自现有项目的需求')
  assert.equal(f.query('[name="title"]').value, '我的助手')
  f.view.hide(); await f.view.show()
  assert.equal(f.query('[name="idea"]').value, '来自现有项目的需求')
  f.button(c.audit).click()
  assert.equal(f.query('[name="title"]').value, '已有项目检查')
  assert.equal(f.calls.filter(call => call.name === 'blueprintStart').length, 0)
})

test('missing credentials block both the visible submit and synthetic form submission', async t => {
  const f = fixture(t, { blueprintStatus: () => ({ available: true, configured: false }) })
  await f.view.show('plan', '做一个学习助手')
  assert.equal(f.query('[data-action="start"]').disabled, true)
  assert.match(f.container.textContent, /API Key/)
  f.submit(); await settle()
  assert.equal(f.calls.filter(call => call.name === 'blueprintStart').length, 0)
})

test('only explicit submission starts a task and double submission cannot create duplicate runs', async t => {
  const pending = deferred()
  const f = fixture(t, { blueprintStart: () => pending.promise })
  await f.view.show('plan', '帮学生整理课堂笔记')
  assert.equal(f.query('[data-action="start"]').disabled, false)
  f.submit(); f.submit()
  assert.equal(f.calls.filter(call => call.name === 'blueprintStart').length, 1)
  assert.equal(f.query('[data-action="start"]').disabled, true)
  pending.resolve(task('new')); await settle()
  assert.match(f.query('.bp-result').textContent, /执行中/)
  assert.match(f.query('.bp-result').textContent, /提取需求/)
  assert.equal(f.query('[data-action="start"]').disabled, true)
  assert.equal(f.calls.find(call => call.name === 'blueprintStart').args[0].input, '帮学生整理课堂笔记')
})

test('audit selection and optional PRD are sent to the real task API on explicit start', async t => {
  const f = fixture(t, { blueprintPick: kind => kind === 'project' ? { path: '/project/local' } : { path: '/project/requirements.md', text: '用户需求' } })
  await f.view.show('audit')
  f.button(c.pickProject).click(); await settle()
  f.button(c.importPrd).click(); await settle()
  assert.equal(f.calls.filter(call => call.name === 'blueprintStart').length, 0)
  f.submit(); await settle()
  const payload = f.calls.find(call => call.name === 'blueprintStart').args[0]
  assert.equal(payload.mode, 'audit'); assert.equal(payload.projectPath, '/project/local'); assert.equal(payload.prdText, '用户需求')
})

test('reports render safe Markdown, keep source HTML inert, and copy the original document', async t => {
  const source = '# 架构方案\n\n<script>window.compromised=true</script>\n\n![追踪](https://tracker.invalid/image.png)\n\n[危险](javascript:alert%281%29)\n\n- 工具权限'
  const f = fixture(t, { blueprintList: () => [task('done', 'needs_review', [{ name: '方案.md' }])], blueprintReadReport: () => ({ name: '方案.md', content: source }) })
  await f.view.show(); await settle()
  const report = f.query('[data-report-body]')
  assert.equal(report.querySelector('h1').textContent, '架构方案')
  assert.equal(report.querySelector('script,img,iframe,[onerror]'), null)
  assert.match(report.textContent, /<script>/)
  assert.equal(f.dom.window.compromised, undefined)
  assert.match(f.query('.bp-result').textContent, /需要复核/)
  f.button(c.copy).click(); await settle()
  assert.equal(f.calls.find(call => call.name === 'copyText').args[0], source)
})

test('a slow previous report cannot overwrite the newly selected task', async t => {
  const oldReport = deferred()
  const f = fixture(t, { blueprintList: () => [task('first', 'completed', [{ name: '方案.md' }]), task('second', 'completed', [{ name: '方案.md' }])], blueprintReadReport: id => id === 'first' ? oldReport.promise : { name: '方案.md', content: '# 第二份报告' } })
  await f.view.show()
  f.query('[data-task="second"]').click(); await settle()
  assert.equal(f.query('[data-report-body] h1').textContent, '第二份报告')
  oldReport.resolve({ name: '方案.md', content: '# 过期报告' }); await settle()
  assert.equal(f.query('[data-report-body] h1').textContent, '第二份报告')
})

test('failed submission preserves draft and allows retry, then cancellation is visible and resumable', async t => {
  let attempts = 0
  const f = fixture(t, { blueprintStart: () => { if (!attempts++) throw new Error('模型暂时不可用'); return task('retry') } })
  await f.view.show('plan', '保留这份输入')
  f.submit(); await settle()
  assert.equal(f.query('[name="idea"]').value, '保留这份输入')
  assert.equal(f.query('[data-action="start"]').disabled, false)
  assert.deepEqual(f.notifications, ['模型暂时不可用'])
  f.submit(); await settle()
  f.button(c.cancel).click(); await settle()
  assert.match(f.query('.bp-result').textContent, /已取消/)
  assert.ok(f.button(c.resume))
  f.button(c.resume).click(); await settle()
  assert.equal(f.calls.filter(call => call.name === 'blueprintResume').length, 1)
  assert.match(f.query('.bp-result').textContent, /执行中/)
})

test('a completed event arriving before task creation returns remains completed', async t => {
  const pending = deferred()
  const f = fixture(t, { blueprintStart: () => pending.promise })
  await f.view.show('plan', '快速任务')
  f.submit()
  f.update({ ...task('fast', 'completed', [{ name: '方案.md' }]), updatedAt: '2026-10-20T05:01:00Z' })
  pending.resolve(task('fast')); await settle()
  assert.match(f.query('.bp-result').textContent, /草稿已生成/)
  assert.equal(f.query('[data-action="start"]').disabled, false)
})

test('report read failure offers a retry without losing the selected task', async t => {
  let attempts = 0
  const f = fixture(t, { blueprintList: () => [task('done', 'completed', [{ name: '方案.md' }])], blueprintReadReport: () => { if (!attempts++) throw new Error('读取失败'); return { name: '方案.md', content: '# 已恢复' } } })
  await f.view.show(); await settle()
  assert.match(f.query('[data-report-body]').textContent, /读取失败/)
  f.button(c.retryReport).click(); await settle()
  assert.equal(f.query('[data-report-body] h1').textContent, '已恢复')
})

test('background progress keeps the typed draft and its caret position', async t => {
  const f = fixture(t)
  await f.view.show('plan', '保留输入位置')
  const input = f.query('[name="idea"]'); input.focus(); input.setSelectionRange(2, 3)
  f.update(task('other'))
  assert.equal(f.dom.window.document.activeElement.name, 'idea')
  assert.equal(f.query('[name="idea"]').value, '保留输入位置')
  assert.equal(f.query('[name="idea"]').selectionStart, 2)
  assert.equal(f.query('[name="idea"]').selectionEnd, 3)
})

test('an empty saved report is distinct from an unfinished report request', async t => {
  const f = fixture(t, { blueprintList: () => [task('empty', 'completed', [{ name: '方案.md' }])], blueprintReadReport: () => ({ name: '方案.md', content: '' }) })
  await f.view.show(); await settle()
  assert.match(f.query('[data-report-body]').textContent, /没有正文/)
  assert.doesNotMatch(f.query('[data-report-body]').textContent, /正在读取/)
})

test('configuration and usage present configured model plus measured calls and total tokens', async t => {
  const f = fixture(t, { blueprintList: () => [{ ...task('usage', 'completed'), usage: { calls: 4, input_tokens: 1200, output_tokens: 800, max_calls: 10, max_tokens: 50000 } }] })
  await f.view.show()
  assert.match(f.query('.bp-health').textContent, /模型已配置/)
  assert.doesNotMatch(f.query('.bp-health').textContent, /已连接/)
  assert.match(f.query('.bp-result').textContent, /4 次模型调用 · 2000 tokens/)
  assert.doesNotMatch(f.query('.bp-result').textContent, /人民币|费用|元/)
})
