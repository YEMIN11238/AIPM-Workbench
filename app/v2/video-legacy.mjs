/** Video creation uses the shared model and host-owned local rendering jobs. */
import { renderMarkdown } from '../assets/document-format.js'

const C = Object.freeze({
  source: '动效参考 · motion-design-prompt-generator',
  title: '视频创作', intro: '把产品介绍写成分镜，再在本机渲染为视频。可以继续聊天改稿，保留每次成片。',
  create: '新建视频', name: '视频名称', brief: '视频想介绍什么', duration: '时长（秒）', budget: '预算上限（元）',
  empty: '创建一个视频项目，或从左侧继续已有项目。', begin: '生成分镜', send: '发送', prompt: '继续修改视频',
  placeholder: '比如：先介绍 ORVYN，再展示玻璃界面和主要功能，最后加一句收尾…',
  render: '渲染视频', cancel: '停止当前任务', folder: '打开项目文件夹', preview: '打开视频预览',
  budgetNote: '费用按官方高峰价格估算保守上界，不是供应商账单。脚本与分镜使用工作台统一模型，本地渲染不调用额外付费视频 API。',
  unsaved: '还有未发送或未保存的内容，请先发送、保存或清空后离开。',
})
const STATUS = { idle: '可以开始', generating: '正在生成分镜', rendering: '正在渲染', completed: '成片已生成', failed: '任务未完成', cancelled: '任务已停止', interrupted: '上次任务已中断' }
const KINDS = { hero: '开场', workflow: '流程介绍', showcase: '产品展示', outro: '收尾' }
const running = project => ['generating', 'rendering'].includes(project?.status)
const requestLimitReached = project => { const trial = project?.budget?.trial; return !!trial && ((Number.isFinite(trial.requestsUsed) && Number.isFinite(trial.maxRequests) && trial.requestsUsed >= trial.maxRequests) || (Number.isFinite(trial.remainingYuan) && trial.remainingYuan <= 0)) }
const money = value => Number.isFinite(value) ? Number(value).toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : '—'
const clone = value => JSON.parse(JSON.stringify(value))
const signature = value => JSON.stringify(value)
const errorText = error => error?.message || '操作未完成，请重试。'
const date = value => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''

/**
 * Mount a video project surface without starting model or render work.
 * @param {{container:HTMLElement,api:Function,events?:object,toast?:Function,openChat?:Function,lemoFactory?:Function}} options Checked host operations and progress events.
 * @returns {{open:Function,hide:Function,canLeave:Function,destroy:Function}} Navigation controls.
 */
export function mountVideo({ container, api, events = {}, toast = () => {}, openChat = () => false, lemoFactory }) {
  const doc = container.ownerDocument
  const el = (tag, cls, text) => { const node = doc.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node }
  const state = { surface: typeof lemoFactory === 'function' ? 'lemo' : 'projects', visible: false, disposed: false, revision: 0, readRevision: 0, listRevision: 0, updateStamp: 0, project: null, projects: [], tab: 'storyboard', version: undefined, loading: false, error: '', listError: '', busy: new Set() }
  const motion = { open: false, info: null, loading: false, error: '', skill: null, reading: false, busy: false, generating: false, revision: 0, title: '', brief: '', duration: 10, designSystem: 'swiss-kinetic', prepared: null, preparedSignature: '', projects: new Map(), savedProjects: [], generated: null, output: null, checking: false, outputRevision: 0, previewing: false }
  const drafts = new Map(), storyboardDrafts = new Map(), newDraft = { title: '', brief: '', duration: 10, budgetYuan: 5 }
  const root = el('section', 'video-studio'), sidebar = el('aside', 'vs-sidebar'), body = el('main', 'vs-body')
  const hub = el('section', 'vs-hub'), hubTabs = el('nav', 'vs-hub-tabs'), lemoHost = el('section', 'vs-lemo-host'), hubButtons = new Map()
  hub.hidden = true; hubTabs.setAttribute('aria-label', '视频生成方式'); hubTabs.setAttribute('role', 'tablist'); lemoHost.setAttribute('aria-label', 'Lemo Studio')
  root.hidden = true; root.setAttribute('aria-label', C.title); sidebar.setAttribute('aria-label', '视频项目'); root.append(sidebar, body); hub.append(hubTabs, lemoHost, root); container.append(hub)
  const lemo = typeof lemoFactory === 'function' ? lemoFactory({ container: lemoHost, api, events, toast, openChat }) : null
  for (const [key, label] of [['lemo', 'Lemo Studio'], ['projects', '视频项目']]) { const node = el('button', 'vs-hub-tab', label); node.type = 'button'; node.setAttribute('role', 'tab'); node.onclick = () => setSurface(key); hubTabs.append(node); hubButtons.set(key, node) }
  hubTabs.hidden = !lemo; lemoHost.hidden = !lemo
  function setSurface(surface) {
    state.surface = lemo && surface === 'lemo' ? 'lemo' : 'projects'
    lemoHost.hidden = !state.visible || state.surface !== 'lemo'; root.hidden = !state.visible || state.surface !== 'projects'
    for (const [key, node] of hubButtons) { node.setAttribute('aria-selected', String(key === state.surface)); node.tabIndex = key === state.surface ? 0 : -1 }
    if (state.visible && state.surface === 'lemo') lemo?.show?.(); else lemo?.hide?.()
  }
  hubTabs.onkeydown = event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); const key = event.key === 'Home' ? 'lemo' : event.key === 'End' ? 'projects' : state.surface === 'lemo' ? 'projects' : 'lemo'; setSurface(key); hubButtons.get(state.surface).focus() }
  const valid = (revision = state.revision, id = state.project?.id) => state.visible && !state.disposed && revision === state.revision && (id ?? null) === (state.project?.id ?? null)
  const operationKey = (id, name) => `${id || 'new'}:${name}`
  const busy = name => state.busy.has(operationKey(state.project?.id, name))
  function showError(error, revision = state.revision, id = state.project?.id) { if (!valid(revision, id)) return; state.error = errorText(error); render(); toast(state.error) }
  const guarded = fn => async event => { try { await fn(event) } catch (error) { showError(error) } }
  const button = (label, action, cls = 'v2-tool-button') => { const node = el('button', cls, label); node.type = 'button'; node.onclick = guarded(action); return node }
  const note = text => el('p', 'vs-note', text)
  const row = (...nodes) => { const node = el('div', 'vs-actions'); node.append(...nodes); return node }
  const markdown = text => { const node = el('div', 'markdown-content vs-markdown'); node.innerHTML = renderMarkdown(text); return node }
  function field(label, value, change, { area = false, type = 'text', key = label, placeholder = '', min, max, step } = {}) {
    const labelNode = el('label', 'vs-field', label), input = el(area ? 'textarea' : 'input', 'v2-tool-input'); input.value = value ?? ''; input.setAttribute('aria-label', label); input.dataset.videoField = key
    if (!area) input.type = type; else input.rows = 3
    if (min !== undefined) input.min = min; if (max !== undefined) input.max = max; if (step !== undefined) input.step = step
    input.placeholder = placeholder; input.oninput = () => change(input.value); labelNode.append(input); return { node: labelNode, input }
  }
  function select(label, choices, value, change) {
    const labelNode = el('label', 'vs-field', label), input = el('select', 'v2-tool-input'); input.setAttribute('aria-label', label); input.dataset.videoField = label
    for (const [id, text] of Object.entries(choices)) { const option = el('option', '', text); option.value = id; input.append(option) }
    input.value = value; input.onchange = () => change(input.value); labelNode.append(input); return labelNode
  }
  function details(label, ...nodes) { const node = el('details', 'vs-details'); node.append(el('summary', '', label), ...nodes); return node }
  function preserveFocus(draw) {
    const current = body.contains(doc.activeElement) ? doc.activeElement : null, name = current?.dataset?.videoField
    const range = name && typeof current.selectionStart === 'number' ? [current.selectionStart, current.selectionEnd] : null
    const scroll = body.scrollTop, opens = [...body.querySelectorAll('details[open]')].map(node => node.dataset.videoDetails).filter(Boolean)
    draw()
    for (const node of body.querySelectorAll('details[data-video-details]')) if (opens.includes(node.dataset.videoDetails)) node.open = true
    if (name) {
      const input = [...body.querySelectorAll('[data-video-field]')].find(node => node.dataset.videoField === name)
      if (input) { input.focus({ preventScroll: true }); if (range && input.setSelectionRange) input.setSelectionRange(...range) }
    }
    body.scrollTop = scroll
  }
  function upsert(project) { const index = state.projects.findIndex(item => item.id === project.id); if (index >= 0 && project.updatedAt && state.projects[index].updatedAt && project.updatedAt < state.projects[index].updatedAt) return; if (index < 0) state.projects.unshift(project); else state.projects[index] = { ...state.projects[index], ...project } }
  function apply(project) {
    if (!project?.id) return
    upsert(project)
    if (state.project?.id !== project.id) return
    if (project.updatedAt && state.project.updatedAt && project.updatedAt < state.project.updatedAt) return
    state.project = { ...state.project, ...project }
  }
  function renderSidebar() {
    sidebar.replaceChildren(el('div', 'vs-side-title', '视频项目'), button('＋ ' + C.create, chooseNew, 'v2-tool-button vs-new'))
    if (state.listError) sidebar.append(el('p', 'vs-error', state.listError), button('重试', refreshList))
    for (const project of state.projects) {
      const node = button('', () => chooseProject(project.id), 'vs-project'); node.dataset.videoId = project.id; node.setAttribute('aria-current', String(state.project?.id === project.id))
      node.append(el('strong', '', project.title || '未命名视频'), el('small', '', `${project.duration || 10} 秒 · ${STATUS[project.status] || '状态未知'}`)); sidebar.append(node)
    }
    if (!state.projects.length && !state.listError) sidebar.append(note('建立后，视频与分镜会保存在这里。'))
  }
  function renderNew() {
    body.append(el('h1', 'vs-title', C.title), note(C.intro), note(C.source)); renderMotionSection(body)
    const form = el('form', 'vs-create'), title = field(C.name, newDraft.title, value => { newDraft.title = value }, { placeholder: '例如：ORVYN介绍' }), brief = field(C.brief, newDraft.brief, value => { newDraft.brief = value }, { area: true, placeholder: '面向谁，展示什么页面与功能，希望什么风格？' })
    title.input.required = true; title.input.maxLength = 100; brief.input.required = true; brief.input.maxLength = 10000
    const options = el('div', 'vs-two-fields'), seconds = field(C.duration, newDraft.duration, value => { newDraft.duration = value }, { type: 'number', min: 1, max: 60, step: 1 }), budget = field(C.budget, newDraft.budgetYuan, value => { newDraft.budgetYuan = value }, { type: 'number', min: .01, max: 5, step: .01 })
    options.append(seconds.node, budget.node)
    const submit = el('button', 'v2-tool-button primary', busy('create') ? '正在建立…' : '建立视频项目'); submit.type = 'submit'; submit.disabled = busy('create')
    form.append(title.node, brief.node, options, note('默认 10 秒、1920 × 1080、玻璃风格。建立项目不收费；点击生成分镜后才请求统一模型。'), note(C.budgetNote), submit)
    form.onsubmit = guarded(async event => {
      event.preventDefault(); if (busy('create')) return
      if (!newDraft.title.trim() || !newDraft.brief.trim()) { toast('请填写视频名称和介绍内容。'); return }
      const revision = state.revision, values = { title: newDraft.title.trim(), brief: newDraft.brief.trim(), duration: Number(newDraft.duration), budgetYuan: Number(newDraft.budgetYuan), style: 'glass', width: 1920, height: 1080 }, key = operationKey(null, 'create')
      if (!Number.isFinite(values.duration) || values.duration < 1 || values.duration > 60 || !Number.isFinite(values.budgetYuan) || values.budgetYuan <= 0 || values.budgetYuan > 5) { toast('请填写 1–60 秒时长，预算上限不超过 5 元。'); return }
      state.busy.add(key); state.error = ''; render()
      try {
        const project = await api('videoCreate', values)
        if (newDraft.title.trim() === values.title && newDraft.brief.trim() === values.brief) { newDraft.title = ''; newDraft.brief = '' }
        if (!valid(revision, null)) return
        upsert(project); await chooseProject(project.id, project)
      } catch (error) { showError(error, revision, null) }
      finally { state.busy.delete(key); if (valid()) render() }
    })
    body.append(form, note(C.empty))
  }
  async function loadMotionInfo() {
    if (motion.loading || motion.info || state.disposed) return
    motion.loading = true; motion.error = ''; const request = ++motion.revision; render()
    try {
      const [info, projects] = await Promise.allSettled([api('motionSkillInfo'), api('motionProjects')])
      if (!state.disposed && request === motion.revision) {
        if (info.status === 'fulfilled') motion.info = info.value; else motion.error = errorText(info.reason)
        if (projects.status === 'fulfilled') motion.savedProjects = projects.value; else motion.error ||= errorText(projects.reason)
      }
    }
    catch (error) { if (!state.disposed && request === motion.revision) motion.error = errorText(error) }
    finally { if (!state.disposed && request === motion.revision) { motion.loading = false; render() } }
  }
  function motionValues() {
    return { title: motion.title.trim() || motion.brief.trim().slice(0, 24), brief: motion.brief.trim(), duration: Number(motion.duration), designSystem: motion.designSystem }
  }
  function checkedMotionValues() {
    const values = motionValues()
    if (!values.brief) throw new Error('用一句话描述希望制作的动效即可。')
    if (!Number.isFinite(values.duration) || values.duration < 1 || values.duration > 120) throw new Error('请填写 1–120 秒的动效时长。')
    return values
  }
  async function prepareMotion(values) {
    const key = signature(values), saved = motion.projects.get(key)
    const prepared = saved || await api('motionPrepare', values)
    if (state.disposed) return null
    if (motion.prepared?.id !== prepared.id) { ++motion.outputRevision; motion.output = null; motion.checking = false }
    motion.projects.set(key, prepared); motion.prepared = prepared; motion.preparedSignature = key
    if (prepared.id && !motion.savedProjects.some(item => item.id === prepared.id)) motion.savedProjects.unshift({ id: prepared.id, title: prepared.title || values.title })
    return prepared
  }
  async function generateMotionCode() {
    if (motion.busy || motion.generating || !motion.info?.ready) return
    const values = checkedMotionValues()
    if (values.duration !== 10) throw new Error('预算内动效草稿当前仅支持 10 秒；其他时长请使用“新建动效工程并打开聊天”。')
    motion.generating = true; motion.error = ''; motion.generated = null; render()
    try {
      const prepared = await prepareMotion(values)
      if (!prepared || state.disposed) return
      if (!prepared.id) throw new Error('动效工程缺少编号，未发送生成请求。')
      const result = await api('motionGenerate', { projectId: prepared.id })
      if (!state.disposed) motion.generated = { projectId: prepared.id, result }
    } catch (error) { if (!state.disposed) motion.error = errorText(error) }
    finally { motion.generating = false; if (!state.disposed) render() }
  }
  async function checkMotionOutput() {
    const projectId = motion.prepared?.id
    if (!projectId || motion.checking) return
    const request = ++motion.outputRevision; motion.checking = true; render()
    try {
      const output = await api('motionOutput', { projectId })
      if (!state.disposed && request === motion.outputRevision && motion.prepared?.id === projectId) motion.output = { ...output, projectId }
    } catch (error) {
      if (!state.disposed && request === motion.outputRevision && motion.prepared?.id === projectId) motion.output = { projectId, status: 'pending', message: errorText(error) }
    } finally { if (!state.disposed && request === motion.outputRevision) { motion.checking = false; render() } }
  }
  function renderMotionOutput(parent) {
    const projectId = motion.prepared?.id
    if (!projectId) return
    const check = button(motion.checking ? '正在检查本机成片…' : '检查本机成片', checkMotionOutput); check.disabled = motion.checking; parent.append(check)
    const output = motion.output
    if (!output || output.projectId !== projectId) return
    if (output.status !== 'ready') { parent.append(note('本机成片尚未就绪。' + (output.message || '未找到可预览的实际视频，请稍后重新检查。'))); return }
    parent.append(el('h3', 'vs-section-title', '本机成片已就绪，可预览'), note(`${Number.isFinite(output.duration) ? output.duration + ' 秒' : '时长待核对'} · ${Number.isFinite(output.width) && Number.isFinite(output.height) ? output.width + ' × ' + output.height : '尺寸待核对'}${Number.isFinite(output.fps) ? ' · ' + output.fps + 'fps' : ''}`))
    if (output.message) parent.append(note(output.message))
    parent.append(note('本机检查核对实际文件与视频规格，画面效果仍需预览确认。'))
    const preview = button(motion.previewing ? '正在打开成片…' : '预览动效成片', async () => {
      if (motion.previewing) return
      motion.previewing = true; render()
      try { await api('motionPreview', { projectId }) }
      finally { motion.previewing = false; if (!state.disposed) render() }
    }, 'v2-tool-button primary'); preview.disabled = motion.previewing; parent.append(preview)
    const budget = output.budget?.trial || output.budget
    if (budget) parent.append(note(`本次试做累计费用上界 ¥${money(budget.spentUpperBoundYuan)}；以供应商账单为准。`))
    if (output.videoPath) parent.append(details('本机成片位置', note(output.videoPath), ...(output.posterPath ? [note(output.posterPath)] : [])))
  }
  function renderMotionSection(parent) {
    const section = details('自由动效 · 完整 Skill'); section.dataset.videoDetails = 'full-motion-skill'; section.open = motion.open
    section.ontoggle = () => { if (!section.isConnected) return; motion.open = section.open; if (motion.open && !motion.info && !motion.loading && !motion.error) void loadMotionInfo() }
    section.append(note('生成完整动画代码，支持 7 种设计风格，以及形变、动态文字、数据故事与音效。工程在主聊天中继续设计、编写和审阅。'), note('通过“新建动效工程并打开聊天”建立工程不调用模型；发送主聊天后按统一 API 计费，独立于快速视频试做额度。'))
    if (motion.loading) section.append(note('正在读取完整动效 Skill…'))
    if (motion.error) { section.append(el('p', 'vs-error', motion.error), button('重新读取动效资料', () => { motion.info = null; motion.error = ''; return loadMotionInfo() })) }
    if (motion.info) {
      section.append(note(`${motion.info.name || 'motion-design-prompt-generator'} · ${motion.info.ready ? '本机资料已就绪' : '资料尚未就绪'}`))
      if (Array.isArray(motion.info.limitations)) for (const item of motion.info.limitations) section.append(note(item))
      const existing = { '': '选择已有工程' }; for (const project of motion.savedProjects) existing[project.id] = project.title
      section.append(select('已有动效工程', existing, motion.prepared?.id || '', value => {
        const project = motion.savedProjects.find(item => item.id === value)
        motion.prepared = project ? { id: project.id, title: project.title } : null; motion.preparedSignature = ''; motion.generated = null; motion.output = null; motion.checking = false; ++motion.outputRevision; render()
      }))
      const form = el('form', 'vs-motion-form'), title = field('动效名称（可选）', motion.title, value => { motion.title = value }, { placeholder: '留空会从描述中取名' }), brief = field('用一句话描述动效', motion.brief, value => { motion.brief = value }, { area: true, placeholder: '例如：用动态字体和形变做一支 10 秒的 ORVYN宣传片' })
      title.input.maxLength = 100; brief.input.required = true; brief.input.maxLength = 10000
      const choices = {}; for (const system of motion.info.designSystems || []) choices[system.id] = system.name || system.id
      const options = el('div', 'vs-two-fields'); options.append(field('动效时长（秒）', motion.duration, value => { motion.duration = value }, { type: 'number', min: 1, max: 120, step: 1 }).node, select('动效设计风格', choices, motion.designSystem, value => { motion.designSystem = value }))
      const submit = el('button', 'v2-tool-button primary', motion.busy ? '正在建立工程…' : '新建动效工程并打开聊天'); submit.type = 'submit'; submit.disabled = motion.busy || motion.generating || !motion.info.ready
      const generate = button(motion.generating ? '正在生成动效草稿…' : '生成动效草稿（预算内）', generateMotionCode); generate.disabled = motion.busy || motion.generating || !motion.info.ready
      form.append(title.node, brief.node, options, row(submit, generate), note('当前仅 10 秒（1920 × 1080，30fps）。单次模型请求，计入原 5 元、3 次试做；生成方案和动画源码，检查后再渲染。不会自动执行或覆盖已有工程，也不会自动重试。'))
      form.onsubmit = guarded(async event => {
        event.preventDefault(); if (motion.busy || motion.generating || !motion.info.ready) return
        const values = checkedMotionValues()
        const revision = state.revision, id = state.project?.id; motion.busy = true; motion.error = ''; render()
        try {
          const prepared = await prepareMotion(values)
          if (!prepared || state.disposed) return
          if (signature(motionValues()) === signature(values)) { motion.title = ''; motion.brief = '' }
          if (valid(revision, id)) { render(); await openChat(prepared.chatId, prepared.prompt) }
        } catch (error) { if (!state.disposed) { motion.error = errorText(error); render() } }
        finally { motion.busy = false; if (!state.disposed) render() }
      })
      section.append(form)
      if (motion.prepared?.chatId) section.append(note('动效工程已保存。主聊天的指令只会预填，发送前不会请求模型。'), button('打开已建立的动效聊天', () => openChat(motion.prepared.chatId, motion.prepared.prompt)))
      else if (motion.prepared) section.append(note('已选择本机已有动效工程，可以检查实际成片。'))
      renderMotionOutput(section)
      if (motion.generated && motion.generated.projectId === motion.prepared?.id) {
        const result = motion.generated.result, budget = result?.budget?.trial || result?.budget
        section.append(note(result?.status === 'completed' ? '上次请求的动效草稿已保存，待检查后渲染；尚未执行或覆盖工程源码。' : '生成请求已返回，请核对响应文件与任务状态。'))
        if (result?.responsePath) section.append(details('草稿文件位置', note(result.responsePath), button('复制动效响应路径', () => api('copyText', result.responsePath))))
        if (budget) section.append(note(`本次试做累计费用上界 ¥${money(budget.spentUpperBoundYuan)}${Number.isFinite(budget.remainingYuan) ? ' · 剩余额度 ¥' + money(budget.remainingYuan) : ''}；以供应商账单为准。`))
      }
      const read = button(motion.reading ? '正在读取 Skill…' : '查看完整 Skill', async () => {
        if (motion.reading) return
        motion.reading = true; const request = ++motion.revision; render()
        try { const file = await api('motionSkillRead', 'SKILL.md'); if (!state.disposed && request === motion.revision) motion.skill = file }
        catch (error) { if (!state.disposed && request === motion.revision) motion.error = errorText(error) }
        finally { if (!state.disposed && request === motion.revision) { motion.reading = false; render() } }
      }); read.disabled = motion.reading; section.append(read)
      if (motion.skill) { const content = details(motion.skill.name || '完整 Skill', markdown(motion.skill.content)); content.dataset.videoDetails = 'motion-skill-reader'; content.onclick = event => { const link = event.target.closest?.('a'); if (link) { event.preventDefault(); void Promise.resolve().then(() => api('openLink', link.href)).catch(error => showError(error)) } }; section.append(content) }
    }
    parent.append(section)
  }
  function renderBudget(project, expanded = false) {
    const budget = project.budget || {}, node = el('section', expanded ? 'vs-usage' : 'vs-budget')
    if (budget.trial) {
      const trial = budget.trial; node.append(note(`本次试做总预算 ¥${money(trial.limitYuan)} · 剩余上界额度 ¥${money(trial.remainingYuan)} · 模型请求 ${trial.requestsUsed ?? 0}/${trial.maxRequests ?? 3}`))
    }
    const values = row(el('span', '', `项目预算 ¥${money(budget.limitYuan)}`), el('span', '', `累计上界 ¥${money(budget.spentUpperBoundYuan)}`), el('span', '', `本轮预留 ¥${money(budget.reservedYuan)}`)); node.append(values)
    if (expanded) {
      node.append(note(C.budgetNote))
      if (!budget.entries?.length) node.append(note('尚无模型请求记录。'))
      for (const entry of [...(budget.entries || [])].reverse()) {
        const card = el('article', 'vs-cost-entry'), names = { reserved: '请求中，已预留额度', settled: '已结算估算上界', uncertain: '用量未完全确认，按预留计入上界' }
        card.append(el('strong', '', entry.model || '统一模型'), note(`${names[entry.status] || '用量状态未知'} · ${date(entry.createdAt)}`), note(`预留 ¥${money(entry.reservedYuan)} · 计入上界 ¥${money(entry.chargedUpperBoundYuan)}`))
        if (entry.note) card.append(note(entry.note))
        if (entry.usage) card.append(details('查看实际回传用量', el('pre', '', JSON.stringify(entry.usage, null, 2))))
        node.append(card)
      }
    }
    return node
  }
  function renderStatus(project) {
    const status = el('div', 'vs-status'); status.setAttribute('role', 'status'); status.append(el('span', running(project) ? 'vs-live-dot' : 'vs-dot'), el('strong', '', STATUS[project.status] || '状态未知'))
    if (project.progress?.message) status.append(el('span', 'vs-note', project.progress.message))
    if (running(project) && Number.isFinite(project.progress?.ratio)) { const meter = el('progress'); meter.max = 1; meter.value = Math.min(1, Math.max(0, project.progress.ratio)); meter.setAttribute('aria-label', '当前任务进度'); status.append(meter, el('small', '', `${Math.round(meter.value * 100)}%`)) }
    const stop = button(busy('cancel') ? '正在停止…' : C.cancel, () => action('cancel', () => api('videoCancel', project.id))); stop.hidden = !running(project); stop.disabled = busy('cancel'); status.append(stop); return status
  }
  function renderProject(project) {
    const header = el('header', 'vs-heading'), heading = el('div'); heading.append(el('h1', 'vs-title', project.title), note(`${project.duration} 秒 · ${project.width} × ${project.height} · 玻璃风格`), note(C.source))
    header.append(heading, row(button(C.folder, () => action('folder', () => api('videoOpenFolder', project.id)))))
    body.append(header, renderBudget(project), renderStatus(project)); renderMotionSection(body)
    if (project.error) { const error = el('p', 'vs-error', typeof project.error === 'string' ? project.error : errorText(project.error)); error.setAttribute('role', 'alert'); body.append(error) }
    const layout = el('div', 'vs-layout'), chat = el('section', 'vs-chat'), output = el('section', 'vs-output')
    renderChat(project, chat)
    const tabs = el('nav', 'vs-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '视频工作区')
    for (const [id, label] of [['storyboard', '分镜'], ['preview', '预览与导出'], ['usage', '预算用量']]) { const tab = button(label, () => { state.tab = id; state.error = ''; render() }, 'vs-tab'); tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(state.tab === id)); tabs.append(tab) }
    output.append(tabs)
    if (state.tab === 'storyboard') renderStoryboard(project, output)
    if (state.tab === 'preview') renderPreview(project, output)
    if (state.tab === 'usage') output.append(renderBudget(project, true))
    layout.append(chat, output); body.append(layout)
  }
  function renderChat(project, parent) {
    parent.append(el('h2', 'vs-section-title', '聊聊这支视频'))
    const history = el('div', 'vs-messages'); history.setAttribute('aria-live', 'polite')
    if (!project.messages?.length) {
      history.append(note(project.brief || '先说明希望展示的产品、受众和风格。'))
      const start = button(C.begin, () => send(`请根据视频项目的介绍要求生成分镜。时长 ${project.duration} 秒，沿用玻璃风格；内容须真实，不虚构产品已有能力。`), 'v2-tool-button primary'); start.disabled = running(project) || busy('send') || requestLimitReached(project); history.append(start)
    }
    for (const item of project.messages || []) {
      const article = el('article', 'vs-message ' + (item.role === 'user' ? 'user' : 'assistant')); article.append(el('small', '', item.role === 'user' ? '你' : '视频助手'))
      if (item.role === 'user') article.append(el('p', 'vs-user-text', item.content)); else if (item.content) article.append(markdown(item.content)); else article.append(note(running(project) ? '正在处理…' : '本轮没有返回文字，请查看任务状态。'))
      history.append(article)
    }
    parent.append(history)
    const form = el('form', 'vs-composer'), input = field(C.prompt, drafts.get(project.id) || '', value => { drafts.set(project.id, value) }, { area: true, placeholder: C.placeholder, key: 'video-prompt' })
    input.input.rows = 3; input.input.maxLength = 10000
    input.input.onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void guarded(() => send())() } }
    const submit = el('button', 'v2-tool-button primary', busy('send') ? '正在提交…' : C.send); submit.type = 'submit'; submit.disabled = running(project) || busy('send') || storyboardDrafts.has(project.id) || requestLimitReached(project)
    form.append(input.node, row(note(running(project) ? '当前任务结束后可继续修改。' : 'Enter 发送 · Shift + Enter 换行'), submit))
    form.onsubmit = guarded(event => { event.preventDefault(); return send() }); parent.append(form)
    if (requestLimitReached(project)) parent.append(note('本次试做已达到模型请求次数或预算上限，可继续手动编辑分镜和本地渲染。'))
  }
  function renderStoryboard(project, parent) {
    const draft = storyboardDrafts.get(project.id), storyboard = draft?.value || project.storyboard
    const imported = button('导入图片素材', () => action('import', () => api('videoImport', project.id))); imported.disabled = running(project) || busy('import')
    const assetNote = note(`${project.assets?.length || 0} 份图片素材。导入后可在“编辑分镜”中指定镜头。`)
    if (!storyboard?.scenes?.length) { parent.append(el('div', 'vs-empty', '还没有分镜。先在左侧生成分镜，核对内容后再渲染。'), imported, assetNote); return }
    const toolbar = row(), dirty = !!draft
    if (dirty) {
      const save = button(busy('save') ? '正在保存…' : '保存分镜修改', saveStoryboard, 'v2-tool-button primary'); save.disabled = busy('save') || running(project)
      toolbar.append(save, button('取消分镜修改', () => { storyboardDrafts.delete(project.id); render() }))
    } else { const edit = button('编辑分镜', () => { storyboardDrafts.set(project.id, { value: clone(project.storyboard), original: signature(project.storyboard), revision: 0 }); render() }); edit.disabled = running(project); toolbar.append(edit) }
    const renderButton = button(C.render, () => action('render', () => api('videoRender', project.id)), 'v2-tool-button primary'); renderButton.disabled = running(project) || busy('render') || dirty; toolbar.append(renderButton)
    parent.append(toolbar)
    const sum = storyboard.scenes.reduce((total, scene) => total + (Number(scene.duration) || 0), 0); parent.append(note(`${storyboard.scenes.length} 个镜头 · 合计 ${Number(sum.toFixed(2))} 秒${dirty ? ' · 未保存修改' : ''}`))
    if (draft && draft.original !== signature(project.storyboard)) parent.append(note('后台分镜已有更新，你正在编辑的内容已保留。保存前请核对。'))
    const update = (object, name, value) => { object[name] = value; if (draft) draft.revision++ }
    if (dirty) {
      parent.append(field('成片标题', storyboard.title, value => update(storyboard, 'title', value)).node)
      const palette = details('画面配色')
      storyboard.palette ||= { background: '#10131d', accent: '#8eb9ff', text: '#ffffff' }
      for (const [key, label] of [['background', '背景色'], ['accent', '强调色'], ['text', '文字色']]) palette.append(field(label, storyboard.palette[key], value => update(storyboard.palette, key, value), { key: 'palette-' + key, placeholder: '#RRGGBB' }).node)
      parent.append(palette)
    }
    for (const [index, scene] of storyboard.scenes.entries()) {
      const card = el('article', 'vs-scene'); card.append(el('div', 'vs-scene-number', `${String(index + 1).padStart(2, '0')} · ${KINDS[scene.kind] || '镜头'} · ${scene.duration} 秒`))
      if (dirty) {
        for (const [key, label, area] of [['title', '镜头标题'], ['subtitle', '镜头副标题'], ['body', '镜头说明'], ['eyebrow', '镜头眉题']]) card.append(field(`${label} ${index + 1}`, scene[key], value => update(scene, key, value), { area: area || key === 'body', key: `${scene.id}-${key}` }).node)
        card.append(field(`镜头时长 ${index + 1}`, scene.duration, value => update(scene, 'duration', Number(value)), { type: 'number', min: .5, max: Math.min(20, project.duration), step: .1, key: scene.id + '-duration' }).node)
        card.append(select(`镜头类型 ${index + 1}`, KINDS, scene.kind, value => update(scene, 'kind', value)))
        card.append(field(`镜头强调色 ${index + 1}`, scene.accent || storyboard.palette?.accent, value => update(scene, 'accent', value), { key: scene.id + '-accent', placeholder: '#RRGGBB' }).node)
        const assets = { '': '不使用图片' }; for (const asset of project.assets || []) assets[asset.id] = asset.name || `素材 ${asset.id}`
        card.append(select(`画面素材 ${index + 1}`, assets, scene.assetId || '', value => { if (value) update(scene, 'assetId', value); else { delete scene.assetId; draft.revision++ } }))
        card.append(field(`镜头要点 ${index + 1}`, (scene.bullets || []).join('\n'), value => update(scene, 'bullets', value.split('\n').filter(text => text.trim())), { area: true, key: scene.id + '-bullets', placeholder: '每行一个要点' }).node)
      } else {
        if (scene.eyebrow) card.append(el('small', 'vs-eyebrow', scene.eyebrow))
        card.append(el('h3', '', scene.title || '未填写标题')); if (scene.subtitle) card.append(el('p', 'vs-scene-subtitle', scene.subtitle)); if (scene.body) card.append(note(scene.body))
        if (scene.bullets?.length) { const list = el('ul'); for (const item of scene.bullets) list.append(el('li', '', item)); card.append(list) }
        if (scene.assetId) card.append(note('使用已导入画面素材'))
      }
      parent.append(card)
    }
    if (dirty) parent.append(field('旁白文案', storyboard.voiceover, value => update(storyboard, 'voiceover', value), { area: true }).node)
    else if (storyboard.voiceover) parent.append(details('旁白文案', el('p', 'vs-user-text', storyboard.voiceover)))
    parent.append(imported, assetNote)
  }
  function renderPreview(project, parent) {
    const versions = [...(project.versions || [])].reverse(), selected = state.version ? versions.find(item => item.version === state.version) : versions[0]
    if (!selected) { parent.append(el('div', 'vs-preview-empty', '尚无成片'), note('核对分镜后点击“渲染视频”。实际渲染完成后，这里会出现可预览和导出的版本。')); return }
    const choices = {}; for (const item of versions) choices[item.version] = `${item.version} · ${date(item.createdAt)}${item.validation?.state === 'failed' ? ' · 画面检查未通过' : ''}`
    parent.append(select('成片版本', choices, selected.version, value => { state.version = value; render() }))
    const invalid = selected.validation?.state === 'failed'
    if (invalid) { const warning = el('p', 'vs-error', '画面检查未通过。' + (selected.validation.message || '请修改分镜或渲染新的版本。')); warning.setAttribute('role', 'alert'); parent.append(warning) }
    const preview = el('div', 'vs-preview-card'); preview.append(el('span', 'vs-play-symbol', '▷'), el('strong', '', project.title), note(`${selected.duration || project.duration} 秒 · ${selected.width || project.width} × ${selected.height || project.height}`))
    const play = button(C.preview, () => action('preview', () => api('videoPreview', project.id, selected.version)), 'v2-tool-button primary'); play.disabled = invalid; preview.append(play); parent.append(preview)
    const exports = row()
    for (const [kind, label] of [['video', '导出 MP4'], ['project', '导出可编辑工程'], ['bundle', '导出视频与工程']]) { const download = button(label, async () => { const result = await action('export', () => api('videoExport', project.id, selected.version, kind)); if (result && !state.disposed) toast('已导出，请在所选位置查看。') }); download.disabled = invalid; exports.append(download) }
    parent.append(exports, note('预览在独立窗口中播放实际生成的视频。修改分镜并再次渲染，会保留已有版本。'))
    if (selected.videoPath) parent.append(button('复制视频路径', () => api('copyText', selected.videoPath)))
  }
  function render() {
    if (!state.visible || state.disposed) return
    preserveFocus(() => {
      body.replaceChildren()
      if (state.error) { const error = el('p', 'vs-error', state.error); error.setAttribute('role', 'alert'); body.append(error) }
      if (state.loading) { body.append(note('正在读取视频项目…')); return }
      if (state.project) renderProject(state.project); else renderNew()
    })
  }
  async function action(name, callback) {
    const id = state.project?.id, revision = state.revision, key = operationKey(id, name), stamp = state.updateStamp
    if (!id || state.busy.has(key) || state.disposed) return null
    state.busy.add(key); state.error = ''; render()
    try {
      const result = await callback()
      if (valid(revision, id) && result?.id === id && stamp === state.updateStamp) apply(result)
      return result
    } catch (error) { showError(error, revision, id); return null }
    finally { state.busy.delete(key); if (valid(revision, id)) { renderSidebar(); render() } }
  }
  async function send(provided) {
    const project = state.project, revision = state.revision, text = provided ?? drafts.get(project?.id) ?? ''
    if (!project || !text.trim() || running(project) || busy('send')) return
    if (requestLimitReached(project)) { toast('本次试做已达到模型请求次数或预算上限。'); return }
    if (storyboardDrafts.has(project.id)) { toast('分镜有未保存修改，请先保存或取消，再发送新的要求。'); return }
    const result = await action('send', () => api('videoSend', project.id, text))
    if (result && provided === undefined && drafts.get(project.id) === text) drafts.delete(project.id)
    if (valid(revision, project.id)) render()
  }
  async function saveStoryboard() {
    const project = state.project, revision = state.revision, draft = storyboardDrafts.get(project.id)
    if (!draft || running(project)) return
    const edit = draft.revision, result = await action('save', () => api('videoSaveStoryboard', project.id, { storyboard: clone(draft.value) }))
    if (result && draft.revision === edit) storyboardDrafts.delete(project.id)
    if (valid(revision, project.id)) render()
  }
  async function refreshList() {
    const revision = state.revision, request = ++state.listRevision
    try { const list = await api('videoList'); if (valid(revision) && request === state.listRevision) { state.projects = list; state.listError = ''; renderSidebar() } }
    catch (error) { if (valid(revision)) { state.listError = errorText(error); renderSidebar() } }
  }
  function chooseNew() { ++state.revision; ++state.readRevision; state.project = null; state.loading = false; state.error = ''; renderSidebar(); render() }
  async function chooseProject(id, known) {
    const revision = ++state.revision, request = ++state.readRevision, stamp = state.updateStamp
    state.project = { id }; state.loading = true; state.error = ''; state.tab = 'storyboard'; state.version = undefined; renderSidebar(); render()
    try {
      const project = known || await api('videoGet', id)
      if (!valid(revision, id) || request !== state.readRevision) return
      if (stamp === state.updateStamp || !state.project.title) apply(project)
      state.loading = false; renderSidebar(); render()
    } catch (error) { if (valid(revision, id)) { state.loading = false; state.project = null; showError(error, revision, null) } }
  }
  function canLeave() {
    if (typeof lemo?.canLeave === 'function' && !lemo.canLeave()) return false
    if (motion.generating) { toast('动效草稿正在生成，请先等待本轮返回。'); return false }
    const motionDirty = (motion.title.trim() || motion.brief.trim()) && signature(motionValues()) !== motion.preparedSignature
    if (motionDirty || newDraft.title.trim() || newDraft.brief.trim() || [...drafts.values()].some(value => value.trim()) || storyboardDrafts.size) { toast(C.unsaved); return false }
    return true
  }
  const unsubscribe = typeof events.onVideoUpdate === 'function' ? events.onVideoUpdate(project => {
    if (state.disposed || !project?.id) return
    upsert(project)
    if (!state.visible) return
    if (state.project?.id === project.id) { ++state.updateStamp; apply(project); if (state.loading && state.project.title) state.loading = false; render() }
    renderSidebar()
  }) : null
  return {
    async open(selection = {}) {
      if (state.disposed) return false
      state.visible = true; hub.hidden = false; ++state.revision
      const id = typeof selection === 'string' ? selection : selection.id
      const lemoSelection = selection.mode === 'lemo'
      setSurface(lemoSelection ? 'lemo' : id || selection.mode === 'projects' ? 'projects' : state.surface)
      if (lemoSelection && id) await lemo?.open?.(id)
      if (id && !lemoSelection) await chooseProject(id)
      else if (state.project?.id) await chooseProject(state.project.id)
      else chooseNew()
      await refreshList(); return state.visible && !state.disposed
    },
    hide() { state.visible = false; hub.hidden = true; root.hidden = true; lemoHost.hidden = true; lemo?.hide?.(); ++state.revision; ++state.readRevision; ++state.listRevision },
    canLeave,
    destroy() { if (state.disposed) return; state.disposed = true; state.visible = false; ++motion.revision; ++state.revision; ++state.readRevision; ++state.listRevision; if (typeof unsubscribe === 'function') unsubscribe(); if (typeof lemo === 'function') lemo(); else (lemo?.dispose || lemo?.destroy)?.call(lemo); hub.remove() },
  }
}
