/** Desktop presentation; project and phase changes are owned by main-process storage. */
import { defaultTransparency, defaultTheme, resolveTheme } from './appearance.mjs'
import { renderMarkdown, summarizeChanges } from './assets/document-format.js'
import { starters, projectSearchEntries, searchEntries } from './workbench.mjs'
import { mountGeo } from './geo-view.mjs'
import { geoCopy } from './geo-copy.mjs'
import { mountBlueprint } from './blueprint-view.mjs'
import { studioCopy as copy } from './studio-copy.mjs'
const $ = id => document.getElementById(id)
const stages = ['需求池', '竞品分析', 'MVP 范围', '立项报告', 'PRD']
const descriptions = ['先澄清用户问题，再整理需求', '核验公开材料，支持产品取舍', '界定首版路径和验证方法', '汇总依据、投入与停止条件', '细化需求、指标与验收标准']
const kinds = { provided: '用户提供', verified: '已核验', hypothesis: '待验证假设' }
let modelName = ''
let projects = [], current = null, hasKey = false, busy = false, draftHash = null, documentStage = null, dirty = false, modalAction, page = 'home', libraryMode = false
let searchIndex = [], searchRevision = 0, searchType = 'all', searchMatches = [], searchSelection = 0, appearance = 'system', changingAppearance = false, systemTheme = 'light'
let editorMode = 'source', focused = false, documentSelection = ''
let navigationRevision = 0, editorRevision = 0
let modalRevision = 0
let draftRevision = 0
let transparency = defaultTransparency, savedTransparency = defaultTransparency, transparencyWrites = Promise.resolve(), savingTransparency = 0, transparencyRevision = 0
let theme = defaultTheme, changingTheme = false
const appearanceNames = { liquid: '液态透明玻璃', frosted: '毛玻璃', system: '实色界面' }
const themeNames = { system: '跟随系统', light: '浅色', dark: '深色' }
const drafts = new Map()
const blueprintTaskIds = new Set()
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
function toast(message) { $('toast').textContent = message; $('toast').classList.remove('hidden'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').classList.add('hidden'), 5000) }
async function api(name, ...args) { const result = await window.aipm[name](...args); if (!result.ok) throw new Error(result.error); return result.value }
const geoWorkspace = mountGeo({ container: $('geo-view'), api, toast })
$('nav-geo').title = geoCopy.title
$('nav-geo').setAttribute('aria-label', geoCopy.title)
$('geo-nav-label').textContent = geoCopy.title
$('geo-nav-hint').textContent = geoCopy.navHint
async function showGeo() {
  if (page === 'blueprint' && !blueprintWorkspace.canLeave()) return
  if (dirty || geoWorkspace.hasUnsaved()) { toast(geoCopy.unsaved); return }
  ++navigationRevision; setFocus(false); page = 'geo'; libraryMode = false; render()
  await geoWorkspace.show()
}
const blueprintWorkspace = mountBlueprint({ container: $('blueprint-view'), api, onUpdate: callback => window.aipm.onBlueprintUpdate(callback), onProductUpdate: callback => window.aipm.onBlueprintProductUpdate(callback), onChatUpdate: callback => window.aipm.onBlueprintChatUpdate(callback), onStarterUpdate: callback => window.aipm.onStarterUpdate(callback), toast })
$('nav-blueprint').title = copy.navigation
$('nav-blueprint').setAttribute('aria-label', copy.navigation)
$('studio-nav-label').textContent = copy.navigation
$('studio-nav-hint').textContent = copy.navigationHint
$('project-blueprint').textContent = copy.projectAction
$('project-blueprint').title = copy.projectActionHint
window.aipm.onBlueprintUpdate(task => { blueprintTaskIds.add(task.id); if (page === 'home') renderHome() })
async function showBlueprint(mode = 'chat', input) {
  if (!blueprintWorkspace.canLeave()) return
  if (geoWorkspace.hasUnsaved()) { toast(geoCopy.unsaved); return }
  if (dirty) { toast(copy.unsaved); return }
  ++navigationRevision; setFocus(false); page = 'blueprint'; libraryMode = false; render()
  await blueprintWorkspace.show(mode, input)
}
async function projectBlueprint() {
  if (!current) { toast(copy.noCurrent); return }
  if (dirty) { toast(copy.unsaved); return }
  const id = current.id, revision = ++navigationRevision
  const parts = [`# ${current.name}`, copy.currentStage(stages[current.stage]), copy.engineQuestions]
  for (const item of current.evidence) parts.push(`## ${item.code} ${item.title}\n${item.content}\n${item.source || ''}`)
  for (const item of current.documents) {
    const document = await api('readDocument', id, item.name)
    parts.push(`## ${item.name}\n${document.content}`)
  }
  if (revision !== navigationRevision || current?.id !== id) return
  await showBlueprint('plan', parts.join('\n\n').slice(0, 60000))
}
function replace(project) { current = project; projects = [project, ...projects.filter(item => item.id !== project.id)]; render() }
function modal(html, label, action) { ++modalRevision; $('modal').classList.remove('appearance-settings', 'review-settings', 'history-settings'); $('modal-content').onclick = null; $('modal-content').innerHTML = html; $('modal-submit').textContent = label; $('modal-submit').classList.toggle('hidden', !label); $('cancel').textContent = label ? '取消' : '关闭'; modalAction = action; if (!$('modal').open) $('modal').showModal() }
$('modal').addEventListener('close', () => { ++modalRevision })
$('modal').addEventListener('cancel', event => { if ($('modal-submit').disabled) event.preventDefault() })
$('cancel').onclick = () => $('modal').close()
$('modal-form').onsubmit = async event => {
  event.preventDefault(); $('modal-submit').disabled = true; $('cancel').disabled = true
  const revision = modalRevision
  try { await modalAction(new FormData(event.target)); if (revision === modalRevision) $('modal').close() } catch (error) { toast(error.message) }
  finally { $('modal-submit').disabled = false; $('cancel').disabled = false }
}
function newProject() {
  if (page === 'blueprint' && !blueprintWorkspace.canLeave()) return
  if (geoWorkspace.hasUnsaved()) { toast(geoCopy.unsaved); return }
  modal('<span class="eyebrow">一个新的开始</span><h2>你想做什么产品？</h2><p>先给它一个名字，想法可以在对话中慢慢梳理。</p><label>产品名称<input name="name" placeholder="例如：帮助独立开发者整理用户反馈" required maxlength="80" autofocus></label>', '创建产品', async data => {
    if (busy) throw new Error('请等待当前对话完成')
    if (dirty) throw new Error('请先保存当前文档草稿')
    page = 'project'; replace(await api('create', data.get('name'))); clearEditor(); view('chat'); $('prompt').value = ''; $('prompt').focus()
  })
}
function render() {
  $('workspace').dataset.page = page
  $('nav-home').classList.toggle('active', page !== 'blueprint' && page !== 'geo' && !libraryMode)
  $('nav-documents').classList.toggle('active', page === 'home' && libraryMode)
  $('nav-blueprint').classList.toggle('active', page === 'blueprint')
  if (page !== 'blueprint') blueprintWorkspace.hide()
  $('nav-geo').classList.toggle('active', page === 'geo')
  if (page !== 'geo') geoWorkspace.hide()
  $('project-blueprint').disabled = !current || busy
  $('project-count').textContent = projects.length
  $('projects').innerHTML = projects.length ? projects.map(project => `<button class="project-item ${page === 'project' && current?.id === project.id ? 'selected' : ''}" data-project="${project.id}"><span class="project-glyph"><svg viewBox="0 0 24 24"><path d="M3 6h7l2 3h9v11H3zM3 6V4h7l2 2h8v3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></span><div><strong>${escape(project.name)}</strong><small>${project.completed ? '已完成' : stages[project.stage]}</small></div>${project.review ? '<span class="review-dot"></span>' : ''}</button>`).join('') : '<p class="empty-sidebar">从一句想法开始，<br>建立你的第一个项目。</p>'
  $('project-title').textContent = current?.name ?? '从一个想法开始'
  $('breadcrumb').textContent = current ? '我的产品 / 产品工作空间' : '个人工作空间'
  $('stage-pill').textContent = current ? (current.completed ? '流程已完成' : `${current.review ? '待你确认' : '进行中'} · ${stages[current.stage]}`) : '等待创建产品'
  const documents = page === 'project' ? (current?.documents ?? []).map(item => ({ ...item, projectId: current.id, projectName: current.name, confirmed: current.confirmed.includes(item.stage) })) : recentDocuments().slice(0, 6)
  $('documents-label').textContent = page === 'project' ? '项目文档' : '最近文档'
  $('documents').innerHTML = documents.length ? documents.map(item => `<button class="document-item" data-project="${item.projectId}" data-document="${escape(item.name)}" title="${escape(item.projectName)} / ${escape(item.name)}"><span>▤</span><span>${escape(item.name)}</span>${item.confirmed ? '<span class="document-check">✓</span>' : ''}</button>`).join('') : '<div class="empty-doc"><span>▤</span><p>阶段文档会出现在这里<br><small>Markdown · 保存在本地</small></p></div>'
  $('stages').innerHTML = stages.map((name, index) => `<div class="stage ${current?.confirmed.includes(index) ? 'done' : current?.stage === index ? 'current' : ''}"><div class="stage-number">${current?.confirmed.includes(index) ? '✓' : `0${index + 1}`}</div><div><strong>${name}</strong><small>${descriptions[index]}</small></div>${current?.stage === index && !current.completed ? '<span class="stage-dot"></span>' : ''}</div>`).join('')
  $('evidence-count').textContent = current?.evidence.length ?? 0
  $('evidence').innerHTML = current?.evidence.length ? current.evidence.map(item => `<article class="evidence-card" data-evidence-id="${item.id}"><div class="evidence-meta"><span>${item.code}</span><span class="evidence-kind ${item.kind}">${kinds[item.kind]}</span><button class="remove-evidence" data-remove="${item.id}" title="移除此材料">×</button></div><h4>${escape(item.title)}</h4><p>${escape(item.content)}</p>${item.source ? `<small>来源 · ${escape(item.source)}</small>` : '<small>来源尚未补充</small>'}</article>`).join('') : '<div class="empty-evidence"><span>◎</span><strong>还没有证据材料</strong><p>补充背景、用户反馈或研究来源。<br>没有依据的想法先标成假设。</p><button class="text-button" id="first-evidence">＋ 添加第一份材料</button></div>'
  $('review-title').textContent = current?.completed ? '产品文档已完成' : current?.review ? '文档已保存，等待你确认' : '先把问题聊清楚'
  $('review-description').textContent = current?.completed ? '所有阶段已确认，文档可以继续查看与编辑。' : current?.review ? '检查阶段文档与证据，确认后才会进入下一步。' : '与搭档补齐信息，形成阶段文档后在这里确认。'
  $('confirm').textContent = current?.stage === 4 ? '确认并完成 PRD' : '确认并进入下一阶段'
  $('confirm').disabled = busy || !current?.review || current.completed
  for (const id of ['generate', 'add-evidence', 'attach', 'document-tab']) $(id).disabled = busy || !current || (id === 'generate' && current.completed)
  $('new-project').disabled = busy
  $('send').disabled = busy || !current || current.completed
  $('prompt').disabled = busy || !current || current.completed
  $('stop').classList.toggle('hidden', !busy)
  $('send').classList.toggle('hidden', busy)
  $('save-document').disabled = busy || !current
  $('templates').disabled = busy || !current || current.completed
  $('document-history').disabled = busy || dirty || !draftHash
  $('document-copy').disabled = !$('editor').value.trim()
  $('document-discard').classList.toggle('hidden', !dirty)
  $('key-status').textContent = hasKey ? 'API 已配置' : '未配置 API'
  $('key-status').classList.toggle('configured', hasKey)
  renderMessages()
  renderHome()
  $('first-evidence')?.addEventListener('click', addEvidence)
}
function renderMessages() {
  if (!current?.messages.length) {
    $('messages').innerHTML = `<div class="welcome"><div class="welcome-symbol"><img class="welcome-logo" src="assets/logo.png" alt="AIPM"></div><span class="eyebrow">从想法到立项 · 每一步都可追溯</span><h2>${current ? '先说说你的产品想法' : '让一个想法，逐步成为产品'}</h2><p>通过对话一起梳理，从模糊想法到清晰的 PRD。<br>信息不足就补齐，结论有依据，每一步由你确认。</p><div class="welcome-cards"><div><span>01</span><strong>聊清楚问题</strong><p>谁遇到了什么问题<br>为什么值得解决</p></div><div><span>02</span><strong>留下证据</strong><p>用户材料与事实来源<br>假设单独标记</p></div><div><span>03</span><strong>形成产出</strong><p>阶段文档本地保存<br>确认后再往前走</p></div></div>${current ? '<button id="starter" class="starter">我有一个想法，但还不确定怎么开始 ↗</button>' : '<button id="welcome-create" class="primary">＋ 创建我的第一个产品</button>'}<small class="welcome-foot">你提供方向，AI 帮你把思路梳理成文档。</small></div>`
    $('welcome-create')?.addEventListener('click', newProject)
    $('starter')?.addEventListener('click', () => { $('prompt').value = '我有一个想法，但还不确定怎么开始。请先问我最关键的几个问题，帮助我把想法梳理清楚。'; $('prompt').focus() })
  } else {
    $('messages').innerHTML = current.messages.map((message, index) => `<article class="message ${message.role}" data-message-index="${index}"><div class="message-header"><span class="avatar">${message.role === 'user' ? '我' : 'A'}</span><strong>${message.role === 'user' ? '你' : '产品搭档'}</strong><span>${stages[message.stage]}</span></div><div class="message-body ${message.role === 'assistant' ? 'markdown-content' : ''}">${message.role === 'assistant' ? renderMarkdown(message.content) : escape(message.content)}</div>${message.role === 'assistant' ? `<div class="message-actions"><button class="text-button use-draft" data-draft="${index}">▤ 用作阶段文档草稿</button><button class="text-button" data-copy-message="${index}">复制 Markdown</button></div>` : ''}</article>`).join('')
  }
  if (busy) $('messages').insertAdjacentHTML('beforeend', '<div class="thinking"><span class="thinking-dot"></span>产品搭档正在梳理材料…<small>本次回复完成后可保存为阶段文档</small></div>')
  $('messages').scrollTop = current?.messages.length || busy ? $('messages').scrollHeight : 0
}
function recentDocuments() {
  return projects.flatMap(project => [...project.documents].reverse().map(item => ({ ...item, projectId: project.id, projectName: project.name, confirmed: project.confirmed.includes(item.stage) })))
}
function renderHome() {
  $('greeting').textContent = libraryMode ? copy.libraryTitle : copy.welcome
  $('studio-subtitle').textContent = libraryMode ? copy.librarySubtitle : copy.subtitle
  $('studio-start').classList.toggle('hidden', libraryMode)
  $('studio-summary').classList.toggle('hidden', libraryMode)
  $('studio-start').innerHTML = copy.tasks.map(task => `<button class="studio-task" data-studio-action="${task.action}"><span class="studio-task-top"><span class="studio-task-icon" aria-hidden="true">${task.icon}</span><small>${task.label}</small></span><strong>${task.title}</strong><p>${task.description}</p><span class="studio-task-cta">${task.cta}<span aria-hidden="true">↗</span></span></button>`).join('')
  const documents = recentDocuments()
  $('studio-summary').innerHTML = [copy.projectCount(projects.length), copy.documentCount(documents.length), copy.taskCount(blueprintTaskIds.size)].map(text => `<span>${text}</span>`).join('')
  $('gallery-label').innerHTML = `${libraryMode ? copy.documents : copy.projects} <b>${libraryMode ? documents.length : projects.length}</b>`
  $('gallery-note').textContent = libraryMode ? copy.librarySubtitle : copy.recentHint
  $('project-gallery').classList.toggle('hidden', libraryMode)
  $('document-library').classList.toggle('hidden', !libraryMode)
  $('project-gallery').innerHTML = projects.length ? projects.map(project => {
    return `<button class="project-card" data-project="${project.id}" aria-label="${copy.continue} ${escape(project.name)}"><span class="studio-project-head"><strong>${escape(project.name)}</strong><small>${project.completed ? copy.completedStatus : project.review ? copy.reviewStatus : stages[project.stage]}</small></span><span class="studio-project-progress"><i style="width:${project.confirmed.length * 20}%"></i></span><span class="studio-project-meta"><span>${copy.stageCount(project.confirmed.length)}</span><b>${project.documents.length ? copy.documentCount(project.documents.length) : copy.noDocument} ↗</b></span></button>`
  }).join('') : `<div class="studio-project-empty"><strong>${copy.emptyTitle}</strong>${copy.emptyDetail}</div>`
  $('document-library').innerHTML = documents.length ? documents.map(item => `<button class="library-item" data-project="${item.projectId}" data-document="${escape(item.name)}"><span class="library-icon">▤</span><div><strong>${escape(item.name)}</strong><small>${escape(item.projectName)}</small></div><span class="library-status">${item.confirmed ? '已确认' : '待确认'}</span><span>↗</span></button>`).join('') : '<div class="library-empty">还没有阶段文档。<small>进入项目，用对话梳理想法后保存为 Markdown。</small></div>'
}
function showHome(documents = false) {
  if (page === 'blueprint' && !blueprintWorkspace.canLeave()) return
  if (geoWorkspace.hasUnsaved()) { toast(geoCopy.unsaved); return }
  if (dirty) { toast('请先保存当前文档草稿'); return }
  ++navigationRevision; setFocus(false)
  libraryMode = documents; page = 'home'; render()
}
async function openProject(id, documentName) {
  if (page === 'blueprint' && !blueprintWorkspace.canLeave()) return
  if (geoWorkspace.hasUnsaved()) throw new Error(geoCopy.unsaved)
  if (busy) { toast('请等待当前对话完成'); return }
  if (dirty && (current?.id !== id || documentName)) throw new Error('请先保存当前文档草稿')
  const revision = ++navigationRevision
  setFocus(false)
  if (current?.id !== id) {
    const project = await api('project', id)
    if (revision !== navigationRevision || dirty || busy) return
    page = 'project'; libraryMode = false; replace(project); clearEditor(); $('prompt').value = drafts.get(id) || ''; view('chat')
  } else { page = 'project'; libraryMode = false; render() }
  if (documentName) await openDocument(documentName, revision)
}
function skills() {
  modal('<span class="eyebrow">产品工作方法</span><h2>已内置项目立项 Skill</h2><p>从真实问题出发，与你一起补齐材料、标记假设，并形成有依据的阶段文档。</p><div class="skill-steps"><span>01 需求池</span><span>02 竞品分析</span><span>03 MVP 范围</span><span>04 立项报告</span></div><p>每个阶段完成后，等待你检查并确认。PRD 当前通过对话整理，专用 Skill 后续接入。</p>', '知道了', async () => {})
}
function discussionTemplates() {
  if (busy) { toast('请等待当前对话完成'); return }
  if (current?.completed && page === 'project') { toast('此项目已完成，可继续查看和编辑文档'); return }
  modal(`<span class="eyebrow">从一个具体问题开始</span><h2>选择讨论起点</h2><p>模板带入对话框后可以修改。发送后只处理当前阶段。</p><div class="template-list">${starters.map((item, index) => `<button type="button" class="template-card" data-template="${index}"><strong>${escape(item.title)}</strong><small>${escape(item.description)}</small></button>`).join('')}</div>`, null, async () => {})
  $('modal-content').onclick = event => {
    const button = event.target.closest('[data-template]')
    if (!button) return
    const template = starters[Number(button.dataset.template)]
    if (page === 'home') {
      modal(`<h2>为这次讨论创建项目</h2><p>${escape(template.description)}</p><label>产品名称<input name="name" required maxlength="80" autofocus placeholder="给你的想法一个名字"></label>`, '创建并带入模板', async data => {
        if (dirty) throw new Error('请先保存当前文档草稿')
        if (busy) throw new Error('请等待当前对话完成')
        page = 'project'; libraryMode = false; replace(await api('create', data.get('name'))); clearEditor(); applyTemplate(template)
      })
    } else {
      if ($('prompt').value.trim()) { toast('对话框已有内容，请先发送或清空后使用模板'); return }
      $('modal').close(); applyTemplate(template)
    }
  }
}
function applyTemplate(template) { view('chat'); $('prompt').value = template.prompt; drafts.set(current.id, template.prompt); $('prompt').focus() }
function renderSearch() {
  const matches = searchEntries(searchIndex, $('search-query').value, searchType)
  searchMatches = matches.slice(0, 50)
  searchSelection = Math.min(searchSelection, Math.max(0, searchMatches.length - 1))
  const labels = { project: '项目', document: '文档', evidence: '证据', message: '对话' }
  $('search-count').textContent = `找到 ${matches.length} 项${matches.length > 50 ? '，显示前 50 项，请缩小关键词' : ''} · ↑↓ 选择 · Enter 打开`
  $('search-results').innerHTML = searchMatches.length ? searchMatches.map((item, index) => `<button class="search-result ${index === searchSelection ? 'is-selected' : ''}" data-search-result="${index}"><span>${item.type === 'document' ? '▤' : item.type === 'evidence' ? '◎' : item.type === 'message' ? '◌' : '▧'}</span><div><strong>${escape(item.title)}</strong><small>${escape(item.projectName)} · ${labels[item.type]} · ${escape(stages[item.stage])}</small>${item.excerpt ? `<div class="search-context">${escape(item.excerpt)}</div>` : ''}</div><span>↗</span></button>`).join('') : '<p class="search-empty">没有找到相关内容</p>'
  $('search-filters').querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.searchType === searchType)))
}
async function search() {
  if ($('modal').open) return
  const revision = ++searchRevision
  $('search-query').value = ''; searchType = 'all'; searchSelection = 0
  projects = await api('boot').then(boot => boot.projects)
  if (revision !== searchRevision) return
  searchIndex = projectSearchEntries(projects)
  renderSearch(); if (!$('search-modal').open) $('search-modal').showModal(); $('search-query').focus()
  const results = await Promise.allSettled(recentDocuments().map(async item => ({ ...item, type: 'document', title: item.name, content: (await api('readDocument', item.projectId, item.name)).content })))
  if (revision !== searchRevision) return
  searchIndex.push(...results.filter(item => item.status === 'fulfilled').map(item => item.value))
  renderSearch()
  if (results.some(item => item.status === 'rejected')) toast('部分文档读取失败，请检查本地文件')
}
async function openSearchResult(index) {
  const item = searchMatches[index]
  if (!item) return
  if (dirty) { toast('请先保存当前文档草稿'); return }
  if (busy) { toast('请等待当前对话完成'); return }
  $('search-modal').close()
  await openProject(item.projectId, item.type === 'document' ? item.name : undefined)
  const target = item.type === 'message' ? document.querySelector(`[data-message-index="${item.messageIndex}"]`) : item.type === 'evidence' ? document.querySelector(`[data-evidence-id="${item.evidenceId}"]`) : null
  if (item.type === 'message') view('chat')
  if (target) { target.scrollIntoView({ block: 'center', behavior: 'instant' }); target.classList.add('search-highlight'); setTimeout(() => target.classList.remove('search-highlight'), 3000) }
}
function clearEditor() { ++editorRevision; $('editor').value = ''; draftHash = null; dirty = false; documentStage = current?.stage ?? null; documentSelection = ''; setEditorMode('source'); updateSaveState() }
function updateSaveState() {
  $('save-state').textContent = dirty ? '草稿未保存' : draftHash ? '已保存到本地' : '尚未保存'
  $('document-name').textContent = `${String((documentStage ?? current?.stage ?? 0) + 1).padStart(2, '0')}-${stages[documentStage ?? current?.stage ?? 0]}.md`
  $('document-history').disabled = busy || dirty || !draftHash
  $('document-copy').disabled = !$('editor').value.trim()
  $('document-discard').classList.toggle('hidden', !dirty)
  if (editorMode === 'read') renderDocumentPreview()
}
function renderDocumentPreview() {
  $('document-preview').innerHTML = $('editor').value.trim() ? `<div class="reading-hint">${dirty ? '正在预览未保存的草稿' : '选中段落，可引用到当前阶段对话'}</div><article class="markdown-content">${renderMarkdown($('editor').value)}</article>` : '<div class="document-empty">当前阶段还没有文档。<br>在源码中编写，或把对话回答载入草稿。</div>'
}
function setEditorMode(mode) {
  editorMode = mode; documentSelection = ''
  $('editor').classList.toggle('hidden', mode === 'read'); $('document-preview').classList.toggle('hidden', mode !== 'read')
  $('document-read').setAttribute('aria-pressed', String(mode === 'read')); $('document-source').setAttribute('aria-pressed', String(mode === 'source'))
  if (mode === 'read') renderDocumentPreview()
}
function setFocus(value) {
  focused = value; $('workspace').classList.toggle('is-focused', value)
  $('document-focus').setAttribute('aria-pressed', String(value)); $('document-focus').textContent = value ? '退出专注' : '专注阅读'
}
function view(mode) { if (mode !== 'document') setFocus(false); $('chat-view').classList.toggle('hidden', mode !== 'chat'); $('document-view').classList.toggle('hidden', mode !== 'document'); $('chat-tab').classList.toggle('active', mode === 'chat'); $('document-tab').classList.toggle('active', mode === 'document') }
async function openDocument(name, revision = ++navigationRevision) {
  if (dirty) throw new Error('请先保存当前草稿')
  const id = current.id, expectedEditor = editorRevision, data = await api('readDocument', id, name)
  if (revision !== navigationRevision || current.id !== id || expectedEditor !== editorRevision || dirty) return
  ++editorRevision; $('editor').value = data.content; draftHash = data.hash; documentStage = current.documents.find(item => item.name === name).stage; dirty = false; setEditorMode('read'); updateSaveState(); view('document'); render()
}
async function currentDocument() {
  if (!current) return
  if (dirty) { view('document'); return }
  const document = current.documents.find(item => item.stage === current.stage)
  if (document) await openDocument(document.name)
  else { clearEditor(); view('document'); render() }
}
async function reviewSave() {
  if (!current || busy) return
  const id = current.id, stage = documentStage ?? current.stage, content = $('editor').value.trim(), hash = draftHash, revision = editorRevision, navigation = navigationRevision, previousModal = modalRevision
  if (!content) throw new Error('文档内容不能为空')
  const name = `${String(stage + 1).padStart(2, '0')}-${stages[stage]}.md`
  let before = ''
  if (hash) {
    const saved = await api('readDocument', id, name)
    if (saved.hash !== hash) throw new Error('文档已发生变化，请重新打开后编辑，避免覆盖外部修改。可先复制当前草稿。')
    before = saved.content
  }
  if (current.id !== id || editorRevision !== revision || navigation !== navigationRevision || previousModal !== modalRevision || busy || $('modal').open) return
  const change = summarizeChanges(before, content + '\n')
  if (before === content + '\n') { ++editorRevision; $('editor').value = before; dirty = false; updateSaveState(); toast('文档内容没有变化'); return }
  modal(`<span class="eyebrow">保存前检查</span><h2>${draftHash ? '检查文档改动' : '检查新文档'}</h2><p>${escape(name)} · 只写入当前文档，保存后仍需确认阶段。</p><div class="save-review-summary"><strong>＋ ${change.added} 行</strong><strong>－ ${change.removed} 行</strong><span>已有版本将保留在历史中</span></div><div class="save-diff">${change.lines.map(line => `<div class="${line.kind}">${line.kind === 'added' ? '＋' : line.kind === 'removed' ? '－' : ' '} ${escape(line.text)}</div>`).join('')}</div>${change.truncated ? '<p>预览已截断；统计和保存使用完整正文。</p>' : ''}`, '确认保存', async () => {
    if (busy) throw new Error('请等待当前对话完成')
    const project = await api('saveDocument', id, { content, hash, stage })
    if (current.id !== id || editorRevision !== revision) { projects = [project, ...projects.filter(item => item.id !== id)]; toast('审核的版本已保存，当前编辑草稿继续保留'); return }
    dirty = false; replace(project); await openDocument(name)
    toast(current.confirmed.includes(stage) ? '修改已保存，版本历史可查看' : 'Markdown 已保存，等待你确认阶段')
  })
  $('modal').classList.add('review-settings')
}
async function showVersions() {
  if (!current || !draftHash || dirty || busy) return
  const id = current.id, name = $('document-name').textContent, editor = editorRevision, navigation = navigationRevision, previousModal = modalRevision
  const versions = await api('listVersions', id, name)
  if (current.id !== id || editor !== editorRevision || navigation !== navigationRevision || previousModal !== modalRevision || dirty || busy) return
  modal(`<span class="eyebrow">保留每一次修改</span><h2>文档版本历史</h2><p>${escape(name)} · 选择版本查看，载入草稿后再保存。</p><div class="version-list">${versions.length ? versions.map((item, index) => `<button type="button" class="version-entry" data-version="${escape(item.id)}"><div><strong>${new Date(item.createdAt).toLocaleString('zh-CN')}${index === 0 ? ' · 最近记录' : ''}</strong><small>${escape(item.hash.slice(0, 12))}</small></div><span>查看 ↗</span></button>`).join('') : '<p>还没有历史记录。下一次保存修改时会保留当前内容。</p>'}</div>`, null, async () => {})
  $('modal').classList.add('history-settings')
  $('modal-content').onclick = async event => {
    const button = event.target.closest('[data-version]')
    if (!button || button.disabled) return
    button.disabled = true
    const revision = modalRevision
    try {
      const version = await api('readVersion', id, name, button.dataset.version)
      if (!$('modal').open || revision !== modalRevision || current.id !== id || editor !== editorRevision || navigation !== navigationRevision || dirty) return
      modal(`<span class="eyebrow">历史正文</span><h2>${new Date(version.createdAt).toLocaleString('zh-CN')}</h2><p>载入只改变编辑草稿。确认保存后才替换当前文件，阶段状态保持不变。</p><div class="history-preview markdown-content">${renderMarkdown(version.content)}</div>`, '载入为草稿', async () => {
        if (current.id !== id || editor !== editorRevision || navigation !== navigationRevision || dirty) throw new Error('当前文档已经变化，请重新打开历史')
        ++editorRevision; $('editor').value = version.content; dirty = true; setEditorMode('source'); updateSaveState(); toast('历史版本已载入草稿，请检查后保存')
      })
      $('modal').classList.add('history-settings')
    } catch (error) { button.disabled = false; toast(error.message) }
  }
}
function addEvidence() {
  if (!current || busy) return
  modal('<span class="eyebrow">支持每一个结论</span><h2>添加证据与材料</h2><label>名称<input name="title" required maxlength="300" placeholder="这份材料说明了什么"></label><label>材料类型<select name="kind"><option value="provided">用户提供的信息</option><option value="verified">已核验的证据</option><option value="hypothesis">待验证假设</option></select></label><label>内容<textarea name="content" required maxlength="12000" rows="5" placeholder="粘贴材料、反馈或假设内容"></textarea></label><label>来源<input name="source" maxlength="2000" placeholder="链接、文件名或提供者；已核验证据必填"></label><p class="form-hint">“已核验”表示你已检查来源，不代表系统自动完成事实核验。</p>', '添加材料', async data => replace(await api('evidence', current.id, Object.fromEntries(data))))
}
async function send(input) {
  if (!current || busy || !input.trim()) return
  if (!hasKey) { settings(); return }
  const id = current.id
  busy = true; $('run-status').textContent = '正在梳理，请稍候'; render()
  try { const project = await api('send', id, input); $('prompt').value = ''; drafts.delete(id); replace(project) }
  catch (error) { toast(error.message); replace(await api('project', id)) }
  finally { busy = false; $('run-status').textContent = '先梳理，再产出'; render() }
}
function applyAppearance(mode) {
  appearance = mode
  const root = document.documentElement
  root.dataset.appearance = mode
  root.dataset.systemTheme = systemTheme
  root.dataset.theme = theme
  root.dataset.solidTheme = resolveTheme(theme, systemTheme)
  root.dataset.glassTone = resolveTheme(theme, systemTheme)
  root.style.setProperty('--glass-tint', String(1 - transparency / 100))
}
function updateAppearanceControls() {
  document.querySelectorAll('[data-appearance-option]').forEach(button => { button.setAttribute('aria-pressed', String(button.dataset.appearanceOption === appearance)); button.disabled = changingAppearance || changingTheme })
  const colors = $('color-options')
  const solid = appearance === 'system'
  if (colors) {
    const kind = solid ? 'solid' : 'glass'
    if (colors.dataset.kind !== kind) {
      colors.dataset.kind = kind
      const choices = solid ? themeNames : { light: '浅色', dark: '深色' }
      colors.innerHTML = Object.entries(choices).map(([value, name]) => `<button type="button" data-color-option="${value}">${name}</button>`).join('')
      colors.querySelectorAll('[data-color-option]').forEach(button => { button.onclick = () => changeColor(button.dataset.colorOption) })
    }
    colors.querySelectorAll('[data-color-option]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.colorOption === (solid ? theme : resolveTheme(theme, systemTheme))))
      button.disabled = changingAppearance || changingTheme
    })
    $('color-description').textContent = '切换材质时保留颜色'
  }
  const slider = $('range-transparency')
  if (slider) {
    $('transparency-control').classList.toggle('is-inactive', solid)
    $('transparency-control').inert = solid
    $('transparency-control').setAttribute('aria-hidden', String(solid))
    slider.disabled = changingAppearance || changingTheme || solid
    slider.value = transparency
    $('transparency-value').textContent = `${transparency}%`
  }
  const status = $('appearance-status')
  const colorStatus = theme === 'system' ? `跟随系统（${themeNames[systemTheme]}）` : themeNames[theme]
  if (status) status.textContent = changingAppearance || changingTheme ? '正在切换…' : savingTransparency ? '正在保存透明度…' : `当前：${appearanceNames[appearance]} · ${colorStatus}${solid ? '' : ` · 透明度 ${transparency}%`} · 下次打开沿用`
}
async function changeColor(value) {
  if (changingAppearance || changingTheme || value === theme) return
  changingTheme = true
  updateAppearanceControls()
  try {
    theme = await api('theme', value)
    applyAppearance(appearance)
  } catch (error) { toast(error.message) }
  finally { changingTheme = false; updateAppearanceControls() }
}
function previewTransparency(value) {
  const revision = ++transparencyRevision
  transparency = value
  applyAppearance(appearance)
  savingTransparency += 1
  updateAppearanceControls()
  // Send every change now; the main-process queue also drains when the window closes.
  const update = api('transparency', value)
  transparencyWrites = update.then(result => { savedTransparency = result }).catch(error => {
    if (transparencyRevision === revision) {
      transparency = savedTransparency
      applyAppearance(appearance)
    }
    toast(error.message)
  }).finally(() => { savingTransparency -= 1; updateAppearanceControls() })
}
function settings() {
  modal(`<span class="eyebrow">你的个人工作空间</span><h2>设置</h2><h3 class="settings-heading">界面外观</h3><p class="settings-description">切换材质，保留颜色和透明度。</p><div class="appearance-options" role="group" aria-label="界面外观">${Object.entries(appearanceNames).map(([mode, name]) => `<div class="appearance-choice"><button type="button" data-appearance-option="${mode}" class="appearance-option" aria-pressed="${mode === appearance}"><span class="appearance-swatch swatch-${mode}"><i></i><i></i><i></i></span><strong>${name}</strong><small>${mode === 'liquid' ? '通透 · 折射高光' : mode === 'frosted' ? '柔和 · 模糊透底' : '默认随系统 · 可手动切换'}</small></button></div>`).join('')}</div><div class="glass-tone-section"><h3 class="settings-heading">界面颜色 <span id="color-description"></span></h3><div id="color-options" class="glass-tone-options" role="group" aria-label="界面颜色"></div></div><div id="transparency-control" class="transparency-control"><div class="transparency-label"><label for="range-transparency">透明度</label><output id="transparency-value" for="range-transparency">${transparency}%</output></div><input id="range-transparency" type="range" min="0" max="100" step="1" value="${transparency}" aria-label="玻璃透明度"></div><p id="appearance-status" class="appearance-status" role="status" aria-live="polite"></p><div class="settings-divider"></div><h3 class="settings-heading">统一模型连接</h3><p>DeepSeek · ${escape(modelName)} · ${hasKey ? 'API Key 已配置' : '尚未配置 API Key'}</p><label>API Key<input name="key" type="password" autocomplete="off" placeholder="${hasKey ? '留空保留已有密钥' : '输入 API Key 后可开始对话'}"></label><p class="form-hint">产品梳理、Blueprint、GEO、开发与上线共用此配置。密钥通过 macOS 系统加密保存，已有密钥不会回显。</p>`, '完成', async data => {
    await transparencyWrites
    const value = String(data.get('key') ?? '').trim()
    if (value) { await api('key', value); hasKey = true; render(); toast('API Key 已加密保存') }
  })
  document.querySelectorAll('[data-appearance-option]').forEach(button => { button.onclick = async () => {
    if (changingAppearance || changingTheme || button.dataset.appearanceOption === appearance) return
    const previous = appearance, next = button.dataset.appearanceOption
    changingAppearance = true; updateAppearanceControls()
    try {
      // Cover the native backdrop before removing it; reveal glass only after native preparation.
      if (next === 'system') {
        applyAppearance(next); updateAppearanceControls()
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      }
      applyAppearance(await api('appearance', next))
    }
    catch (error) { applyAppearance(previous); toast(error.message) }
    finally { changingAppearance = false; updateAppearanceControls() }
  } })
  $('range-transparency').oninput = event => previewTransparency(Number(event.target.value))
  updateAppearanceControls()
  $('modal').classList.add('appearance-settings')
  $('cancel').textContent = '关闭'
}
$('new-project').onclick = newProject
for (const id of ['top-new-project', 'home-new-project']) $(id).onclick = newProject
$('nav-skills').onclick = skills
for (const id of ['home-templates', 'templates']) $(id).onclick = discussionTemplates
for (const id of ['nav-documents', 'all-documents']) $(id).onclick = () => showHome(true)
for (const id of ['search', 'home-search']) $(id).onclick = () => void search().catch(error => toast(error.message))
$('nav-home').onclick = () => showHome()
$('nav-geo').onclick = () => void showGeo().catch(error => toast(error.message))
$('sidebar-geo').onclick = () => void showGeo().catch(error => toast(error.message))
$('nav-blueprint').onclick = () => void showBlueprint().catch(error => toast(error.message))
$('sidebar-starter').onclick = () => void showBlueprint('starter').catch(error => toast(error.message))
$('sidebar-blueprint').onclick = () => void showBlueprint().catch(error => toast(error.message))
$('studio-start').onclick = event => {
  const action = event.target.closest('[data-studio-action]')?.dataset.studioAction
  if (action === 'geo') void showGeo().catch(error => toast(error.message))
  else if (action === 'conversation') newProject()
  else if (action === 'plan' || action === 'audit') void showBlueprint(action).catch(error => toast(error.message))
}
$('project-blueprint').onclick = () => void projectBlueprint().catch(error => toast(error.message))
$('rail-settings').onclick = settings
$('close-search').onclick = () => $('search-modal').close()
$('search-query').oninput = () => { searchSelection = 0; renderSearch() }
$('search-filters').onclick = event => { const button = event.target.closest('[data-search-type]'); if (button) { searchType = button.dataset.searchType; searchSelection = 0; renderSearch() } }
$('search-results').onclick = event => { const target = event.target.closest('[data-search-result]'); if (target) void openSearchResult(Number(target.dataset.searchResult)).catch(error => toast(error.message)) }
$('settings').onclick = settings
$('folder').onclick = () => api('openFolder', page === 'project' ? current?.id : undefined).catch(error => toast(error.message))
$('add-evidence').onclick = addEvidence
$('chat-tab').onclick = () => view('chat')
$('document-tab').onclick = () => currentDocument().catch(error => toast(error.message))
$('prompt').oninput = () => { if (current) drafts.set(current.id, $('prompt').value) }
$('prompt').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send($('prompt').value) } }
$('send').onclick = () => send($('prompt').value)
$('stop').onclick = async () => { try { await api('stop'); toast('已停止，保留已有对话') } catch (error) { toast(error.message) } }
$('generate').onclick = () => { view('chat'); void send('请根据目前对话和证据整理当前阶段的完整 Markdown 文档。已有事实注明来源，缺失信息列为待补充项，不要编造。只完成当前阶段并停住。') }
$('editor').oninput = () => { ++editorRevision; dirty = true; updateSaveState() }
$('document-read').onclick = () => setEditorMode('read')
$('document-source').onclick = () => setEditorMode('source')
$('document-focus').onclick = () => { setFocus(!focused); if (focused) setEditorMode('read') }
$('document-copy').onclick = () => api('copyText', $('editor').value).then(() => toast('已复制 Markdown')).catch(error => toast(error.message))
$('document-history').onclick = () => void showVersions().catch(error => toast(error.message))
$('document-discard').onclick = () => {
  if (busy || !dirty) return
  const id = current.id, stage = documentStage, revision = editorRevision, name = $('document-name').textContent
  modal('<h2>放弃未保存的修改？</h2><p>编辑器将回到本地已保存的文档，文件和版本历史都会保留。</p>', '放弃草稿', async () => {
    const saved = draftHash ? await api('readDocument', id, name) : null
    if (current.id !== id || editorRevision !== revision) throw new Error('草稿已经变化，请重新检查')
    ++editorRevision; $('editor').value = saved?.content ?? ''; draftHash = saved?.hash ?? null; documentStage = stage; dirty = false; setEditorMode(saved ? 'read' : 'source'); updateSaveState()
  })
}
document.addEventListener('selectionchange', () => {
  const selection = window.getSelection()
  if (selection?.rangeCount && $('document-preview').contains(selection.anchorNode) && $('document-preview').contains(selection.focusNode)) documentSelection = selection.toString().trim()
})
$('editor').onselect = () => { documentSelection = $('editor').value.slice($('editor').selectionStart, $('editor').selectionEnd).trim() }
$('document-quote').onclick = () => {
  if (!documentSelection) { toast('请先在文档中选中要引用的段落'); return }
  if (busy || current.completed) { toast('当前暂不能加入对话'); return }
  const quote = `关于文档「${$('document-name').textContent}」中的这段内容：\n${documentSelection.split('\n').map(line => `> ${line}`).join('\n')}\n\n我想讨论：`
  const input = `${$('prompt').value}${$('prompt').value.trim() ? '\n\n' : ''}${quote}`
  if (input.length > 20000) { toast('引用后超过对话长度，请缩短选段'); return }
  $('prompt').value = input
  drafts.set(current.id, $('prompt').value); view('chat'); $('prompt').focus()
}
$('search-modal').onkeydown = event => {
  if (event.isComposing || event.target.closest('[data-search-type],#close-search')) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); searchSelection = Math.max(0, Math.min(searchMatches.length - 1, searchSelection + (event.key === 'ArrowDown' ? 1 : -1))); renderSearch(); $('search-results').querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' })
  } else if (event.key === 'Enter') { event.preventDefault(); void openSearchResult(searchSelection).catch(error => toast(error.message)) }
}
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); void search().catch(error => toast(error.message)) }
  if (event.key === 'Escape' && focused && !$('modal').open && !$('search-modal').open) setFocus(false)
})
document.addEventListener('click', event => {
  const link = event.target.closest('.markdown-content a[href]')
  if (!link) return
  event.preventDefault(); void api('openLink', link.href).catch(error => toast(error.message))
})
$('save-document').onclick = () => void reviewSave().catch(error => toast(error.message))
$('confirm').onclick = () => {
  if (dirty) { toast('请先保存当前文档修改'); return }
  modal(`<span class="eyebrow">由你决定下一步</span><h2>确认「${stages[current.stage]}」完成？</h2><p>当前阶段文档已保存。请确认内容和证据足以支持继续。</p><div class="confirm-summary"><strong>${escape(current.documents.find(item => item.stage === current.stage)?.name)}</strong><p>${current.evidence.length} 份材料 · ${current.evidence.filter(item => item.kind === 'hypothesis').length} 项待验证假设</p></div><p>${current.stage === 4 ? '确认后将标记整个产品流程完成。' : `确认后进入「${stages[current.stage + 1]}」，不会自动调用模型。`}</p>`, '我已检查，确认完成', async () => { replace(await api('confirm', current.id)); clearEditor(); view('chat'); render(); toast(current.completed ? '产品流程已完成' : `已进入${stages[current.stage]}`) })
}
$('attach').onclick = async () => { try { const material = await api('import'); if (!material) return; addEvidence(); $('modal-form').elements.content.value = material.content; $('modal-form').elements.source.value = material.source; $('modal-form').elements.title.value = material.source.split('/').pop() } catch (error) { toast(error.message) } }
for (const id of ['projects', 'project-gallery', 'documents', 'document-library']) $(id).onclick = event => { const target = event.target.closest('[data-project]'); if (target) void openProject(target.dataset.project, target.dataset.document).catch(error => toast(error.message)) }
$('messages').onclick = async event => {
  const copy = event.target.closest('[data-copy-message]')
  if (copy) { try { await api('copyText', current.messages[Number(copy.dataset.copyMessage)].content); toast('已复制 Markdown') } catch (error) { toast(error.message) }; return }
  const target = event.target.closest('[data-draft]')
  if (!target || busy) return
  if (dirty) { toast('请先保存当前文档草稿'); return }
  const id = current.id, stage = current.stage, revision = ++draftRevision
  try {
    const message = current.messages[Number(target.dataset.draft)]
    if (message.stage !== stage) throw new Error('只能将当前阶段的回答用作当前阶段草稿')
    const preparation = currentDocument(), navigation = navigationRevision
    await preparation
    if (current.id !== id || current.stage !== stage || documentStage !== stage || navigation !== navigationRevision || revision !== draftRevision || dirty || busy || page !== 'project') return
    ++editorRevision; $('editor').value = message.content; setEditorMode('source'); documentStage = stage; dirty = true; updateSaveState(); render()
  } catch (error) { toast(error.message) }
}
$('evidence').onclick = event => { const target = event.target.closest('[data-remove]'); if (!target || busy) return; modal('<h2>移除这份材料？</h2><p>后续对话将不再引用它，已有文档和历史对话会保留。</p>', '移除材料', async () => replace(await api('removeEvidence', current.id, target.dataset.remove))) }
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = '' } })
window.aipm.onSystemTheme(theme => { systemTheme = theme; applyAppearance(appearance); updateAppearanceControls() })
try { const boot = await api('boot'); projects = boot.projects; hasKey = boot.hasKey; modelName = boot.model; document.querySelector('.model').textContent = 'DeepSeek · ' + modelName; systemTheme = boot.systemTheme; theme = boot.theme; transparency = boot.transparency; savedTransparency = boot.transparency; applyAppearance(boot.appearance); render(); for (const task of await api('blueprintList')) blueprintTaskIds.add(task.id); renderHome() }
catch (error) { toast(`启动失败：${error.message}`) }
