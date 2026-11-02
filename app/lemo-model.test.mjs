/** Model projections preserve full desktop/source data while bounding repeated tool context. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { lemoModelResult } from './lemo-model.mjs'

const service = { sourceRoot: '/app/lemo-source', customRoot: '/workspace/Lemo自有风格', folder: id => '/workspace/Lemo工程/' + id }
const fullJob = id => ({ id, projectId: 'project-1', operation: 'render', status: 'failed', progress: { phase: 'render', ratio: .3, message: 'old-progress-'.repeat(10000) }, log: 'prefix-old-log-' + 'x'.repeat(100000) + '-latest-log-tail', logPath: '/workspace/Lemo工程/project-1/jobs/' + id + '/job.log', error: 'old-error-'.repeat(10000), files: Array.from({ length: 300 }, (_, n) => ({ name: 'file-' + n, path: '/large/file-' + n, kind: 'image' })), createdAt: '2026-10-26T00:00:00Z', unrelated: 'huge'.repeat(100000) })
const fullProject = () => { const jobs = [fullJob('j1'), fullJob('j2')]; return { schema: 1, id: 'project-1', title: 'AIPM 品牌片', brief: '用大字介绍工作台', prompt: '完整制作方法与原始任务说明', duration: 10, fps: 30, width: 1920, height: 1080, style: 'swiss-motion', mode: 'library', chatId: 'chat-1', cwd: '/workspace/Lemo工程/project-1', onlineVoiceConsent: false, source: { repository: 'https://example.com/source', commit: 'abc', license: 'MIT', raw: 'large'.repeat(100000) }, jobs, currentJob: jobs[1], extraBody: 'z'.repeat(1000000) } }

test('project methods retain settings and a single lightweight job index without recursive logs or duplicate currentJob', () => {
  const original = fullProject(), snapshot = structuredClone(original)
  for (const action of ['lemoGet', 'lemoPrepare', 'lemoCancel']) {
    const result = lemoModelResult(action, original, { service })
    assert.equal(result.id, original.id); assert.equal(result.cwd, original.cwd); assert.equal(result.chatId, original.chatId); assert.equal(result.brief, original.brief)
    assert.equal(result.jobs.length, 2); assert.equal(result.jobCount, 2); assert.equal(result.currentJobId, 'j2'); assert.equal(result.currentJob, undefined)
    assert.equal(result.jobs[0].status, 'failed'); assert.equal(result.jobs[0].logPath, original.jobs[0].logPath); assert.equal(result.jobs[0].log, undefined); assert.equal(result.jobs[0].error, undefined); assert.equal(result.jobs[0].progress.message, undefined)
    assert.equal(result.jobs[0].files, undefined); assert.equal(result.jobs[0].fileCount, 300); assert.ok(JSON.stringify(result).length < 2500)
    assert.equal(result.prompt, action === 'lemoPrepare' ? original.prompt : undefined)
  }
  assert.deepEqual(original, snapshot)
})

test('the project list excludes repeated briefs/prompts and discovers a current job missing from the index only once', () => {
  const original = fullProject(); original.jobs = [original.jobs[0]]
  const result = lemoModelResult('lemoList', [original], { service })[0]
  assert.equal(result.brief, undefined); assert.equal(result.prompt, undefined); assert.equal(result.source, undefined)
  assert.deepEqual(result.jobs.map(job => job.id), ['j1', 'j2']); assert.equal(result.currentJobId, 'j2')
})

test('targeted job and run results contain only the final 6000 log characters with a complete-file pointer', () => {
  const original = fullJob('j1'), before = structuredClone(original)
  for (const action of ['lemoJob', 'lemoRun']) {
    const result = lemoModelResult(action, original, { service })
    assert.equal(result.log, original.log.slice(-6000)); assert.equal(result.log.length, 6000); assert.equal(result.logExcerpted, true); assert.equal(result.fullLogChars, original.log.length)
    assert.equal(result.fullLogPath, original.logPath); assert.match(result.logExcerptNote, /末尾/); assert.match(result.logExcerptNote, /offset\/limit/)
    assert.ok(result.error.length <= 2000); assert.ok(result.progress.message.length <= 2000); assert.equal(result.files, undefined); assert.equal(result.fileCount, 300)
  }
  assert.deepEqual(original, before)
  const short = lemoModelResult('lemoJob', { ...original, log: '短日志', logPath: 'jobs/j1/job.log' }, { service })
  assert.equal(short.log, '短日志'); assert.equal(short.logExcerpted, false); assert.equal(short.fullLogPath, '/workspace/Lemo工程/project-1/jobs/j1/job.log')
})

test('bounded text reads disclose excerpts, full character counts and exact validated source/project/custom paths', () => {
  const text = '# Director\n' + '完整方法'.repeat(20000), original = { path: 'DIRECTOR.md', text, kind: 'text', unused: 'big' }
  const result = lemoModelResult('lemoRead', original, { service, args: [{ path: 'DIRECTOR.md' }] })
  assert.equal(result.text, text.slice(0, 24000)); assert.equal(result.excerpted, true); assert.equal(result.fullContentChars, text.length); assert.equal(result.fullPath, '/app/lemo-source/DIRECTOR.md'); assert.match(result.excerptNote, /未|后文/); assert.equal(original.text, text)
  const custom = lemoModelResult('lemoRead', { path: 'mine/STYLE.md', text: '我的完整风格', kind: 'text' }, { service, args: [{ path: 'custom/mine/STYLE.md' }] })
  assert.equal(custom.fullPath, '/workspace/Lemo自有风格/mine/STYLE.md'); assert.equal(custom.excerpted, false); assert.equal(custom.text, '我的完整风格')
  const local = lemoModelResult('lemoRead', { path: 'film.js', text: 'code', kind: 'text' }, { service, args: [{ path: 'film.js', projectId: 'project-1' }] })
  assert.equal(local.fullPath, '/workspace/Lemo工程/project-1/film.js')
  const absolute = lemoModelResult('lemoRead', { path: '/workspace/Lemo工程/project-1/film.js', text: 'code' }, { service, args: [{ projectId: 'project-1', path: '/workspace/Lemo工程/project-1/film.js' }] })
  assert.equal(absolute.fullPath, '/workspace/Lemo工程/project-1/film.js')
  assert.equal(lemoModelResult('lemoRead', { path: 'DIRECTOR.md', text: 'all' }, { service, args: ['DIRECTOR.md'] }).fullPath, '/app/lemo-source/DIRECTOR.md')
})

test('output file indexes stop at 200 and explicitly retain total/omitted counts and actual video metadata', () => {
  const files = Array.from({ length: 235 }, (_, n) => ({ name: 'file-' + n, path: '/project/file-' + n, kind: 'image', content: 'not model context' }))
  const original = { files, lastVideo: { path: '/project/film.mp4', duration: 10, width: 1920, height: 1080, fps: 30, audio: true, raw: 'big' }, diagnostics: Array.from({ length: 260 }, (_, n) => ({ path: '/project/bad-' + n, message: 'media issue' })) }
  const result = lemoModelResult('lemoOutput', original, { service })
  assert.equal(result.files.length, 200); assert.equal(result.totalFiles, 235); assert.equal(result.omittedFiles, 35); assert.equal(result.files.at(-1).name, 'file-199'); assert.equal(result.files[0].content, undefined)
  assert.equal(result.lastVideo.path, original.lastVideo.path); assert.equal(result.lastVideo.audio, true); assert.equal(result.lastVideo.raw, undefined); assert.match(result.fileExcerptNote, /200/)
  assert.equal(result.diagnostics.length, 200); assert.equal(result.omittedDiagnostics, 60); assert.equal(original.files.length, 235)
  const empty = lemoModelResult('lemoOutput', { files: [] }, { service }); assert.equal(empty.omittedFiles, 0); assert.equal(empty.lastVideo, undefined)
})

test('nulls, unrelated methods, info and styles retain their complete original values', () => {
  const value = { body: 'unchanged'.repeat(10000) }, styles = [{ id: 'swiss', body: 'complete style' }]
  for (const action of ['lemoInfo', 'companyGet', 'piGet', 'lemoSaveStyle']) assert.equal(lemoModelResult(action, value, { service }), value)
  assert.equal(lemoModelResult('lemoStyles', styles, { service }), styles)
  assert.equal(lemoModelResult('lemoGet', null, { service }), null); assert.equal(lemoModelResult('lemoJob', undefined, { service }), undefined)
})
