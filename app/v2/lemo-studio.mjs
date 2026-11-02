/** Lemo projects prepare local animation work and continue in the shared Pi conversation. */
import { renderMarkdown } from '../assets/document-format.js'

const MODES = { library: '使用风格库', customize: '在风格上定制', blank: '自由创作', saved: '使用自定义风格' }
const OPERATIONS = { subtitles: '生成字幕', audio: '制作音频', asr: '核对语音', stills: '检查静帧', render: '渲染画面', events: '导出事件', readcheck: '检查可读性', mux: '合成音画', voice: '生成旁白音频' }
const JOBS = { queued: '等待执行', running: '正在执行', completed: '执行完成', succeeded: '执行完成', done: '执行完成', failed: '执行失败', cancelled: '已停止', interrupted: '上次执行已中断' }
const active = job => ['queued', 'running'].includes(job?.status)
const errorText = error => error?.message || (typeof error === 'string' ? error : '操作未完成，请重试。')
const signature = value => JSON.stringify(value)
const emptyDraft = () => ({ title: '', brief: '', duration: 10, style: '', mode: 'library', width: 1920, height: 1080, fps: 30 })
const defaults = { stills: { times: [0, 2, 5, 8, 9.5] }, render: { workers: 2 }, events: {}, readcheck: {}, mux: { video: 'jobs/渲染任务/video.mp4', audio: 'audio/mix.wav', grain: 0 }, voice: { lines: 'lines.json', provider: 'kokoro' }, subtitles: { cues: [{ t0: 0, t1: 3, text: '你好' }] }, audio: { cues: [{ t: 0, type: 'ding', gain: .15 }, { t: 1, type: 'tone', gain: .1 }] }, asr: { lines: 'lines.json', voices: 'jobs/配音任务/voices', lang: 'zh' } }

/**
 * Mount local production controls; preparing and opening a chat never send a model request.
 * @param {{container:HTMLElement,api:Function,events?:object,toast?:Function,openChat?:Function}} options Host operations and the shared chat navigation callback.
 * @returns {{show:Function,hide:Function,open:Function,canLeave:Function,dispose:Function}} Stable tab lifecycle and saved-project navigation.
 */
export function mountLemoStudio({ container, api, events = {}, toast = () => {}, openChat = () => false }) {
  const doc = container.ownerDocument
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n }
  const state = { visible: false, disposed: false, initialized: false, loading: false, revision: 0, initRevision: 0, outputRevision: 0, readRevision: 0, updateStamp: 0, project: null, projects: [], styles: [], info: null, error: '', listError: '', busy: new Set(), job: null, output: null, document: null, query: '', category: '', styleLimit: 12 }
  const draft = emptyDraft(), advanced = new Map(), styleDraft = { name: '', content: '' }
  let initialization
  const jobValue = value => value?.currentJob || value?.job || (Array.isArray(value?.jobs) ? value.jobs.at(-1) : value)
  const operationList = () => Array.isArray(state.info?.operations) && state.info.operations.length ? state.info.operations.map(value => typeof value === 'string' ? [value, OPERATIONS[value] || value] : [value.id, value.name || OPERATIONS[value.id] || value.id]).filter(([id]) => typeof id === 'string') : Object.entries(OPERATIONS).filter(([id]) => !['subtitles', 'audio', 'asr'].includes(id))
  const root = el('section', 'lemo-studio'), sidebar = el('aside', 'ls-sidebar'), body = el('main', 'ls-body')
  root.hidden = true; root.setAttribute('aria-label', 'Lemo Studio'); sidebar.setAttribute('aria-label', 'Lemo 工程'); root.append(sidebar, body); container.append(root)
  const valid = (revision, id) => !state.disposed && revision === state.revision && (state.project?.id || null) === (id || null)
  const guard = action => async event => { try { await action(event) } catch (error) { if (!state.disposed) { state.error = errorText(error); render(); toast(state.error) } } }
  const button = (label, action, cls = 'v2-tool-button') => { const n = el('button', cls, label); n.type = 'button'; n.onclick = guard(action); return n }
  const note = text => el('p', 'ls-note', text)
  const row = (...nodes) => { const n = el('div', 'ls-actions'); n.append(...nodes); return n }
  function details(label, key, ...nodes) { const n = el('details', 'ls-details'); n.dataset.lemoDetails = key; n.append(el('summary', '', label), ...nodes); return n }
  function field(label, value, change, { area = false, type = 'text', key = label, min, max, step } = {}) {
    const labelNode = el('label', 'ls-field', label), input = el(area ? 'textarea' : 'input', 'v2-tool-input'); input.setAttribute('aria-label', label); input.dataset.lemoField = key; input.value = value ?? ''
    if (area) input.rows = 4; else input.type = type
    if (min !== undefined) input.min = min; if (max !== undefined) input.max = max; if (step !== undefined) input.step = step
    input.oninput = () => change(input.value); labelNode.append(input); return { row: labelNode, input }
  }
  function select(label, values, value, change) {
    const labelNode = el('label', 'ls-field', label), input = el('select', 'v2-tool-input'); input.setAttribute('aria-label', label); input.dataset.lemoField = label
    for (const [id, text] of values) { const option = el('option', '', text); option.value = id; input.append(option) } input.value = value; input.onchange = () => change(input.value); labelNode.append(input); return labelNode
  }
  function upsert(project) { if (!project?.id) return; const index = state.projects.findIndex(p => p.id === project.id); if (index < 0) state.projects.unshift(project); else state.projects[index] = { ...state.projects[index], ...project } }
  function render() {
    if (state.disposed) return
    const current = body.contains(doc.activeElement) ? doc.activeElement : null, key = current?.dataset.lemoField, range = typeof current?.selectionStart === 'number' ? [current.selectionStart, current.selectionEnd] : null
    const scroll = body.scrollTop, opens = [...body.querySelectorAll('details[open]')].map(n => n.dataset.lemoDetails)
    sidebar.replaceChildren(el('div', 'ls-side-heading', 'Lemo 工程'), button('＋ 新建动效', () => { ++state.revision; ++state.outputRevision; state.project = null; state.job = null; state.output = null; state.error = ''; render() }, 'v2-tool-button ls-new'))
    if (state.listError) sidebar.append(note(state.listError), button('重新读取', refreshProjects))
    for (const project of state.projects) { const n = button('', () => chooseProject(project.id), 'ls-project'); n.setAttribute('aria-current', String(project.id === state.project?.id)); n.append(el('strong', '', project.title || '未命名动效'), el('small', '', `${project.duration || '—'} 秒 · ${styleName(project.style)}`)); sidebar.append(n) }
    if (!state.projects.length && !state.listError) sidebar.append(note('建立后，可以从这里继续制作。'))
    body.replaceChildren()
    if (state.error) { const n = el('p', 'ls-error', state.error); n.setAttribute('role', 'alert'); body.append(n) }
    if (state.loading) body.append(note('正在读取本机资料…'))
    if (state.info?.runtime?.ready === false) body.append(note('本机运行环境尚未就绪：' + (state.info.runtime.messages || state.info.messages || []).join('；')))
    if (state.info?.sourceReady === false) body.append(note('本机制作资料尚未就绪，请检查来源与安装状态。'))
    if (state.project) renderProject(); else renderCreate()
    renderLibrary()
    for (const n of body.querySelectorAll('details')) if (opens.includes(n.dataset.lemoDetails)) n.open = true
    if (key) { const next = [...body.querySelectorAll('[data-lemo-field]')].find(n => n.dataset.lemoField === key); if (next) { next.focus({ preventScroll: true }); if (range && typeof next.setSelectionRange === 'function') next.setSelectionRange(...range) } }
    body.scrollTop = scroll
  }
  function styleName(id) { const style = state.styles.find(s => s.id === id); return style?.nameZh || style?.name || id || '自由风格' }
  function renderCreate() {
    body.append(el('h1', 'ls-title', '用一句话，开始一支动效'), note('选一个风格建立工程，再在主聊天里编写和修改动画。静帧检查、渲染与音画合成都在本机进行。'))
    const form = el('form', 'ls-create'); form.dataset.modelComposer = ''
    const title = field('动效名称', draft.title, value => { draft.title = value }), brief = field('描述你想做的动效', draft.brief, value => { draft.brief = value }, { area: true }); brief.input.placeholder = '例如：用米白底、黑色大字和荧光黄，做一支 10 秒的 AIPM 工作台介绍。'
    title.input.maxLength = 100; brief.input.required = true; brief.input.maxLength = 20000; title.input.placeholder = '留空会按创作需求命名'
    const settings = el('div', 'ls-grid'); settings.append(field('动效时长（秒）', draft.duration, value => { draft.duration = Number(value) }, { type: 'number', min: 1, max: 3600 }).row, select('创作方式', Object.entries(MODES), draft.mode, value => { draft.mode = value; state.query = ''; state.category = ''; state.styleLimit = 12; if (value === 'blank') draft.style = ''; else if (value === 'saved' && !draft.style.startsWith('custom:')) draft.style = state.styles.find(style => style.id.startsWith('custom:'))?.id || ''; else if (value !== 'saved' && (!draft.style || draft.style.startsWith('custom:'))) draft.style = state.styles.find(style => !style.id.startsWith('custom:'))?.id || ''; render() }))
    const advancedSettings = details('画面规格', 'format', field('画面宽度', draft.width, value => { draft.width = Number(value) }, { type: 'number', min: 16, max: 8192, step: 2 }).row, field('画面高度', draft.height, value => { draft.height = Number(value) }, { type: 'number', min: 16, max: 8192, step: 2 }).row, field('每秒帧数', draft.fps, value => { draft.fps = Number(value) }, { type: 'number', min: 1, max: 120 }).row)
    const create = el('button', 'v2-tool-button primary', state.busy.has('prepare') ? '正在建立工程…' : '建立工程并打开聊天'); create.type = 'submit'; create.disabled = state.busy.has('prepare') || state.loading || state.info?.sourceReady === false || draft.mode === 'saved' && !draft.style
    form.append(title.row, brief.row, settings, note(`当前风格：${styleName(draft.style)}。可以在下面搜索或更换。`), advancedSettings, note('建立工程不调用模型；在主聊天发送后使用统一 API 计费，独立于原 5 元视频试做额度。'), row(create, button('清空草稿', () => { Object.assign(draft, emptyDraft()); state.error = ''; render() })))
    form.onsubmit = guard(async event => { event.preventDefault(); await prepare() }); body.append(form); if (draft.mode !== 'blank') renderStyles()
  }
  function renderStyles() {
    const section = el('section', 'ls-styles'), heading = el('div', 'ls-section-heading'); heading.append(el('h2', '', '选择风格'), note(`${state.styles.length} 种本机可用风格`)); section.append(heading)
    const filters = el('div', 'ls-style-filters'), list = el('div', 'ls-style-list'), query = field('搜索动效风格', state.query, value => { state.query = value; state.styleLimit = 12; paint() }, { type: 'search' })
    const eligible = state.styles.filter(style => draft.mode === 'saved' ? style.id.startsWith('custom:') : !style.id.startsWith('custom:'))
    const categories = [...new Set(eligible.map(s => s.category).filter(Boolean))].sort(); filters.append(query.row, select('风格分类', [['', '全部分类'], ...categories.map(category => [category, category])], state.category, value => { state.category = value; state.styleLimit = 12; paint() })); section.append(filters, list); body.append(section)
    function paint() {
      const q = state.query.trim().toLowerCase(), styles = eligible.filter(s => (!state.category || s.category === state.category) && (!q || [s.id, s.name, s.nameZh, s.description].filter(Boolean).join(' ').toLowerCase().includes(q)))
      list.replaceChildren()
      for (const style of styles.slice(0, state.styleLimit)) { const card = el('article', 'ls-style'), choose = button(style.nameZh || style.name || style.id, () => { draft.style = style.id; render() }, 'ls-style-choice'); choose.setAttribute('aria-pressed', String(style.id === draft.style)); card.append(choose, note(style.description || style.name || style.id), button('阅读风格说明', () => read(style.stylePath || `styles/${style.id}/STYLE.md`), 'v2-tool-button ls-subtle')); if (style.galleryUrl) card.append(button('查看风格预览', () => api('openLink', style.galleryUrl), 'v2-tool-button ls-subtle')); list.append(card) }
      if (styles.length > state.styleLimit) list.append(button(`展开更多（还有 ${styles.length - state.styleLimit} 种）`, () => { state.styleLimit += 12; paint() }))
      if (!styles.length) list.append(note(state.loading ? '正在读取风格库…' : draft.mode === 'saved' && !eligible.length ? '还没有自定义风格。可在下方保存你核对过的风格方法。' : '没有符合条件的风格。'))
    }
    paint()
  }
  async function prepare() {
    if (state.busy.has('prepare')) return
    if (!draft.brief.trim()) throw new Error('先描述你想做的动效。')
    if (draft.brief.length > 20000) throw new Error('创作需求最多 20000 字，请保留核心要求。')
    if (!Number.isFinite(draft.duration) || draft.duration < 1 || draft.duration > 3600) throw new Error('时长请填写 1–3600 秒。')
    if ([draft.width, draft.height].some(value => !Number.isInteger(value) || value < 16 || value > 8192 || value % 2 !== 0)) throw new Error('画面宽高请填写 16–8192 之间的偶数。')
    if (!Number.isFinite(draft.fps) || draft.fps < 1 || draft.fps > 120) throw new Error('帧数请填写 1–120。')
    const input = { ...draft, title: draft.title.trim() || draft.brief.trim().slice(0, 30), brief: draft.brief.trim() }, before = signature(draft), revision = state.revision
    state.busy.add('prepare'); state.error = ''; render()
    try {
      const project = await api('lemoPrepare', input); if (!project?.id) throw new Error('工程没有建立成功，请检查后重试。')
      if (state.disposed) return
      upsert(project)
      if (signature(draft) === before) Object.assign(draft, emptyDraft())
      if (revision !== state.revision || !state.visible) return
      ++state.revision; state.project = project; state.job = null; state.output = null; state.busy.delete('prepare'); render()
      if (project.chatId && typeof project.chatId === 'string') await openChat(project.chatId, project.prompt || '')
      else toast('工程已建立，可以打开聊天继续。')
    } finally { state.busy.delete('prepare'); if (!state.disposed) render() }
  }
  function renderProject() {
    const project = state.project, id = project.id
    body.append(el('h1', 'ls-title', project.title || '未命名动效'), note(`${project.duration || '—'} 秒 · ${project.width || '—'} × ${project.height || '—'} · ${project.fps || '—'} fps · ${styleName(project.style)}`))
    const chat = button('打开制作聊天', async () => {
      if (state.busy.has('chat')) return; const revision = state.revision; state.busy.add('chat'); render()
      try { const saved = await api('lemoOpenChat', id); if (!valid(revision, id) || !state.visible) return; if (!saved?.chatId) throw new Error('没有取得制作聊天，请重试。'); state.project = saved; upsert(saved); await openChat(saved.chatId, saved.prompt || '') } finally { state.busy.delete('chat'); render() }
    }, 'v2-tool-button primary'); chat.disabled = state.busy.has('chat')
    body.append(row(chat, button('刷新工程与产物', () => chooseProject(id)), button('打开工程文件夹', () => api('lemoOpenFolder', id))), note('制作聊天与工作台共用模型和 API；本页本地工具不会自动发送模型请求。先核对静帧和文字，再检查完整影片。'))
    if (project.brief) body.append(details('创作需求', 'brief', note(project.brief)))
    renderOutput(); renderJob(); renderTools()
    body.append(details('工程信息', 'paths', note(project.cwd || '工程目录尚未返回'), button('复制工程目录', () => api('copyText', project.cwd || ''))))
  }
  function renderOutput() {
    const section = el('section', 'ls-output'); section.append(el('h2', '', '本机产物'))
    const output = state.output, video = output?.lastVideo
    if (video?.path) { const preview = el('div', 'ls-ready'); preview.append(el('strong', '', '本机视频可以预览'), note(`${video.duration || '—'} 秒 · ${video.width || '—'} × ${video.height || '—'} · ${video.fps || state.project.fps || '—'} fps${video.audio === false ? ' · 无音轨' : ''}`), row(button('预览成片', () => api('lemoPreview', state.project.id), 'v2-tool-button primary'), button('导出成片与工程', async () => { const saved = await api('lemoExport', state.project.id); if (saved?.folder) toast('已导出到你选择的文件夹。') })), note('文件与规格检查不代表已经完成人工画面验收。')); section.append(preview) }
    else section.append(note(output ? '尚未取得可预览的本机成片。可以先在制作聊天里完成代码，再运行静帧与渲染。' : '点击“刷新工程与产物”检查本机是否已有成片。'))
    if (output?.files?.length) { const files = details(`查看产物文件（${output.files.length}）`, 'files'); for (const file of output.files) files.append(row(el('span', '', `${file.name || '未命名文件'}${file.kind ? ` · ${file.kind}` : ''}`), button('复制路径', () => api('copyText', file.path || '')))); section.append(files) }
    body.append(section)
  }
  function renderJob() {
    const job = state.job
    if (!job) return
    const section = el('section', 'ls-job'); section.setAttribute('aria-live', 'polite'); section.append(el('strong', '', JOBS[job.status] || job.status || '任务状态待确认'))
    if (job.operation) section.append(note(OPERATIONS[job.operation] || job.operation))
    if (job.message || job.progress?.message || job.error) section.append(note(job.message || job.progress?.message || job.error))
    const ratio = job.progress?.ratio ?? (typeof job.progress === 'number' ? job.progress : undefined)
    if (Number.isFinite(ratio)) { const progress = el('progress'); progress.max = 1; progress.value = Math.max(0, Math.min(1, ratio)); section.append(progress) }
    if (job.log || job.output || job.stderr || job.stdout) section.append(details('任务记录', 'job-log', el('pre', 'ls-code', String(job.log || job.output || job.stderr || job.stdout).slice(-18000))))
    if (active(job)) section.append(button('停止本地任务', async () => { const id = state.project.id, revision = state.revision, result = await api('lemoCancel', id); if (valid(revision, id)) { state.job = jobValue(result) || { ...job, status: 'cancelled' }; render() } }))
    body.append(section)
  }
  function renderTools() {
    const project = state.project
    let values = advanced.get(project.id)
    if (!values) { values = { operation: 'stills', parameters: JSON.stringify(defaults.stills, null, 2), dirty: false, saved: {} }; advanced.set(project.id, values) }
    const tools = details('本地制作工具', 'tools', note('执行当前工程中的动画代码。生成配音、音频和素材的具体能力以本机运行环境为准。'))
    const consentLabel = el('label', 'ls-consent'), consent = el('input'); consent.type = 'checkbox'; consent.checked = project.onlineVoiceConsent === true; consent.setAttribute('aria-label', '允许本工程使用 Edge 在线配音'); consent.dataset.lemoField = 'Edge 在线配音授权'; consent.disabled = state.busy.has('voice-consent:' + project.id)
    consent.onchange = guard(async () => { const id = project.id, approved = consent.checked, revision = state.revision, key = 'voice-consent:' + id; if (state.busy.has(key)) return; state.busy.add(key); render(); try { await api('lemoVoiceConsent', id, approved); const saved = await api('lemoGet', id); if (valid(revision, id)) { state.project = saved; upsert(saved) } } finally { state.busy.delete(key); render() } })
    consentLabel.append(consent, el('span', '', '允许本工程使用 Edge 在线配音：会将旁白文本发送给微软。仅本次应用运行有效，可随时取消。')); tools.append(consentLabel, note('默认使用 Kokoro 离线配音。在线授权本身不会发起配音；执行 voice 时仍需设置 provider 为 edge。'))
    tools.append(select('本地操作', operationList(), values.operation, value => { values.saved[values.operation] = { parameters: values.parameters, dirty: values.dirty }; values.operation = value; values.parameters = values.saved[value]?.parameters ?? JSON.stringify(state.info?.operationExamples?.[value] || defaults[value] || {}, null, 2); values.dirty = values.saved[value]?.dirty || false; render() }))
    const params = field('本地操作参数（JSON）', values.parameters, value => { values.parameters = value; values.dirty = true }, { area: true }); params.input.rows = 5
    const run = button(active(state.job) || state.busy.has('run') ? '本地任务执行中…' : '执行本地操作', async () => {
      if (active(state.job) || state.busy.has('run')) return
      let parsed; try { parsed = JSON.parse(values.parameters) } catch (error) { throw new Error('参数必须是有效的 JSON 对象。') }
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('参数必须是 JSON 对象。')
      const id = project.id, revision = state.revision, stamp = state.updateStamp, operation = values.operation, parameters = values.parameters; state.busy.add('run'); render()
      try { const job = await api('lemoRun', id, { ...parsed, operation }); if (values.operation === operation && values.parameters === parameters) values.dirty = false; if (values.saved[operation]?.parameters === parameters) values.saved[operation].dirty = false; if (valid(revision, id) && stamp === state.updateStamp) state.job = jobValue(job) } finally { state.busy.delete('run'); render() }
    }, 'v2-tool-button primary'); run.disabled = active(state.job) || state.busy.has('run')
    tools.append(params.row, row(run, button('恢复参数示例', () => { values.parameters = JSON.stringify(state.info?.operationExamples?.[values.operation] || defaults[values.operation], null, 2); values.dirty = false; values.saved[values.operation] = { parameters: values.parameters, dirty: false }; render() }))); body.append(tools)
  }
  function renderLibrary() {
    const library = details('完整方法与自定义风格', 'library', note('按需阅读原版方法与风格说明，不会自动开始制作。'))
    const docs = Array.isArray(state.info?.resources) ? state.info.resources.filter(item => typeof item.path === 'string').map(item => [item.path, item.title || item.path]) : []
    library.append(row(...docs.map(([name, label]) => button(label, () => read(name))), button('重新检查本机环境', async () => { state.initialized = false; await initialize() })))
    if (!docs.length) library.append(note('完整资料目录将在本机信息读取后显示。'))
    if (state.document) { const article = el('article', 'markdown-content ls-document'); article.innerHTML = renderMarkdown(state.document.content || ''); const header = row(el('strong', '', state.document.name || '资料'), button('收起正文', () => { ++state.readRevision; state.document = null; render() })); library.append(header, article) }
    const custom = details('人工保存全局自定义风格', 'custom-style', note('保存你核对过的风格方法，后续工程可以选择“使用自定义风格”。保存本身不调用模型。'))
    custom.append(field('自定义风格名称', styleDraft.name, value => { styleDraft.name = value }).row, field('自定义风格内容（Markdown）', styleDraft.content, value => { styleDraft.content = value }, { area: true }).row)
    const save = button(state.busy.has('style') ? '正在保存…' : '保存自定义风格', () => saveStyle(false)); save.disabled = state.busy.has('style')
    const fromProject = button('从当前工程保存风格与演示', () => saveStyle(true)); fromProject.disabled = state.busy.has('style') || !state.project?.id
    custom.append(row(save, fromProject, button('清空风格草稿', () => { Object.assign(styleDraft, { name: '', content: '' }); render() })), note('从当前工程保存时，内容留空会读取工程的 STYLE.md，并保留演示源码和已生成视频。不会覆盖已有同名风格。')); library.append(custom); body.append(library)
    library.onclick = event => { const link = event.target.closest?.('a'); if (link) { event.preventDefault(); void api('openLink', link.href).catch(error => toast(errorText(error))) } }
  }
  async function saveStyle(fromProject) {
    if (state.busy.has('style')) return
    if (!styleDraft.name.trim() || (!styleDraft.content.trim() && !fromProject)) throw new Error('请填写风格名称和内容，或从当前工程保存。')
    if (fromProject && !state.project?.id) throw new Error('请先选择一个工程。')
    const snapshot = signature(styleDraft), input = { name: styleDraft.name.trim(), overwrite: false, ...(styleDraft.content.trim() ? { content: styleDraft.content } : {}), ...(fromProject ? { projectId: state.project.id } : {}) }
    state.busy.add('style'); render()
    try { await api('lemoSaveStyle', input); if (signature(styleDraft) === snapshot) Object.assign(styleDraft, { name: '', content: '' }); const styles = await api('lemoStyles'); if (!state.disposed) state.styles = Array.isArray(styles) ? styles : []; toast('已保存全局自定义风格。') } finally { state.busy.delete('style'); render() }
  }
  async function read(name) {
    const request = ++state.readRevision
    let file
    try { file = await api('lemoRead', { path: name }) } catch (error) { if (!state.disposed && request === state.readRevision) throw error; return }
    if (state.disposed || request !== state.readRevision) return
    state.document = typeof file === 'string' ? { name, content: file } : { name: file.path || name, content: file.text ?? file.content ?? '' }
    render(); const library = body.querySelector('[data-lemo-details="library"]'); if (library) library.open = true
  }
  async function refreshProjects() { try { const projects = await api('lemoList'); if (!state.disposed) { state.projects = Array.isArray(projects) ? projects : []; state.listError = ''; render() } } catch (error) { if (!state.disposed) { state.listError = errorText(error); render() } } }
  async function chooseProject(id) {
    const revision = ++state.revision, stamp = state.updateStamp; ++state.outputRevision; state.project = { id }; state.job = null; state.output = null; state.document = null; ++state.readRevision; state.error = ''; render()
    try {
      const project = await api('lemoGet', id); if (!valid(revision, id)) return
      if (stamp === state.updateStamp || !state.project.title) { state.project = project; upsert(project) }; render()
      const request = ++state.outputRevision, jobStamp = state.updateStamp, results = await Promise.allSettled([api('lemoOutput', id), api('lemoJob', id)])
      if (!valid(revision, id) || request !== state.outputRevision) return
      if (results[0].status === 'fulfilled') state.output = results[0].value
      else state.error = errorText(results[0].reason)
      if (results[1].status === 'fulfilled' && jobStamp === state.updateStamp && jobValue(results[1].value)) state.job = jobValue(results[1].value)
      else if (results[1].status === 'rejected') toast(errorText(results[1].reason))
      render()
    } catch (error) { if (valid(revision, id)) { state.project = null; state.error = errorText(error); render(); toast(state.error) } }
  }
  async function initialize() {
    if (state.initialized || state.disposed) return
    if (initialization) return initialization
    initialization = (async () => {
    const request = ++state.initRevision; state.loading = true; render()
    const results = await Promise.allSettled([api('lemoInfo'), api('lemoStyles'), api('lemoList')])
    if (state.disposed || request !== state.initRevision) return
    state.loading = false; state.initialized = true
    if (results[0].status === 'fulfilled') state.info = results[0].value
    if (results[1].status === 'fulfilled') { state.styles = Array.isArray(results[1].value) ? results[1].value : []; if (!draft.style) draft.style = state.styles.find(style => !style.id.startsWith('custom:'))?.id || '' } else state.error = errorText(results[1].reason)
    if (results[2].status === 'fulfilled') state.projects = Array.isArray(results[2].value) ? results[2].value : []; else state.listError = errorText(results[2].reason)
    if (results[0].status === 'rejected') toast(errorText(results[0].reason))
    render()
    })()
    try { return await initialization } finally { initialization = null }
  }
  const unsubscribe = typeof events.onLemoUpdate === 'function' ? events.onLemoUpdate(value => {
    if (state.disposed) return
    const projectId = value?.projectId || value?.project?.id || (Array.isArray(value?.jobs) ? value.id : null)
    const snapshot = value?.project || (Array.isArray(value?.jobs) ? value : null)
    if (snapshot) upsert(snapshot)
    if (!projectId || state.project?.id !== projectId) return
    ++state.updateStamp
    const job = value.currentJob || value.job || value.jobs?.at(-1) || (value.status ? value : null); if (job) state.job = job
    if (snapshot) state.project = { ...state.project, ...snapshot }
    render()
    if (job && !active(job)) { const revision = state.revision, request = ++state.outputRevision; void api('lemoOutput', projectId).then(output => { if (valid(revision, projectId) && request === state.outputRevision) { state.output = output; render() } }).catch(error => { if (valid(revision, projectId)) { state.error = errorText(error); render() } }) }
  }) : null
  return {
    async show() { if (state.disposed) return; state.visible = true; root.hidden = false; await initialize() },
    hide() { state.visible = false; root.hidden = true },
    async open(id) { if (state.disposed) return; state.visible = true; root.hidden = false; await initialize(); if (!state.disposed && id) await chooseProject(id) },
    canLeave() {
      if (state.busy.has('prepare') || state.busy.has('style')) { toast('正在保存本机工程或风格，请稍候。'); return false }
      if (draft.title.trim() || draft.brief.trim() || styleDraft.name.trim() || styleDraft.content.trim() || [...advanced.values()].some(value => value.dirty || Object.values(value.saved || {}).some(item => item.dirty))) { toast('Lemo 中还有未保存的草稿。请先建立工程、保存或清空。'); return false }
      return true
    },
    dispose() { if (state.disposed) return; state.disposed = true; ++state.revision; ++state.initRevision; ++state.outputRevision; ++state.readRevision; if (typeof unsubscribe === 'function') unsubscribe(); root.remove() },
  }
}
