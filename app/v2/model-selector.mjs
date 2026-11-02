/** Shared model controls save one host configuration and leave running task snapshots alone. */
const TARGETS = [
  ['.v2-model', 'inside'], ['.cr-composer .cr-actions', 'inside'], ['.vs-composer .vs-actions', 'inside'],
  ['.stk-composer', 'inside'], ['.bpc-composer', 'inside'], ['.bpf-reply', 'inside'],
  ['.bpf-create', 'inside'], ['.bpf-options', 'inside'], ['.v2-task-form', 'inside'],
  ['[data-model-composer]', 'inside'], ['.geo-body', 'after'],
]
const checked = value => {
  if (!value || typeof value.model !== 'string' || !Array.isArray(value.choices) || !value.choices.some(choice => choice.id === value.model) || value.choices.some(choice => typeof choice.id !== 'string' || typeof choice.label !== 'string')) throw new Error('模型配置暂时无法读取')
  return value
}

/**
 * Bind all known chat composers, including preserved domain leaves, to one saved model.
 * @param {{container:HTMLElement,api:Function,events?:object,toast?:Function,onChange?:Function}} options Host API, events and model-status callback.
 * @returns {{ready:Promise,refresh:Function,beforeRequest:Function,destroy:Function}} Initial loading, request ordering and cleanup.
 */
export function mountModelSelectors({ container, api, events = {}, toast = () => {}, onChange = () => {} }) {
  const doc = container.ownerDocument, win = doc.defaultView, controls = new Map()
  const state = { status: null, pending: null, transition: null, disposed: false, eventRevision: 0, revision: 0, queued: false }
  function publish(value) { state.status = checked(value); onChange(state.status); sync() }
  function sync() {
    for (const [host, control] of controls) {
      if (!container.contains(host) || !container.contains(control.root)) { control.root.remove(); controls.delete(host); continue }
      const choices = state.status?.choices || [], key = JSON.stringify(choices.map(choice => [choice.id, choice.label]))
      if (key !== control.choices) {
        control.input.replaceChildren()
        if (!choices.length) { const option = doc.createElement('option'); option.value = ''; option.textContent = '读取模型…'; control.input.append(option) }
        for (const choice of choices) { const option = doc.createElement('option'); option.value = choice.id; option.textContent = choice.label; control.input.append(option) }
        control.choices = key
      }
      control.input.value = state.pending || state.status?.model || ''; control.input.disabled = !state.status || !!state.pending
      control.root.setAttribute('aria-busy', String(!!state.pending)); control.input.title = state.pending ? '正在保存模型选择…' : '选择影响后续请求；进行中的任务继续使用原模型。'
    }
  }
  function scan() {
    if (state.disposed) return
    for (const [selector, placement] of TARGETS) for (const host of container.querySelectorAll(selector)) {
      if (controls.has(host) || selector === '.bpf-options' && !host.querySelector('textarea')) continue
      const root = doc.createElement('span'), input = doc.createElement('select'), arrow = doc.createElement('span')
      root.className = 'v2-model-picker'; input.setAttribute('aria-label', '模型选择'); arrow.className = 'v2-model-chevron'; arrow.textContent = '⌄'; arrow.setAttribute('aria-hidden', 'true')
      input.oninput = event => event.stopPropagation(); input.onchange = event => { event.stopPropagation(); void choose(input.value) }
      root.append(input, arrow); if (placement === 'after') host.after(root); else host.append(root)
      controls.set(host, { root, input, choices: null })
    }
    sync()
  }
  const observer = new win.MutationObserver(() => { if (!state.queued && !state.disposed) { state.queued = true; queueMicrotask(() => { state.queued = false; scan() }) } })
  observer.observe(container, { childList: true, subtree: true })
  async function refresh() {
    const revision = ++state.revision, event = state.eventRevision
    try { const value = checked(await api('modelStatus')); if (!state.disposed && revision === state.revision && event === state.eventRevision) publish(value) }
    catch (error) { if (!state.disposed && revision === state.revision) { toast(error.message || '模型配置读取失败'); sync() } }
  }
  async function choose(model) {
    if (!state.status || state.pending || model === state.status.model || !state.status.choices.some(choice => choice.id === model)) { sync(); return }
    const event = state.eventRevision; state.pending = model
    let finish; state.transition = new Promise(resolve => { finish = resolve }); const transition = state.transition
    sync()
    let success = false
    try {
      const value = checked(await api('modelSelect', model))
      if (state.disposed) return
      if (event === state.eventRevision || state.status.model === model) publish(value)
      success = true; toast('已切换后续请求的模型；进行中的任务保持原模型。')
    } catch (error) { if (!state.disposed) toast(error.message || '模型切换未成功，已保留原配置。') }
    finally { if (!state.disposed) { state.pending = null; if (state.transition === transition) state.transition = null; sync() }; finish(success) }
  }
  const unsubscribe = typeof events.onModelUpdate === 'function' ? events.onModelUpdate(value => {
    if (state.disposed) return
    try { checked(value); ++state.eventRevision; publish(value) } catch (error) { toast(error.message) }
  }) : null
  scan()
  return {
    ready: refresh(), refresh,
    async beforeRequest() { const transition = state.transition; if (transition && !await transition) throw new Error('模型切换未成功，本次请求尚未发送。请核对选择后重试。') },
    destroy() { if (state.disposed) return; state.disposed = true; ++state.revision; observer.disconnect(); if (typeof unsubscribe === 'function') unsubscribe(); for (const { root } of controls.values()) root.remove(); controls.clear() },
  }
}
