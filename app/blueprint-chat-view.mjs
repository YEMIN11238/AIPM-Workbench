/** Chat-first interface over the real, grounded product conversation service. */
import { renderMarkdown } from './assets/document-format.js'
import { chatCopy as c } from './blueprint-chat-copy.mjs'
import { productCopy as pc } from './blueprint-product-copy.mjs'

/** Mount streaming conversation, context selection and explicit product action cards. */
export function mountBlueprintChat({ container, api, onUpdate, onProductUpdate, toast, openFiles }) {
  const doc = container.ownerDocument, state = { scope: null, chat: null, contexts: [], draft: '', job: null, busy: false, disposed: false, revision: 0 }
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n }
  const guard = fn => async () => { try { await fn() } catch (error) { toast(error.message) } }
  const button = (text, fn, cls = 'bp-button') => { const n = el('button', cls, text); n.type = 'button'; n.onclick = guard(fn); return n }
  const root = el('section', 'bpc-workspace'), header = el('header', 'bpc-header'), conversation = el('div', 'bpc-messages'), footer = el('footer', 'bpc-footer'), jobPanel = el('div', 'bpc-job')
  conversation.setAttribute('role', 'log'); conversation.setAttribute('aria-label', '产品对话')
  const composer = el('form', 'bpc-composer'), input = el('textarea', 'bp-input bpc-input'), sendButton = button(c.send, () => {}, 'bp-button bp-primary'), stopButton = button(c.stop, async () => { await api('blueprintChatCancel'); await load() })
  input.rows = 3; input.placeholder = c.placeholder; input.setAttribute('aria-label', c.placeholder); input.oninput = () => { state.draft = input.value; updateComposer() }
  input.onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void guard(send)() } }
  sendButton.type = 'submit'; sendButton.onclick = null
  composer.append(input, sendButton, stopButton); composer.onsubmit = event => { event.preventDefault(); void guard(send)() }
  const actions = el('div', 'bpc-actions'), hint = el('p', 'bp-caption', c.actionHint)
  footer.append(jobPanel, actions, hint, composer); root.append(header, conversation, footer); container.append(root)
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  function updateComposer() { const running = state.chat?.status === 'running'; sendButton.disabled = state.busy || running || !state.draft.trim(); stopButton.hidden = !running; input.disabled = state.busy; sendButton.textContent = running ? c.thinking : c.send }
  function renderHeader() {
    const left = el('div'); left.append(el('h1', '', c.title), el('p', 'bp-caption', c.subtitle))
    const picker = el('select', 'bp-input'); picker.setAttribute('aria-label', c.context)
    const fresh = el('option', '', c.new); fresh.value = 'new'; picker.append(fresh)
    for (const item of state.contexts) { const option = el('option', '', `${item.label} · ${item.title}`); option.value = `${item.scope.kind}:${item.scope.id}`; picker.append(option) }
    picker.value = state.scope?.kind === 'new' ? 'new' : `${state.scope?.kind}:${state.scope?.id}`
    picker.onchange = () => { const [kind, id] = picker.value.split(':'); void guard(() => load({ kind, ...(id ? { id } : {}) }))() }
    header.replaceChildren(left, picker)
  }
  function renderMessages() {
    const nearBottom = conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 100
    conversation.replaceChildren()
    const context = state.chat?.context
    if (context && state.scope?.kind !== 'new') {
      const info = el('div', 'bpc-context'); info.append(el('strong', '', `${c.current} · ${context.title}`), el('p', '', context.summary)); conversation.append(info)
    }
    if (!state.chat?.messages.length) {
      const welcome = el('div', 'bpc-welcome'); welcome.append(el('h2', '', c.welcome), el('p', '', c.welcomeText))
      const examples = el('div', 'bpc-starters')
      for (const text of c.starters) examples.append(button(text, async () => { state.draft = text; input.value = text; input.focus(); updateComposer(); await send() }))
      welcome.append(examples); conversation.append(welcome)
    }
    for (const message of state.chat?.messages || []) {
      const row = el('article', `bpc-message bpc-${message.role}`), label = el('small', 'bpc-speaker', message.demo ? message.role === 'user' ? '演示提问' : '产品搭档 · 演示回复' : message.role === 'user' ? '你' : '产品搭档'), text = el('div', 'markdown-content')
      if (message.role === 'assistant') text.innerHTML = renderMarkdown(message.content || c.thinking)
      else text.textContent = message.content
      row.append(label, text)
      if (['interrupted', 'cancelled'].includes(message.status)) row.append(el('p', 'bp-caption', c.interrupted))
      conversation.append(row)
    }
    if (state.chat?.error) { const error = el('p', 'bp-error', state.chat.error); error.setAttribute('role', 'alert'); conversation.append(error) }
    if (nearBottom || state.busy) conversation.scrollTop = conversation.scrollHeight
    updateComposer()
  }
  function renderActions() {
    actions.replaceChildren()
    const running = state.job && ['running', 'waiting'].includes(state.job.status)
    const control = (label, fn, cls) => { const n = button(label, fn, cls); n.disabled = running || state.busy || state.chat?.status === 'running'; actions.append(n) }
    if (state.scope?.kind === 'product') {
      control(c.plan, () => start('plan'))
      control(c.build, () => start('build'))
      control(c.verify, () => start('verify'))
      control(c.revise, () => start('revise', { requirement: state.draft.trim() || [...state.chat.messages].reverse().find(m => m.role === 'user')?.content || '', strategy: 'full' }))
      actions.append(button(c.files, () => openFiles(state.scope.id)))
    } else control(state.scope?.kind === 'task' ? c.fromTask : c.create, async () => {
      const job = await api('blueprintChatCreateProduct', state.scope); state.job = job; await load({ kind: 'product', id: job.productId })
    }, 'bp-button bp-primary')
  }
  function renderJob() {
    jobPanel.replaceChildren(); const job = state.job
    if (!job) return
    const running = ['running', 'waiting'].includes(job.status)
    const label = running ? c.job : job.status === 'completed' ? c.completed : job.status === 'needs_review' ? c.review : job.status === 'cancelled' ? c.cancelled : c.failed
    jobPanel.append(el('strong', '', `${pc.actions[job.action]} · ${label}`), el('p', 'bp-caption', running ? job.stage : job.error || ''))
    if (running) jobPanel.append(button(c.cancelJob, async () => { await api('blueprintProductCancel', job.id); await load() }))
    else {
      jobPanel.append(button(c.explain, async () => { state.draft = `请用我能看懂的话解释刚才的${pc.actions[job.action]}结果：实际生成或改变了什么？哪些问题还没解决？我下一步该做什么？`; input.value = state.draft; input.focus(); updateComposer(); await send() }))
      if (job.productId) jobPanel.append(button(c.report, () => openFiles(job.productId)))
    }
    renderActions()
  }
  async function load(scope = state.scope) {
    const revision = ++state.revision
    state.scope = scope || { kind: 'new' }
    const chat = await api('blueprintChatGet', state.scope)
    if (revision !== state.revision || state.disposed) return
    state.chat = chat
    if (state.scope.kind === 'product') { const product = await api('blueprintProductGet', state.scope.id); if (revision !== state.revision || state.disposed) return; state.job = product.jobs[0] || null }
    else state.job = null
    renderHeader(); renderMessages(); renderActions(); renderJob(); input.value = state.draft; updateComposer()
  }
  async function send() {
    if (!state.draft.trim() || state.busy || state.chat?.status === 'running') return
    state.busy = true; updateComposer(); renderActions()
    const text = state.draft, scope = state.scope
    try {
      const chat = await api('blueprintChatSend', scope, text)
      if (state.disposed || !same(scope, state.scope)) return
      // An update can finish before the acknowledgement returns.
      if (state.chat?.messages.at(-1)?.id !== chat.messages.at(-1)?.id) state.chat = { ...chat, context: state.chat?.context }
      state.draft = ''; input.value = ''; renderMessages()
    } finally { state.busy = false; updateComposer(); renderActions() }
  }
  const unsubscribe = onUpdate(chat => { if (state.disposed || !same(chat.scope, state.scope)) return; state.chat = { ...chat, context: state.chat?.context }; renderMessages(); renderActions() })
  const unsubscribeJobs = onProductUpdate(job => { if (state.disposed || job.productId !== state.scope?.id || state.scope?.kind !== 'product') return; state.job = job; renderJob(); if (!['running', 'waiting'].includes(job.status)) void load().catch(error => toast(error.message)) })
  return {
    async show(scope, draft) { root.hidden = false; state.contexts = await api('blueprintChatContexts'); const preferred = state.contexts.find(x => !/演示|验收|集成验证/.test(x.title)) || state.contexts[0]; await load(scope || state.scope || preferred?.scope || { kind: 'new' }); if (typeof draft === 'string') { state.draft = draft; input.value = draft; updateComposer() } },
    hide() { root.hidden = true },
    destroy() { state.disposed = true; unsubscribe(); unsubscribeJobs(); root.remove() },
  }
}
