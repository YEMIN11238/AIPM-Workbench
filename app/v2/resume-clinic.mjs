/** Display the locally bundled resume tool in an isolated native view. */
const copy = { loading: '正在打开简历检查…', failed: '简历检查暂时无法打开', retry: '重新打开', surface: '简历检查与编辑' }

/** Mount a persistent display slot; opening it never starts a model request. */
export function mountResumeClinic({ container, api }) {
  const doc = container.ownerDocument, win = doc.defaultView
  const page = doc.createElement('div'), slot = doc.createElement('div'), status = doc.createElement('div'), message = doc.createElement('p'), retry = doc.createElement('button')
  page.className = 'resume-clinic-page'; slot.className = 'resume-clinic-slot'; slot.setAttribute('aria-label', copy.surface)
  status.className = 'resume-clinic-status'; status.setAttribute('role', 'status'); message.textContent = copy.loading
  retry.type = 'button'; retry.className = 'v2-button'; retry.textContent = copy.retry; retry.hidden = true
  status.append(message, retry); slot.append(status); page.append(slot); container.append(page)
  let visible = false, disposed = false, revision = 0, attached = false, scheduled = false, pending = Promise.resolve()
  const current = token => visible && !disposed && revision === token
  const bounds = () => { const r = slot.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } }
  function sync() {
    const token = revision
    pending = pending.then(async () => {
      if (!current(token)) return false
      const rect = bounds(); if (rect.width <= 0 || rect.height <= 0) return false
      if (attached) { await api('resumeBounds', rect); return true }
      message.textContent = copy.loading; retry.hidden = true
      const shown = await api('resumeShow', rect)
      if (!current(token)) { await api('resumeHide'); return false }
      if (shown === false) return false
      attached = true; return true
    }).catch(error => {
      if (current(token)) { message.textContent = copy.failed + '：' + (error?.message || '请重新打开工作台后重试'); retry.hidden = false }
      return false
    })
    return pending
  }
  function schedule() { if (!visible || disposed || scheduled) return; scheduled = true; queueMicrotask(() => { scheduled = false; if (visible && !disposed) void sync() }) }
  function hide() {
    if (!visible && !attached) return
    visible = false; attached = false; ++revision
    void Promise.resolve().then(() => api('resumeHide')).catch(() => { /* Host shutdown also removes the native view. */ })
  }
  retry.onclick = () => { if (visible && !disposed) void sync() }
  win.addEventListener('resize', schedule)
  const observer = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(schedule) : null
  observer?.observe(slot)
  return {
    show() { if (disposed) return Promise.resolve(false); visible = true; ++revision; return sync() },
    hide,
    destroy() { if (disposed) return; hide(); disposed = true; ++revision; observer?.disconnect(); win.removeEventListener('resize', schedule); page.remove() },
  }
}
