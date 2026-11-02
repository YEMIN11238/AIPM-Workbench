/** Keyless local control recordings; services, connection data and failures are fixtures. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CompanionControl, claimCompanionInstance, parseCompanionControl, validateCompanionControl } from './control.mjs'

const tick = () => new Promise(resolve => setImmediate(resolve))
const connection = () => ({ host: 'fixture.example.invalid', port: 22022, user: 'fixture-user', identityFile: '/fixture/nonsecret-key-path' })
const request = (action = 'status', extra = {}) => ({ requestId: randomUUID(), action, ...extra })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const secret = 'fixture-secret-never-returned'
const safeStatus = () => ({
  engine: { name: 'AstrBot + SnowLuma', versions: { astrbot: '4.29.3', snowluma: '2.2.0' } },
  connection: { configured: true },
  model: { name: 'deepseek-flash', configured: true, independent: true, remoteSync: 'synced' },
  backend: { running: false, state: 'stopped' },
  qq: { connected: false, state: 'unknown' },
  deployment: { state: 'deployed', prepared: true },
})
function privateSnapshot() {
  const data = safeStatus()
  for (const value of [data, ...Object.values(data), data.engine.versions]) Object.assign(value, { apiKey: secret, token: secret, keyHash: secret, path: '/fixture/secret-output-path' })
  Object.assign(data.connection, { host: 'private.example.invalid', port: 22, user: 'private-user', identityFile: '/fixture/private-key-path' })
  Object.assign(data.backend, { error: secret }); Object.assign(data.qq, { error: secret })
  Object.assign(data.deployment, { directory: '/fixture/private-deployment', note: secret })
  Object.assign(data.engine, { source: '/fixture/private-source' })
  data.settings = { botQQ: '12345678', owner: { qq: '98765432' }, apiKey: secret }
  return data
}
function fixture(options = {}) {
  const sandbox = mkdtempSync(join(tmpdir(), 'aipm-control-')), root = join(sandbox, 'companion')
  mkdirSync(root, { mode: 0o700 })
  const calls = [], data = privateSnapshot()
  const service = {
    async snapshot(...args) { calls.push(['snapshot', ...args]); return structuredClone(data) },
    async saveConnection(...args) { calls.push(['saveConnection', ...args]); return structuredClone(data) },
    async deploy(...args) { calls.push(['deploy', ...args]); return structuredClone(data) },
    async start(...args) { calls.push(['start', ...args]); data.backend.running = true; data.backend.state = 'ready'; return structuredClone(data) },
    async stop(...args) { calls.push(['stop', ...args]); data.backend.running = false; data.backend.state = 'stopped'; return structuredClone(data) },
  }
  let serviceReads = 0
  const control = new CompanionControl({ root, ready: options.ready, service: () => { serviceReads++; return service }, openCompanion: async (...args) => { calls.push(['openCompanion', ...args]) }, ...options })
  const directory = id => join(root, 'control-requests', id)
  const read = (id, name) => JSON.parse(readFileSync(join(directory(id), name + '.json'), 'utf8'))
  const close = () => { control.close(); rmSync(sandbox, { recursive: true, force: true }) }
  return { sandbox, root, calls, service, control, data, directory, read, close, serviceReads: () => serviceReads }
}
function assertResult(result, req, ok) {
  assert.equal(result.requestId, req.requestId); assert.equal(result.action, req.action); assert.equal(result.ok, ok)
  assert.match(result.completedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  assert.equal(Number.isNaN(Date.parse(result.completedAt)), false)
  assert.deepEqual(Object.keys(result).sort(), ['action', 'completedAt', ok ? 'status' : 'error', 'ok', 'requestId'].sort())
}

test('control parser accepts either explicit JSON flag and leaves unrelated arguments alone', () => {
  assert.equal(parseCompanionControl(['/fixture/electron', '/fixture/app', '--inspect=0', '--normal-flag']), null)
  for (const action of ['status', 'deploy', 'connect', 'disconnect', 'open-companion', 'save-connection']) {
    const req = request(action, action === 'save-connection' ? { connection: connection() } : {}), json = JSON.stringify(req)
    assert.deepEqual(parseCompanionControl(['/fixture/app', '--normal-flag', '--companion-control', json, '--other']), req)
    assert.deepEqual(parseCompanionControl(['/fixture/app', '--companion-control=' + json, '--normal-flag']), req)
    const validated = validateCompanionControl(req)
    assert.deepEqual(validated, req); assert.notEqual(validated, req)
    if (req.connection) assert.notEqual(validated.connection, req.connection)
  }
})

test('invalid controls reject secrets, arbitrary methods, destinations and traversal with one generic error', () => {
  const valid = request(), save = request('save-connection', { connection: connection() })
  const invalid = [
    null, [], secret, {}, { ...valid, requestId: '../escape' }, { ...valid, requestId: '/tmp/escape' },
    { ...valid, requestId: 'A1234567-1234-1234-1234-123456789abc' }, { ...valid, requestId: valid.requestId + '/result.json' },
    { ...valid, requestId: valid.requestId.replaceAll('-', '') }, { ...valid, action: 'save-model-key' },
    { ...valid, action: 'constructor' }, { ...valid, action: 'start' }, { ...valid, connection: connection() },
    request('save-connection'), { ...save, connection: null }, { ...save, connection: [] },
    ...['apiKey', 'token', 'command', 'method', 'path', 'resultPath', 'root', '__proto__'].map(key => JSON.parse(JSON.stringify(valid).slice(0, -1) + ',' + JSON.stringify(key) + ':' + JSON.stringify(secret) + '}')),
    ...['apiKey', 'token', 'command', 'method', 'path', 'password', 'privateKey'].map(key => ({ ...save, connection: { ...save.connection, [key]: secret } })),
    ...[0, 65536, -1, 22.5, '22', null].map(port => ({ ...save, connection: { ...save.connection, port } })),
    ...['host', 'user', 'identityFile'].flatMap(key => ['', 'fixture\n' + secret, 'fixture\0' + secret, 'x'.repeat(4097), null].map(value => ({ ...save, connection: { ...save.connection, [key]: value } }))),
    { ...save, connection: { ...save.connection, identityFile: '../../outside' } },
    { ...save, connection: { ...save.connection, identityFile: '~/.ssh/id_ed25519' } },
  ]
  let generic
  for (const value of invalid) assert.throws(() => validateCompanionControl(value), error => {
    assert.equal(error instanceof Error, true)
    generic ??= error.message; assert.equal(error.message, generic); assert.equal(error.message.includes(secret), false)
    return true
  })
  const json = JSON.stringify(valid)
  for (const argv of [
    ['--companion-status'], ['--companion-control'], ['--companion-control='], ['--companion-control', secret],
    ['--companion-control', '{' + secret], ['--companion-control=' + ' '.repeat(12001)],
    ['--companion-control', json, '--companion-control=' + json], ['--companion-control=' + json, '--companion-control', json],
    ['--companion-control=' + json, '--companion-unknown'], ['--companion-control-extra=' + json],
  ]) assert.throws(() => parseCompanionControl(argv), error => error.message === generic)
})

test('single-instance ownership forwards only validated controls and focuses ordinary launches', () => {
  const fakeApp = locked => {
    const app = new EventEmitter(), calls = []
    app.requestSingleInstanceLock = (...args) => { calls.push(['lock', ...args]); return locked }
    app.quit = (...args) => { calls.push(['quit', ...args]) }
    return { app, calls }
  }
  const primary = fakeApp(true), initial = request('status'), submitted = [], rejected = [], focused = []
  const handlers = { submit: (...args) => submitted.push(args), focus: (...args) => focused.push(args), rejected: (...args) => rejected.push(args) }
  assert.equal(claimCompanionInstance({ app: primary.app, request: initial, ...handlers }), true)
  assert.deepEqual(primary.calls, [['lock', { companionControl: initial }]])
  assert.deepEqual(submitted, [[initial]]); assert.notEqual(submitted[0][0], initial)
  assert.equal(primary.app.listenerCount('second-instance'), 1)
  const forwarded = request('connect'), fallback = request('disconnect')
  primary.app.emit('second-instance', {}, ['--companion-control', 'reordered-or-invalid-json'], '/fixture', { companionControl: forwarded })
  primary.app.emit('second-instance', {}, ['/fixture/app', '--companion-control=' + JSON.stringify(fallback)], '/fixture', {})
  assert.deepEqual(submitted, [[initial], [forwarded], [fallback]])
  primary.app.emit('second-instance', {}, ['/fixture/app', '--ordinary-flag'], '/fixture', {})
  assert.deepEqual(focused, [[]])
  for (const invalid of [request('arbitrary-ipc'), request('status', { method: 'piSend' }), request('deploy', { apiKey: secret }), request('open-companion', { command: secret })]) {
    primary.app.emit('second-instance', {}, ['--companion-control', JSON.stringify(fallback)], '/fixture', { companionControl: invalid })
  }
  primary.app.emit('second-instance', {}, ['--companion-control', '{' + secret], '/fixture', {})
  assert.deepEqual(submitted, [[initial], [forwarded], [fallback]])
  assert.deepEqual(focused, [[]]); assert.deepEqual(rejected, [[], [], [], [], []])
  const secondary = fakeApp(false), secondarySubmissions = [], req = request('deploy')
  assert.equal(claimCompanionInstance({ app: secondary.app, request: req, ...handlers, submit: (...args) => secondarySubmissions.push(args) }), false)
  assert.deepEqual(secondary.calls, [['lock', { companionControl: req }], ['quit']])
  assert.deepEqual(secondarySubmissions, []); assert.equal(secondary.app.listenerCount('second-instance'), 0)
  const ordinary = fakeApp(true), ordinarySubmissions = []
  assert.equal(claimCompanionInstance({ app: ordinary.app, request: null, ...handlers, submit: (...args) => ordinarySubmissions.push(args) }), true)
  assert.deepEqual(ordinary.calls, [['lock', {}]]); assert.deepEqual(ordinarySubmissions, [])
  const invalidInitial = fakeApp(true)
  assert.throws(() => claimCompanionInstance({ app: invalidInitial.app, request: request('status', { token: secret }), ...handlers }), /控制请求无效/)
  assert.deepEqual(invalidInitial.calls, [])
})

test('each explicit action dispatches only its own method on the supplied service instance', async () => {
  const f = fixture()
  try {
    const actions = ['status', 'save-connection', 'deploy', 'connect', 'disconnect', 'open-companion'], expected = []
    for (const action of actions) {
      const req = request(action, action === 'save-connection' ? { connection: connection() } : {})
      const result = await f.control.submit(req)
      assertResult(result, req, true)
      if (action === 'save-connection') expected.push(['saveConnection', req.connection])
      if (action === 'deploy') expected.push(['deploy'])
      if (action === 'connect') { expected.push(['start']); assert.equal(result.status.backend.running, true) }
      if (action === 'disconnect') { expected.push(['stop']); assert.equal(result.status.backend.running, false) }
      if (action === 'open-companion') expected.push(['openCompanion', req.requestId])
      expected.push(['snapshot'])
      assert.deepEqual(f.calls, expected)
      assert.deepEqual(f.read(req.requestId, 'request'), req)
      assert.deepEqual(f.read(req.requestId, 'result'), result)
    }
    assert.equal(f.serviceReads(), actions.length, 'one service lookup per request shares action and final snapshot')
  } finally { f.close() }
})

test('readiness delays service dispatch and request files, and close refuses pending or future accepts', async () => {
  const ready = deferred(), f = fixture({ ready: ready.promise }), req = request('connect')
  try {
    const pending = f.control.submit(req)
    await tick()
    assert.deepEqual(f.calls, []); assert.equal(f.serviceReads(), 0)
    assert.equal(existsSync(join(f.root, 'control-requests')), false)
    ready.resolve(); const result = await pending
    assertResult(result, req, true); assert.deepEqual(f.calls, [['start'], ['snapshot']])
    f.control.close(); await assert.rejects(f.control.submit(request()), /关闭/)
    assert.equal(readdirSync(join(f.root, 'control-requests')).length, 1)
  } finally { ready.resolve(); f.close() }
  const waiting = deferred(), closed = fixture({ ready: waiting.promise })
  try {
    const pending = closed.control.submit(request('deploy'))
    const rejected = assert.rejects(pending, /关闭/)
    closed.control.close(); waiting.resolve(); await rejected
    assert.deepEqual(closed.calls, []); assert.equal(closed.serviceReads(), 0)
    assert.equal(existsSync(join(closed.root, 'control-requests')), false)
  } finally { waiting.resolve(); closed.close() }
})

test('status files contain only the public state whitelist and use private directories and files', async () => {
  const f = fixture(), req = request()
  try {
    const result = await f.control.submit(req)
    assertResult(result, req, true); assert.deepEqual(result.status, safeStatus())
    const stored = readFileSync(join(f.directory(req.requestId), 'result.json'), 'utf8')
    for (const privateValue of [secret, '/fixture/', 'private.example.invalid', 'private-user', '12345678', '98765432']) assert.equal(stored.includes(privateValue), false)
    assert.deepEqual(f.read(req.requestId, 'result'), result)
    for (const path of [f.root, join(f.root, 'control-requests'), f.directory(req.requestId)]) assert.equal(statSync(path).mode & 0o777, 0o700)
    for (const name of ['request', 'result']) {
      const metadata = statSync(join(f.directory(req.requestId), name + '.json'))
      assert.equal(metadata.mode & 0o777, 0o600); assert.equal(metadata.isFile(), true); assert.equal(metadata.nlink, 1)
    }
    assert.deepEqual(readdirSync(f.directory(req.requestId)).sort(), ['request.json', 'result.json'])
  } finally { f.close() }
})

test('a request UUID is claimed once across concurrent and completed submissions without overwrites', async () => {
  const f = fixture(), deployed = deferred(), req = request('deploy')
  f.service.deploy = async (...args) => { f.calls.push(['deploy', ...args]); await deployed.promise }
  try {
    const pending = f.control.submit(req); await tick()
    assert.deepEqual(f.calls, [['deploy']])
    const path = join(f.directory(req.requestId), 'request.json'), bytes = readFileSync(path, 'utf8'), inode = statSync(path).ino
    await assert.rejects(f.control.submit(req), { code: 'EEXIST' })
    assert.equal(existsSync(join(f.directory(req.requestId), 'result.json')), false)
    assert.deepEqual(f.calls, [['deploy']])
    deployed.resolve(); const result = await pending
    const resultBytes = readFileSync(join(f.directory(req.requestId), 'result.json'), 'utf8')
    await assert.rejects(f.control.submit({ ...req, action: 'disconnect' }), { code: 'EEXIST' })
    assert.equal(readFileSync(path, 'utf8'), bytes); assert.equal(statSync(path).ino, inode)
    assert.equal(readFileSync(join(f.directory(req.requestId), 'result.json'), 'utf8'), resultBytes)
    assert.deepEqual(f.read(req.requestId, 'result'), result); assert.deepEqual(f.calls, [['deploy'], ['snapshot']])
  } finally { deployed.resolve(); f.close() }
})

test('invalid submissions never create request destinations or dispatch service methods', async () => {
  const f = fixture()
  try {
    for (const value of [request('arbitrary-command'), request('status', { apiKey: secret }), { requestId: '../../outside', action: 'status' }]) await assert.rejects(f.control.submit(value), /控制请求无效/)
    assert.deepEqual(f.calls, []); assert.equal(f.serviceReads(), 0)
    assert.deepEqual(readdirSync(f.root), [])
  } finally { f.close() }
})

test('symlink roots, shared result bases and preclaimed linked files cannot redirect control artifacts', async () => {
  for (const target of ['root', 'base', 'request-link', 'hardlinked-result']) {
    const f = fixture(), outside = join(f.sandbox, 'outside'), sentinel = join(outside, 'result.json'), req = request()
    mkdirSync(outside, { mode: 0o700 }); writeFileSync(sentinel, secret, { mode: 0o600 })
    const originalRoot = f.root
    try {
      if (target === 'root') {
        const linkedRoot = join(f.sandbox, 'linked-root'); symlinkSync(outside, linkedRoot); f.control.root = linkedRoot
      } else if (target === 'base') symlinkSync(outside, join(f.root, 'control-requests'))
      else {
        const base = join(f.root, 'control-requests'); mkdirSync(base, { mode: 0o700 })
        if (target === 'request-link') symlinkSync(outside, f.directory(req.requestId))
        else { mkdirSync(f.directory(req.requestId), { mode: 0o700 }); linkSync(sentinel, join(f.directory(req.requestId), 'result.json')) }
      }
      await assert.rejects(f.control.submit(req))
      assert.equal(readFileSync(sentinel, 'utf8'), secret); assert.deepEqual(readdirSync(outside), ['result.json'])
      assert.deepEqual(f.calls, []); assert.equal(f.serviceReads(), 0)
      if (target === 'hardlinked-result') assert.equal(statSync(sentinel).nlink, 2)
    } finally { f.control.root = originalRoot; f.close() }
  }
})

test('service failures persist fixed public errors without raw secrets or partial status', async () => {
  const f = fixture()
  const cases = [
    ['Host key verification failed', 'ssh_host_key'], ['SSH 密钥验证失败', 'ssh_auth'],
    ['请先保存独立 API Key', 'independent_key_required'], ['系统加密不可用', 'independent_key_required'],
    ['Docker unavailable', 'server_environment'], ['不会重复初始化', 'existing_deployment'],
    ['独立密钥已变更', 'prepared_mismatch'], ['不能自动恢复', 'prepared_mismatch'],
    ['本机端口已经占用', 'port_in_use'], ['工作台正在关闭', 'closing'], ['管理操作已取消', 'closing'],
    ['等待超时', 'timeout'], ['SSH 私钥格式无效', 'invalid_connection'], ['窗口尚未准备', 'window_unavailable'],
    ['unrecognized raw server output', 'operation_failed'],
  ]
  const messages = new Map()
  try {
    for (const [reason, code] of cases) {
      f.service.deploy = async () => { throw new Error(reason + ': ' + secret + ' /fixture/secret-path') }
      const req = request('deploy'), result = await f.control.submit(req)
      assertResult(result, req, false); assert.equal(result.error.code, code)
      assert.deepEqual(Object.keys(result.error).sort(), ['code', 'message'])
      assert.equal(typeof result.error.message, 'string'); assert.ok(result.error.message.length > 0)
      assert.equal(JSON.stringify(result).includes(secret), false); assert.equal(JSON.stringify(result).includes('/fixture/'), false)
      if (messages.has(code)) assert.equal(result.error.message, messages.get(code))
      else messages.set(code, result.error.message)
      assert.deepEqual(f.read(req.requestId, 'result'), result)
    }
    assert.equal(f.calls.some(([name]) => name === 'snapshot'), false)
    const open = request('open-companion')
    f.control.openCompanion = async () => { throw new Error('窗口 ' + secret) }
    const result = await f.control.submit(open)
    assertResult(result, open, false); assert.equal(result.error.code, 'window_unavailable')
    assert.equal(result.error.message, messages.get('window_unavailable'))
    f.control.service = () => undefined
    const unavailable = await f.control.submit(request())
    assert.equal(unavailable.ok, false); assert.equal(unavailable.error.code, 'window_unavailable')
  } finally { f.close() }
})
