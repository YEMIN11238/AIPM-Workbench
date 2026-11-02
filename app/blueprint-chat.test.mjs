/** Grounded conversation, SSE fragmentation, explicit actions and cancellation. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BlueprintChatService } from './blueprint-chat-service.mjs'

const id = 'a77b62e0-f411-4bab-9f80-6cfea58d4d2d'
function setup(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'blueprint-chat-')), updates = [], actions = []
  const products = { list: () => [], get: productId => ({ id: productId, name: '产品', files: [], jobs: [] }), start: input => { actions.push(input); return { id: 'job', productId: id } } }
  const blueprint = { list: () => [{ id, title: '酒水助手', createdAt: '2026-10-21', status: 'needs_review' }], get: value => { assert.equal(value, id); return { id, title: '酒水助手', status: 'needs_review', reports: [{ name: '方案.md' }], review: { ok: false } } }, readReport: () => ({ name: '方案.md', content: '# 酒水助手\n\n> 按位置、预算和偏好推荐酒吧。\n\n地图数据源尚未接入。' }), sourceInput: () => '我想按位置、预算推荐酒吧。' }
  let request
  const fetcher = async (_url, init) => {
    request = JSON.parse(init.body)
    const events = 'data: ' + JSON.stringify({ choices: [{ delta: { content: '这是方案，尚未接入地图。' }, finish_reason: null }] }) + '\r\n\r\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 20 } }) + '\n\ndata: [DONE]\n\n'
    const bytes = new TextEncoder().encode(events)
    return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close() } }))
  }
  const service = new BlueprintChatService({ root, products, blueprint, getKey: () => 'private-chat-key', onUpdate: chat => updates.push(chat), fetcher, ...options })
  t.after(async () => { await service.close(); rmSync(root, { recursive: true, force: true }) })
  return { service, updates, actions, request: () => request }
}

test('streamed Chinese replies stay grounded, preserve multi-turn history and never expose request headers', async t => {
  const { service, updates, request, actions } = setup(t), scope = { kind: 'task', id }
  const initial = service.get(scope); assert.match(initial.context.summary, /待复核/)
  assert.equal(initial.messages.length, 0)
  const first = service.send(scope, '用人话讲讲这个项目能做什么。')
  assert.equal(first.status, 'running'); assert.equal(first.request, undefined)
  assert.throws(() => service.send(scope, '第二次同时发'), /等待/)
  await service.active.done
  const done = service.get(scope)
  assert.equal(done.messages.at(-1).content, '这是方案，尚未接入地图。')
  assert.equal(done.status, 'idle'); assert.equal(done.usage.total_tokens, 20)
  assert.match(request().messages[1].content, /地图数据源尚未接入/)
  assert.equal(actions.length, 0)
  assert.doesNotMatch(JSON.stringify(updates), /private-chat-key|Authorization|"request"/)
  service.send(scope, '那下一步先做什么？'); await service.active.done
  assert.equal(service.get(scope).messages.length, 4)
  assert.ok(request().messages.some(m => m.content === '这是方案，尚未接入地图。'))
})

test('creating a product uses original user requirements and carries over conversation without treating AI advice as facts', async t => {
  const { service, actions } = setup(t), scope = { kind: 'task', id }
  service.send(scope, '首版先支持杭州。'); await service.active.done
  service.send(scope, '【界面测试】假设第一版自动定位，这只是测试，不是用户需求。'); await service.active.done
  const job = service.createProduct(scope)
  assert.equal(job.productId, id)
  assert.match(actions[0].idea, /我想按位置、预算推荐酒吧/)
  assert.match(actions[0].idea, /首版先支持杭州/)
  assert.doesNotMatch(actions[0].idea, /这是方案，尚未接入地图/)
  assert.doesNotMatch(actions[0].idea, /假设第一版自动定位/)
  assert.equal(service.get({ kind: 'product', id }).messages.length, 4)
})

test('stop and timeout await the stream, retain partial text, and permit a later message', async t => {
  const fetcher = async (_url, init) => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"部分回复"}}]}\n\n'))
    init.signal.addEventListener('abort', () => controller.error(new Error('aborted')))
  } }))
  const { service } = setup(t, { fetcher })
  service.send({ kind: 'new' }, '解释一下')
  await new Promise(resolve => setTimeout(resolve, 10)); await service.cancel()
  assert.equal(service.active, null)
  const stopped = service.get({ kind: 'new' }); assert.equal(stopped.status, 'cancelled'); assert.equal(stopped.messages.at(-1).content, '部分回复')
  service.timeoutMs = 10; service.send({ kind: 'new' }, '继续'); await service.active.done
  assert.equal(service.get({ kind: 'new' }).status, 'failed'); assert.match(service.get({ kind: 'new' }).error, /超时/)
})

test('provider errors and truncated SSE never claim a complete assistant reply', async t => {
  const { service } = setup(t, { fetcher: async () => new Response('data: {"choices":[{"delta":{"content":"尚未完"}}]}\n\n') })
  service.send({ kind: 'new' }, '你好'); await service.active.done
  assert.equal(service.get({ kind: 'new' }).messages.at(-1).status, 'interrupted')
  assert.match(service.get({ kind: 'new' }).error, /中途断开/)
})
