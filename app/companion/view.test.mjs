/** Keyless native-view recordings for SSH origins and per-server login isolation. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { CompanionConsoleView } from './view.mjs'

const destination = suffix => ({ url: 'http://127.0.0.1:16185/', allowedOrigin: 'http://127.0.0.1:16185', partition: 'persist:aipm-companion-astrbot-' + suffix.repeat(16) })
function fixture() {
  const created = [], attached = new Set()
  const host = { getContentBounds: () => ({ width: 1200, height: 800 }), isDestroyed: () => false, contentView: { addChildView(view) { attached.add(view) }, removeChildView(view) { attached.delete(view) } } }
  class View {
    constructor(options) {
      this.options = options; this.events = {}; this.closed = false; created.push(this)
      this.webContents = { setWindowOpenHandler: handler => { this.open = handler }, on: (name, handler) => { this.events[name] = handler }, loadURL: async url => { this.url = url }, isDestroyed: () => this.closed, close: () => { this.closed = true } }
    }
    setBounds(value) { this.bounds = value }
  }
  let target = destination('a')
  const view = new CompanionConsoleView({ WebContentsView: View, window: () => host, getUrl: async () => target })
  return { view, created, attached, setTarget(value) { target = value } }
}

test('cloud console uses isolated native content and denies remote navigation or redirects', async () => {
  const f = fixture()
  try {
    assert.equal(await f.view.show({ x: 240, y: 180, width: 800, height: 500 }), true)
    const native = f.created[0]
    assert.deepEqual(native.options.webPreferences, { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: destination('a').partition })
    assert.equal(native.open().action, 'deny')
    for (const name of ['will-navigate', 'will-redirect']) {
      let denied = false
      native.events[name]({ preventDefault() { denied = true } }, 'https://outside.example/'); assert.equal(denied, true)
      denied = false; native.events[name]({ preventDefault() { denied = true } }, 'http://127.0.0.1:16185/#/welcome'); assert.equal(denied, false)
    }
    assert.equal(f.attached.size, 1)
    f.view.hide(); assert.equal(f.attached.size, 0)
  } finally { f.view.close() }
})

test('a different server rebuilds the view instead of reusing localhost login credentials', async () => {
  const f = fixture()
  try {
    await f.view.show({ x: 240, y: 180, width: 800, height: 500 })
    const previous = f.created[0]
    f.setTarget(destination('b'))
    await f.view.show({ x: 240, y: 180, width: 800, height: 500 })
    assert.equal(previous.closed, true); assert.equal(f.created.length, 2); assert.equal(f.attached.size, 1)
    assert.equal(f.created[1].options.webPreferences.partition, destination('b').partition)
    f.setTarget({ ...destination('b'), url: 'https://untrusted.example/' })
    await assert.rejects(f.view.show({ x: 240, y: 180, width: 800, height: 500 }), /无效/)
    assert.equal(f.created.length, 2)
  } finally { f.view.close() }
})
