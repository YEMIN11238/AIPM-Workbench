/** Full product loop and source library; all filesystem/model work stays in main. */
import { renderMarkdown } from './assets/document-format.js'
import { renderDiagrams } from './assets/blueprint-diagrams.js'
import { productCopy as c } from './blueprint-product-copy.mjs'

/** Mount product actions, durable jobs and the pinned upstream teaching library. */
export function mountBlueprintProduct({ container, api, onUpdate, toast }) {
  const doc = container.ownerDocument
  const state = { tab: 'product', products: [], selected: null, product: null, files: [], jobs: [], job: null, library: [], query: '', file: null, source: false, dirty: false, loading: false, revision: 0, name: '', idea: '', requirement: '', strategy: 'full', level: 1, libraryName: '', reply: '', disposed: false }
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n }
  const button = (text, action, cls = 'bp-button') => { const n = el('button', cls, text); n.type = 'button'; n.onclick = guard(action); return n }
  const guard = action => async () => { try { await action() } catch (error) { toast(error.message) } }
  const busy = () => state.jobs.some(job => ['running', 'waiting'].includes(job.status)) || state.loading
  const active = () => state.jobs.find(job => ['running', 'waiting'].includes(job.status))
  const root = el('section', 'bpf-workspace'), heading = el('header', 'bpf-heading'), body = el('div', 'bpf-body'), jobPanel = el('section', 'bp-card bpf-job')
  root.append(heading, body, jobPanel); container.append(root)
  function control(text, action, cls) { const n = button(text, action, cls); n.disabled = busy(); return n }
  function field(label, value, change, area = false) {
    const n = el(area ? 'textarea' : 'input', 'bp-input'); n.value = value; if (area) n.rows = 4
    n.oninput = () => change(n.value); n.setAttribute('aria-label', label); n.placeholder = label
    const wrap = el('label', 'bp-label', label); wrap.append(n); return wrap
  }
  function unchanged() { if (state.dirty) { toast(c.unsaved); return false } return true }
  async function refresh() {
    const [products, jobs] = await Promise.all([api('blueprintProducts'), api('blueprintProductJobs')])
    if (state.disposed) return
    state.products = products; state.jobs = jobs
    state.job = jobs.find(job => job.id === state.job?.id) || active() || jobs[0] || null
    if (!state.selected && products.length) state.selected = products[0].id
    if (state.selected) state.product = await api('blueprintProductGet', state.selected)
    if (!state.dirty) render()
    else renderJob()
  }
  async function select(id) {
    if (!unchanged()) return
    const rev = ++state.revision, product = await api('blueprintProductGet', id)
    if (rev !== state.revision || state.disposed) return
    state.selected = id; state.product = product; state.file = null; state.dirty = false; render()
    const first = product.files.find(file => file.name === 'PRD.md')
    if (first) await loadFile(first.name)
  }
  async function launch(action, extra = {}) {
    if (!unchanged() || busy()) return
    state.loading = true; render()
    try {
      const job = await api('blueprintProductStart', { action, productId: state.selected, ...extra })
      state.jobs = [job, ...state.jobs.filter(item => item.id !== job.id)]; state.job = job
      if (job.productId) state.selected = job.productId
      if (action === 'init') { state.name = ''; state.idea = '' }
      if (action === 'revise') state.requirement = ''
    } finally { state.loading = false; await refresh() }
  }
  function render() {
    const title = state.tab === 'library' ? c.libraryTitle : c.title
    heading.replaceChildren(el('h1', '', title), el('p', 'bp-caption', state.tab === 'library' ? c.demoNote : c.subtitle))
    body.replaceChildren()
    if (state.tab === 'library') renderLibrary()
    else renderProduct()
    renderJob()
  }
  function renderProduct() {
    const sidebar = el('aside', 'bpf-side'), list = el('section', 'bp-card bpf-list'), create = el('form', 'bp-card bpf-create')
    list.append(el('h2', '', c.products))
    if (!state.products.length) list.append(el('p', 'bp-caption', c.noProducts))
    for (const p of state.products) { const row = button(`${p.name} · V${p.version || 1}`, () => select(p.id), 'bp-task'); row.classList.toggle('active', state.selected === p.id); list.append(row) }
    create.append(field(c.name, state.name, value => { state.name = value }), field(c.idea, state.idea, value => { state.idea = value }, true))
    const submit = control(c.create, () => launch('init', { name: state.name, idea: state.idea }), 'bp-button bp-primary'); submit.type = 'submit'; create.append(submit)
    create.onsubmit = event => { event.preventDefault(); if (state.name.trim() && state.idea.trim()) void guard(() => launch('init', { name: state.name, idea: state.idea }))() }
    // Submit is owned by the form, preventing two simultaneous init requests.
    submit.onclick = null
    sidebar.append(list, create)
    const main = el('main', 'bp-card bpf-product')
    body.append(sidebar, main)
    if (!state.product || state.product.id !== state.selected) { main.append(el('p', 'bp-caption', c.empty)); return }
    const product = state.product
    main.append(el('h2', '', `${product.name} · V${product.version || 1}`), el('p', 'bpf-workflow', c.workflow))
    const actions = el('div', 'bp-actions')
    for (const action of ['plan', 'build', 'verify', 'run']) actions.append(control(c[action], () => launch(action), action === 'build' ? 'bp-button bp-primary' : 'bp-button'))
    actions.append(button(c.folder, () => api('blueprintProductFolder', state.selected)))
    main.append(actions)
    const options = el('details', 'bpf-options'), summary = el('summary', '', c.revise); options.append(summary)
    options.append(field(c.requirement, state.requirement, value => { state.requirement = value }, true))
    const strategy = el('select', 'bp-input'); strategy.setAttribute('aria-label', c.revise)
    for (const [value, label] of Object.entries(c.strategies)) { const opt = el('option', '', label); opt.value = value; strategy.append(opt) }
    strategy.value = state.strategy; strategy.onchange = () => { state.strategy = strategy.value }
    options.append(strategy, control(c.revise, () => launch('revise', { requirement: state.requirement, strategy: state.strategy })))
    const templates = el('details', 'bpf-options'); templates.append(el('summary', '', c.template))
    const level = el('select', 'bp-input'); level.setAttribute('aria-label', c.level)
    c.levels.forEach((label, value) => { const opt = el('option', '', label); opt.value = String(value); level.append(opt) }); level.value = String(state.level); level.onchange = () => { state.level = Number(level.value) }
    templates.append(level, control(c.template, () => launch('template', { level: state.level })))
    main.append(options, templates, el('p', 'bp-review-note', c.draftNote))
    const editorLayout = el('div', 'bpf-editor-layout'), fileList = el('div', 'bpf-files'), reader = el('div', 'bpf-reader'); reader.dataset.reader = ''
    fileList.append(el('h3', '', c.files))
    for (const file of product.files) { const row = button(file.name, () => loadFile(file.name), 'bp-task'); row.classList.toggle('active', state.file?.name === file.name); fileList.append(row) }
    editorLayout.append(fileList, reader); main.append(editorLayout); renderReader(reader)
  }
  async function loadFile(name) {
    if (!unchanged()) return
    const rev = ++state.revision, id = state.selected, file = await api('blueprintProductRead', id, name)
    if (rev !== state.revision || id !== state.selected || state.disposed) return
    state.file = file; state.source = !name.endsWith('.md'); state.dirty = false; render()
  }
  function renderReader(reader) {
    const file = state.file
    if (!file) { reader.append(el('p', 'bp-caption', c.empty)); return }
    const toolbar = el('div', 'bp-actions'); toolbar.append(el('strong', '', file.name))
    toolbar.append(button(c.read, () => { state.source = false; render() }), button(c.source, () => { state.source = true; render() }))
    const editable = ['PRD.md', '迭代记录.md'].includes(file.name) || file.name.startsWith('skeleton/')
    if (editable) {
      const save = button(c.save, async () => { const saved = await api('blueprintProductSave', state.selected, file.name, state.file.content, state.file.hash); state.file = saved; state.dirty = false; toast(c.saved); await refresh() }, 'bp-button bp-primary'); save.disabled = busy() || !state.dirty; save.dataset.save = ''; toolbar.append(save)
      if (state.dirty) toolbar.append(button(c.discard, async () => { state.dirty = false; await loadFile(file.name) }))
    }
    reader.append(toolbar)
    if (state.source || !file.name.endsWith('.md')) {
      const area = el('textarea', 'bp-input bpf-editor'); area.value = file.content; area.readOnly = !editable || busy(); area.setAttribute('aria-label', file.name)
      area.oninput = () => { state.file.content = area.value; state.dirty = true; const save = reader.querySelector('[data-save]'); if (save) save.disabled = busy() }
      reader.append(area)
    } else { const article = el('article', 'markdown-content bpf-markdown'); article.innerHTML = renderMarkdown(file.content); reader.append(article); void renderDiagrams(article) }
  }
  async function openLibrary(name) {
    const rev = ++state.revision, file = await api('blueprintLibraryRead', name)
    if (rev !== state.revision || state.disposed) return
    state.libraryName = name; state.libraryFile = file; render()
  }
  function renderLibrary() {
    const sidebar = el('aside', 'bp-card bpf-side bpf-library-list'), main = el('main', 'bp-card bpf-product')
    const search = el('input', 'bp-input'); search.placeholder = c.search; search.setAttribute('aria-label', c.search); search.value = state.query
    const rows = el('div')
    function filter() { rows.replaceChildren(); for (const file of state.library.filter(file => file.name.toLowerCase().includes(state.query.toLowerCase()))) rows.append(button(file.name, () => openLibrary(file.name), 'bp-task')) }
    search.oninput = () => { state.query = search.value; filter() }; sidebar.append(search, rows); filter(); body.append(sidebar, main)
    const actions = el('div', 'bp-actions')
    actions.append(control(c.eval, () => launch('eval')), control(c.realEval, () => launch('eval', { real: true })), control(c.package, () => launch('package')))
    const component = state.libraryName.match(/^(s\d\d_[^/]+)\//)?.[1]
    if (component) actions.append(control(c.componentRun, () => launch('demo', { component }), 'bp-button bp-primary'))
    main.append(actions, el('p', 'bp-caption', `${c.installed} · ${(state.version || '').slice(0, 10)}`))
    const file = state.libraryFile
    if (file?.image) { const img = el('img', 'bpf-image'); img.src = file.image; img.alt = file.name; main.append(img) }
    else if (file) {
      const article = el('article', 'markdown-content bpf-markdown')
      if (file.name.endsWith('.md')) {
        article.innerHTML = renderMarkdown(file.content); void renderDiagrams(article)
        const related = el('div', 'bp-actions'), seen = new Set()
        for (const match of file.content.matchAll(/!?\[[^\]]*\]\(([^\s)]+)\)/g)) {
          if (/^(?:https?:|#)/.test(match[1])) continue
          const parts = file.name.split('/').slice(0, -1)
          for (const piece of match[1].split('#')[0].split('/')) { if (piece === '..') parts.pop(); else if (piece && piece !== '.') parts.push(piece) }
          const name = parts.join('/')
          if (!seen.has(name) && state.library.some(item => item.name === name)) { seen.add(name); related.append(button(name, () => openLibrary(name), 'bp-button bp-subtle')) }
        }
        if (seen.size) main.append(related)
      }
      else { const pre = el('pre'), code = el('code', '', file.content); pre.append(code); article.append(pre) }
      main.append(el('h2', '', file.name), article)
    }
  }
  function renderJob() {
    const job = state.job, history = el('select', 'bp-input'); history.setAttribute('aria-label', c.jobs)
    for (const item of state.jobs) { const opt = el('option', '', `${c.actions[item.action]} · ${item.title} · ${c.statuses[item.status]}`); opt.value = item.id; history.append(opt) }
    history.value = job?.id || ''; history.onchange = () => { state.job = state.jobs.find(j => j.id === history.value); renderJob() }
    jobPanel.replaceChildren(el('h2', '', c.job), history)
    if (!job) { jobPanel.append(el('p', 'bp-caption', c.noJob)); return }
    jobPanel.append(el('p', 'bp-caption', `${c.statuses[job.status]} · ${job.stage}${job.mock ? ' · 离线占位演示' : ''}`))
    if (job.error) jobPanel.append(el('p', 'bp-error', job.error))
    const log = el('pre', 'bpf-console', job.logs.join('').slice(-18000)); log.setAttribute('aria-label', c.jobs); jobPanel.append(log)
    const usage = job.usage || {}; if (usage.calls) jobPanel.append(el('p', 'bp-caption', `${usage.calls} 次模型调用 · ${(usage.input_tokens || 0) + (usage.output_tokens || 0)} tokens`))
    if (['running', 'waiting'].includes(job.status)) jobPanel.append(button(c.cancel, async () => { await api('blueprintProductCancel', job.id); await refresh() }))
    else {
      jobPanel.append(button(c.jobFolder, () => api('blueprintProductFolder', job.id, 'job')))
      if (job.status === 'completed' || job.status === 'needs_review') jobPanel.append(button(c.report, async () => { const file = await api('blueprintProductJobRead', job.id, '结果.md'); const article = el('article', 'markdown-content bpf-markdown'); article.innerHTML = renderMarkdown(file.content); jobPanel.append(article) }))
    }
    if (job.waiting) {
      jobPanel.append(el('p', 'bp-caption', c.replyHint), el('p', '', job.waiting))
      const form = el('form', 'bpf-reply'), input = el('textarea', 'bp-input'); input.rows = 2; input.setAttribute('aria-label', c.reply); input.value = state.reply; input.oninput = () => { state.reply = input.value }
      const send = button(c.reply, () => {}); send.type = 'submit'; form.append(input, send)
      form.onsubmit = event => { event.preventDefault(); void guard(async () => { await api('blueprintProductReply', job.id, state.reply); state.reply = ''; await refresh() })() }; jobPanel.append(form)
    }
  }
  let refreshPending = false
  const unsubscribe = onUpdate(job => {
    if (state.disposed) return
    state.jobs = [job, ...state.jobs.filter(item => item.id !== job.id)]
    if (!state.job || state.job.id === job.id || ['running', 'waiting'].includes(job.status)) state.job = job
    renderJob()
    if (!['running', 'waiting'].includes(job.status) && !refreshPending) { refreshPending = true; void refresh().catch(error => toast(error.message)).finally(() => { refreshPending = false }) }
  })
  return {
    async show(tab = 'product', productId) {
      if (productId && productId !== state.selected) { state.selected = productId; state.file = null }
      state.tab = tab; root.hidden = false
      const [library, status] = await Promise.all([api('blueprintLibrary'), api('blueprintProductStatus')]); state.library = library; state.version = status.revision
      await refresh()
      if (!state.dirty && state.selected && !state.file && state.tab === 'product') await select(state.selected)
      if (state.tab === 'library' && !state.libraryFile) await openLibrary('使用引导.md')
    },
    canLeave: unchanged,
    hide() { root.hidden = true },
    destroy() { state.disposed = true; unsubscribe(); root.remove() },
  }
}
