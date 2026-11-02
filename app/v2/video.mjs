/** One video workspace joins saved projects, the shared Pi conversation and real local output. */
import { renderMarkdown } from '../assets/document-format.js'

const STATUS = { needs_work: '需要继续完善', needs_sound: '等待声音完成', skipped: '等待继续', not_applicable: '不适用', idle: '可以开始', ready: '可以继续', running: '正在制作', waiting: '等待你确认', queued: '等待执行', generating: '正在创作', rendering: '正在生成画面', preparing: '正在准备', completed: '本轮已完成', failed: '需要处理', cancelled: '已停止', interrupted: '上次制作已中断', paused: '已暂停，可继续' }
const STEPS = { read: '读取资料', write: '保存制作文件', edit: '修改制作文件', bash: '运行本地工具', workbench: '处理项目', finish_video: '提交影片制作', render: '生成画面', stills: '检查静帧', events: '整理声音节奏', audio: '制作声音', voice: '制作旁白', subtitles: '整理字幕', mux: '合成影片', readcheck: '检查文字', asr: '核对旁白' }
const clone = value => JSON.parse(JSON.stringify(value))
const signature = value => JSON.stringify(value)
const errorText = error => error?.message || (typeof error === 'string' ? error : '操作未完成，请重试。')
const activeStatus = status => ['running', 'waiting', 'queued', 'generating', 'rendering', 'preparing'].includes(status)
const running = project => !!project && (activeStatus(project.status) || activeStatus(project.chat?.status) || activeStatus(project.production?.status))
const keyOf = version => version?.version || version?.id
const ready = version => !!version && version.ready !== false && version.validation?.state !== 'failed' && !!(version.videoPath || version.path)
const canonical = (id, source) => !id || id.includes(':') ? id : `${source || 'quick'}:${id}`
const labelTime = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
function audioTime(value) { const n = Math.max(0, Number(value) || 0), minutes = Math.floor(n / 60); return minutes + ':' + (n % 60).toFixed(2).padStart(5, '0') }
function audioSeconds(value) {
  const text = String(value).trim(), parts = text.split(':')
  if (!/^\d+(?:\.\d{1,3})?$/.test(parts.at(-1)) || parts.length > 2 || parts.length === 2 && (!/^\d+$/.test(parts[0]) || Number(parts[1]) >= 60)) throw new Error('时间请填写为 0:47.24，或直接填写秒数。')
  const seconds = parts.length === 2 ? Number(parts[0]) * 60 + Number(parts[1]) : Number(text)
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('歌曲时间无效。')
  return seconds
}

/**
 * Mount a unified video workspace without starting a model request.
 * @param {{container:HTMLElement,api:Function,events?:object,toast?:Function}} options Checked host operations and full project update events.
 * @returns {{open:Function,hide:Function,canLeave:Function,destroy:Function}} Stable navigation and cleanup controls.
 */
export function mountVideo({ container, api, events = {}, toast = () => {} }) {
  const doc = container.ownerDocument
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n }
  const state = { visible: false, disposed: false, project: null, projects: [], revision: 0, listRevision: 0, previewRevision: 0, readRevision: 0, stamp: 0, loading: false, error: '', listError: '', tab: 'film', version: '', exportKind: 'bundle', previewKey: '', displayedKey: '', previewError: '', previewLoading: false, read: null, readerLoading: false, collapseChat: false, intent: 'make', busy: new Set() }
  let filmControlKey = ''
  const newDraft = { title: '', brief: '', duration: 10, width: 1920, height: 1080, fps: 30, visualEngine: 'auto' }, drafts = new Map(), sceneDrafts = new Map(), initialIntents = new Map()
  const audioDrafts = new Map(); let audioPaneKey = '', audioPreviewRevision = 0, audioEnd = null
  const root = el('section', 'video-studio'), sidebar = el('aside', 'sv-sidebar'), work = el('main', 'sv-main'), heading = el('header', 'sv-header'), headingText = el('div'), title = el('h1', 'sv-title'), subtitle = el('p', 'sv-note'), topActions = el('div', 'sv-actions')
  const status = el('div', 'sv-status'), budgetStatus = el('p', 'sv-note sv-budget-status'), errors = el('p', 'sv-error'), layout = el('div', 'sv-layout'), chat = el('section', 'sv-chat'), output = el('section', 'sv-output')
  const createPane = el('section', 'sv-create-pane'), conversation = el('div', 'sv-messages'), execution = el('details', 'sv-execution'), approval = el('div'), composer = el('form', 'sv-composer'), composerInput = el('textarea', 'sv-chat-input'), composerActions = el('div', 'sv-composer-actions'), composerModel = el('span', 'sv-model')
  composerModel.dataset.modelComposer = ''; root.hidden = true; root.setAttribute('aria-label', '视频创作工作区'); sidebar.setAttribute('aria-label', '视频历史项目'); chat.setAttribute('aria-label', '制作对话记录'); output.setAttribute('aria-label', '视频作品区')
  conversation.setAttribute('aria-live', 'polite'); conversation.setAttribute('aria-relevant', 'additions text'); errors.setAttribute('role', 'alert'); status.setAttribute('role', 'status')
  const tabs = el('nav', 'sv-tabs'), tabButtons = new Map(), playerPane = el('section', 'sv-player-pane'), playerBox = el('div', 'sv-player-box'), video = el('video', 'sv-player'), emptyPlayer = el('div', 'sv-empty-player'), previewNotice = el('p', 'sv-note sv-preview-notice'), filmTools = el('div', 'sv-film-tools'), detailPane = el('section', 'sv-output-detail')
  video.controls = true; video.playsInline = true; video.preload = 'metadata'; video.setAttribute('aria-label', '本机视频预览'); video.hidden = true
  emptyPlayer.append(el('span', 'sv-play-mark', '▷'), el('strong', '', '成片会显示在这里'), el('p', '', '建立项目，发送制作要求后，在这里播放和检查实际生成的视频。'))
  playerBox.append(video, emptyPlayer); playerPane.append(playerBox, previewNotice, filmTools); output.append(tabs, playerPane, detailPane)
  const audioPane = el('details', 'sv-audio-pane'), audioPlayer = el('audio', 'sv-audio-player'); audioPlayer.controls = true; audioPlayer.preload = 'metadata'; audioPlayer.setAttribute('aria-label', '歌曲片段试听'); audioPlayer.hidden = true
  audioPlayer.ontimeupdate = () => { if (audioEnd !== null && audioPlayer.currentTime >= audioEnd) audioPlayer.pause() }
  video.addEventListener('play', () => audioPlayer.pause())
  headingText.append(title, subtitle); heading.append(headingText, topActions); chat.append(createPane, conversation, execution, approval, composer); layout.append(chat, output); work.append(heading, status, budgetStatus, errors, audioPane, layout); root.append(sidebar, work); container.append(root)
  const valid = (revision, id) => state.visible && !state.disposed && state.revision === revision && state.project?.id === id
  const guard = fn => async event => { try { await fn(event) } catch (error) { if (!state.disposed) { state.error = errorText(error); render(); toast(state.error) } } }
  const button = (text, action, cls = 'v2-tool-button') => { const n = el('button', cls, text); n.type = 'button'; n.onclick = guard(action); return n }
  const note = text => el('p', 'sv-note', text)
  const row = (...nodes) => { const n = el('div', 'sv-actions'); n.append(...nodes); return n }
  const markdown = text => { const n = el('div', 'markdown-content sv-markdown'); n.innerHTML = renderMarkdown(text || ''); return n }
  const currentDraft = () => drafts.get(state.project?.id) || ''
  const currentVersion = () => state.version ? state.project?.versions?.find(value => keyOf(value) === state.version) : state.project?.output?.lastVideo || [...(state.project?.versions || [])].reverse().find(ready)
  const readOnly = file => !['video', 'image', 'audio'].includes(file.kind)
  function field(label, value, change, { area = false, type = 'text', min, max, step } = {}) {
    const labelNode = el('label', 'sv-field', label), input = el(area ? 'textarea' : 'input', 'v2-tool-input'); input.value = value ?? ''; input.setAttribute('aria-label', label); input.dataset.videoField = label
    if (area) input.rows = 4; else input.type = type
    if (min !== undefined) input.min = min; if (max !== undefined) input.max = max; if (step !== undefined) input.step = step
    input.oninput = () => change(input.value); labelNode.append(input); return { node: labelNode, input }
  }
  function select(label, values, value, change) {
    const n = el('select', 'v2-tool-input'); n.setAttribute('aria-label', label); n.dataset.videoField = label
    for (const [key, label] of values) { const option = el('option', '', label); option.value = key; n.append(option) } n.value = value; n.onchange = () => change(n.value); return n
  }
  function details(label, ...nodes) { const n = el('details', 'sv-details'); n.append(el('summary', '', label), ...nodes); return n }
  function keepFocus(host, draw) {
    const current = host.contains(doc.activeElement) ? doc.activeElement : null, key = current?.dataset?.videoField, range = typeof current?.selectionStart === 'number' ? [current.selectionStart, current.selectionEnd] : null, scroll = host.scrollTop
    const opens = [...host.querySelectorAll('details[open]')].map(n => n.querySelector('summary')?.textContent)
    draw()
    for (const n of host.querySelectorAll('details')) if (opens.includes(n.querySelector('summary')?.textContent)) n.open = true
    if (key) { const next = [...host.querySelectorAll('[data-video-field]')].find(n => n.dataset.videoField === key); if (next) { next.focus({ preventScroll: true }); if (range && typeof next.setSelectionRange === 'function') next.setSelectionRange(...range) } } host.scrollTop = scroll
  }
  function normalized(project) { return project?.id ? { ...project, id: canonical(project.id, project.source) } : project }
  function upsert(project) {
    if (!project?.id) return
    const index = state.projects.findIndex(value => value.id === project.id)
    if (index < 0) state.projects.unshift(project)
    else if (!state.projects[index].updatedAt || !project.updatedAt || project.updatedAt >= state.projects[index].updatedAt) state.projects[index] = { ...state.projects[index], ...project }
  }
  function apply(project) {
    project = normalized(project); if (!project?.id) return
    upsert(project)
    if (project.id !== state.project?.id) return
    if (state.project.updatedAt && project.updatedAt && project.updatedAt < state.project.updatedAt) return
    state.project = { ...state.project, ...project }
  }
  function buildCreate() {
    createPane.append(el('h2', '', '想做一支什么视频？'), note('说清楚介绍什么、给谁看、希望什么感觉。对话、分镜、素材和每次成片都保存在同一个项目里。'))
    const form = el('form', 'sv-create-form'), name = field('视频名称', newDraft.title, value => { newDraft.title = value }), brief = field('视频制作要求', newDraft.brief, value => { newDraft.brief = value }, { area: true })
    name.input.maxLength = 100; name.input.placeholder = '可不填，按需求命名'; brief.input.required = true; brief.input.maxLength = 20000; brief.input.placeholder = '例如：做一支 10 秒的 AIPM 工作台介绍，用米白底、黑色大字和荧光黄，展示真实页面，节奏利落。'
    const seconds = field('视频时长（秒）', newDraft.duration, value => { newDraft.duration = Number(value) }, { type: 'number', min: 1, max: 3600 }), format = select('画面比例', [['landscape', '横屏 16:9'], ['portrait', '竖屏 9:16'], ['square', '方形 1:1']], 'landscape', value => { const sizes = { landscape: [1920, 1080], portrait: [1080, 1920], square: [1080, 1080] }; [newDraft.width, newDraft.height] = sizes[value]; width.input.value = newDraft.width; height.input.value = newDraft.height })
    const width = field('画面宽度', newDraft.width, value => { newDraft.width = Number(value) }, { type: 'number', min: 16, max: 8192, step: 2 }), height = field('画面高度', newDraft.height, value => { newDraft.height = Number(value) }, { type: 'number', min: 16, max: 8192, step: 2 }), fps = field('每秒帧数', newDraft.fps, value => { newDraft.fps = Number(value) }, { type: 'number', min: 1, max: 120 })
    const sizes = el('div', 'sv-settings-grid'); sizes.append(seconds.node, el('label', 'sv-field', '画面比例')); sizes.lastChild.append(format)
    const engine = el('label', 'sv-field', '画面风格'); engine.append(select('画面风格', [['auto', '按制作要求选择'], ['painted-animation', '水彩角色动画 · painted-animation'], ['lemo', '其他动效风格']], newDraft.visualEngine, value => { newDraft.visualEngine = value }))
    const custom = details('自定义规格', width.node, height.node, fps.node), settings = details('视频设置', sizes, engine, custom), controls = el('div', 'sv-composer-actions'), model = el('span', 'sv-model'); model.dataset.modelComposer = ''
    const create = el('button', 'v2-tool-button primary', '开始制作'); create.type = 'submit'; create.dataset.createVideo = ''; const music = button('先建音乐视频项目', () => createProject({ sendNow: false })); music.dataset.createMusic = ''; controls.append(model, music, create)
    form.append(name.node, brief.node, settings, note('点击开始制作后，使用工作台统一 API 计费。制作过程中可以继续修改或停止。'), controls); form.onsubmit = guard(async event => { event.preventDefault(); await createProject() }); createPane.append(form)
  }
  buildCreate()
  composerInput.rows = 3; composerInput.placeholder = '描述修改要求，也可以直接问它生成了什么…'; composerInput.setAttribute('aria-label', '视频制作对话'); composerInput.oninput = () => { if (state.project) drafts.set(state.project.id, composerInput.value); updateComposer() }
  composerInput.onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void guard(send)() } }
  const attach = button('＋ 素材', importAssets, 'sv-attach'), songAttach = button('♫ 歌曲', importAudio, 'sv-attach'), sendButton = el('button', 'sv-send', '↑'), stopButton = button('■', cancel, 'sv-stop')
  sendButton.type = 'submit'; sendButton.setAttribute('aria-label', '发送制作指令'); stopButton.setAttribute('aria-label', '停止视频制作')
  composer.onsubmit = guard(async event => { event.preventDefault(); await send() }); composerActions.append(attach, songAttach, composerModel, sendButton, stopButton); composer.append(composerInput, composerActions, note('Enter 发送 · Shift + Enter 换行'))
  for (const [key, label] of [['film', '成片'], ['storyboard', '分镜'], ['files', '素材与文件'], ['versions', '历史版本']]) { const n = button(label, () => { state.tab = key; renderOutput(); if (key !== 'film') pauseVideo() }, 'sv-tab'); n.setAttribute('role', 'tab'); tabButtons.set(key, n); tabs.append(n) } tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '视频作品内容')
  function updateComposer() {
    const p = state.project, busy = state.busy.has('send') || state.busy.has('import') || state.busy.has('save') || state.loading, active = running(p)
    sendButton.disabled = !p || busy || active || !currentDraft().trim(); sendButton.hidden = active; stopButton.hidden = !active; stopButton.disabled = state.busy.has('cancel')
    composerInput.disabled = !p || state.loading; attach.disabled = !p || state.busy.has('import')
    songAttach.disabled = !p || running(p) || state.busy.has('audio-import') || state.busy.has('audio-select')
    const create = createPane.querySelector('[data-create-video]'); if (create) { create.disabled = state.busy.has('create'); create.textContent = state.busy.has('create') ? '正在准备…' : '开始制作' }
    const music = createPane.querySelector('[data-create-music]'); if (music) music.disabled = state.busy.has('create')
  }
  function renderSidebar() {
    sidebar.replaceChildren(button('＋ 新建视频', newProject, 'v2-tool-button sv-new'), el('div', 'sv-side-label', '视频项目'))
    if (state.listError) sidebar.append(note(state.listError), button('重新读取', refreshList))
    for (const p of state.projects) { const n = button('', () => chooseProject(p.id), 'sv-project'); n.dataset.videoId = p.id; n.setAttribute('aria-current', String(p.id === state.project?.id)); n.append(el('strong', '', p.title || '未命名视频'), el('small', '', `${p.duration || '—'} 秒 · ${drafts.get(p.id)?.trim() || sceneDrafts.has(p.id) ? '有草稿' : STATUS[p.status] || '已保存'}`)); sidebar.append(n) }
    if (!state.projects.length && !state.listError) sidebar.append(note('建立后，所有视频和原有项目都会保存在这里。'))
  }
  function render() {
    if (state.disposed) return
    const p = state.project
    renderSidebar(); root.classList.toggle('sv-chat-collapsed', state.collapseChat && !!p); chat.hidden = state.collapseChat && !!p
    title.textContent = p?.title || '视频创作'; subtitle.textContent = p ? `${p.duration || '—'} 秒 · ${p.width || '—'} × ${p.height || '—'}${p.animationMethod?.name ? ` · ${p.animationMethod.name}` : ''}` : '从一句需求，到可以直接播放的真实成片'
    const cost = p?.chat?.runs?.at(-1)?.usage?.cost, executionBudget = cost?.limitYuan ?? p?.billing?.executionBudgetYuan
    const recordedCosts = (p?.chat?.runs || []).map(run => run.usage?.cost?.accountedUpperBoundYuan).filter(value => Number.isFinite(value) && value >= 0), totalRecordedCost = recordedCosts.reduce((sum, value) => sum + Math.round(value * 1000000), 0) / 1000000
    budgetStatus.hidden = !Number.isFinite(executionBudget)
    budgetStatus.textContent = Number.isFinite(executionBudget) ? `本轮模型预算 ¥${executionBudget}${cost ? ` · 已核算费用上界 ¥${Number(cost.spentUpperBoundYuan || 0).toFixed(4)} · 待结算预留 ¥${Number(cost.reservedYuan || 0).toFixed(4)}` : ''}${recordedCosts.length > 1 ? ` · 本项目已记录费用上界 ¥${totalRecordedCost.toFixed(4)}（含失败轮次）` : ''} · 本地渲染不新增模型请求；费用上界为估算。` : ''
    topActions.replaceChildren()
    if (p) {
      topActions.append(button(state.collapseChat ? '返回对话' : '放大预览', () => { state.collapseChat = !state.collapseChat; render() }, 'v2-tool-button sv-subtle'))
      const more = details('项目操作', button('打开项目文件夹', () => api('videoStudioOpenFolder', p.id)), button('复制项目目录', () => api('copyText', p.cwd || p.chat?.cwd || '')))
      if (p.legacy && !p.linkedLemoId) more.append(button('准备继续制作', () => mutate('upgrade', () => api('videoStudioUpgrade', p.id))))
      topActions.append(more)
    }
    errors.textContent = state.error || p?.error || (!p?.recoveredChat ? p?.chat?.error : '') || p?.production?.error || ''; errors.hidden = !errors.textContent
    status.replaceChildren(); status.hidden = !p
    if (p) {
      const text = p.production?.message || p.activity || p.chat?.activity || STATUS[p.status] || '项目已保存'
      status.append(el('span', running(p) ? 'sv-live-dot' : 'sv-dot'), el('span', '', text))
      const ratio = p.progress?.ratio ?? p.production?.progress?.ratio
      if (Number.isFinite(ratio)) { const progress = el('progress'); progress.max = 1; progress.value = Math.max(0, Math.min(1, ratio)); status.append(progress) }
    }
    createPane.hidden = !!p; conversation.hidden = !p; composer.hidden = !p; execution.hidden = !p
    if (p) { renderMessages(); renderExecution(); renderApproval(); if (doc.activeElement !== composerInput) composerInput.value = currentDraft() }
    else { conversation.replaceChildren(); execution.replaceChildren(); approval.replaceChildren() }
    updateComposer(); renderAudio(); renderOutput()
  }
  function renderAudio() {
    const p = state.project, source = p?.audio?.source, selection = p?.audio?.selection
    audioPane.hidden = !p
    const key = signature({ id: p?.id, source, selection })
    if (key !== audioPaneKey) {
      const sameProject = audioPane.dataset.projectId === p?.id, wasOpen = sameProject && audioPane.open
      audioPaneKey = key; audioPane.dataset.projectId = p?.id || ''; ++audioPreviewRevision; audioEnd = null; audioPlayer.pause(); audioPlayer.removeAttribute('src'); audioPlayer.hidden = true
      audioPane.replaceChildren(el('summary', '', source ? `歌曲与片段 · ${source.name}${selection ? ` · ${audioTime(selection.start)}–${audioTime(selection.end)}` : ''}` : '歌曲与片段'))
      audioPane.open = wasOpen
      if (!p) return
      const controls = row(button(source ? '更换歌曲' : '导入歌曲', importAudio)); controls.firstChild.dataset.audioImport = ''; audioPane.append(controls)
      if (source) {
        let draft = audioDrafts.get(p.id)
        if (!draft || draft.sourceId !== source.id) { draft = { sourceId: source.id, start: audioTime(selection?.start || 0), end: audioTime(selection?.end || Math.min(source.duration, p.duration || source.duration)), resizeVideo: true }; audioDrafts.set(p.id, draft) }
        audioPane.append(note(`原曲 ${audioTime(source.duration)}${selection ? ` · 已选 ${Number(selection.duration.toFixed(3))} 秒` : ' · 请选择要制作的片段'}`))
        const start = field('歌曲开始时间', draft.start, value => { draft.start = value }), end = field('歌曲结束时间', draft.end, value => { draft.end = value }), times = el('div', 'sv-settings-grid'); start.input.placeholder = '0:47.24'; end.input.placeholder = '1:14.24'; times.append(start.node, end.node)
        const resizeLabel = el('label', 'sv-audio-check'), resize = el('input'); resize.type = 'checkbox'; resize.checked = draft.resizeVideo; resize.setAttribute('aria-label', '将视频时长同步为歌曲片段时长'); resize.onchange = () => { draft.resizeVideo = resize.checked }; resizeLabel.append(resize, doc.createTextNode('将视频时长同步为歌曲片段时长'))
        const apply = button('应用歌曲片段', selectAudio, 'v2-tool-button primary'); apply.dataset.audioSelect = ''; const preview = button(selection ? '试听所选片段' : '试听这个范围', previewAudio); preview.dataset.audioPreview = ''
        audioPane.append(times, resizeLabel, row(preview, apply), audioPlayer, note('歌曲裁切和试听在本机完成，不发起模型请求。'))
      }
    }
    const busy = running(p) || state.busy.has('send') || state.busy.has('audio-import') || state.busy.has('audio-select')
    for (const n of audioPane.querySelectorAll('[data-audio-import],[data-audio-select]')) n.disabled = busy
  }
  async function importAudio() {
    const p = state.project; if (!p || running(p)) return
    const result = await mutate('audio-import', () => api('videoStudioAudioImport', p.id))
    if (result && state.project?.id === p.id) { audioPane.open = true; toast('歌曲已加入。选好起止时间后应用片段。') }
  }
  async function selectAudio() {
    const p = state.project, draft = audioDrafts.get(p?.id); if (!p || !draft || running(p)) return
    const start = audioSeconds(draft.start), end = audioSeconds(draft.end)
    if (end <= start || end > p.audio.source.duration) throw new Error('结束时间须晚于开始时间，并且不超过原曲时长。')
    const result = await mutate('audio-select', () => api('videoStudioAudioSelect', p.id, { start, end, resizeVideo: draft.resizeVideo, fadeMs: 60 }))
    if (result && state.project?.id === p.id) { audioPane.open = true; toast('歌曲片段已应用，制作会使用这段原音频。') }
  }
  async function previewAudio() {
    const p = state.project; if (!p?.audio?.source) return
    const revision = state.revision, request = ++audioPreviewRevision, selected = !!p.audio.selection
    let start = 0, end = p.audio.source.duration
    if (!selected) {
      start = audioSeconds(audioDrafts.get(p.id)?.start || 0); end = audioSeconds(audioDrafts.get(p.id)?.end || p.audio.source.duration)
      if (end <= start || end > p.audio.source.duration) throw new Error('结束时间须晚于开始时间，并且不超过原曲时长。')
    }
    const result = await api('videoStudioAudioPreview', p.id, { source: !selected })
    if (!valid(revision, p.id) || request !== audioPreviewRevision) return
    if (typeof result?.url !== 'string' || !result.url.startsWith('aipm-media://')) throw new Error('没有取得可试听的本机歌曲地址。')
    pauseVideo(); audioPlayer.src = result.url; audioPlayer.hidden = false; audioEnd = selected ? null : end
    if (!selected) audioPlayer.addEventListener('loadedmetadata', () => { if (request === audioPreviewRevision) audioPlayer.currentTime = start }, { once: true })
    await audioPlayer.play()
  }
  function renderMessages() {
    const p = state.project, atBottom = conversation.scrollHeight - conversation.scrollTop - conversation.clientHeight < 120, scroll = conversation.scrollTop
    conversation.replaceChildren()
    const messages = p.messages || p.chat?.messages || []
    if (!messages.length) conversation.append(el('div', 'sv-chat-welcome', ready(p.output?.lastVideo) || p.versions?.some(ready) ? '这支影片已可播放，可以在这里提出修改，或询问它生成了什么。' : '项目已建立。可以先导入页面截图，再发送要求开始制作；也可以先聊清楚内容与风格。'))
    for (const message of messages) {
      const article = el('article', 'sv-message ' + (message.role === 'user' ? 'user' : 'assistant')); article.dataset.messageId = message.id || ''; article.append(el('small', '', message.role === 'user' ? '你' : '工作台'))
      if (message.role === 'user') article.append(el('div', 'sv-user-text', message.content || ''))
      else if (message.content) article.append(markdown(message.content))
      else article.append(note(p.chat?.activity || '正在处理…'))
      conversation.append(article)
    }
    if (p.status === 'paused' && p.chat?.status === 'paused') conversation.append(note(p.chat.pause?.reason || '任务已暂停，已保存当前进度。'), button('继续制作', async () => { if (currentDraft().trim()) { toast('请先发送或清空当前草稿，再继续。'); composerInput.focus(); return } drafts.set(p.id, '继续完成刚才的视频制作，从已保存的进度接着做。'); composerInput.value = currentDraft(); await send() }))
    if (atBottom) conversation.scrollTop = conversation.scrollHeight; else conversation.scrollTop = scroll
  }
  function renderExecution() {
    const p = state.project, open = execution.open, steps = p.chat?.runs?.flatMap(run => run.tools || []) || [], production = (p.production?.steps || []).map(step => step.operation === 'readcheck' && p.production?.checks?.readability?.applicable === false ? { ...step, status: 'not_applicable' } : step)
    execution.replaceChildren(el('summary', '', `制作过程${steps.length + production.length ? ` · ${steps.length + production.length} 步` : ''}`)); execution.open = open
    if (!steps.length && !production.length) execution.append(note('读取资料、修改文件与本地生成的过程会记录在这里。'))
    for (const step of [...steps, ...production]) { const label = step.label || STEPS[step.name || step.operation] || step.name || step.operation || '处理任务'; execution.append(row(el('span', '', label), el('small', 'sv-note', STATUS[step.status] || ({ done: '已完成', checked: '已检查' })[step.status] || '已记录'))); if (step.message) execution.append(note(step.message)) }
  }
  function renderApproval() {
    const pending = state.project.pending || state.project.chat?.pending; approval.replaceChildren(); if (!pending) return
    const card = el('section', 'sv-approval'); card.append(el('strong', '', '这一步需要你确认'), note(pending.reason || '请核对操作的对象和范围。'))
    if (pending.command) card.append(el('pre', 'sv-code', pending.command))
    const approve = button('批准这次操作', () => reply(true), 'v2-tool-button primary'), deny = button('不执行', () => reply(false)); approve.disabled = deny.disabled = state.busy.has('reply'); card.append(row(approve, deny)); approval.append(card)
  }
  function renderOutput() {
    for (const [key, n] of tabButtons) n.setAttribute('aria-selected', String(state.tab === key))
    playerPane.hidden = state.tab !== 'film'; detailPane.hidden = state.tab === 'film'
    if (state.tab === 'film') renderFilmTools()
    else keepFocus(detailPane, () => { detailPane.replaceChildren(); if (!state.project) { detailPane.append(note('建立项目后，分镜、素材和版本会显示在这里。')); return }; if (state.tab === 'storyboard') renderStoryboard(); if (state.tab === 'files') renderFiles(); if (state.tab === 'versions') renderVersions() })
    void ensurePreview()
  }
  function renderFilmTools() {
    const p = state.project, version = currentVersion(), validVideo = ready(version), canPlay = !!state.displayedKey && !!video.getAttribute('src')
    emptyPlayer.hidden = canPlay; video.hidden = !canPlay
    emptyPlayer.querySelector('strong').textContent = p && running(p) ? '正在制作这支视频' : p ? '还没有可以播放的成片' : '成片会显示在这里'
    emptyPlayer.querySelector('p').textContent = state.loading ? '正在读取项目与成片…' : p ? '发送制作要求后，实际生成的影片会在这里显示。' : '建立项目，发送制作要求后，在这里播放和检查实际生成的视频。'
    const selectedFailed = version?.validation?.state === 'failed' || version?.ready === false
    previewNotice.textContent = selectedFailed ? version.validation?.message || '这个历史版本未通过检查，请选择其它版本或继续修改。' : state.previewError || (running(p) && canPlay ? '正在制作新版本，当前保留上一次成片。' : state.previewLoading ? '正在读取成片播放地址…' : canPlay ? '直接在这里播放、拖动进度、调整音量或全屏检查。' : '')
    const controlsKey = signature({ id: p?.id, version: state.version, exportKind: state.exportKind, versions: p?.versions?.map(v => [keyOf(v), v.name, ready(v)]), validVideo, canPlay, running: running(p), error: state.previewError, busy: [...state.busy].filter(name => ['send', 'export', 'render'].includes(name)) })
    if (filmControlKey === controlsKey) return
    filmControlKey = controlsKey; filmTools.replaceChildren()
    if (!p) return
    const options = [['', '最新可播放成片'], ...(p.versions || []).map(v => [keyOf(v), `${v.name || keyOf(v)}${ready(v) ? '' : ' · 检查未通过'}`])]
    const versions = select('预览版本', options, state.version, value => { state.version = value; state.previewError = ''; if (!ready(currentVersion())) clearPreview(); renderOutput() })
    const kind = select('导出内容', [['bundle', '视频与工程'], ['video', '仅视频 MP4'], ['project', '可编辑工程']], state.exportKind, value => { state.exportKind = value })
    const save = button(state.busy.has('export') ? '正在导出…' : '导出', () => exportProject(), 'v2-tool-button primary'); save.disabled = !validVideo || state.busy.has('export')
    const full = button('全屏观看', async () => { if (!video.getAttribute('src')) return; if (typeof video.requestFullscreen !== 'function') throw new Error('当前播放器暂不支持全屏。'); await video.requestFullscreen() }); full.disabled = !canPlay
    const regenerate = button('生成新版本', async () => { if (currentDraft().trim()) { toast('请先发送或清空当前草稿。'); composerInput.focus(); return }; drafts.set(p.id, '根据当前需求和已保存的修改，重新生成一版成片。'); composerInput.value = currentDraft(); await send('revise') }); regenerate.disabled = running(p) || state.busy.has('send')
    const local = button('检查本地成片', () => mutate('render', () => api('videoStudioRender', p.id))); local.disabled = running(p) || state.busy.has('render')
    filmTools.append(row(versions, full), row(kind, save, regenerate), row(local))
    if (state.previewError) filmTools.append(button('重新加载成片', () => ensurePreview(true)))
  }
  async function ensurePreview(force = false) {
    const p = state.project, version = currentVersion(); if (!p || !ready(version) || state.disposed || !state.visible) return
    const key = `${p.id}/${state.version || keyOf(version) || 'latest'}`
    if (!force && state.previewKey === key) return
    const revision = state.revision, request = ++state.previewRevision; state.previewKey = key; state.previewLoading = true; state.previewError = ''; renderFilmTools()
    try {
      const result = await api('videoStudioPreview', p.id, state.version || undefined)
      if (!valid(revision, p.id) || request !== state.previewRevision) return
      if (typeof result?.url !== 'string' || !result.url.startsWith('aipm-media://')) throw new Error('尚未取得可播放的受控成片地址。')
      if (video.getAttribute('src') !== result.url) { pauseVideo(); video.setAttribute('src', result.url); if (typeof result.posterUrl === 'string' && result.posterUrl.startsWith('aipm-media://')) video.poster = result.posterUrl; else video.removeAttribute('poster') }
      state.displayedKey = key; state.previewError = ''
    } catch (error) { if (valid(revision, p.id) && request === state.previewRevision) { state.previewError = errorText(error) + (state.displayedKey ? ' 当前保留上一次预览。' : '');  } }
    finally { if (valid(revision, p.id) && request === state.previewRevision) { state.previewLoading = false; renderFilmTools() } }
  }
  function renderStoryboard() {
    const p = state.project, draft = sceneDrafts.get(p.id), storyboard = draft?.value || p.storyboard, legacy = p.source === 'quick'
    detailPane.append(el('h2', '', '分镜与内容'))
    if (!storyboard) { detailPane.append(note('制作过程中保存的分镜会显示在这里。也可以在左侧直接要求它先讲清楚镜头与文案。')); return }
    if (typeof storyboard === 'string') { detailPane.append(markdown(storyboard)); return }
    if (draft) {
      const update = (object, key, value) => { object[key] = value; draft.revision++ }
      detailPane.append(field('分镜总标题', storyboard.title || '', value => update(storyboard, 'title', value)).node)
      if (legacy) { detailPane.append(field('旁白文案', storyboard.voiceover || '', value => update(storyboard, 'voiceover', value), { area: true }).node); const palette = details('画面配色'); for (const [key, label] of [['background', '背景色'], ['accent', '强调色'], ['text', '文字色']]) palette.append(field(label, storyboard.palette?.[key] || '', value => { storyboard.palette ||= {}; update(storyboard.palette, key, value) }).node); detailPane.append(palette) }
      else detailPane.append(field('整体分镜风格', typeof storyboard.style === 'string' ? storyboard.style : '', value => update(storyboard, 'style', value), { area: true }).node)
    } else { if (storyboard.title) detailPane.append(el('h3', '', storyboard.title)); if (storyboard.voiceover) detailPane.append(details('旁白文案', note(storyboard.voiceover))); if (typeof storyboard.style === 'string' && storyboard.style) detailPane.append(note(storyboard.style)); if (storyboard.summary) detailPane.append(note(storyboard.summary)) }
    const total = (storyboard.scenes || []).reduce((sum, scene) => sum + (Number(scene.duration) || 0), 0); detailPane.append(note(`${storyboard.scenes?.length || 0} 个镜头 · 合计 ${Number(total.toFixed(2))} 秒`))
    for (const [index, scene] of (storyboard.scenes || []).entries()) {
      const card = el('section', 'sv-scene'), range = Number.isFinite(scene.start) && Number.isFinite(scene.duration) ? ` · ${audioTime(scene.start)}–${audioTime(scene.start + scene.duration)}` : ''; card.append(el('small', 'sv-note', `镜头 ${index + 1}${range}${scene.duration ? ` · ${scene.duration} 秒` : ''}`))
      if (draft) for (const [key, label, area] of (legacy ? [['title', '镜头标题', false], ['subtitle', '镜头副标题', false], ['body', '镜头说明', true], ['duration', '镜头时长', false]] : [['title', '镜头标题', false], ['prompt', '镜头提示词', true], ['transition', '镜头转场', true], ['duration', '镜头时长', false]])) { const f = field(label, scene[key] || '', value => { scene[key] = key === 'duration' ? Number(value) : value; draft.revision++ }, { area, type: key === 'duration' ? 'number' : 'text' }); f.input.dataset.videoField = `scene-${index}-${key}`; card.append(f.node) }
      if (draft && legacy) {
        const update = (key, value) => { scene[key] = value; draft.revision++ }, visual = details('镜头视觉与素材')
        visual.append(select(`镜头类型 ${index + 1}`, [['hero', '开场'], ['workflow', '流程介绍'], ['showcase', '产品展示'], ['outro', '收尾']], scene.kind || 'hero', value => update('kind', value)), field(`镜头强调色 ${index + 1}`, scene.accent || '', value => update('accent', value)).node, field(`镜头标语 ${index + 1}`, scene.eyebrow || '', value => update('eyebrow', value)).node)
        visual.append(select(`画面素材 ${index + 1}`, [['', '不使用图片'], ...(p.assets || []).map(asset => [asset.id, asset.name || asset.path?.split('/').at(-1) || asset.id])], scene.assetId || '', value => { if (value) update('assetId', value); else { delete scene.assetId; draft.revision++ } }), field(`镜头要点 ${index + 1}`, (scene.bullets || []).join('\n'), value => update('bullets', value.split('\n').filter(text => text.trim())), { area: true }).node); card.append(visual)
      } else if (!draft) { if (scene.title) card.append(el('h3', '', scene.title)); if (scene.subtitle) card.append(note(scene.subtitle)); if (scene.body || scene.description) card.append(note(scene.body || scene.description)); if (scene.prompt) card.append(el('p', 'sv-shot-prompt', scene.prompt), button('复制镜头提示词', () => api('copyText', scene.prompt))); if (scene.transition) card.append(note('转场 · ' + scene.transition)); if (scene.bullets?.length) { const list = el('ul'); for (const text of scene.bullets) list.append(el('li', '', text)); card.append(list) } }
      detailPane.append(card)
    }
    if (draft) detailPane.append(row(button('保存分镜修改', saveStoryboard, 'v2-tool-button primary'), button('放弃本次分镜修改', () => { sceneDrafts.delete(p.id); renderOutput() })))
    else if (p.source === 'quick' && Array.isArray(storyboard.scenes)) detailPane.append(row(button('编辑原有分镜', () => { sceneDrafts.set(p.id, { value: clone(p.storyboard), revision: 0 }); renderOutput() }), button('按分镜渲染', () => mutate('render', () => api('videoStudioRender', p.id, { storyboard: true })))))
    else if (Array.isArray(storyboard.scenes)) detailPane.append(row(button('编辑分镜提示词', () => { sceneDrafts.set(p.id, { value: clone(p.storyboard), revision: 0 }); renderOutput() }), button('复制完整分镜提示词', () => api('copyText', [storyboard.title || '', typeof storyboard.style === 'string' ? storyboard.style : '', ...storyboard.scenes.map((scene, index) => `镜头 ${index + 1} · ${scene.duration} 秒 · ${scene.title || ''}\n${scene.prompt || scene.description || scene.body || ''}\n转场 ${scene.transition || ''}`)].filter(Boolean).join('\n\n')))))
    detailPane.append(note('可以在左侧直接说要改哪一个镜头；保存分镜本身不会调用模型。'))
  }
  function renderFiles() {
    const p = state.project, assets = p.assets || [], files = p.output?.files || []
    detailPane.append(el('h2', '', '素材与文件'), row(button('导入素材', importAssets), button('打开项目文件夹', () => api('videoStudioOpenFolder', p.id))))
    if (assets.length) { detailPane.append(el('h3', '', '已导入素材')); for (const asset of assets) detailPane.append(el('div', 'sv-file', asset.name || asset.path?.split('/').at(-1) || asset.id)) }
    if (!files.length) detailPane.append(note('实际生成的文件会列在这里。导入的页面与资料会继续保存在项目中。'))
    for (const file of files) { const n = row(el('span', '', file.name || file.path?.split('/').at(-1) || '文件')); if (readOnly(file)) n.append(button('阅读', () => readFile(file))); n.append(button('复制路径', () => api('copyText', file.path))); detailPane.append(n) }
    if (state.readerLoading) detailPane.append(note('正在读取文件…'))
    if (state.read) { const file = state.read; detailPane.append(row(el('strong', '', file.name || '项目文件'), button('收起正文', () => { ++state.readRevision; state.read = null; renderOutput() }))); detailPane.append(file.kind === 'markdown' || /\.md$/i.test(file.name || '') ? markdown(file.content) : el('pre', 'sv-code', file.content || '')) }
  }
  function renderVersions() {
    const p = state.project; detailPane.append(el('h2', '', '历史版本'))
    if (!p.versions?.length) detailPane.append(note('每次真实生成的成片会保存在这里，原有产物不会被删除。'))
    for (const version of [...(p.versions || [])].reverse()) {
      const card = el('section', 'sv-version'); card.append(el('strong', '', version.name || keyOf(version)), note(`${labelTime(version.createdAt)}${version.duration ? ` · ${version.duration} 秒` : ''}${ready(version) ? '' : ' · 检查未通过'}`))
      if (version.validation?.message) card.append(note(version.validation.message))
      const view = button('在这里预览', () => { state.version = keyOf(version); state.tab = 'film'; renderOutput() }); view.disabled = !ready(version); card.append(view); detailPane.append(card)
    }
  }
  async function createProject({ sendNow = true } = {}) {
    if (state.project || state.busy.has('create')) return
    if (!newDraft.brief.trim()) throw new Error('先描述你想做的视频。')
    if (newDraft.brief.length > 20000) throw new Error('制作要求最多 20000 字。')
    if (!Number.isFinite(newDraft.duration) || newDraft.duration < 1 || newDraft.duration > 3600) throw new Error('时长请填写 1–3600 秒。')
    if ([newDraft.width, newDraft.height].some(n => !Number.isInteger(n) || n < 16 || n > 8192 || n % 2)) throw new Error('画面宽高请填写 16–8192 之间的偶数。')
    const snapshot = signature(newDraft), revision = state.revision, input = { ...newDraft, title: newDraft.title.trim() || newDraft.brief.trim().slice(0, 30), brief: newDraft.brief.trim() }
    state.busy.add('create'); state.error = ''; updateComposer()
    try {
      const project = normalized(await api('videoStudioCreate', input)); if (!project?.id) throw new Error('没有取得已建立的视频项目，请重试。')
      if (state.disposed) return; upsert(project)
      if (signature(newDraft) === snapshot) { Object.assign(newDraft, { title: '', brief: '', duration: 10, width: 1920, height: 1080, fps: 30, visualEngine: 'auto' }); for (const n of createPane.querySelectorAll('[data-video-field]')) if (n.dataset.videoField === '画面风格') n.value = 'auto'; else if (n.tagName !== 'SELECT') n.value = ({ '视频名称': '', '视频制作要求': '', '视频时长（秒）': 10, '画面宽度': 1920, '画面高度': 1080, '每秒帧数': 30 })[n.dataset.videoField] ?? n.value }
      if (revision !== state.revision || !state.visible) return
      ++state.revision; state.project = project; drafts.set(project.id, input.brief); initialIntents.set(project.id, input.brief); composerInput.value = currentDraft(); state.tab = 'film'; state.busy.delete('create'); render(); composerInput.focus(); if (sendNow) await send('create'); else { audioPane.open = true; toast('项目已建立。先导入歌曲、应用片段，再发送分镜制作要求。') }
    } finally { state.busy.delete('create'); updateComposer() }
  }
  async function mutate(name, fn) {
    const p = state.project; if (!p || state.busy.has(name)) return null
    const id = p.id, revision = state.revision, stamp = state.stamp; state.busy.add(name); state.error = ''; updateComposer(); renderAudio()
    try {
      const result = normalized(await fn()); if (state.disposed) return result
      if (result?.id) upsert(result)
      if (valid(revision, id) && result?.id === id) { if (stamp === state.stamp) apply(result); else { const fresh = normalized(await api('videoStudioGet', id)); if (valid(revision, id)) apply(fresh) } }
      return result
    } catch (error) { if (valid(revision, id)) throw error; if (!state.disposed) toast(`${p.title || '原视频项目'}：${errorText(error)}`); return null
    } finally { state.busy.delete(name); if (valid(revision, id)) render() }
  }
  async function send(intentOverride) {
    const p = state.project, text = currentDraft().trim(), submitted = currentDraft()
    if (!p || !text || running(p) || state.busy.has('send')) return
    const selectedIntent = intentOverride || (initialIntents.get(p.id)?.trim() === text ? 'create' : undefined)
    const result = await mutate('send', () => selectedIntent ? api('videoStudioSend', p.id, text, { intent: selectedIntent }) : api('videoStudioSend', p.id, text))
    if (result) initialIntents.delete(p.id)
    if (result && drafts.get(p.id) === submitted) { drafts.set(p.id, ''); if (state.project?.id === p.id) composerInput.value = '' }
    updateComposer()
  }
  async function cancel() { ++audioPreviewRevision; audioPlayer.pause(); const p = state.project; if (p) await mutate('cancel', () => api('videoStudioCancel', p.id)) }
  async function reply(approved) { const p = state.project, pending = p?.pending || p?.chat?.pending; if (pending) await mutate('reply', () => api('videoStudioReply', p.id, pending.token, approved)) }
  async function importAssets() { const p = state.project; if (p) { const result = await mutate('import', () => api('videoStudioImport', p.id)); if (result) toast('素材已加入当前视频项目。') } }
  async function saveStoryboard() {
    const p = state.project, draft = sceneDrafts.get(p?.id); if (!draft || state.busy.has('save')) return
    const edit = draft.revision, result = await mutate('save', () => api('videoStudioSave', p.id, { storyboard: clone(draft.value) }))
    if (result && draft.revision === edit) sceneDrafts.delete(p.id); if (state.project?.id === p.id) renderOutput()
  }
  async function exportProject() {
    const p = state.project; if (!p || !ready(currentVersion()) || state.busy.has('export')) return
    state.busy.add('export'); renderFilmTools()
    try { const saved = await api('videoStudioExport', p.id, state.version || undefined, state.exportKind); if (saved?.folder) toast('已导出到你选择的文件夹。') } finally { state.busy.delete('export'); renderFilmTools() }
  }
  async function readFile(file) {
    const p = state.project, revision = state.revision, request = ++state.readRevision; state.readerLoading = true; renderOutput()
    try { const result = await api('videoStudioRead', p.id, file.path); if (valid(revision, p.id) && request === state.readRevision) state.read = result }
    catch (error) { if (valid(revision, p.id) && request === state.readRevision) throw error }
    finally { if (valid(revision, p.id) && request === state.readRevision) { state.readerLoading = false; renderOutput() } }
  }
  function pauseVideo() { try { video.pause() } catch (error) { /* A detached media element may no longer have a playback session. */ } }
  function clearPreview() { ++state.previewRevision; pauseVideo(); video.removeAttribute('src'); video.removeAttribute('poster'); state.previewKey = ''; state.displayedKey = ''; state.previewError = ''; state.previewLoading = false }
  function newProject() { ++state.revision; ++state.readRevision; state.project = null; state.error = ''; state.read = null; state.loading = false; state.version = ''; state.tab = 'film'; clearPreview(); render() }
  async function chooseProject(id, known) {
    const revision = ++state.revision, stamp = state.stamp; ++state.readRevision; state.project = { id }; state.loading = true; state.error = ''; state.version = ''; state.tab = 'film'; state.read = null; clearPreview(); composerInput.value = currentDraft(); render()
    try { const project = normalized(known || await api('videoStudioGet', id)); if (!valid(revision, id)) return; if (stamp === state.stamp || !state.project.title) apply(project); state.loading = false; render() }
    catch (error) { if (valid(revision, id)) { state.loading = false; state.error = errorText(error); render(); toast(state.error) } }
  }
  async function refreshList() {
    const request = ++state.listRevision
    try { const projects = await api('videoStudioList'); if (!state.disposed && request === state.listRevision) { state.projects = (projects || []).map(normalized); if (state.project?.title) upsert(state.project); state.listError = ''; renderSidebar() } }
    catch (error) { if (!state.disposed && request === state.listRevision) { state.listError = errorText(error); renderSidebar() } }
  }
  function canLeave() {
    if (state.busy.has('create')) { toast('正在建立视频项目，请稍候。'); return false }
    if (newDraft.title.trim() || newDraft.brief.trim() || [...drafts.values()].some(value => value.trim()) || sceneDrafts.size) { toast('视频中还有未发送或未保存的草稿，请先发送、保存或清空。'); return false }
    return true
  }
  const unsubscribe = typeof events.onVideoStudioUpdate === 'function' ? events.onVideoStudioUpdate(value => {
    if (state.disposed) return
    const project = normalized(value?.project || value); if (!project?.id) return
    upsert(project)
    if (project.id === state.project?.id) { ++state.stamp; apply(project); if (state.loading && state.project.title) state.loading = false; render() } else renderSidebar()
  }) : null
  conversation.onclick = event => { const link = event.target.closest?.('a'); if (link) { event.preventDefault(); void api('openLink', link.href).catch(error => toast(errorText(error))) } }
  video.onerror = () => { if (!state.disposed && video.getAttribute('src')) { state.previewError = '成片暂时无法播放，请重新加载或继续修改。'; renderFilmTools() } }
  return {
    async open(selection = {}) {
      if (state.disposed) return false
      state.visible = true; root.hidden = false
      const raw = typeof selection === 'string' ? selection : selection.id, source = selection.mode === 'lemo' ? 'lemo' : selection.mode === 'motion' ? 'motion' : selection.source || 'quick', id = raw ? canonical(raw, source) : null
      if (id) await chooseProject(id); else if (state.project?.id) await chooseProject(state.project.id); else newProject()
      await refreshList(); return state.visible && !state.disposed
    },
    hide() { state.visible = false; root.hidden = true; ++state.revision; ++state.previewRevision; ++state.readRevision; ++audioPreviewRevision; audioPlayer.pause(); pauseVideo() },
    canLeave,
    destroy() { if (state.disposed) return; state.disposed = true; ++state.revision; ++state.listRevision; ++state.previewRevision; ++state.readRevision; ++audioPreviewRevision; if (typeof unsubscribe === 'function') unsubscribe(); audioPlayer.pause(); audioPlayer.removeAttribute('src'); pauseVideo(); video.removeAttribute('src'); root.remove() },
  }
}
