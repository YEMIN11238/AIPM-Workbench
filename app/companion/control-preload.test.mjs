/** Exercise the actual preload notification without Electron or application credentials. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'

const tick = () => new Promise(resolve => setImmediate(resolve))

test('preload acknowledges only the explicit open notification after its UI callback completes', async () => {
  const ipcRenderer = new EventEmitter(), calls = [], errors = []
  ipcRenderer.invoke = async (...args) => { calls.push(args); return { ok: true, value: true } }
  let api
  runInNewContext(readFileSync(new URL('../preload.cjs', import.meta.url), 'utf8'), { require: name => { assert.equal(name, 'electron'); return { ipcRenderer, contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'aipm'); api = value } } } }, console: { error: value => errors.push(value) } })
  assert.throws(() => api.onCompanionOpen(null), /回调函数/)
  await api.companionControlReady()
  assert.deepEqual(calls, [['aipm:companionControlReady']])
  let resolveOpen
  const unsubscribe = api.onCompanionOpen(() => new Promise(resolve => { resolveOpen = resolve }))
  const requestId = '465bc1dc-2ee4-43b4-afba-d9ed093c881e'
  ipcRenderer.emit('aipm:companion-open', {}, requestId); await tick()
  assert.equal(calls.length, 1)
  resolveOpen(); await tick()
  assert.deepEqual(calls.at(-1), ['aipm:companionControlOpened', requestId, true])
  unsubscribe()
  ipcRenderer.emit('aipm:companion-open', {}, requestId); await tick()
  assert.equal(calls.length, 2)
  const removeFailure = api.onCompanionOpen(async () => { throw new Error('fixture-private-ui-error') })
  ipcRenderer.emit('aipm:companion-open', {}, requestId); await tick()
  assert.deepEqual(calls.at(-1), ['aipm:companionControlOpened', requestId, false])
  assert.equal(JSON.stringify([calls, errors]).includes('fixture-private-ui-error'), false)
  assert.equal(calls.some(([name]) => ['aipm:companionDeploy', 'aipm:companionStart', 'aipm:key', 'aipm:companionModelKey'].includes(name)), false)
  removeFailure()
})
