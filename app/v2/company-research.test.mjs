/** Keyless UI recordings of real company-session actions, reports and failure handling. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { mountCompanyResearch } from './company-research.mjs'

const settle = () => new Promise(resolve => setTimeout(resolve, 12))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const clone = value => structuredClone(value)
const project = (id = 'r1') => ({
  id, subject: id === 'r1' ? '青禾科技（测试）' : '星川机构（测试）', mode: 'company', depth: 'quick', purpose: '判断合作机会', website: 'https://example.com',
  chatId: 'pi-' + id, createdAt: '2026-10-25T09:00:00Z', updatedAt: '2026-10-25T09:00:00Z',
  chat: { id: 'pi-' + id, title: '公司调研', status: 'idle', messages: [], runs: [], model: '统一模型', pending: null },
  versions: [], sources: [], materials: [], draft: { exists: true },
})
function fixture(t, overrides = {}) {
  const dom = new JSDOM('<main id="research"></main>', { url: 'https://workbench.invalid' })
  globalThis.window = dom.window; globalThis.document = dom.window.document
  const projects = new Map([['r1', project()], ['r2', project('r2')]]), calls = [], toasts = [], openedChats = [], listeners = {}, cleanups = []
  const base = {
    companyList: () => [...projects.values()], companyGet: id => projects.get(id),
    companyCreate: values => { const result = { ...project('r3'), ...values }; projects.set(result.id, result); return result },
    companySend: (id, text) => { const p = projects.get(id); p.chat.status = 'running'; p.chat.messages.push({ role: 'user', content: text }, { role: 'assistant', content: '' }); return p },
    companyCancel: id => { projects.get(id).chat.status = 'cancelled'; return projects.get(id) },
    companyReply: (id, token, approved) => { const p = projects.get(id); p.chat.pending = null; p.chat.status = 'running'; return p },
    companyRead: (id, version) => ({ name: version === 'draft' ? 'draft.md' : '公司调研_' + (version || 'v1') + '.md', content: '# 可读报告\n\n业务与技术以来源为准。\n\n<script>window.bad=1</script>\n\n[S01](https://example.com/source)', audit: { passed: true, exitCode: 0, output: '静态检查通过' }, version: version || 'v1' }),
    companyPublish: id => { const p = projects.get(id); const audit = { passed: true, exitCode: 0, output: '静态检查通过' }; p.versions.push({ version: 'v1', name: '公司调研_v1.md', createdAt: '2026-10-25T09:00:00Z', audit }); p.lastAudit = audit; return { project: p, audit } },
    companyAddMaterial: (id, values) => { const p = projects.get(id); p.materials.push({ id: 'M01', ...values }); return p },
    companyImport: () => null, companyExport: () => ({ folder: '/tmp/test-export' }), companyPreview: () => ({ opened: true }), companyOpenFolder: () => true,
    companySearch: () => ({ results: [{ title: '官网线索', url: 'https://example.com' }] }),
    companyFetch: id => { const p = projects.get(id); p.sources.push({ id: 'S01', title: '官网声明', url: 'https://example.com', fetchedAt: '2026-10-25' }); return p },
    companyLibrary: () => [{ name: 'references/company-research-framework.md', size: 120 }], companyReadLibrary: name => ({ name, content: '# 原版方法\n\n完整资料。' }), openLink: () => true,
  }
  const api = async (name, ...args) => {
    calls.push([name, ...args]); const fn = overrides[name] || base[name]
    assert.equal(typeof fn, 'function', `unexpected API ${name}`)
    return clone(await fn(...args))
  }
  const events = {}
  for (const name of ['onPiUpdate', 'onCompanyUpdate']) events[name] = callback => { listeners[name] = callback; return () => cleanups.push(name) }
  const view = mountCompanyResearch({ container: document.querySelector('#research'), api, events, toast: value => toasts.push(value), openChat: id => openedChats.push(id) })
  t.after(() => { view.destroy(); dom.window.close(); delete globalThis.window; delete globalThis.document })
  const button = label => { const node = [...document.querySelectorAll('button')].find(item => item.textContent === label); assert.ok(node, 'button ' + label); return node }
  const input = (label, value) => { const node = document.querySelector(`[aria-label="${label}"]`); assert.ok(node, 'input ' + label); if (value !== undefined) { node.value = value; node.dispatchEvent(new dom.window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) } return node }
  return { view, dom, projects, calls, toasts, openedChats, listeners, cleanups, button, input }
}

test('three research scenarios resolve their default depth and creation never starts a model request', async t => {
  const { view, input, button, calls } = fixture(t)
  await view.open()
  assert.equal(input('调研场景').value, 'company'); assert.equal(input('调研深度').value, 'quick')
  input('调研场景', 'client'); assert.equal(input('调研深度').value, 'standard')
  input('调研场景', 'investor'); assert.equal(input('调研深度').value, 'standard')
  input('调研深度', 'deep'); input('调研对象', '星川基金（测试）')
  button('建立项目').click(); await settle()
  assert.deepEqual(calls.find(([name]) => name === 'companyCreate')[1], { subject: '星川基金（测试）', mode: 'investor', depth: 'deep', purpose: '', website: '', region: '', competitors: '', asOf: '' })
  assert.match(document.body.textContent, /星川基金（测试）/); assert.ok(button('开始调研'))
  assert.equal(calls.some(([name]) => name === 'companySend'), false)
  assert.equal(view.canLeave(), true)
})

test('explicit research and follow-up share the saved Pi conversation and preserve focused input during updates', async t => {
  const { view, projects, listeners, calls, button, input, openedChats } = fixture(t)
  await view.open({ id: 'r1' }); button('开始调研').click(); await settle()
  assert.equal(calls.filter(([name]) => name === 'companySend').length, 1)
  const complete = clone(projects.get('r1').chat); complete.status = 'idle'; complete.messages.at(-1).content = '初稿已整理。'; listeners.onPiUpdate(complete)
  const area = input('继续追问或补充要求', '解释客户付费的证据'); area.focus(); area.setSelectionRange(3, 6)
  listeners.onPiUpdate({ id: 'other-session', status: 'running', messages: [{ role: 'assistant', content: '不属于当前调研' }] })
  assert.doesNotMatch(document.body.textContent, /不属于当前调研/)
  listeners.onPiUpdate(complete)
  const restored = input('继续追问或补充要求'); assert.equal(restored.value, '解释客户付费的证据'); assert.equal(document.activeElement, restored); assert.equal(restored.selectionStart, 3)
  button('发送').click(); await settle()
  assert.deepEqual(calls.filter(([name]) => name === 'companySend').at(-1).slice(1), ['r1', '解释客户付费的证据'])
  assert.equal(input('继续追问或补充要求').value, '')
  button('在主聊天继续').click(); assert.deepEqual(openedChats, ['pi-r1'])
})

test('stop and approval target the same project and only expose the real operation request', async t => {
  const { view, projects, button, calls } = fixture(t)
  const p = projects.get('r1'); p.chat.status = 'waiting'; p.chat.messages = [{ role: 'assistant', content: '等待确认' }]; p.chat.pending = { token: 'approval-42', command: '发布到指定文档', reason: '需要核对发布对象' }
  await view.open({ id: 'r1' }); assert.match(document.body.textContent, /需要核对发布对象/)
  button('批准这次操作').click(); await settle()
  assert.deepEqual(calls.find(([name]) => name === 'companyReply').slice(1), ['r1', 'approval-42', true])
  assert.doesNotMatch(document.body.textContent, /这一步需要你确认/)
  button('停止执行').click(); await settle()
  assert.deepEqual(calls.find(([name]) => name === 'companyCancel').slice(1), ['r1']); assert.match(document.body.textContent, /已停止/)
})

test('report reading is safe, audit failures keep draft readable and versions retain their own records', async t => {
  let p
  const { view, projects, button, input, calls } = fixture(t, {
    companyPublish: () => { const audit = { passed: false, version: 'v2', exitCode: 1, output: '缺少来源 S09，需要修稿' }; p.versions.push({ version: 'v2', name: '待修稿v2.md', audit }); p.lastAudit = audit; return { project: p, audit } },
    companyRead: (id, version) => ({ name: version === 'draft' ? 'draft.md' : '旧版报告.md', content: '# 已有业务报告\n\n<img src=x onerror="window.bad=1"><script>window.bad=1</script>\n\n[不安全](javascript:alert(1))', audit: version === 'v2' || version === 'draft' ? { passed: false, output: '缺少来源 S09，需要修稿' } : { passed: true, output: '旧版结构通过' }, version }),
  })
  p = projects.get('r1'); p.versions = [{ version: 'v1', name: '旧版报告.md', createdAt: '2026-10-25T09:00:00Z', audit: { passed: true, output: '旧版结构通过' } }]
  await view.open({ id: 'r1' }); button('报告').click(); await settle()
  assert.match(document.body.textContent, /已有业务报告/); assert.equal(document.querySelector('.cr-markdown script'), null); assert.equal(document.querySelector('.cr-markdown img'), null); assert.equal(document.querySelector('.cr-markdown a[href^="javascript:"]'), null)
  button('检查并生成新版本').click(); await settle()
  assert.match(document.body.textContent, /静态检查未通过，需修稿/); assert.match(document.body.textContent, /缺少来源 S09，需要修稿/)
  assert.equal(input('报告版本').value, 'v2'); assert.match(document.body.textContent, /旧版报告.md/)
  assert.match(document.body.textContent, /不代表事实已被核验/); assert.equal(p.versions.length, 2)
  button('打开 HTML 预览').click(); await settle(); assert.deepEqual(calls.find(([name]) => name === 'companyPreview').slice(1), ['r1', 'v2'])
  button('历史版本').click(); assert.match(document.body.textContent, /版本 v1/); assert.match(document.body.textContent, /旧版结构通过/)
  const archived = [...document.querySelectorAll('.cr-version')].find(node => node.textContent.includes('版本 v1')); archived.querySelector('button').click(); await settle(); assert.equal(input('报告版本').value, 'v1')
  assert.match(document.body.textContent, /静态检查已通过/); assert.match(document.body.textContent, /旧版结构通过/); assert.doesNotMatch(document.body.textContent, /静态检查未通过/); assert.doesNotMatch(document.body.textContent, /缺少来源 S09/)
  button('导出报告包').click(); await settle(); assert.deepEqual(calls.find(([name]) => name === 'companyExport').slice(1), ['r1', 'v1', 'bundle'])
})

test('send failures retain typed instructions, and draft maps survive local project switches and hide', async t => {
  const { view, projects, input, button, calls, toasts } = fixture(t, { companySend: () => { throw new Error('统一 API 暂不可用') } })
  projects.get('r1').chat.messages = [{ role: 'assistant', content: '可以追问。' }]
  await view.open({ id: 'r1' }); input('继续追问或补充要求', '请解释营收口径')
  button('发送').click(); await settle()
  assert.equal(input('继续追问或补充要求').value, '请解释营收口径'); assert.match(document.body.textContent, /统一 API 暂不可用/)
  assert.equal(view.canLeave(), false); assert.match(toasts.at(-1), /未发送或未保存/)
  document.querySelector('[data-company-id="r2"]').click(); await settle(); input('继续追问或补充要求', '另一个项目的问题')
  document.querySelector('[data-company-id="r1"]').click(); await settle(); assert.equal(input('继续追问或补充要求').value, '请解释营收口径')
  view.hide(); await view.open({ id: 'r1' }); assert.equal(input('继续追问或补充要求').value, '请解释营收口径')
  assert.equal(calls.filter(([name]) => name === 'companySend').length, 1)
})

test('public search stays a lead until fetch, local materials and full original references remain available', async t => {
  const { view, button, input, calls, projects } = fixture(t)
  await view.open({ id: 'r1' }); button('来源与材料').click()
  assert.match(document.body.textContent, /搜索结果只作为线索/); input('查询关键词', '青禾 官网'); button('搜索线索').click(); await settle()
  assert.match(document.body.textContent, /官网线索/); assert.equal(projects.get('r1').sources.length, 0)
  input('公开网页地址', 'https://example.com'); button('采集网页正文').click(); await settle()
  assert.match(document.body.textContent, /\[S01\] 官网声明/); assert.match(document.body.textContent, /访问 2026-10-25/)
  input('材料名称', '会议纪要'); input('材料正文', '客户说明属于用户提供材料。'); button('保存材料').click(); await settle()
  assert.deepEqual(calls.find(([name]) => name === 'companyAddMaterial').slice(1), ['r1', { name: '会议纪要', content: '客户说明属于用户提供材料。' }]); assert.equal(input('材料正文').value, '')
  button('导入本地材料').click(); await settle(); assert.deepEqual(calls.find(([name]) => name === 'companyImport').slice(1), ['r1'])
  button('查看全部资料').click(); await settle(); button('references/company-research-framework.md').click(); await settle()
  assert.match(document.body.textContent, /原版方法/); assert.match(document.body.textContent, /完整资料/)
})

test('late report responses cannot overwrite another project or a more recently chosen version', async t => {
  const old = deferred(), newer = deferred(); let count = 0
  const { view, projects, button, input } = fixture(t, { companyRead: () => { count++; return count === 1 ? old.promise : newer.promise } })
  projects.get('r1').versions = [{ version: 'v1', name: '报告.md', audit: { passed: true } }]
  await view.open({ id: 'r1' }); button('报告').click(); await Promise.resolve(); input('报告版本', 'draft'); await Promise.resolve()
  newer.resolve({ name: '新选草稿', content: '# 新选草稿' }); await settle(); old.resolve({ name: '迟到旧版', content: '# 迟到旧版' }); await settle()
  assert.match(document.body.textContent, /新选草稿/); assert.doesNotMatch(document.body.textContent, /迟到旧版/)
  await view.open({ id: 'r2' }); assert.match(document.body.textContent, /星川机构/); assert.doesNotMatch(document.body.textContent, /新选草稿/)
})

test('late metadata refresh preserves newer Pi text, and hidden/destroyed views ignore events', async t => {
  const pendingGet = deferred(); let gets = 0
  const { view, projects, button, listeners, cleanups } = fixture(t, { companyGet: id => ++gets === 1 ? project(id) : pendingGet.promise })
  await view.open({ id: 'r1' }); listeners.onCompanyUpdate({ id: 'r1' }); await Promise.resolve()
  const chat = clone(projects.get('r1').chat); chat.messages = [{ role: 'assistant', content: '刚刚收到的新进度' }]; chat.status = 'running'; listeners.onPiUpdate(chat)
  pendingGet.resolve(project('r1')); await settle(); assert.match(document.body.textContent, /刚刚收到的新进度/)
  view.hide(); listeners.onPiUpdate({ ...chat, messages: [{ role: 'assistant', content: '隐藏时不渲染' }] }); assert.doesNotMatch(document.body.textContent, /隐藏时不渲染/)
  view.destroy(); assert.deepEqual(cleanups.sort(), ['onCompanyUpdate', 'onPiUpdate']); assert.equal(document.querySelector('.company-research'), null)
  assert.equal(await view.open(), false)
})

test('an unreadable archived source reports its limitation instead of claiming body collection succeeded', async t => {
  let p
  const { view, projects, button, input, toasts } = fixture(t, { companyFetch: () => {
    const result = { id: 'S01', title: '扫描版财报', url: 'https://example.com/report.pdf', readable: false, warning: 'PDF 已归档，但无法提取文字，请提供可读版本。' }
    p.sources.push(result); return result
  } })
  p = projects.get('r1'); await view.open({ id: 'r1' }); button('来源与材料').click(); input('公开网页地址', 'https://example.com/report.pdf'); button('采集网页正文').click(); await settle()
  assert.match(document.body.textContent, /未获得可读正文/); assert.match(document.body.textContent, /无法提取文字/); assert.match(toasts.at(-1), /未获得可读正文/)
})

test('empty projects show an honest report state and do not read or run nonexistent reports', async t => {
  const { view, projects, button, calls } = fixture(t); projects.get('r1').draft.exists = false
  await view.open({ id: 'r1' }); button('报告').click(); await settle()
  assert.match(document.body.textContent, /还没有归档报告/); assert.equal(calls.some(([name]) => name === 'companyRead'), false)
  assert.equal(calls.some(([name]) => name === 'companySend'), false)
  assert.equal(button('打开 HTML 预览').disabled, true); assert.equal(button('导出报告包').disabled, true)
})

test('a selected report keeps its own audit when the newest saved version has a different outcome', async t => {
  let p
  const { view, projects, button, input, listeners } = fixture(t, { companyRead: (_id, version) => {
    const selected = p.versions.find(item => item.version === version) || p.versions.at(-1)
    return { name: selected.name, content: '# ' + selected.name, version: selected.version, audit: selected.audit }
  } })
  p = projects.get('r1')
  p.versions = [
    { version: 'v1', name: '已通过的第一版.md', audit: { passed: true, output: '第一版检查通过' } },
    { version: 'v2', name: '需修改的第二版.md', audit: { passed: false, output: '第二版缺少引用' } },
  ]
  p.lastAudit = { ...p.versions[1].audit, version: 'v2' }
  await view.open({ id: 'r1' }); button('报告').click(); await settle()
  assert.match(document.body.textContent, /第二版缺少引用/)
  input('报告版本', 'v1'); await settle()
  assert.match(document.body.textContent, /第一版检查通过/); assert.doesNotMatch(document.body.textContent, /第二版缺少引用/); assert.doesNotMatch(document.body.textContent, /静态检查未通过/)
  listeners.onCompanyUpdate({ id: 'r1' }); await settle()
  assert.match(document.body.textContent, /第一版检查通过/); assert.doesNotMatch(document.body.textContent, /第二版缺少引用/)
  input('报告版本', 'v2'); await settle()
  assert.match(document.body.textContent, /第二版缺少引用/); assert.doesNotMatch(document.body.textContent, /第一版检查通过/)
})

test('report reading hides leading YAML metadata while retaining the source and export version', async t => {
  const source = '---\ntitle: GitHub 公司调研\nreport_id: technical-report-id\nsubject: GitHub\nmode: company\ndepth: standard\nas_of: 2026-10-25\nversion: v1\n---\n\n# GitHub 公司报告\n\n## 业务与技术\n\n这里是面向读者的报告正文。\n\n---\n\n正文内的分隔线保留。'
  const { view, projects, button, calls } = fixture(t, { companyRead: () => ({ name: 'GitHub_公司调研_v1.md', content: source, audit: { passed: true }, version: 'v1' }) })
  projects.get('r1').versions = [{ version: 'v1', name: 'GitHub_公司调研_v1.md', audit: { passed: true } }]
  await view.open({ id: 'r1' }); button('报告').click(); await settle()
  const reading = document.querySelector('.cr-workspace > .cr-markdown')
  assert.match(reading.textContent, /GitHub 公司报告/); assert.match(reading.textContent, /这里是面向读者的报告正文/)
  assert.doesNotMatch(reading.textContent, /report_id|technical-report-id|mode:|depth:|as_of:|version:/)
  assert.equal(reading.querySelectorAll('hr').length, 1)
  button('导出报告包').click(); await settle()
  assert.deepEqual(calls.find(([name]) => name === 'companyExport').slice(1), ['r1', undefined, 'bundle'])
  assert.match(source, /^---\ntitle: GitHub 公司调研\nreport_id: technical-report-id/)
})

test('a delayed project list does not leave a false empty claim or replace ongoing creation input', async t => {
  const list = deferred()
  const { view, projects, input } = fixture(t, { companyList: () => list.promise })
  projects.get('r1').subject = 'GitHub'
  const opening = view.open(); await Promise.resolve()
  const subject = input('调研对象', '正在填写的另一家公司'); subject.focus()
  list.resolve([...projects.values()]); await opening
  assert.match(document.querySelector('.cr-sidebar').textContent, /GitHub/)
  assert.doesNotMatch(document.querySelector('.cr-workspace').textContent, /还没有调研项目/)
  assert.equal(input('调研对象'), subject); assert.equal(subject.value, '正在填写的另一家公司'); assert.equal(document.activeElement, subject)
})
