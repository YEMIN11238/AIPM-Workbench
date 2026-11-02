/** Install local adapters into a freshly copied upstream starter without executing its hooks. */
import { readFileSync, writeFileSync, mkdirSync, lstatSync, realpathSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

const originalScripts = {
  score: 'node scripts/score.mjs', prestudio: 'node scripts/score.mjs', studio: 'remotion studio',
  prerender: 'node scripts/score.mjs', render: 'remotion render Film out/film.mp4',
  prepreview: 'node scripts/score.mjs', preview: 'remotion render Film out/preview.mp4 --scale=0.5',
  still: 'remotion still Film out/still.png', check: 'bash scripts/check.sh',
}
const adaptedScripts = {
  score: 'node scripts/workbench-score.mjs', prestudio: 'node scripts/workbench-score.mjs',
  prerender: 'node scripts/workbench-score.mjs', prepreview: 'node scripts/workbench-score.mjs',
  render: 'node scripts/workbench-remotion.mjs render', preview: 'node scripts/workbench-remotion.mjs preview',
  still: 'node scripts/workbench-remotion.mjs still', check: 'node scripts/workbench-check.mjs',
  'check:upstream': originalScripts.check,
}

/** Validate synthesis parameters before the preserved upstream score allocates arrays or enters loops. */
export function validateMotionCues(cues) {
  const object = (v, label) => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(label + ' 必须是对象'); return v }
  const number = (v, lo, hi, label) => { if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(label + ' 必须是 ' + lo + ' 至 ' + hi + ' 的有限数值'); return v }
  object(cues, 'cues')
  const duration = number(cues.duration, 1, 120, 'duration'), bpm = number(cues.bpm ?? 120, 1, 600, 'bpm')
  if (!['ink', 'swiss', 'data', 'poster', 'riso', 'drafting'].includes(cues.palette ?? 'data')) throw new Error('未知 palette；可用 ink/swiss/data/poster/riso/drafting')
  if (cues.loop !== undefined && typeof cues.loop !== 'boolean') throw new Error('loop 必须是布尔值')
  if (cues.seed !== undefined && (!Number.isInteger(cues.seed) || cues.seed < 1 || cues.seed > 2147483646)) throw new Error('seed 必须是正整数且小于2147483647')
  if (cues.master !== undefined) number(cues.master, .001, 2, 'master')
  if (cues.mix !== undefined) { object(cues.mix, 'mix'); for (const [key, value] of Object.entries(cues.mix)) { const ranges = { reverb: [0, 1], room: [0, .99], bright: [0, 1], gain: [.001, 2] }; if (!ranges[key]) throw new Error('未知 mix 字段 ' + key); number(value, ...ranges[key], 'mix.' + key) } }
  const defaults = { pluck: 3, bell: 2.5, pad: 8, tick: .03, kick: .5, clap: .25, hat: .06, whoosh: .6, drop: .18, knock: .22, scratch: .5, ambience: 10, boom: 1.6 }
  const noise = new Set(['whoosh', 'scratch', 'clap', 'hat'])
  const note = (value, label) => { if (typeof value === 'number') return number(value, 1, 24000, label); if (typeof value !== 'string' || !/^([A-G])(#|b)?(-?\d)$/.test(value)) throw new Error(label + ' 不是有效音高') }
  let count = 0, samples = 0, musical = false
  for (const group of ['events', 'bed', 'patterns']) {
    const entries = cues[group] ?? []
    if (!Array.isArray(entries) || entries.length > 10000) throw new Error(group + ' 必须是不超过10000项的数组')
    for (let i = 0; i < entries.length; i++) {
      const c = object(entries[i], group + '[' + i + ']'), label = group + '[' + i + ']'
      if (!Object.hasOwn(defaults, c.type)) throw new Error(label + ' 未知乐器 ' + c.type)
      if (['pluck', 'bell', 'pad'].includes(c.type) || (group === 'bed' && c.type === 'ambience')) musical = true
      if (group === 'bed' && noise.has(c.type)) throw new Error(label + ' 噪声乐器不能用作持续背景')
      for (const [field, lo, hi] of [['gain', 0, 2], ['pan', -1, 1], ['reverb', 0, 1], ['decay', 0, .99999], ['bright', 0, 1], ['fade', .001, 126], ['freq', 1, 24000], ['ratio', 0, 20], ['index', 0, 20], ['tone', 0, 1], ['peak', .001, .999], ['rough', 0, 1], ['density', 0, 10]]) if (c[field] !== undefined) number(c[field], lo, hi, label + '.' + field)
      if (c.voices !== undefined && (!Number.isInteger(c.voices) || c.voices < 1 || c.voices > 8)) throw new Error(label + '.voices 必须是1至8的整数')
      if (c.fifth !== undefined && typeof c.fifth !== 'boolean') throw new Error(label + '.fifth 必须是布尔值')
      if (c.kind !== undefined && !['rain', 'wind', 'room'].includes(c.kind)) throw new Error(label + '.kind 必须是 rain/wind/room')
      if (c.note !== undefined) note(c.note, label + '.note')
      if (c.notes !== undefined) { if (!Array.isArray(c.notes) || !c.notes.length || c.notes.length > 128) throw new Error(label + '.notes 必须有1至128项'); for (const n of c.notes) if (n !== '-') note(n, label + '.notes') }
      let n = 1, seconds = number(c.dur ?? defaults[c.type], .001, 126, label + '.dur')
      if (group === 'events') number(c.t, 0, duration - .000001, label + '.t')
      else {
        const start = number(c.start ?? 0, 0, duration, label + '.start'), end = number(c.end ?? duration, 0, duration, label + '.end')
        if (end <= start) throw new Error(label + '.end 必须大于 start')
        if (group === 'bed') seconds = end - start
        else { const every = number(c.every ?? 1, Number.MIN_VALUE, 10000, label + '.every'), step = 60 / bpm * every; n = Math.ceil((end - start) / step); if (!Number.isSafeInteger(n) || n > 10000) throw new Error(label + ' 重复次数超过10000') }
      }
      if (noise.has(c.type) && group !== 'bed') seconds = Math.min(seconds, 1)
      count += n; samples += n * Math.ceil(seconds * 48000) * (c.type === 'pad' ? (c.voices ?? 3) + 1 : 1)
      if (count > 10000 || samples > 120000000) throw new Error('配乐事件或合成工作量过大，请减少重复或持续时间')
    }
  }
  if (!musical) throw new Error('配乐至少需要 pluck/bell/pad 或 ambience 背景')
  return { duration, bpm, eventsUpperBound: count, samplesUpperBound: samples }
}

function runtimeHelpers() {
  const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)))
  const require = createRequire(join(root, 'package.json'))
  function localFile(relative, max = 2000000) {
    const path = resolve(root, relative), real = realpathSync(path), stat = lstatSync(path)
    if (!real.startsWith(root + sep) || !stat.isFile() || stat.isSymbolicLink() || stat.size > max) throw new Error('工程文件无效或不属于当前工程：' + relative)
    return real
  }
  function run(file, args, { env = process.env, timeout = 120000, maxBuffer = 65536 } = {}) {
    const result = spawnSync(file, args, { cwd: root, env, encoding: 'utf8', timeout, maxBuffer, windowsHide: true })
    const output = String(result.stdout || '') + String(result.stderr || '')
    return { exitCode: result.status, signal: result.signal, output: output.slice(0, maxBuffer), truncated: output.length > maxBuffer || result.error?.code === 'ENOBUFS', error: result.error?.message }
  }
  function probeTools() {
    const base = join(root, 'node_modules/@remotion'), stem = 'compositor-' + process.platform + '-' + process.arch
    const candidates = [stem, stem + '-gnu', stem + '-musl', stem + '-msvc']
    const suffix = process.platform === 'win32' ? '.exe' : ''
    const folder = candidates.map(name => join(base, name)).find(path => existsSync(join(path, 'ffprobe' + suffix)))
    if (!folder) throw new Error('缺少当前平台 Remotion ffprobe，未执行检查')
    const ffprobe = join(folder, 'ffprobe' + suffix)
    accessSync(ffprobe, constants.X_OK)
    const libraryKey = process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : 'LD_LIBRARY_PATH'
    const env = { ...process.env, PATH: [join(root, 'tools'), folder, process.env.PATH || ''].join(delimiter), [libraryKey]: [folder, process.env[libraryKey]].filter(Boolean).join(delimiter) }
    return { folder, ffprobe, env }
  }
  function tools() {
    const { folder, ffprobe, env } = probeTools(), suffix = process.platform === 'win32' ? '.exe' : ''
    const preferred = join(root, 'tools', 'ffmpeg' + suffix), ffmpeg = existsSync(preferred) ? preferred : join(folder, 'ffmpeg' + suffix)
    accessSync(ffmpeg, constants.X_OK)
    const requiredFilters = ['crop', 'scale', 'format', 'ssim', 'showspectrumpic', 'volumedetect', 'fps', 'tile', 'tblend', 'signalstats', 'metadata']
    const filters = run(ffmpeg, ['-v', 'error', '-filters'], { env })
    if (filters.error || filters.truncated || filters.exitCode !== 0) throw new Error('FFmpeg 无法启动，检查动态库及项目 tools/ffmpeg：' + (filters.error || filters.signal || filters.exitCode))
    const available = new Set([...filters.output.matchAll(/^\s*[TSC.]{3}\s+(\w+)\s/gm)].map(match => match[1]))
    const missing = requiredFilters.filter(name => !available.has(name))
    if (missing.length) throw new Error('FFmpeg 缺少原版检查所需滤镜 ' + missing.join(', ') + '；请由宿主准备完整 tools/ffmpeg，未执行不完整检查')
    return { folder, ffmpeg, ffprobe, env, requiredFilters }
  }
  return { root, require, localFile, run, tools, probeTools }
}

function probeMain() {
  const { root, probeTools } = runtimeHelpers(), binaries = probeTools()
  const result = spawnSync(binaries.ffprobe, process.argv.slice(2), { cwd: root, env: binaries.env, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}

function scoreMain() {
  const { localFile, run } = runtimeHelpers()
  const path = localFile(process.argv[2] || 'scripts/cues.json', 1000000)
  const validation = validateMotionCues(JSON.parse(readFileSync(path, 'utf8')))
  console.log('workbench score: validated ' + validation.eventsUpperBound + ' events (upper bound)')
  const result = run(process.execPath, [localFile('scripts/score.mjs'), path], { timeout: 120000 })
  if (result.output) process.stdout.write(result.output)
  if (result.error || result.truncated || result.exitCode !== 0) throw new Error('原版配乐合成未成功：' + (result.error || result.signal || result.exitCode))
}

function readFilmSpec(ts, content) {
  const source = ts.createSourceFile('spec.ts', content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  if (source.parseDiagnostics.length) throw new Error('spec.ts 有语法错误，规格待核对')
  let declaration
  for (const statement of source.statements) if (ts.isVariableStatement(statement)) for (const d of statement.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === 'FILM') { if (declaration) throw new Error('存在多个 FILM，规格待核对'); declaration = d }
  const unwrap = node => { while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression; return node }
  const object = unwrap(declaration?.initializer)
  if (!object || !ts.isObjectLiteralExpression(object)) throw new Error('FILM 不是可静态读取的常量对象，规格待核对')
  const fields = {}
  for (const p of object.properties) {
    if (!ts.isPropertyAssignment(p) || p.name?.kind === ts.SyntaxKind.ComputedPropertyName) throw new Error('FILM 包含动态属性，规格待核对')
    const name = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null
    if (!['width', 'height', 'fps', 'duration', 'sound'].includes(name)) continue
    if (Object.hasOwn(fields, name)) throw new Error('FILM 存在重复规格字段')
    const v = unwrap(p.initializer)
    if (ts.isNumericLiteral(v)) fields[name] = Number(v.text)
    else if (v.kind === ts.SyntaxKind.TrueKeyword || v.kind === ts.SyntaxKind.FalseKeyword) fields[name] = v.kind === ts.SyntaxKind.TrueKeyword
    else throw new Error('FILM.' + name + ' 不是静态字面量，规格待核对')
  }
  for (const name of ['width', 'height', 'fps', 'duration']) if (!Number.isFinite(fields[name]) || fields[name] <= 0) throw new Error('FILM.' + name + ' 缺失或无效，规格待核对')
  if (typeof fields.sound !== 'boolean') throw new Error('FILM.sound 未明确，音轨规格待核对')
  return fields
}

function checkMain() {
  const { root, require, localFile, run, tools } = runtimeHelpers()
  const report = { schema: 1, status: 'failed', visualReview: 'pending', note: '仅检查本机文件、规格及原版机械检查；没有执行模型视觉评审或真人评分', warnings: [], errors: [], createdAt: new Date().toISOString() }
  try {
    const media = localFile(process.argv[2] || 'out/film.mp4', Number.MAX_SAFE_INTEGER), binaries = tools()
    let spec
    try { spec = readFilmSpec(require('typescript'), readFileSync(localFile('src/spec.ts'), 'utf8')); report.spec = spec }
    catch (error) { report.warnings.push(error.message); report.status = 'pending' }
    report.toolchain = { ffmpeg: binaries.ffmpeg, ffprobe: binaries.ffprobe, filters: binaries.requiredFilters, libraryPath: binaries.folder }
    const probe = run(binaries.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', media], { env: binaries.env })
    if (probe.error || probe.truncated || probe.exitCode !== 0) throw new Error('ffprobe 未成功读取实际视频：' + (probe.error || probe.exitCode))
    const metadata = JSON.parse(probe.output), video = metadata.streams?.find(s => s.codec_type === 'video'), audio = metadata.streams?.some(s => s.codec_type === 'audio') || false
    const ratio = String(video?.avg_frame_rate || video?.r_frame_rate || '').split('/'), fps = Number(ratio[0]) / (Number(ratio[1]) || 1), duration = Number(metadata.format?.duration)
    if (!video || !Number.isFinite(fps) || fps <= 0 || !Number.isFinite(duration) || duration <= 0) throw new Error('实际视频缺少有效画面、帧率或时长')
    report.actual = { width: video.width, height: video.height, fps, duration, audio }
    if (spec) {
      for (const field of ['width', 'height']) if (spec[field] !== report.actual[field]) report.errors.push(field + ' 实际 ' + report.actual[field] + '，FILM ' + spec[field])
      if (Math.abs(fps - spec.fps) > .01) report.errors.push('fps 与 FILM 不一致')
      if (Math.abs(duration - spec.duration) > .1) report.errors.push('duration 与 FILM 不一致')
      if (spec.sound && !audio) report.errors.push('FILM 要求音轨，实际视频没有音轨')
    }
    const upstream = run(process.platform === 'win32' ? 'bash' : '/bin/bash', [localFile('scripts/check.sh'), media], { env: binaries.env })
    report.upstream = upstream
    if (upstream.output) process.stdout.write(upstream.output)
    if (upstream.error || upstream.truncated || upstream.exitCode !== 0) report.errors.push('原版检查未成功：' + (upstream.error || upstream.signal || upstream.exitCode))
    if (/^\s*FAIL\b/m.test(upstream.output)) report.errors.push('原版检查输出 FAIL；即使脚本退出0也不视为通过')
    report.status = report.errors.length ? 'failed' : spec ? 'passed' : 'pending'
  } catch (error) { report.errors.push(error.message); report.status = 'failed' }
  mkdirSync(join(root, 'out/check'), { recursive: true })
  writeFileSync(join(root, 'out/check/workbench-check.json'), JSON.stringify(report, null, 2) + '\n')
  console.log('workbench check: ' + report.status + '; visual review pending; out/check/workbench-check.json')
  for (const message of [...report.errors, ...report.warnings]) console.error(message)
  process.exitCode = report.status === 'passed' ? 0 : report.status === 'pending' ? 2 : 1
}

function renderMain() {
  const { root, require, localFile, run } = runtimeHelpers(), mode = process.argv[2]
  if (!['render', 'preview', 'still'].includes(mode)) throw new Error('未知本地渲染操作')
  const cli = require('@remotion/cli/package.json'), renderer = require('@remotion/renderer/package.json')
  if (cli.version !== '4.0.537' || renderer.version !== '4.0.537') throw new Error('完整版动效工程需要固定的 Remotion 4.0.537 runtime')
  const extra = process.argv.slice(3)
  if (extra.some(value => /^--(?:browser-executable|chrome-mode|image-format|disable-shared-memory-capture)(?:=|$)/.test(value))) throw new Error('捕获与浏览器参数由工作台固定，不能覆盖')
  const platform = process.platform === 'darwin' ? 'mac-' + process.arch : process.platform === 'win32' ? 'win64' : process.arch === 'arm64' ? 'linux-arm64' : 'linux64'
  const browserDir = join(root, 'node_modules/.remotion/chrome-headless-shell', platform, 'chrome-headless-shell-' + platform)
  const browser = ['headless_shell', process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell'].map(name => join(browserDir, name)).find(path => existsSync(path))
  if (!browser) throw new Error('缺少本地 Remotion Chrome Headless Shell；请先由宿主准备渲染 runtime，未下载或回退到系统 Chrome')
  accessSync(browser, constants.X_OK)
  const args = [mode === 'still' ? 'still' : 'render', 'Film', mode === 'still' ? 'out/still.png' : mode === 'preview' ? 'out/preview.mp4' : 'out/film.mp4', ...(mode === 'preview' ? ['--scale=0.5'] : []), ...extra, '--chrome-mode=headless-shell', '--browser-executable=' + browser, '--image-format=png', '--disable-shared-memory-capture']
  const cliPath = join(dirname(require.resolve('@remotion/cli/package.json')), 'remotion-cli.js')
  const result = run(process.execPath, [cliPath, ...args], { timeout: 1200000, maxBuffer: 262144 })
  if (result.output) process.stdout.write(result.output)
  if (result.error || result.truncated || result.exitCode !== 0) throw new Error('Remotion 渲染未成功：' + (result.error || result.signal || result.exitCode))
}

const wrapperImports = `import {readFileSync,writeFileSync,mkdirSync,realpathSync,lstatSync,existsSync,accessSync,constants} from 'node:fs';\nimport {resolve,join,dirname,sep,delimiter} from 'node:path';\nimport {fileURLToPath} from 'node:url';\nimport {createRequire} from 'node:module';\nimport {spawnSync} from 'node:child_process';\n`
function wrapper(main, helpers = []) { return wrapperImports + runtimeHelpers.toString() + '\n' + helpers.map(f => f.toString()).join('\n') + '\n' + main.toString() + '\ntry { ' + main.name + '() } catch(error) { console.error(error.message); process.exitCode=1 }\n' }

/** Synchronously install adapters. No package manager, command, model, or upstream code runs here. */
export function installMotionProjectTools(folder) {
  const root = realpathSync(resolve(folder)), packagePath = join(root, 'package.json'), scriptsPath = join(root, 'scripts')
  if (lstatSync(packagePath).isSymbolicLink() || !lstatSync(scriptsPath).isDirectory() || lstatSync(scriptsPath).isSymbolicLink()) throw new Error('动效 starter 路径无效')
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
  if (pkg.dependencies?.['@remotion/cli'] !== '4.0.537' || pkg.dependencies?.remotion !== '4.0.537') throw new Error('不是固定版本的完整动效 starter')
  const manifestPath = join(root, 'WORKBENCH-ADAPTATION.json'), prior = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null
  for (const [key, expected] of Object.entries(originalScripts)) if (pkg.scripts?.[key] !== expected && !(prior?.schema === 1 && pkg.scripts?.[key] === (adaptedScripts[key] || expected))) throw new Error('starter 脚本 ' + key + ' 已改变，请勿覆盖用户工程脚本')
  if (pkg.scripts['check:upstream'] !== undefined && pkg.scripts['check:upstream'] !== originalScripts.check) throw new Error('check:upstream 已被占用')
  const originals = {}
  for (const relative of ['scripts/check.sh', 'scripts/score.mjs', 'src/lib/film.tsx', 'src/lib/motion.tsx']) {
    const path = join(root, relative), stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2000000) throw new Error('原版脚本或 helper 无效：' + relative)
    originals[relative] = createHash('sha256').update(readFileSync(path)).digest('hex')
    if (prior?.originals?.[relative] && prior.originals[relative] !== originals[relative]) throw new Error('安装后原版 helper 已改变：' + relative)
  }
  const files = { 'scripts/workbench-score.mjs': wrapper(scoreMain, [validateMotionCues]), 'scripts/workbench-check.mjs': wrapper(checkMain, [readFilmSpec]), 'scripts/workbench-remotion.mjs': wrapper(renderMain), 'scripts/workbench-ffprobe.mjs': wrapper(probeMain), 'tools/ffprobe': '#!/bin/sh\nexec node "$(dirname "$0")/../scripts/workbench-ffprobe.mjs" "$@"\n' }
  for (const [relative, content] of Object.entries(files)) {
    const path = join(root, relative)
    if (existsSync(path) && (lstatSync(path).isSymbolicLink() || readFileSync(path, 'utf8') !== content)) throw new Error('工作台适配文件已被修改，不覆盖：' + relative)
  }
  const adaptation = { schema: 1, adapter: 'aipm-motion-project-tools', installedAt: prior?.installedAt || new Date().toISOString(), runtime: 'Remotion 4.0.537', originals, originalScripts, adaptedScripts, checks: ['bounded cues before synthesis', 'literal-only FILM AST compared to ffprobe', 'full FFmpeg filter preflight; prefer tools/ffmpeg', 'ffprobe launcher restores compositor dylib path after macOS shell sanitization', 'nonzero upstream exit or printed FAIL is failure', 'visual review remains pending'], capture: { chromeMode: 'headless-shell', imageFormat: 'png', disableSharedMemoryCapture: true }, wrappers: Object.keys(files) }
  const toolsFolder = join(root, 'tools')
  if (existsSync(toolsFolder) && (!lstatSync(toolsFolder).isDirectory() || lstatSync(toolsFolder).isSymbolicLink())) throw new Error('本地 tools 目录无效')
  mkdirSync(toolsFolder, { recursive: true })
  for (const [relative, content] of Object.entries(files)) writeFileSync(join(root, relative), content, { mode: relative === 'tools/ffprobe' ? 0o755 : 0o600 })
  pkg.scripts = { ...pkg.scripts, ...adaptedScripts }
  writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n')
  writeFileSync(manifestPath, JSON.stringify(adaptation, null, 2) + '\n', { mode: 0o600 })
  return { folder: root, manifestPath, scripts: { ...pkg.scripts }, adaptation }
}
