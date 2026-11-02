/** Blueprint task workspace; all privileged work goes through the injected desktop API. */
import { renderMarkdown } from './assets/document-format.js'
import { blueprintCopy as c } from './blueprint-copy.mjs'
import { productCopy } from './blueprint-product-copy.mjs'
import { mountBlueprintProduct } from './blueprint-product-view.mjs'
import { renderDiagrams } from './assets/blueprint-diagrams.js'
import { mountBlueprintChat } from './blueprint-chat-view.mjs'
import { mountStarter } from './starter-view.mjs'
import { chatCopy } from './blueprint-chat-copy.mjs'

/**
 * Mount the Blueprint workspace without starting a model task.
 * @param {{container: HTMLElement, api: Function, onUpdate?: Function, toast?: Function}} options Desktop API, task subscription, and toast presenter.
 * show(mode?, initialInput?) accepts a plan draft without submitting it.
 * @returns {{show: Function, hide: Function, refresh: Function, destroy: Function}} Navigation and lifecycle controls. Form drafts survive hide/show and mode changes.
 */
export function mountBlueprint({ container, api, onUpdate = () => () => {}, onProductUpdate = () => () => {}, onChatUpdate = () => () => {}, onStarterUpdate = () => () => {}, toast = () => {} }) {
  const doc = container.ownerDocument
  const state = { mode: 'plan', drafts: { plan: { title: '', input: '' }, audit: { title: '', projectPath: '', prdText: '', prdPath: '' } }, status: null, tasks: [], selected: null, reportName: '', reportContent: null, busy: false, cancelBusy: false, disposed: false, selectionRevision: 0, reportRevision: 0, refreshRevision: 0 }
  const el = (tag, cls, text) => { const node = doc.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node }
  const button = (text, action, cls = 'bp-button') => { const node = el('button', cls, text); node.type = 'button'; node.onclick = action; return node }
  const run = action => async () => { try { await action() } catch (error) { if (!state.disposed) toast(error.message || c.failure) } }
  const root = el('section', 'blueprint-workspace'); root.setAttribute('aria-label', c.eyebrow)
  const hero = el('header', 'bp-hero'); const intro = el('div'); intro.append(el('span', 'bp-eyebrow', c.eyebrow), el('h1', '', c.title), el('p', '', c.subtitle)); hero.append(intro)
  const health = el('div', 'bp-health'); health.setAttribute('role', 'status'); hero.append(health)
  const layout = el('div', 'bp-layout'), left = el('div', 'bp-left'), formCard = el('section', 'bp-card bp-compose'), tabs = el('div', 'bp-mode-tabs'), formBody = el('form', 'bp-form'), history = el('section', 'bp-card bp-history'), right = el('section', 'bp-card bp-result')
  tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', c.eyebrow)
  for (const mode of ['plan', 'audit']) { const tab = button(c[mode], () => switchMode(mode), 'bp-mode'); tab.dataset.mode = mode; tab.setAttribute('role', 'tab'); tabs.append(tab) }
  formCard.append(tabs, formBody); left.append(formCard, history); layout.append(left, right); root.append(hero, layout); container.replaceChildren(root)
  const fullContainer = el('div', 'bpf-container'); fullContainer.style.cssText = 'display:flex;flex:1;min-height:0;flex-direction:column'; root.append(fullContainer)
  const full = mountBlueprintProduct({ container: fullContainer, api, onUpdate: onProductUpdate, toast }); full.hide(); fullContainer.hidden = true
  const chatContainer = el('div', 'bpc-container'); chatContainer.style.cssText = 'display:flex;flex:1;min-height:0;flex-direction:column'; root.append(chatContainer); chatContainer.hidden = true
  const chat = mountBlueprintChat({ container: chatContainer, api, onUpdate: onChatUpdate, onProductUpdate, toast, openFiles: id => show('product', { id }) }); chat.hide()
  const starterContainer = el('div', 'stk-container'); root.append(starterContainer); starterContainer.hidden = true
  const starter = mountStarter({ container: starterContainer, api, onUpdate: onStarterUpdate, toast }); starter.hide()
  const topNav = el('nav', 'bp-top-nav'); topNav.setAttribute('aria-label', 'Agent Blueprint')
  const topButtons = {}
  for (const mode of ['chat', 'starter', 'product', 'tools', 'library']) { const tab = button(mode === 'chat' ? chatCopy.tab : mode === 'starter' ? '开发与上线' : productCopy[mode], run(() => show(mode))); topButtons[mode] = tab; topNav.append(tab) }
  root.prepend(topNav)
  async function show(mode = 'chat', initialInput) {
    if (state.disposed || !full.canLeave()) return
    root.hidden = false; container.hidden = false
    const tools = ['plan', 'audit', 'tools'].includes(mode)
    for (const [key, node] of Object.entries(topButtons)) node.classList.toggle('active', key === (tools ? 'tools' : mode))
    hero.hidden = !tools; layout.hidden = !tools; fullContainer.hidden = tools || mode === 'chat' || mode === 'starter'; chatContainer.hidden = mode !== 'chat'
    starterContainer.hidden = mode !== 'starter'; if (mode !== 'starter') starter.hide()
    if (mode === 'starter') { full.hide(); chat.hide(); await starter.show(); return }
    if (mode === 'chat') { full.hide(); await chat.show(typeof initialInput === 'object' ? initialInput : undefined, typeof initialInput === 'string' ? initialInput : undefined); return }
    chat.hide()
    if (tools) {
      full.hide()
      if (typeof initialInput === 'string') state.drafts.plan.input = initialInput
      if (mode === 'plan' || mode === 'audit') switchMode(mode)
      await refresh()
    } else await full.show(mode, initialInput?.id)
  }
  let startButton
  const hasRunning = () => state.tasks.some(task => task.status === 'running') || state.selected?.status === 'running' || !!state.status?.activeId
  const ready = () => !!state.status?.available && !!state.status?.configured
  const valid = () => state.mode === 'plan' ? !!state.drafts.plan.input.trim() : !!state.drafts.audit.projectPath.trim()
  const updateSubmit = () => { if (startButton) startButton.disabled = !ready() || !valid() || state.busy || hasRunning() }
  function renderHealth() {
    health.classList.toggle('bp-health-ready', ready())
    health.title = state.status?.reason || ''
    health.textContent = !state.status ? c.loading : !state.status.available ? c.unavailable : !state.status.configured ? c.noConfig : `${c.configured}${state.status.model ? ` · ${state.status.model}` : ''}`
    if (state.status?.reason) health.setAttribute('aria-label', `${health.textContent} ${state.status.reason}`)
    else health.removeAttribute('aria-label')
    updateSubmit()
  }
  function switchMode(mode) { if (state.mode === mode) return; state.mode = mode; renderForm() }
  function renderForm() {
    const activeInput = formBody.contains(doc.activeElement) && doc.activeElement.name ? { name: doc.activeElement.name, start: doc.activeElement.selectionStart, end: doc.activeElement.selectionEnd } : null
    for (const tab of tabs.children) { const active = tab.dataset.mode === state.mode; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)) }
    formBody.replaceChildren(el('p', 'bp-form-hint', state.mode === 'plan' ? c.planHint : c.auditHint))
    const draft = state.drafts[state.mode], mode = state.mode
    const title = el('input', 'bp-input'); title.name = 'title'; title.placeholder = c.titlePlaceholder; title.value = draft.title; title.maxLength = 150; title.oninput = () => { draft.title = title.value }
    const titleLabel = el('label', 'bp-label', c.titleLabel); titleLabel.append(title); formBody.append(titleLabel)
    if (mode === 'plan') {
      const input = el('textarea', 'bp-input bp-idea'); input.name = 'idea'; input.placeholder = c.ideaPlaceholder; input.rows = 8; input.value = draft.input; input.oninput = () => { draft.input = input.value; updateSubmit() }
      const label = el('label', 'bp-label', c.ideaLabel); label.append(input); formBody.append(label)
      formBody.append(button(c.importIdea, run(async () => { const file = await api('blueprintPick', 'idea'); if (state.disposed || !file) return; draft.input = file.text || ''; if (state.mode === mode) renderForm() }), 'bp-button bp-subtle'))
    } else {
      const path = el('input', 'bp-input'); path.name = 'projectPath'; path.readOnly = true; path.placeholder = c.projectPlaceholder; path.value = draft.projectPath
      const label = el('label', 'bp-label', c.projectLabel); label.append(path); formBody.append(label)
      formBody.append(button(c.pickProject, run(async () => { const file = await api('blueprintPick', 'project'); if (state.disposed || !file) return; draft.projectPath = file.path; if (state.mode === mode) renderForm() })))
      const prd = el('div', 'bp-prd'); prd.append(button(draft.prdPath ? c.replacePrd : c.importPrd, run(async () => { const file = await api('blueprintPick', 'prd'); if (state.disposed || !file) return; draft.prdPath = file.path; draft.prdText = file.text || ''; if (state.mode === mode) renderForm() }), 'bp-button bp-subtle'))
      if (draft.prdPath) { prd.append(el('span', 'bp-path', draft.prdPath), button(c.clearPrd, () => { draft.prdPath = ''; draft.prdText = ''; renderForm() }, 'bp-button bp-subtle')) }
      formBody.append(prd)
    }
    formBody.append(el('p', 'bp-caption', c.importHint))
    if (hasRunning()) formBody.append(el('p', 'bp-caption', c.activeHint))
    startButton = button(state.busy ? c.starting : mode === 'plan' ? c.startPlan : c.startAudit, () => {}, 'bp-button bp-primary'); startButton.type = 'submit'; startButton.dataset.action = 'start'; formBody.append(startButton); updateSubmit()
    if (activeInput) { const replacement = formBody.elements.namedItem(activeInput.name); if (replacement) { replacement.focus({ preventScroll: true }); if (typeof activeInput.start === 'number' && typeof replacement.setSelectionRange === 'function') replacement.setSelectionRange(activeInput.start, activeInput.end) } }
  }
  formBody.onsubmit = async event => {
    event.preventDefault()
    if (!ready() || !valid() || state.busy || hasRunning()) return
    state.busy = true; renderForm()
    const mode = state.mode, draft = { ...state.drafts[mode] }
    try {
      const task = await api('blueprintStart', { mode, title: draft.title.trim(), input: draft.input || '', projectPath: draft.projectPath || '', ...(draft.prdText ? { prdText: draft.prdText } : {}) })
      if (state.disposed) return
      mergeTask(task); state.selected = state.tasks.find(item => item.id === task.id) || task; ++state.selectionRevision; state.reportName = ''; state.reportContent = null; renderTask(); renderHistory()
    } catch (error) { if (!state.disposed) toast(error.message || c.failure) }
    finally { state.busy = false; if (!state.disposed) renderForm() }
  }
  function mergeTask(task) {
    const previous = state.tasks.find(item => item.id === task.id)
    if (previous && previous.updatedAt && task.updatedAt && previous.updatedAt > task.updatedAt) return false
    state.tasks = [task, ...state.tasks.filter(item => item.id !== task.id)].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    if (state.status) { if (task.status === 'running') state.status.activeId = task.id; else if (state.status.activeId === task.id) state.status.activeId = null }
    return true
  }
  function renderHistory() {
    const heading = el('div', 'bp-section-heading'); heading.append(el('h2', '', c.history), button(c.refresh, run(refresh), 'bp-button bp-subtle')); history.replaceChildren(heading)
    if (!state.tasks.length) history.append(el('p', 'bp-caption', c.noHistory))
    for (const task of state.tasks) {
      const row = button('', run(() => selectTask(task.id)), 'bp-task'); row.dataset.task = task.id; row.classList.toggle('active', state.selected?.id === task.id)
      const text = el('span', 'bp-task-text'); text.append(el('strong', '', task.title || c[task.mode] || c.report), el('small', '', `${c[task.mode] || c.report} · ${formatDate(task.createdAt)}`))
      row.append(text, el('span', `bp-status bp-status-${task.status}`, c.statuses[task.status] || task.status)); history.append(row)
    }
  }
  function formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date) }
  async function selectTask(id) {
    const revision = ++state.selectionRevision
    const task = await api('blueprintGet', id)
    if (state.disposed || revision !== state.selectionRevision) return
    state.selected = task; mergeTask(task); state.reportName = ''; state.reportContent = null; ++state.reportRevision; renderTask(); renderHistory(); updateSubmit()
  }
  function renderTask() {
    const task = state.selected
    if (!task) { const empty = el('div', 'bp-empty'); empty.append(el('div', 'bp-empty-symbol', '◇'), el('h2', '', c.emptyTitle), el('p', '', c.emptyBody)); right.replaceChildren(empty); return }
    const heading = el('div', 'bp-result-heading'), title = el('div'); title.append(el('span', 'bp-eyebrow', c.results), el('h2', '', task.title || c[task.mode])); heading.append(title, el('span', `bp-status bp-status-${task.status}`, c.statuses[task.status] || task.status))
    const progress = el('div', 'bp-progress'); progress.setAttribute('role', 'status'); progress.append(el('span', 'bp-caption', c.progress), el('strong', '', c.stages[task.stage] || task.stage || c.statuses[task.status]))
    const track = el('div', 'bp-progress-track'); track.classList.toggle('running', task.status === 'running'); track.classList.toggle('finished', ['completed', 'needs_review'].includes(task.status)); track.append(el('span')); progress.append(track)
    const actions = el('div', 'bp-actions')
    if (task.status === 'running') actions.append(button(state.cancelBusy ? c.cancelling : c.cancel, run(async () => { if (state.cancelBusy) return; state.cancelBusy = true; renderTask(); try { const result = await api('blueprintCancel', task.id); if (result?.id) acceptUpdate(result) } finally { state.cancelBusy = false; if (!state.disposed) renderTask() } })))
    if (['failed', 'cancelled', 'interrupted'].includes(task.status)) { const resume = button(state.busy ? c.resuming : c.resume, run(async () => { if (state.busy || hasRunning() || !ready()) return; state.busy = true; renderTask(); updateSubmit(); try { const next = await api('blueprintResume', task.id); acceptUpdate(next) } finally { state.busy = false; if (!state.disposed) { renderTask(); updateSubmit() } } }), 'bp-button bp-primary'); resume.disabled = state.busy || hasRunning() || !ready(); actions.append(resume) }
    actions.append(button(c.openFolder, run(() => api('blueprintOpenFolder', task.id))))
    actions.append(button(chatCopy.explain, run(() => show('chat', { kind: 'task', id: task.id })), 'bp-button bp-primary'))
    right.replaceChildren(heading, progress, actions)
    if (task.error) { const error = el('p', 'bp-error', task.error); error.setAttribute('role', 'alert'); right.append(error) }
    if (task.usage) { const parts = []; const calls = task.usage.calls ?? task.usage.modelCalls; const tokens = task.usage.totalTokens ?? task.usage.total_tokens ?? (typeof task.usage.input_tokens === 'number' && typeof task.usage.output_tokens === 'number' ? task.usage.input_tokens + task.usage.output_tokens : undefined); if (typeof calls === 'number') parts.push(`${calls} ${c.calls}`); if (typeof tokens === 'number') parts.push(`${tokens} ${c.tokens}`); if (parts.length) right.append(el('p', 'bp-caption', `${c.usage} · ${parts.join(' · ')}`)) }
    if (task.status !== 'running') right.append(el('p', 'bp-review-note', c.draftNote))
    const reports = task.reports || []
    if (!reports.length) { right.append(el('p', 'bp-no-report', c.noReports)); return }
    const reportTabs = el('div', 'bp-report-tabs'); reportTabs.setAttribute('aria-label', c.report)
    if (!reports.some(report => report.name === state.reportName)) { state.reportName = reports.find(report => /^(方案|差距报告)\.md$/.test(report.name))?.name || reports[0].name; state.reportContent = null; void loadReport(task.id, state.reportName) }
    for (const report of reports) { const tab = button(report.name, () => { if (state.reportName === report.name) return; state.reportName = report.name; state.reportContent = null; renderTask(); void loadReport(task.id, report.name) }, 'bp-button bp-report-tab'); tab.classList.toggle('active', report.name === state.reportName); tab.setAttribute('aria-pressed', String(report.name === state.reportName)); reportTabs.append(tab) }
    const copy = button(c.copy, run(async () => { if (!state.reportContent) return; await api('copyText', state.reportContent); toast(c.copied) }), 'bp-button bp-subtle'); copy.disabled = !state.reportContent; reportTabs.append(copy); right.append(reportTabs)
    const body = el('article', 'bp-report-body markdown-content'); body.dataset.reportBody = ''; if (state.reportContent !== null) body.innerHTML = renderMarkdown(state.reportContent || c.emptyReport); else body.textContent = c.reportLoading; right.append(body); if (state.reportContent !== null) void renderDiagrams(body)
    if (task.review) right.append(el('p', 'bp-caption', c.reviewNotice))
  }
  async function loadReport(id, name) {
    const revision = ++state.reportRevision
    try { const report = await api('blueprintReadReport', id, name); if (state.disposed || revision !== state.reportRevision || state.selected?.id !== id || state.reportName !== name) return; state.reportContent = report.content; renderTask() }
    catch (error) { if (state.disposed || revision !== state.reportRevision || state.selected?.id !== id || state.reportName !== name) return; const body = right.querySelector('[data-report-body]'); if (body) { body.replaceChildren(el('p', 'bp-error', error.message || c.failure), button(c.retryReport, () => void loadReport(id, name))) } }
  }
  function acceptUpdate(task) {
    if (state.disposed || !task?.id || !mergeTask(task)) return
    if (state.selected?.id === task.id) { const old = state.selected; state.selected = task; if (old.status === 'running' && task.status !== 'running') { state.reportName = ''; state.reportContent = null } renderTask() }
    renderHistory(); renderForm()
  }
  async function refresh() {
    const revision = ++state.refreshRevision
    const [status, tasks] = await Promise.all([api('blueprintStatus'), api('blueprintList')])
    if (state.disposed || revision !== state.refreshRevision) return
    state.status = status
    for (const task of tasks) mergeTask(task)
    if (state.selected) state.selected = state.tasks.find(task => task.id === state.selected.id) || state.selected
    if (!state.selected && state.tasks.length) { state.selected = state.tasks.find(task => task.id === status.activeId) || state.tasks[0] }
    renderHealth(); renderForm(); renderHistory(); renderTask()
  }
  const unsubscribe = onUpdate(acceptUpdate)
  renderForm(); renderHealth(); renderHistory(); renderTask()
  return {
    show(mode = 'plan', initialInput) { return show(mode, initialInput).catch(error => { if (!state.disposed) toast(error.message || c.failure) }) },
    canLeave() { return full.canLeave() },
    hide() { root.hidden = true },
    refresh,
    destroy() { starter.destroy(); chat.destroy(); full.destroy(); state.disposed = true; ++state.reportRevision; ++state.selectionRevision; ++state.refreshRevision; if (typeof unsubscribe === 'function') unsubscribe(); root.remove() },
  }
}
