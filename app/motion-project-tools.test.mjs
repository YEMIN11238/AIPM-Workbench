import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, realpathSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { installMotionProjectTools, validateMotionCues } from './motion-project-tools.mjs'

const app = dirname(fileURLToPath(import.meta.url))
const starter = join(app, 'integrations/motion-design-prompt-generator-upstream/motion-design-prompt-generator/templates/remotion-starter')
const literalSpec = `export const FILM = {\n duration: 10,\n fps: 30, width: 640, height: 360, sound: true\n} as const;\n`
const metadata = { streams: [{ codec_type: 'video', width: 640, height: 360, avg_frame_rate: '30/1' }, { codec_type: 'audio' }], format: { duration: '10.005' } }
const cues = () => ({ duration: 10, bpm: 120, palette: 'data', loop: false, bed: [{ type: 'pad', start: 0, end: 10, note: 'A2', gain: .1 }], patterns: [{ type: 'tick', every: 1, gain: .05 }], events: [{ t: .1, type: 'bell', note: 'E5' }] })
const filterFixture = ['crop', 'scale', 'format', 'ssim', 'showspectrumpic', 'volumedetect', 'fps', 'tile', 'tblend', 'signalstats', 'metadata'].map(name => ' ... ' + name + ' V->V fixture').join('\n')

function fixture(t, { check = 'echo "format matches fixture"\n', probe = metadata } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aipm-motion-tools-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  cpSync(starter, root, { recursive: true })
  mkdirSync(join(root, 'out'), { recursive: true })
  writeFileSync(join(root, 'out/film.mp4'), 'fixture video, not rendered')
  writeFileSync(join(root, 'src/spec.ts'), literalSpec)
  writeFileSync(join(root, 'scripts/cues.json'), JSON.stringify(cues()))
  writeFileSync(join(root, 'scripts/check.sh'), '#!/bin/bash\n' + check)
  writeFileSync(join(root, 'scripts/score.mjs'), `import{writeFileSync}from'node:fs';writeFileSync(new URL('../score-invoked',import.meta.url),'yes');\n`)
  const modules = join(root, 'node_modules')
  mkdirSync(join(modules, '@remotion'), { recursive: true })
  symlinkSync(join(app, 'motion-engine/node_modules/typescript'), join(modules, 'typescript'))
  const compositor = join(modules, '@remotion', 'compositor-' + process.platform + '-' + process.arch)
  mkdirSync(compositor)
  for (const [name, script] of Object.entries({ ffmpeg: 'console.log(' + JSON.stringify(filterFixture) + ')', ffprobe: 'console.log(' + JSON.stringify(JSON.stringify(probe)) + ')' })) writeFileSync(join(compositor, name), '#!' + process.execPath + '\n' + script + '\n', { mode: 0o755 })
  for (const name of ['cli', 'renderer']) { mkdirSync(join(modules, '@remotion', name)); writeFileSync(join(modules, '@remotion', name, 'package.json'), JSON.stringify({ name: '@remotion/' + name, version: '4.0.537' })) }
  writeFileSync(join(modules, '@remotion/cli/remotion-cli.js'), `const fs=require('node:fs');fs.writeFileSync('cli-args.json',JSON.stringify(process.argv.slice(2)));\n`)
  const platform = process.platform === 'darwin' ? 'mac-' + process.arch : process.platform === 'win32' ? 'win64' : process.arch === 'arm64' ? 'linux-arm64' : 'linux64'
  const browserFolder = join(modules, '.remotion/chrome-headless-shell', platform, 'chrome-headless-shell-' + platform)
  mkdirSync(browserFolder, { recursive: true })
  writeFileSync(join(browserFolder, process.platform === 'win32' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell'), 'fixture, never executed', { mode: 0o755 })
  return { root, compositor, run: (name, args = []) => spawnSync(process.execPath, [join(root, 'scripts/workbench-' + name + '.mjs'), ...args], { cwd: '/', encoding: 'utf8', timeout: 10000 }), report: () => JSON.parse(readFileSync(join(root, 'out/check/workbench-check.json'), 'utf8')) }
}

test('同步安装不执行 hooks；原版脚本和 helper 保持字节，保留 upstream 检查入口', t => {
  const f = fixture(t), paths = ['scripts/check.sh', 'scripts/score.mjs', 'src/lib/film.tsx', 'src/lib/motion.tsx']
  const before = paths.map(path => readFileSync(join(f.root, path)))
  const installed = installMotionProjectTools(f.root), pkg = JSON.parse(readFileSync(join(f.root, 'package.json'), 'utf8'))
  assert.equal(installed.folder, realpathSync(f.root))
  assert.equal(existsSync(join(f.root, 'score-invoked')), false)
  assert.equal(pkg.scripts['check:upstream'], 'bash scripts/check.sh')
  assert.equal(pkg.scripts.prestudio, 'node scripts/workbench-score.mjs')
  assert.equal(pkg.scripts.prerender, 'node scripts/workbench-score.mjs')
  assert.equal(pkg.scripts.prepreview, 'node scripts/workbench-score.mjs')
  for (const [i, path] of paths.entries()) assert.deepEqual(readFileSync(join(f.root, path)), before[i])
  assert.deepEqual(installMotionProjectTools(f.root).adaptation, installed.adaptation, 'repeat install is stable')
})

test('不覆盖用户改过的 npm 脚本或适配文件', t => {
  const f = fixture(t), pkg = JSON.parse(readFileSync(join(f.root, 'package.json'), 'utf8'))
  pkg.scripts.render = 'node my-render.mjs'; writeFileSync(join(f.root, 'package.json'), JSON.stringify(pkg))
  assert.throws(() => installMotionProjectTools(f.root), /已改变/)
  pkg.scripts.render = 'remotion render Film out/film.mp4'; writeFileSync(join(f.root, 'package.json'), JSON.stringify(pkg)); installMotionProjectTools(f.root)
  writeFileSync(join(f.root, 'scripts/workbench-check.mjs'), 'user change')
  assert.throws(() => installMotionProjectTools(f.root), /不覆盖/)
})

test('未知 palette、zero every、无限/过大时序在原版 score 子进程之前失败', t => {
  const f = fixture(t); installMotionProjectTools(f.root)
  for (const change of [c => c.palette = 'fantasy', c => c.patterns[0].every = 0, c => c.patterns[0].every = -1, c => c.patterns[0].every = 1e-20, c => c.duration = 1e100, c => c.events[0].dur = 100000, c => c.bed[0].fade = 0, c => c.bpm = 0]) {
    const c = cues(); change(c); writeFileSync(join(f.root, 'scripts/cues.json'), JSON.stringify(c))
    const result = f.run('score'); assert.equal(result.status, 1); assert.equal(existsSync(join(f.root, 'score-invoked')), false)
  }
  assert.throws(() => validateMotionCues({ ...cues(), duration: Infinity }), /有限/)
})

test('合法的原版配乐数据通过受控入口调用原脚本', t => {
  const f = fixture(t); installMotionProjectTools(f.root)
  const result = f.run('score'); assert.equal(result.status, 0, result.stderr); assert.equal(readFileSync(join(f.root, 'score-invoked'), 'utf8'), 'yes')
  assert.ok(validateMotionCues(cues()).eventsUpperBound > 0)
})

test('原版打印 FAIL 即使 exit0 也失败，并保留真实结果与待人工视觉检查状态', t => {
  const f = fixture(t, { check: 'echo "  FAIL width mismatch"\nexit 0\n' }); installMotionProjectTools(f.root)
  const result = f.run('check'); assert.equal(result.status, 1, result.stderr)
  const report = f.report(); assert.equal(report.status, 'failed'); assert.equal(report.upstream.exitCode, 0); assert.equal(report.visualReview, 'pending'); assert.ok(report.errors.some(e => e.includes('FAIL')))
})

test('原版非零返回或缺少受控 ffprobe 不会被当成成功', t => {
  const f = fixture(t, { check: 'echo "broken" >&2\nexit 7\n' }); installMotionProjectTools(f.root)
  assert.equal(f.run('check').status, 1); assert.equal(f.report().upstream.exitCode, 7)
  rmSync(join(f.compositor, 'ffprobe')); assert.equal(f.run('check').status, 1); assert.match(f.report().errors.join(' '), /缺少/)
})

test('多行 FILM 规格由 AST 读取并与真实 probe 比较，不执行 spec 代码', t => {
  const f = fixture(t); installMotionProjectTools(f.root)
  writeFileSync(join(f.root, 'src/spec.ts'), literalSpec + '\nthrow new Error("must never execute generated module");\n')
  const result = f.run('check'); assert.equal(result.status, 0, result.stderr); const report = f.report()
  assert.equal(report.status, 'passed'); assert.equal(report.spec.width, 640); assert.equal(report.actual.duration, 10.005); assert.equal(report.visualReview, 'pending')
  writeFileSync(join(f.root, 'src/spec.ts'), literalSpec.replace('width: 640', 'width: 800'))
  assert.equal(f.run('check').status, 1); assert.match(f.report().errors.join(' '), /width/)
})

test('动态规格不能静默判通过；无法读取静态常量时明确 pending', t => {
  const f = fixture(t); installMotionProjectTools(f.root)
  writeFileSync(join(f.root, 'src/spec.ts'), literalSpec.replace('duration: 10', 'duration: readDuration()'))
  assert.equal(f.run('check').status, 2); assert.equal(f.report().status, 'pending'); assert.match(f.report().warnings.join(' '), /静态字面量/)
})

test('超量检查输出有界且不能截掉 FAIL 后误报通过', t => {
  const f = fixture(t, { check: 'head -c 90000 /dev/zero | tr "\\000" x\necho ""\necho "FAIL after long output"\n' }); installMotionProjectTools(f.root)
  assert.equal(f.run('check').status, 1); const report = f.report(); assert.equal(report.upstream.truncated, true); assert.ok(report.upstream.output.length <= 65536); assert.equal(report.status, 'failed')
})

test('完整 render/preview/still 固定 headless shell、PNG 和禁用共享内存捕获', t => {
  const f = fixture(t); installMotionProjectTools(f.root)
  for (const mode of ['render', 'preview', 'still']) {
    const result = f.run('remotion', [mode, '--concurrency=2']); assert.equal(result.status, 0, result.stderr)
    const args = JSON.parse(readFileSync(join(f.root, 'cli-args.json'), 'utf8'))
    assert.ok(args.includes('--chrome-mode=headless-shell')); assert.ok(args.includes('--image-format=png')); assert.ok(args.includes('--disable-shared-memory-capture')); assert.ok(args.some(a => a.startsWith('--browser-executable=') && a.includes('chrome-headless-shell')))
    assert.equal(args[0], mode === 'still' ? 'still' : 'render'); assert.equal(args[1], 'Film')
    if (mode === 'preview') assert.ok(args.includes('--scale=0.5'))
  }
})

test('不接受覆盖安全捕获参数，也不在浏览器缺失时回退系统 Chrome', t => {
  const f = fixture(t); installMotionProjectTools(f.root)
  assert.equal(f.run('remotion', ['render', '--chrome-mode=chrome-for-testing']).status, 1); assert.equal(existsSync(join(f.root, 'cli-args.json')), false)
  rmSync(join(f.root, 'node_modules/.remotion'), { recursive: true })
  const result = f.run('remotion', ['render']); assert.equal(result.status, 1); assert.match(result.stderr, /Headless Shell/); assert.equal(existsSync(join(f.root, 'cli-args.json')), false)
})

test('宿主共享 node_modules 链接仍可使用已固定的 CLI 和本地浏览器', t => {
  const f = fixture(t); installMotionProjectTools(f.root)
  const shared = mkdtempSync(join(tmpdir(), 'aipm-motion-runtime-')); t.after(() => rmSync(shared, { recursive: true, force: true }))
  renameSync(join(f.root, 'node_modules'), join(shared, 'node_modules')); symlinkSync(join(shared, 'node_modules'), join(f.root, 'node_modules'))
  const result = f.run('remotion', ['render']); assert.equal(result.status, 0, result.stderr)
  assert.ok(existsSync(join(f.root, 'cli-args.json')))
})

test('优先完整 tools/ffmpeg，并在受保护 shell 后给 ffprobe 恢复动态库路径', t => {
  const f = fixture(t, { check: 'ffprobe -v error -show_format -of json out/film.mp4 >/dev/null\ncommand -v ffmpeg\n' }); installMotionProjectTools(f.root)
  cpSync(join(f.compositor, 'ffmpeg'), join(f.root, 'tools/ffmpeg'))
  writeFileSync(join(f.compositor, 'ffmpeg'), '#!' + process.execPath + '\nthrow new Error("stripped compositor ffmpeg must not be used");\n')
  writeFileSync(join(f.compositor, 'ffprobe'), '#!' + process.execPath + '\nif(!(process.env[process.platform===\'darwin\'?\'DYLD_LIBRARY_PATH\':\'LD_LIBRARY_PATH\']||\'\').includes(\'compositor-\'))process.exit(9);console.log(' + JSON.stringify(JSON.stringify(metadata)) + ');\n')
  const result = f.run('check'); assert.equal(result.status, 0, result.stderr)
  assert.equal(f.report().toolchain.ffmpeg, join(realpathSync(f.root), 'tools/ffmpeg'))
  assert.match(f.report().upstream.output, /tools\/ffmpeg/)
})

test('裁剪版 FFmpeg 缺滤镜即停止，不运行不完整的上游检查', t => {
  const f = fixture(t); installMotionProjectTools(f.root)
  writeFileSync(join(f.compositor, 'ffmpeg'), '#!' + process.execPath + '\nconsole.log(" ... scale V->V fixture");\n')
  assert.equal(f.run('check').status, 1); assert.match(f.report().errors.join(' '), /缺少.*滤镜/); assert.equal(f.report().upstream, undefined)
})

test('真实有效MP4使用完整FFmpeg、Remotion ffprobe及原版检查生成接触表', { skip: !process.env.AIPM_MOTION_SAMPLE || !process.env.AIPM_MOTION_FFMPEG, timeout: 120000 }, t => {
  const root = mkdtempSync(join(tmpdir(), 'aipm-motion-real-check-')); t.after(() => rmSync(root, { recursive: true, force: true }))
  cpSync(starter, root, { recursive: true }); symlinkSync(join(app, 'motion-engine/node_modules'), join(root, 'node_modules'))
  mkdirSync(join(root, 'out'), { recursive: true }); mkdirSync(join(root, 'tools'))
  cpSync(process.env.AIPM_MOTION_SAMPLE, join(root, 'out/film.mp4')); cpSync(process.env.AIPM_MOTION_FFMPEG, join(root, 'tools/ffmpeg'))
  writeFileSync(join(root, 'src/spec.ts'), 'export const FILM = {duration: 10, fps: 30, width: 1920, height: 1080, sound: true};\n')
  writeFileSync(join(root, 'scripts/cues.json'), JSON.stringify(cues()))
  installMotionProjectTools(root)
  const result = spawnSync(process.execPath, [join(root, 'scripts/workbench-check.mjs')], { cwd: root, encoding: 'utf8', timeout: 115000, maxBuffer: 200000 })
  const report = JSON.parse(readFileSync(join(root, 'out/check/workbench-check.json'), 'utf8'))
  assert.equal(result.status, 0, (result.stdout + result.stderr).slice(-12000)); assert.equal(report.status, 'passed'); assert.equal(report.upstream.exitCode, 0)
  for (const name of ['sheet.png', 'audio.png', 'f-0.png']) assert.ok(readFileSync(join(root, 'out/check', name)).length > 100)
  assert.equal(report.actual.width, 1920); assert.equal(report.actual.height, 1080); assert.equal(report.visualReview, 'pending')
})
