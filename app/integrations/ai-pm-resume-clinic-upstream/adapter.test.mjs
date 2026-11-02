import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const directory = fileURLToPath(new URL('.', import.meta.url))
const entry = ['openrouter.ts', 'desktopHost.ts'].map(name => `export * from ${JSON.stringify(directory + 'src/lib/' + name)};`).join('\n')
const bundled = await build({ stdin: { contents: entry, resolveDir: directory }, bundle: true, platform: 'node', format: 'esm', write: false })
const source = bundled.outputFiles[0].text
async function load(host) {
  globalThis.window = { aipmResumeClinic: host }
  return import('data:text/javascript;base64,' + Buffer.from(source + '\n//' + randomUUID()).toString('base64'))
}
function bridge(overrides = {}) {
  return {
    status: async () => ({ configured: true, model: 'deepseek-v4-pro', choices: [{ id: 'deepseek-v4-pro', label: 'Pro' }] }),
    selectModel: async model => ({ configured: true, model, choices: [{ id: model, label: '选定模型' }] }),
    complete: async () => ({ model: 'deepseek-v4-pro', choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }),
    onModelUpdate: () => () => {},
    ...overrides,
  }
}

test('desktop requests use the saved host model without reading or storing a renderer API key', async () => {
  let keyReads = 0, requests = 0
  globalThis.localStorage = { getItem() { keyReads++; return 'renderer-key-must-not-be-read' }, setItem() { throw new Error('key write forbidden') } }
  const adapter = await load(bridge({ complete: async payload => {
    requests++
    assert.equal(Object.hasOwn(payload, 'model'), false)
    return { model: 'deepseek-v4-pro', choices: [{ message: { content: '{}' }, finish_reason: 'stop' }] }
  } }))
  assert.equal(adapter.getStoredApiKey(), '')
  assert.throws(() => adapter.setStoredApiKey('unused'), /工作台设置/)
  await adapter.sendChatCompletion({ model: 'foreign-provider-model', messages: [{ role: 'user', content: '演示文本' }] })
  assert.equal(keyReads, 0)
  assert.equal(requests, 1)
})

test('a request waits for a pending shared model selection', async () => {
  let resolveSelection, active = 'deepseek-v4-pro', calls = 0
  const adapter = await load(bridge({
    selectModel: model => new Promise(resolve => { resolveSelection = () => { active = model; resolve({ configured: true, model, choices: [] }) } }),
    status: async () => ({ configured: true, model: active, choices: [] }),
    complete: async payload => { calls++; assert.equal(Object.hasOwn(payload, 'model'), false); assert.equal(active, 'deepseek-flash'); return { choices: [] } },
  }))
  const selection = adapter.selectDesktopModel('deepseek-flash')
  await Promise.resolve()
  const request = adapter.sendChatCompletion({ messages: [{ role: 'user', content: '演示文本' }] })
  await Promise.resolve()
  assert.equal(calls, 0)
  resolveSelection()
  await selection
  await request
  assert.equal(calls, 1)
})

test('missing host credentials fail before any completion request', async () => {
  let calls = 0
  const adapter = await load(bridge({ status: async () => ({ configured: false, model: 'deepseek-v4-pro', choices: [] }), complete: async () => { calls++; return {} } }))
  await assert.rejects(adapter.sendChatCompletion({ messages: [] }), /工作台.*配置模型连接/)
  assert.equal(calls, 0)
})

test('invalid desktop output does not fall back to another provider model', async () => {
  const models = []
  const adapter = await load(bridge({ complete: async payload => { models.push(Object.hasOwn(payload, 'model') ? payload.model : 'saved-host-model'); return { model: 'deepseek-v4-pro', choices: [{ message: { content: 'invalid output' }, finish_reason: 'stop' }] } } }))
  await assert.rejects(adapter.reviewResume('# 演示\n## 个人优势\n- 需求分析', 'gpt-5.4-mini'), /deepseek-v4-pro/)
  assert.deepEqual(models, ['saved-host-model'])
})
