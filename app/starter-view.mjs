/** Conversational UI for all six original starter-kit stages, including real execution. */
import { renderMarkdown } from './assets/document-format.js'
import { starterCopy as c } from './starter-copy.mjs'

/** Mount the full development workflow without starting work automatically. */
export function mountStarter({ container, api, onUpdate = () => () => {}, toast = () => {} }) {
  const doc = container.ownerDocument, state = { list: [], sources: [], project: null, selected: null, draft: '', name: '', idea: '', sourceId: '', busy: false, library: null, drawer: false, file: null, review: null, cloud: false, checks: {}, gradeDrafts: {}, revision: 0, disposed: false }
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n }
  const guard = fn => async () => { try { await fn() } catch (error) { toast(error.message) } }
  const button = (label, fn, cls = 'bp-button') => { const n = el('button', cls, label); n.type = 'button'; n.onclick = guard(fn); return n }
  const root = el('section', 'stk-workspace'), header = el('header', 'stk-header'), body = el('div', 'stk-layout'), sidebar = el('aside', 'stk-sidebar'), main = el('main', 'stk-main'), right = el('aside', 'stk-drawer')
  const heading = el('div'); heading.append(el('h1', '', c.title), el('p', 'bp-caption', c.subtitle)); header.append(heading, button(c.library, async () => { state.drawer = true; state.library = await api('starterLibrary'); renderDrawer() }))
  const conversation = el('div', 'stk-messages'), controls = el('div', 'stk-controls'), composer = el('form', 'stk-composer'), input = el('textarea', 'bp-input'), submit = button(c.send, () => {}, 'bp-button bp-primary'), stop = button(c.stop, async () => { state.project = await api('starterCancel', state.project.id); render() })
  input.rows = 3; input.setAttribute('aria-label', c.placeholder); input.placeholder = c.placeholder; input.oninput = () => { state.draft = input.value; updateComposer() }; input.onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void guard(send)() } }
  submit.type = 'submit'; submit.onclick = null; composer.append(input, submit, stop); composer.onsubmit = event => { event.preventDefault(); void guard(send)() }
  main.append(conversation, controls, composer); body.append(sidebar, main, right); root.append(header, body); container.append(root)
  const running = () => state.project && ['running', 'waiting'].includes(state.project.status)
  function updateComposer() { input.disabled = !state.project || state.project.completed || state.busy; submit.disabled = !state.project || state.project.completed || running() || state.busy || !state.draft.trim(); submit.textContent = running() ? c.thinking : c.send; stop.hidden = !running() }
  function field(label, value, fn, area = false) { const wrap = el('label', 'bp-label', label), n = el(area ? 'textarea' : 'input', 'bp-input'); n.value = value; n.placeholder = label; n.setAttribute('aria-label', label); if (area) n.rows = 3; n.oninput = () => fn(n.value); wrap.append(n); return wrap }
  async function refresh() { const [list, sources] = await Promise.all([api('starterList'), api('starterSources')]); if (state.disposed) return; state.list = list; state.sources = sources; if (!state.project && list.length) state.project = await api('starterGet', list[0].id); render() }
  async function select(id) { const rev = ++state.revision, p = await api('starterGet', id); if (rev !== state.revision || state.disposed) return; state.project = p; state.review = null; render() }
  function renderSidebar() {
    sidebar.replaceChildren(el('h2', '', c.projects))
    for (const p of state.list) { const row = button(p.name, () => select(p.id), 'bp-task'); row.classList.toggle('active', state.project?.id === p.id); sidebar.append(row) }
    const create = el('details', 'stk-create'); create.open = !state.list.length; create.append(el('summary', '', c.create))
    create.append(field(c.name, state.name, v => { state.name = v }), field(c.idea, state.idea, v => { state.idea = v }, true), button(c.create, async () => {
      if (state.busy) return; state.busy = true; updateComposer()
      try { state.project = await api('starterCreate', { name: state.name, idea: state.idea }); state.name = ''; state.idea = ''; await refresh() } finally { state.busy = false; render() }
    }, 'bp-button bp-primary'))
    const sources = el('select', 'bp-input'); sources.setAttribute('aria-label', c.selectSource); sources.append(el('option', '', c.selectSource))
    for (const source of state.sources) { const option = el('option', '', source.label + ' · ' + source.name); option.value = source.kind + ':' + source.id; sources.append(option) }
    sources.value = state.sourceId; sources.onchange = () => { state.sourceId = sources.value }
    create.append(el('p', 'bp-caption', c.source), sources, button(c.importSource, async () => { const [kind, id] = state.sourceId.split(':'); if (!id) throw new Error(c.selectSource); state.project = await api('starterFromSource', kind, id); await refresh() }))
    sidebar.append(create)
    if (state.project) {
      sidebar.append(el('h2', '', state.project.name))
      c.phases.forEach((phase, index) => { const n = el('div', 'stk-phase' + (state.project.phase === index ? ' current' : '') + (state.project.history.some(x => x.phase === index) ? ' complete' : ''), `${index}. ${phase}`); sidebar.append(n) })
      sidebar.append(button(c.folder, () => api('starterFolder', state.project.id)), button(c.importPrd, async () => { const p = await api('starterImport', state.project.id); if (p) { state.project = p; render() } }))
    }
  }
  function renderMessages() {
    const bottom = conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 120
    conversation.replaceChildren()
    if (!state.project) { conversation.append(el('h2', '', c.welcome), el('p', 'bp-caption', c.welcomeText)); return }
    const p = state.project
    const status = el('div', 'stk-stage-banner'); status.append(el('strong', '', `${p.phase}. ${c.phases[p.phase]}`), el('span', '', p.status === 'paused' ? '已暂停，可继续' : c.statuses[p.status] || p.status)); conversation.append(status)
    for (const message of p.messages) { const row = el('article', 'stk-message ' + message.role); row.append(el('small', '', message.role === 'user' ? '你' : '开发搭档')); const content = el('div', 'markdown-content'); if (message.role === 'assistant') content.innerHTML = renderMarkdown(message.content || p.activity || c.thinking); else content.textContent = message.content; row.append(content); conversation.append(row) }
    if (p.error && p.status !== 'paused') { const error = el('p', 'bp-error', p.error); error.setAttribute('role', 'alert'); conversation.append(error) }
    if (p.status === 'paused') {
      const pause = p.pause || {}, card = el('section', 'stk-result stk-pause'); card.setAttribute('role', 'status'); card.append(el('strong', '', '执行已暂停，当前阶段与进度已保存'), el('p', '', pause.reason || '本轮到达连续执行上限。'), el('p', 'bp-caption', '这是工作台的执行限制，不是 API 余额提示。可点击下方“继续当前阶段”接着做，也可以先补充要求；不会自动进入下一阶段。'))
      const usage = pause.usage || p.runs?.at(-1)?.usage || {}, limits = pause.limits || {}, detail = el('details', 'bp-caption'); detail.append(el('summary', '', '查看本轮用量与上限'))
      if (Number.isFinite(usage.calls)) detail.append(el('p', '', `模型请求：${usage.calls} 次${Number.isFinite(limits.maxCalls) ? ` / 上限 ${limits.maxCalls} 次` : ''}`))
      if (Number.isFinite(usage.output_tokens)) detail.append(el('p', '', `模型输出：${usage.output_tokens} tokens${Number.isFinite(limits.maxOutputTokens) ? ` / 上限 ${limits.maxOutputTokens} tokens` : ''}`))
      if (Number.isFinite(usage.input_tokens)) detail.append(el('p', '', `累计输入：${usage.input_tokens} tokens（含重复发送的历史，用于用量统计）`))
      card.append(detail); conversation.append(card)
    }
    if (p.report) { const result = el('div', 'stk-result'); result.append(el('strong', '', c.report), el('p', '', p.report.summary)); if (p.report.unresolved?.length) result.append(el('p', 'bp-caption', c.unresolved + '：' + p.report.unresolved.join('；'))); result.append(el('p', 'bp-caption', p.report.nextStep)); conversation.append(result) }
    if (p.pending) {
      const card = el('div', 'stk-approval'); card.setAttribute('role', 'alert'); card.append(el('h3', '', c.approval), el('p', '', p.pending.reason), el('pre', '', p.pending.command), el('p', 'bp-caption', c.approvalHint), button(c.approve, async () => { state.project = await api('starterReply', p.id, p.pending.token, true); render() }, 'bp-button bp-primary'), button(c.reject, async () => { state.project = await api('starterReply', p.id, p.pending.token, false); render() })); conversation.append(card)
    }
    if (p.samples.length) {
      const samples = el('details', 'stk-samples'); samples.append(el('summary', '', c.samples + `（${Object.keys(p.ratings).length}/${p.samples.length} 已评分）`), el('p', 'bp-caption', c.sampleHint))
      for (const sample of p.samples) {
        const card = el('div', 'stk-sample'), dimensions = p.rubric || ['覆盖要求', '结构合规', '语言质量', '事实无误', '长度合适'], saved = p.ratings[sample.id], draft = state.gradeDrafts[sample.id] ||= { scores: { ...(saved?.scores || {}) }, unacceptable: saved?.unacceptable || false, comment: saved?.comment || '' }, scores = draft.scores
        card.append(el('strong', '', sample.input), el('p', '', sample.output))
        const unacceptable = el('input'); unacceptable.type = 'checkbox'; unacceptable.checked = draft.unacceptable; unacceptable.onchange = () => { draft.unacceptable = unacceptable.checked }
        const flag = el('label', 'stk-check'); flag.append(unacceptable, el('span', '', '这条样例不能接受')); card.append(flag)
        for (const dimension of dimensions) { const row = el('label', 'stk-check', dimension), score = el('select', 'bp-input'); score.setAttribute('aria-label', dimension + '评分'); const blank = el('option', '', '请选择'); blank.value = ''; score.append(blank); for (let v = 1; v <= 3; v++) { const opt = el('option', '', `${v} 分`); opt.value = String(v); score.append(opt) }; score.value = String(scores[dimension] || ''); score.disabled = running(); score.onchange = () => { scores[dimension] = Number(score.value) }; row.append(score); card.append(row) }
        const comment = el('textarea', 'bp-input'); comment.placeholder = '可选：哪里好、哪里不能接受'; comment.value = draft.comment; comment.oninput = () => { draft.comment = comment.value }; comment.rows = 2; card.append(comment)
        const save = button(saved ? '更新本条评分' : '保存本条评分', async () => { state.project = await api('starterRate', p.id, sample.id, { scores, unacceptable: unacceptable.checked, comment: comment.value }); delete state.gradeDrafts[sample.id]; render() }); save.disabled = running(); card.append(save); samples.append(card)
      }; conversation.append(samples)
    }
    if (p.completed) conversation.append(el('p', '', c.completed))
    if (bottom) conversation.scrollTop = conversation.scrollHeight
  }
  function renderControls() {
    controls.replaceChildren(); const p = state.project; if (!p) return
    const next = button(c.next, async () => { if (state.draft.trim()) { toast('输入框里有未发送的内容，已保留。请先发送这段内容，或清空后继续当前阶段。'); input.focus(); return }; state.draft = c.nextPrompt + (p.status === 'paused' ? ' 从上次暂停处继续，先核对已完成的文件和测试，避免重复执行已经完成的操作。' : ''); input.value = state.draft; await send() }); next.disabled = running() || state.busy || p.completed
    controls.append(next, button(c.files, () => { state.drawer = true; state.library = null; renderDrawer() }))
    const review = button(c.review, async () => { state.review = await api('starterReview', p.id); state.checks = {}; state.drawer = true; state.library = null; renderDrawer() }); review.disabled = running() || p.completed; controls.append(review)
    for (const preview of p.preview) controls.append(button(c.preview + ' · ' + preview.url, () => api('starterOpenPreview', p.id, preview.url)), button(c.captureDesktop, async () => { await api('starterCapture', p.id, preview.url, false); await select(p.id) }), button(c.captureMobile, async () => { await api('starterCapture', p.id, preview.url, true); await select(p.id) }), button(c.stopPreview, async () => { await api('starterStopPreview', p.id, preview.port); await select(p.id) }))
    if (p.phase >= 4) controls.append(button(c.cloud, () => { state.cloud = true; state.drawer = true; state.review = null; renderDrawer() }))
  }
  async function loadFile(name, library = false) { state.cloud = false; state.file = await api(library ? 'starterReadLibrary' : 'starterRead', ...(library ? [name] : [state.project.id, name])); state.review = null; renderDrawer() }
  function renderDrawer() {
    right.hidden = !state.drawer; body.classList.toggle('with-drawer', state.drawer); right.replaceChildren()
    if (!state.drawer) return
    right.append(button(c.close, () => { state.drawer = false; state.review = null; state.cloud = false; renderDrawer() }))
    if (state.cloud) {
      right.append(el('h2', '', c.cloud), el('p', 'bp-caption', '模型 API 自动复用工作台设置。这里仅配置部署所需的火山引擎账号权限，密钥不会进入聊天或项目文件。'))
      const values = {}, fields = [['accessKey', 'Access Key ID'], ['secretKey', 'Secret Access Key'], ['region', '地域（默认 cn-beijing）']]
      for (const [key, label] of fields) { const row = field(label, '', v => { values[key] = v }); const input = row.querySelector('input'); input.type = key === 'region' ? 'text' : 'password'; input.autocomplete = 'off'; right.append(row) }
      right.append(button('移除本地上线凭证', async () => { await api('starterRemoveCloud', state.project.id); toast('已移除本地凭证；云端密钥需在云控制台撤销') }))
      right.append(button('加密保存凭证', async () => { await api('starterSaveCloud', state.project.id, values); state.cloud = false; renderDrawer(); toast('上线凭证已加密保存，实际操作仍逐条确认') }, 'bp-button bp-primary')); return
    }
    if (state.review) {
      right.append(el('h2', '', c.review), el('p', 'bp-caption', state.review.report?.summary || '先让执行器完成本阶段报告，再核对。'))
      for (const [key, label] of Object.entries(c.checks)) { const row = el('label', 'stk-check'), check = el('input'); check.type = 'checkbox'; check.checked = state.checks[key] === true; check.onchange = () => { state.checks[key] = check.checked }; row.append(check, el('span', '', label)); right.append(row) }
      const accept = button(state.project.phase === 5 ? c.finish : c.accept, async () => { state.project = await api('starterAdvance', state.project.id, { confirmed: true, checks: state.checks, expectedHash: state.review.hash }); state.review = null; state.drawer = false; toast(c.continueAfterGate(c.phases[state.project.phase])); render() }, 'bp-button bp-primary'); right.append(accept); return
    }
    const files = state.library || state.project?.files || []
    const list = el('div', 'stk-file-list')
    for (const file of files) list.append(button(file.name, () => loadFile(file.name, !!state.library), 'bp-task'))
    right.append(list)
    const file = state.file
    if (!file) { right.append(el('p', 'bp-caption', c.noFile)); return }
    right.append(el('h3', '', file.name))
    if (file.image) { const image = el('img', 'bpf-image'); image.src = file.image; image.alt = file.name; right.append(image) }
    else if (file.name.endsWith('.md')) { const article = el('article', 'markdown-content'); article.innerHTML = renderMarkdown(file.content); right.append(article) }
    else right.append(el('pre', 'stk-code', file.content))
  }
  function render() { renderSidebar(); renderMessages(); renderControls(); renderDrawer(); if (input.value !== state.draft) input.value = state.draft; updateComposer() }
  async function send() {
    if (!state.project || !state.draft.trim() || running() || state.busy) return
    state.busy = true; updateComposer()
    try { const project = await api('starterSend', state.project.id, state.draft); if (!state.project || state.project.id !== project.id) return; if (!state.project.messages.length || state.project.messages.at(-1).id !== project.messages.at(-1).id) state.project = project; state.draft = ''; input.value = '' }
    finally { state.busy = false; renderMessages(); renderControls(); updateComposer() }
  }
  const unsubscribe = onUpdate(project => { if (state.disposed) return; if (state.project?.id === project.id) { state.project = project; renderMessages(); renderControls(); updateComposer(); if (!running()) { void refresh().catch(e => toast(e.message)) } } })
  return { async show() { root.hidden = false; await refresh() }, hide() { root.hidden = true }, destroy() { state.disposed = true; unsubscribe(); root.remove() } }
}
