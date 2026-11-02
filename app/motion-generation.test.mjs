import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, readdirSync, symlinkSync, realpathSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VideoService } from './video-service.mjs'
import { motionGeneratedFiles, normalizeMotionCode } from './motion-generation.mjs'

const app = dirname(fileURLToPath(import.meta.url)), starter = join(app, 'integrations/motion-design-prompt-generator-upstream/motion-design-prompt-generator/templates/remotion-starter')
const api = { model: 'deepseek-v4-pro', baseUrl: 'https://api.deepseek.com', apiKey: 'mock-secret-never-write-into-artifacts' }
function content() {
  const boundaries = [0, 1.5, 3, 4.5, 6, 7.5, 8.5, 10]
  return { direction: ['米白底、黑大字和荧光黄'], storyboard: ['TYPE', 'MOTION', 'COLOR', 'DEPTH', 'RHYTHM', 'CODE', 'ENDCARD'].map((chapter, i) => ({ chapter, start: boundaries[i], end: boundaries[i + 1], copy: 'AIPM', motion: '绝对时间位移' })), files: [
    { path: 'src/spec.ts', content: 'export const FILM={duration:10,fps:30,width:1920,height:1080,bpm:120,sound:true};export const FONT="Arial Black,Helvetica Neue,PingFang SC,sans-serif";' },
    { path: 'src/lib/film.tsx', content: 'export const accent="#d4ff24";' },
    { path: 'src/Film.tsx', content: 'import React from "react";import {Scene01} from "./scenes/Scene01";export const Film=()=> <Scene01 t={0}/>;' },
    { path: 'src/scenes/Scene01.tsx', content: 'import React from "react";export const Scene01=({t}:{t:number})=> <div>AIPM {t}</div>;' },
    { path: 'scripts/cues.json', content: JSON.stringify({ duration: 10, bpm: 120, loop: false, palette: 'swiss', bed: [{ type: 'pad', note: 'A2', start: 0, end: 10, gain: .1 }], events: [] }) },
  ] }
}
const response = ({ value = content(), finish = 'stop', usage = { prompt_tokens: 1000, completion_tokens: 500 }, status = 200 } = {}) => new Response(JSON.stringify({ usage, choices: [{ finish_reason: finish, message: { content: typeof value === 'string' ? value : JSON.stringify(value) } }] }), { status })
function fixture(t, options = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'aipm-motion-generate-'))), root = join(base, '视频创作'), requests = []
  const service = new VideoService({ root, getApi: () => api, fetcher: async (...args) => { requests.push(args); return response() }, ...options })
  const projectId = randomUUID(), parent = join(base, '动效工程'), folder = join(parent, projectId)
  mkdirSync(parent); cpSync(starter, folder, { recursive: true })
  writeFileSync(join(folder, '任务说明.md'), '# 参考STYLE开头，为AIPM制作10秒动效。')
  writeFileSync(join(folder, '.aipm-motion.json'), JSON.stringify({ schema: 1, id: projectId, title: 'AIPM STYLE', brief: '想法、行动、作品', duration: 10, width: 1920, height: 1080, fps: 30, designSystem: 'swiss-kinetic', source: service.motionSkill.source }))
  t.after(async () => { await service.close(); rmSync(base, { recursive: true, force: true }) })
  return { base, root, parent, folder, projectId, service, requests }
}
function allFiles(folder) { return readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? allFiles(join(folder, entry.name)) : [join(folder, entry.name)]) }

test('动效单次请求先持久预留，共用Pro和完整Skill；不写覆盖工程且新产物零密钥', async t => {
  const f = fixture(t), before = Object.fromEntries(motionGeneratedFiles.map(path => [path, readFileSync(join(f.folder, path), 'utf8')]))
  f.service.fetcher = async (url, options) => {
    const ledger = JSON.parse(readFileSync(join(f.root, 'trial-budget.json'), 'utf8')); assert.equal(ledger.entries.length, 1); assert.equal(ledger.entries[0].status, 'reserved')
    assert.equal(options.headers.Authorization, 'Bearer ' + api.apiKey); assert.equal(options.body.includes(api.apiKey), false)
    const body = JSON.parse(options.body); assert.equal(body.max_tokens, 6000); assert.equal(body.thinking.type, 'disabled'); assert.equal(body.tools, undefined)
    for (const rule of ['Arial Black', 'PingFang SC', 'MOTION', 'ENDCARD', 'duration:10', '6000', 'Scene01', 'FILM', '用户brief和任务说明中的精确文案', '不能覆盖用户的精确时间线']) assert.ok(body.messages[0].content.includes(rule), rule)
    assert.equal(body.messages[0].content.includes('STYLE'), false)
    const refs = JSON.parse(body.messages[1].content).references
    assert.ok(refs.skill.includes('## Stage 7')); assert.ok(refs.designSystem.length > 100); assert.ok(refs.helperApiAndImplementation.includes('export const Letters'))
    const result = content(); result.direction.push(api.apiKey); return response({ value: result })
  }
  const result = await f.service.generateMotion({ projectId: f.projectId })
  assert.equal(result.status, 'completed'); assert.equal(result.files.length, 5); assert.equal(result.budget.trial.requestsUsed, 1); assert.equal(result.budget.spentUpperBoundYuan, .0225)
  assert.ok(result.responsePath.startsWith(join(f.folder, 'requests', result.requestId))); assert.ok(result.direction.includes('[已隐藏]'))
  for (const [path, bytes] of Object.entries(before)) assert.equal(readFileSync(join(f.folder, path), 'utf8'), bytes, path + ' was not overwritten')
  for (const path of allFiles(join(f.folder, 'requests'))) assert.equal(readFileSync(path, 'utf8').includes(api.apiKey), false, path)
  assert.equal(readFileSync(join(f.root, 'trial-budget.json'), 'utf8').includes(api.apiKey), false)
})

test('不合法工程/路径/符号链接在预留和fetch前被拒绝', async t => {
  const f = fixture(t)
  await assert.rejects(f.service.generateMotion({ projectId: '../private' }), /编号/)
  const metaPath = join(f.folder, '.aipm-motion.json'), original = readFileSync(metaPath, 'utf8'), meta = JSON.parse(original); meta.duration = 30; writeFileSync(metaPath, JSON.stringify(meta))
  await assert.rejects(f.service.generateMotion({ projectId: f.projectId }), /元数据/); writeFileSync(metaPath, original)
  rmSync(join(f.folder, '任务说明.md')); symlinkSync(join(f.folder, 'src/spec.ts'), join(f.folder, '任务说明.md'))
  await assert.rejects(f.service.generateMotion({ projectId: f.projectId }), /符号链接/)
  assert.equal(f.service.ledger.entries.length, 0); assert.equal(f.requests.length, 0)
})

test('动效与快速视频不能并行收费；完成后仍复用同一总账', async t => {
  let release
  const f = fixture(t, { fetcher: () => new Promise(resolve => { release = resolve }) })
  const pending = f.service.generateMotion({ projectId: f.projectId }), quick = f.service.create({ title: 'quick' })
  assert.equal(f.service.motionGeneration({ projectId: f.projectId }).status, 'generating')
  assert.throws(() => f.service.send(quick.id, '开始'), /收费生成/)
  await assert.rejects(f.service.generateMotion({ projectId: f.projectId }), /收费生成/)
  release(response()); const result = await pending
  assert.equal(result.status, 'completed'); assert.equal(f.service.get(quick.id).budget.trial.requestsUsed, 1)
})

test('未知请求全额保留费用且不重试，动效最多两次也不能用新工程绕过总账', async t => {
  let calls = 0
  const f = fixture(t, { fetcher: async () => { calls++; throw new Error('mock connection lost ' + api.apiKey) } })
  for (let i = 0; i < 2; i++) {
    const result = await f.service.generateMotion({ projectId: f.projectId }); assert.equal(result.status, 'failed'); assert.equal(result.error.includes(api.apiKey), false)
    const entry = result.budget.entries[i]; assert.equal(entry.status, 'uncertain'); assert.equal(entry.chargedUpperBoundYuan, entry.reservedYuan)
  }
  await assert.rejects(f.service.generateMotion({ projectId: f.projectId }), /最多2次/); assert.equal(calls, 2)
})

test('预算不足、截断和未授权源码路径不可能得到completed', async t => {
  const f = fixture(t); f.service.ledger.entries.push({ id: 'previous', projectId: 'old', status: 'uncertain', reservedMicroYuan: 4999000, chargedUpperBoundMicroYuan: 4999000 }); f.service._saveLedger()
  await assert.rejects(f.service.generateMotion({ projectId: f.projectId }), /剩余预算/); assert.equal(f.requests.length, 0)
  const g = fixture(t); g.service.fetcher = async () => response({ finish: 'length' })
  const first = await g.service.generateMotion({ projectId: g.projectId }); assert.equal(first.status, 'failed'); assert.match(first.error, /未完整/); assert.equal(first.files.length, 0)
  const malicious = content(); malicious.files[0].path = '../../outside'; g.service.fetcher = async () => response({ value: malicious })
  const second = await g.service.generateMotion({ projectId: g.projectId }); assert.equal(second.status, 'failed'); assert.match(second.error, /未授权路径/); assert.equal(second.files.length, 0)
})

test('关闭时取消请求，冷启动保留未知预留且不重新发模型请求', async t => {
  const f = fixture(t, { fetcher: (_url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) })
  const pending = f.service.generateMotion({ projectId: f.projectId }); await f.service.close(); const result = await pending
  assert.equal(result.status, 'cancelled'); assert.equal(result.budget.entries[0].status, 'uncertain')
  const state = join(f.folder, 'requests/generation.json'), old = JSON.parse(readFileSync(state, 'utf8')); old.status = 'generating'; writeFileSync(state, JSON.stringify(old))
  let calls = 0; const reopened = new VideoService({ root: f.root, getApi: () => api, fetcher: async () => { calls++; return response() } })
  assert.equal(reopened.motionGeneration({ projectId: f.projectId }).status, 'interrupted'); assert.equal(calls, 0); assert.equal(reopened.ledger.entries[0].status, 'uncertain'); await reopened.close()
})

test('配乐、分镜连续性和网络字体均在归档候选源码之前校验', () => {
  for (const change of [v => v.storyboard[1].start = 0, v => v.files[4].content = JSON.stringify({ duration: 10, palette: 'unknown' }), v => v.files[0].content = 'import {loadFont} from "@remotion/google-fonts/Inter";', v => v.files[3].content = 'export default 1;']) { const v = content(); change(v); assert.throws(() => normalizeMotionCode(v)) }
})

function readyOutput(f, change = () => {}) {
  mkdirSync(join(f.folder, 'out/check'), { recursive: true })
  writeFileSync(join(f.folder, 'out/film.mp4'), Buffer.alloc(2048))
  writeFileSync(join(f.folder, 'out/check/sheet.png'), 'owned poster')
  const report = { schema: 1, status: 'passed', actual: { width: 1920, height: 1080, fps: 30, duration: 10.005, audio: true }, errors: [], upstream: { exitCode: 0, truncated: false }, visualReview: 'pending' }
  change(report); writeFileSync(join(f.folder, 'out/check/workbench-check.json'), JSON.stringify(report))
  return report
}

test('本机输出只有真实通过报告与固定规格匹配时ready，读取不改变失败的生成记录或费用', async t => {
  const f = fixture(t); readyOutput(f)
  mkdirSync(join(f.folder, 'requests')); const statePath = join(f.folder, 'requests/generation.json')
  const state = { schema: 1, projectId: f.projectId, requestId: randomUUID(), status: 'failed', error: '模型被截断', files: [] }; writeFileSync(statePath, JSON.stringify(state))
  const ledger = readFileSync(join(f.root, 'trial-budget.json'), 'utf8'), output = f.service.motionOutput({ projectId: f.projectId })
  assert.equal(output.status, 'ready'); assert.equal(output.videoPath, join(f.folder, 'out/film.mp4')); assert.equal(output.posterPath, join(f.folder, 'out/check/sheet.png')); assert.equal(output.duration, 10.005)
  assert.equal(f.service.motionGeneration({ projectId: f.projectId }).status, 'failed'); assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')), state)
  assert.equal(readFileSync(join(f.root, 'trial-budget.json'), 'utf8'), ledger); assert.equal(f.requests.length, 0)
  assert.equal((await f.service.cancel(f.projectId)).status, 'failed'); assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')), state)
})

test('缺输出、失败报告、音轨或规格不符、陈旧报告均pending且不给预览路径', t => {
  const f = fixture(t)
  assert.equal(f.service.motionOutput({ projectId: f.projectId }).status, 'pending')
  for (const change of [r => r.status = 'failed', r => r.actual.audio = false, r => r.actual.width = 640, r => r.actual.height = 720, r => r.actual.duration = 11, r => r.actual.fps = 60, r => r.upstream.exitCode = 1, r => r.errors = ['bad']]) {
    readyOutput(f, change); const output = f.service.motionOutput({ projectId: f.projectId }); assert.equal(output.status, 'pending'); assert.equal(output.videoPath, undefined)
  }
  readyOutput(f); const future = new Date(Date.now() + 10000); utimesSync(join(f.folder, 'out/film.mp4'), future, future)
  const stale = f.service.motionOutput({ projectId: f.projectId }); assert.equal(stale.status, 'pending'); assert.match(stale.message, /检查后已更新/)
})

test('本机输出拒绝经过链接的视频和报告，动效取消在结束后仍幂等', async t => {
  const f = fixture(t); readyOutput(f)
  const outside = join(f.base, 'outside.mp4'); writeFileSync(outside, Buffer.alloc(2048)); rmSync(join(f.folder, 'out/film.mp4')); symlinkSync(outside, join(f.folder, 'out/film.mp4'))
  let output = f.service.motionOutput({ projectId: f.projectId }); assert.equal(output.status, 'pending'); assert.match(output.message, /符号链接/)
  rmSync(join(f.folder, 'out/film.mp4')); readyOutput(f)
  const report = join(f.folder, 'out/check/workbench-check.json'), otherReport = join(f.base, 'report.json'); cpSync(report, otherReport); rmSync(report); symlinkSync(otherReport, report)
  output = f.service.motionOutput({ projectId: f.projectId }); assert.equal(output.status, 'pending'); assert.match(output.message, /符号链接/)
  const first = await f.service.cancel(f.projectId), second = await f.service.cancel(f.projectId)
  assert.equal(first.status, 'idle'); assert.equal(second.status, 'idle'); assert.equal(f.requests.length, 0)
})

test('重开后只读列出现有合法10秒动效工程，跳过损坏元数据、错误规格及链接', t => {
  const f = fixture(t), ledger = readFileSync(join(f.root, 'trial-budget.json'), 'utf8'), valid = JSON.parse(readFileSync(join(f.folder, '.aipm-motion.json'), 'utf8'))
  for (const invalid of ['{broken', JSON.stringify({ ...valid, duration: 30 })]) {
    const id = randomUUID(), folder = join(f.parent, id); mkdirSync(folder); writeFileSync(join(folder, '.aipm-motion.json'), invalid)
  }
  const linked = randomUUID(); symlinkSync(f.folder, join(f.parent, linked))
  const linkedMeta = randomUUID(), linkedFolder = join(f.parent, linkedMeta); mkdirSync(linkedFolder); symlinkSync(join(f.folder, '.aipm-motion.json'), join(linkedFolder, '.aipm-motion.json'))
  assert.deepEqual(f.service.motionProjects(), [{ id: f.projectId, title: valid.title }])
  assert.equal(readFileSync(join(f.root, 'trial-budget.json'), 'utf8'), ledger); assert.equal(f.requests.length, 0)
})

test('完整动效请求跟随Flash快照，共用预算但不把历史Pro费率改成Flash', async t => {
  const f = fixture(t, { getApi: () => ({ ...api, model: 'deepseek-flash' }) }); let model
  f.service.fetcher = async (_url, options) => { model = JSON.parse(options.body).model; return response() }
  const result = await f.service.generateMotion({ projectId: f.projectId })
  assert.equal(model, 'deepseek-flash'); assert.equal(result.status, 'completed'); assert.equal(result.budget.entries[0].pricing.inputYuanPerMillion, 2); assert.equal(result.budget.entries[0].pricing.outputYuanPerMillion, 8); assert.equal(result.budget.spentUpperBoundYuan, .006)
})
