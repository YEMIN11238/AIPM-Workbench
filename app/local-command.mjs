/** Owned command groups with private environments and bounded output. */
import { spawn } from 'node:child_process'
import { realpathSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** Execute within the selected project and await all owned pipe/process cleanup. */
export function runLocalCommand({ command, cwd = '.', workspace, api, cloud = {}, timeout = 180, onChild = () => {}, signal, restrictWrites = false }) {
  if (typeof command !== 'string' || !command.trim() || command.length > 16000 || !Number.isFinite(timeout)) throw new Error('命令或超时时间无效')
  const base = realpathSync(workspace), folder = realpathSync(resolve(base, cwd))
  if (folder !== base && !folder.startsWith(base + '/')) throw new Error('运行目录必须在选定项目内')
  if (signal?.aborted) return Promise.resolve({ command, exitCode: null, signal: null, timedOut: false, aborted: true, output: '', usedSharedApi: Boolean(api) })
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG'].filter(k => process.env[k]).map(k => [k, process.env[k]]))
  env.PATH = '/Users/example/.local/node/bin:' + (env.PATH || '/usr/bin:/bin'); env.PYTHONDONTWRITEBYTECODE = '1'
  if (api) Object.assign(env, { DEEPSEEK_API_KEY: api.apiKey, OPENAI_API_KEY: api.apiKey, ANTHROPIC_API_KEY: api.apiKey, OPENAI_BASE_URL: api.baseUrl, ANTHROPIC_BASE_URL: api.anthropicBaseUrl, MODEL_ID: api.model })
  Object.assign(env, cloud)
  const secrets = [api?.apiKey, ...Object.values(cloud)].filter(value => typeof value === 'string' && value.length)
  const clean = value => secrets.reduce((text, secret) => text.split(secret).join('[已隐藏]'), String(value))
  let args = ['/bin/bash', '-c', command]
  if (restrictWrites && process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec')) {
    const profile = `(version 1)(allow default)(deny file-write*)(allow file-write* (subpath ${JSON.stringify(base)}) (subpath "/private/tmp") (subpath "/private/var/folders") (literal "/dev/null"))`
    args = ['/usr/bin/sandbox-exec', '-p', profile, ...args]
  }
  return new Promise((resolveRun, reject) => {
    const child = spawn(args[0], args.slice(1), { cwd: folder, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', timedOut = false, aborted = false, error, force, stopped = false
    const append = chunk => { output = (output + chunk).slice(-30000 - Math.max(0, ...secrets.map(s => s.length))) }
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8'); child.stdout.on('data', append); child.stderr.on('data', append)
    const signalGroup = signalName => { if (!child.pid) return; try { process.platform === 'win32' ? child.kill(signalName) : process.kill(-child.pid, signalName) } catch (failure) { if (failure.code !== 'ESRCH') error ||= failure } }
    const stop = () => { if (stopped) return; stopped = true; signalGroup('SIGTERM'); force = setTimeout(() => signalGroup('SIGKILL'), 1200) }
    const cancel = () => { aborted = true; stop() }, timer = setTimeout(() => { timedOut = true; stop() }, Math.max(1, Math.min(300, timeout)) * 1000)
    signal?.addEventListener('abort', cancel, { once: true })
    child.once('error', failure => { error = failure })
    try { if (child.pid) onChild(child.pid) } catch (failure) { error = failure; stop() }
    child.once('close', (code, terminationSignal) => {
      clearTimeout(timer); clearTimeout(force); signal?.removeEventListener('abort', cancel); signalGroup('SIGKILL')
      if (error) reject(new Error(clean(error.message)))
      else resolveRun({ command, exitCode: code, signal: terminationSignal, timedOut, aborted, output: clean(output).slice(-30000), usedSharedApi: Boolean(api) })
    })
    if (signal?.aborted) cancel()
  })
}
