/** Keyless deployment and lifecycle recordings; every process and HTTP request is simulated. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CompanionService, cloudPorts, validateConnection } from './cloud-service.mjs'

const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value.split('').reverse().join('')), decryptString: value => value.toString().split('').reverse().join('') }
const tick = () => new Promise(resolve => setImmediate(resolve))
const assets = ['compose.yaml', 'prepare.py', 'deploy.sh', 'README.md']
const ownKey = 'fixture-companion-only-key'

function fixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aipm-cloud-')), assetDirectory = join(root, 'assets'), identityFile = join(root, 'fixture_ed25519')
  mkdirSync(assetDirectory); for (const name of assets) writeFileSync(join(assetDirectory, name), 'fixture deployment asset\n')
  writeFileSync(identityFile, 'fixture private ssh material must never be read or transmitted', { mode: 0o600 })
  const f = { root, assetDirectory, identityFile, launches: [], kills: [], http: [], behavior: () => ({}), processes: new Map(), checkCount: 0, nextPid: 500000 }
  const spawnProcess = (command, args, launchOptions) => {
    const decision = f.behavior({ command, args, options: launchOptions }) || {}
    if (decision.throw) throw new Error('fixture spawn refused')
    const child = new EventEmitter(), launch = { command, args, options: launchOptions, child, input: undefined, done: false }
    child.pid = ++f.nextPid; child.stderr = new EventEmitter(); child.stdin = new EventEmitter()
    child.stdin.end = value => { launch.input = value }
    launch.finish = (code = 0, signal = null, stderr = '') => {
      if (launch.done) return
      launch.done = true
      if (stderr) child.stderr.emit('data', Buffer.from(stderr))
      child.emit('close', code, signal)
    }
    f.launches.push(launch); f.processes.set(child.pid, launch)
    if (decision.error) queueMicrotask(() => { child.emit('error', new Error('fixture process unavailable')); launch.finish(null) })
    else if (!args.includes('-N') && !decision.hold) queueMicrotask(() => launch.finish(decision.code ?? 0, decision.signal ?? null, decision.stderr || ''))
    return child
  }
  const killProcess = (group, signal) => {
    const launch = f.processes.get(-group)
    assert.ok(launch, 'only an owned process group may receive a signal')
    f.kills.push({ group, signal })
    if (f.onKill) f.onKill(launch, signal)
    else queueMicrotask(() => launch.finish(null, signal))
    return true
  }
  const fetcher = async (url, request) => { f.http.push({ url, request }); return options.fetcher ? options.fetcher(url, request) : { status: 401 } }
  const serviceOptions = { root, assetDirectory, safeStorage, spawnProcess, killProcess, fetcher, checkPorts: async () => { f.checkCount++ }, environment: { PATH: '/fixture/bin', HOME: '/fixture/home', SSH_AUTH_SOCK: '/fixture/agent', DEEPSEEK_API_KEY: 'unrelated-workbench-key', OPENAI_API_KEY: 'unrelated-provider-key', AUTH_TOKEN: 'unrelated-token', PASSWORD: 'unrelated-password', PRIVATE_SECRET: 'unrelated-secret', ELECTRON_RUN_AS_NODE: '1' }, commandTimeoutMs: 100, deploymentTimeoutMs: 100, readyTimeoutMs: 30, pollIntervalMs: 1, stopTimeoutMs: 10, ...options.service }
  f.service = new CompanionService(serviceOptions)
  f.connection = { host: 'server.example.invalid', port: 22, user: 'ubuntu', identityFile }
  f.configure = async () => { await f.service.saveConnection(f.connection); await f.service.saveModelKey(ownKey) }
  f.reopen = () => { f.service = new CompanionService(serviceOptions); return f.service }
  f.close = async () => { await f.service.close(); rmSync(root, { recursive: true, force: true }) }
  return f
}

test('connection parser rejects SSH injection and checks private file metadata without reading its content', async () => {
  const f = fixture()
  try {
    assert.deepEqual(validateConnection({ ...f.connection, host: 'SERVER.example.invalid' }), f.connection)
    for (const host of ['-oProxyCommand=id', 'server;id', 'u@host', 'host\ncommand', 'host extra', '']) assert.throws(() => validateConnection({ ...f.connection, host }), /地址/)
    for (const user of ['-root', 'u;id', 'u@h', 'a\nb']) assert.throws(() => validateConnection({ ...f.connection, user }), /用户名/)
    for (const port of [0, 65536, 1.5, '22 -o ProxyCommand=id']) assert.throws(() => validateConnection({ ...f.connection, port }), /端口/)
    assert.throws(() => validateConnection({ ...f.connection, identityFile: '~/.ssh/id' }), /绝对路径/)
    chmodSync(f.identityFile, 0o644); assert.throws(() => validateConnection(f.connection), /400 或 600/); chmodSync(f.identityFile, 0o400)
    assert.deepEqual(validateConnection(f.connection), f.connection)
    const link = join(f.root, 'key-link'); symlinkSync(f.identityFile, link)
    assert.throws(() => validateConnection({ ...f.connection, identityFile: link }), /普通文件/)
    assert.equal(f.launches.length, 0)
  } finally { await f.close() }
})

test('missing server or independent key never launches a process or consults workbench credentials', async () => {
  let sharedReads = 0
  const f = fixture({ service: { getApi: () => { sharedReads++; return { apiKey: 'unrelated-shared-key' } } } })
  try {
    const snapshot = await f.service.snapshot()
    assert.equal(snapshot.backend.state, 'waiting_server'); assert.equal(snapshot.qq.state, 'unknown'); assert.equal(snapshot.qq.connected, false)
    assert.equal(snapshot.settings.botQQ, '872713341'); assert.equal(snapshot.settings.owner.qq, '3202619225'); assert.equal(snapshot.model.name, 'deepseek-flash')
    await assert.rejects(f.service.deploy(), /服务器/)
    await assert.rejects(f.service.start(), /服务器/)
    await f.service.saveConnection(f.connection)
    await assert.rejects(f.service.deploy(), /独立 API Key/)
    await assert.rejects(f.service.saveModelKey(''), /专用 API Key/)
    assert.equal(f.launches.length, 0); assert.equal(f.http.length, 0); assert.equal(sharedReads, 0)
    assert.equal(existsSync(join(f.root, 'memory.sqlite')), false)
  } finally { await f.close() }
})

test('dedicated credentials remain encrypted across reopening and failed replacement leaves the old key active', async () => {
  const f = fixture()
  try {
    await f.configure(); await f.service.saveModelKey('')
    assert.equal(JSON.stringify(await f.service.snapshot()).includes(ownKey), false)
    assert.equal(readFileSync(join(f.root, 'cloud-settings.json'), 'utf8').includes(ownKey), false)
    assert.equal(readFileSync(join(f.root, 'credentials.bin'), 'utf8').includes(ownKey), false)
    assert.equal(statSync(join(f.root, 'credentials.bin')).mode & 0o777, 0o600)
    assert.equal(statSync(join(f.root, 'cloud-settings.json')).mode & 0o777, 0o600)
    await f.service.close(); f.reopen()
    assert.equal((await f.service.snapshot()).model.configured, true)
    f.service.safeStorage = { ...safeStorage, isEncryptionAvailable: () => false }
    await assert.rejects(f.service.saveModelKey('fixture-unsaved-replacement'), /系统加密不可用/)
    f.service.safeStorage = safeStorage
    await f.service.deploy()
    assert.equal(f.launches.find(launch => launch.input !== undefined).input, JSON.stringify({ deepseekApiKey: ownKey }))
  } finally { await f.close() }
})

test('deployment checks environment before key initialization and sends only the dedicated key through prepare stdin', async () => {
  const f = fixture()
  try {
    await f.configure(); const result = await f.service.deploy()
    assert.equal(result.deployment.state, 'deployed'); assert.equal(result.model.remoteSync, 'synced'); assert.equal(result.qq.connected, false); assert.equal(result.qq.state, 'unknown')
    assert.equal(f.launches[0].command, '/usr/bin/ssh'); assert.equal(f.launches[0].args.at(-1), 'true')
    const copy = f.launches.find(launch => launch.command === '/usr/bin/scp')
    assert.deepEqual(copy.args.slice(-5, -1), assets.map(name => join(f.assetDirectory, name)))
    assert.equal(copy.args.at(-1), 'ubuntu@server.example.invalid:/opt/aipm-dafeiyu/')
    const preflight = f.launches.findIndex(launch => launch.args.at(-1).includes('deploy.sh preflight'))
    const prepare = f.launches.findIndex(launch => launch.args.at(-1).includes('prepare.py') && launch.args.at(-1).includes('--model'))
    const up = f.launches.findIndex(launch => launch.args.at(-1).includes('deploy.sh up'))
    assert.ok(preflight < prepare && prepare < up)
    assert.deepEqual(f.launches.filter(launch => launch.input !== undefined).map(launch => launch.input), [JSON.stringify({ deepseekApiKey: ownKey })])
    for (const launch of f.launches) {
      assert.equal(launch.options.shell, false); assert.equal(launch.options.detached, true)
      assert.deepEqual(Object.keys(launch.options.env).sort(), ['HOME', 'PATH', 'SSH_AUTH_SOCK'])
      assert.equal(JSON.stringify([launch.args, launch.options]).includes(ownKey), false)
      for (const value of ['StrictHostKeyChecking=yes', 'BatchMode=yes', 'IdentitiesOnly=yes', 'ExitOnForwardFailure=yes', 'ServerAliveInterval=30', 'ServerAliveCountMax=3']) assert.ok(launch.args.includes(value))
      assert.deepEqual(launch.args.slice(0, 2), ['-F', '/dev/null'])
      assert.equal(launch.args.some(value => /accept-new|StrictHostKeyChecking=no|sudo/.test(value)), false)
      assert.equal(JSON.stringify(launch).includes('fixture private ssh material'), false)
    }
    assert.equal(f.http.length, 0)
    const previous = f.launches.length
    await assert.rejects(f.service.deploy(), /不会重复初始化/)
    assert.equal(f.launches.length, previous)
  } finally { await f.close() }
})

test('untrusted hosts and unknown initialized directories fail without copying or overwriting private data', async () => {
  const f = fixture()
  try {
    await f.configure()
    f.behavior = ({ args }) => args.at(-1) === 'true' ? { code: 255, stderr: 'Host key verification failed. fixture-private-server-output' } : {}
    await assert.rejects(f.service.deploy(), error => /主机指纹/.test(error.message) && !error.message.includes('fixture-private-server-output'))
    assert.equal(f.launches.length, 1)
    f.behavior = ({ args }) => args.at(-1).includes('mkdir -p') ? { code: 73 } : {}
    await assert.rejects(f.service.deploy(), /不会覆盖/)
    assert.equal(f.launches.some(launch => launch.command === '/usr/bin/scp' || launch.input !== undefined), false)
    assert.equal((await f.service.snapshot()).deployment.state, 'not_deployed')
  } finally { await f.close() }
})

test('missing Docker leaves no cloud key and retries only the owned asset stage', async () => {
  const f = fixture()
  try {
    await f.configure()
    f.behavior = ({ args }) => args.at(-1).includes('deploy.sh preflight') ? { code: 1, stderr: 'Docker unavailable' } : {}
    await assert.rejects(f.service.deploy(), /Docker.*不会自动安装/)
    assert.equal(f.launches.some(launch => launch.input !== undefined), false)
    assert.equal((await f.service.snapshot()).deployment.state, 'not_deployed')
    f.behavior = () => ({})
    await f.service.deploy()
    assert.equal(f.launches.filter(launch => launch.input !== undefined).length, 1)
    assert.equal((await f.service.snapshot()).deployment.state, 'deployed')
  } finally { await f.close() }
})

test('failed container startup resumes the same prepared deployment after reopening without sending the key again', async () => {
  const f = fixture()
  try {
    await f.configure()
    f.behavior = ({ args }) => args.at(-1).includes('deploy.sh up') ? { code: 1 } : {}
    await assert.rejects(f.service.deploy(), /可在相同连接和相同密钥下重试/)
    let state = await f.service.snapshot()
    assert.equal(state.deployment.state, 'not_deployed'); assert.equal(state.deployment.prepared, true); assert.equal(state.model.remoteSync, 'pending')
    const first = f.launches.length
    await f.service.close(); f.reopen(); f.behavior = () => ({})
    await f.service.deploy()
    const resumed = f.launches.slice(first)
    assert.equal(resumed.some(launch => launch.command === '/usr/bin/scp' || launch.input !== undefined), false)
    assert.ok(resumed.some(launch => /--verify --expected-key-sha256 [a-f0-9]{64}$/.test(launch.args.at(-1))))
    assert.equal(resumed.at(-1).args.at(-1), 'bash /opt/aipm-dafeiyu/deploy.sh up /opt/aipm-dafeiyu')
    state = await f.service.snapshot(); assert.equal(state.deployment.state, 'deployed'); assert.equal(state.model.remoteSync, 'synced')
    await f.service.saveModelKey('fixture-new-independent-key')
    assert.equal((await f.service.snapshot()).model.remoteSync, 'pending')
  } finally { await f.close() }
})

test('prepared retries with a changed key or failed identity verification never run container startup', async () => {
  const f = fixture()
  try {
    await f.configure(); f.behavior = ({ args }) => args.at(-1).includes('deploy.sh up') ? { code: 1 } : {}
    await assert.rejects(f.service.deploy())
    await f.service.saveModelKey('fixture-changed-key'); const count = f.launches.length
    await assert.rejects(f.service.deploy(), /独立密钥已变更/); assert.equal(f.launches.length, count)
    await f.service.saveModelKey(ownKey)
    f.behavior = ({ args }) => args.at(-1).includes('--verify') ? { code: 1 } : {}
    await assert.rejects(f.service.deploy(), /不能自动恢复/)
    assert.equal(f.launches.slice(count).some(launch => launch.args.at(-1).includes('deploy.sh up')), false)
  } finally { await f.close() }
})

test('HTTP readiness opens only owned loopback forwards and target replacement disconnects before resetting state', async () => {
  const f = fixture()
  try {
    await f.configure(); await f.service.deploy(); const count = f.launches.length
    await f.service.start(); await f.service.start()
    assert.equal(f.launches.length, count + 1); assert.equal(f.checkCount, 1)
    const tunnel = f.launches.at(-1)
    assert.deepEqual(tunnel.args.filter((value, index) => tunnel.args[index - 1] === '-L'), Object.values(cloudPorts).map(port => `127.0.0.1:${port.local}:127.0.0.1:${port.remote}`))
    assert.ok(tunnel.args.includes('-N'))
    assert.equal(f.http[0].url, 'http://127.0.0.1:16185/'); assert.equal(f.http[0].request.redirect, 'error')
    const descriptor = await f.service.consoleUrl()
    assert.equal(descriptor.url, 'http://127.0.0.1:16185/'); assert.equal(descriptor.allowedOrigin, 'http://127.0.0.1:16185'); assert.match(descriptor.partition, /^persist:aipm-companion-astrbot-[a-f0-9]{64}$/)
    assert.equal((await f.service.snapshot()).qq.connected, false)
    await f.service.saveConnection({ ...f.connection, host: 'second.example.invalid' })
    assert.equal(tunnel.done, true); assert.equal(f.kills.at(-1).group, -tunnel.child.pid)
    const state = await f.service.snapshot(); assert.equal(state.backend.running, false); assert.equal(state.deployment.state, 'not_deployed'); assert.equal(state.model.remoteSync, 'pending')
    await assert.rejects(f.service.consoleUrl(), /先连接/)
    assert.equal(f.launches.some(launch => launch.args.at(-1).includes('deploy.sh stop')), false)
  } finally { await f.close() }
})

test('port conflicts and HTTP timeout remain failures; cleanup waits for the owned SSH exit', async () => {
  const f = fixture({ fetcher: async () => ({ status: 503 }), service: { readyTimeoutMs: 8, pollIntervalMs: 1 } })
  try {
    await f.configure(); await f.service.deploy()
    f.service.checkPorts = async () => { throw new Error('fixture local port occupied') }
    const count = f.launches.length
    await assert.rejects(f.service.start(), /port occupied/); assert.equal(f.launches.length, count)
    f.service.checkPorts = async () => {}
    await assert.rejects(f.service.start(), /就绪检查超时/)
    const state = await f.service.snapshot(); assert.equal(state.backend.state, 'failed'); assert.match(state.backend.error, /超时/)
    assert.equal(f.service.children.size, 0); assert.equal(f.launches.at(-1).done, true)
  } finally { await f.close() }
})

test('stop and close wait through SIGKILL escalation and never stop cloud services', async () => {
  const f = fixture({ service: { stopTimeoutMs: 2 } })
  try {
    await f.configure(); await f.service.deploy(); await f.service.start()
    f.onKill = (launch, signal) => { if (signal === 'SIGKILL') queueMicrotask(() => launch.finish(null, signal)) }
    await f.service.stop()
    assert.deepEqual(f.kills.slice(-2).map(value => value.signal), ['SIGTERM', 'SIGKILL'])
    assert.equal(f.service.children.size, 0); assert.equal((await f.service.snapshot()).backend.state, 'stopped')
    assert.equal(f.launches.some(launch => launch.args.at(-1).includes('deploy.sh stop')), false)
    await f.service.close(); await f.service.close()
    await assert.rejects(f.service.start(), /关闭/)
  } finally { await f.close() }
})

test('close interrupts deployment and queued work without launching a later deployment step', async () => {
  const f = fixture()
  try {
    await f.configure(); f.behavior = ({ args }) => args.at(-1).includes('--model') ? { hold: true } : {}
    const deployment = f.service.deploy(), rejected = assert.rejects(deployment, /关闭/)
    await tick(); assert.equal(f.launches.at(-1).input, JSON.stringify({ deepseekApiKey: ownKey }))
    const queued = assert.rejects(f.service.deploy(), /关闭/)
    await f.service.close(); await rejected; await queued
    assert.equal(f.service.children.size, 0)
    assert.equal(f.launches.some(launch => launch.args.at(-1).includes('deploy.sh up')), false)
    assert.equal((await f.service.snapshot()).deployment.state, 'not_deployed')
    const count = f.launches.length
    await assert.rejects(f.service.saveConnection(f.connection), /关闭/); assert.equal(f.launches.length, count)
  } finally { await f.close() }
})

test('a timed-out command cannot be reported as successful even when its signal handler exits zero', async () => {
  const f = fixture({ service: { commandTimeoutMs: 3, stopTimeoutMs: 2 } })
  try {
    await f.configure(); f.behavior = ({ args }) => args.at(-1) === 'true' ? { hold: true } : {}
    f.onKill = launch => queueMicrotask(() => launch.finish(0))
    await assert.rejects(f.service.deploy(), /超时/)
    assert.equal(f.launches.length, 1); assert.equal((await f.service.snapshot()).deployment.state, 'not_deployed')
  } finally { await f.close() }
})
