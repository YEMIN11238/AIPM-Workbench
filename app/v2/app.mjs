/** Fresh Pi workbench shell. Domain tools mount into a single project surface. */
import { renderMarkdown } from '../assets/document-format.js'
import { defaultAppearance, defaultTheme, defaultTransparency, resolveTheme } from '../appearance.mjs'
import { mountCompanion } from './companion.mjs'
import { mountModelSelectors } from './model-selector.mjs'
import { mountResumeClinic } from './resume-clinic.mjs'

const copy = Object.freeze({
  brand: 'ORVYN', newChat: '新对话', chat: '聊天', projects: '项目', blueprint: 'Agent Blueprint', starter: 'AI 产品开发', video: '视频生成', resume: '简历检查', tools: '工具', companion: '大肥鱼后台', recent: '最近对话', settings: '设置', permissions: '电脑权限',
  welcome: '今天想完成什么？', welcomeText: '直接交代任务。我可以处理项目文件、运行代码，也能在授权后操作电脑里的应用。',
  prompt: '描述你想完成的事，也可以继续追问或补充要求…', send: '发送指令', stop: '停止执行', chooseFolder: '选择工作目录', defaultFolder: '工作台工作区',
  activity: '执行记录', artifacts: '产物', back: '返回', close: '关闭', nothingRun: '执行过程会出现在这里。', noArtifacts: '本轮生成或修改的文件会出现在这里。',
  approval: '这一步需要你确认', approve: '批准这次操作', reject: '不执行', approvedWait: '正在提交确认…',
  projectIntro: '所有产品资料与历史项目保存在原来的位置，可以继续打开和推进。', searchProject: '搜索项目名称', noProject: '还没有项目。可以从 AI 产品开发开始，或让 Pi 帮你处理已有目录。',
  toolIntro: '需要专门的流程时再打开。所有功能与主聊天共用同一套模型配置。', toolFootnote: '公司调研、GEO 内容运营与产品文档可在这里继续使用。',
  permissionIntro: '辅助功能用于读取界面、点击和输入；屏幕录制用于获取窗口截图。由你在 macOS 系统设置里授权，工作台不会替你修改权限。',
  permissionRefresh: '我已授权，重新检查', permissionPending: '未授权', permissionReady: '已授权', permissionOpen: '前往系统设置',
  enterHint: 'Enter 发送 · Shift + Enter 换行', reviewHint: '重要操作会先等你确认',
})
const projectKinds = { discovery: '产品梳理', blueprint: 'Blueprint 产品', task: '方案与检查', starter: 'AI 产品开发', geo: 'GEO 内容运营', company: '公司与客户调研', video: '视频创作', lemo: 'Lemo 动效' }
const sidebarModules = { blueprint: { kind: 'blueprint', mode: 'product' }, starter: { kind: 'starter' }, video: { kind: 'video' } }
const statusLabels = { idle: '可以继续', running: '正在执行', waiting: '等待你确认', paused: '已暂停，可继续', failed: '需要处理', cancelled: '已停止', interrupted: '上次执行已中断', completed: '已完成', needs_review: '待核对', draft: '草稿', reviewed: '已审阅' }
const toolNames = { read: '读取文件', write: '保存文件', edit: '修改文件', bash: '执行命令', grep: '搜索内容', find: '查找文件', ls: '查看目录', computer: '操作电脑', workbench: '使用工作台工具', run_with_api: '运行真实模型测试', start_preview: '启动本地预览', capture_preview: '记录预览截图', finish_video: '提交影片制作', record_decisions: '更新决策', record_rubric: '设置评分维度', report_stage: '整理阶段报告', model_samples: '生成真实样例', extract_document: '读取需求文档' }
const tools = [
  { kind: 'company', symbol: '⌕', title: '公司与客户调研', text: '了解一家公司，准备客户或投资机构拜访。查找公开资料、记录来源，边聊边完善报告，保留历史版本。', actions: [['开始公司调研', { kind: 'company' }]] },
  { kind: 'geo', symbol: '◎', title: 'GEO 内容运营', text: '整理客户事实、关键词和选题，生成主稿与四个平台版本，核对后导出。', actions: [['打开内容运营', { kind: 'geo' }]] },
  { kind: 'discovery', symbol: '▤', title: '产品梳理与文档', text: '需求池、竞品、MVP、立项与 PRD。证据、阶段文档、版本历史和已有产品全部保留。', actions: [['打开产品空间', { kind: 'discovery' }]] },
]

/**
 * Mount the new desktop shell without starting a model request.
 * @param {{container:HTMLElement,api?:Function,events?:object,moduleFactory?:Function}} options Checked IPC adapter and domain-panel factory.
 * @returns {Promise<{show:Function,openModule:Function,newChat:Function,destroy:Function}>} Navigation and cleanup controls.
 */
export async function mountWorkbench({ container, api, events = globalThis.window?.aipm || {}, moduleFactory } = {}) {
  if (!container) throw new Error('缺少工作台容器')
  const doc = container.ownerDocument, win = doc.defaultView
  const invoke = api || (async (name, ...args) => { const response = await events[name](...args); if (!response?.ok) throw new Error(response?.error || '操作未完成'); return response.value })
  let models, selectedModel
  const modelRequests = new Set(['piSend', 'companySend', 'starterSend', 'send', 'blueprintStart', 'blueprintResume', 'blueprintProductStart', 'blueprintChatSend', 'blueprintChatCreateProduct', 'geoKeywords', 'geoGenerate', 'videoSend', 'videoStudioSend', 'motionGenerate'])
  const call = async (name, ...args) => { if (modelRequests.has(name)) await models?.beforeRequest(); return invoke(name, ...args) }
  const state = { page: 'chat', chat: null, sessions: [], status: null, catalog: { projects: [], capabilities: [], manuals: [] }, boot: {}, draft: '', newCwd: null, busy: false, submittingApproval: false, drawer: false, drawerTab: 'activity', selectedModule: null, projectFilter: 'all', projectSearch: '', appearance: defaultAppearance, theme: defaultTheme, systemTheme: 'light', transparency: defaultTransparency, disposed: false, chatRevision: 0, refreshRevision: 0 }
  const drafts = new Map(), cleanups = []
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n }
  const guarded = action => async event => { try { await action(event) } catch (error) { if (!state.disposed) toast(error.message || '操作未完成') } }
  const button = (label, action, cls = 'v2-button') => { const n = el('button', cls, label); n.type = 'button'; n.onclick = guarded(action); return n }
  const root = el('div', 'v2-workbench'), sidebar = el('aside', 'v2-sidebar'), main = el('main', 'v2-main')
  root.dataset.page = 'chat'; sidebar.setAttribute('aria-label', '工作台导航')
  const brand = el('div', 'v2-brand'); brand.append(el('span', 'v2-brand-mark', 'O'), el('span', '', copy.brand)); sidebar.append(brand)
  const newButton = button('', () => newChat(), 'v2-nav-button v2-new-chat'); newButton.setAttribute('aria-label', copy.newChat); newButton.append(el('span', '', '＋ ' + copy.newChat), el('span', 'v2-shortcut', '⌘ N')); sidebar.append(newButton)
  const nav = el('nav', 'v2-nav'), navButtons = {}
  for (const [page, label, icon] of [['chat', copy.chat, '○'], ['projects', copy.projects, '▤'], ['blueprint', copy.blueprint, '◇'], ['starter', copy.starter, '↗'], ['video', copy.video, '▷'], ['resume', copy.resume, '▧'], ['tools', copy.tools, '◇'], ['companion', copy.companion, '♧']]) { const n = button('', () => show(page), 'v2-nav-button'); n.setAttribute('aria-label', label); n.append(el('span', 'v2-nav-symbol', icon), el('span', '', label)); navButtons[page] = n; nav.append(n) }
  sidebar.append(nav, el('div', 'v2-history-heading', copy.recent))
  const sessionList = el('div', 'v2-session-list'); sessionList.setAttribute('aria-label', copy.recent); sidebar.append(sessionList)
  const footer = el('div', 'v2-sidebar-footer'), permissionButton = button('', () => showPermissions()), permissionDot = el('span', 'v2-permission-dot')
  permissionButton.append(permissionDot, el('span', '', copy.permissions)); permissionButton.setAttribute('aria-label', copy.permissions)
  const settingsButton = button('', () => showSettings()); settingsButton.append(el('span', '', '⚙'), el('span', '', copy.settings)); settingsButton.setAttribute('aria-label', copy.settings); footer.append(permissionButton, settingsButton); sidebar.append(footer)
  const topbar = el('header', 'v2-topbar'), backButton = button('‹', () => show('tools'), 'v2-icon-button v2-back'), title = el('div', 'v2-page-name', copy.chat), topActions = el('div', 'v2-top-actions')
  backButton.setAttribute('aria-label', copy.back); backButton.hidden = true
  const folderOpen = button('打开目录', () => state.chat && call('piOpenFolder', state.chat.id), 'v2-icon-button'); folderOpen.hidden = true
  const detailButton = button(copy.activity, () => { state.drawer = !state.drawer; renderDrawer() }, 'v2-icon-button'); detailButton.setAttribute('aria-expanded', 'false'); detailButton.setAttribute('aria-label', copy.activity)
  topActions.append(folderOpen, detailButton); topbar.append(backButton, title, topActions)
  const mainContent = el('div', 'v2-main-content'), stage = el('div', 'v2-stage'), chatPage = el('section', 'v2-chat'), projectsPage = el('section', 'v2-list-page'), toolsPage = el('section', 'v2-list-page'), moduleHost = el('section', 'v2-module-host')
  chatPage.setAttribute('aria-label', 'Pi 对话'); projectsPage.setAttribute('aria-label', copy.projects); toolsPage.setAttribute('aria-label', copy.tools); moduleHost.setAttribute('aria-label', '项目工具')
  const messages = el('div', 'v2-messages'); messages.setAttribute('aria-live', 'polite'); messages.setAttribute('aria-relevant', 'additions text')
  const composerRegion = el('div', 'v2-composer-region'), composerWrap = el('div', 'v2-composer-wrap'), runStatus = el('div', 'v2-run-status'), composer = el('form', 'v2-composer'), input = el('textarea'), composerBottom = el('div', 'v2-composer-bottom')
  input.rows = 3; input.placeholder = copy.prompt; input.setAttribute('aria-label', copy.prompt)
  input.oninput = () => { state.draft = input.value; saveDraft(); updateComposer(); input.style.height = 'auto'; input.style.height = Math.min(190, Math.max(57, input.scrollHeight)) + 'px' }
  input.onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void guarded(send)() } }
  const folderButton = button('', chooseFolder, 'v2-folder'); folderButton.setAttribute('aria-label', copy.chooseFolder)
  const modelLabel = el('span', 'v2-model'), sendButton = button('↑', () => {}, 'v2-send'), stopButton = button('■', cancel, 'v2-stop'); sendButton.setAttribute('aria-label', copy.send); stopButton.setAttribute('aria-label', copy.stop); sendButton.type = 'submit'; sendButton.onclick = null
  composer.onsubmit = event => { event.preventDefault(); void guarded(send)() }; composerBottom.append(folderButton, modelLabel, sendButton, stopButton); composer.append(input, composerBottom)
  const composerHint = el('div', 'v2-composer-hint'); composerHint.append(el('span', '', copy.enterHint), el('span', '', copy.reviewHint)); composerWrap.append(runStatus, composer, composerHint); composerRegion.append(composerWrap); chatPage.append(messages, composerRegion)
  const companionHost = el('section', 'fish-host'); companionHost.setAttribute('aria-label', copy.companion)
  const resumeHost = el('section', 'resume-clinic-host'); resumeHost.setAttribute('aria-label', copy.resume)
  stage.append(chatPage, projectsPage, toolsPage, moduleHost, companionHost, resumeHost)
  const drawer = el('aside', 'v2-drawer'); drawer.setAttribute('aria-label', '任务详情')
  mainContent.append(stage, drawer); main.append(topbar, mainContent); root.append(sidebar, main); container.replaceChildren(root)
  const toastNode = el('div', 'v2-toast'); toastNode.setAttribute('role', 'status'); toastNode.hidden = true; container.append(toastNode)
  let toastTimer, dialog
  function toast(text) { toastNode.textContent = text; toastNode.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastNode.hidden = true }, 4500) }
  models = mountModelSelectors({ container: root, api: invoke, events, toast, onChange(status) { selectedModel = status.model; state.status = { ...state.status, model: status.model }; state.boot.model = status.model } })
  const modules = await (moduleFactory || (await import('./modules.mjs')).mountModules)({ container: moduleHost, api: call, events, toast, discuss: text => discuss(text), openChat: (id, draft) => selectChat(id, draft) })
  const companion = mountCompanion({ container: companionHost, api: call, toast })
  const resume = mountResumeClinic({ container: resumeHost, api: call })
  if (events.onCompanionOpen) cleanups.push(events.onCompanionOpen(async () => {
    await show('companion')
    if (state.disposed || state.page !== 'companion') throw new Error('当前界面不能切换到大肥鱼后台')
    await companion.openConsole()
  }))
  const isRunning = p => !!p && ['running', 'waiting'].includes(p.status)
  const activeSession = () => isRunning(state.chat) ? state.chat : state.sessions.find(isRunning)
  function saveDraft() { drafts.set(state.chat?.id || 'new', state.draft) }
  function restoreDraft() { state.draft = drafts.get(state.chat?.id || 'new') || ''; input.value = state.draft }
  function canNavigate() { if (state.page === 'module' && modules.canLeave && !modules.canLeave()) return false; if (state.page === 'companion' && !companion.canLeave()) return false; return true }
  function renderNavigation() {
    root.dataset.page = state.page
    const modulePage = state.selectedModule?.kind === 'task' ? 'blueprint' : state.selectedModule?.kind
    const sidebarPage = Object.hasOwn(sidebarModules, modulePage) ? modulePage : 'tools'
    for (const [page, n] of Object.entries(navButtons)) { const active = state.page === page || state.page === 'module' && page === sidebarPage; if (active) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current') }
    chatPage.hidden = state.page !== 'chat'; projectsPage.hidden = state.page !== 'projects'; toolsPage.hidden = state.page !== 'tools'; moduleHost.hidden = state.page !== 'module'; backButton.hidden = state.page !== 'module' || sidebarPage !== 'tools'
    companionHost.hidden = state.page !== 'companion'; if (state.page !== 'companion') companion.hide()
    resumeHost.hidden = state.page !== 'resume'; if (state.page !== 'resume') resume.hide()
    if (state.page !== 'module') modules.hide()
    title.textContent = state.page === 'chat' ? state.chat?.title || copy.newChat : state.page === 'projects' ? copy.projects : state.page === 'tools' ? copy.tools : state.page === 'companion' ? copy.companion : state.page === 'resume' ? copy.resume : moduleTitle(state.selectedModule)
    folderOpen.hidden = state.page !== 'chat' || !state.chat; detailButton.hidden = state.page !== 'chat'; drawer.hidden = state.page !== 'chat' || !state.drawer
    permissionDot.classList.toggle('ready', !!state.status?.permissions?.accessibility && !!state.status?.permissions?.screenRecording)
  }
  function moduleTitle(selection) { return selection?.kind === 'video' ? copy.video : selection?.kind === 'company' ? '公司与客户调研' : selection?.kind === 'blueprint' || selection?.kind === 'task' ? copy.blueprint : selection?.kind === 'starter' ? copy.starter : selection?.kind === 'geo' ? 'GEO 内容运营' : selection?.kind === 'discovery' ? '产品梳理与文档' : copy.tools }
  function renderHistory() {
    sessionList.replaceChildren()
    if (!state.sessions.length) { sessionList.append(el('p', 'v2-sidebar-note', '对话会自动保存在这里。')); return }
    for (const session of state.sessions) { const n = button('', () => selectChat(session.id), 'v2-session'); n.title = session.title; n.append(el('span', 'v2-session-title', session.title)); if (isRunning(session)) n.append(el('span', 'v2-session-dot')); n.setAttribute('aria-current', String(state.chat?.id === session.id)); sessionList.append(n) }
  }
  function renderMessages() {
    const atBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 140
    messages.replaceChildren()
    const p = state.chat
    if (!p?.messages?.length) {
      const welcome = el('div', 'v2-welcome'); welcome.append(el('div', 'v2-welcome-mark', '⌘'), el('h1', '', copy.welcome), el('p', '', copy.welcomeText))
      const suggestions = el('div', 'v2-starters')
      for (const [icon, label, text] of [['▤', '处理一个项目', '先查看我选定目录的文件，解释这个项目能做什么，再帮我确定下一步。'], ['◇', '开发一个 AI 产品', '我想从一个想法开始做AI产品。请先了解目标和已有材料，再使用AI产品开发流程。'], ['↗', '让电脑帮我做事', '先检查电脑操作权限和当前可用应用，告诉我可以直接交给你做哪些事情。']]) { const n = button('', () => { state.draft = text; input.value = text; saveDraft(); updateComposer(); input.focus() }, 'v2-starter'); n.append(el('span', '', icon), el('strong', '', label)); suggestions.append(n) }
      welcome.append(suggestions); messages.append(welcome)
    } else {
      for (const message of p.messages) {
        const article = el('article', 'v2-message ' + message.role); article.dataset.messageId = message.id || ''; article.append(el('div', 'v2-message-meta', message.role === 'user' ? '你' : 'Pi'))
        if (message.role === 'user') article.append(el('div', '', message.content))
        else if (message.content) { const body = el('div', 'markdown-content'); body.innerHTML = renderMarkdown(message.content); article.append(body); const actions = el('div', 'v2-message-actions'); actions.append(button('复制', () => call('copyText', message.content))); article.append(actions) }
        else { const pending = el('div', 'v2-message-empty'); pending.append(el('span', 'v2-pulse'), el('span', '', p.activity || 'Pi 正在处理…')); article.append(pending) }
        messages.append(article)
      }
      if (p.error && p.status !== 'paused') { const n = el('p', 'v2-error', p.error); n.setAttribute('role', 'alert'); messages.append(n) }
      if (p.status === 'paused') renderPause(p)
      if (p.pending) renderApproval(p)
    }
    if (atBottom) messages.scrollTop = messages.scrollHeight
  }
  function renderPause(p) {
    const pause = p.pause || {}, card = el('section', 'v2-pause'); card.setAttribute('role', 'status')
    card.append(el('h3', '', '执行已暂停，进度已保存'), el('p', '', pause.reason || '本轮到达连续执行上限，可以从未完成处接着做。'), el('p', 'v2-pause-note', '这是工作台的执行限制，不是 API 余额提示。'))
    const usage = pause.usage || p.runs?.at(-1)?.usage || {}, limits = pause.limits || {}, detail = el('details', 'v2-pause-usage')
    detail.append(el('summary', '', '查看本轮用量与上限'))
    if (Number.isFinite(usage.calls)) detail.append(el('p', '', `模型请求：${usage.calls} 次${Number.isFinite(limits.maxCalls) ? ` / 上限 ${limits.maxCalls} 次` : ''}`))
    if (Number.isFinite(usage.output_tokens)) detail.append(el('p', '', `模型输出：${usage.output_tokens} tokens${Number.isFinite(limits.maxOutputTokens) ? ` / 上限 ${limits.maxOutputTokens} tokens` : ''}`))
    if (Number.isFinite(usage.input_tokens)) detail.append(el('p', '', `累计输入：${usage.input_tokens} tokens（含重复发送的历史，用于用量统计）`))
    card.append(detail)
    const actions = el('div', 'v2-button-row'), resume = button('继续执行', () => resumePaused(p.id), 'v2-button primary'); resume.disabled = state.busy || !!activeSession(); actions.append(resume); card.append(actions); messages.append(card)
  }
  function renderApproval(p) {
    const card = el('section', 'v2-approval'); card.setAttribute('role', 'alert'); card.append(el('h3', '', copy.approval), el('p', '', p.pending.reason || '请核对本次操作的对象和范围。'), el('pre', '', p.pending.command || '等待你确认当前操作'))
    const actions = el('div', 'v2-button-row')
    for (const [label, value] of [[copy.approve, true], [copy.reject, false]]) { const n = button(state.submittingApproval ? copy.approvedWait : label, () => reply(value), 'v2-button' + (value ? ' primary' : '')); n.disabled = state.submittingApproval; actions.append(n) }
    card.append(actions); messages.append(card)
  }
  function updateComposer() {
    const active = activeSession(), running = !!active
    sendButton.disabled = state.busy || running || !state.draft.trim(); sendButton.hidden = running; stopButton.hidden = !running; stopButton.disabled = state.busy
    input.disabled = state.busy && !state.chat; folderButton.disabled = state.busy || isRunning(state.chat)
    const path = state.chat?.cwd || state.newCwd; folderButton.replaceChildren(el('span', '', '▱'), el('span', '', path ? path.split('/').filter(Boolean).at(-1) : copy.defaultFolder)); folderButton.title = path || copy.chooseFolder
    runStatus.replaceChildren()
    if (running) { const status = el('span', 'v2-running-label'); status.append(el('span', 'v2-pulse'), el('span', '', active.id === state.chat?.id ? state.chat.activity || (state.chat.status === 'waiting' ? '等待你确认操作' : 'Pi 正在执行任务') : '另一个对话正在执行')); runStatus.append(status); if (active.id !== state.chat?.id) runStatus.append(button('查看当前任务', () => selectChat(active.id))) }
    else if (state.chat?.status === 'paused') runStatus.append(el('span', '', '执行已暂停，进度已保存。可继续执行，也可补充要求。'))
    else if (state.chat?.status === 'failed') runStatus.append(el('span', '', '本轮遇到问题，已保留对话与文件，可以继续说明。'))
    else if (state.chat?.status === 'cancelled' || state.chat?.status === 'interrupted') runStatus.append(el('span', '', '进度已保存，可以继续。'))
  }
  function renderDrawer() {
    const wasHidden = drawer.hidden
    drawer.hidden = state.page !== 'chat' || !state.drawer; detailButton.setAttribute('aria-expanded', String(state.drawer)); detailButton.textContent = copy.activity + (state.chat?.runs?.at(-1)?.tools?.length ? ' · ' + state.chat.runs.at(-1).tools.length : '')
    if (drawer.hidden) return
    const old = drawer.querySelector('.v2-drawer-content'), scroll = old?.scrollTop || 0
    drawer.replaceChildren()
    const header = el('div', 'v2-drawer-header'); header.append(el('strong', '', '任务详情'), button('×', () => { state.drawer = false; renderDrawer() }, 'v2-icon-button')); header.lastChild.setAttribute('aria-label', '关闭任务详情')
    const tabs = el('div', 'v2-drawer-tabs'); tabs.setAttribute('role', 'tablist')
    for (const [tab, label] of [['activity', copy.activity], ['artifacts', copy.artifacts]]) { const n = button(label, () => { state.drawerTab = tab; renderDrawer() }); n.setAttribute('role', 'tab'); n.setAttribute('aria-selected', String(state.drawerTab === tab)); tabs.append(n) }
    const body = el('div', 'v2-drawer-content'), p = state.chat
    if (state.drawerTab === 'activity') {
      if (!p?.runs?.length) body.append(el('p', 'v2-empty', copy.nothingRun))
      for (const [index, run] of [...(p?.runs || [])].reverse().entries()) {
        const group = el('details', 'v2-run-group'); group.open = index === 0
        const timestamp = run.startedAt ? new Date(run.startedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
        group.append(el('summary', '', (timestamp ? timestamp + ' · ' : '') + (statusLabels[run.status] || (isRunning(p) && index === 0 ? '执行中' : '本轮记录'))))
        for (const step of run.tools || []) { const item = el('details', 'v2-tool-step'), summary = el('summary'), presentation = ({ done: ['✓', '已完成'], completed: ['✓', '已完成'], running: ['○', '进行中'], failed: ['!', '未完成'], paused: ['Ⅱ', '已暂停'], cancelled: ['–', '已停止'] })[step.status] || ['○', '未完成']; summary.append(el('span', '', presentation[0]), el('strong', '', toolNames[step.name] || step.name), el('small', '', presentation[1])); item.append(summary); if (step.args) item.append(el('pre', '', safeJson(step.args))); if (step.result) item.append(el('pre', '', safeJson(step.result))); group.append(item) }
        if (run.usage?.calls) group.append(el('p', 'v2-path', `${run.usage.calls} 次模型调用 · ${Number(run.usage.input_tokens || 0) + Number(run.usage.output_tokens || 0)} tokens`))
        body.append(group)
      }
    } else {
      if (!p?.artifacts?.length) body.append(el('p', 'v2-empty', copy.noArtifacts))
      for (const file of p?.artifacts || []) { const n = button('', () => call('piArtifact', p.id, file.path), 'v2-artifact'); n.append(el('strong', '', (file.kind === 'image' ? '▧ ' : '▤ ') + file.name), el('small', '', file.path)); body.append(n) }
    }
    drawer.append(header, tabs, body); if (!wasHidden) body.scrollTop = scroll
  }
  function safeJson(value) { const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2); return text.length > 24000 ? text.slice(0, 24000) + '\n…详情较长，请打开项目文件查看。' : text }
  function renderProjects() {
    projectsPage.replaceChildren(el('h1', '', copy.projects), el('p', 'v2-page-intro', copy.projectIntro))
    const toolbar = el('div', 'v2-project-toolbar'), search = el('input'); search.type = 'search'; search.placeholder = copy.searchProject; search.setAttribute('aria-label', copy.searchProject); search.value = state.projectSearch; search.oninput = () => { state.projectSearch = search.value; renderProjectRows(rows) }; toolbar.append(search, button('新建产品项目', () => openModule({ kind: 'starter' }), 'v2-button'))
    const filters = el('div', 'v2-project-filters'); filters.setAttribute('aria-label', '项目类型')
    const rows = el('div', 'v2-project-list')
    for (const [kind, label] of [['all', '全部'], ['discovery', '产品梳理'], ['starter', 'AI 产品开发'], ['blueprint', 'Blueprint'], ['task', '方案与检查'], ['geo', 'GEO'], ['company', '公司调研'], ['video', '视频创作']]) { const n = button(label, () => { state.projectFilter = kind; for (const option of filters.children) option.setAttribute('aria-pressed', String(option.dataset.kind === kind)); renderProjectRows(rows) }, 'v2-filter'); n.dataset.kind = kind; n.setAttribute('aria-pressed', String(state.projectFilter === kind)); filters.append(n) }
    projectsPage.append(toolbar, filters, rows); renderProjectRows(rows)
  }
  function renderProjectRows(rows) {
    rows.replaceChildren(); const query = state.projectSearch.trim().toLowerCase(), projects = (state.catalog.projects || []).filter(p => (state.projectFilter === 'all' || p.kind === state.projectFilter || state.projectFilter === 'video' && p.kind === 'lemo') && (!query || (p.name + ' ' + (projectKinds[p.kind] || '')).toLowerCase().includes(query)))
    if (!projects.length) { rows.append(el('p', 'v2-empty', query ? '没有找到匹配的项目。' : copy.noProject)); return }
    for (const p of projects) { const n = button('', () => openModule(p.kind === 'lemo' ? { kind: 'video', mode: 'lemo', id: p.id } : { kind: p.kind, id: p.id, mode: p.kind === 'task' ? undefined : p.kind === 'blueprint' ? 'product' : undefined }), 'v2-project-row'); n.setAttribute('aria-label', p.name); const text = el('span', 'v2-project-body'); text.append(el('strong', '', p.name), el('small', '', projectKinds[p.kind] || p.kind)); n.append(el('span', 'v2-project-icon', p.kind === 'geo' ? '◎' : p.kind === 'starter' ? '↗' : '▤'), text, el('span', 'v2-project-state', statusLabels[p.status] || p.status || ''), el('span', 'v2-chevron', '›')); rows.append(n) }
  }
  function renderTools() {
    toolsPage.replaceChildren(el('h1', '', copy.tools), el('p', 'v2-page-intro', copy.toolIntro))
    const grid = el('div', 'v2-tool-grid')
    for (const tool of tools) { const card = el('article', 'v2-tool'); card.append(el('h2', '', tool.symbol + '  ' + tool.title), el('p', '', tool.text)); const actions = el('div', 'v2-tool-actions'); for (const [label, selection] of tool.actions) actions.append(button(label, () => openModule(selection))); card.append(actions); grid.append(card) }
    const computer = el('article', 'v2-tool'); computer.append(el('h2', '', '⌘  电脑与本地工具'), el('p', '', '直接在聊天里描述任务。Pi 负责文件、终端与应用操作；需要的 macOS 权限可以在这里检查。')); const actions = el('div', 'v2-tool-actions'); actions.append(button('回到聊天', () => show('chat')), button('检查电脑权限', () => showPermissions())); computer.append(actions); grid.append(computer)
    toolsPage.append(grid, el('p', 'v2-tool-footnote', copy.toolFootnote))
  }
  async function refreshSessions() { const sessions = await call('piList'); if (state.disposed) return; state.sessions = sessions || []; renderHistory(); updateComposer() }
  async function refreshCatalog() { const revision = ++state.refreshRevision; const catalog = await call('piCatalog'); if (state.disposed || revision !== state.refreshRevision) return; state.catalog = catalog || { projects: [] }; if (state.page === 'projects') renderProjects() }
  async function show(page = 'chat') {
    if (Object.hasOwn(sidebarModules, page)) return openModule({ ...sidebarModules[page] })
    if (!canNavigate()) return
    saveDraft(); ++state.chatRevision; state.page = page; renderNavigation()
    if (page === 'projects') { renderProjects(); await refreshCatalog() }
    else if (page === 'tools') renderTools()
    else if (page === 'companion') await companion.show()
    else if (page === 'resume') await resume.show()
    else { renderMessages(); updateComposer(); renderDrawer() }
  }
  async function newChat() {
    if (!canNavigate()) return
    saveDraft(); ++state.chatRevision; state.chat = null; state.newCwd = null; state.page = 'chat'; restoreDraft(); renderNavigation(); renderHistory(); renderMessages(); updateComposer(); renderDrawer(); input.focus()
  }
  async function selectChat(id, initialDraft) {
    if (!canNavigate()) return false
    saveDraft(); const revision = ++state.chatRevision, chat = await call('piGet', id); if (state.disposed || revision !== state.chatRevision) return false
    state.chat = chat; state.newCwd = null; state.page = 'chat'; restoreDraft()
    if (typeof initialDraft === 'string' && initialDraft.trim()) {
      if (!state.draft.trim()) { state.draft = initialDraft; input.value = initialDraft; saveDraft() }
      else if (state.draft !== initialDraft) toast('这个对话已有未发送草稿，已保留原文，动效指令未覆盖。')
    }
    const summary = { id: chat.id, title: chat.title, cwd: chat.cwd, status: chat.status, updatedAt: chat.updatedAt }; if (!state.sessions.some(item => item.id === chat.id)) state.sessions.unshift(summary)
    renderNavigation(); renderHistory(); renderMessages(); updateComposer(); renderDrawer(); if (typeof initialDraft === 'string') input.focus(); return true
  }
  async function openModule(selection) {
    if (selection?.kind === 'resume') return show('resume')
    if (!canNavigate()) return
    saveDraft(); ++state.chatRevision; state.selectedModule = selection; state.page = 'module'; renderNavigation(); await modules.open(selection)
  }
  async function chooseFolder() {
    const cwd = await call('piPickFolder'); if (!cwd) return
    const currentDraft = state.draft; saveDraft(); ++state.chatRevision; state.chat = null; state.newCwd = cwd; state.page = 'chat'; state.draft = currentDraft; input.value = currentDraft; saveDraft(); renderNavigation(); renderHistory(); renderMessages(); updateComposer(); renderDrawer(); input.focus(); toast('已选择工作目录，发送指令后会创建新的对话。')
  }
  async function send() {
    if (!state.draft.trim() || state.busy || activeSession()) return
    const submittedDraft = state.draft, text = submittedDraft.trim(), revision = state.chatRevision, cwd = state.newCwd
    let target = state.chat
    state.busy = true; updateComposer()
    try {
      if (!target) {
        target = await call('piCreate', { ...(cwd ? { cwd } : {}) })
        drafts.set(target.id, submittedDraft)
        if (state.chatRevision === revision) { state.chat = target; drafts.delete('new'); renderHistory() }
      }
      const id = target.id, priorMessage = target.messages?.at(-1)?.id
      const response = await call('piSend', id, text)
      if (state.chat?.id === id && state.chatRevision === revision) {
        const currentLast = state.chat.messages?.at(-1)?.id, responseLast = response.messages?.at(-1)?.id
        if (!currentLast || currentLast === priorMessage || currentLast !== responseLast) state.chat = response
        if (state.draft === submittedDraft) { state.draft = ''; input.value = ''; input.style.height = ''; drafts.set(id, '') }
      } else if (drafts.get(id) === submittedDraft) drafts.set(id, '')
      await refreshSessions()
    } catch (error) {
      try { await refreshSessions() } catch (refreshError) { /* The original send failure remains the useful error. */ }
      throw error
    } finally { state.busy = false; renderNavigation(); renderMessages(); updateComposer(); renderDrawer() }
  }
  async function cancel() { const active = activeSession(); if (!active) return; const response = await call('piCancel', active.id); if (state.chat?.id === response.id) state.chat = response; await refreshSessions(); renderMessages(); updateComposer(); renderDrawer() }
  async function resumePaused(id) {
    if (state.chat?.id !== id || state.chat.status !== 'paused' || state.busy || activeSession()) return
    if (state.draft.trim()) { toast('输入框里有未发送的内容，已保留。请先发送这段内容，或清空后继续执行。'); input.focus(); return }
    state.draft = '继续完成刚才的任务。先核对已保存文件与执行记录，从未完成处接着做，不重复已完成操作。'; input.value = state.draft; saveDraft(); await send()
  }
  async function reply(approved) {
    const p = state.chat; if (!p?.pending || state.submittingApproval) return
    const token = p.pending.token; state.submittingApproval = true; renderMessages()
    try { const response = await call('piReply', p.id, token, approved); if (state.chat?.id === p.id && !(!isRunning(state.chat) && isRunning(response))) state.chat = response }
    finally { state.submittingApproval = false; renderMessages(); updateComposer() }
  }
  async function discuss(text) { if (!canNavigate()) return; await show('chat'); state.draft = String(text || ''); input.value = state.draft; saveDraft(); updateComposer(); input.focus() }
  function mergeChat(chat) {
    const summary = { id: chat.id, title: chat.title, cwd: chat.cwd, status: chat.status, updatedAt: chat.updatedAt || new Date().toISOString() }, existing = state.sessions.findIndex(p => p.id === chat.id)
    if (existing >= 0) state.sessions.splice(existing, 1); state.sessions.unshift(summary)
    if (state.chat?.id === chat.id) { const wasRunning = isRunning(state.chat); state.chat = chat; if (chat.pending && state.page !== 'chat') toast('Pi 正在等待你确认，请在当前对话中查看。'); renderMessages(); updateComposer(); renderDrawer(); if (wasRunning && !isRunning(chat)) void refreshCatalog().catch(error => toast(error.message)) }
    renderHistory(); updateComposer(); if (state.page === 'chat') renderNavigation()
  }
  function applyPreferences() {
    const tone = resolveTheme(state.theme, state.systemTheme), html = doc.documentElement; html.dataset.theme = tone; html.dataset.appearance = state.appearance; html.dataset.systemTheme = state.systemTheme; html.dataset.solidTheme = tone; html.dataset.glassTone = tone; html.style.setProperty('--surface-opacity', (100 - state.transparency) * .45 + '%')
  }
  function closeDialog(restore = true) { const open = Boolean(dialog); if (dialog?.open && typeof dialog.close === 'function') dialog.close(); dialog?.remove(); dialog = null; if (open && restore && state.page === 'resume' && !state.disposed) void resume.show() }
  function createDialog(name) {
    closeDialog(false); if (state.page === 'resume') resume.hide(); const d = el('dialog', 'v2-dialog'); d.setAttribute('aria-label', name); const heading = el('div', 'v2-dialog-heading'); heading.append(el('h2', '', name), button('×', closeDialog, 'v2-icon-button')); heading.lastChild.setAttribute('aria-label', copy.close); d.append(heading); container.append(d); dialog = d; d.addEventListener('cancel', event => { event.preventDefault(); if (dialog === d) closeDialog() }); if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', ''); return d
  }
  async function showPermissions() {
    const d = createDialog(copy.permissions); d.append(el('p', '', copy.permissionIntro)); const content = el('div'), footer = el('div', 'v2-dialog-footer'); d.append(content, footer)
    async function refresh() { const permissions = await call('piPermissions'); if (dialog !== d) return; state.status = { ...state.status, permissions }; renderPermissionCards(permissions); renderNavigation() }
    function renderPermissionCards(permissions) {
      content.replaceChildren()
      for (const [kind, key, label, description] of [['accessibility', 'accessibility', '辅助功能', '让 Pi 读取应用中的按钮和文字，并执行点击、输入、按键。'], ['screen', 'screenRecording', '屏幕录制', '让 Pi 获取指定应用的窗口截图。授权后，截图仍只在当前任务需要时获取。']]) { const card = el('section', 'v2-permission-card'), heading = el('h3'), ready = !!permissions?.[key]; heading.append(el('span', '', label), el('span', 'v2-permission-state' + (ready ? ' ready' : ''), ready ? copy.permissionReady : copy.permissionPending)); card.append(heading, el('p', '', description)); if (!ready) card.append(button(copy.permissionOpen, async () => { await call('piRequestPermission', kind); if (dialog === d) await refresh() })); content.append(card) }
      content.append(el('p', '', '在系统设置里找到「ORVYN」并开启对应权限。某些 macOS 版本需要重新打开工作台后生效；未授权时仍可使用文件、终端和产品工具。'))
    }
    footer.append(button(copy.permissionRefresh, refresh), button(copy.close, closeDialog, 'v2-button primary')); renderPermissionCards(state.status?.permissions); await refresh()
  }
  async function showSettings() {
    const d = createDialog(copy.settings), status = el('p', 'v2-dialog-status'); status.setAttribute('role', 'status')
    const material = el('div', 'v2-setting-group'), colors = el('div', 'v2-setting-group')
    async function choose(name, value) { for (const n of [...material.children, ...colors.children]) n.disabled = true; try { await call(name, value); state[name] = value; applyPreferences(); renderOptions(); status.textContent = '已保存，下次打开沿用。' } finally { for (const n of [...material.children, ...colors.children]) n.disabled = false } }
    function renderOptions() {
      material.replaceChildren(); colors.replaceChildren()
      for (const [value, label] of [['system', '实色'], ['frosted', '毛玻璃'], ['liquid', '液态玻璃']]) { const n = button(label, () => choose('appearance', value), 'v2-setting-option'); n.setAttribute('aria-pressed', String(state.appearance === value)); material.append(n) }
      for (const [value, label] of [['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']]) { const n = button(label, () => choose('theme', value), 'v2-setting-option'); n.setAttribute('aria-pressed', String(state.theme === value)); colors.append(n) }
      rangeLabel.hidden = range.hidden = state.appearance === 'system'
    }
    const rangeLabel = el('div', 'v2-range-heading'), output = el('output', '', state.transparency + '%'), range = el('input'); range.type = 'range'; range.min = '0'; range.max = '100'; range.step = '1'; range.value = String(state.transparency); range.setAttribute('aria-label', '玻璃透明度'); rangeLabel.append(el('span', '', '玻璃透明度'), output)
    let transparencyQueue = Promise.resolve()
    range.oninput = () => { const value = Number(range.value); output.textContent = value + '%'; state.transparency = value; applyPreferences(); transparencyQueue = transparencyQueue.then(() => call('transparency', value)).catch(error => { status.textContent = error.message }) }
    d.append(el('h3', '', '界面材质'), material, el('h3', '', '界面颜色'), colors, rangeLabel, range, status, el('hr', 'v2-setting-divider'), el('h3', '', '统一模型连接'))
    d.append(el('p', '', `${state.status?.engine || 'Pi Agent'} · ${state.status?.model || state.boot.model || '尚未连接模型'}`), el('p', '', '聊天、简历检查、视频创作、公司调研、产品梳理、Blueprint、GEO 与 AI 产品开发共用这一配置。'))
    if(state.status?.execution){const deadline=state.status.execution.deadlineMs;d.append(el('p','','任务总时长：'+(deadline==null?'不限制，可随时点击“停止执行”。':Math.ceil(deadline/60000)+' 分钟。')))}
    const label = el('label', 'v2-field', 'API Key'), key = el('input'); key.type = 'password'; key.autocomplete = 'off'; key.placeholder = state.boot.hasKey || state.status?.configured ? '已配置，留空保留现有密钥' : '输入 API Key'; label.append(key); d.append(label, el('p', '', '密钥通过 macOS 系统加密保存，不在界面回显。'))
    const footer = el('div', 'v2-dialog-footer'), save = button('完成', async () => { save.disabled = true; try { await transparencyQueue; if (key.value.trim()) { await call('key', key.value.trim()); state.boot.hasKey = true; const fresh = await call('piStatus'); state.status = fresh; key.value = ''; updateComposer() }; closeDialog() } finally { save.disabled = false } }, 'v2-button primary'); footer.append(button(copy.close, closeDialog), save); d.append(footer); renderOptions()
  }
  messages.onclick = event => { const link = event.target.closest?.('a'); if (link) { event.preventDefault(); void call('openLink', link.href).catch(error => toast(error.message)) } }
  const keyHandler = event => { if (dialog?.open) return; if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); void guarded(newChat)() } else if (event.key === 'Escape' && state.drawer) { state.drawer = false; renderDrawer() } }
  win.addEventListener('keydown', keyHandler); cleanups.push(() => win.removeEventListener('keydown', keyHandler))
  if (events.onPiUpdate) cleanups.push(events.onPiUpdate(chat => { if (!state.disposed) mergeChat(chat) }))
  if (events.onSystemTheme) cleanups.push(events.onSystemTheme(theme => { state.systemTheme = theme; applyPreferences() }))
  renderNavigation(); renderHistory(); renderMessages(); updateComposer(); renderDrawer(); applyPreferences()
  const initial = await Promise.allSettled([call('boot'), call('piStatus'), call('piList'), call('piCatalog'), models.ready])
  if (state.disposed) return controls()
  initial.forEach((r, index) => { if (r.status !== 'fulfilled') { toast(r.reason?.message || '部分工作台信息加载失败'); return }; if (index === 0) { state.boot = r.value || {}; state.appearance = state.boot.appearance || defaultAppearance; state.theme = state.boot.theme || defaultTheme; state.systemTheme = state.boot.systemTheme || 'light'; state.transparency = state.boot.transparency ?? defaultTransparency }; if (index === 1) state.status = r.value; if (index === 2) state.sessions = r.value || []; if (index === 3) state.catalog = r.value || { projects: [] } })
  if (selectedModel) { state.status = { ...state.status, model: selectedModel }; state.boot.model = selectedModel }
  applyPreferences(); renderNavigation(); renderHistory(); updateComposer()
  if (events.companionControlReady) await call('companionControlReady')
  function controls() { return { show, openModule, newChat, openChat: selectChat, destroy() { state.disposed = true; ++state.chatRevision; ++state.refreshRevision; clearTimeout(toastTimer); for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup(); models.destroy(); modules.destroy(); companion.destroy(); resume.destroy(); closeDialog(); root.remove(); toastNode.remove() } } }
  return controls()
}

if (typeof window !== 'undefined' && window.aipm && document.getElementById('app')) {
  mountWorkbench({ container: document.getElementById('app') }).catch(error => { const text = document.createElement('p'); text.className = 'v2-error'; text.textContent = '工作台启动失败：' + error.message; document.getElementById('app').append(text) })
}
