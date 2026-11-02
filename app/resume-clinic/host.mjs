/** Isolated local Resume Clinic view, shared model requests and native PDF exports. */
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { completeWithSharedApi } from '../model-api.mjs'

const prefix = 'aipm-resume-clinic:'
const limits = { messages: 40, characters: 200000, message: 100000, tokens: 24000, schema: 64000, html: 2000000 }
const printPolicy = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const rejectKeys = (value, allowed, message) => { if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new Error(message) }

function publicStatus(value) {
  if (!record(value) || typeof value.model !== 'string' || !Array.isArray(value.choices)) throw new Error('工作台模型状态无效')
  const choices = value.choices.map(choice => {
    if (!record(choice) || typeof choice.id !== 'string' || typeof choice.label !== 'string') throw new Error('工作台模型选项无效')
    return { id: choice.id, label: choice.label, ...(typeof choice.name === 'string' ? { name: choice.name } : {}) }
  })
  if (!choices.some(choice => choice.id === value.model)) throw new Error('工作台当前模型不可用')
  return { configured: value.configured === true, model: value.model, choices }
}

function completionInput(value) {
  rejectKeys(value, ['messages', 'max_tokens', 'max_completion_tokens', 'temperature', 'response_format', 'stream'], '简历检查请求参数无效')
  if (!Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > limits.messages) throw new Error('简历检查消息数量无效')
  let characters = 0
  const messages = value.messages.map(message => {
    rejectKeys(message, ['role', 'content'], '简历检查消息格式无效')
    if (!['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content.trim() || message.content.length > limits.message) throw new Error('简历检查只接受有界的文字消息')
    characters += message.content.length
    return { role: message.role, content: message.content }
  })
  if (characters > limits.characters) throw new Error('简历与检查要求过长，请分段处理')
  if (value.max_tokens !== undefined && value.max_completion_tokens !== undefined) throw new Error('输出 Token 参数重复')
  const maxTokens = value.max_tokens ?? value.max_completion_tokens ?? 6000
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > limits.tokens) throw new Error('输出 Token 数须为 1 到 24000 的整数')
  if (value.temperature !== undefined && (!Number.isFinite(value.temperature) || value.temperature < 0 || value.temperature > 2)) throw new Error('模型温度参数无效')
  if (value.stream !== undefined && value.stream !== false) throw new Error('简历检查暂不支持流式请求')
  let json = false
  if (value.response_format !== undefined) {
    const format = value.response_format
    rejectKeys(format, ['type', 'json_schema'], 'JSON 输出参数无效')
    if (!['json_object', 'json_schema'].includes(format.type)) throw new Error('JSON 输出类型无效')
    json = true
    let instruction = '请仅返回一个合法 JSON 对象，不要使用 Markdown 代码块或解释性前缀。'
    if (format.type === 'json_schema') {
      const schema = format.json_schema
      rejectKeys(schema, ['name', 'strict', 'schema', 'description'], 'JSON Schema 参数无效')
      if (typeof schema.name !== 'string' || !/^[\w.-]{1,128}$/.test(schema.name) || !record(schema.schema) || schema.strict !== undefined && typeof schema.strict !== 'boolean') throw new Error('JSON Schema 定义无效')
      const serialized = JSON.stringify(schema.schema)
      if (serialized.length > limits.schema) throw new Error('JSON Schema 过长')
      instruction += '\n输出须符合以下 JSON Schema：\n' + serialized
    }
    if (messages[0].role === 'system') messages[0].content += '\n\n' + instruction
    else messages.unshift({ role: 'system', content: instruction })
  }
  return { messages, maxTokens, temperature: value.temperature, json }
}

function safeUsage(value) {
  if (!record(value)) return {}
  const keys = ['prompt_tokens', 'completion_tokens', 'total_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens']
  return Object.fromEntries(keys.filter(key => Number.isFinite(value[key]) && value[key] >= 0).map(key => [key, value[key]]))
}

function externalLink(value) {
  if (typeof value !== 'string' || value.length > 10000) throw new Error('外部链接无效')
  let url
  try { url = new URL(value) }
  catch (error) { throw new Error('外部链接无效') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') throw new Error('仅支持普通 HTTPS 外部链接')
  return url.href
}

function printingHtml(value) {
  rejectKeys(value, ['html'], 'PDF 导出参数无效')
  if (typeof value.html !== 'string' || !value.html.trim() || Buffer.byteLength(value.html) > limits.html || !/<html(?:\s|>)/i.test(value.html) || !/<head(?:\s|>)/i.test(value.html) || !/<body(?:\s|>)/i.test(value.html)) throw new Error('请选择完整且不超过 2MB 的简历 HTML')
  const meta = '<meta http-equiv="Content-Security-Policy" content="' + printPolicy + '">'
  return value.html.replace(/<head(?:\s[^>]*)?>/i, match => match + meta)
}

/**
 * Register a local child view without exposing host credentials or general desktop IPC.
 * @param {object} options Electron adapters, shared model callbacks and a fixed application directory.
 * @returns {{show:Function,hide:Function,resize:Function,publishModel:Function,close:Function}} View lifecycle and model notification controls.
 */
export function registerResumeClinic({ ipcMain, WebContentsView, BrowserWindow, window, directory, shell, getApi, modelStatus, selectModel, dialog, fetcher = globalThis.fetch, requestTimeoutMs = 240000 }) {
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1) throw new Error('简历请求超时配置无效')
  const dist = resolve(directory, 'integrations/ai-pm-resume-clinic-upstream/dist')
  const entry = join(dist, 'index.html'), entryUrl = pathToFileURL(entry).href
  const pending = new Set(), exports = new Set(), channels = []
  let view, load, loaded = false, attachedTo, revision = 0, closed = false, shutdown
  const localPage = value => { try { return new URL(typeof value === 'string' ? value : value?.url).href.split('#')[0] === entryUrl } catch (error) { return false } }
  const detach = () => { if (attachedTo && !attachedTo.isDestroyed()) attachedTo.contentView.removeChildView(view); attachedTo = null }
  const bounds = value => {
    const parent = window()
    if (!parent || parent.isDestroyed() || !record(value) || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key]))) throw new Error('简历检查显示区域无效')
    const content = parent.getContentBounds(), x = Math.max(0, Math.min(content.width, Math.round(value.x))), y = Math.max(0, Math.min(content.height, Math.round(value.y)))
    return { x, y, width: Math.max(0, Math.min(Math.round(value.width), content.width - x)), height: Math.max(0, Math.min(Math.round(value.height), content.height - y)) }
  }
  const assertSource = event => {
    if (closed || !view || view.webContents.isDestroyed() || event.sender !== view.webContents || event.senderFrame !== view.webContents.mainFrame) throw new Error('简历检查请求来源无效')
  }
  function bind(name, action) {
    const channel = prefix + name; channels.push(channel)
    ipcMain.handle(channel, async (event, ...args) => {
      assertSource(event)
      try { return await action(...args) }
      catch (error) {
        const key = getApi()?.apiKey
        const message = typeof error?.message === 'string' ? error.message : '简历检查未完成'
        throw new Error(key ? message.split(key).join('[已隐藏]') : message)
      }
    })
  }
  function createView() {
    if (view) return
    const child = new WebContentsView({ webPreferences: { preload: join(directory, 'resume-clinic/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: false, partition: 'persist:aipm-resume-clinic' } })
    view = child
    const contents = child.webContents, session = contents.session
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    session.setPermissionCheckHandler(() => false)
    session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      let allow = false
      try {
        const url = new URL(details.url)
        if (url.protocol === 'file:') { const path = relative(dist, fileURLToPath(url)); allow = path !== '..' && !path.startsWith('../') && !path.startsWith('..\\') && !path.startsWith('/') }
        else allow = ['data:', 'blob:', 'about:'].includes(url.protocol)
      } catch (error) { /* Invalid resource URLs remain blocked. */ }
      callback({ cancel: !allow })
    })
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const contain = (event, next) => { if (!localPage(next)) event.preventDefault() }
    contents.on('will-navigate', contain); contents.on('will-redirect', contain)
    contents.on('will-attach-webview', event => event.preventDefault())
    contents.on('destroyed', () => {
      if (view !== child) return
      ++revision; attachedTo = null; view = null; loaded = false; load = null
      for (const request of pending) request.controller.abort(new Error('简历检查页面已关闭'))
    })
  }
  async function show(value) {
    if (closed) throw new Error('简历检查已关闭')
    const next = ++revision, area = bounds(value); createView(); const current = view
    if (!loaded) {
      if (!load) load = Promise.resolve().then(() => current.webContents.loadFile(entry)).then(() => { if (view === current) loaded = true }).catch(error => { if (view === current) load = null; throw error })
      try { await load }
      catch (error) { if (closed || next !== revision) return false; throw error }
    }
    const parent = window()
    if (closed || next !== revision || current !== view || !parent || parent.isDestroyed()) return false
    if (attachedTo && attachedTo !== parent) detach()
    current.setBounds(area)
    if (!attachedTo) { parent.contentView.addChildView(current); attachedTo = parent }
    return true
  }
  function hide() { ++revision; detach(); return true }
  function resize(value) { if (closed) return false; const area = bounds(value); if (view && attachedTo) view.setBounds(area); return true }
  function publishModel(value) {
    if (closed || !view || view.webContents.isDestroyed()) return
    try { view.webContents.send(prefix + 'model-update', publicStatus(value)) }
    catch (error) { console.error('简历检查模型状态通知未送达') }
  }
  bind('status', async () => publicStatus(await modelStatus()))
  bind('select-model', async id => {
    const status = publicStatus(await modelStatus())
    if (typeof id !== 'string' || !status.choices.some(choice => choice.id === id)) throw new Error('请选择工作台支持的模型')
    return publicStatus(await selectModel(id))
  })
  bind('open-link', async value => { await shell.openExternal(externalLink(value)); return true })
  bind('complete', payload => {
    const input = completionInput(payload)
    if (pending.size >= 2) throw new Error('已有简历检查正在执行，请等待当前请求完成')
    const config = { ...getApi() }, controller = new AbortController(), request = { controller, promise: null }
    const timer = setTimeout(() => controller.abort(new Error('简历检查等待模型超时，请重试')), requestTimeoutMs)
    request.promise = (async () => {
      const requestFetcher = (url, options) => {
        const body = JSON.parse(options.body)
        if (input.temperature !== undefined) body.temperature = input.temperature
        return fetcher(url, { ...options, body: JSON.stringify(body) })
      }
      const result = await completeWithSharedApi(config, input.messages, { signal: controller.signal, maxTokens: input.maxTokens, fetcher: requestFetcher })
      if (controller.signal.aborted || closed) throw new Error('简历检查已停止')
      if (input.json) { let output; try { output = JSON.parse(result.text) } catch (error) { throw new Error('模型未返回有效 JSON，请重试；原简历已保留') }; if (!record(output)) throw new Error('模型返回的 JSON 对象无效，请重试') }
      return { id: 'resume-clinic-' + randomUUID(), object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: config.model, choices: [{ index: 0, message: { role: 'assistant', content: result.text }, finish_reason: 'stop' }], usage: safeUsage(result.usage) }
    })()
    pending.add(request)
    const cleanup = () => { clearTimeout(timer); pending.delete(request) }
    void request.promise.then(cleanup, cleanup)
    return request.promise
  })
  bind('export-pdf', payload => {
    const html = printingHtml(payload)
    if (!BrowserWindow || !dialog?.showSaveDialog) throw new Error('当前环境尚未配置 PDF 保存功能')
    if (exports.size) throw new Error('已有 PDF 正在导出，请先完成保存')
    const print = new BrowserWindow({ show: false, width: 900, height: 1200, parent: window(), title: '保存简历 PDF', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, webSecurity: true, webviewTag: false, partition: 'resume-clinic-print-' + randomUUID() } })
    const job = { view: print, promise: null, cancelled: false }, contents = print.webContents, session = contents.session
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false)); session.setPermissionCheckHandler(() => false)
    session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => callback({ cancel: !details.url.startsWith('data:') }))
    contents.setWindowOpenHandler(() => ({ action: 'deny' })); contents.on('will-navigate', event => event.preventDefault()); contents.on('will-redirect', event => event.preventDefault())
    const cancelled = () => job.cancelled || closed || print.isDestroyed()
    job.promise = (async () => {
      await contents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      if (cancelled()) return { saved: false }
      const pdf = await contents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } })
      if (cancelled()) return { saved: false }
      const chosen = await dialog.showSaveDialog(print, { title: '保存简历 PDF', defaultPath: 'AI产品经理简历.pdf', filters: [{ name: 'PDF 文件', extensions: ['pdf'] }], properties: ['createDirectory', 'showOverwriteConfirmation'] })
      if (cancelled() || chosen.canceled || !chosen.filePath) return { saved: false }
      await writeFile(chosen.filePath, pdf, { mode: 0o600 })
      return { saved: true }
    })().catch(error => { if (cancelled()) return { saved: false }; throw error }).finally(() => { if (!print.isDestroyed()) print.destroy(); exports.delete(job) })
    exports.add(job)
    return job.promise
  })
  async function close() {
    if (shutdown) return shutdown
    closed = true; ++revision
    for (const channel of channels) ipcMain.removeHandler(channel)
    detach()
    const requests = [...pending], printing = [...exports], loading = load
    for (const job of printing) { job.cancelled = true; if (!job.view.isDestroyed()) job.view.destroy() }
    for (const request of requests) request.controller.abort(new Error('工作台已关闭简历检查'))
    if (view && !view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false })
    shutdown = Promise.allSettled([...requests.map(request => request.promise), ...printing.map(job => job.promise), ...(loading ? [loading] : [])]).then(() => { view = null; load = null })
    return shutdown
  }
  return { show, hide, resize, publishModel, close }
}
