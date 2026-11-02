/** The local clinic can request model output without receiving desktop credentials. */
const { contextBridge, ipcRenderer } = require('electron')
const prefix = 'aipm-resume-clinic:'
const api = Object.freeze({
  status: () => ipcRenderer.invoke(prefix + 'status'),
  selectModel: id => ipcRenderer.invoke(prefix + 'select-model', id),
  complete: payload => ipcRenderer.invoke(prefix + 'complete', payload),
  exportPdf: payload => ipcRenderer.invoke(prefix + 'export-pdf', payload),
  onModelUpdate(callback) {
    if (typeof callback !== 'function') throw new TypeError('模型更新需要回调函数')
    const listener = (_event, status) => { try { callback(status) } catch (error) { console.error('简历检查模型更新回调失败') } }
    ipcRenderer.on(prefix + 'model-update', listener)
    return () => ipcRenderer.removeListener(prefix + 'model-update', listener)
  },
})
contextBridge.exposeInMainWorld('aipmResumeClinic', api)

document.addEventListener('click', event => {
  const link = event.target?.closest?.('a[href]')
  if (!link || link.hasAttribute('download')) return
  let url
  try { url = new URL(link.getAttribute('href'), location.href) }
  catch (error) { event.preventDefault(); return }
  if (url.href.split('#')[0] === location.href.split('#')[0] || url.protocol === 'blob:') return
  event.preventDefault()
  if (event.isTrusted && url.protocol === 'https:') void ipcRenderer.invoke(prefix + 'open-link', url.href).catch(() => console.error('外部链接未打开'))
}, true)
