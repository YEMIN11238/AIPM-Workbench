/** Company research keeps its reports and conversation in the host's real Pi session. */
import { renderMarkdown } from '../assets/document-format.js'

const C = Object.freeze({
  title: '公司与客户调研', intro: '从公开信息和你提供的材料，整理可追溯的公司报告、客户拜访或融资准备。',
  create: '新建调研', subject: '调研对象', subjectHint: '公司、品牌或投资机构名称', mode: '调研场景', depth: '调研深度',
  modes: { company: '了解公司', client: '客户拜访', investor: '投资人拜访' },
  depths: { quick: '快速了解', standard: '标准调研', deep: '深入调研' },
  purpose: '调研目的与关注问题', website: '官网', region: '所在地区', competitors: '指定竞对', asOf: '信息截止日',
  extra: '补充信息（可选）', existing: '已有调研', empty: '输入一个主体建立项目，再开始调研；已有项目可从左侧继续打开。',
  creating: '正在创建…', start: '开始调研', initial: '请根据当前项目的主体、模式、深度和补充信息开始调研。先确认主体与信息口径，按原版方法采集公开来源，保留证据缺口，生成报告草稿并检查交付。',
  tabs: { chat: '对话', report: '报告', sources: '来源与材料', versions: '历史版本' },
  followup: '继续追问或补充要求', followupHint: '补充关注问题，或让 Pi 修改报告、解释证据和结论…',
  send: '发送', stop: '停止执行', toChat: '在主聊天继续', folder: '打开项目文件夹',
  noReport: '还没有归档报告。开始调研后，Pi 会整理草稿；检查后可保留为新版本。',
  draft: '当前草稿', latest: '最新归档报告', publish: '检查并生成新版本', preview: '打开 HTML 预览', export: '导出报告包',
  auditNote: '静态检查核对报告结构、来源标注及文件一致性。检查通过不代表事实已被核验，也不代表完成尽调。',
  noVersions: '还没有归档版本。每次生成新版本都会保留旧文件。', noSources: '还没有已采集的来源。搜索结果只作为线索，读取正文后才进入来源账本。',
  noMaterials: '还没有用户材料。可导入年报、会议纪要、RFP 或产品手册，也可以直接粘贴。',
  import: '导入本地材料', materialName: '材料名称', materialText: '材料正文', addMaterial: '保存材料',
  sourceSearch: '查找公开资料', search: '搜索线索', query: '查询关键词', fetch: '采集网页正文', url: '公开网页地址',
  library: '原版方法与资料', readError: '报告暂时无法读取，请重试。', retry: '重试', loading: '正在读取…',
  unsent: '还有未发送或未保存的内容，请先发送、保存或清空后离开。',
})
const STATUS = { idle: '可以继续', running: '正在调研', waiting: '等待你确认', paused: '已暂停，可继续', failed: '需要处理', cancelled: '已停止', interrupted: '上次执行已中断', completed: '本轮已结束' }
const TOOL_NAMES = { read: '读取资料', write: '保存文件', edit: '修改报告', bash: '执行检查', workbench: '使用调研工具', grep: '搜索内容', find: '查找文件', ls: '查看目录', computer: '操作电脑' }
const active = chat => ['running', 'waiting'].includes(chat?.status)
const versionLabel = version => version === 'draft' ? C.draft : version === undefined ? C.latest : `版本 ${version}`
const message = error => error?.message || '操作未完成，请重试。'
const safeText = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2)
// Report metadata remains in saved files while the reading surface starts at the body.
const reportBody = source => source.replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '')
const compactDate = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''

/**
 * Mount the dedicated research surface; opening it never starts a model request.
 * @param {{container:HTMLElement,api:Function,events?:object,toast?:Function,openChat?:Function}} options Host API and subscriptions.
 * @returns {{open:Function,hide:Function,canLeave:Function,destroy:Function}} Navigation and cleanup controls.
 */
export function mountCompanyResearch({ container, api, events = {}, toast = () => {}, openChat = () => {} }) {
  const doc = container.ownerDocument
  const el = (tag, cls, text) => { const node = doc.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node }
  const state = { visible: false, disposed: false, revision: 0, project: null, projects: [], tab: 'chat', loading: false, error: '', listError: '', newMode: false, busy: new Set(), report: null, reportVersion: undefined, reportError: '', reportLoading: false, reportRevision: 0, publishAudit: null, chatStamp: 0, snapshotRevision: 0, searchResults: null, searchError: '', library: null, libraryFile: null, libraryError: '', libraryRevision: 0 }
  const drafts = new Map(), searchDrafts = new Map(), materials = new Map(), newDraft = { subject: '', mode: 'company', depth: 'quick', purpose: '', website: '', region: '', competitors: '', asOf: '' }
  const root = el('section', 'company-research'), sidebar = el('aside', 'cr-sidebar'), workspace = el('main', 'cr-workspace')
  root.setAttribute('aria-label', C.title); sidebar.setAttribute('aria-label', C.existing); root.append(sidebar, workspace); root.hidden = true; container.append(root)
  const valid = (revision = state.revision, id = state.project?.id) => !state.disposed && state.visible && revision === state.revision && (id ?? null) === (state.project?.id ?? null)
  const fail = (error, revision = state.revision, id = state.project?.id) => { if (!valid(revision, id)) return; state.error = message(error); renderWorkspace(); toast(state.error) }
  const run = action => async event => { try { await action(event) } catch (error) { fail(error) } }
  const button = (label, action, cls = 'v2-tool-button') => { const node = el('button', cls, label); node.type = 'button'; node.onclick = run(action); return node }
  const hint = text => el('p', 'cr-note', text)
  const mark = text => { const node = el('article', 'markdown-content cr-markdown'); node.innerHTML = renderMarkdown(text || ''); return node }
  const actions = (...nodes) => { const row = el('div', 'cr-actions'); row.append(...nodes); return row }
  const busy = name => state.busy.has(`${state.project?.id || 'new'}:${name}`)
  const key = (id, name) => `${id || 'new'}:${name}`
  const material = id => { if (!materials.has(id)) materials.set(id, { name: '', content: '' }); return materials.get(id) }
  const searchDraft = id => { if (!searchDrafts.has(id)) searchDrafts.set(id, { query: '', url: '' }); return searchDrafts.get(id) }
  function field(label, value, change, { area = false, type = 'text', placeholder = '', fieldKey = label } = {}) {
    const row = el('label', 'cr-field', label), input = el(area ? 'textarea' : 'input', 'v2-tool-input')
    if (!area) input.type = type; else input.rows = 4
    input.value = value || ''; input.placeholder = placeholder; input.setAttribute('aria-label', label); input.dataset.companyField = fieldKey
    input.oninput = () => change(input.value); row.append(input); return { row, input }
  }
  function select(label, choices, value, change) {
    const row = el('label', 'cr-field', label), input = el('select', 'v2-tool-input'); input.setAttribute('aria-label', label); input.dataset.companyField = label
    for (const [id, text] of Object.entries(choices)) { const option = el('option', '', text); option.value = id; input.append(option) }
    input.value = value; input.onchange = () => change(input.value); row.append(input); return { row, input }
  }
  function disclosure(label, ...nodes) { const section = el('details', 'cr-disclosure'); section.append(el('summary', '', label), ...nodes); return section }
  function preserveFocus(render) {
    const focused = workspace.contains(doc.activeElement) ? doc.activeElement : null, name = focused?.dataset?.companyField
    const selection = name && typeof focused.selectionStart === 'number' ? [focused.selectionStart, focused.selectionEnd] : null
    const scroll = workspace.scrollTop, openDetails = [...workspace.querySelectorAll('details[open]')].map(node => node.dataset.companyDetails).filter(Boolean)
    render()
    for (const node of workspace.querySelectorAll('details[data-company-details]')) if (openDetails.includes(node.dataset.companyDetails)) node.open = true
    if (name) {
      const next = [...workspace.querySelectorAll('[data-company-field]')].find(node => node.dataset.companyField === name)
      if (next) { next.focus({ preventScroll: true }); if (selection && typeof next.setSelectionRange === 'function') next.setSelectionRange(...selection) }
    }
    workspace.scrollTop = scroll
  }
  function renderSidebar() {
    sidebar.replaceChildren(el('div', 'cr-side-heading', C.existing), button('＋ ' + C.create, () => chooseNew(), 'v2-tool-button cr-new'))
    if (state.listError) sidebar.append(el('p', 'cr-error', state.listError), button(C.retry, () => refreshList()))
    if (!state.projects.length && !state.listError) sidebar.append(hint('建立调研后，可以在这里继续打开。'))
    for (const project of state.projects) {
      const row = button('', () => chooseProject(project.id), 'cr-project')
      row.setAttribute('aria-current', String(!state.newMode && state.project?.id === project.id)); row.dataset.companyId = project.id
      row.append(el('strong', '', project.subject), el('small', '', `${C.modes[project.mode] || C.modes.company} · ${C.depths[project.depth] || C.depths.quick}`))
      sidebar.append(row)
    }
  }
  function renderCreate() {
    workspace.append(el('h1', 'cr-title', C.title), hint(C.intro))
    const form = el('form', 'cr-create'), subject = field(C.subject, newDraft.subject, value => { newDraft.subject = value }, { placeholder: C.subjectHint })
    subject.input.required = true; subject.input.maxLength = 200; form.append(subject.row)
    const choices = el('div', 'cr-two-fields'), mode = select(C.mode, C.modes, newDraft.mode, value => {
      newDraft.mode = value; newDraft.depth = value === 'company' ? 'quick' : 'standard'; renderWorkspace()
    }), depth = select(C.depth, C.depths, newDraft.depth, value => { newDraft.depth = value })
    choices.append(mode.row, depth.row); form.append(choices)
    const extra = disclosure(C.extra); extra.dataset.companyDetails = 'create-extra'
    for (const [name, label, area, type] of [['purpose', C.purpose, true], ['website', C.website, false, 'url'], ['region', C.region], ['competitors', C.competitors], ['asOf', C.asOf, false, 'date']]) extra.append(field(label, newDraft[name], value => { newDraft[name] = value }, { area, type: type || 'text' }).row)
    const submit = el('button', 'v2-tool-button primary', busy('create') ? C.creating : '建立项目'); submit.type = 'submit'; submit.disabled = busy('create')
    form.append(extra, hint('只需填写主体。建立项目会保存资料，点击“开始调研”后才使用工作台统一模型。'), submit)
    form.onsubmit = run(async event => {
      event.preventDefault(); if (busy('create') || !newDraft.subject.trim()) return
      const revision = state.revision, values = { ...newDraft, subject: newDraft.subject.trim() }, operation = key(null, 'create')
      state.busy.add(operation); state.error = ''; renderWorkspace()
      try {
        const project = await api('companyCreate', values)
        for (const name of Object.keys(newDraft)) if (newDraft[name] === values[name] || name === 'subject' && newDraft[name].trim() === values[name]) newDraft[name] = name === 'mode' ? 'company' : name === 'depth' ? 'quick' : ''
        if (!valid(revision, null)) return
        state.projects = [project, ...state.projects.filter(item => item.id !== project.id)]; await chooseProject(project.id, project)
      } catch (error) { fail(error, revision, null) }
      finally { state.busy.delete(operation); if (state.visible && !state.disposed) renderWorkspace() }
    })
    workspace.append(form)
    if (!state.projects.length) workspace.append(hint(C.empty))
    renderLibrary(workspace)
  }
  function applyProject(project, stamp = state.chatStamp) {
    if (!project?.id) return
    const chat = state.project?.id === project.id && stamp !== state.chatStamp ? state.project.chat : project.chat
    state.project = { ...project, chat }
    const index = state.projects.findIndex(item => item.id === project.id)
    if (index < 0) state.projects.unshift(project); else state.projects[index] = project
  }
  function renderProject() {
    const project = state.project, chat = project.chat
    const header = el('header', 'cr-project-heading'), titles = el('div')
    titles.append(el('h1', 'cr-title', project.subject), hint(`${C.modes[project.mode] || C.modes.company} · ${C.depths[project.depth] || C.depths.quick}${project.asOf ? ' · 截至 ' + project.asOf : ''}`))
    const toChat = button(C.toChat, () => { if (canLeave()) return openChat(project.chatId) }); toChat.disabled = !project.chatId
    header.append(titles, actions(toChat, button(C.folder, () => projectAction('folder', () => api('companyOpenFolder', project.id)))))
    workspace.append(header)
    const tabs = el('nav', 'cr-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '调研项目')
    for (const [id, text] of Object.entries(C.tabs)) {
      const node = button(text, async () => { state.tab = id; state.error = ''; renderWorkspace(); if (id === 'report' && !state.report && (project.versions?.length || project.draft?.exists)) await loadReport(state.reportVersion) }, 'cr-tab')
      node.setAttribute('role', 'tab'); node.setAttribute('aria-selected', String(state.tab === id)); node.tabIndex = state.tab === id ? 0 : -1; tabs.append(node)
    }
    workspace.append(tabs)
    if (chat?.error) { const error = el('p', 'cr-error', chat.error); error.setAttribute('role', 'alert'); workspace.append(error) }
    if (state.tab === 'chat') renderChat(project)
    if (state.tab === 'report') renderReport(project)
    if (state.tab === 'sources') renderSources(project)
    if (state.tab === 'versions') renderVersions(project)
  }
  function renderWorkspace() {
    if (!state.visible || state.disposed) return
    preserveFocus(() => {
      workspace.replaceChildren()
      if (state.error) { const error = el('p', 'cr-error', state.error); error.setAttribute('role', 'alert'); workspace.append(error) }
      if (state.loading) { workspace.append(hint(C.loading)); return }
      if (state.newMode || !state.project) renderCreate(); else renderProject()
    })
  }
  function renderChat(project) {
    const chat = project.chat || {}, history = el('div', 'cr-conversation'); history.setAttribute('aria-live', 'polite')
    if (!chat.messages?.length) {
      const welcome = el('section', 'cr-welcome'); welcome.append(el('h2', '', '从这次要做的决定开始'), hint(project.purpose || '先核对主体，再看业务、技术、财务、商业质量与风险。找不到的证据会明确留空。'))
      const start = button(C.start, () => sendText(C.initial), 'v2-tool-button primary'); start.disabled = active(chat) || busy('send'); welcome.append(start); history.append(welcome)
    }
    for (const item of chat.messages || []) {
      const article = el('article', `cr-message ${item.role === 'user' ? 'user' : 'assistant'}`); article.append(el('small', 'cr-message-role', item.role === 'user' ? '你' : 'Pi'))
      if (item.role === 'user') article.append(el('p', 'cr-user-text', item.content)); else if (item.content) article.append(mark(item.content)); else article.append(hint(chat.activity || 'Pi 正在处理…'))
      history.append(article)
    }
    workspace.append(history)
    if (chat.status === 'paused') workspace.append(hint(chat.pause?.reason || '执行已暂停，历史和文件已保存。可以继续发送要求。'))
    if (chat.pending) {
      const approval = el('section', 'cr-approval'); approval.setAttribute('role', 'alert'); approval.append(el('h2', '', '这一步需要你确认'), hint(chat.pending.reason || '请核对操作范围。'), el('pre', '', chat.pending.command || '等待确认当前操作'))
      const approve = button('批准这次操作', () => reply(true), 'v2-tool-button primary'), reject = button('不执行', () => reply(false)); approve.disabled = reject.disabled = busy('reply'); approval.append(actions(approve, reject)); workspace.append(approval)
    }
    const form = el('form', 'cr-composer'), input = field(C.followup, drafts.get(project.id) || '', value => { drafts.set(project.id, value) }, { area: true, placeholder: C.followupHint, fieldKey: 'followup' })
    input.input.rows = 3; input.input.maxLength = 30000
    input.input.onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void run(() => sendText())() } }
    const send = el('button', 'v2-tool-button primary', busy('send') ? '正在发送…' : C.send); send.type = 'submit'; send.disabled = active(chat) || busy('send')
    const stop = button(busy('cancel') ? '正在停止…' : C.stop, () => cancel()); stop.hidden = !active(chat); stop.disabled = busy('cancel')
    form.append(input.row, actions(el('span', 'cr-note', `${STATUS[chat.status] || '可以继续'}${chat.model ? ' · ' + chat.model : ''}`), send, stop), hint('Enter 发送 · Shift + Enter 换行。与主聊天使用同一会话和统一 API。'))
    form.onsubmit = run(event => { event.preventDefault(); return sendText() }); workspace.append(form)
    const records = disclosure(`执行记录（${(chat.runs || []).reduce((sum, item) => sum + (item.tools?.length || 0), 0)}）`); records.dataset.companyDetails = 'tools'
    if (!chat.runs?.length) records.append(hint('实际搜索、采集和文件检查会在这里显示。'))
    for (const run of [...(chat.runs || [])].reverse()) {
      const group = el('section', 'cr-run'); group.append(hint(`${compactDate(run.startedAt)}${run.status ? ' · ' + (STATUS[run.status] || run.status) : ''}`))
      for (const step of run.tools || []) {
        const name = TOOL_NAMES[step.name] || step.name, status = ({ done: '已完成', completed: '已完成', failed: '未完成', running: '执行中', cancelled: '已停止', paused: '已暂停' })[step.status] || '待处理'
        const detail = disclosure(`${name} · ${status}`); if (step.args) detail.append(el('pre', '', safeText(step.args))); if (step.result !== undefined) detail.append(el('pre', '', safeText(step.result))); group.append(detail)
      }
      records.append(group)
    }
    workspace.append(records)
  }
  async function projectAction(name, action, { refresh = false } = {}) {
    const id = state.project?.id, revision = state.revision, operation = key(id, name), stamp = state.chatStamp
    if (!id || state.busy.has(operation) || state.disposed) return null
    state.busy.add(operation); state.error = ''; renderWorkspace()
    try {
      const result = await action()
      if (!valid(revision, id)) return result
      if (result?.id === id) applyProject(result, stamp)
      else if (result?.project?.id === id) applyProject(result.project, stamp)
      if (refresh) await refreshProject(revision, id)
      return result
    } catch (error) { fail(error, revision, id); return null }
    finally { state.busy.delete(operation); if (valid(revision, id)) { renderSidebar(); renderWorkspace() } }
  }
  async function sendText(provided) {
    const project = state.project, revision = state.revision, id = project?.id, text = provided ?? drafts.get(id) ?? ''
    if (!id || !text.trim() || active(project.chat) || busy('send')) return
    const result = await projectAction('send', () => api('companySend', id, text))
    if (result && provided === undefined && drafts.get(id) === text) drafts.delete(id)
    if (result && valid(revision, id)) {
      if (result.id === project.chatId) { state.project.chat = result; ++state.chatStamp }
      renderWorkspace()
    }
  }
  async function cancel() {
    const project = state.project, revision = state.revision
    const result = await projectAction('cancel', () => api('companyCancel', project.id))
    if (result?.id === project.chatId && valid(revision, project.id)) { state.project.chat = result; ++state.chatStamp; renderWorkspace() }
  }
  async function reply(approved) {
    const project = state.project, revision = state.revision, token = project.chat?.pending?.token
    if (!token) return
    const result = await projectAction('reply', () => api('companyReply', project.id, token, approved))
    if (result?.id === project.chatId && valid(revision, project.id)) { state.project.chat = result; ++state.chatStamp; renderWorkspace() }
  }
  function auditBox(audit) {
    const section = el('section', `cr-audit ${audit.passed ? 'passed' : 'failed'}`); section.setAttribute('role', audit.passed ? 'status' : 'alert')
    section.append(el('strong', '', audit.passed ? '静态检查已通过' : '静态检查未通过，需修稿'), hint(audit.passed ? '仍需核对报告事实与重要判断。' : '草稿和旧版本仍然保留，可让 Pi 根据检查结果继续修改。'))
    if (audit.output) section.append(disclosure('查看检查结果', el('pre', '', safeText(audit.output))))
    return section
  }
  function renderReport(project) {
    const toolbar = el('div', 'cr-actions'), versions = { latest: C.latest, draft: C.draft }
    for (const version of [...(project.versions || [])].reverse()) versions[String(version.version)] = `版本 ${version.version}`
    const selected = state.reportVersion === undefined ? 'latest' : String(state.reportVersion)
    const selector = select('报告版本', versions, selected, value => loadReport(value === 'latest' ? undefined : value === 'draft' ? 'draft' : project.versions.find(item => String(item.version) === value)?.version))
    toolbar.append(selector.row, button('重新读取', () => loadReport(state.reportVersion)))
    const publish = button(busy('publish') ? '正在检查…' : C.publish, publishReport); publish.disabled = active(project.chat) || busy('publish'); toolbar.append(publish)
    const preview = button(C.preview, () => projectAction('preview', () => api('companyPreview', project.id, state.reportVersion))), download = button(C.export, () => exportReport())
    preview.disabled = download.disabled = !state.report || state.report.version === 'draft' || state.reportVersion === 'draft'
    toolbar.append(preview, download); workspace.append(toolbar)
    if (state.report?.version === 'draft' || state.reportVersion === 'draft') workspace.append(hint('当前草稿可直接阅读；先生成归档版本后，才能预览 HTML 和导出完整报告包。'))
    workspace.append(hint(C.auditNote))
    if (state.reportLoading) workspace.append(hint(C.loading))
    else if (state.reportError) workspace.append(el('p', 'cr-error', state.reportError), button(C.retry, () => loadReport(state.reportVersion)))
    else if (state.report) {
      workspace.append(el('h2', 'cr-report-name', state.report.name || versionLabel(state.reportVersion)))
      const audit = state.report.audit || (state.publishAudit?.version && state.publishAudit.version === state.report.version ? state.publishAudit : null)
      if (audit) workspace.append(auditBox(audit))
      workspace.append(mark(reportBody(state.report.content)))
    } else workspace.append(hint(C.noReport))
  }
  async function loadReport(version, publicationAudit = null) {
    if (!state.project) return
    const id = state.project.id, revision = state.revision, request = ++state.reportRevision
    state.reportVersion = version; state.report = null; state.publishAudit = publicationAudit; state.reportError = ''; state.reportLoading = true; renderWorkspace()
    try {
      const report = await api('companyRead', id, version, 'markdown')
      if (!valid(revision, id) || request !== state.reportRevision) return
      state.report = report
    } catch (error) { if (valid(revision, id) && request === state.reportRevision) state.reportError = message(error) }
    finally { if (valid(revision, id) && request === state.reportRevision) { state.reportLoading = false; renderWorkspace() } }
  }
  async function publishReport() {
    const project = state.project, revision = state.revision
    const result = await projectAction('publish', () => api('companyPublish', project.id), { refresh: true })
    if (!result || !valid(revision, project.id)) return
    const audit = result.audit || result.lastAudit || result.project?.lastAudit || state.project.lastAudit || state.project.versions?.at(-1)?.audit || null
    const publicationAudit = audit ? { ...audit, version: audit.version || state.project.versions?.at(-1)?.version } : null
    await loadReport(audit?.passed === false ? publicationAudit.version || 'draft' : undefined, publicationAudit)
  }
  async function exportReport() {
    const result = await projectAction('export', () => api('companyExport', state.project.id, state.reportVersion, 'bundle'))
    if (result?.folder && state.visible && !state.disposed) toast('报告包已导出。')
  }
  function sourceLink(source) {
    const row = el('article', 'cr-source'); row.append(el('strong', '', `[${source.id || source.code || '来源'}] ${source.title || '公开资料'}`))
    const facts = [source.publisher, source.publishedAt ? '发布 ' + source.publishedAt : '', source.accessedAt || source.fetchedAt ? '访问 ' + (source.accessedAt || source.fetchedAt) : ''].filter(Boolean)
    if (facts.length) row.append(hint(facts.join(' · ')))
    if (source.url) {
      let allowed = false
      try { allowed = ['https:', 'http:'].includes(new URL(source.url).protocol) } catch (error) { /* Invalid source URLs remain visible text only. */ }
      if (allowed) { const link = button(source.url, () => api('openLink', source.url), 'cr-source-link'); row.append(link) }
      else row.append(hint(source.url))
    }
    if (source.readable === false) row.append(el('p', 'cr-error', '已归档来源，但未获得可读正文。'))
    if (source.warning) row.append(el('p', 'cr-error', source.warning))
    if (source.content || source.text) row.append(disclosure('查看已采集正文', el('pre', '', source.content || source.text)))
    return row
  }
  function renderSources(project) {
    workspace.append(el('h2', 'cr-section-title', '公开来源'))
    if (!project.sources?.length) workspace.append(hint(C.noSources))
    for (const source of project.sources || []) workspace.append(sourceLink(source))
    const search = disclosure(C.sourceSearch); search.dataset.companyDetails = 'search'
    const values = searchDraft(project.id), query = field(C.query, values.query, value => { values.query = value }), url = field(C.url, values.url, value => { values.url = value }, { type: 'url' })
    const searchButton = button(C.search, async () => {
      if (!values.query.trim()) return
      const result = await projectAction('search', () => api('companySearch', project.id, values.query))
      if (result && state.project?.id === project.id) { state.searchResults = result; renderWorkspace() }
    }), fetchButton = button(C.fetch, async () => {
      if (!values.url.trim()) return
      const result = await projectAction('fetch', () => api('companyFetch', project.id, values.url), { refresh: true })
      if (result && state.project?.id === project.id) toast(result.readable === false ? '来源已归档，但未获得可读正文，请核对提示。' : result.warning ? '正文已采集，但有读取限制，请核对来源提示。' : '网页正文已采集，请核对来源与适用范围。')
    })
    searchButton.disabled = busy('search'); fetchButton.disabled = busy('fetch'); search.append(query.row, searchButton, url.row, fetchButton, hint('搜索只发现线索；采集正文后才作为来源保存。官网表述仍需与独立证据区分。'))
    if (state.searchResults) {
      const results = Array.isArray(state.searchResults) ? state.searchResults : state.searchResults.results || state.searchResults.sources
      if (Array.isArray(results)) for (const result of results) search.append(sourceLink(result))
      else search.append(el('pre', 'cr-search-result', safeText(state.searchResults)))
    }
    workspace.append(search, el('h2', 'cr-section-title', '用户提供的材料'))
    if (!project.materials?.length) workspace.append(hint(C.noMaterials))
    for (const item of project.materials || []) workspace.append(el('p', 'cr-material-item', `${item.id || ''} ${item.name || '用户材料'}`))
    const imported = button(C.import, () => projectAction('import', () => api('companyImport', project.id), { refresh: true })); imported.disabled = busy('import'); workspace.append(imported)
    const form = el('form', 'cr-material-form'), draft = material(project.id)
    const name = field(C.materialName, draft.name, value => { draft.name = value }), content = field(C.materialText, draft.content, value => { draft.content = value }, { area: true })
    name.input.maxLength = 200; content.input.maxLength = 200000
    const save = el('button', 'v2-tool-button', C.addMaterial); save.type = 'submit'; save.disabled = busy('material')
    form.append(name.row, content.row, save)
    form.onsubmit = run(async event => {
      event.preventDefault(); if (!draft.name.trim() || !draft.content.trim()) { toast('请填写材料名称和正文。'); return }
      const values = { name: draft.name, content: draft.content }, result = await projectAction('material', () => api('companyAddMaterial', project.id, values), { refresh: true })
      if (result && draft.name === values.name && draft.content === values.content) { draft.name = ''; draft.content = '' }
      if (state.project?.id === project.id) renderWorkspace()
    })
    const pasted = disclosure('粘贴材料', form); pasted.dataset.companyDetails = 'paste-material'; workspace.append(pasted); renderLibrary(workspace)
  }
  function renderVersions(project) {
    workspace.append(el('h2', 'cr-section-title', C.tabs.versions), hint('版本保留当时的正文、离线 HTML、来源与检查记录。'))
    if (!project.versions?.length) workspace.append(hint(C.noVersions))
    for (const item of [...(project.versions || [])].reverse()) {
      const card = el('article', 'cr-version'); card.append(el('strong', '', `版本 ${item.version}${item.name ? ' · ' + item.name : ''}`), hint(compactDate(item.createdAt)))
      if (item.audit) card.append(auditBox(item.audit))
      card.append(actions(button('阅读此版本', async () => { state.tab = 'report'; await loadReport(item.version) }), button(C.preview, () => projectAction('preview', () => api('companyPreview', project.id, item.version))), button(C.export, () => projectAction('export', () => api('companyExport', project.id, item.version, 'bundle')))))
      workspace.append(card)
    }
  }
  function renderLibrary(parent) {
    const section = disclosure(C.library); section.dataset.companyDetails = 'library'
    section.append(hint('原始方法、报告规范与模板都保留在本模块中，作为调研参考。'))
    const load = button('查看全部资料', async () => {
      const revision = state.revision, id = state.project?.id, request = ++state.libraryRevision
      try { const files = await api('companyLibrary'); if (valid(revision, id) && request === state.libraryRevision) { state.library = files; state.libraryFile = null; state.libraryError = ''; renderWorkspace() } }
      catch (error) { if (valid(revision, id)) { state.libraryError = message(error); renderWorkspace() } }
    }); section.append(load)
    if (state.libraryError) section.append(el('p', 'cr-error', state.libraryError))
    for (const file of state.library || []) section.append(button(file.name, async () => {
      const revision = state.revision, id = state.project?.id, request = ++state.libraryRevision
      try { const result = await api('companyReadLibrary', file.name); if (valid(revision, id) && request === state.libraryRevision) { state.libraryFile = result; state.libraryError = ''; renderWorkspace() } }
      catch (error) { if (valid(revision, id)) { state.libraryError = message(error); renderWorkspace() } }
    }, 'cr-library-file'))
    if (state.libraryFile) section.append(el('h3', '', state.libraryFile.name), mark(state.libraryFile.content))
    parent.append(section)
  }
  async function refreshList() {
    const revision = state.revision, id = state.project?.id
    try { const projects = await api('companyList'); if (valid(revision, id)) { state.projects = projects; state.listError = ''; renderSidebar() } }
    catch (error) { if (valid(revision, id)) { state.listError = message(error); renderSidebar() } }
  }
  async function refreshProject(revision = state.revision, id = state.project?.id) {
    if (!id) return
    const stamp = state.chatStamp, request = ++state.snapshotRevision, next = await api('companyGet', id)
    if (!valid(revision, id) || request !== state.snapshotRevision) return
    applyProject(next, stamp); renderSidebar(); renderWorkspace()
  }
  function chooseNew() {
    ++state.revision; ++state.reportRevision; state.project = null; state.newMode = true; state.loading = false; state.error = ''; state.publishAudit = null
    renderSidebar(); renderWorkspace()
  }
  async function chooseProject(id, known) {
    const revision = ++state.revision, request = ++state.snapshotRevision
    ++state.reportRevision; state.project = { id }; state.newMode = false; state.loading = true; state.error = ''; state.tab = 'chat'; state.report = null; state.reportVersion = undefined; state.reportError = ''; state.reportLoading = false; state.publishAudit = null; state.searchResults = null
    renderSidebar(); renderWorkspace()
    try {
      const project = known || await api('companyGet', id)
      if (!valid(revision, id) || request !== state.snapshotRevision) return
      applyProject(project); state.loading = false; renderSidebar(); renderWorkspace()
    } catch (error) { if (valid(revision, id)) { state.loading = false; state.error = message(error); state.newMode = true; state.project = null; renderSidebar(); renderWorkspace() } }
  }
  function canLeave() {
    const newDirty = ['subject', 'purpose', 'website', 'region', 'competitors', 'asOf'].some(name => newDraft[name].trim())
    if (newDirty || [...drafts.values()].some(value => value.trim()) || [...materials.values()].some(value => value.name.trim() || value.content.trim())) { toast(C.unsent); return false }
    return true
  }
  const cleanups = []
  if (typeof events.onPiUpdate === 'function') cleanups.push(events.onPiUpdate(chat => {
    if (!state.visible || state.disposed || !chat?.id || chat.id !== state.project?.chatId) return
    state.project.chat = chat; ++state.chatStamp; renderWorkspace()
  }))
  if (typeof events.onCompanyUpdate === 'function') cleanups.push(events.onCompanyUpdate(project => {
    if (!state.visible || state.disposed || !project?.id) return
    if (project.id === state.project?.id) { const revision = state.revision, id = project.id; void refreshProject(revision, id).catch(error => fail(error, revision, id)) }
    else void refreshList()
  }))
  return {
    async open(selection = {}) {
      if (state.disposed) return false
      state.visible = true; root.hidden = false; ++state.revision; state.error = ''; state.listError = ''
      const id = typeof selection === 'string' ? selection : selection.id || selection.projectId
      if (id) await chooseProject(id)
      else if (!state.project) chooseNew()
      else { renderWorkspace(); await refreshProject(); if (state.tab === 'report' && !state.report) await loadReport(state.reportVersion) }
      await refreshList(); return state.visible && !state.disposed
    },
    hide() { state.visible = false; state.reportLoading = false; root.hidden = true; ++state.revision; ++state.reportRevision; ++state.libraryRevision },
    canLeave,
    destroy() { if (state.disposed) return; state.disposed = true; state.visible = false; ++state.revision; ++state.reportRevision; ++state.libraryRevision; for (const unsubscribe of cleanups) if (typeof unsubscribe === 'function') unsubscribe(); root.remove() },
  }
}
