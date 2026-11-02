import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync, realpathSync, cpSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { BlueprintService } from './blueprint-service.mjs'

const fakeBridge = `
import sys,json,time,os,signal
from pathlib import Path
r=json.loads(sys.stdin.readline())
def emit(**event): print(json.dumps(event),flush=True)
if r.get('action')=='probe':
 emit(type='status',available=True,configured=bool(r.get('credentials',{}).get('apiKey')),model='fake-model');sys.exit(0)
p=Path(r['out'])
if os.getenv('AMBIENT_API_KEY') or os.getenv('PYTHONPATH'): raise RuntimeError('ambient secret environment leaked')
(p/'request-check.json').write_text(json.dumps({'maxCalls':r['maxCalls'],'maxTokens':r['maxTokens'],'resumed':r.get('resume',False)}))
emit(type='stage',stage='extract')
emit(type='progress',message='拆解需求')
emit(type='usage',usage={'calls':1,'input_tokens':50,'output_tokens':20})
text=r.get('input','')
if 'slow' in text and not r.get('resume'):
 signal.signal(signal.SIGTERM,lambda *_: sys.exit(0))
 time.sleep(30)
if 'error' in text:
 emit(type='error',message='apiKey='+r.get('credentials',{}).get('apiKey','')+' invalid');sys.exit(1)
if 'invalid' in text:
 print('not json',flush=True);time.sleep(30)
review={'ok':True,'issues':[{'severity':'high','problem':'需要修复'}] if 'review' in text else [],'summary':'模型完成复核'}
name='plan.json' if r['mode']=='plan' else 'audit.json'
report='方案.md' if r['mode']=='plan' else '差距报告.md'
(p/name).write_text(json.dumps({'title':'生成结果','review':review,'budget':{'calls':1},'unknowns':['测试待确认项']}))
(p/report).write_text('# 测试方案\\n\\n生成成功。')
emit(type='result',status='completed',review=review)
`

function setup(t, options = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'aipm-blueprint-'))
  mkdirSync(join(folder, 'engine'))
  writeFileSync(join(folder, 'engine', 'LICENSE'), 'MIT')
  writeFileSync(join(folder, 'bridge.py'), fakeBridge)
  const updates = []
  const serviceOptions = { root: join(folder, 'tasks'), engineRoot: join(folder, 'engine'), python: '/usr/bin/python3', bridgePath: join(folder, 'bridge.py'), getCredentials: () => ({ apiKey: 'private-example-value' }), onUpdate: value => updates.push(value), ...options }
  const service = new BlueprintService(serviceOptions)
  t.after(async () => { await service.close(); rmSync(folder, { recursive: true, force: true }) })
  return { folder, service, updates, serviceOptions }
}

async function finished(service, id) {
  for (let i = 0; i < 300; i++) {
    const task = service.get(id)
    if (task.status !== 'running') return task
    await delay(10)
  }
  throw new Error('Test task did not finish')
}

async function progressed(service, id) {
  for (let i = 0; i < 200; i++) {
    if (service.get(id).events.length) return
    await delay(10)
  }
  throw new Error('No progress event')
}

test('model probe exposes presence only, task returns immediately, progress and reports persist', async t => {
  const { service, folder, updates } = setup(t)
  const status = await service.status()
  assert.deepEqual(status, { available: true, configured: true, model: 'fake-model', activeId: null })
  const task = service.start({ mode: 'plan', title: '我的产品', input: '课程助手' })
  assert.equal(task.status, 'running')
  assert.equal(task.mode, 'plan')
  assert.equal(task.spec, undefined)
  const result = await finished(service, task.id)
  assert.equal(result.status, 'completed')
  assert.equal(result.usage.calls, 1)
  assert.deepEqual(result.summary.unknowns, ['测试待确认项'])
  assert.equal(service.readReport(task.id).name, '方案.md')
  assert.match(service.readReport(task.id).content, /生成成功/)
  assert.ok(updates.some(update => update.events.some(event => event.message === '拆解需求')))
  assert.equal(service.list()[0].id, task.id)
  assert.equal(service.resolveFolder(task.id), realpathSync(join(folder, 'tasks', task.id)))
  const persisted = readFileSync(join(service.resolveFolder(task.id), 'task.json'), 'utf8')
  assert.ok(!persisted.includes('private-example-value'))
  const check = JSON.parse(readFileSync(join(service.resolveFolder(task.id), 'request-check.json')))
  assert.equal(check.maxCalls, 8)
  assert.equal(check.maxTokens, 90000)
})

test('high severity forces needs_review even when engine says ok and completed', async t => {
  const { service } = setup(t)
  const task = service.start({ mode: 'plan', input: 'review' })
  assert.equal((await finished(service, task.id)).status, 'needs_review')
  assert.equal(service.get(task.id).review.ok, true)
})

test('audit scans selected folder without executing project and allows only known reports', async t => {
  const { service, folder } = setup(t)
  const project = join(folder, 'audited')
  mkdirSync(project)
  writeFileSync(join(project, 'execute.py'), "raise Exception('This must never execute')")
  const task = service.start({ mode: 'audit', projectPath: project })
  assert.equal((await finished(service, task.id)).status, 'completed')
  assert.equal(service.readReport(task.id).name, '差距报告.md')
  assert.throws(() => service.readReport(task.id, '../../credential.bin'))
  assert.throws(() => service.readReport(task.id, 'task.json'))
  assert.throws(() => service.get('../tasks'))
  assert.throws(() => service.resolveFolder('../../'))
  const folderPath = service.resolveFolder(task.id)
  rmSync(join(folderPath, '差距报告.md'))
  symlinkSync(join(project, 'execute.py'), join(folderPath, '差距报告.md'))
  assert.throws(() => service.readReport(task.id), /文件无效/)
})

test('single running task, cancellation waits for exit, cached state can resume', async t => {
  const { service } = setup(t)
  const task = service.start({ mode: 'plan', input: 'slow' })
  assert.throws(() => service.start({ mode: 'plan', input: 'second' }), /当前方案任务/)
  await progressed(service, task.id)
  const result = await service.cancel(task.id)
  assert.equal(result.status, 'cancelled')
  assert.equal(result.exitCode, 0)
  assert.equal(service.active, null)
  service.resume(task.id)
  const resumed = await finished(service, task.id)
  assert.equal(resumed.status, 'completed')
  assert.equal(resumed.attempts, 2)
  assert.equal(JSON.parse(readFileSync(join(service.resolveFolder(task.id), 'request-check.json'))).resumed, true)
})

test('timeout remains a failure even when child traps signal and exits zero', async t => {
  const { service } = setup(t, { deadlineMs: 300 })
  const task = service.start({ mode: 'plan', input: 'slow' })
  const result = await finished(service, task.id)
  assert.equal(result.status, 'failed')
  assert.equal(result.timedOut, true)
  assert.equal(result.exitCode, 0)
  assert.match(result.error, /时间上限/)
})

test('subprocess errors redact provided credentials and preserve retry state', async t => {
  const { service } = setup(t)
  const task = service.start({ mode: 'plan', input: 'error' })
  const result = await finished(service, task.id)
  assert.equal(result.status, 'failed')
  assert.ok(!JSON.stringify(result).includes('private-example-value'))
  assert.match(result.error, /已隐藏/)
})

test('malformed JSONL ends owned subprocess and listener exceptions do not break completion', async t => {
  const { service } = setup(t)
  service.onUpdate = () => { throw new Error('subscriber failure') }
  const originalError = console.error
  console.error = () => {}
  try {
    const task = service.start({ mode: 'plan', input: 'invalid' })
    const result = await finished(service, task.id)
    assert.equal(result.status, 'failed')
    assert.match(result.error, /格式错误/)
    assert.equal(service.active, null)
  } finally { console.error = originalError }
})

test('restart marks a persisted running task interrupted and allows resuming', async t => {
  const { service, serviceOptions } = setup(t)
  const task = service.start({ mode: 'plan', input: 'slow' })
  await progressed(service, task.id)
  await service.cancel(task.id)
  const file = join(service.resolveFolder(task.id), 'task.json')
  const durable = JSON.parse(readFileSync(file, 'utf8'))
  durable.status = 'running'
  writeFileSync(file, JSON.stringify(durable))
  const restarted = new BlueprintService(serviceOptions)
  t.after(() => restarted.close())
  assert.equal(restarted.get(task.id).status, 'interrupted')
  restarted.resume(task.id)
  assert.equal((await finished(restarted, task.id)).status, 'completed')
})

test('ambient credentials and Python import overrides never reach child', async t => {
  const { service } = setup(t)
  const previousKey = process.env.AMBIENT_API_KEY, previousPath = process.env.PYTHONPATH
  process.env.AMBIENT_API_KEY = 'must-not-inherit'
  process.env.PYTHONPATH = '/tmp/untrusted'
  try {
    const task = service.start({ mode: 'plan', input: 'ordinary' })
    assert.equal((await finished(service, task.id)).status, 'completed')
  } finally {
    if (previousKey === undefined) delete process.env.AMBIENT_API_KEY; else process.env.AMBIENT_API_KEY = previousKey
    if (previousPath === undefined) delete process.env.PYTHONPATH; else process.env.PYTHONPATH = previousPath
  }
})

test('rejects missing directories, empty input, excessive budgets and linked durable tasks', async t => {
  const { service, folder, serviceOptions } = setup(t)
  assert.throws(() => service.start({ mode: 'plan', input: ' ' }))
  assert.throws(() => service.start({ mode: 'audit', projectPath: join(folder, 'absent') }))
  assert.throws(() => new BlueprintService({ ...serviceOptions, maxCalls: 9 }), /预算/)
  const id = '00000000-0000-0000-0000-000000000000'
  symlinkSync(join(folder, 'engine'), join(folder, 'tasks', id))
  const restarted = new BlueprintService(serviceOptions)
  t.after(() => restarted.close())
  assert.equal(restarted.list().length, 0)
  assert.throws(() => restarted.get(id))
})


const integrationPython = process.env.BLUEPRINT_TEST_PYTHON

test('real bridge and vendored engine correct contradictory review and enforce provider usage', { skip: !integrationPython }, async t => {
  const { service, serviceOptions, folder } = setup(t)
  const engineRoot = join(folder, 'real-engine')
  mkdirSync(engineRoot)
  cpSync(new URL('./integrations/agent-blueprint/blueprint', import.meta.url), join(engineRoot, 'blueprint'), { recursive: true })
  writeFileSync(join(engineRoot, 'LICENSE'), 'MIT')
  writeFileSync(join(engineRoot, 'anthropic.py'), `
from types import SimpleNamespace
from blueprint.mock import MockRunner
import os,json
class Anthropic:
 def __init__(self,**kwargs):
  assert kwargs['timeout']==120 and kwargs['max_retries']==0
  assert os.getenv('ANTHROPIC_API_KEY')=='private-example-value'
  self.calls=0
  self.messages=SimpleNamespace(create=self.create)
 def create(self,**kwargs):
  assert kwargs['max_tokens']<=16000
  stage=['extract','model','design','review'][self.calls]
  self.calls+=1
  data=MockRunner().complete(stage,kwargs['system'],kwargs['messages'][0]['content'],{})
  if stage=='review': data['issues']=[{'severity':'high','problem':'模型结论冲突，需要复核'}]
  excessive='excessive' in kwargs['messages'][0]['content']
  return SimpleNamespace(content=[SimpleNamespace(type='text',text=json.dumps(data))],usage=SimpleNamespace(input_tokens=89999 if excessive else 100,output_tokens=100),stop_reason='end_turn')
`)
  const bridgePath = fileURLToPath(new URL('./blueprint-bridge.py', import.meta.url))
  const realService = new BlueprintService({ ...serviceOptions, root: join(folder, 'real-tasks'), engineRoot, python: integrationPython, bridgePath })
  t.after(() => realService.close())
  const plan = realService.start({ mode: 'plan', input: '课堂笔记助手' })
  const result = await finished(realService, plan.id)
  assert.equal(result.status, 'needs_review', result.error)
  assert.equal(result.usage.calls, 4)
  const markdown = realService.readReport(plan.id).content
  assert.match(markdown, /工作台复核提示/)
  assert.match(markdown, /结论：⚠️ 待复核/)
  assert.doesNotMatch(markdown, /结论：✅ 通过/)
  const overBudget = realService.start({ mode: 'plan', input: 'excessive usage fixture' })
  const failed = await finished(realService, overBudget.id)
  assert.equal(failed.status, 'failed')
  assert.match(failed.error, /超过 90000 token/)
  assert.equal(failed.usage.calls, 1)
  assert.equal(failed.reports.length, 0)
})
