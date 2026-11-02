/** Keyless recordings of workbench navigation and the cloud AstrBot surface. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { mountWorkbench } from './app.mjs'
import { mountCompanion } from './companion.mjs'

const settle = () => new Promise(resolve => setTimeout(resolve, 15))
const snapshot = () => ({
  engine: { name: 'AstrBot + SnowLuma', versions: { astrbot: '4.29.3', snowluma: '2.2.0' }, source: 'official' },
  settings: { botQQ: '12345678', owner: { qq: '98765432' } },
  connection: { host: '', port: 22, user: '', identityFile: '', configured: false },
  model: { name: 'deepseek-flash', configured: false, independent: true, remoteSync: 'pending' },
  backend: { running: false, state: 'waiting_server', error: '' },
  qq: { connected: false, state: 'waiting_server', error: '' },
  deployment: { state: 'not_deployed', directory: '/opt/aipm-dafeiyu' },
})
const configuredSnapshot = () => {
  const data = snapshot()
  data.connection = { host: 'fixture.example.invalid', port: 22, user: 'ubuntu', identityFile: '/fixture/id_ed25519', configured: true }
  data.backend.state = 'stopped'; data.qq.state = 'unknown'
  return data
}
const modelCalls = ['key', 'piSend', 'companionChat', 'companionForget', 'companionSave']
const obsoleteCalls = ['companionStartQQ', 'companionStopQQ']
function fixture(initial = snapshot()) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'file:///fixture/v2/index.html' })
  const { window } = dom, container = window.document.getElementById('root'), calls = [], rect = { x: 280, y: 360, width: 960, height: 520 }, intervals = new Map()
  window.HTMLElement.prototype.getBoundingClientRect = function () { return this.classList.contains('fish-console-slot') ? { ...rect } : { x: 0, y: 0, width: 1400, height: 1000 } }
  let data = structuredClone(initial), intervalId = 0
  window.setInterval = callback => { const id = ++intervalId; intervals.set(id, callback); return id }
  window.clearInterval = id => intervals.delete(id)
  const api = async (name, ...args) => {
    calls.push([name, ...args])
    if (name === 'boot') return { theme: 'dark', appearance: 'system' }
    if (name === 'piList') return []
    if (name === 'piCatalog') return { projects: [] }
    if (name === 'piStatus') return { model: 'workbench-model' }
    if (name === 'modelStatus') return { schema: 1, model: 'deepseek-v4-pro', choices: [{ id: 'deepseek-v4-pro', label: 'Pro' }, { id: 'deepseek-flash', label: 'Flash（V4.1）' }] }
    if (name === 'companionPickKey') return '/fixture/selected_ed25519'
    if (name === 'companionSaveConnection') data.connection = { ...args[0], configured: true }
    if (name === 'companionDeploy') data.deployment.state = 'deployed'
    if (name === 'companionStart') { data.backend = { running: true, state: 'ready', error: '' }; data.qq.state = 'waiting_login' }
    if (name === 'companionStop') data.backend = { running: false, state: 'stopped', error: '' }
    if (name === 'companionModelKey' && args[0]) data.model.configured = true
    if (['companionSnapshot', 'companionSaveConnection', 'companionDeploy', 'companionStart', 'companionStop', 'companionModelKey'].includes(name)) return structuredClone(data)
  }
  const button = label => [...container.querySelectorAll('button')].find(node => !node.closest('[hidden]') && (node.textContent.trim() === label || node.getAttribute('aria-label') === label))
  const input = name => container.querySelector(`input[name="${name}"]`)
  const enter = (node, value) => { node.value = value; node.dispatchEvent(new window.Event('input', { bubbles: true })) }
  const poll = async () => { assert.equal(intervals.size, 1, 'one visible companion poll is registered on its window'); for (const callback of [...intervals.values()]) await callback(); await settle() }
  return { dom, window, container, calls, api, button, input, enter, poll, rect, intervals, setData: value => { data = structuredClone(value) } }
}

test('cloud navigation waits for a saved server and deployment without making model or QQ-start requests', async () => {
  const f = fixture(), view = await mountWorkbench({ ...f, events: {}, moduleFactory: () => ({ hide() {}, destroy() {}, canLeave: () => true }) })
  try {
    assert.deepEqual([...f.container.querySelectorAll('.v2-nav button')].map(node => node.getAttribute('aria-label')), ['聊天', '项目', '视频生成', '工具', '大肥鱼后台'])
    f.button('大肥鱼后台').click(); await settle()
    assert.equal(f.container.querySelector('.v2-workbench').dataset.page, 'companion')
    assert.deepEqual([...f.container.querySelectorAll('.fish-tab')].map(node => [node.textContent, node.getAttribute('aria-selected')]), [['控制台', 'true'], ['连接与 API', 'false'], ['教程与来源', 'false']])
    assert.match(f.container.querySelector('.fish-content').textContent, /AstrBot.*SnowLuma/s)
    assert.equal(f.button('连接后台').disabled, true)
    f.button('连接后台').click(); await settle()
    assert.equal(f.container.querySelector('iframe'), null)
    assert.equal(f.container.querySelector('.fish-history,.fish-memory,textarea[name=persona]'), null)
    assert.equal(f.calls.some(([name]) => ['companionStart', 'companionDeploy', 'companionShowConsole', ...modelCalls, ...obsoleteCalls].includes(name)), false)
    let copy = f.container.querySelector('.fish-content').textContent
    f.button('连接与 API').click(); await settle()
    copy += f.container.querySelector('.fish-content').textContent
    assert.equal(f.button('部署 AstrBot + SnowLuma').disabled, true)
    f.button('部署 AstrBot + SnowLuma').click(); await settle()
    assert.equal(f.button('登录 QQ ↗').disabled, true)
    assert.equal(f.button('打开 SnowLuma 网关 ↗').disabled, true)
    f.button('教程与来源').click(); await settle()
    copy += f.container.querySelector('.fish-content').textContent
    assert.match(copy, /2\s*核\s*4\s*G/i)
    assert.match(copy, /Ubuntu\s*22\.04/); assert.match(copy, /24\.04/)
    assert.match(copy, /x64/); assert.match(copy, /40\s*GB/i); assert.match(copy, /IPv4/)
    assert.match(copy, /SSH/); assert.match(copy, /22/)
    assert.doesNotMatch(copy, /AuthToken|LLBot|QQ\s*(?:已)?在线/)
    f.button('原视频教程 ↗').click(); await settle()
    assert.deepEqual(f.calls.filter(([name]) => name === 'openLink').at(-1), ['openLink', 'https://www.douyin.com/video/7699913996312399119'])
    await view.show('chat'); await settle()
    assert.equal(f.container.querySelector('.v2-workbench').dataset.page, 'chat')
    assert.equal(f.calls.at(-1)[0], 'companionHideConsole')
    assert.equal(f.calls.some(([name]) => ['companionDeploy', 'companionStart', ...modelCalls, ...obsoleteCalls].includes(name)), false)
  } finally { view.destroy(); await settle(); f.dom.window.close() }
})

test('server and password drafts survive tabs, hiding, and unfocused polling until explicitly saved', async () => {
  const f = fixture(), view = mountCompanion({ ...f, toast() {} })
  const expectDrafts = () => {
    assert.equal(f.input('host').value, 'draft.example.invalid')
    assert.equal(f.input('port').value, '22022')
    assert.equal(f.input('user').value, 'fixture-user')
    assert.equal(f.input('identityFile').value, '/fixture/selected_ed25519')
    assert.equal(f.container.querySelector('input[aria-label="大肥鱼 API Key"]').value, 'fixture-companion-key')
  }
  try {
    await view.show(); f.button('连接与 API').click(); await settle()
    assert.equal(f.input('port').type, 'number'); assert.equal(f.input('identityFile').readOnly, true)
    let key = f.container.querySelector('input[aria-label="大肥鱼 API Key"]')
    assert.equal(key.type, 'password'); assert.equal(key.value, '')
    f.enter(f.input('host'), 'draft.example.invalid'); f.enter(f.input('port'), '22022'); f.enter(f.input('user'), 'fixture-user')
    f.enter(key, 'fixture-companion-key')
    f.button('选择 SSH 私钥').click(); await settle(); expectDrafts()
    assert.deepEqual(f.calls.find(([name]) => name === 'companionPickKey'), ['companionPickKey'])
    f.button('教程与来源').click(); await settle(); f.button('连接与 API').click(); await settle(); expectDrafts()
    view.hide(); await settle(); assert.equal(f.intervals.size, 0)
    await view.show(); await settle(); expectDrafts()
    key = f.container.querySelector('input[aria-label="大肥鱼 API Key"]'); key.focus(); key.blur()
    assert.equal(f.container.contains(f.window.document.activeElement), false)
    const next = configuredSnapshot(); next.backend.error = 'fixture status changed'; f.setData(next)
    await f.poll(); expectDrafts()
    assert.equal(f.container.textContent.includes('fixture-companion-key'), false)
    assert.equal(f.calls.some(([name]) => ['companionSaveConnection', 'companionDeploy', 'companionStart', 'companionModelKey', ...modelCalls, ...obsoleteCalls].includes(name)), false)
    f.button('保存服务器连接').click(); await settle()
    assert.deepEqual(f.calls.find(([name]) => name === 'companionSaveConnection'), ['companionSaveConnection', { host: 'draft.example.invalid', port: 22022, user: 'fixture-user', identityFile: '/fixture/selected_ed25519' }])
    expectDrafts()
    assert.equal(f.calls.some(([name]) => ['companionDeploy', 'companionStart', 'companionModelKey', ...modelCalls, ...obsoleteCalls].includes(name)), false)
    f.button('保存独立 API Key').click(); await settle()
    assert.deepEqual(f.calls.find(([name]) => name === 'companionModelKey'), ['companionModelKey', 'fixture-companion-key'])
    assert.equal(f.container.querySelector('input[aria-label="大肥鱼 API Key"]').value, '')
    f.button('保存独立 API Key').click(); await settle()
    assert.deepEqual(f.calls.filter(([name]) => name === 'companionModelKey').at(-1), ['companionModelKey', ''])
    assert.match(f.container.textContent, /独立密钥已配置/)
    await f.poll()
    assert.equal(f.calls.some(([name]) => ['companionDeploy', 'companionStart', ...modelCalls, ...obsoleteCalls].includes(name)), false)
  } finally { view.destroy(); await settle(); assert.equal(f.intervals.size, 0); f.dom.window.close() }
})

test('deploying and connecting are separate explicit actions and preserve cloud ownership in the UI', async () => {
  const f = fixture(configuredSnapshot()), view = mountCompanion({ ...f, toast() {} })
  try {
    await view.show(); assert.equal(f.button('连接后台').disabled, true)
    assert.match(f.container.textContent, /断开管理连接.*Mac.*不会停止云端.*AstrBot.*SnowLuma/s)
    f.button('连接与 API').click(); await settle()
    assert.equal(f.button('部署 AstrBot + SnowLuma').disabled, true)
    f.enter(f.container.querySelector('input[aria-label="大肥鱼 API Key"]'), 'fixture-dedicated-key')
    f.button('保存独立 API Key').click(); await settle()
    assert.equal(f.button('部署 AstrBot + SnowLuma').disabled, false)
    const copy = f.container.textContent
    assert.match(copy, /4\.29\.3/); assert.match(copy, /2\.2\.0/); assert.match(copy, /\/opt\/aipm-dafeiyu/)
    assert.match(copy, /独立.*API/s)
    await f.poll()
    assert.equal(f.calls.some(([name]) => ['companionDeploy', 'companionStart'].includes(name)), false)
    f.button('部署 AstrBot + SnowLuma').click(); await settle()
    assert.deepEqual(f.calls.find(([name]) => name === 'companionDeploy'), ['companionDeploy'])
    assert.equal(f.calls.some(([name]) => name === 'companionStart'), false)
    f.button('控制台').click(); await settle(); assert.equal(f.button('连接后台').disabled, false)
    f.button('连接后台').click(); await settle()
    assert.deepEqual(f.calls.find(([name]) => name === 'companionStart'), ['companionStart'])
    assert.deepEqual(f.calls.find(([name]) => name === 'companionShowConsole'), ['companionShowConsole', f.rect])
    f.rect.width = 900; f.window.dispatchEvent(new f.window.Event('resize')); await settle()
    assert.deepEqual(f.calls.filter(([name]) => name === 'companionConsoleBounds').at(-1), ['companionConsoleBounds', f.rect])
    assert.doesNotMatch(f.container.querySelector('.fish-content').textContent, /QQ\s*(?:已)?在线/)
    f.button('连接与 API').click(); await settle(); assert.equal(f.calls.at(-1)[0], 'companionHideConsole')
    assert.equal(f.button('登录 QQ ↗').disabled, false); assert.equal(f.button('打开 SnowLuma 网关 ↗').disabled, false)
    f.button('登录 QQ ↗').click(); await settle()
    assert.deepEqual(f.calls.filter(([name]) => name === 'openLink').at(-1), ['openLink', 'http://127.0.0.1:16081'])
    f.button('打开 SnowLuma 网关 ↗').click(); await settle()
    assert.deepEqual(f.calls.filter(([name]) => name === 'openLink').at(-1), ['openLink', 'http://127.0.0.1:15099'])
    f.button('控制台').click(); await settle(); f.button('断开管理连接').click(); await settle()
    assert.deepEqual(f.calls.find(([name]) => name === 'companionStop'), ['companionStop'])
    assert.equal(f.calls.some(([name]) => [...modelCalls, ...obsoleteCalls].includes(name)), false)
  } finally { view.destroy(); await settle(); f.dom.window.close() }
})

test('a late native open cannot reappear after hiding or changing tabs', async () => {
  const data = configuredSnapshot(); data.deployment.state = 'deployed'; data.backend = { running: true, state: 'ready', error: '' }
  const f = fixture(data)
  let completeOpen
  const base = f.api
  const view = mountCompanion({ ...f, toast() {}, api: (name, ...args) => {
    const result = base(name, ...args)
    if (name === 'companionShowConsole') return new Promise(resolve => { completeOpen = resolve })
    return result
  } })
  try {
    await view.show(); await settle(); assert.equal(typeof completeOpen, 'function')
    view.hide(); await settle(); assert.equal(f.calls.at(-1)[0], 'companionHideConsole')
    completeOpen(); await settle(); assert.equal(f.calls.at(-1)[0], 'companionHideConsole')
    const shown = f.calls.filter(([name]) => name === 'companionShowConsole').length
    f.window.dispatchEvent(new f.window.Event('resize')); await settle()
    assert.equal(f.calls.filter(([name]) => name === 'companionShowConsole').length, shown)
    await view.show(); await settle(); f.button('连接与 API').click(); await settle(); completeOpen(); await settle()
    assert.equal(f.calls.at(-1)[0], 'companionHideConsole')
    assert.equal(f.container.querySelector('.fish-console-slot'), null)
  } finally { view.destroy(); await settle(); f.dom.window.close() }
})

test('explicit host navigation opens the original console and acknowledges renderer readiness without starting cloud work', async () => {
  const data = configuredSnapshot(); data.deployment.state = 'deployed'; data.backend = { running: true, state: 'ready', error: '' }
  const f = fixture(data)
  let openCompanion, removed = false
  const events = { onCompanionOpen(callback) { openCompanion = callback; return () => { removed = true } }, companionControlReady() {} }
  const view = await mountWorkbench({ ...f, events, moduleFactory: () => ({ hide() {}, destroy() {}, canLeave: () => true }) })
  try {
    assert.equal(typeof openCompanion, 'function')
    assert.ok(f.calls.some(([name]) => name === 'companionControlReady'))
    await openCompanion(); await settle()
    assert.equal(f.container.querySelector('.v2-workbench').dataset.page, 'companion')
    assert.equal(f.container.querySelector('.fish-tab[aria-selected="true"]').textContent, '控制台')
    assert.ok(f.calls.some(([name]) => name === 'companionShowConsole'))
    f.button('连接与 API').click(); await settle()
    await openCompanion(); await settle()
    assert.equal(f.container.querySelector('.fish-tab[aria-selected="true"]').textContent, '控制台')
    assert.equal(f.calls.some(([name]) => ['companionStart', 'companionDeploy', 'companionSaveConnection', 'companionModelKey', ...modelCalls].includes(name)), false)
  } finally { view.destroy(); await settle(); assert.equal(removed, true); f.dom.window.close() }
})
