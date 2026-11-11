import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VideoService } from './video-service.mjs'
import { pricedVideoApi, videoRequestQuote, videoBudgetTotals, settleVideoEntry, VIDEO_MAX_OUTPUT_TOKENS } from './video-budget.mjs'

const api = { model: 'deepseek-v4-pro', baseUrl: 'https://api.deepseek.com', apiKey: 'test-never-persist-this-secret' }
const storyboard = () => ({ title: 'ORVYN', voiceover: '从一个想法开始，和AI一起完成产品。', palette: { background: '#101827', accent: '#67E8F9', text: '#FFFFFF' }, scenes: [{ id: 'intro', duration: 5, title: 'ORVYN', subtitle: '想法到执行', body: '中文对话', kind: 'hero', accent: '#67E8F9' }, { id: 'end', duration: 5, title: '让想法落地', subtitle: '', body: '', kind: 'outro', accent: '#67E8F9' }] })
function response({ usage = { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 }, finish = 'stop', content } = {}) { return new Response(JSON.stringify({ usage, choices: [{ finish_reason: finish, message: { role: 'assistant', content: content ?? JSON.stringify({ reply: '已保存两个镜头，可以修改或渲染。', storyboard: storyboard() }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } }) }
function setup(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'aipm-video-service-')), requests = [], updates = []
  const service = new VideoService({ root, getApi: () => ({ ...api }), onUpdate: project => updates.push(project), fetcher: async (...args) => { requests.push(args); return response() }, renderVideo: async ({ project, outputDir, onProgress }) => { onProgress({ phase: 'render', ratio: 0.5, message: '模拟可信渲染器' }); const videoPath = join(outputDir, 'video.mp4'), posterPath = join(outputDir, 'poster.png'), projectPath = join(outputDir, 'project.json'); writeFileSync(videoPath, 'owned mock output'); writeFileSync(posterPath, 'owned mock poster'); writeFileSync(projectPath, JSON.stringify(project.storyboard)); return { videoPath, posterPath, projectPath, duration: project.duration, width: project.width, height: project.height, fps: project.fps } }, ...options })
  t.after(async () => { await service.close(); rmSync(root, { recursive: true, force: true }) })
  return { root, service, requests, updates, create: input => service.create({ title: 'ORVYN', brief: '做一个玻璃风格介绍视频', ...input }), wait: async id => { await service.active.get(id)?.done; return service.get(id) } }
}

test('budget accepts only the explicitly priced official route and reserves UTF8 bytes plus protocol margin', () => {
  assert.equal(pricedVideoApi(api).endpoint, 'https://api.deepseek.com/chat/completions')
  assert.equal(pricedVideoApi({ ...api, baseUrl: 'https://api.deepseek.com/v1' }).endpoint, 'https://api.deepseek.com/v1/chat/completions')
  for (const value of [{ ...api, model: 'deepseek-chat' }, { ...api, baseUrl: 'https://proxy.example.com' }, { ...api, baseUrl: 'http://api.deepseek.com' }, { ...api, baseUrl: 'https://api.deepseek.com/other' }]) assert.throws(() => pricedVideoApi(value), /无法核算/)
  const body = { model: api.model, max_tokens: VIDEO_MAX_OUTPUT_TOKENS, messages: [{ role: 'user', content: '中文测试' }] }, quote = videoRequestQuote(body)
  assert.ok(quote.inputTokenUpperBound >= Buffer.byteLength(JSON.stringify(body), 'utf8') + 4096)
  assert.equal(quote.reservedMicroYuan, quote.inputTokenUpperBound * 9 + 6000 * 27)
  const entry = { id: 'e', status: 'reserved', ...quote }, settled = settleVideoEntry(entry, { prompt_tokens: 1000, completion_tokens: 500 })
  assert.equal(settled.chargedUpperBoundYuan, 0.0225); assert.equal(settled.status, 'settled')
  const unknown = settleVideoEntry(entry, null); assert.equal(unknown.status, 'uncertain'); assert.equal(unknown.chargedUpperBoundYuan, quote.reservedYuan)
  assert.equal(videoBudgetTotals([unknown], 5).reservedYuan, 0)
})

test('odd or out-of-range dimensions are refused before any project or budget request exists', t => {
  const f = setup(t)
  for (const size of [{ width: 1921, height: 1080 }, { width: 1920, height: 1081 }, { width: 318, height: 180 }, { width: 320, height: 178 }, { width: 3842, height: 1080 }, { width: 1920, height: 2162 }]) assert.throws(() => f.create(size), /宽高均为偶数/)
  assert.equal(f.service.list().length, 0); assert.equal(f.requests.length, 0); assert.equal(f.service.ledger.entries.length, 0)
  const smallest = f.create({ width: 320, height: 180 }); assert.equal(smallest.width, 320); assert.equal(smallest.height, 180)
  const largest = f.create({ width: 3840, height: 2160 }); assert.equal(largest.width, 3840); assert.equal(largest.height, 2160)
})

test('generation persists reservation before charging, reuses Pro, and never sends or logs the secret as content', async t => {
  const seen = [], f = setup(t, { fetcher: async (url, options) => {
    const ledger = JSON.parse(readFileSync(join(f.root, 'trial-budget.json'), 'utf8')); assert.equal(ledger.entries.length, 1); assert.equal(ledger.entries[0].status, 'reserved'); assert.ok(ledger.entries[0].reservedYuan > 0)
    assert.equal(options.headers.Authorization, 'Bearer ' + api.apiKey); const body = JSON.parse(options.body); assert.equal(body.model, 'deepseek-v4-pro'); assert.equal(body.max_tokens, 6000); assert.equal(body.thinking.type, 'disabled'); assert.doesNotMatch(options.body, new RegExp(api.apiKey)); seen.push(url); return response()
  } })
  const p = f.create({ brief: '制作要求里也不该保存意外粘贴的密钥 ' + api.apiKey }), started = f.service.send(p.id, '请制作样片，不要输出这个意外粘贴的值 ' + api.apiKey); assert.equal(started.status, 'generating')
  const complete = await f.wait(p.id); assert.equal(complete.status, 'idle'); assert.equal(complete.storyboard.scenes.length, 2); assert.equal(complete.messages.length, 2); assert.equal(complete.budget.spentUpperBoundYuan, 0.0225); assert.equal(complete.budget.reservedYuan, 0); assert.equal(complete.budget.trial.requestsUsed, 1)
  assert.equal(seen.length, 1); const requestPath = join(f.service.folder(p.id), 'requests', complete.budget.entries[0].id)
  for (const file of ['request.json', 'response.json']) assert.equal(readFileSync(join(requestPath, file), 'utf8').includes(api.apiKey), false)
  assert.equal(readFileSync(join(f.service.folder(p.id), 'project.json'), 'utf8').includes(api.apiKey), false)
})

test('insufficient project or shared trial budget rejects before fetch; unknown outcomes consume the request allowance without retry', async t => {
  const f = setup(t), small = f.create({ budgetYuan: 0.01 }); assert.throws(() => f.service.send(small.id, '开始'), /剩余预算不足/); assert.equal(f.requests.length, 0)
  f.service.ledger.entries.push({ id: 'previous', projectId: small.id, status: 'uncertain', reservedMicroYuan: 4990000, chargedUpperBoundMicroYuan: 4990000 }); f.service._saveLedger()
  const p = f.create(); assert.throws(() => f.service.send(p.id, '开始'), /剩余预算不足/); assert.equal(f.requests.length, 0)
  const other = setup(t, { fetcher: async () => { throw new Error('模拟网络结果不明') } }), first = other.create()
  for (let i = 0; i < 3; i++) { other.service.send(first.id, '生成一次'); const result = await other.wait(first.id); assert.equal(result.status, 'failed'); assert.equal(result.budget.entries[i].status, 'uncertain'); assert.equal(result.budget.entries[i].chargedUpperBoundYuan, result.budget.entries[i].reservedYuan) }
  const second = other.create(); assert.throws(() => other.service.send(second.id, '新项目仍不能绕过'), /最多3次/); assert.equal(other.service.ledger.entries.length, 3)
})

test('missing usage and invalid JSON or truncated completion retain charged bounds and preserve the prior storyboard', async t => {
  const cases = [response({ usage: null }), response({ finish: 'length' }), response({ content: '{broken' })]
  const f = setup(t, { fetcher: async () => cases.shift() }), p = f.create(); f.service.saveStoryboard(p.id, { storyboard: storyboard() })
  f.service.send(p.id, '一次缺少用量的完整结果'); let result = await f.wait(p.id); assert.equal(result.status, 'idle'); assert.equal(result.budget.entries[0].status, 'uncertain')
  f.service.send(p.id, '一次真实截断'); result = await f.wait(p.id); assert.equal(result.status, 'failed'); assert.match(result.error, /没有完整返回/); assert.equal(result.budget.entries[1].status, 'settled'); assert.equal(result.storyboard.title, 'ORVYN')
  f.service.send(p.id, '一次错误JSON'); result = await f.wait(p.id); assert.equal(result.status, 'failed'); assert.equal(result.budget.entries[2].status, 'settled'); assert.equal(result.storyboard.scenes.length, 2)
})

test('cold startup never reissues an interrupted request or refunds its unknown reservation', async t => {
  const f = setup(t), p = f.create(), quote = videoRequestQuote({ model: api.model, max_tokens: 6000, messages: [] })
  f.service.ledger.entries.push({ id: 'interrupted-entry', projectId: p.id, model: api.model, status: 'reserved', ...quote }); f.service._saveLedger()
  const file = join(f.service.folder(p.id), 'project.json'), saved = JSON.parse(readFileSync(file, 'utf8')); saved.status = 'generating'; writeFileSync(file, JSON.stringify(saved))
  let calls = 0; const reopened = new VideoService({ root: f.root, getApi: () => api, fetcher: async () => { calls++; return response() } })
  const result = reopened.get(p.id); assert.equal(calls, 0); assert.equal(result.status, 'interrupted'); assert.equal(result.budget.entries[0].status, 'uncertain'); assert.equal(result.budget.spentUpperBoundYuan, quote.reservedYuan); assert.equal(result.budget.trial.requestsUsed, 1); await reopened.close()
})

test('cancel awaits the owned model request and keeps its uncertain reservation spent', async t => {
  let aborted = false
  const f = setup(t, { fetcher: (_url, { signal }) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => { aborted = true; reject(new Error('AbortError')) }, { once: true }) }) }), p = f.create()
  f.service.send(p.id, '开始'); const result = await f.service.cancel(p.id)
  assert.equal(aborted, true); assert.equal(result.status, 'cancelled'); assert.equal(result.budget.entries[0].status, 'uncertain'); assert.equal(f.service.active.size, 0)
})

test('storyboard validation rejects wrong timing, executable fields and missing asset references', t => {
  const f = setup(t), p = f.create(), wrong = storyboard(); wrong.scenes[0].duration = 8
  assert.throws(() => f.service.saveStoryboard(p.id, { storyboard: wrong }), /总时长/)
  const kind = storyboard(); kind.scenes[0].kind = 'run-code'; assert.throws(() => f.service.saveStoryboard(p.id, { storyboard: kind }), /类型/)
  const asset = storyboard(); asset.scenes[0].assetId = '/private/file'; assert.throws(() => f.service.saveStoryboard(p.id, { storyboard: asset }), /未导入/)
  const unsafe = storyboard(); unsafe.scenes[0].id = '../../private'; assert.throws(() => f.service.saveStoryboard(p.id, { storyboard: unsafe }), /镜头编号/)
})

test('assets are copied into the project and immutable rendered versions keep actual owned output paths', async t => {
  const f = setup(t), p = f.create(), source = join(f.root, 'screenshot.png'); writeFileSync(source, 'mock picker-validated PNG')
  let project = f.service.addAssets(p.id, [{ path: source, name: '工作台页面' }]); assert.ok(project.assets[0].path.startsWith(join(f.service.folder(p.id), 'assets'))); assert.notEqual(project.assets[0].path, source)
  const plan = storyboard(); plan.scenes[0].assetId = project.assets[0].id; f.service.saveStoryboard(p.id, { storyboard: plan })
  const started = f.service.render(p.id); assert.equal(started.status, 'rendering'); project = await f.wait(p.id); assert.equal(project.status, 'completed'); assert.equal(project.versions[0].version, 'v1'); assert.equal(project.budget.trial.requestsUsed, 0); assert.ok(existsSync(project.versions[0].videoPath))
  const revised = storyboard(); revised.title = '修订'; f.service.saveStoryboard(p.id, { storyboard: revised }); f.service.render(p.id); project = await f.wait(p.id); assert.equal(project.versions[1].version, 'v2'); assert.equal(project.versions[0].storyboard.title, 'ORVYN')
  const symlink = join(f.root, 'link.png'); symlinkSync(source, symlink); assert.throws(() => f.service.addAssets(p.id, [{ path: symlink }]), /普通PNG/)
})

test('renderer errors, outside outputs and cancellation never add a completed version', async t => {
  const f = setup(t, { renderVideo: async () => { throw new Error('模拟渲染失败') } }), p = f.create(); f.service.saveStoryboard(p.id, { storyboard: storyboard() }); f.service.render(p.id)
  let result = await f.wait(p.id); assert.equal(result.status, 'failed'); assert.equal(result.versions.length, 0)
  const outside = join(f.root, 'outside.mp4'); writeFileSync(outside, 'mock'); f.service.renderVideo = async () => ({ videoPath: outside, posterPath: outside, duration: 10 }); f.service.render(p.id); result = await f.wait(p.id); assert.equal(result.status, 'failed'); assert.match(result.error, /版本目录/)
  f.service.renderVideo = ({ signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true })); f.service.render(p.id); result = await f.service.cancel(p.id); assert.equal(result.status, 'cancelled'); assert.equal(result.versions.length, 0)
})

test('actual bundled motion skill directions and pinned provenance enter the constrained prompt without bypassing the trial', async t => {
  const f = setup(t), p = f.create(), source = p.motionSkill
  assert.equal(source.repository, 'https://github.com/8533502-dev/deepseek-opus-motion-skill'); assert.equal(source.commit, 'dd0e05264a6cd7ad714c0899e17157584290bad4'); assert.equal(source.sha256.length, 64); assert.ok(existsSync(source.skillPath))
  f.service.send(p.id, '按这个Skill制作10秒介绍'); const result = await f.wait(p.id), body = JSON.parse(f.requests[0][1].body), system = body.messages[0].content
  for (const rule of ['Stage 0', 'Stage 1', 'Stage 2', 'Stage 3', 'Type / UI', 'Design Jury', source.commit, source.sha256, '不能执行Stage5代码', '不得套用Skill默认15/30秒']) assert.ok(system.includes(rule), rule)
  assert.ok(system.length < 14000, 'only compact direction references enter the bounded request')
  assert.equal(result.budget.trial.requestsUsed, 1); assert.equal(body.max_tokens, 6000)
  const logged = JSON.parse(readFileSync(join(f.service.folder(p.id), 'requests', result.budget.entries[0].id, 'request.json'), 'utf8')); assert.deepEqual(logged.motionSkill, source)
})

test('Flash uses its own price snapshot; switching during a request never reprices older Pro entries', async t => {
  let model = 'deepseek-flash', release, sent
  const f = setup(t, { getApi: () => ({ ...api, model }), fetcher: async (_url, options) => { sent = JSON.parse(options.body); return new Promise(resolve => { release = resolve }) } }), p = f.create()
  const legacy = { id: 'legacy-pro', projectId: p.id, model: 'deepseek-v4-pro', status: 'settled', reservedMicroYuan: 328392, chargedUpperBoundMicroYuan: 36387, pricing: { inputYuanPerMillion: 9, outputYuanPerMillion: 27 } }
  f.service.ledger.entries.push(structuredClone(legacy)); f.service._saveLedger()
  f.service.send(p.id, 'Flash生成'); model = 'deepseek-v4-pro'; assert.equal(sent.model, 'deepseek-flash')
  release(response()); const done = await f.wait(p.id), entry = done.budget.entries[1]
  assert.equal(entry.model, 'deepseek-flash'); assert.equal(entry.pricing.inputYuanPerMillion, 2); assert.equal(entry.pricing.outputYuanPerMillion, 8); assert.equal(entry.chargedUpperBoundYuan, .006)
  assert.deepEqual(done.budget.entries[0], legacy); assert.equal(done.budget.spentUpperBoundYuan, .042387)
  const oldNoSnapshot = settleVideoEntry({ model: 'deepseek-v4-pro', reservedMicroYuan: 400000, inputTokenUpperBound: 10000, outputTokenUpperBound: 6000 }, { prompt_tokens: 1000, completion_tokens: 500 })
  assert.equal(oldNoSnapshot.chargedUpperBoundYuan, .0225)
})
