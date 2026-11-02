/** Exercise actual upstream product commands and desktop safety on disposable workspaces. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, symlinkSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { BlueprintProductService } from './blueprint-product-service.mjs'

const python = process.env.BLUEPRINT_TEST_PYTHON
const engineRoot = fileURLToPath(new URL('./integrations/agent-blueprint', import.meta.url))
async function wait(service, id) {
  for (let i = 0; i < 500; i++) { const job = service.listJobs().find(job => job.id === id); if (!['running', 'waiting'].includes(job.status)) return job; await delay(10) }
  throw new Error('Product job did not finish')
}
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'blueprint-products-'))
  const service = new BlueprintProductService({ root, engineRoot, python, getCredentials: () => ({}) })
  t.after(async () => { await service.close(); rmSync(root, { recursive: true, force: true }) })
  return { root, service }
}
async function init(service) {
  const task = service.start({ action: 'init', name: '课堂笔记助手', idea: '学生输入课程笔记，得到要点和复习题。只处理本地文本，不自动发布。', mock: true })
  const done = await wait(service, task.id); assert.equal(done.status, 'completed', done.error)
  return task.productId
}

test('original product loop creates PRD, versions requirements, preserves code edits, and verifies against PRD', { skip: !python }, async t => {
  const { service } = setup(t), id = await init(service)
  assert.equal(service.get(id).version, 1)
  const old = service.read(id, 'PRD.md'), edit = old.content.replace('## 4. 边界与红线', '## 4. 边界与红线\n\n用户手写的边界，不得丢失。')
  service.save(id, 'PRD.md', edit, old.hash)
  assert.throws(() => service.save(id, 'PRD.md', 'stale', old.hash), /已被其他操作修改/)
  assert.throws(() => service.save(id, 'PRD.md', edit.replace('| V1 |', '| V9 |'), service.read(id, 'PRD.md').hash), /升版/)
  const revise = service.start({ action: 'revise', productId: id, requirement: '增加跨会话复习进度记忆', strategy: 'none' })
  assert.equal((await wait(service, revise.id)).status, 'completed')
  assert.equal(service.get(id).version, 2)
  assert.match(service.read(id, 'prd/V1.md').content, /用户手写的边界/)
  assert.match(service.read(id, 'PRD.md').content, /增加跨会话复习进度记忆/)
  const plan = service.start({ action: 'plan', productId: id, mock: true }); assert.equal((await wait(service, plan.id)).status, 'completed')
  const template = service.start({ action: 'template', productId: id, level: 4 }); assert.equal((await wait(service, template.id)).status, 'completed')
  const code = service.read(id, 'skeleton/agent.py'); assert.match(code.content, /skill/i)
  service.save(id, code.name, code.content + '\n# 用户手写修改\n', code.hash)
  const again = service.start({ action: 'template', productId: id, level: 1 }); assert.equal((await wait(service, again.id)).status, 'failed')
  assert.match(service.read(id, code.name).content, /用户手写修改/)
  const verify = service.start({ action: 'verify', productId: id, mock: true }), verified = await wait(service, verify.id)
  assert.ok(['completed', 'needs_review'].includes(verified.status), verified.error)
  assert.match(service.read(id, 'verify/差距报告.md').content, /差距/)
  assert.match(service.read(id, '迭代记录.md').content, /人工验证结论：（待填/)
  assert.throws(() => service.read(id, '../outside.md'), /路径无效|不在可编辑范围/)
  symlinkSync('/etc/passwd', join(service.folder(id), 'skeleton/linked.txt'))
  assert.throws(() => service.read(id, 'skeleton/linked.txt'), /符号链接/)
  assert.throws(() => service.save(id, 'prd/V1.md', 'overwrite history', old.hash), /可编辑范围|只读/)
})

test('complete pinned library, original offline evaluations and secret-free student export are available', { skip: !python }, async t => {
  const { service } = setup(t), library = service.library()
  const components = new Set(library.map(file => file.component).filter(Boolean))
  assert.equal(components.size, 17)
  for (const component of components) { assert.match(service.readLibrary(component + '/README.md').content, /./); assert.match(service.readLibrary(component + '/code.py').content, /./) }
  assert.throws(() => service.readLibrary('.env'), /不存在/)
  assert.throws(() => service.start({ action: 'demo', component: '../private' }), /组件无效/)
  const evaluation = service.start({ action: 'eval' }), done = await wait(service, evaluation.id)
  assert.equal(done.status, 'completed', done.error); assert.equal(done.result.passed, true)
  assert.match(service.readJob(done.id, '结果.md').content, /全部通过/)
  const pack = service.start({ action: 'package' }), exported = await wait(service, pack.id)
  assert.equal(exported.status, 'completed', exported.error)
  assert.ok(exported.result.files > 150)
  assert.ok(existsSync(service.readJob(exported.id, 'agent-blueprint-student.zip').path))
})

test('cancel waits for live child, redacts credentials, and restart marks interrupted jobs', { skip: !python }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'blueprint-cancel-')), bridgePath = join(root, 'bridge.py')
  writeFileSync(bridgePath, `import json,sys,time,signal\nr=json.loads(sys.stdin.readline())\nprint(json.dumps({'type':'waiting','prompt':'reply?'}),flush=True)\nreply=json.loads(sys.stdin.readline())\nprint(json.dumps({'type':'console','text':r['credentials']['apiKey']}),flush=True)\nsignal.signal(signal.SIGTERM,lambda *_:sys.exit(0))\ntime.sleep(30)\n`)
  const service = new BlueprintProductService({ root, engineRoot, python, bridgePath, getCredentials: () => ({ apiKey: 'private-test-credential' }) })
  t.after(async () => { await service.close(); rmSync(root, { recursive: true, force: true }) })
  const job = service.start({ action: 'demo', component: 's01_agent_loop' })
  for (let i = 0; i < 100 && !service.listJobs()[0].waiting; i++) await delay(10)
  assert.throws(() => service.start({ action: 'eval' }), /结束当前/)
  service.reply(job.id, 'hello')
  for (let i = 0; i < 100 && !service.listJobs()[0].logs.length; i++) await delay(10)
  assert.doesNotMatch(JSON.stringify(service.listJobs()), /private-test-credential/)
  await service.cancel(job.id); assert.equal(service.active, null); assert.equal(service.listJobs()[0].status, 'cancelled')
  const path = join(service.folder(job.id, 'job'), 'job.json'), stored = JSON.parse(readFileSync(path)); stored.status = 'running'; writeFileSync(path, JSON.stringify(stored))
  const restarted = new BlueprintProductService({ root, engineRoot, python, getCredentials: () => ({}) }); assert.equal(restarted.listJobs()[0].status, 'interrupted'); await restarted.close()
})

test('all 17 unmodified component entry points reach a desktop input prompt and quit without API calls', { skip: !python }, async t => {
  const { service } = setup(t)
  service.getCredentials = () => ({ apiKey: 'component-startup-test', baseUrl: 'https://api.deepseek.com/anthropic', model: 'deepseek-chat' })
  const components = [...new Set(service.library().map(file => file.component).filter(Boolean))]
  for (const component of components) {
    const started = service.start({ action: 'demo', component })
    let job
    for (let i = 0; i < 250; i++) { job = service.listJobs().find(j => j.id === started.id); if (job.waiting || job.status === 'failed') break; await delay(10) }
    assert.ok(job.waiting, component + ': ' + job.error)
    service.reply(job.id, 'q')
    const done = await wait(service, started.id)
    assert.equal(done.status, 'completed', component + ': ' + done.error)
    assert.equal(done.usage.calls || 0, 0)
  }
})
