/** Embed the cloud AstrBot console while keeping connection credentials in the host. */
const tabs = [['console', '控制台'], ['connection', '连接与 API'], ['sources', '教程与来源']]
const backendStates = { waiting_server: '等待配置服务器', stopped: '管理连接已断开', connecting: '正在连接服务器', ready: '管理连接已就绪', failed: '连接失败' }
const qqStates = { unknown: '请在原版后台核对', waiting_server: '等待服务器', waiting_login: '等待扫码登录' }
const links = {
  qq: 'http://127.0.0.1:16081', gateway: 'http://127.0.0.1:15099',
  astrbot: 'https://github.com/AstrBotDevs/AstrBot', snowluma: 'https://snowluma.github.io/zh/docs/guide/deploy/docker/',
  video: 'https://www.douyin.com/video/7699913996312399119',
  personalityVideo: 'https://www.douyin.com/video/7700563396340616488',
  companionPack: 'https://github.com/zexuanw958-svg/dafeiyu-config-pack',
}

/** Mount explicit server controls; AstrBot owns chat, persona, plugins and memory. */
export function mountCompanion({ container, api, toast }) {
  const doc = container.ownerDocument, win = doc.defaultView
  const el = (tag, cls, text) => { const node = doc.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node }
  let data, tab = 'console', visible = false, disposed = false, busy = false, interval
  let visibilityRevision = 0, snapshotRevision = 0, consoleSlot, observer, boundsScheduled = false
  let nativeVisible = false, nativeQueue = Promise.resolve(), keyDraft = '', serverDraft, connectionDirty = false
  const page = el('div', 'fish-page'), hero = el('header', 'fish-hero'), emblem = el('div', 'fish-emblem', '鱼'), heading = el('div')
  heading.append(el('h1', '', '大肥鱼后台'), el('p', '', '云端运行 AstrBot + SnowLuma，在这里连接原版后台，管理人设、记忆和插件。'))
  hero.append(emblem, heading)
  const navigation = el('div', 'fish-tabs'); navigation.setAttribute('role', 'tablist'); navigation.setAttribute('aria-label', '大肥鱼后台')
  const content = el('div', 'fish-content'); page.append(hero, navigation, content); container.append(page)
  const report = (error, fallback = '操作未完成') => { if (visible && !disposed) toast(error?.message || fallback) }
  const button = (label, action, cls = 'v2-button') => {
    const node = el('button', cls, label); node.type = 'button'
    node.onclick = () => { if (!disposed) void Promise.resolve().then(action).catch(report) }
    return node
  }
  const note = text => el('p', 'fish-note', text)
  const card = (title, description) => { const node = el('section', 'fish-card'); node.append(el('h2', '', title)); if (description) node.append(note(description)); return node }
  const openLink = (label, url) => button(label, () => api('openLink', url), 'v2-button fish-link')
  for (const [id, label] of tabs) {
    const node = button(label, () => {
      if (id === tab) return
      ++visibilityRevision; tab = id; hideNative(); render()
    }, 'fish-tab')
    node.dataset.tab = id; node.setAttribute('role', 'tab'); navigation.append(node)
  }
  const consoleReady = () => visible && !disposed && tab === 'console' && data?.backend?.running && data.backend.state === 'ready'
  const currentSlot = (revision, slot) => revision === visibilityRevision && consoleReady() && slot === consoleSlot && slot?.isConnected
  function queueNative(operation) {
    const pending = nativeQueue.then(operation)
    nativeQueue = pending.catch(error => report(error, '原版控制台暂时无法显示'))
    return nativeQueue
  }
  function hideNative() {
    nativeVisible = false
    // Hide immediately so the host can cancel a pending page load.
    const hidden = Promise.resolve().then(() => api('companionHideConsole')).catch(error => report(error, '控制台尚未隐藏'))
    nativeQueue = Promise.all([nativeQueue, hidden]).then(() => {})
    return hidden
  }
  function slotBounds(slot) {
    const rect = slot.getBoundingClientRect()
    return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
  }
  function showNative() {
    const revision = visibilityRevision, slot = consoleSlot
    return queueNative(async () => {
      if (!currentSlot(revision, slot)) return
      const rect = slotBounds(slot)
      if (rect.width <= 0 || rect.height <= 0) return
      if (nativeVisible) { await api('companionConsoleBounds', rect); return }
      const shown = await api('companionShowConsole', rect)
      if (shown === false) throw new Error('原版控制台显示已取消')
      if (!currentSlot(revision, slot)) { await api('companionHideConsole'); nativeVisible = false; return }
      nativeVisible = true
    })
  }
  function scheduleBounds() {
    if (boundsScheduled || !consoleReady()) return
    boundsScheduled = true
    queueMicrotask(() => { boundsScheduled = false; if (consoleReady()) void showNative() })
  }
  win.addEventListener('resize', scheduleBounds)
  container.addEventListener('scroll', scheduleBounds, true)
  function drawTabs() {
    for (const node of navigation.children) {
      const selected = node.dataset.tab === tab
      node.setAttribute('aria-selected', String(selected)); node.tabIndex = selected ? 0 : -1
    }
  }
  function status(label, value, ready) {
    const node = el('div', 'fish-status-row')
    node.append(el('span', '', label), el('strong', `fish-status${ready ? ' ready' : ''}`, value))
    return node
  }
  function serverSteps() {
    const section = card('准备云服务器', '先由你在云平台创建服务器并完成账号、费用和登录设置；这里不会自动购买云资源。')
    const steps = el('ol', 'fish-steps')
    for (const text of ['选择 2 核 4G、40GB 系统盘，Ubuntu 22.04 或 24.04 x64，并分配公网 IPv4。', '绑定 SSH 密钥；安全组仅向你当前的公网 IP 开放 TCP 22，不公开后台管理端口。', '先完成 Docker 和 Compose 环境准备；云平台支持预装 Docker 时可直接选择。', '在“连接与 API”保存服务器地址、SSH 用户名与私钥位置，再保存大肥鱼独立 API Key。', '点击“部署 AstrBot + SnowLuma”，完成后连接后台，并在原版界面登录和配置 QQ。']) steps.append(el('li', '', text))
    section.append(steps); return section
  }
  function renderConsole() {
    const overview = card('AstrBot 原版后台'), states = el('div', 'fish-states')
    states.append(status('后台', backendStates[data.backend.state] || '状态未知', data.backend.state === 'ready'), status('QQ', qqStates[data.qq.state] || '请在原版后台核对', false))
    overview.append(states, note(`AstrBot ${data.engine.versions.astrbot} · SnowLuma ${data.engine.versions.snowluma}`))
    const actions = el('div', 'fish-actions')
    const start = button('连接后台', () => act('companionStart'), 'v2-button primary'), stop = button('断开管理连接', async () => { await hideNative(); await act('companionStop') }), open = button('打开原版控制台', showNative)
    start.disabled = busy || connectionDirty || !data.connection.configured || data.deployment.state !== 'deployed' || data.backend.running || data.backend.state === 'connecting'
    stop.disabled = busy || (!data.backend.running && data.backend.state !== 'connecting')
    open.disabled = busy || !consoleReady()
    actions.append(start, stop, open); overview.append(actions)
    if (connectionDirty) overview.append(note('服务器信息尚未保存，请回到“连接与 API”保存后再连接。'))
    overview.append(note('断开管理连接或关闭 Mac 工作台，只会关闭本机 SSH 隧道，不会停止云端 AstrBot 和 SnowLuma。QQ 是否登录成功，请在原版后台核对。'))
    if (data.backend.error) overview.append(el('p', 'v2-error', data.backend.error))
    const surface = el('section', 'fish-console-shell')
    consoleSlot = el('div', 'fish-console-slot'); consoleSlot.setAttribute('aria-label', 'AstrBot 原版控制台')
    if (!consoleReady()) {
      const placeholder = el('div', 'fish-console-placeholder')
      placeholder.append(el('strong', '', data.backend.state === 'connecting' ? '正在连接云端后台' : '原版控制台尚未连接'), note(!data.connection.configured ? '先在“连接与 API”保存服务器和独立 API 设置。' : data.deployment.state !== 'deployed' ? '请先在“连接与 API”部署固定版本的原版后台。' : '点击“连接后台”，通过本机 SSH 隧道显示原版界面。'))
      consoleSlot.append(placeholder)
    }
    surface.append(consoleSlot); content.append(overview, surface)
    if (!data.connection.configured || data.deployment.state !== 'deployed') content.append(serverSteps())
    if (typeof win.ResizeObserver === 'function') { observer = new win.ResizeObserver(scheduleBounds); observer.observe(consoleSlot) }
    if (consoleReady()) scheduleBounds(); else if (nativeVisible) hideNative()
  }
  function passwordField(label, draft, placeholder, onInput) {
    const field = el('label', 'fish-field', label), input = el('input')
    input.type = 'password'; input.autocomplete = 'off'; input.maxLength = 2000; input.spellcheck = false
    input.value = draft; input.placeholder = placeholder; input.setAttribute('aria-label', label)
    input.oninput = () => onInput(input.value); input.disabled = busy; field.append(input)
    return { field, input }
  }
  function renderConnection() {
    const server = card('服务器连接', '使用 SSH 密钥连接你指定的服务器。管理后台仅通过本机隧道访问，不需要公开后台端口。')
    if (!serverDraft) serverDraft = { host: data.connection.host || '', port: String(data.connection.port || 22), user: data.connection.user || '', identityFile: data.connection.identityFile || '' }
    const serverForm = el('form', 'fish-server-form'), serverFields = el('div', 'fish-server-fields')
    let deploy
    function serverField(name, label, type = 'text') {
      const field = el('label', 'fish-field', label), input = el('input')
      input.name = name; input.type = type; input.value = serverDraft[name]; input.autocomplete = 'off'; input.spellcheck = false; input.disabled = busy; input.setAttribute('aria-label', label)
      input.oninput = () => { serverDraft[name] = input.value; connectionDirty = true; if (deploy) deploy.disabled = true }
      field.append(input); serverFields.append(field); return input
    }
    serverField('host', '服务器地址').placeholder = '服务器公网 IPv4 或域名'
    const port = serverField('port', 'SSH 端口', 'number'); port.min = '1'; port.max = '65535'
    serverField('user', 'SSH 用户名').placeholder = '云平台设置的实际登录用户名'
    const identity = serverField('identityFile', 'SSH 私钥位置'); identity.readOnly = true
    const serverActions = el('div', 'fish-actions'), saveServer = el('button', 'v2-button primary', '保存服务器连接'); saveServer.type = 'submit'; saveServer.disabled = busy
    const pick = button('选择 SSH 私钥', async () => {
      if (busy) return
      busy = true; render()
      try { const path = await api('companionPickKey'); if (!disposed && typeof path === 'string' && path) { serverDraft.identityFile = path; connectionDirty = true } }
      finally { busy = false; render() }
    }); pick.disabled = busy
    serverActions.append(pick, saveServer); serverForm.append(serverFields, serverActions)
    serverForm.onsubmit = event => {
      event.preventDefault()
      const values = { host: serverDraft.host, port: Number(serverDraft.port), user: serverDraft.user, identityFile: serverDraft.identityFile }
      void act('companionSaveConnection', values).then(done => {
        if (!done) return
        serverDraft = { ...values, port: String(values.port) }; connectionDirty = false
        if (visible) { render(); toast('服务器连接已保存') }
      }).catch(report)
    }
    server.append(serverForm, note(connectionDirty ? '服务器信息尚未保存，部署和连接使用上次已保存的设置。' : data.connection.configured ? '服务器连接已保存。' : '服务器尚未配置。'))
    const deployment = card('部署云端后台', `点击部署将在指定服务器的 ${data.deployment.directory} 安装固定官方版本 AstrBot ${data.engine.versions.astrbot} 和 SnowLuma ${data.engine.versions.snowluma}，并使用大肥鱼独立 API。`)
    deploy = button('部署 AstrBot + SnowLuma', () => { if (connectionDirty) { toast('请先保存服务器连接'); return }; return act('companionDeploy') }, 'v2-button primary'); deploy.disabled = busy || !data.connection.configured || !data.model.configured || connectionDirty
    const deploymentActions = el('div', 'fish-actions'); deploymentActions.append(deploy)
    deployment.append(note(data.deployment.state === 'deployed' ? '云端后台已部署，可连接后台并登录。' : data.deployment.prepared ? '独立配置已初始化，容器尚未完成启动。可重试部署以继续启动。' : '尚未部署。保存服务器连接和独立 API 后，再手动开始部署。'), note('专用 API Key 和会话数据会保存在你指定的云服务器私有目录中。'), deploymentActions)
    const model = card('大肥鱼独立 API', '专用 DeepSeek API Key 在本机加密保存，不会共用、修改或回退使用工作台模型凭据。留空保存会保留已有密钥。')
    model.append(note(`${data.model.name || 'DeepSeek'} · ${data.model.configured ? '独立密钥已配置' : '独立密钥尚未配置'} · ${data.model.remoteSync === 'synced' ? '云端已同步' : '云端待同步'}`))
    const keyForm = el('form'), key = passwordField('大肥鱼 API Key', keyDraft, data.model.configured ? '已配置，留空保留' : '输入大肥鱼专用 API Key', value => { keyDraft = value })
    const save = el('button', 'v2-button primary', '保存独立 API Key'); save.type = 'submit'; save.disabled = busy
    const keyActions = el('div', 'fish-actions'); keyActions.append(save); keyForm.append(key.field, keyActions)
    keyForm.onsubmit = event => {
      event.preventDefault(); keyDraft = key.input.value
      void act('companionModelKey', keyDraft).then(done => { if (done) { keyDraft = ''; if (visible) { render(); toast('独立 API 设置已保存') } } }).catch(report)
    }
    model.append(keyForm)
    const qq = card('QQ 登录与网关', '连接后台后，打开云端 SnowLuma 的原版登录页完成扫码，再在 AstrBot 原版后台配置平台接入。后台连接成功不代表 QQ 已登录。')
    qq.append(status('QQ 状态', qqStates[data.qq.state] || '请在原版后台核对', false))
    const accounts = [data.settings.botQQ ? `机器人 QQ ${data.settings.botQQ}` : '', data.settings.owner?.qq ? `本人 QQ ${data.settings.owner.qq}` : ''].filter(Boolean)
    if (accounts.length) qq.append(note(accounts.join(' · ')))
    const external = el('div', 'fish-actions'), login = openLink('登录 QQ ↗', links.qq), gateway = openLink('打开 SnowLuma 网关 ↗', links.gateway)
    login.disabled = busy || !data.backend.running; gateway.disabled = busy || !data.backend.running; external.append(login, gateway); qq.append(external)
    if (data.qq.error) qq.append(el('p', 'v2-error', data.qq.error))
    content.append(server, model, deployment, qq, note('人设、会话记忆、白名单和用量请在“控制台”的原版界面管理。保存连接、凭据或打开此页不会自动发送模型请求。'))
    if (!data.connection.configured) content.append(serverSteps())
  }
  function renderSources() {
    const source = card('教程与实现来源', '云端采用官方 AstrBot 与 SnowLuma，原版后台负责机器人运行和数据管理。Mac 工作台负责独立 API 设置和 SSH 管理连接。'), sourceLinks = el('div', 'fish-source-links')
    sourceLinks.append(openLink('原视频教程 ↗', links.video), openLink('性格与记忆教程 ↗', links.personalityVideo), openLink('大肥鱼配置包 ↗', links.companionPack), openLink('AstrBot 官方项目 ↗', links.astrbot), openLink('SnowLuma 官方部署说明 ↗', links.snowluma))
    source.append(sourceLinks, note('性格、分段回复、表情包、长期记忆、主动聊天和豆包语音采用现成大肥鱼配置包及其原版插件，具体设置和运行状态在 AstrBot 控制台查看。'), note(`固定部署 AstrBot ${data.engine.versions.astrbot} 与 SnowLuma ${data.engine.versions.snowluma}。断开 Mac 管理连接后，云端服务继续运行。`))
    const scope = card('当前接入范围')
    scope.append(note('QQ：是否扫码登录、平台连接成功，请在 SnowLuma 和 AstrBot 原版后台核对。'), note('B站和抖音：尚未安装和验证对应插件。'), note('三平台共享记忆尚未验证，当前不作互通承诺。'))
    content.append(source, scope, serverSteps())
  }
  function render() {
    if (disposed || !visible) return
    observer?.disconnect(); observer = undefined; consoleSlot = undefined; drawTabs(); content.replaceChildren()
    if (!data) { content.append(note('正在读取后台状态…')); return }
    if (tab === 'console') renderConsole()
    if (tab === 'connection') renderConnection()
    if (tab === 'sources') renderSources()
  }
  async function act(name, ...args) {
    if (busy || !visible || disposed) return false
    busy = true; const request = ++snapshotRevision
    for (const node of content.querySelectorAll('button,input')) node.disabled = true
    try { const next = await api(name, ...args); if (!disposed && request === snapshotRevision) data = next; return !disposed }
    finally { busy = false; if (visible && !disposed) render() }
  }
  async function refresh() {
    const request = ++snapshotRevision, revision = visibilityRevision, next = await api('companionSnapshot')
    if (disposed || !visible || revision !== visibilityRevision || request !== snapshotRevision) return
    if (JSON.stringify(data) === JSON.stringify(next)) return
    data = next
    if (!busy && (tab !== 'connection' || !content.contains(doc.activeElement))) render()
  }
  return {
    canLeave: () => true,
    async openConsole() {
      if (disposed || !visible) throw new Error('大肥鱼界面尚未显示')
      ++visibilityRevision; tab = 'console'; hideNative(); render()
      if (consoleReady()) await showNative()
      if (disposed || !visible || tab !== 'console') throw new Error('大肥鱼界面显示已取消')
    },
    async show() {
      if (disposed) return
      visible = true; const revision = ++visibilityRevision; win.clearInterval(interval); render(); await refresh()
      if (!visible || disposed || revision !== visibilityRevision) return
      interval = win.setInterval(() => { if (!busy) void refresh().catch(report) }, 4000)
    },
    hide() { visible = false; ++visibilityRevision; ++snapshotRevision; win.clearInterval(interval); observer?.disconnect(); hideNative() },
    destroy() {
      disposed = true; visible = false; ++visibilityRevision; ++snapshotRevision; win.clearInterval(interval); observer?.disconnect()
      win.removeEventListener('resize', scheduleBounds); container.removeEventListener('scroll', scheduleBounds, true)
      keyDraft = ''; serverDraft = undefined; for (const input of content.querySelectorAll('input')) input.value = ''
      hideNative(); page.remove()
    },
  }
}
