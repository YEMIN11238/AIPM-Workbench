/** Keyless recordings of native resume-tool visibility and navigation races. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { mountResumeClinic } from './resume-clinic.mjs'

const settle = () => new Promise(resolve => setTimeout(resolve, 10))
function fixture(override) {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true }), container = dom.window.document.getElementById('root'), calls = []
  const api = async (name, value) => { calls.push([name, value]); if (override) return override(name, value); return true }
  const view = mountResumeClinic({ container, api })
  container.querySelector('.resume-clinic-slot').getBoundingClientRect = () => ({ x: 240, y: 64, width: 960, height: 700 })
  return { dom, container, view, calls, close() { view.destroy(); dom.window.close() } }
}

test('opening the resume surface uses its own native slot and hiding does not destroy the draft owner', async () => {
  const f = fixture()
  try {
    assert.equal(f.calls.length, 0)
    assert.equal(await f.view.show(), true)
    assert.deepEqual(f.calls[0], ['resumeShow', { x: 240, y: 64, width: 960, height: 700 }])
    f.dom.window.dispatchEvent(new f.dom.window.Event('resize')); await settle()
    assert.equal(f.calls.at(-1)[0], 'resumeBounds')
    f.view.hide(); await settle(); assert.equal(f.calls.at(-1)[0], 'resumeHide')
    assert.equal(await f.view.show(), true); assert.equal(f.calls.at(-1)[0], 'resumeShow')
    assert.equal(f.calls.some(([name]) => /complete|review|key/i.test(name)), false)
  } finally { f.close() }
})

test('leaving while the native page opens cancels a late display and permits a subsequent open', async () => {
  let release, defer = true
  const f = fixture(name => { if (name === 'resumeShow' && defer) return new Promise(resolve => { release = resolve }); return true })
  try {
    const opening = f.view.show(); await settle(); f.view.hide(); release(true)
    assert.equal(await opening, false); assert.equal(f.calls.at(-1)[0], 'resumeHide')
    defer = false; assert.equal(await f.view.show(), true)
    assert.equal(f.calls.at(-1)[0], 'resumeShow')
  } finally { f.close() }
})

test('a load error stays actionable and a retry does not send a model request', async () => {
  let failed = true
  const f = fixture(() => { if (failed) throw new Error('本地页面尚未构建'); return true })
  try {
    assert.equal(await f.view.show(), false)
    assert.match(f.container.textContent, /本地页面尚未构建/)
    const retry = f.container.querySelector('button'); assert.equal(retry.hidden, false)
    failed = false; retry.click(); await settle()
    assert.equal(retry.hidden, true); assert.equal(f.calls.at(-1)[0], 'resumeShow')
    f.view.destroy(); const count = f.calls.length; await settle(); await f.view.show(); f.dom.window.dispatchEvent(new f.dom.window.Event('resize')); await settle()
    assert.equal(f.calls.filter(([name]) => name === 'resumeShow').length, 2)
    assert.ok(f.calls.length <= count + 1)
  } finally { f.close() }
})
