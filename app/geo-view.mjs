/** Five-step GEO workspace; async generation preserves editor focus and saved campaign identity. */
import { renderMarkdown } from './assets/document-format.js'
import { geoCopy as C, geoDemo } from './geo-copy.mjs'
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const names = Object.keys(C.platformNames)
/** Mount an isolated GEO route using only the constrained main-process API. */
export function mountGeo({ container, api, toast }) {
  let campaign = null, history = [], step = 0, platform = 'toutiao', dirty = false, visible = false, pending = false, timer = null, revision = 0, health = null, editing = false, draftProfile = null
  const running = () => campaign?.status === 'running'
  const button = (action, label, disabled = false, style = 'secondary') => `<button type="button" class="${style}" data-geo-action="${action}" ${disabled ? 'disabled' : ''}>${esc(label)}</button>`
  const guard = () => { if (dirty) { toast(C.unsaved); return false } return true }
  function schedule() {
    clearTimeout(timer)
    if (!visible || !running()) return
    const id = campaign.id, token = revision
    timer = setTimeout(async () => {
      try {
        const next = await api('geoGet', id)
        if (!visible || revision !== token || campaign?.id !== id) return
        const ended = next.status !== 'running'
        campaign = next
        if (ended) { history = await api('geoList'); if (revision !== token) return; render() }
        else schedule()
      } catch (error) { toast(error.message); schedule() }
    }, 1500)
  }
  function stepAvailable(index) { return campaign && (index === 0 || index === 1 && campaign.keywords.length || index === 2 && campaign.keywords.some(x => x.selected) || index === 3 && campaign.article || index === 4 && campaign.reviewed) }
  function fields() {
    const p = draftProfile || campaign.profile
    return `<form id="geo-profile-form" class="geo-form">${Object.entries(C.labels).map(([key, label]) => {
      const id = `geo-${key}`, value = p[key] || ''
      return `<label for="${id}" class="${['facts', 'avoid', 'services', 'objective'].includes(key) ? 'geo-wide' : ''}">${esc(label)}${key === 'businessType' ? `<select id="${id}" name="${key}">${Object.entries(C.business).map(([v, text]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${text}</option>`).join('')}</select>` : ['facts', 'avoid', 'audience', 'objective', 'services'].includes(key) ? `<textarea id="${id}" name="${key}" rows="${key === 'facts' ? 5 : 2}" maxlength="${key === 'facts' ? 12000 : 1500}" placeholder="${esc(key === 'facts' ? C.factsPlaceholder : key === 'services' ? C.servicesPlaceholder : '')}">${esc(value)}</textarea>` : `<input id="${id}" name="${key}" value="${esc(value)}" maxlength="100" ${key === 'brand' ? `placeholder="${C.titlePlaceholder}"` : ''}>`}</label>`
    }).join('')}<p class="geo-wide geo-hint">${C.profileHint}</p><div class="geo-wide geo-actions">${button('profile', C.saveProfile, pending || running(), 'primary')}</div></form>`
  }
  function keywordView() {
    return `<p class="geo-hint">${C.keywordHint}</p><div id="geo-keywords">${campaign.keywords.map((row, i) => `<div class="geo-keyword-row"><input type="checkbox" data-geo-keep="${i}" aria-label="${C.selected} ${esc(row.text)}" ${row.selected ? 'checked' : ''}><input data-geo-word="${i}" aria-label="${C.keyword} ${i + 1}" value="${esc(row.text)}" maxlength="100">${button(`remove-${i}`, C.remove)}</div>`).join('')}</div><div class="geo-actions">${button('add', C.add)}${button('keywords', C.saveKeywords, pending || running(), 'primary')}</div>`
  }
  function editor(target, article) {
    return `<div class="geo-editor-head">${button(editing ? 'preview' : 'edit', editing ? C.preview : C.edit)}${button(target === 'article' ? 'save-article' : 'save-variant', target === 'article' ? C.saveArticle : C.saveVariant, pending || running())}</div><div class="geo-editor ${editing ? '' : 'hidden'}"><label for="geo-title">${C.titleLabel}</label><input id="geo-title" value="${esc(article.title)}" maxlength="180"><label for="geo-body">${C.bodyLabel}</label><textarea id="geo-body" rows="16" maxlength="30000">${esc(article.body)}</textarea></div><article class="geo-preview markdown-content ${editing ? 'hidden' : ''}">${renderMarkdown(`# ${article.title}\n\n${article.body}`)}</article>`
  }
  function articleView() {
    return `<div class="geo-topic"><label for="geo-topic">${C.topic}<select id="geo-topic">${campaign.keywords.filter(row => row.selected).map(row => `<option ${row.text === campaign.topic?.keyword ? 'selected' : ''}>${esc(row.text)}</option>`).join('')}</select></label><label for="geo-type">${C.type}<select id="geo-type">${C.types.map(type => `<option ${type === campaign.topic?.type ? 'selected' : ''}>${type}</option>`).join('')}</select></label></div><p class="geo-hint">${C.draftHint}</p><div class="geo-actions">${button('article', campaign.article ? C.regenerate : C.generate, pending || running(), 'primary')}${campaign.article ? button('adapt', Object.keys(campaign.variants).length ? C.goVariants : C.adapt, pending || running()) : ''}</div>${campaign.article ? editor('article', campaign.article) : `<div class="geo-empty">${C.noArticle}</div>`}`
  }
  function variantView() {
    const article = campaign.variants[platform]
    return `<p class="geo-hint">${C.checkHint}</p><div class="geo-actions">${button('regenerate-variants', C.adapt, pending || running())}</div>${article ? `<div class="geo-platforms" role="group" aria-label="${C.selectPlatform}">${names.map(name => `<button data-geo-platform="${name}" aria-pressed="${name === platform}">${C.platformNames[name]}</button>`).join('')}</div>${editor(platform, article)}<div class="geo-checks">${(campaign.checks[platform] || []).map(issue => `<p class="geo-${issue.level}"><strong>${issue.level === 'block' ? C.blocked : C.warning}</strong> ${esc(issue.message)}</p>`).join('')}</div><label class="geo-review"><input id="geo-reviewed" type="checkbox" ${campaign.reviewed ? 'checked' : ''}>${C.review}</label><div class="geo-actions">${button('review', C.confirmReview, pending || running(), 'primary')}</div>` : `<div class="geo-empty">${C.noVariants}</div>`}`
  }
  function exportView() {
    return `<div class="geo-export-summary"><span class="geo-success">✓</span><h2>${C.exportReady}</h2><p>${C.exportHint}</p><p class="geo-hint">${C.noMonitor}</p><div class="geo-actions">${button('export', C.export, pending || running(), 'primary')}${campaign.exports.length ? button('open-export', C.exported) : ''}</div><p class="geo-hint">${campaign.exports.length ? C.exportCount(campaign.exports.length) : C.noExport}</p></div>`
  }
  function render() {
    container.innerHTML = `<header class="geo-header"><div><span class="eyebrow">${C.eyebrow}</span><h1>${C.title}</h1><p>${C.subtitle}</p></div><div class="geo-actions">${button('new', C.new, pending || running())}${button('example', C.example, pending || running())}</div></header><div class="geo-layout"><aside class="geo-history"><h2>${C.recent}</h2>${history.length ? history.map(item => `<button data-geo-id="${item.id}" class="${campaign?.id === item.id ? 'selected' : ''}"><strong>${esc(item.name)}</strong><small>${C.statuses[item.status] || C.statuses.draft}</small></button>`).join('') : `<p class="geo-hint">${C.empty}</p>`}</aside><main class="geo-main">${campaign ? `<nav class="geo-steps" aria-label="${C.title}">${C.steps.map((name, index) => `<button data-geo-step="${index}" aria-current="${step === index ? 'step' : 'false'}" ${!stepAvailable(index) || running() ? 'disabled' : ''}><span>${index + 1}</span>${name}</button>`).join('')}</nav><div class="geo-status"><span>${C.statuses[campaign.status] || C.statuses.draft}${dirty ? ` · ${C.unsaved}` : ''}</span><span>${C.usageValue(campaign.usage)}</span></div>${campaign.profile.demo || draftProfile?.demo ? `<p class="geo-notice">${C.exampleHint}</p>` : ''}${campaign.error ? `<p class="geo-error" role="alert">${esc(campaign.error)}</p>` : ''}${health?.configured === false ? `<p class="geo-notice">${C.noKey}</p>` : ''}${running() ? `<p class="geo-running" role="status">${C.running} ${button('cancel', C.cancel)}</p>` : ''}<fieldset class="geo-body" ${pending || running() ? 'disabled' : ''}>${step === 0 ? fields() : step === 1 ? keywordView() : step === 2 ? articleView() : step === 3 ? variantView() : exportView()}</fieldset>` : `<div class="geo-empty"><h2>${C.title}</h2><p>${C.empty}</p>${button('example', C.example, false, 'primary')}</div>`}</main></div>`
    schedule()
  }
  function readEditor() { return { title: container.querySelector('#geo-title').value, body: container.querySelector('#geo-body').value } }
  async function action(name) {
    if (['new', 'example'].includes(name)) {
      if (!guard()) return
      campaign = await api('geoCreate'); ++revision; step = 0; editing = false
      draftProfile = name === 'example' ? structuredClone(geoDemo) : null; dirty = Boolean(draftProfile)
      history = await api('geoList'); render(); return
    }
    if (!campaign) return
    if (name === 'cancel') { campaign = await api('geoCancel', campaign.id); history = await api('geoList'); render(); return }
    if (name === 'profile') {
      const data = Object.fromEntries(new FormData(container.querySelector('#geo-profile-form')))
      data.demo = (draftProfile || campaign.profile).demo
      campaign = await api('geoSaveProfile', campaign.id, data); dirty = false; draftProfile = null
      if (!campaign.diagnosis.ready) { toast(`${C.gap}：${campaign.diagnosis.gaps.join('、')}`); render(); return }
      campaign = await api('geoKeywords', campaign.id); history = await api('geoList'); step = 1
    } else if (name === 'add' || name.startsWith('remove-')) {
      captureKeywords(); if (name === 'add') campaign.keywords.push({ text: '', selected: true }); else campaign.keywords.splice(Number(name.slice(7)), 1)
      dirty = true
    } else if (name === 'keywords') {
      captureKeywords(); campaign = await api('geoSaveKeywords', campaign.id, campaign.keywords); dirty = false; step = 2
    } else if (name === 'edit') { editing = true }
    else if (name === 'preview') {
      const value = readEditor()
      if (step === 2) campaign.article = value; else campaign.variants[platform] = value
      editing = false
    } else if (name === 'save-article' || name === 'save-variant') {
      const value = editing ? readEditor() : step === 2 ? campaign.article : campaign.variants[platform]
      campaign = await api('geoSaveContent', campaign.id, step === 2 ? 'article' : platform, value); dirty = false; editing = false; toast(C.savedToast)
    } else if (name === 'article') {
      if (!guard()) return
      const options = { keyword: container.querySelector('#geo-topic').value, type: container.querySelector('#geo-type').value }
      campaign = await api('geoGenerate', campaign.id, 'article', options); editing = false
    } else if (name === 'adapt' || name === 'regenerate-variants') {
      if (!guard()) return
      step = 3; editing = false
      if (!Object.keys(campaign.variants).length || name === 'regenerate-variants') campaign = await api('geoGenerate', campaign.id, 'adapt')
    } else if (name === 'review') {
      if (!guard()) return
      if (!container.querySelector('#geo-reviewed')?.checked) { toast(C.reviewRequired); return }
      campaign = await api('geoReview', campaign.id, true); step = 4
    } else if (name === 'export') {
      campaign = await api('geoExport', campaign.id); toast(C.exportToast)
    } else if (name === 'open-export') { await api('geoOpenExport', campaign.id); return }
    history = await api('geoList'); render()
  }
  function captureKeywords() { container.querySelectorAll('[data-geo-word]').forEach(node => { const index = Number(node.dataset.geoWord); campaign.keywords[index].text = node.value; campaign.keywords[index].selected = container.querySelector(`[data-geo-keep="${index}"]`).checked }) }
  container.addEventListener('input', event => {
    if (event.target.closest('#geo-profile-form,.geo-editor,#geo-keywords')) {
      dirty = true
      const status = container.querySelector('.geo-status>span'); if (status) status.textContent = C.unsaved
      if (event.target.closest('#geo-profile-form')) draftProfile = { ...Object.fromEntries(new FormData(container.querySelector('#geo-profile-form'))), demo: (draftProfile || campaign.profile).demo }
    }
  })
  container.addEventListener('change', event => { if (event.target.matches('[data-geo-keep]')) dirty = true })
  container.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button || pending) return
    if (button.dataset.geoStep != null) { if (guard()) { step = Number(button.dataset.geoStep); editing = false; render() } return }
    if (button.dataset.geoPlatform) { if (guard()) { platform = button.dataset.geoPlatform; editing = false; render() } return }
    if (button.dataset.geoId) {
      if (!guard()) return
      const token = ++revision; pending = true
      void api('geoGet', button.dataset.geoId).then(value => { if (token !== revision) return; campaign = value; draftProfile = null; step = value.reviewed ? 4 : Object.keys(value.variants).length ? 3 : value.article ? 2 : value.keywords.length ? 1 : 0; editing = false; render() }).catch(error => toast(error.message)).finally(() => { pending = false; if (visible && token === revision) render() })
      return
    }
    if (button.dataset.geoAction) {
      if (pending) return
      const name = button.dataset.geoAction
      pending = true
      const operation = action(name)
      const fieldset = container.querySelector('.geo-body'); if (fieldset) fieldset.disabled = true
      void operation.then(() => { pending = false; if (visible) render() }).catch(error => { pending = false; const body = container.querySelector('.geo-body'); if (body) body.disabled = running(); toast(error.message) })
    }
  })
  container.addEventListener('submit', event => event.preventDefault())
  return {
    async show() { visible = true; const token = ++revision; history = await api('geoList'); health = await api('geoStatus'); if (token !== revision || !visible) return; if (campaign && !dirty) campaign = await api('geoGet', campaign.id); if (token !== revision || !visible) return; render() },
    hide() { visible = false; ++revision; clearTimeout(timer) },
    hasUnsaved() { return dirty },
    destroy() { visible = false; ++revision; clearTimeout(timer); container.replaceChildren() },
  }
}
