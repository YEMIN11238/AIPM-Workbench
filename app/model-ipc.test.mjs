import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ModelSettings, sharedModelApi } from './model-api.mjs'
import { registerModelIpc } from './model-ipc.mjs'

test('model preference is durable and shared by subsequent requests without returning the credential', async t => {
  const root = mkdtempSync(join(tmpdir(), 'aipm-model-ipc-')); t.after(() => rmSync(root, { recursive: true, force: true }))
  const settings = new ModelSettings({ path: join(root, 'model.json') }), actions = new Map(), updates = [], synced = []
  const getApi = () => sharedModelApi(() => 'private-test-key', settings.get().model)
  const running = getApi()
  registerModelIpc({ handle: (name, fn) => actions.set(name, fn), settings, syncStandalone: () => synced.push(getApi().model), onUpdate: value => updates.push(value) })
  const after = await actions.get('modelSelect')('deepseek-flash')
  assert.equal(running.model, 'deepseek-v4-pro'); assert.equal(getApi().model, 'deepseek-flash')
  assert.equal(new ModelSettings({ path: join(root, 'model.json') }).get().model, 'deepseek-flash')
  assert.deepEqual(synced, ['deepseek-flash']); assert.equal(updates.length, 1)
  assert.equal(JSON.stringify(after).includes('private-test-key'), false)
  assert.equal(actions.get('modelStatus')().model, 'deepseek-flash')
  await assert.rejects(actions.get('modelSelect')('unverified-model'))
  assert.equal(settings.get().model, 'deepseek-flash')
})

test('standalone sync errors restore the saved model and do not publish a false selection', async t => {
  const root = mkdtempSync(join(tmpdir(), 'aipm-model-ipc-')); t.after(() => rmSync(root, { recursive: true, force: true }))
  const settings = new ModelSettings({ path: join(root, 'model.json') }), actions = new Map(), updates = []
  registerModelIpc({ handle: (name, fn) => actions.set(name, fn), settings, syncStandalone: () => { throw new Error('配置不可写') }, onUpdate: value => updates.push(value) })
  await assert.rejects(actions.get('modelSelect')('deepseek-flash'), /已恢复原模型/)
  assert.equal(settings.get().model, 'deepseek-v4-pro'); assert.equal(updates.length, 0)
})
